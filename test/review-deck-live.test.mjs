import test from 'node:test';
import assert from 'node:assert/strict';
import { LIVE_VERSION, planDeck, sectionHash, slideRequests } from '../core/review-deck-live.mjs';

const text = (t, o = {}) => ({ type: 'text', x: 0, y: 0, w: 100, h: 50, text: t, size: 8, color: '1A1A1A', ...o });
const sec = (key, ...slides) => ({ key, slides: slides.map((elements) => ({ background: 'FFFFFF', elements })) });

test('the hash ignores the volatile "Updated" date and image bytes', () => {
  const a = sec('asset:A1', [text('A1'), text('Updated 1 Jan', { volatile: true }), { type: 'image', sha: 'x', x: 0, y: 0, w: 1, h: 1, data: Buffer.from('1') }]);
  const b = sec('asset:A1', [text('A1'), text('Updated 2 Feb', { volatile: true }), { type: 'image', sha: 'x', x: 0, y: 0, w: 1, h: 1, data: Buffer.from('2') }]);
  assert.equal(sectionHash(a), sectionHash(b));
  const c = sec('asset:A1', [text('A1'), { type: 'image', sha: 'y', x: 0, y: 0, w: 1, h: 1 }]);
  assert.notEqual(sectionHash(a), sectionHash(c));
});

test('plan: unchanged sections are kept, changed ones reuse their slides, removed ones are deleted', () => {
  const s1 = sec('overview', [text('o')]);
  const s2 = sec('asset:A1', [text('old')]);
  const state = {
    version: LIVE_VERSION,
    sections: {
      overview: { hash: sectionHash(s1), slides: ['s1'] },
      'asset:A1': { hash: sectionHash(s2), slides: ['s2'] },
      'asset:GONE': { hash: 'x', slides: ['s3'] },
    },
  };
  const now = [s1, sec('asset:A1', [text('new')], [text('page 2')])];
  const p = planDeck(now, state, ['s1', 's2', 's3', 'mine']);
  assert.equal(p.migrate, false);
  assert.deepEqual(p.unchanged, ['overview']);
  assert.deepEqual(p.steps[0].keep, ['s1']);
  assert.deepEqual(p.steps[1].reuse, ['s2']); // same slide id: comments stay on it
  assert.equal(p.steps[1].create, 1);
  assert.deepEqual(p.removed, ['s3']); // a person's own slide ("mine") is never touched
});

test('plan: a deck written as a whole file is migrated once', () => {
  const p = planDeck([sec('overview', [text('o')])], null, ['old1', 'old2']);
  assert.equal(p.migrate, true);
  assert.equal(p.steps[0].create, 1);
});

test('slide requests: text styles per paragraph, shapes with fill, images only with a URL', () => {
  const r = slideRequests('page', { background: 'FFFFFF', elements: [text(['Title', { text: 'Body', size: 6, bold: true }], { align: 'r', anchor: 'ctr' }), { type: 'rect', x: 0, y: 0, w: 10, h: 10, fill: 'E3E3E3' }, { type: 'image', sha: 'abc', x: 0, y: 0, w: 5, h: 5 }, { type: 'image', sha: 'nope', x: 0, y: 0, w: 5, h: 5 }] }, { 'abc:false': 'https://img' });
  const kinds = r.map((q) => Object.keys(q)[0]);
  assert.ok(kinds.includes('insertText'));
  const ins = r.find((q) => q.insertText).insertText;
  assert.equal(ins.text, 'Title\nBody');
  const styles = r.filter((q) => q.updateTextStyle).map((q) => q.updateTextStyle.textRange);
  assert.deepEqual(styles.map((x) => [x.startIndex, x.endIndex]), [[0, 5], [6, 10]]);
  assert.equal(r.find((q) => q.updateParagraphStyle).updateParagraphStyle.style.alignment, 'END');
  assert.ok(r.some((q) => q.updateShapeProperties?.shapeProperties.contentAlignment === 'MIDDLE'));
  assert.equal(r.filter((q) => q.createImage).length, 1);
  assert.ok(r.filter((q) => q.createShape || q.createImage).every((q) => (q.createShape ?? q.createImage).objectId.startsWith('rd')));
});

test('first update adopts the old slides by asset code', async () => {
  const { adoptSlides } = await import('../core/review-deck-live.mjs');
  const t = (x) => ({ shape: { text: { textElements: [{ textRun: { content: x } }] } } });
  const a = adoptSlides([
    { objectId: 'c', pageElements: [t('Project'), t('Client · Review deck')] },
    { objectId: 'o', pageElements: [t('Overview')] },
    { objectId: 'a1', pageElements: [t('APS011'), t('GOLD SERIES')] },
    { objectId: 'a2', pageElements: [t('APS011')] },
    { objectId: 'x', pageElements: [t('notes')] },
  ]);
  assert.deepEqual(a, { cover: ['c'], overview: ['o'], 'asset:APS011': ['a1', 'a2'] });
});

test('a section whose slides were overwritten is redrawn even if its content is the same', () => {
  const s1 = sec('overview', [text('o')]);
  const state = { version: LIVE_VERSION, sections: { overview: { hash: sectionHash(s1), slides: ['p2'] } } };
  assert.deepEqual(planDeck([s1], state, ['p2']).unchanged, ['overview']);
  const p = planDeck([s1], state, ['p2'], { dirty: ['p2'] });
  assert.deepEqual(p.unchanged, []);
  assert.deepEqual(p.steps[0].reuse, ['p2']);
});

test('element ids are stable, so unchanged elements are skipped on redraw', async () => {
  const { elementIds } = await import('../core/review-deck-live.mjs');
  const slide = { elements: [text('A'), { type: 'image', sha: 's1', x: 0, y: 0, w: 1, h: 1 }, text('A')] };
  const a = elementIds('pg', slide);
  assert.deepEqual(a, elementIds('pg', slide));
  assert.notEqual(a[0], a[2]); // duplicates get their own id
  assert.notDeepEqual(a, elementIds('other', slide));
  const r = slideRequests('pg', slide, { 's1:false': 'u' }, { skip: new Set([a[1]]) });
  assert.equal(r.filter((q) => q.createImage).length, 0);
  assert.equal(r.filter((q) => q.createShape).length, 2);
});

test('plan: a renamed asset keeps its slides; in a swap each code takes the right old slides', () => {
  const a7 = sec('asset:A7', [text('A7 old')]);
  const a8 = sec('asset:A8', [text('A8 old')]);
  const state = { version: LIVE_VERSION, sections: { 'asset:A7': { hash: sectionHash(a7), slides: ['s7'] }, 'asset:A8': { hash: sectionHash(a8), slides: ['s8'] } } };
  // A8 → A7 and A7 → A6: the old A7 slide now belongs to A6, the old A8 slide to A7.
  const now = [sec('asset:A6', [text('A6')]), sec('asset:A7', [text('A7')])];
  const p = planDeck(now, state, ['s7', 's8'], { renames: { 'asset:A7': 'asset:A6', 'asset:A8': 'asset:A7' } });
  const by = Object.fromEntries(p.steps.map((s) => [s.key, s.reuse]));
  assert.deepEqual(by['asset:A6'], ['s7']);
  assert.deepEqual(by['asset:A7'], ['s8']);
  assert.deepEqual(p.removed, []);
  // Without the rename, A7's code would reuse the wrong slide and A8's slide would be deleted.
  const plain = planDeck(now, state, ['s7', 's8']);
  assert.deepEqual(plain.removed, ['s8']);
});

test('deck renames come from renumber.yaml, collapse chains, and are applied once', async () => {
  const { tempStudio } = await import('./helpers.mjs');
  const t = tempStudio();
  const ws = await import('../core/workspace.mjs');
  const fsu = await import('../core/fsutil.mjs');
  const path = await import('node:path');
  const { deckRenames } = await import('../core/review-deck.mjs');
  const slug = ws.createClient('Renameco');
  const p = ws.ensureProject(slug, 'Spring');
  fsu.writeYamlAtomic(path.join(t.ws, 'clients', slug, 'projects', p, 'renumber.yaml'), {
    renumbers: [
      { at: '2026-01-01T00:00:00Z', map: { A3: 'A2' } },
      { at: '2026-02-01T00:00:00Z', map: { A2: 'A1', A9: 'A8' } },
    ],
  });
  const live = { version: LIVE_VERSION, sections: {} };
  const r = deckRenames(slug, p, live);
  assert.equal(r.renames['asset:A3'], 'asset:A1'); // A3 → A2 → A1
  assert.equal(r.renames['asset:A9'], 'asset:A8');
  assert.equal(r.renumbers.length, 2);
  // Once applied, the same renumbers are skipped; a deck without saved state gets none.
  assert.deepEqual(deckRenames(slug, p, { ...live, renumbers_applied: r.renumbers }).renames, {});
  assert.deepEqual(deckRenames(slug, p, null).renames, {});
  // A deck last drawn after both renumbers already uses the new codes.
  assert.deepEqual(deckRenames(slug, p, live, '2026-03-01T00:00:00Z').renames, {});
  assert.deepEqual(Object.keys(deckRenames(slug, p, live, '2026-01-15T00:00:00Z').renames), ['asset:A2', 'asset:A9']);
  t.cleanup();
});

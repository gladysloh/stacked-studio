import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { pngFile, tempStudio } from './helpers.mjs';

let t;
beforeEach(() => (t = tempStudio()));
afterEach(() => t.cleanup());

async function project() {
  const ws = await import('../core/workspace.mjs');
  const { importFile } = await import('../core/media.mjs');
  const { writeYamlAtomic } = await import('../core/fsutil.mjs');
  const slug = ws.createClient('Acme');
  const p = ws.ensureProject(slug, 'Spring');
  const [a, b, c] = [[1, 2, 3], [4, 5, 6], [7, 8, 9]].map((rgb, i) => importFile(pngFile(t.dir, `${i}.png`, rgb)));
  for (const code of ['D01', 'D02', 'D03']) {
    const dir = ws.deliverableDir(slug, p, code, { create: true, title: 'serum' });
    // a: shared by D01+D02 (a section), b: shared by all three, c: D01 only
    const files = [...(code !== 'D03' ? [{ sha: a.sha, role: 'mood', slide: 5 }] : []), { sha: b.sha, role: 'overview', slide: 9 }, ...(code === 'D01' ? [{ sha: c.sha, role: 'lighting', slide: 6 }] : [])];
    writeYamlAtomic(path.join(dir, 'deliverable.yaml'), { code, files });
  }
  return { ws, slug, p, a, b, c };
}

test('consolidate: images shared by several deliverables become sections; their own images stay', async () => {
  const { slug, p, a, c } = await project();
  const { consolidateSections, readSections, sectionFor } = await import('../core/sections.mjs');
  const r = consolidateSections(slug, p);
  assert.equal(r.sections, 2);
  assert.equal(r.moved, 5);
  const secs = readSections(slug, p);
  assert.ok(secs.find((s) => s.codes.join() === 'D01,D02').images.some((i) => i.sha === a.sha));
  assert.equal(sectionFor(slug, p, 'D03').codes.length, 3);
  const { deliverablePage } = await import('../core/projects.mjs');
  const d = deliverablePage(slug, p, 'D01');
  assert.deepEqual(d.deck_images.lighting, [c.sha]);
  assert.ok(Object.keys(d.deck_images).some((k) => k.endsWith('· mood')));
  assert.deepEqual(consolidateSections(slug, p), { sections: 0, moved: 0 }); // safe to repeat
});

test('saveSections replaces a source\'s earlier sections, and readable copies go once under references/<section>', async () => {
  const { slug, p, a, b } = await project();
  const { saveSections, readSections } = await import('../core/sections.mjs');
  saveSections(slug, p, [{ section: 'OLD NAME', codes: ['D01', 'D02', 'D03'], sha: a.sha, role: 'mood' }], 'deck-file');
  saveSections(slug, p, [{ section: 'GOLD SERIES', codes: ['D01', 'D02'], sha: b.sha, role: 'mood' }], 'deck-file');
  assert.deepEqual(readSections(slug, p).map((s) => s.name), ['GOLD SERIES']);
  const { organiseClient } = await import('../core/organise.mjs');
  organiseClient(slug);
  assert.ok(fs.existsSync(path.join(t.ws, 'clients', slug, 'projects', p, 'references', 'gold-series', 'mood-01.png')));
  assert.ok(fs.existsSync(path.join(t.ws, 'clients', slug, 'projects', p, 'D01-serum', 'deliverable.yaml')));
});

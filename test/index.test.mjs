import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { tempStudio } from './helpers.mjs';

let t;
beforeEach(() => (t = tempStudio()));
afterEach(() => t.cleanup());

async function seed() {
  const ws = await import('../core/workspace.mjs');
  const slug = ws.createClient('Acme Skincare');
  const dir = path.join(t.ws, 'clients', slug);
  fs.writeFileSync(path.join(dir, 'brand', 'brand.md'), '# Acme\n\n## Palette\n\nWarm amber #C8862B and cream #F4EBDD.\n\n## Don\'t\n\nNo cold blue light. No clutter.\n');
  fs.writeFileSync(path.join(dir, 'brand', 'notes', 'tone.md'), '---\nstatus: draft\ntopic: tone\n---\n\n# Tone\n\nCalm, ritual, unhurried mornings.\n');
  const p = ws.ensureProject(slug, 'Spring 2027');
  fs.mkdirSync(path.join(dir, 'projects', p, 'D01-night-serum'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'projects', p, 'D01-night-serum', 'brief.md'), '# D01\n\n## Product\n\nAmber night serum\n\n## Lighting\n\nLow golden morning sun from the left\n');
  fs.mkdirSync(path.join(dir, 'decks', 'working'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'decks', 'working', 'comments.jsonl'), JSON.stringify({ id: 'c1', author: 'Client', body: 'Make the serum bottle bigger', slide: 3, asset_code: 'D01' }) + '\n');
  return slug;
}

test('keyword search finds briefs, labels trust, filters by kind', async () => {
  const slug = await seed();
  const { search } = await import('../core/index.mjs');
  const r = await search('golden morning light serum', { client: slug });
  assert.ok(r.results.length >= 2);
  const d = r.results.find((x) => x.kind === 'deliverable');
  assert.equal(d.status, 'source');
  assert.match(d.title, /^D01/);
  const c = await search('bottle bigger', { client: slug, kinds: ['deck_comment'] });
  assert.equal(c.results[0].status, 'unverified');
  assert.equal(c.results.every((x) => x.kind === 'deck_comment'), true);
});

test('index refreshes when files change and forgets deleted files', async () => {
  const slug = await seed();
  const { search, refresh } = await import('../core/index.mjs');
  const f = path.join(t.ws, 'clients', slug, 'brand', 'notes', 'tone.md');
  assert.equal((await search('ritual', { client: slug })).results.length, 1);
  fs.rmSync(f);
  refresh();
  assert.equal((await search('ritual', { client: slug })).results.length, 0);
});

test('vectors are used once embedded (test embedder), merged with keywords', async () => {
  const slug = await seed();
  const { embedMissing, search } = await import('../core/index.mjs');
  const e = await embedMissing();
  assert.ok(e.embedded > 0);
  const r = await search('amber cream palette', { client: slug });
  assert.equal(r.used.vectors, true);
  assert.equal(r.results[0].kind, 'brand');
});

test('client context: approved brand in full, relevant items labelled, links', async () => {
  const slug = await seed();
  const { clientContext } = await import('../core/index.mjs');
  const c = await clientContext(slug, { query: 'D01 serum lighting' });
  assert.match(c.brand.text, /No cold blue light/);
  assert.equal(c.brand.status, 'approved');
  assert.ok(c.relevant.some((x) => x.kind === 'deliverable'));
  assert.ok(c.relevant.every((x) => x.kind !== 'brand'));
});

test('rebuild from scratch gives the same answer', async () => {
  const slug = await seed();
  const { rebuild, search } = await import('../core/index.mjs');
  const before = (await search('serum', { client: slug })).results.length;
  rebuild();
  assert.equal((await search('serum', { client: slug })).results.length, before);
});

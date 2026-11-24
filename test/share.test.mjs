import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { pngFile, tempStudio } from './helpers.mjs';

let t;
beforeEach(() => (t = tempStudio()));
afterEach(() => t.cleanup());

test('export → import into an empty workspace keeps records, review log and product cutouts', async () => {
  const ws = await import('../core/workspace.mjs');
  const { makeImage } = await import('../core/generate.mjs');
  const { addReview } = await import('../core/records.mjs');
  const { importFile } = await import('../core/media.mjs');
  const share = await import('../core/share.mjs');
  const slug = ws.createClient('Acme');
  const cut = importFile(pngFile(t.dir, 'cut.png'));
  fs.mkdirSync(path.join(t.ws, 'clients/acme/products/serum'), { recursive: true });
  fs.writeFileSync(path.join(t.ws, 'clients/acme/products/serum/product.yaml'), `name: Serum\ncutouts:\n  - sha: ${cut.sha}\n`);
  const g = await makeImage({ prompt: 'x', client: slug, project: 'P1' });
  addReview({ target: g.id, action: 'approve' });
  const { zip, media } = share.exportClient(slug, { out: path.join(t.dir, 'acme.zip') });
  assert.equal(media, 1);

  // A teammate's empty workspace.
  process.env.STACKED_WORKSPACE = path.join(t.dir, 'ws2');
  const r = share.importClient(zip);
  assert.equal(r.media, 1);
  assert.ok(r.added > 3);
  assert.deepEqual(r.conflicts, []);
  const rec = await import('../core/records.mjs');
  assert.equal(rec.withReview(rec.requireGeneration(g.id)).outputs[0].status, 'approved');
  const m = await import('../core/media.mjs');
  assert.ok(m.mediaPath(cut.sha));
  assert.equal(m.mediaPath(g.outputs[0].sha), null); // generated media stays out unless --with-media
});

test('import merges append-only logs and reports conflicts without overwriting', async () => {
  const ws = await import('../core/workspace.mjs');
  const { makeImage } = await import('../core/generate.mjs');
  const rec = await import('../core/records.mjs');
  const share = await import('../core/share.mjs');
  const slug = ws.createClient('Acme');
  const g = await makeImage({ prompt: 'x', client: slug, project: 'P1' });
  const { zip } = share.exportClient(slug, { out: path.join(t.dir, 'a.zip') });
  // Meanwhile, locally: a new comment and an edited brand.md.
  rec.addReview({ target: g.id, action: 'comment', note: 'mine' });
  fs.appendFileSync(path.join(t.ws, 'clients/acme/brand/brand.md'), '\nlocal edit\n');
  // The teammate's copy has their own comment.
  const ws2 = path.join(t.dir, 'ws2');
  process.env.STACKED_WORKSPACE = ws2;
  share.importClient(zip);
  rec.addReview({ target: g.id, action: 'comment', note: 'theirs' });
  const back = share.exportClient(slug, { out: path.join(t.dir, 'b.zip') });
  process.env.STACKED_WORKSPACE = t.ws;
  const r = share.importClient(back.zip);
  assert.equal(r.merged_entries, 1);
  const notes = rec.reviewsFor(slug, 'p1').map((e) => e.note);
  assert.deepEqual(notes.filter(Boolean).sort(), ['mine', 'theirs']);
  assert.equal(r.conflicts.length, 1);
  assert.match(r.conflicts[0].file, /brand\.md$/);
  assert.match(fs.readFileSync(path.join(t.ws, 'clients/acme/brand/brand.md'), 'utf8'), /local edit/);
});

test('team pack refuses API keys', async () => {
  const share = await import('../core/share.mjs');
  const dir = path.join(t.dir, 'pack');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'team.yaml'), 'name: Team\ndefaults:\n  daily_cap_usd: 8\n');
  assert.equal(share.importTeam(dir).team, 'Team');
  const { settings } = await import('../core/config.mjs');
  assert.equal(settings().daily_cap_usd, 8);
  fs.writeFileSync(path.join(dir, 'team.yaml'), `name: Team\nkey: AIza${'x'.repeat(35)}\n`);
  assert.throws(() => share.importTeam(dir), /API key/);
});

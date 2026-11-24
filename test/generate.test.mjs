import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { pngFile, tempStudio } from './helpers.mjs';

let t;
beforeEach(() => (t = tempStudio()));
afterEach(() => t.cleanup());

const load = async () => ({
  gen: await import('../core/generate.mjs'),
  rec: await import('../core/records.mjs'),
  ws: await import('../core/workspace.mjs'),
  config: await import('../core/config.mjs'),
});

test('works without a client: new image goes to scratch with a record and files', async () => {
  const { gen } = await load();
  const g = await gen.makeImage({ prompt: 'a glass jar on linen', n: 2 });
  assert.equal(g.client, '_scratch');
  assert.equal(g.project, 'scratch');
  assert.equal(g.outputs.length, 2);
  assert.equal(g.provider, 'test');
  for (const o of g.outputs) assert.ok(fs.existsSync(o.file));
  const file = path.join(t.ws, 'clients/_scratch/projects/scratch/generations', `${g.id}.yaml`);
  assert.ok(fs.existsSync(file));
  assert.equal(g.author, 'tester');
});

test('edit makes the next version with the source as first input; branch starts a new history', async () => {
  const { gen, rec } = await load();
  const a = await gen.makeImage({ prompt: 'jar', n: 2 });
  const b = await gen.makeImage({ mode: 'edit', parent: a.id, parent_output: 1, prompt: 'softer light', what_changed: 'softer' });
  assert.equal(b.version, 2);
  assert.equal(b.parent, a.id);
  assert.equal(b.root, a.root);
  assert.equal(b.inputs[0].role, 'source');
  assert.equal(b.inputs[0].sha, a.outputs[1].sha);
  const c = await gen.makeImage({ mode: 'branch', parent: b.id, prompt: 'on a beach' });
  assert.equal(c.version, 1);
  assert.equal(c.root, c.id);
  assert.deepEqual(c.branch_of, { id: b.id, output: 0 });
  assert.deepEqual(rec.history(b.id).map((h) => h.version), [1, 2]);
});

test('references by path, by earlier image and by role are recorded', async () => {
  const { gen } = await load();
  const f = pngFile(t.dir, 'product.png');
  const a = await gen.makeImage({ prompt: 'scene' });
  const g = await gen.makeImage({ prompt: 'product on marble', inputs: [{ path: f, role: 'product', note: 'the jar' }, { generation: a.id, role: 'style' }] });
  assert.deepEqual(g.inputs.map((i) => i.role), ['product', 'style']);
  assert.equal(g.inputs[0].note, 'the jar');
  assert.deepEqual(g.inputs[1].from, { generation: a.id, output: 0 });
});

test('a client project records which brand file version shaped the image', async () => {
  const { gen, ws } = await load();
  ws.createClient('Acme Skincare');
  const g = await gen.makeImage({ prompt: 'serum', client: 'acme skincare', project: 'Spring 2027', deliverable: 'D01' });
  assert.equal(g.client, 'acme-skincare');
  assert.equal(g.project, 'spring-2027');
  assert.equal(g.deliverable, 'D01');
  assert.equal(g.context_used[0].kind, 'brand');
  assert.ok(fs.existsSync(path.join(t.ws, 'clients/acme-skincare/projects/spring-2027/project.yaml')));
});

test('unknown client fails with a fix', async () => {
  const { gen } = await load();
  await assert.rejects(gen.makeImage({ prompt: 'x', client: 'nobody' }), (e) => /no client/.test(e.message) && /studio client/.test(e.fix));
});

test('request_id makes a retry free', async () => {
  const { gen, rec } = await load();
  const a = await gen.makeImage({ prompt: 'x', request_id: 'r1' });
  const b = await gen.makeImage({ prompt: 'x', request_id: 'r1' });
  assert.equal(a.id, b.id);
  assert.ok(b.repeated);
  assert.equal(rec.listGenerations().length, 1);
});

test('review: latest approve/reject wins; comments and ratings kept', async () => {
  const { gen, rec } = await load();
  const a = await gen.makeImage({ prompt: 'x', n: 2 });
  rec.addReview({ target: a.id, output: 1, action: 'reject' });
  rec.addReview({ target: a.id, output: 1, action: 'approve' });
  rec.addReview({ target: a.id, output: 1, action: 'rate', value: 4 });
  rec.addReview({ target: a.id, output: 0, action: 'comment', note: 'too dark' });
  const r = rec.withReview(rec.requireGeneration(a.id));
  assert.equal(r.outputs[1].status, 'approved');
  assert.equal(r.outputs[1].rating, 4);
  assert.equal(r.outputs[0].status, 'new');
  assert.equal(r.outputs[0].comments[0].note, 'too dark');
  assert.throws(() => rec.addReview({ target: a.id, action: 'rate', value: 9 }));
});

test('compare records the comparison, the pick and a prompt diff', async () => {
  const { gen, rec } = await load();
  const a = await gen.makeImage({ prompt: 'warm light on a jar' });
  const b = await gen.makeImage({ mode: 'edit', parent: a.id, prompt: 'soft light on a jar' });
  const c = gen.compare({ items: [a.id, b.id], pick: b.id });
  assert.equal(c.items.length, 2);
  assert.ok(c.prompt_diff.some((d) => d.op === '-' && d.text.includes('warm')));
  const log = rec.reviewsFor('_scratch', 'scratch').map((e) => e.action);
  assert.deepEqual(log, ['compare', 'pick']);
});

test('upscale is the next version of the same image', async () => {
  const { gen } = await load();
  const a = await gen.makeImage({ prompt: 'x' });
  const u = await gen.makeImage({ mode: 'upscale', parent: a.id });
  assert.equal(u.kind, 'upscale');
  assert.equal(u.version, 2);
  assert.ok(u.outputs[0].width > a.outputs[0].width);
});

test('word diff', async () => {
  const { gen } = await load();
  const d = gen.wordDiff('a b c', 'a x c');
  assert.deepEqual(d.map((x) => x.op), ['=', '-', '+', '=']);
});

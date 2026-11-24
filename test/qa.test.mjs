import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { pngFile, repo, tempStudio } from './helpers.mjs';

let t;
beforeEach(() => (t = tempStudio()));
afterEach(() => t.cleanup());

test('verdict rule: weighted mean, critical caps at 2, any area under 3 fails', async () => {
  const { verdictFor } = await import('../core/qa.mjs');
  assert.deepEqual(verdictFor({ messaging: { score: 5 }, brief_alignment: { score: 4 }, visual_execution: { score: 4 }, technical: { score: 5 } }), { overall: 4.4, verdict: 'meets_brief' });
  assert.equal(verdictFor({ messaging: { score: 5 }, visual_execution: { score: 2 } }).verdict, 'needs_changes');
  assert.deepEqual(verdictFor({ messaging: { score: 5, severity: 'critical' } }), { overall: 2, verdict: 'needs_changes' });
  assert.equal(verdictFor({ messaging: { score: null, note: 'n/a' } }).verdict, 'cant_check');
});

test('qa_record saves a check that shows on the image; qa_basics measures format and resolution', async () => {
  const { runOp } = await import('../core/ops.mjs');
  const g = await runOp('image_generate', { prompt: 'x', aspect: '4:5' });
  const b = await runOp('qa_basics', { id: g.id });
  assert.equal(b.checks.find((c) => c.check === 'format').ok, true); // test images are 256×320 = 4:5
  assert.equal(b.checks.find((c) => c.check === 'resolution').ok, false);
  const r = await runOp('qa_record', { id: g.id, scores: { messaging: { score: 4, note: 'ok' }, visual_execution: { score: 3, note: 'soft' } }, labels: [{ product: 'Serum', expected: 'SERUM', read: 'SERUN', ok: false }], suggestions: ['Sharpen the label.'], summary: 'Close' });
  assert.equal(r.labels_wrong, 1);
  const h = await runOp('history', { id: g.id });
  assert.equal(h.versions[0].outputs[0].check.verdict, r.verdict);
  await assert.rejects(runOp('qa_record', { id: g.id, scores: { vibes: { score: 5, note: 'x' } } }), /Unknown area/);
  await assert.rejects(runOp('review', { id: g.id, action: 'check' }));
});

test('brand palette is read from brand.md; colour distance behaves', async () => {
  const ws = await import('../core/workspace.mjs');
  const { brandPalette, deltaE } = await import('../core/qa.mjs');
  const slug = ws.createClient('Acme');
  fs.appendFileSync(path.join(t.ws, 'clients', slug, 'brand', 'brand.md'), '\nAmber #c8862b, cream #F4EBDD, amber again #C8862B\n');
  assert.deepEqual(brandPalette(slug), ['#C8862B', '#F4EBDD']);
  assert.ok(deltaE('#C8862B', '#C8862B') < 0.001);
  assert.ok(deltaE('#C8862B', '#C9872C') < 2);
  assert.ok(deltaE('#C8862B', '#1E40FF') > 50);
});

test('products: add with label text and photo, list returns files; repeat adds nothing', async () => {
  const ws = await import('../core/workspace.mjs');
  const { runOp } = await import('../core/ops.mjs');
  const slug = ws.createClient('Acme');
  const f = pngFile(t.dir, 'serum.png');
  const a = await runOp('product_add', { client: slug, name: 'Night Serum', label_text: 'NIGHT / SERUM', image: { path: f } });
  assert.equal(a.added, 1);
  const again = await runOp('product_add', { client: slug, name: 'night serum', image: { path: f } });
  assert.equal(again.added, 0);
  const { products } = await runOp('product_list', { client: slug });
  assert.equal(products[0].label_text, 'NIGHT / SERUM');
  assert.ok(fs.existsSync(products[0].cutouts[0].file));
  // Cutouts need the optional media tools (and rembg): without them there's a clear fix, not a crash.
  await assert.rejects(runOp('product_add', { client: slug, name: 'X', image: { path: f }, cutout: true }), (e) => /media tools|rembg/i.test(e.message));
});

test('Workbench check run saves a structured check without making images', async () => {
  process.env.STACKED_AGENT_CMD = path.join(repo, 'test/fake-agent.mjs');
  const { startServer } = await import('../apps/workbench/server.mjs');
  const wb = await startServer({ port: 0, open: false, quiet: true });
  try {
    const { runOp } = await import('../core/ops.mjs');
    const g = await runOp('image_generate', { prompt: 'x' });
    const headers = { cookie: `ss_session=${wb.token}`, 'content-type': 'application/json' };
    const run = await (await fetch(`http://127.0.0.1:${wb.port}/api/runs`, { method: 'POST', headers, body: JSON.stringify({ kind: 'check', id: g.id }) })).json();
    let r;
    for (let i = 0; i < 100; i++) {
      r = (await (await fetch(`http://127.0.0.1:${wb.port}/api/runs`, { headers })).json()).find((x) => x.id === run.id);
      if (!['queued', 'running'].includes(r.status)) break;
      await new Promise((res) => setTimeout(res, 100));
    }
    assert.equal(r.status, 'done', r.message);
    const page = await (await fetch(`http://127.0.0.1:${wb.port}/api/image/${g.id}`, { headers })).json();
    assert.equal(page.image.checks[0].verdict, 'needs_changes');
    assert.equal(page.image.checks[0].labels[0].read, 'SERUN');
    assert.equal(page.versions.length, 1);
    const { buildTask } = await import('../core/runner.mjs');
    assert.match(buildTask({ kind: 'check', target: g.id, output: 0, text: '' }), /Do not make or change images/);
  } finally {
    await wb.close();
    delete process.env.STACKED_AGENT_CMD;
  }
});

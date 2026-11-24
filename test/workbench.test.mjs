import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { repo, tempStudio } from './helpers.mjs';

let t;
let wb;
beforeEach(async () => {
  t = tempStudio();
  process.env.STACKED_AGENT_CMD = path.join(repo, 'test/fake-agent.mjs');
  const { startServer } = await import('../apps/workbench/server.mjs');
  wb = await startServer({ port: 0, open: false, quiet: true });
});
afterEach(async () => {
  await wb.close();
  delete process.env.STACKED_AGENT_CMD;
  t.cleanup();
});

const base = () => `http://127.0.0.1:${wb.port}`;
const cookie = () => `ss_session=${wb.token}`;
const get = (p, headers = {}) => fetch(base() + p, { headers: { cookie: cookie(), ...headers } });
const post = (p, body) => fetch(base() + p, { method: 'POST', headers: { cookie: cookie(), 'content-type': 'application/json', origin: base() }, body: JSON.stringify(body) }).then((r) => r.json());
async function waitRun(id) {
  for (let i = 0; i < 100; i++) {
    const runs = await (await get('/api/runs')).json();
    const r = runs.find((x) => x.id === id);
    if (!['queued', 'running'].includes(r.status)) return r;
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error('run did not finish');
}

test('security: no cookie, wrong host or wrong origin are refused; login link sets the cookie', async () => {
  assert.equal((await fetch(base() + '/api/state')).status, 401);
  assert.equal((await get('/api/state', { origin: 'http://evil.example' })).status, 403);
  const login = await fetch(`${base()}/login?t=${wb.token}`, { redirect: 'manual' });
  assert.equal(login.status, 302);
  assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal((await fetch(`${base()}/login?t=wrong`, { redirect: 'manual' })).status, 403);
  assert.equal((await get('/media/../../etc/passwd')).status, 404);
});

test('new image → refine → board, compare preview, pick and approve, all through the Workbench', async () => {
  const run = await post('/api/runs', { kind: 'new', text: 'a jar on linen', n: 2 });
  const done = await waitRun(run.id);
  assert.equal(done.status, 'done', done.message);
  assert.equal(done.images.length, 1);
  const first = done.images[0];

  const r2 = await waitRun((await post('/api/runs', { kind: 'refine', text: 'softer light', id: first, output: 1 })).id);
  assert.equal(r2.status, 'done');
  const second = r2.images[0];

  const state = await (await get('/api/state')).json();
  assert.equal(state.tiles.length, 1);
  assert.equal(state.tiles[0].version, 2);
  assert.equal(state.agent, 'Test agent');

  const page = await (await get(`/api/image/${second}`)).json();
  assert.equal(page.versions.length, 2);
  assert.equal(page.image.what_changed, 'softer light');
  const img = await get(`/media/${page.shas[second][0].sha}`);
  assert.equal(img.headers.get('content-type'), 'image/png');

  const preview = await post('/api/compare', { items: [{ id: first, output: 1 }, { id: second }] });
  assert.equal(preview.compared, null);
  const picked = await post('/api/compare', { items: [{ id: first, output: 1 }, { id: second }], pick: { id: second } });
  assert.ok(picked.compared);
  const approved = await post('/api/review', { id: second, action: 'approve' });
  assert.equal(approved.outputs[0].status, 'approved');
  const filtered = await (await get('/api/state?status=approved')).json();
  assert.equal(filtered.tiles.length, 1);
});

test('a failed agent run shows its message', async () => {
  const r = await waitRun((await post('/api/runs', { kind: 'new', text: 'fail please' })).id);
  assert.equal(r.status, 'failed');
  assert.match(r.message, /Could not do it/);
});

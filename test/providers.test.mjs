import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { makePng } from '../core/png.mjs';
import { fakeServer, pngFile, tempStudio } from './helpers.mjs';

let t;
let srv;
beforeEach(() => (t = tempStudio()));
afterEach(async () => {
  await srv?.close();
  srv = null;
  delete process.env.STACKED_GEMINI_BASE;
  delete process.env.STACKED_FAL_BASE;
  t.cleanup();
});

const png = makePng(16, 20, () => [10, 200, 10]);
const geminiOk = () => ({ json: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }] } });

test('gemini: key in header, references inline, cost recorded, spend logged per key', async () => {
  srv = await fakeServer(geminiOk);
  process.env.STACKED_GEMINI_BASE = srv.url;
  process.env.GEMINI_API_KEY = 'test-key-123456';
  const { makeImage } = await import('../core/generate.mjs');
  const { spendSummary } = await import('../core/spend.mjs');
  const g = await makeImage({ prompt: 'jar', n: 2, inputs: [{ path: pngFile(t.dir, 'p.png'), role: 'product' }] });
  assert.equal(g.provider, 'gemini');
  assert.equal(g.model, 'gemini-3.1-flash-image');
  assert.equal(g.outputs.length, 2);
  assert.equal(g.cost_usd, 0.134);
  assert.equal(srv.calls.length, 2);
  assert.equal(srv.calls[0].headers['x-goog-api-key'], 'test-key-123456');
  const parts = srv.calls[0].body.contents[0].parts;
  assert.ok(parts[0].inlineData);
  assert.match(parts.at(-1).text, /No added text/);
  const s = spendSummary();
  assert.equal(Number(s.today.toFixed(3)), 0.134);
  assert.equal(Object.keys(s.by_key)[0].startsWith('gemini:'), true);
});

test('gemini: a failure is recorded as a failed version, with a plain message', async () => {
  srv = await fakeServer(() => ({ status: 429, json: { error: { message: 'Quota exceeded, limit: 0' } } }));
  process.env.STACKED_GEMINI_BASE = srv.url;
  process.env.GEMINI_API_KEY = 'test-key-123456';
  const { makeImage } = await import('../core/generate.mjs');
  const { listGenerations } = await import('../core/records.mjs');
  await assert.rejects(makeImage({ prompt: 'x' }), /no quota/);
  const [g] = listGenerations();
  assert.equal(g.status, 'failed');
  assert.equal(g.outputs.length, 0);
});

test('daily cap stops a run before any call', async () => {
  srv = await fakeServer(geminiOk);
  process.env.STACKED_GEMINI_BASE = srv.url;
  process.env.GEMINI_API_KEY = 'test-key-123456';
  const { setUserSetting } = await import('../core/config.mjs');
  setUserSetting('daily_cap_usd', 0.1);
  const { makeImage } = await import('../core/generate.mjs');
  await assert.rejects(makeImage({ prompt: 'x', n: 2 }), (e) => /today's limit/.test(e.message) && /daily_cap_usd/.test(e.fix));
  assert.equal(srv.calls.length, 0);
});

test('fal: text-to-image and edit endpoints, results downloaded', async () => {
  srv = await fakeServer((req) => {
    if (req.url.startsWith('/files/')) return { raw: png };
    return { json: { images: [{ url: `${srv.url}/files/1.png` }] } };
  });
  process.env.STACKED_FAL_BASE = srv.url;
  process.env.FAL_KEY = 'fal-key-123456';
  const { makeImage } = await import('../core/generate.mjs');
  const a = await makeImage({ prompt: 'jar', provider: 'fal' });
  assert.equal(a.provider, 'fal');
  assert.equal(srv.calls[0].url, '/fal-ai/nano-banana');
  assert.equal(srv.calls[0].headers.authorization, 'Key fal-key-123456');
  const b = await makeImage({ mode: 'edit', parent: a.id, prompt: 'warmer' });
  assert.equal(b.provider, 'fal');
  const editCall = srv.calls.find((c) => c.url === '/fal-ai/nano-banana/edit');
  assert.ok(editCall.body.image_urls[0].startsWith('data:image/png;base64,'));
});

test('asking for a provider without its key gives the fix', async () => {
  const { makeImage } = await import('../core/generate.mjs');
  await assert.rejects(makeImage({ prompt: 'x', provider: 'gemini' }), (e) => /No Gemini key/.test(e.message) && /keys set gemini/.test(e.fix));
});

test('keys: saved to the file store, fingerprint only in config, never the key', async () => {
  const keys = await import('../core/keys.mjs');
  const fs = await import('node:fs');
  const { paths } = await import('../core/paths.mjs');
  keys.setKey('fal', 'abcdefgh12345', { label: 'team: tester' });
  const k = keys.getKey('fal');
  assert.equal(k.key, 'abcdefgh12345');
  assert.equal(k.label, 'team: tester');
  assert.ok(!fs.readFileSync(paths().userConfig, 'utf8').includes('abcdefgh12345'));
  assert.equal((fs.statSync(paths().secrets).mode & 0o777).toString(8), '600');
  keys.setSecret('google-oauth', JSON.stringify({ refresh_token: 'x"y' }));
  assert.equal(JSON.parse(keys.getSecret('google-oauth')).refresh_token, 'x"y');
  keys.removeKey('fal');
  assert.equal(keys.getKey('fal'), null);
});

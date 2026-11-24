import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { makePng } from '../core/png.mjs';
import { fakeServer, tempStudio } from './helpers.mjs';

let t;
let srv;
const png = makePng(10, 10, () => [10, 90, 200]);
beforeEach(async () => {
  t = tempStudio();
  srv = await fakeServer((req) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/img/')) return { raw: png, type: 'image/png' };
    if (u.pathname === '/res/v1/images/search') {
      if (req.headers['x-subscription-token'] !== 'brave-key-123') return { status: 401, json: {} };
      return { json: { results: [{ title: 'Podium serum', url: 'https://example.com/p', properties: { url: `${srv.url}/img/1.png`, width: 1200, height: 1500 }, thumbnail: { src: `${srv.url}/img/t1.png` } }, { title: 'No image' }] } };
    }
    if (u.pathname === '/search.json') return { json: { images_results: [{ title: 'Splash', link: 'https://example.com/s', original: `${srv.url}/img/2.png`, original_width: 800 }] } };
    return { status: 404, json: {} };
  });
});
afterEach(async () => {
  await srv.close();
  for (const k of ['STACKED_BRAVE_BASE', 'STACKED_SERPAPI_BASE', 'BRAVE_API_KEY', 'SERPAPI_KEY']) delete process.env[k];
  t.cleanup();
});

test('library integrity: unique ids, every entry complete, every related/focus id exists', async () => {
  const { loadLibrary } = await import('../core/library.mjs');
  const lib = loadLibrary();
  assert.ok(lib.entries.size >= 80);
  assert.deepEqual(lib.categories.map((c) => c.id).sort(), ['angle', 'framing', 'hands', 'lighting', 'motion', 'placement', 'pose', 'surface']);
  for (const e of lib.entries.values()) {
    assert.match(e.id, new RegExp(`^${e.category === 'lighting' ? 'light' : e.category}\\.[a-z0-9-]+$`), e.id);
    for (const f of ['name', 'prompt', 'use_when']) assert.ok(e[f], `${e.id} has no ${f}`);
    assert.ok(e.search?.length, `${e.id} has no search terms`);
    for (const r of e.related ?? []) assert.ok(lib.entries.has(r), `${e.id} → unknown related ${r}`);
  }
  for (const s of lib.subjects) for (const f of s.focus ?? []) assert.ok(lib.entries.has(f), `${s.id} → unknown focus ${f}`);
});

test('shot_library: find by words, category and subject; unknown id suggests near matches', async () => {
  const { runOp } = await import('../core/ops.mjs');
  const r = await runOp('shot_library', { query: 'levitating' });
  assert.equal(r.entries[0].id, 'placement.floating');
  const poses = await runOp('shot_library', { category: 'pose', subject: 'model' });
  assert.ok(poses.entries.every((e) => e.category === 'pose'));
  await assert.rejects(runOp('shot_library', { id: 'angle.low-heroic' }), (e) => /No shot/.test(e.message) && /angle\.low-hero/.test(e.fix));
});

test('research plan: subject drives categories and focus shots; named shots override; competitors and links', async () => {
  const { runOp } = await import('../core/ops.mjs');
  const p = await runOp('research_plan', { subject: 'product', subject_name: 'serum bottle', category: 'skincare', competitors: ['Brand X'] });
  const groups = Object.fromEntries(p.groups.map((g) => [g.group, g]));
  assert.ok(groups.placement.shots.some((s) => s.id === 'placement.floating'));
  assert.ok(groups.overview.queries.some((q) => q.q === 'dynamic skincare product layout'));
  assert.match(groups.overview.queries[0].links.pinterest, /pinterest\.com\/search\/pins\/\?q=serum%20bottle/);
  assert.ok(groups.competitors.queries.some((q) => q.q === 'Brand X skincare campaign'));
  assert.equal(p.image_search, null);
  const m = await runOp('research_plan', { subject: 'product_with_model', category: 'skincare' });
  assert.ok(m.groups.some((g) => g.group === 'pose'));
  assert.ok(!m.groups.some((g) => g.group === 'motion'));
  const named = await runOp('research_plan', { subject: 'product', category: 'skincare', shots: ['angle.low-hero', 'nope.x'] });
  assert.deepEqual(named.groups.slice(1).map((g) => g.shots.map((s) => s.id)), [['angle.low-hero']]);
  assert.deepEqual(named.unknown_shots, ['nope.x']);
  await assert.rejects(runOp('research_plan', { subject: 'spaceship' }), /Unknown subject/);
});

test('image search: clear fallback without a key; Brave and SerpAPI with keys', async () => {
  const { runOp } = await import('../core/ops.mjs');
  await assert.rejects(runOp('image_search', { query: 'podium serum' }), (e) => /own tools/.test(e.message) && /keys set brave/.test(e.fix));
  process.env.STACKED_BRAVE_BASE = srv.url;
  process.env.BRAVE_API_KEY = 'brave-key-123';
  const b = await runOp('image_search', { query: 'podium serum' });
  assert.equal(b.provider, 'brave');
  assert.equal(b.results.length, 1);
  assert.equal(b.results[0].image_url, `${srv.url}/img/1.png`);
  const plan = await runOp('research_plan', { subject: 'product' });
  assert.equal(plan.image_search, 'brave');
  process.env.STACKED_SERPAPI_BASE = srv.url;
  process.env.SERPAPI_KEY = 'serp-key-123';
  const s = await runOp('image_search', { query: 'splash', provider: 'serpapi' });
  assert.equal(s.results[0].title, 'Splash');
});

test('save → untagged → tag: examples appear in the shot library; unknown ids are reported, not stored', async () => {
  const ws = await import('../core/workspace.mjs');
  const { runOp } = await import('../core/ops.mjs');
  const slug = ws.createClient('Acme');
  const saved = await runOp('moodboard_save', { client: slug, name: 'Launch refs', items: [
    { title: 'Podium', image_url: `${srv.url}/img/a.png`, shots: ['placement.podium', 'angle.low-heroic'] },
    { title: 'Splash', image_url: `${srv.url}/img/b.png`, subject: 'product' },
  ] });
  assert.deepEqual(saved.unknown_shots, ['angle.low-heroic']);
  assert.equal(saved.untagged.length, 1);
  assert.equal(saved.untagged[0].index, 1);
  const tagged = await runOp('reference_tag', { client: slug, board: 'Launch refs', tags: [{ index: 1, shots: ['motion.splash', 'light.backlit-glow', 'made.up'] }] });
  assert.equal(tagged.updated, 1);
  assert.deepEqual(tagged.unknown_shots, ['made.up']);
  const shot = await runOp('shot_library', { id: 'motion.splash' });
  assert.equal(shot.examples.length, 1);
  assert.equal(shot.examples[0].title, 'Splash');
  assert.ok(shot.examples[0].file);
  const podium = await runOp('shot_library', { id: 'placement.podium' });
  assert.equal(podium.examples[0].client, slug);
  const found = await runOp('search', { query: 'splash backlit', client: slug, kinds: ['research'] });
  assert.ok(found.results.length);
});

test('search finds tagged references by shot', async () => {
  const ws = await import('../core/workspace.mjs');
  const { runOp } = await import('../core/ops.mjs');
  const slug = ws.createClient('Acme');
  await runOp('moodboard_save', { client: slug, name: 'Refs', items: [{ title: 'Ref one', image_url: `${srv.url}/img/a.png`, shots: ['angle.low-hero', 'placement.podium'], take: 'monumental feel' }] });
  const r = await runOp('search', { query: 'low hero podium', client: slug, kinds: ['research'] });
  assert.equal(r.results[0].title, 'Refs · Ref one');
  assert.match(r.results[0].ref, /^[0-9a-f]{64}$/);
});

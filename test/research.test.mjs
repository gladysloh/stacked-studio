import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { makePng } from '../core/png.mjs';
import { fakeServer, tempStudio } from './helpers.mjs';

let t;
let srv;
const png = makePng(10, 10, () => [200, 120, 40]);
beforeEach(async () => {
  t = tempStudio();
  srv = await fakeServer((req) => {
    if (req.url === '/a.png' || req.url === '/originals/pin1.jpg') return { raw: png, type: 'image/png' };
    if (req.url === '/236x/pin2.jpg') return { raw: png, type: 'image/jpeg' };
    if (req.url === '/page.html') return { raw: Buffer.from('<html></html>'), type: 'text/html' };
    if (req.url === '/board.rss') {
      const item = (n, img) => `<item><title>Pin ${n}</title><link>https://www.pinterest.com/pin/${n}/</link><description><![CDATA[<a href="x"><img src="${img}"></a>Warm amber still life ${n}]]></description></item>`;
      return { raw: Buffer.from(`<?xml version="1.0"?><rss><channel><title>Amber mood</title>${item(1, `${srv.url}/236x/pin1.jpg`)}${item(2, `${srv.url}/236x/pin2.jpg`)}</channel></rss>`), type: 'application/rss+xml' };
    }
    return { status: 404, json: {} };
  });
});
afterEach(async () => {
  await srv.close();
  delete process.env.STACKED_PINTEREST_FEED;
  t.cleanup();
});

test('moodboard: downloads images, keeps links that fail, skips duplicates, findable in search', async () => {
  const ws = await import('../core/workspace.mjs');
  const { runOp } = await import('../core/ops.mjs');
  const slug = ws.createClient('Acme');
  const r = await runOp('moodboard_save', { client: slug, name: 'Amber Still Life', for: 'D01', notes: 'Low warm side light', items: [
    { title: 'Brand X launch', url: 'https://example.com/x', image_url: `${srv.url}/a.png`, take: 'amber glow through glass', tags: ['lighting'] },
    { title: 'Not an image', image_url: `${srv.url}/page.html` },
  ] });
  assert.equal(r.added, 2);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0].error, /isn't an image/);
  const again = await runOp('moodboard_save', { client: slug, name: 'Amber Still Life', items: [{ image_url: `${srv.url}/a.png` }] });
  assert.equal(again.added, 0);
  const { readMoodboard } = await import('../core/research.mjs');
  const b = readMoodboard(slug, 'amber still life');
  assert.ok(fs.existsSync(b.items[0].file));
  // A saved reference works as an input straight away.
  const img = await runOp('image_generate', { prompt: 'x', client: slug, project: 'P', inputs: [{ sha: b.items[0].sha, role: 'style' }] });
  assert.equal(img.inputs[0].role, 'style');
  const s = await runOp('search', { query: 'amber glow glass', client: slug, kinds: ['research'] });
  assert.equal(s.results[0].status, 'unverified');
  const bad = await runOp('moodboard_save', { name: 'x', items: [{ image_url: 'file:///etc/passwd' }] });
  assert.match(bad.problems[0].error, /http/);
});

test('pinterest: feed URL from a board link; pins read; save_as falls back to feed-size images', async () => {
  const { pinterestFeedUrl } = await import('../core/research.mjs');
  assert.equal(pinterestFeedUrl('https://www.pinterest.com/someone/amber-mood/'), 'https://www.pinterest.com/someone/amber-mood.rss');
  assert.throws(() => pinterestFeedUrl('https://www.pinterest.com/pin/123/'), /board link/);
  assert.throws(() => pinterestFeedUrl('https://example.com/a/b'), /not a Pinterest/);
  process.env.STACKED_PINTEREST_FEED = `${srv.url}/board.rss`;
  const { runOp } = await import('../core/ops.mjs');
  const b = await runOp('pinterest_board', { link: 'https://www.pinterest.com/someone/amber-mood/' });
  assert.equal(b.board, 'Amber mood');
  assert.equal(b.pins.length, 2);
  assert.equal(b.pins[0].image_url, `${srv.url}/originals/pin1.jpg`);
  assert.match(b.pins[0].note, /Warm amber still life 1/);
  const saved = await runOp('pinterest_board', { link: 'https://www.pinterest.com/someone/amber-mood/', save_as: 'Amber pins' });
  assert.equal(saved.added, 2);
  assert.equal(saved.problems.length, 0); // pin 2's original 404s; the feed-size copy is used
});

test('adapt plan: names, aliases and WxH; safe boxes; resize, crop, recompose and layout', async () => {
  const { runOp } = await import('../core/ops.mjs');
  const kv = await runOp('image_generate', { prompt: 'kv', aspect: '4:5' }); // 256×320
  const r = await runOp('adapt_plan', { id: kv.id, formats: ['PAID_SOCIAL_4_5', '1080x1350', 'INSTAGRAM_STORY', '1080x1080', '728x90', { name: 'Near', w: 1000, h: 1200 }] });
  const by = Object.fromEntries(r.plans.map((p) => [p.format, p]));
  assert.equal(by.INSTAGRAM_PORTRAIT.action, 'resize');
  assert.deepEqual(by.INSTAGRAM_PORTRAIT.safe.margins, { l: 54, r: 54, t: 90, b: 90 });
  assert.equal(by.INSTAGRAM_STORY.action, 'recompose');
  assert.equal(by.INSTAGRAM_STORY.model_aspect, '9:16');
  assert.match(by.INSTAGRAM_STORY.prompt_hint, /above and below/);
  assert.equal(by['1080x1080'].action, 'recompose');
  assert.equal(by['728x90'].action, 'layout');
  assert.equal(by['728x90'].archetype, 'single-strip');
  assert.equal(by.Near.action, 'crop');
  assert.equal(by.Near.crop.w, 256);
  assert.ok(by.Near.crop.h < 320);
  await assert.rejects(runOp('adapt_plan', { formats: ['BILLBOARD_9000'] }), /Unknown format/);
});

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pngFile, tempStudio } from './helpers.mjs';

const t = tempStudio();

test('review deck: version labels come from the request; pptx is a valid zip with one slide per page', async () => {
  const { versionLabel } = await import('../core/review-deck.mjs');
  assert.deepEqual(versionLabel({ version: 1, instruction: 'ABC005 Option 1 (slide 4 comments): rocks more realistic' }), { label: 'Option 1', note: 'rocks more realistic', source: 'slide 4 comments' });
  assert.equal(versionLabel({ version: 3, instruction: 'warmer light please' }).label, 'Version 3');

  const { buildPptx, emu } = await import('../core/pptx-write.mjs');
  const png = fs.readFileSync(pngFile(t.dir, 'tiny.png'));
  const bytes = buildPptx({
    slides: [
      { elements: [{ type: 'text', x: 0, y: 0, w: emu(4), h: emu(1), text: ['Title & <more>', { text: 'Gold Spray\u000bGold Stick\u0001', bold: true }] }] },
      { elements: [{ type: 'rect', x: 0, y: 0, w: emu(1), h: emu(1), fill: 'EEEEEE' }, { type: 'image', data: png, ext: 'png', x: 0, y: 0, w: emu(2), h: emu(2) }] },
    ],
  });
  const file = path.join(t.dir, 'deck.pptx');
  fs.writeFileSync(file, bytes);
  const list = execFileSync('unzip', ['-l', file], { encoding: 'utf8' });
  for (const part of ['ppt/presentation.xml', 'ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/media/image1.png', 'ppt/theme/theme1.xml']) assert.match(list, new RegExp(part.replace('.', '\\.')));
  execFileSync('unzip', ['-tq', file]); // CRCs check out
  const slide1 = execFileSync('unzip', ['-p', file, 'ppt/slides/slide1.xml'], { encoding: 'utf8' });
  assert.match(slide1, /Title &amp; &lt;more&gt;/);
  assert.match(slide1, /Gold Spray Gold Stick</); // control characters never reach the XML
});

test('review deck: summarised changes (review_notes) replace raw comments, newest date first', async () => {
  const { changesFor } = await import('../core/review-deck.mjs');
  const notes = [
    { date: '2026-11-20', change: 'Rocks more realistic', done: true },
    { date: '2026-11-24', change: 'Beach should feel Southeast Asian' },
    { date: '2026-11-24', change: 'Keep product placement' },
  ];
  const c = changesFor({ review_notes: notes }, [{ body: 'raw', created: '2026-11-24T00:00:00Z' }]);
  assert.equal(c.kind, 'summary');
  assert.deepEqual(c.groups.map((g) => g.date), ['2026-11-24', '2026-11-20']);
  assert.equal(c.groups[0].items.length, 2);
  assert.equal(c.groups[1].items[0].done, true);
  const raw = changesFor({}, [{ author: 'A', body: 'raw @someone@x.com text', created: '2026-11-24T00:00:00Z' }]);
  assert.equal(raw.kind, 'comments');
});

test('review deck: rejected versions are left out; an asset in the chosen list with no versions gets a placeholder', async () => {
  const ws = await import('../core/workspace.mjs');
  const { runOp } = await import('../core/ops.mjs');
  const slug = ws.createClient('Deckco');
  const p = ws.ensureProject(slug, 'Spring');
  ws.deliverableDir(slug, p, 'D01', { title: 'Hero', create: true });
  ws.deliverableDir(slug, p, 'D02', { title: 'Other', create: true });
  const a = await runOp('image_generate', { prompt: 'a', client: slug, project: 'Spring', deliverable: 'D01', instruction: 'D01 Option 1 (comments): first' });
  const b = await runOp('image_generate', { prompt: 'b', client: slug, project: 'Spring', deliverable: 'D01', instruction: 'D01 Option 2 (comments): second' });
  await runOp('review', { id: a.id, action: 'reject' });
  const { listGenerations } = await import('../core/records.mjs');
  const fsu = await import('../core/fsutil.mjs');
  // Test-provider images are hidden by default; mark these as real for the deck.
  for (const g of listGenerations({ client: slug, project: p })) {
    const f = path.join(t.ws, 'clients', slug, 'projects', p, '_records', 'generations', `${g.id}.yaml`);
    fsu.writeYamlAtomic(f, { ...fsu.readYaml(f), is_test: false });
  }
  const { reviewDeckData } = await import('../core/review-deck.mjs');
  const d = reviewDeckData(slug, p, { only: ['D01', 'D02'] });
  const d01 = d.assets.find((x) => x.code === 'D01');
  assert.deepEqual(d01.versions.map((v) => v.id), [b.id]);
  assert.equal(d01.rejected, 1);
  assert.equal(d.assets.find((x) => x.code === 'D02').versions.length, 0);
});

test('review deck: concept board directions get letters, resolve refs by sha or path, and add a slide before the versions', async () => {
  const { conceptBoard, buildReviewDeck } = await import('../core/review-deck.mjs');
  const { importFile } = await import('../core/media.mjs');
  const dir = path.join(t.dir, 'board');
  fs.mkdirSync(dir, { recursive: true });
  pngFile(dir, 'ref.png');
  const sha = importFile(pngFile(t.dir, 'ref2.png')).sha;
  const board = conceptBoard(
    {
      concept_board: [
        { name: 'Bridged over the cap', idea: 'Low angle on a sand crest', refs: ['ref.png', sha, 'missing.png'], verdict: 'liked' },
        { name: 'Overhead prism', refs: [] },
        { idea: 'no name, skipped' },
      ],
    },
    dir,
  );
  assert.deepEqual(board.map((b) => b.key), ['A', 'B']);
  assert.equal(board[0].refs.length, 2); // the missing file is dropped
  assert.equal(board[0].verdict, 'liked');
  assert.equal(board[1].verdict, null);

  // An asset with only a concept board (no versions yet) still gets into the deck: cover + overview + board + placeholder slide.
  const ws = await import('../core/workspace.mjs');
  const fsu = await import('../core/fsutil.mjs');
  const slug = ws.createClient('Boardco');
  const p = ws.ensureProject(slug, 'Summer');
  const d = ws.deliverableDir(slug, p, 'B01', { title: 'Stick', create: true });
  const ddir = typeof d === 'string' ? d : d.dir;
  const yf = path.join(ddir, 'deliverable.yaml');
  fsu.writeYamlAtomic(yf, { ...(fsu.readYaml(yf, {}) ?? {}), code: 'B01', concept_board: [{ name: 'Bridged', refs: [sha] }, { name: 'Prism' }, { name: 'Upright cap' }, { name: 'Shoreline' }] });
  const built = await buildReviewDeck(slug, p);
  const b01 = built.data.assets.find((x) => x.code === 'B01');
  assert.equal(b01.board.length, 4);
  assert.equal(built.slides, 1 + 1 + 2 + 1); // two board slides (3 + 1 directions)
});

test('review deck: a project look adds a Scene guide section (scene + colours, then lettered options) before the assets', async () => {
  const { buildSections } = await import('../core/review-deck.mjs');
  const { importFile } = await import('../core/media.mjs');
  const ws = await import('../core/workspace.mjs');
  const fsu = await import('../core/fsutil.mjs');
  const slug = ws.createClient('Sceneco');
  const p = ws.ensureProject(slug, 'Beach');
  const d = ws.deliverableDir(slug, p, 'S01', { title: 'Hero', create: true });
  fsu.writeYamlAtomic(path.join(d, 'deliverable.yaml'), { code: 'S01', concept_board: [{ name: 'One' }] });
  const sha = importFile(pngFile(t.dir, 'scene.png')).sha;
  const looks = path.join(t.ws, 'clients', slug, 'projects', p, 'looks');
  fs.mkdirSync(looks, { recursive: true });
  fsu.writeYamlAtomic(path.join(looks, 'beach.yaml'), {
    name: 'Beach',
    applies_to: ['S01'],
    scene: 'Limestone cove, pale sand, emerald water.',
    rocks: { words: 'rough grey limestone', hex: '#9A958C' },
    options: [{ name: 'Andaman limestone', refs: [sha] }, { name: 'Granite coves' }, { name: 'El Nido' }, { name: 'Volcanic' }],
  });
  fsu.writeYamlAtomic(path.join(looks, 'other.yaml'), { name: 'Other', applies_to: ['X99'] });
  const { sections } = await buildSections(slug, p);
  const keys = sections.map((s) => s.key);
  assert.deepEqual(keys, ['cover', 'overview', 'scene:looks/beach.yaml', 'asset:S01']); // a look for no asset in the deck is left out
  assert.equal(sections[2].slides.length, 1 + 2); // the scene, then options 3 + 1
});

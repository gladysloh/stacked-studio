import assert from 'node:assert/strict';
import test from 'node:test';
import { pngFile, tempStudio } from './helpers.mjs';

const t = tempStudio();

test('product images get their name, shape and exact label spelled out in the prompt and recorded', async () => {
  const ws = await import('../core/workspace.mjs');
  const { addProduct } = await import('../core/products.mjs');
  const { runOp } = await import('../core/ops.mjs');
  const slug = ws.createClient('Shapeco');
  await addProduct(slug, { name: 'Night Jar', label_text: 'SHAPECO / NIGHT JAR', shape: 'a squat amber glass jar with a flat gold lid', image: { path: pngFile(t.dir, 'jar.png') } });
  const { listProducts } = await import('../core/products.mjs');
  const p = listProducts(slug)[0];
  assert.equal(p.shape, 'a squat amber glass jar with a flat gold lid');
  const img = await runOp('image_generate', { prompt: 'jar on marble', client: slug, project: 'Spring', inputs: [{ sha: p.cutouts[0].sha, role: 'product' }] });
  const { requireGeneration } = await import('../core/records.mjs');
  const rec = requireGeneration(img.id);
  // One product: name and label only; the photo carries the shape.
  assert.match(rec.product_identity, /Reference image 1 is Night Jar\. /);
  assert.doesNotMatch(rec.product_identity, /amber glass jar/);
  assert.match(rec.product_identity, /reads exactly, top to bottom, line by line: SHAPECO \/ NIGHT JAR/);
  assert.equal(rec.prompt, 'jar on marble'); // the person's prompt is stored as written
});

test('a project look pins colours for the assets it lists: added to the prompt and recorded', async () => {
  const ws = await import('../core/workspace.mjs');
  const { runOp } = await import('../core/ops.mjs');
  const fsu = await import('../core/fsutil.mjs');
  const path = await import('node:path');
  const slug = ws.createClient('Lookco');
  const p = ws.ensureProject(slug, 'Summer');
  fsu.writeYamlAtomic(path.join(ws.projectDir(slug, p), 'looks', 'sea.yaml'), { name: 'Sea look', applies_to: ['S01'], sky: { words: 'light blue', hex: '#A3CEE7' }, sea: { words: 'turquoise', hex: '#7DBCCD' } });
  const { requireGeneration } = await import('../core/records.mjs');
  const inLook = requireGeneration((await runOp('image_generate', { prompt: 'x', client: slug, project: 'Summer', deliverable: 'S01' })).id);
  assert.equal(inLook.look_used.name, 'Sea look');
  const { lookForCode, lookPromptBlock, lookSwatches } = await import('../core/looks.mjs');
  const l = lookForCode(slug, p, 's01');
  assert.match(lookPromptBlock(l), /Sky: light blue \(colour #A3CEE7\)\./);
  assert.match(lookPromptBlock(l), /never print them/);
  assert.deepEqual(lookSwatches(l).map((x) => x.hex), ['#A3CEE7', '#7DBCCD']);
  const withSand = { ...l, sand: { words: 'sand', hex: '#E0C8A7', only: ['S03'] } };
  assert.doesNotMatch(lookPromptBlock(withSand, 'S01'), /Sand/);
  assert.match(lookPromptBlock(withSand, 'S03'), /Sand: sand/);
  const other = requireGeneration((await runOp('image_generate', { prompt: 'y', client: slug, project: 'Summer', deliverable: 'S02' })).id);
  assert.equal(other.look_used, undefined);
});

test('a product size is always given, even for one product', async () => {
  const ws = await import('../core/workspace.mjs');
  const { addProduct, listProducts } = await import('../core/products.mjs');
  const { runOp } = await import('../core/ops.mjs');
  const { requireGeneration } = await import('../core/records.mjs');
  const slug = ws.createClient('Sizeco');
  await addProduct(slug, { name: 'Mini Can', label_text: 'SIZECO / MINI', shape: 'a slim gold can', size: 'a 60 g travel can, about the length of a hand', image: { path: pngFile(t.dir, 'can.png') } });
  const p = listProducts(slug)[0];
  assert.equal(p.size, 'a 60 g travel can, about the length of a hand');
  const rec = requireGeneration((await runOp('image_generate', { prompt: 'can on sand', client: slug, project: 'Spring', inputs: [{ sha: p.cutouts[0].sha, role: 'product' }] })).id);
  assert.match(rec.product_identity, /Real size: a 60 g travel can, about the length of a hand\./);
  assert.doesNotMatch(rec.product_identity, /slim gold can/); // still no shape for one product
});

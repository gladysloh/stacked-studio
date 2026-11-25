#!/usr/bin/env node
// Builds a sample review deck with made-up content: one of every slide type, drawn by the same code
// as real decks, so the reference can't drift from what the studio makes.
// Usage: node scripts/review-deck-sample.mjs [out.pptx]   (default docs/review-deck/sample.pptx)
// Runs in a throwaway workspace with free test images: no keys, no Google, no client data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] ?? path.join(repo, 'docs', 'review-deck', 'sample.pptx'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stacked-sample-'));
Object.assign(process.env, {
  STACKED_WORKSPACE: path.join(tmp, 'ws'),
  STACKED_USER_HOME: path.join(tmp, 'user'),
  STACKED_KEYCHAIN: 'file',
  STACKED_AUTHOR: 'sample',
  GEMINI_API_KEY: '',
  FAL_KEY: '',
});
fs.mkdirSync(process.env.STACKED_WORKSPACE, { recursive: true });

const ws = await import('../core/workspace.mjs');
const fsu = await import('../core/fsutil.mjs');
const { runOp } = await import('../core/ops.mjs');
const { listGenerations } = await import('../core/records.mjs');
const { buildSections, loadImages } = await import('../core/review-deck.mjs');
const { buildPptx } = await import('../core/pptx-write.mjs');

const client = ws.createClient('Sample Brand');
const project = ws.ensureProject(client, 'Summer Launch');
const projDir = path.join(process.env.STACKED_WORKSPACE, 'clients', client, 'projects', project);
const deliv = (code, title, meta) => {
  const dir = ws.deliverableDir(client, project, code, { title, create: true });
  const f = path.join(dir, 'deliverable.yaml');
  fsu.writeYamlAtomic(f, { ...(fsu.readYaml(f, {}) ?? {}), code, section: 'Summer series', ...meta });
  return f;
};
const gen = (code, instruction, n = 1) => runOp('image_generate', { prompt: `${code} ${instruction}`, n, client, project, deliverable: code, instruction: `${code} ${instruction}` });
const end = (id) => id.slice(-6);

// SB001: the full view (no shortlist): concept board, then versions grouped by direction, with changes requested.
const a1 = await gen('SB001', 'Option 1 (warm sand): bottle half buried in warm sand');
const a2 = await gen('SB001', 'Option 2 (water splash): bottle in a splash of sea water', 2);
const conceptRef = listGenerations({ client, project }).find((g) => g.id === a1.id).outputs[0].sha;
deliv('SB001', 'Hero bottle', {
  concept_board: [
    { name: 'Half buried in sand', idea: 'Low angle, the bottle half in warm sand, long shadow to the right.', refs: [conceptRef], verdict: 'liked' },
    { name: 'Water splash', idea: 'The bottle in a crown of clear sea water, sun top left.', verdict: 'maybe' },
    { name: 'On a towel', idea: 'Top-down on a striped towel with sunglasses.', verdict: 'not_for_us' },
  ],
  review_groups: [
    { name: 'Warm sand', versions: [end(a1.id)] },
    { name: 'Water splash', versions: [end(a2.id)] },
  ],
  review_notes: [
    { date: '2026-01-12', change: 'Make the sand warmer and finer', from: 'Alex' },
    { date: '2026-01-12', change: 'Keep the label facing the camera', from: 'Sam' },
    { date: '2026-01-08', change: 'Shadow too hard: soften it', from: 'Alex', done: true },
  ],
});

// SB002: the shortlist view: one slide per selected image with its comments as points, then before / after.
const b1 = await gen('SB002', 'Option 1: grey rocks, open sea');
const b2 = await gen('SB002', 'Option 2: warm brown rocks', 2);
deliv('SB002', 'Rock scene', {
  selected: [
    { version: `${end(b1.id)}:0`, notes: ['Make the rocks warm brown.', 'Keep the product placement the same.'] },
    { version: `${end(b2.id)}:1`, title: 'Second option', notes: ['Keep this as the second option.'] },
  ],
  compare: [
    {
      name: 'Rock colour: before and after',
      note: 'The preferred version, then the new options. Under each option is what changed.',
      before: `${b1.id}:0`,
      after: [`${b2.id}:0`, `${b2.id}:1`],
      edits: { [`${b2.id}:0`]: ['Warm golden-brown rocks'], [`${b2.id}:1`]: ['Warm golden-brown rocks', 'Stronger sun from the top right'] },
    },
  ],
});

// A project look: the chosen scene slide for the whole group, with colour swatches.
fs.mkdirSync(path.join(projDir, 'looks'), { recursive: true });
fsu.writeYamlAtomic(path.join(projDir, 'looks', 'beach.yaml'), {
  name: 'Beach',
  applies_to: ['SB001', 'SB002'],
  scene_name: 'Warm limestone cove',
  scene: 'A quiet cove with warm brown limestone, fine pale sand and clear turquoise water.',
  scene_keywords: 'warm brown limestone, fine pale sand, clear turquoise sea',
  scene_images: [conceptRef],
  light: 'Bright sun from the upper left, soft medium shadows.',
  sky: { words: 'clear blue, lighter at the horizon', hex: '#8BBDE0' },
  sea: { words: 'clear turquoise', hex: '#6FB6C7' },
  sand: { words: 'fine pale sand', hex: '#E0C8A7' },
  rocks: { words: 'warm brown limestone', hex: '#8C6030' },
});

// Test images are hidden from decks by default; these stand in for real ones.
for (const g of listGenerations({ client, project })) {
  const f = path.join(projDir, '_records', 'generations', `${g.id}.yaml`);
  fsu.writeYamlAtomic(f, { ...fsu.readYaml(f), is_test: false });
}

const full = await buildSections(client, project, {});
const picks = await buildSections(client, project, { only: ['SB002'], shortlist: { SB002: [`${b1.id}:0`, `${b2.id}:1`] } });
// The full view for SB001, the shortlist view for SB002.
const slides = [...full.sections.filter((s) => s.key !== 'asset:SB002'), ...picks.sections.filter((s) => s.key === 'asset:SB002')].flatMap((s) => s.slides);
await loadImages(slides);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, buildPptx({ slides, title: 'Sample review deck', width: 9144000, height: 5143500 }));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${slides.length} slides → ${path.relative(process.cwd(), out)}`);

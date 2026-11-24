import { sha256 } from '../fsutil.mjs';
import { makePng } from '../png.mjs';

// The test provider: makes a placeholder gradient from the prompt, offline and free.
// Used until a key is added, by `studio doctor`, and in tests.

export const id = 'test';
export const label = 'Test images (free)';
export const keyService = null;
export const kinds = ['image', 'upscale', 'embed'];
export const MODELS = { 'test-gradient-1': { label: 'Test gradient' } };
export const DEFAULT_MODEL = 'test-gradient-1';
export const estimate = () => 0;

function gradient(seedText, width, height) {
  const seed = Buffer.from(sha256(seedText), 'hex');
  const a = [seed[0], seed[1], seed[2]];
  const b = [seed[3], seed[4], seed[5]];
  return makePng(width, height, (x, y) => {
    const t = (x / width + y / height) / 2;
    return a.map((c, i) => Math.round(c + (b[i] - c) * t));
  });
}

export async function image({ prompt, n = 1, references = [] }) {
  const refKey = references.map((r) => sha256(r.data)).join(',');
  const images = Array.from({ length: n }, (_, v) => ({ data: gradient(`${prompt}\n${refKey}\n${v}`, 256, 320), mime: 'image/png' }));
  return { images, failures: [], cost_usd: 0 };
}

export async function upscale({ source, factor = 2 }) {
  return { images: [{ data: gradient(`upscale:${sha256(source.data)}`, 256 * factor, 320 * factor), mime: 'image/png' }], failures: [], cost_usd: 0 };
}

/** Deterministic bag-of-words vectors, so search tests work offline. */
export async function embed({ texts, dims = 64 }) {
  return texts.map((t) => {
    const v = new Array(dims).fill(0);
    for (const w of String(t).toLowerCase().match(/[a-z0-9]+/g) ?? []) v[parseInt(sha256(w).slice(0, 6), 16) % dims] += 1;
    return v;
  });
}

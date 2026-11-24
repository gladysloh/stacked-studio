import fs from 'node:fs';
import path from 'node:path';
import { StudioError } from './errors.mjs';
import { mediaPath } from './media.mjs';
import { addReview, requireGeneration, reviewsFor } from './records.mjs';
import { layout, SCRATCH } from './workspace.mjs';

// Quality checks. Two kinds:
//   basics  — measured, no AI: format and resolution against what was asked, palette vs brand colours.
//   review  — the agent's judgement with the creative-qa rubric, saved as a structured "check".
// Neither approves or rejects: that stays with the person.

export const RUBRIC = 'image-v2';
export const AREAS = ['messaging', 'brief_alignment', 'visual_execution', 'technical', 'brand_alignment'];
const WEIGHTS = { messaging: 0.3, brief_alignment: 0.25, visual_execution: 0.25, brand_alignment: 0.15, technical: 0.05 };

const ratio = (a) => {
  const [w, h] = String(a).split(':').map(Number);
  return w && h ? w / h : null;
};
const SIZE_PX = { '1K': 1000, '2K': 2000, '4K': 4000 };

/** Hex colours written in brand.md (e.g. "#C8862B"). */
export function brandPalette(client) {
  if (client === SCRATCH) return [];
  const f = layout.brand(client);
  if (!fs.existsSync(f)) return [];
  return [...new Set((fs.readFileSync(f, 'utf8').match(/#[0-9A-Fa-f]{6}\b/g) ?? []).map((x) => x.toUpperCase()))];
}

// sRGB hex → CIELAB, for perceptual colour distance (ΔE76: <10 close, >25 clearly different).
function lab(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92));
  const [x, y, z] = [
    (c[0] * 0.4124 + c[1] * 0.3576 + c[2] * 0.1805) / 0.95047,
    c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722,
    (c[0] * 0.0193 + c[1] * 0.1192 + c[2] * 0.9505) / 1.08883,
  ].map((v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116));
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

/** Measured checks. Palette needs the optional media tools; without them it's skipped and said so. */
export async function basics({ id, output = 0, aspect, min_px }) {
  const g = requireGeneration(id);
  const o = g.outputs?.[output];
  if (!o) throw new StudioError(`That image has ${g.outputs?.length ?? 0} outputs.`);
  const checks = [];
  const want = aspect ?? g.params?.aspect;
  if (o.width && o.height && want) {
    const off = Math.abs(o.width / o.height - ratio(want)) / ratio(want);
    checks.push({ check: 'format', ok: off < 0.02, detail: `${o.width}×${o.height} (${(o.width / o.height).toFixed(3)}) vs ${want} (${ratio(want).toFixed(3)})` });
  }
  const minPx = min_px ?? SIZE_PX[g.params?.size] ?? null;
  if (o.width && o.height && minPx) {
    const long = Math.max(o.width, o.height);
    checks.push({ check: 'resolution', ok: long >= minPx * 0.9, detail: `long edge ${long}px, wanted about ${minPx}px` });
  }
  const brand = brandPalette(g.client);
  let palette = null;
  const { pyReady, runMedia } = await import('./py.mjs');
  if (pyReady() && mediaPath(o.sha)) {
    palette = (await runMedia('palette', { sha: o.sha, colors: 6 })).colors;
    if (brand.length) {
      // How much of the image sits near some brand colour.
      const near = palette.filter((p) => Math.min(...brand.map((b) => deltaE(p.hex, b))) < 20).reduce((s, p) => s + p.share, 0);
      checks.push({ check: 'brand_palette', ok: near >= 0.4, detail: `${Math.round(near * 100)}% of the image is close to a brand colour (${brand.join(', ')})` });
    }
  } else if (brand.length) checks.push({ check: 'brand_palette', ok: null, detail: 'skipped: install the media tools to compare colours (./setup.sh --with-media)' });
  return { id, output, checks, palette, brand_palette: brand, passed: checks.every((c) => c.ok !== false) };
}

/** The verdict rule from the creative-qa skill, applied in code so it means the same every time. */
export function verdictFor(scores) {
  const scored = Object.entries(scores).filter(([k, v]) => WEIGHTS[k] && v && typeof v.score === 'number');
  if (!scored.length) return { overall: null, verdict: 'cant_check' };
  const w = scored.reduce((s, [k]) => s + WEIGHTS[k], 0);
  let overall = Math.round((scored.reduce((s, [k, v]) => s + v.score * WEIGHTS[k], 0) / w) * 10) / 10;
  const critical = Object.values(scores).some((v) => v?.severity === 'critical');
  if (critical) overall = Math.min(overall, 2);
  const meets = overall >= 4 && scored.every(([, v]) => v.score >= 3) && !critical;
  return { overall, verdict: meets ? 'meets_brief' : 'needs_changes' };
}

/** Saves an agent's creative-qa result as a "check" in the image's review log. */
export function recordCheck({ id, output = 0, scores = {}, labels = [], suggestions = [], summary = null, aesthetic = null }) {
  requireGeneration(id);
  for (const k of Object.keys(scores)) if (!AREAS.includes(k)) throw new StudioError(`Unknown area "${k}". Use: ${AREAS.join(', ')}.`);
  const { overall, verdict } = verdictFor(scores);
  const value = { rubric: RUBRIC, verdict, overall, scores, labels, suggestions: suggestions.slice(0, 3), aesthetic };
  const e = addReview({ target: id, output, action: 'check', value, note: summary });
  return { id, output, check: e.id, verdict, overall, labels_wrong: labels.filter((l) => l.ok === false).length };
}

export function checksFor(g, output = 0) {
  return reviewsFor(g.client, g.project).filter((e) => e.target === g.id && (e.output ?? 0) === output && (e.action === 'check' || (e.action === 'comment' && e.value?.check)));
}

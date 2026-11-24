import fs from 'node:fs';
import path from 'node:path';
import { StudioError } from './errors.mjs';
import { ASPECTS } from './providers/gemini.mjs';
import { repoRoot } from './paths.mjs';
import { requireGeneration } from './records.mjs';

// Format planning: from one key visual to a set of sizes. For each size it gives the exact pixels,
// the safe box (where product, logo and copy must stay), the layout archetype, and the cheapest way
// to get there: use as is, crop, recompose with the image model, or lay out in Figma.

const REF = path.join(repoRoot, 'skills', 'format-adaptation', 'references');
const load = (f) => JSON.parse(fs.readFileSync(path.join(REF, f), 'utf8'));

const ratio = (a) => {
  const [w, h] = String(a).split(':').map(Number);
  return w / h;
};

export function parseFormat(f) {
  const zones = load('safe-zones.json');
  if (typeof f === 'object' && f.w && f.h) return { name: f.name ?? `${f.w}x${f.h}`, w: f.w, h: f.h };
  const s = String(f).trim();
  const m = s.match(/^(\d{2,5})\s*[x×]\s*(\d{2,5})$/i);
  if (m) return { name: s, w: Number(m[1]), h: Number(m[2]) };
  const key = zones.aliases?.[s.toUpperCase()] ?? s.toUpperCase().replace(/[\s-]+/g, '_');
  const z = zones.sizes?.[key];
  if (!z) throw new StudioError(`Unknown format "${s}". Use WIDTHxHEIGHT (e.g. 1080x1920) or one of: ${Object.keys(zones.sizes ?? {}).join(', ')}.`);
  return { name: key, w: z.w, h: z.h };
}

function safeBox(fmt) {
  const zones = load('safe-zones.json');
  const z = zones.sizes?.[fmt.name];
  let m;
  if (z && z.w === fmt.w && z.h === fmt.h) m = { l: z.l, r: z.r, t: z.t, b: z.b };
  else {
    const d = zones._default;
    const short = Math.min(fmt.w, fmt.h);
    m = Object.fromEntries(['l', 'r', 't', 'b'].map((k) => [k, Math.round((short * d[k]) / 100)]));
  }
  return { margins: m, rect: { x: m.l, y: m.t, w: fmt.w - m.l - m.r, h: fmt.h - m.t - m.b } };
}

function archetype(fmt) {
  const ar = fmt.w / fmt.h;
  const short = Math.min(fmt.w, fmt.h);
  return load('archetypes.json').classes.find((c) => ar >= c.ar_min && ar < c.ar_max && (!c.max_short_edge || short <= c.max_short_edge))?.archetype ?? 'hero-faithful';
}

const nearestAspect = (ar) => ASPECTS.reduce((best, a) => (Math.abs(Math.log(ratio(a) / ar)) < Math.abs(Math.log(ratio(best) / ar)) ? a : best), ASPECTS[0]);

/** Centre crop of src (w×h) to the target ratio. */
function crop(srcW, srcH, ar) {
  if (srcW / srcH > ar) {
    const w = Math.round(srcH * ar);
    return { x: Math.round((srcW - w) / 2), y: 0, w, h: srcH };
  }
  const h = Math.round(srcW / ar);
  return { x: 0, y: Math.round((srcH - h) / 2), w: srcW, h };
}

export function planAdapts({ formats, id = null, output = 0 }) {
  if (!formats?.length) throw new StudioError('Which formats? e.g. ["INSTAGRAM_STORY", "1080x1080", "728x90"].');
  let src = null;
  if (id) {
    const g = requireGeneration(id);
    const o = g.outputs?.[output];
    if (!o?.width) throw new StudioError("The source image's size isn't recorded.");
    src = { id, output, w: o.width, h: o.height, ar: o.width / o.height };
  }
  const plans = formats.map((f) => {
    const fmt = parseFormat(f);
    const ar = fmt.w / fmt.h;
    const arche = archetype(fmt);
    const plan = { format: fmt.name, w: fmt.w, h: fmt.h, ratio: Number(ar.toFixed(3)), archetype: arche, safe: safeBox(fmt) };
    const model = nearestAspect(ar);
    if (arche === 'single-strip' || ar > 3.5 || ar < 0.3) {
      plan.action = 'layout';
      plan.how = 'Too extreme for the image model: lay it out in Figma — background extended or a solid/gradient from the KV palette, product cut out and placed inside the safe box, copy and logo in the safe box.';
    } else if (src && Math.abs(Math.log(src.ar / ar)) < 0.03) {
      plan.action = 'resize';
      plan.how = `Same shape as the source: resize to ${fmt.w}×${fmt.h}.`;
    } else if (src && Math.abs(Math.log(src.ar / ar)) < 0.2) {
      plan.action = 'crop';
      plan.crop = crop(src.w, src.h, ar);
      plan.how = `Crop ${plan.crop.w}×${plan.crop.h} from the centre, then resize; check the product stays inside the safe box.`;
    } else {
      plan.action = 'recompose';
      plan.model_aspect = model;
      plan.how = `image_edit mode "branch" from the source with aspect ${model}: extend the scene, keep the product's size and the light; then crop to ${fmt.w}×${fmt.h}.`;
      plan.prompt_hint = `Recompose this exact scene for a ${model} frame: extend the background naturally${ar < (src?.ar ?? 1) ? ' above and below' : ' left and right'}; keep the product identical in size, angle, label and lighting; keep the product within the central ${Math.round((plan.safe.rect.w / fmt.w) * 100)}% × ${Math.round((plan.safe.rect.h / fmt.h) * 100)}% of the frame.`;
    }
    return plan;
  });
  const summary = plans.reduce((s, p) => ((s[p.action] = (s[p.action] ?? 0) + 1), s), {});
  return { source: src, plans, summary };
}

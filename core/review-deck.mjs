import fs from 'node:fs';
import path from 'node:path';
import { StudioError } from './errors.mjs';
import { readJsonl, readYaml, writeYamlAtomic } from './fsutil.mjs';
import { imageSize } from './imagesize.mjs';
import { importFile, mediaPath, readMedia } from './media.mjs';
import { listLooks, lookForCode, lookSwatches } from './looks.mjs';
import { buildPptx, emu } from './pptx-write.mjs';
import { listGenerations, withReview } from './records.mjs';
import { clientDir, layout, listDeliverables, readClient } from './workspace.mjs';

// The review deck: one slide per asset showing the current deck visual and every studio version in
// order, with what changed, when, the model and the status, next to the brief and the open comments.
// Plain template (white, one typeface, hairlines). Built as sections (cover, overview, one per asset).
// The Google Slides file in the project's 04_Review Decks folder is updated in place: only sections
// that changed are redrawn (review-deck-live.mjs), so comments and hand-made slides survive. A .pptx
// of the whole deck can still be built (buildReviewDeck) and written over the file (rebuild).

const W = 9144000; // 10 in × 5.625 in, the Google Slides default 16:9
const H = 5143500;
const FONT = 'Nunito Sans';
const INK = '1A1A1A';
const GREY = '6B6B6B';
const LINE = 'E3E3E3';
const STATUS = {
  new: { label: 'Needs review', ink: '8A5A12', fill: 'FBF1DE' },
  approved: { label: 'Approved', ink: '2F6B45', fill: 'E3F1E8' },
  rejected: { label: 'Rejected', ink: '9B3A32', fill: 'F7E2DF' },
  deck: { label: 'In working deck', ink: '4A4A4A', fill: 'EFEFEF' },
  todo: { label: 'To do', ink: '4A4A4A', fill: 'EFEFEF' },
};
const MODEL = { 'gemini-3-pro-image': 'Nano Banana Pro', 'gemini-3.1-flash-image': 'Nano Banana 2' };
const MAX_PER_SLIDE = 4;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : t;
};

/** Sections of a deliverable brief.md: { product, key message, description, … }. */
function briefSections(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  let cur = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^## (.+)/);
    if (m) cur = m[1].trim().toLowerCase();
    else if (cur && line.trim()) out[cur] = out[cur] ? `${out[cur]}\n${line.trim()}` : line.trim();
  }
  return out;
}

/**
 * The creative idea for a code from the working deck (the source of truth): the long paragraphs on the
 * latest slide carrying that code. Labels, lighting bullets and supers are short lines, so they drop out.
 */
/** Product and key message as written on the asset's latest slide in the working deck. */
function fieldsFromDeck(deckDir, code) {
  if (!deckDir) return {};
  const n = (readYaml(path.join(deckDir, 'deck.yaml'), {})?.slides ?? []).filter((x) => String(x.code ?? '').toLowerCase() === code.toLowerCase()).map((x) => x.n).at(-1);
  if (!n) return {};
  const md = fs.existsSync(path.join(deckDir, 'slides.md')) ? fs.readFileSync(path.join(deckDir, 'slides.md'), 'utf8') : '';
  const body = md.split(/^## Slide /m).find((b) => b.startsWith(`${n} `) || b.startsWith(`${n}\n`)) ?? '';
  const get = (re) => body.match(re)?.[1]?.replace(/\u000b/g, ', ').replace(/,\s*([-–])/g, ' $1').replace(/,\s*$/, '').replace(/([a-z])([A-Z])/g, '$1, $2').trim() || null;
  return { product: get(/^Product:\s*(.+)$/im), key_message: get(/^Key Messag(?:ing|e):\s*(.+)$/im), slide: n };
}

function ideaFromDeck(deckDir, code) {
  if (!deckDir) return null;
  const slides = (readYaml(path.join(deckDir, 'deck.yaml'), {})?.slides ?? []).filter((x) => String(x.code ?? '').toLowerCase() === code.toLowerCase());
  const md = fs.existsSync(path.join(deckDir, 'slides.md')) ? fs.readFileSync(path.join(deckDir, 'slides.md'), 'utf8') : '';
  for (const sl of slides.reverse()) {
    const body = md.split(/^## Slide /m).find((b) => b.startsWith(`${sl.n} `) || b.startsWith(`${sl.n}\n`));
    const long = (body ?? '').split('\n').map((l) => l.trim()).filter((l) => l.length > 120 && !/^Speaker notes:/.test(l));
    if (long.length) return long.join(' ');
  }
  return null;
}

const cleanCode = (s, code) => String(s ?? '').replace(new RegExp(`\\b${code}\\b`, 'gi'), '').replace(/\s+/g, ' ').trim() || null;
const noMentions = (s) => String(s ?? '').replace(/\+?@[\w.-]+(@[\w.-]+)?/g, '').replace(/\s+/g, ' ').trim();

/**
 * What needs to change for an asset. Prefer the agent-written summary in deliverable.yaml
 * (review_notes: [{ date, change, from?, done? }]) grouped by date, newest first; otherwise the raw
 * open comments.
 */
export function changesFor(meta, comments) {
  const notes = (meta?.review_notes ?? []).filter((n) => n?.change);
  if (notes.length) {
    const groups = new Map();
    for (const n of notes) {
      const d = String(n.date ?? '').slice(0, 10);
      if (!groups.has(d)) groups.set(d, []);
      groups.get(d).push({ change: n.change, from: n.from ?? null, done: Boolean(n.done) });
    }
    return { kind: 'summary', groups: [...groups].sort((a, b) => b[0].localeCompare(a[0])).map(([date, items]) => ({ date, items })) };
  }
  return { kind: 'comments', comments };
}

/**
 * A version's short label and note, from what the person asked for:
 * "APS003 Option 1 (slide 15 comments): rocks more realistic…" → "Option 1", "rocks more realistic…".
 */
export function versionLabel(g) {
  const ins = String(g.instruction ?? '').replace(/^[A-Z]{2,4}\d{2,4}\s+/, '').replace(/^·\s*/, '');
  const m = ins.match(/^([^():]{1,40}?)\s*(?:\(([^)]*)\))?\s*:\s*(.+)$/s);
  const label = m ? m[1].trim() : `Version ${g.version}`;
  const note = g.what_changed ?? (m ? m[3] : ins);
  const src = m?.[2] ?? null;
  // "(dark limestone)" describes the version; "(slide 15 comments)" only says where the request came from.
  const what = src && !/comment|slide|feedback|client/i.test(src) ? src : null;
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  return { label: cap(g.what_changed && !m ? `Version ${g.version}` : what ? `${label} · ${what}` : label), note: clip(note, 150), source: src };
}

const VERDICT = {
  liked: { label: 'Liked', ink: '2F6B45', fill: 'E3F1E8' },
  not_for_us: { label: 'Not for us', ink: '9B3A32', fill: 'F7E2DF' },
  maybe: { label: 'Maybe', ink: '8A5A12', fill: 'FBF1DE' },
};

function boardRef(ref, dir) {
  try {
    if (/^[0-9a-f]{64}$/.test(String(ref))) {
      const m = readMedia(ref);
      return m ? { sha: ref, ...imageSize(m.data) } : null;
    }
    const f = importFile(path.isAbsolute(ref) ? ref : path.join(dir, ref));
    return { sha: f.sha, width: f.width, height: f.height };
  } catch {
    return null;
  }
}

/**
 * Concept directions to agree on before generating, from deliverable.yaml:
 *   concept_board: [{ name, idea, refs: [<sha> | <image path, relative to the deliverable folder>], verdict? }]
 * Shown as "Concept board" slide(s) ahead of the asset's versions, each direction tagged A, B, C… so the
 * team can answer in Slides comments. verdict (liked | maybe | not_for_us) records what they said.
 */
export function conceptBoard(meta, dir) {
  const list = Array.isArray(meta?.concept_board) ? meta.concept_board : (meta?.concept_board?.directions ?? []);
  return list
    .filter((x) => x?.name)
    .map((x, i) => ({
      key: String(x.key ?? String.fromCharCode(65 + i)),
      name: String(x.name),
      idea: x.idea ? String(x.idea) : '',
      verdict: VERDICT[x.verdict] ? x.verdict : null,
      refs: (Array.isArray(x.refs) ? x.refs : []).slice(0, 3).map((r) => boardRef(r, dir)).filter(Boolean),
      // Optional: images made from the written idea (shown under the references) and the prompt keywords, highlighted.
      samples: (Array.isArray(x.samples) ? x.samples : []).slice(0, 3).map((r) => boardRef(r, dir)).filter(Boolean),
      keywords: (Array.isArray(x.keywords) ? x.keywords : []).map(String).filter(Boolean),
    }));
}

/** Everything the deck shows, read from the client folder. */
export function reviewDeckData(client, project, { only, showRejected = false, shortlist = null } = {}) {
  const c = readClient(client);
  const proj = readYaml(path.join(clientDir(client), 'projects', project, 'project.yaml'), {}) ?? {};
  const deckDir = proj.deck ? path.join(layout.decks(client), proj.deck) : null;
  const comments = deckDir ? readJsonl(path.join(deckDir, 'comments.jsonl')) : [];
  const gens = listGenerations({ client, project, limit: 100_000, includeTests: false })
    .filter((g) => g.status === 'done' && g.deliverable)
    .sort((a, b) => String(a.created).localeCompare(String(b.created)));
  const assets = [];
  for (const d of listDeliverables(client, project)) {
    if (only && !only.map((x) => x.toLowerCase()).includes(d.code.toLowerCase())) continue;
    const mine = gens.filter((g) => String(g.deliverable).toLowerCase() === d.code.toLowerCase());
    const meta = readYaml(path.join(d.dir, 'deliverable.yaml'), {}) ?? {};
    const board = conceptBoard(meta, d.dir);
    // A chosen list (`only`) shows every asset in it, generated or not; otherwise only assets with versions or a concept board.
    if (!mine.length && !board.length && !only) continue;
    const brief = briefSections(path.join(d.dir, 'brief.md'));
    const visual = (meta.files ?? []).filter((f) => f.role === 'visual' && !f.blank).at(-1);
    const versions = [];
    let rejected = 0;
    for (const g0 of mine) {
      const g = withReview(g0);
      g.outputs.forEach((o, i) => {
        // Rejected versions leave the deck (they stay in history and in 02_Rejected on Drive).
        if (o.status === 'rejected' && !showRejected) {
          rejected++;
          return;
        }
        const { label, note } = versionLabel(g);
        versions.push({
          id: g.id,
          output: i,
          sha: o.sha,
          width: o.width,
          height: o.height,
          label: g.outputs.length > 1 ? `${label} · ${i + 1}` : label,
          note,
          date: day(g.created),
          model: [MODEL[g.model] ?? g.model, g.params?.size ?? g.size].filter(Boolean).join(' '),
          status: o.status ?? 'new',
          drive_id: o.drive_id ?? null,
        });
      });
    }
    // A shortlist ({ <code>: ["<version id>:<output>", …] }) shows only those versions of the asset.
    const pick = shortlist?.[d.code] ?? shortlist?.[d.code.toUpperCase()];
    if (pick) {
      const keep = new Set(pick.map(String));
      for (let i = versions.length - 1; i >= 0; i--) if (!keep.has(`${versions[i].id}:${versions[i].output}`)) versions.splice(i, 1);
    }
    const open = comments.filter((x) => !x.resolved && String(x.asset_code ?? '').toLowerCase() === d.code.toLowerCase());
    // Before / after slides: deliverable.yaml compare: [{ name?, before: "<id>:<out>", after: ["<id>:<out>", …], note? }]
    const findOut = (ref) => {
      const [id, out = '0'] = String(ref).split(':');
      const g = mine.find((x) => x.id === id || x.id.endsWith(id));
      const o = g ? withReview(g).outputs[Number(out)] : null;
      return o && mediaPath(o.sha) ? { sha: o.sha, width: o.width, height: o.height, label: `${g.id.slice(-6)}${g.outputs.length > 1 ? ` · ${Number(out) + 1}` : ''}`, status: o.status, date: day(g.created), model: [MODEL[g.model] ?? g.model, g.params?.size].filter(Boolean).join(' '), note: g.instruction ?? null } : null;
    };
    const compares = (meta.compare ?? [])
      .map((c) => ({ name: c.name ?? 'Before and after', note: c.note ?? null, before: findOut(c.before), after: (Array.isArray(c.after) ? c.after : [c.after]).map((r) => { const o = findOut(r); return o && { ...o, edits: c.edits?.[r] ?? null }; }).filter(Boolean) }))
      .filter((c) => c.before && c.after.length);
    // Selected versions (shortlist) get one slide each: the image, then short comments in plain words.
    // deliverable.yaml selected: [{ version: "<id>:<out>", title?, notes: ["…"] }]
    const notesFor = (v) => (meta.selected ?? []).find((s) => {
      const [id, out = '0'] = String(s.version ?? '').split(':');
      return id && v.id.endsWith(id) && Number(out) === v.output;
    });
    assets.push({
      shortlisted: Boolean(pick),
      selected: pick ? versions.map((v) => ({ ...v, title: notesFor(v)?.title ?? null, points: notesFor(v)?.notes ?? null })).sort((x, y) => pick.indexOf(`${x.id}:${x.output}`) - pick.indexOf(`${y.id}:${y.output}`)) : [],
      compares,
      board: pick ? [] : board, // a shortlist shows only the chosen versions
      changes_view: changesFor(meta, open),
      groups: (meta.review_groups ?? []).filter((x) => x?.name && Array.isArray(x.versions)),
      look: lookForCode(client, project, d.code),
      rejected,
      code: d.code,
      section: meta.section ?? brief.campaign ?? null,
      product: fieldsFromDeck(deckDir, d.code).product ?? brief.product ?? null,
      key_message: fieldsFromDeck(deckDir, d.code).key_message ?? cleanCode(brief['key message'], d.code),
      idea: ideaFromDeck(deckDir, d.code) ?? brief['creative idea'] ?? brief.description ?? null,
      comments: comments.filter((x) => !x.resolved && String(x.asset_code ?? '').toLowerCase() === d.code.toLowerCase()),
      current: visual?.sha && mediaPath(visual.sha) ? { sha: visual.sha, width: visual.width, height: visual.height, label: 'Current', note: visual.mockup ? 'Mock-up in the working deck (cropped from the slide)' : 'The visual in the working deck now', status: 'deck' } : null,
      versions,
    });
  }
  return { client: c.name ?? client, project: proj.name ?? project, assets };
}

// ---- slides ----

const T = (x, y, w, h, text, o = {}) => ({ type: 'text', x: emu(x), y: emu(y), w: emu(w), h: emu(h), text, font: FONT, color: INK, size: 8, ...o });
const R = (x, y, w, h, o = {}) => ({ type: 'rect', x: emu(x), y: emu(y), w: emu(w), h: emu(h), ...o });

// No page numbers: a slide only changes when its own content does. The date is when it was drawn.
function footer(meta) {
  return [R(0.35, 5.3, 9.3, 0.005, { fill: LINE }), T(0.3, 5.33, 6, 0.22, `${meta.client}  ·  ${meta.project}  ·  Review`, { size: 6, color: GREY }), T(6.7, 5.33, 3, 0.22, `Updated ${meta.updated}`, { size: 6, color: GREY, align: 'r', volatile: true })];
}

function pill(x, y, status) {
  const s = STATUS[status] ?? STATUS.new;
  return [R(x, y, 0.86, 0.17, { fill: s.fill }), T(x, y - 0.012, 0.86, 0.2, s.label, { size: 5.5, color: s.ink, bold: true, align: 'ctr', anchor: 'ctr' })];
}

// Images are references (sha); the bytes are loaded only when a slide is actually drawn.
async function imageEl(sha, x, y, w, h, _thumbs, { full = false } = {}) {
  return { type: 'image', sha, full, ext: 'jpg', x: emu(x), y: emu(y), w: emu(w), h: emu(h) };
}

/** A thumbnail (max 1400 px) for each image, or the original when the media tools aren't installed. */
export function thumbnailer() {
  const cache = new Map();
  return async (sha, { full = false } = {}) => {
    const key = `${sha}:${full}`;
    if (cache.has(key)) return cache.get(key);
    let file = mediaPath(sha);
    if (!full) {
      const { pyReady, runMedia } = await import('./py.mjs');
      if (pyReady()) {
        const t = await runMedia('thumbnail', { sha, max: 1400 });
        if (t.files?.[0]?.sha) file = mediaPath(t.files[0].sha);
      }
    }
    cache.set(key, file);
    return file;
  };
}

/**
 * deliverable.yaml review_groups: [{ name: "Water stream", versions: [<id or id ending>] }] gives each
 * direction its own slide(s), each starting with the current deck visual. Versions in no group go on
 * a final "Other versions" slide.
 */
/**
 * Before / after: the preferred (earlier) version large on the left, uncropped; the new options in a
 * grid beside it, wrapping into rows as more are added.
 */
async function compareSlide(a, c, meta) {
  const el = assetHeader(a, c.name);
  el.push(T(0.3, 0.84, 9.4, 0.22, c.note ?? 'The preferred version, then the new options beside it.', { size: 6.5, color: GREY }));
  const ar = (it) => (it.width && it.height ? it.width / it.height : 0.8);
  const top = 1.15;
  const bottom = 5.2;
  const caption = (it, title, x, y, w, small) => {
    el.push(T(x - 0.04, y, Math.max(w, 1.3) + 0.08, 0.2, `${title}  ·  ${it.label}`, { size: small ? 6.5 : 8, bold: true }));
    el.push(...pill(x, y + 0.22, it.status));
    if (it.date || it.model) el.push(T(x + 0.9, y + 0.195, Math.max(w - 0.9, 0.8), 0.2, [it.date, it.model].filter(Boolean).join(' · '), { size: 5.5, color: GREY }));
  };
  // Preferred, large on the left.
  const capH = 0.5;
  const ph = bottom - top - capH;
  const pw = ph * ar(c.before);
  const px = 0.35;
  el.push(await imageEl(c.before.sha, px, top, pw, ph, null));
  caption(c.before, 'Preferred', px, top + ph + 0.06, pw, false);
  el.push(R(px + pw + 0.25, top, 0.005, bottom - top, { fill: LINE }));
  // Options grid on the right: pick the column count that gives the largest images.
  const gx = px + pw + 0.45;
  const gw = 9.65 - gx;
  const gh = bottom - top;
  const n = c.after.length;
  const gap = 0.2;
  // Title and pill, then what was changed: one short point per line (compare edits), or the note.
  const lines = Math.max(2, ...c.after.map((it) => it.edits?.length ?? 0));
  const cellCap = 0.5 + lines * 0.13;
  let best = null;
  for (let cols = 1; cols <= Math.min(n, 4); cols++) {
    const rows = Math.ceil(n / cols);
    const wMax = (gw - gap * (cols - 1)) / cols;
    const hMax = (gh - rows * cellCap - gap * (rows - 1)) / rows;
    const h = Math.min(hMax, wMax / ar(c.after[0]), ph * 0.68); // the preferred image stays the largest
    if (h > 0 && (!best || h > best.h)) best = { cols, rows, h };
  }
  const { cols, h } = best ?? { cols: n, h: 1 };
  for (const [k, it] of c.after.entries()) {
    const w = h * ar(it);
    const x = gx + (k % cols) * ((gw - gap * (cols - 1)) / cols + gap);
    const y = top + Math.floor(k / cols) * (h + cellCap + gap);
    el.push(await imageEl(it.sha, x, y, w, h, null));
    caption(it, n > 1 ? `Option ${k + 1}` : 'Updated', x, y + h + 0.06, w, true);
    if (it.edits?.length) el.push(T(x - 0.04, y + h + 0.47, Math.max(w, 1.3) + 0.08, lines * 0.13 + 0.05, it.edits.map((e) => ({ text: `–  ${clip(e, 70)}`, size: 6 }))));
    else if (it.note) el.push(T(x - 0.04, y + h + 0.47, w + 0.08, 0.3, clip(it.note, 110), { size: 5.5, color: GREY }));
  }
  el.push(...footer(meta));
  return { background: 'FFFFFF', elements: el };
}

/** One selected version: the image large on the left, its comments as short points beside it. */
async function selectedSlide(a, v, groupName, meta) {
  const el = assetHeader(a, groupName);
  const ar = v.width && v.height ? v.width / v.height : 0.8;
  const top = 0.98;
  const h = 4.17;
  const w = Math.min(h * ar, 5.2);
  el.push(await imageEl(v.sha, 0.35, top, w, w / ar, null));
  const x = 0.35 + w + 0.45;
  const cw = 9.65 - x;
  el.push(T(x - 0.04, top - 0.04, cw, 0.4, v.title ?? 'Selected', { size: 16, bold: true }));
  el.push(...pill(x, top + 0.45, v.status));
  el.push(T(x + 0.92, top + 0.425, cw - 0.92, 0.2, [v.label, v.date, v.model].filter(Boolean).join('  ·  '), { size: 6, color: GREY }));
  el.push(R(x, top + 0.82, cw, 0.005, { fill: LINE }));
  let points = v.points;
  if (!points?.length) {
    const cv = a.changes_view;
    points = cv.kind === 'summary' ? (cv.groups[0]?.items ?? []).filter((i) => !i.done).map((i) => i.change) : a.comments.map((c) => noMentions(c.body));
  }
  el.push(T(x - 0.04, top + 0.95, cw, 0.22, 'COMMENTS', { size: 6.5, color: GREY, bold: true }));
  const list = points.length ? points.slice(0, 8).flatMap((p, i) => [...(i ? [{ text: ' ', size: 5 }] : []), { text: `•  ${clip(p, 160)}`, size: 11 }]) : [{ text: 'No changes. Keep as it is.', size: 11, color: GREY }];
  el.push(T(x - 0.04, top + 1.2, cw, 5.15 - top - 1.2, list));
  el.push(...footer(meta));
  return { background: 'FFFFFF', elements: el };
}

async function assetSlides(a, meta, thumbs, pageNo) {
  const compares = [];
  for (const c of a.compares ?? []) compares.push(await compareSlide(a, c, meta));
  if (a.shortlisted) {
    const match = (v, ref) => v.id === ref || v.id.endsWith(String(ref));
    const out = [];
    for (const v of a.selected) out.push(await selectedSlide(a, v, a.groups?.find((g) => g.versions.some((r) => match(v, r)))?.name ?? null, meta));
    return [...out, ...compares];
  }
  const slides = a.board?.length ? await conceptSlides(a, meta, thumbs, pageNo) : [];
  if (!a.groups?.length) return [...slides, ...(await assetGroupSlides(a, a.versions, null, meta, thumbs, pageNo + slides.length)), ...compares];
  const match = (v, ref) => v.id === ref || v.id.endsWith(String(ref));
  const used = new Set();
  for (const g of a.groups) {
    const vs = a.versions.filter((v) => g.versions.some((r) => match(v, r)));
    vs.forEach((v) => used.add(v));
    if (!vs.length) continue; // a direction with nothing left to show (all rejected or not shortlisted)
    slides.push(...(await assetGroupSlides(a, vs, g.name, meta, thumbs, pageNo + slides.length)));
  }
  const rest = a.versions.filter((v) => !used.has(v));
  if (rest.length) slides.push(...(await assetGroupSlides(a, rest, 'Other versions', meta, thumbs, pageNo + slides.length)));
  return [...slides, ...compares];
}

function assetHeader(a, subtitle) {
  const el = [T(0.3, 0.22, 1.5, 0.4, a.code, { size: 18, bold: true }), T(1.6, 0.25, 4.6, 0.2, [a.section, subtitle].filter(Boolean).join('  ·  ').toUpperCase(), { size: 6, color: GREY, bold: true }), T(1.6, 0.42, 4.6, 0.22, a.product ?? '', { size: 8.5 })];
  if (a.key_message) el.push(T(6.3, 0.25, 3.4, 0.2, 'KEY MESSAGE', { size: 6, color: GREY, bold: true, align: 'r' }), T(5.3, 0.42, 4.4, 0.22, clip(a.key_message, 70), { size: 8.5, align: 'r' }));
  el.push(R(0.35, 0.78, 9.3, 0.005, { fill: LINE }));
  return el;
}

/** Concept board: up to three directions per slide, each with its tag, name, reference images and idea. */
async function conceptSlides(a, meta, thumbs, pageNo, { label = 'Concept board', intro = 'Directions before we generate. Comment on each by its letter, e.g. "A ✓  B ✗  C: warmer light".', samplesOnly = false } = {}) {
  const per = 3;
  const pages = [];
  for (let i = 0; i < a.board.length; i += per) pages.push(a.board.slice(i, i + per));
  const slides = [];
  for (const [pi, group] of pages.entries()) {
    const el = assetHeader(a, [label, pages.length > 1 ? `${pi + 1} of ${pages.length}` : null].filter(Boolean).join('  ·  '));
    el.push(T(0.3, 0.84, 9.4, 0.22, intro, { size: 6.5, color: GREY }));
    const gap = 0.25;
    const colW = (9.3 - gap * (per - 1)) / per;
    for (const [ci, dir] of group.entries()) {
      const x = 0.35 + ci * (colW + gap);
      el.push(R(x, 1.15, 0.3, 0.3, { fill: INK }), T(x, 1.15, 0.3, 0.3, dir.key, { size: 10, bold: true, color: 'FFFFFF', align: 'ctr', anchor: 'ctr' }));
      el.push(T(x + 0.36, 1.13, colW - 0.36 - (dir.verdict ? 0.9 : 0), 0.34, clip(dir.name, 60), { size: 8.5, bold: true, anchor: 'ctr' }));
      if (dir.verdict) {
        const v = VERDICT[dir.verdict];
        el.push(R(x + colW - 0.86, 1.215, 0.86, 0.17, { fill: v.fill }), T(x + colW - 0.86, 1.203, 0.86, 0.2, v.label, { size: 5.5, color: v.ink, bold: true, align: 'ctr', anchor: 'ctr' }));
      }
      // Image rows: same height, side by side, scaled to the column.
      const ar = (r) => (r.width && r.height ? r.width / r.height : 0.8);
      const iGap = 0.08;
      const row = async (imgs, y, h0, empty) => {
        let h = h0;
        const total = () => imgs.reduce((s, r) => s + h * ar(r), 0) + iGap * Math.max(imgs.length - 1, 0);
        if (imgs.length && total() > colW) h *= (colW - iGap * (imgs.length - 1)) / (total() - iGap * (imgs.length - 1));
        if (!imgs.length && empty) el.push(R(x, y, colW, h, { fill: 'F6F6F6', line: 'D9D9D9' }), T(x, y + h / 2 - 0.15, colW, 0.3, empty, { size: 7, color: '9A9A9A', align: 'ctr', anchor: 'ctr' }));
        let ix = x;
        for (const r of imgs) {
          const w = h * ar(r);
          el.push(await imageEl(r.sha, ix, y, w, h, thumbs));
          ix += w + iGap;
        }
        return imgs.length || empty ? h : 0;
      };
      let y = 1.55;
      if (samplesOnly) {
        // Scene options: only the generated images of the place, then the keywords that made them.
        y += (await row(dir.samples, y, 2.6, 'Not generated yet')) + 0.12;
      } else if (dir.samples.length) {
        // References, then what we generated from the words, then the keywords those prompts used.
        el.push(T(x - 0.04, y - 0.05, colW, 0.16, 'REFERENCES', { size: 5, color: GREY, bold: true }));
        y += 0.12 + (await row(dir.refs, y + 0.12, 1.15, 'No references yet')) + 0.06;
        el.push(T(x - 0.04, y - 0.02, colW, 0.16, 'GENERATED FROM THE DESCRIPTION', { size: 5, color: GREY, bold: true }));
        y += 0.15 + (await row(dir.samples, y + 0.15, 1.15)) + 0.06;
      } else y += (await row(dir.refs, y, 2.05, 'No references yet')) + 0.1;
      const text = [];
      if (dir.keywords.length) text.push({ text: 'KEYWORDS', size: 5, color: GREY, bold: true }, { text: dir.keywords.join('  ·  '), size: samplesOnly ? 8 : 6.5, bold: true, color: '0E7C86' }, { text: ' ', size: 3 });
      if (dir.idea && !samplesOnly) text.push({ text: clip(dir.idea, dir.samples.length ? 260 : 420), size: dir.samples.length ? 5.8 : 6.5 });
      el.push(T(x - 0.04, y, colW + 0.08, Math.max(5.2 - y, 0.3), text.length ? text : ''));
      if (ci < group.length - 1) el.push(R(x + colW + gap / 2, 1.15, 0.005, 4.0, { fill: LINE }));
    }
    el.push(...footer(meta));
    slides.push({ background: 'FFFFFF', elements: el });
  }
  return slides;
}

/**
 * The agreed scene, once chosen (look.scene_name): one slide with its name, keywords, images and
 * colours. The options it was picked from stay in the look file (archived_options), not on the deck.
 */
async function chosenSceneSlide(look, meta, dir, codes) {
  const a = { code: 'Scene', section: look.name, product: codes ? `Applies to ${codes}` : '', key_message: null };
  const el = assetHeader(a, 'Chosen scene');
  el.push(T(0.3, 0.84, 9.4, 0.22, 'One scene for every asset in this group, so rocks, sand, sea and light stay consistent.', { size: 6.5, color: GREY }));
  const left = [{ text: 'THE SCENE', size: 6, color: GREY, bold: true }, { text: look.scene_name, size: 10, bold: true }, { text: ' ', size: 5 }, { text: 'KEYWORDS', size: 6, color: GREY, bold: true }];
  for (const k of [].concat(look.scene_keywords ?? []).flatMap((x) => String(x).split(/\s*,\s*/)).filter(Boolean)) left.push({ text: k, size: 8.5, bold: true, color: '1F7A80' });
  el.push(T(0.3, 1.15, 2.55, 4.05, left));
  // Images, same height, between the two columns.
  const imgs = (look.scene_images ?? []).slice(0, 2).map((r) => boardRef(r, dir)).filter(Boolean);
  const x0 = 3.0;
  const areaW = 4.0;
  const gap = 0.12;
  let h = 4.0;
  const ar = (r) => (r.width && r.height ? r.width / r.height : 0.8);
  const total = () => imgs.reduce((t, r) => t + h * ar(r), 0) + gap * Math.max(imgs.length - 1, 0);
  if (imgs.length && total() > areaW) h *= (areaW - gap * (imgs.length - 1)) / (total() - gap * (imgs.length - 1));
  let x = x0;
  for (const r of imgs) {
    const w = h * ar(r);
    el.push(await imageEl(r.sha, x, 1.15, w, h, null));
    x += w + gap;
  }
  const cx = 7.25;
  el.push(T(cx, 1.12, 2.45, 0.2, 'COLOURS', { size: 6, color: GREY, bold: true }));
  let y = 1.4;
  for (const c of lookSwatches(look)) {
    el.push(R(cx + 0.02, y, 0.42, 0.32, { fill: c.hex.replace('#', ''), line: 'D6D6D6', lineWidth: 6350 }));
    el.push(T(cx + 0.5, y - 0.03, 1.95, 0.6, [{ text: `${c.part[0].toUpperCase()}${c.part.slice(1)}  ${c.hex.toUpperCase()}`, size: 7, bold: true }, { text: clip(c.words, 90), size: 6, color: GREY }]));
    y += 0.68;
  }
  el.push(...footer(meta));
  return { background: 'FFFFFF', elements: el };
}

/**
 * Scene guide for a project look (looks/<name>.yaml): one slide with the agreed scene (description,
 * light and a swatch per element: sky, sea, sand, rocks…), then the look's `options` as lettered
 * reference options in the concept-board layout, so the team can pick one world for every asset in it:
 *   scene: Andaman limestone cove…            options: [{ name, idea, refs: [sha|path], verdict? }]
 */
async function sceneSlides(look, meta, dir) {
  const codes = (look.applies_to ?? []).join(', ');
  if (look.scene_name) return [await chosenSceneSlide(look, meta, dir, codes)];
  const a = { code: 'Scene', section: look.name, product: codes ? `Applies to ${codes}` : '', key_message: null, board: conceptBoard({ concept_board: look.options ?? [] }, dir) };
  const el = assetHeader(a, 'Scene guide');
  el.push(T(0.3, 0.84, 9.4, 0.22, 'One scene for every asset in this group, so sand, rocks, sea and light stay consistent.', { size: 6.5, color: GREY }));
  const left = [{ text: 'THE SCENE', size: 6, color: GREY, bold: true }, { text: look.scene ? clip(look.scene, 600) : 'Not chosen yet: pick one of the options on the next slide.', size: 8, color: look.scene ? INK : GREY }, { text: ' ', size: 5 }];
  if (look.light) left.push({ text: 'LIGHT', size: 6, color: GREY, bold: true }, { text: clip(look.light, 200), size: 8 });
  if (look.source) left.push({ text: ' ', size: 5 }, { text: clip(look.source, 160), size: 6, color: GREY });
  el.push(T(0.3, 1.15, 4.4, 4.0, left));
  el.push(R(4.85, 1.15, 0.005, 4.0, { fill: LINE }));
  const sw = lookSwatches(look);
  el.push(T(5.05, 1.12, 4.6, 0.2, 'COLOURS', { size: 6, color: GREY, bold: true }));
  let y = 1.4;
  for (const c of sw) {
    el.push(R(5.07, y, 0.6, 0.42, { fill: c.hex.replace('#', ''), line: 'D6D6D6', lineWidth: 6350 }));
    el.push(T(5.75, y - 0.02, 3.9, 0.5, [{ text: `${c.part[0].toUpperCase()}${c.part.slice(1)}  ${c.hex.toUpperCase()}`, size: 7.5, bold: true }, { text: clip(c.words, 110), size: 6.5, color: GREY }]));
    y += 0.55;
  }
  el.push(...footer(meta));
  const slides = [{ background: 'FFFFFF', elements: el }];
  if (a.board.length) slides.push(...(await conceptSlides(a, meta, null, 0, { label: 'Scene options', intro: 'Generated from each description. Pick one scene for the whole group: comment by letter, e.g. "B ✓", or mix: "B rocks with A sand".', samplesOnly: true })));
  return slides;
}

async function assetGroupSlides(a, versions0, groupName, meta, thumbs, pageNo) {
  let n = 0;
  const versions = versions0.map((v) => (/^Version \d+$/.test(v.label) ? { ...v, label: `Option ${++n}` } : v));
  const items = [...(a.current ? [a.current] : []), ...versions];
  if (!versions.length) items.push({ placeholder: true, width: a.current?.width ?? 4, height: a.current?.height ?? 5, label: 'New version', note: 'Not generated yet', status: 'todo' });
  const pages = [];
  for (let i = 0; i < items.length; i += MAX_PER_SLIDE) pages.push(items.slice(i, i + MAX_PER_SLIDE));
  const slides = [];
  for (const [pi, group] of pages.entries()) {
    const el = [];
    // Header: code, section, products, key message.
    el.push(T(0.3, 0.22, 1.5, 0.4, a.code, { size: 18, bold: true }));
    el.push(T(1.6, 0.25, 4.6, 0.2, [a.section, groupName, pages.length > 1 ? `${pi + 1} of ${pages.length}` : null].filter(Boolean).join('  ·  ').toUpperCase(), { size: 6, color: GREY, bold: true }));
    el.push(T(1.6, 0.42, 4.6, 0.22, a.product ?? '', { size: 8.5 }));
    if (a.key_message) el.push(T(6.3, 0.25, 3.4, 0.2, 'KEY MESSAGE', { size: 6, color: GREY, bold: true, align: 'r' }), T(5.3, 0.42, 4.4, 0.22, clip(a.key_message, 70), { size: 8.5, align: 'r' }));
    el.push(R(0.35, 0.78, 9.3, 0.005, { fill: LINE }));

    // Left column: creative idea, open comments.
    const left = [];
    if (a.idea) left.push({ text: 'CREATIVE IDEA', size: 6, color: GREY, bold: true }, { text: clip(a.idea, 330), size: 6.5 }, { text: ' ', size: 4 });
    const cv = a.changes_view;
    if (cv.kind === 'summary') {
      left.push({ text: 'CHANGES REQUESTED', size: 6, color: GREY, bold: true });
      for (const g of cv.groups.slice(0, 5)) {
        left.push({ text: day(g.date), size: 6, bold: true });
        for (const it of g.items.slice(0, 4)) left.push({ text: `${it.done ? '✓ ' : '• '}${clip(it.change, 110)}${it.from ? `  (${it.from})` : ''}`, size: 6.5, color: it.done ? GREY : INK });
      }
    } else left.push({ text: `OPEN COMMENTS (${a.comments.length})`, size: 6, color: GREY, bold: true });
    if (cv.kind === 'comments' && !a.comments.length) left.push({ text: 'None', size: 6.5, color: GREY });
    for (const c of cv.kind === 'comments' ? a.comments.slice(0, 5) : []) {
      left.push({ text: `${c.author ?? 'Comment'} · ${day(c.created)}`, size: 6, bold: true });
      left.push({ text: clip(noMentions([c.body, ...(c.replies ?? []).filter((r) => r.body?.trim()).map((r) => `↳ ${r.body}`)].join(' ')), 220), size: 6.5 });
    }
    if (cv.kind === 'comments' && a.comments.length > 5) left.push({ text: `+ ${a.comments.length - 5} more in the working deck`, size: 6, color: GREY });
    // Colour palette (project look): one swatch per element at the bottom of the left column.
    const sw = lookSwatches(a.look, a.code);
    const palH = sw.length ? 0.32 + sw.length * 0.3 : 0;
    el.push(T(0.3, 0.92, 2.35, 4.3 - palH, left));
    if (sw.length) {
      let y = 5.22 - palH;
      el.push(T(0.3, y, 2.35, 0.2, `COLOUR PALETTE · ${a.look.name}`, { size: 6, color: GREY, bold: true }));
      y += 0.26;
      for (const c of sw) {
        el.push(R(0.32, y, 0.34, 0.22, { fill: c.hex.replace('#', ''), line: 'D6D6D6', lineWidth: 6350 }));
        el.push(T(0.72, y - 0.01, 1.95, 0.25, [{ text: `${c.part[0].toUpperCase()}${c.part.slice(1)}  ${c.hex.toUpperCase()}`, size: 6, bold: true }, { text: clip(c.words, 60), size: 5.5, color: GREY }]));
        y += 0.3;
      }
    }
    el.push(R(2.75, 0.92, 0.005, 4.25, { fill: LINE }));

    // Images: same height, in order, scaled to fit the right area.
    const areaX = 2.95;
    const areaW = 6.7;
    const gap = 0.18;
    let h = 3.05;
    const ar = (it) => (it.width && it.height ? it.width / it.height : 0.8);
    const total = () => group.reduce((s, it) => s + h * ar(it), 0) + gap * (group.length - 1);
    if (total() > areaW) h *= (areaW - gap * (group.length - 1)) / (total() - gap * (group.length - 1));
    let x = areaX;
    for (const it of group) {
      const w = h * ar(it);
      if (it.placeholder) el.push(R(x, 0.95, w, h, { fill: 'F6F6F6', line: 'D9D9D9' }), T(x, 0.95 + h / 2 - 0.15, w, 0.3, 'Not generated yet', { size: 8, color: '9A9A9A', align: 'ctr', anchor: 'ctr' }));
      else el.push(await imageEl(it.sha, x, 0.95, w, h, thumbs));
      const capY = 0.95 + h + 0.08;
      el.push(T(x - 0.04, capY, Math.max(w, 1.2) + 0.08, 0.2, clip(it.label, Math.max(18, Math.round(w * 17))), { size: 7.5, bold: true }));
      el.push(...pill(x, capY + 0.24, it.status));
      if (it.date || it.model) el.push(T(x + 0.9, capY + 0.215, Math.max(w - 0.9, 0.8), 0.2, [it.date, it.model].filter(Boolean).join(' · '), { size: 5.5, color: GREY }));
      if (it.note && !it.placeholder) el.push(T(x - 0.04, capY + 0.45, Math.max(w, 1.2) + 0.08, 0.55, clip(it.note, 150), { size: 5.5, color: GREY }));
      x += w + gap;
    }
    el.push(...footer(meta));
    slides.push({ background: 'FFFFFF', elements: el });
  }
  return slides;
}

const r0 = (a) => a.versions.length;

function overviewSlides(data, meta, startPage) {
  const rows = data.assets.map((a) => {
    const counts = {};
    for (const v of a.versions) counts[v.status] = (counts[v.status] ?? 0) + 1;
    const lead = !r0(a) ? 'todo' : counts.approved ? 'approved' : counts.new ? 'new' : 'rejected';
    return { a, counts, lead };
  });
  const per = 11;
  const slides = [];
  for (let i = 0; i < Math.max(rows.length, 1); i += per) {
    const el = [T(0.3, 0.22, 6, 0.4, 'Overview', { size: 18, bold: true }), T(0.3, 0.6, 9, 0.2, `${plural(data.assets.length, 'asset')}  ·  ${plural(rows.reduce((s, r) => s + r.a.versions.length, 0), 'version')}  ·  one slide per asset: the current deck visual, then every version in order`, { size: 7, color: GREY }), R(0.35, 0.88, 9.3, 0.005, { fill: LINE })];
    const cols = [
      ['ASSET', 0.3, 0.9],
      ['PRODUCTS', 1.2, 2.6],
      ['KEY MESSAGE', 3.9, 2.4],
      ['VERSIONS', 6.4, 1.6],
      ['STATUS', 8.2, 1.4],
    ];
    for (const [t, x, w] of cols) el.push(T(x, 0.98, w, 0.2, t, { size: 6, color: GREY, bold: true }));
    rows.slice(i, i + per).forEach((r, k) => {
      const y = 1.25 + k * 0.36;
      el.push(T(0.3, y, 0.9, 0.25, r.a.code, { size: 8, bold: true }), T(1.2, y, 2.6, 0.25, clip(r.a.product, 45), { size: 7 }), T(3.9, y, 2.4, 0.25, clip(r.a.key_message, 40), { size: 7 }));
      el.push(T(6.4, y, 1.7, 0.25, [r.a.versions.length ? Object.entries(r.counts).map(([s, n]) => `${n} ${STATUS[s]?.label.toLowerCase() ?? s}`).join(', ') : 'Not generated yet', r.a.rejected ? `${r.a.rejected} rejected` : null].filter(Boolean).join(' · '), { size: 7 }));
      el.push(...pill(8.25, y + 0.04, r.lead));
      el.push(R(0.35, y + 0.31, 9.3, 0.004, { fill: LINE }));
    });
    el.push(...footer(meta));
    slides.push({ background: 'FFFFFF', elements: el });
  }
  return slides;
}

/**
 * The deck as sections: cover, overview, then one per asset. Each section is a list of slides
 * ({ background, elements }); image elements carry a sha, not bytes.
 */
export async function buildSections(client, project, { only, cover = null, shortlist = null } = {}) {
  const data = reviewDeckData(client, project, { only, shortlist });
  if (!data.assets.length) throw new StudioError(`No versions to review yet in ${data.project}.`, 'Make images for a deliverable first.');
  const meta = { client: data.client, project: data.project, updated: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) };
  const sections = [];
  if (cover && readMedia(cover)) sections.push({ key: 'cover', slides: [{ background: 'FFFFFF', elements: [await imageEl(cover, 0, 0, 10, 5.625, null, { full: true })] }] });
  else sections.push({ key: 'cover', slides: [{ background: 'FFFFFF', elements: [T(0.6, 2.0, 8.8, 0.6, data.project, { size: 28, bold: true }), T(0.6, 2.65, 8.8, 0.3, `${data.client}  ·  Review deck`, { size: 11, color: GREY }), T(0.6, 4.9, 8.8, 0.25, `Updated ${meta.updated}`, { size: 7, color: GREY, volatile: true })] }] });
  sections.push({ key: 'overview', slides: overviewSlides(data, meta, 0) });
  // Scene guides for the looks that cover assets in this deck, before the assets.
  const codes = new Set(data.assets.map((a) => a.code.toLowerCase()));
  const projDir = path.join(clientDir(client), 'projects', project);
  for (const l of listLooks(client, project)) {
    if ((l.applies_to ?? []).some((c) => codes.has(String(c).toLowerCase()))) sections.push({ key: `scene:${l.file}`, slides: await sceneSlides(l, meta, projDir) });
  }
  for (const a of data.assets) sections.push({ key: `asset:${a.code}`, code: a.code, slides: await assetSlides(a, meta, null, 0) });
  return { data, meta, sections };
}

/** Loads the bytes of every image element in these slides (thumbnails unless `full`). */
export async function loadImages(slides, thumbs = thumbnailer()) {
  for (const sl of slides) for (const el of sl.elements) if (el.type === 'image' && !el.data) el.data = fs.readFileSync(await thumbs(el.sha, { full: el.full }));
  return slides;
}

/** Builds the whole review deck as .pptx bytes. `cover` is an optional image sha for a full-bleed cover. */
export async function buildReviewDeck(client, project, { only, cover = null } = {}) {
  const { data, sections } = await buildSections(client, project, { only, cover });
  const slides = await loadImages(sections.flatMap((s) => s.slides));
  return { data, slides: slides.length, pptx: buildPptx({ slides, title: `${data.project} · Review`, width: W, height: H }) };
}

/**
 * Asset codes renamed since this deck was last drawn (renumber.yaml entries it hasn't applied), as
 * section keys: { renames: { "asset:APS008": "asset:APS007" }, renumbers: [<at>…] }. Chains
 * (A → B, then B → C) collapse to A → C. Only renumbers after `since` (when the deck was last drawn)
 * count: a deck drawn after a renumber already uses the new codes. A deck with no saved state adopts
 * slides by code instead.
 */
export function deckRenames(client, project, live, since = null) {
  if (!live?.sections) return { renames: {}, renumbers: [] };
  const done = new Set(live.renumbers_applied ?? []);
  const list = (readYaml(path.join(clientDir(client), 'projects', project, 'renumber.yaml'), {})?.renumbers ?? []).filter((r) => r?.at && !done.has(String(r.at)) && (!since || String(r.at) > String(since))).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  let codes = {}; // old code → current code
  for (const r of list) {
    const map = Object.fromEntries(Object.entries(r.map ?? {}).map(([o, n]) => [String(o).toUpperCase(), String(n).toUpperCase()]));
    const next = {};
    for (const [o, n] of Object.entries(codes)) next[o] = map[n] ?? n;
    for (const [o, n] of Object.entries(map)) if (!Object.values(codes).includes(o) && !(o in next)) next[o] = n;
    codes = next;
  }
  const renames = {};
  for (const [o, n] of Object.entries(codes)) if (o !== n) renames[`asset:${o}`] = `asset:${n}`;
  return { renames, renumbers: list.map((r) => String(r.at)) };
}

/**
 * Writes the review deck into a Google Slides file (the same file each time) in the project's review
 * folder. With `deck`, uses that file and remembers it; otherwise the one remembered in project.yaml.
 */
export async function publishReviewDeck(client, project, { deck = null, only, cover, rebuild = false } = {}) {
  const file = path.join(clientDir(client), 'projects', project, 'project.yaml');
  const proj = readYaml(file, {}) ?? {};
  const { fileId } = await import('./google/api.mjs');
  const { getFile, updateFile } = await import('./google/drive.mjs');
  const { readOnlyFolders, projectFolder } = await import('./google/studio-drive.mjs');
  const id = deck ? fileId(deck) : proj.links?.review_deck?.id;
  only ??= proj.links?.review_deck?.assets ?? undefined;
  if (!id) throw new StudioError('Which Google Slides file should the review deck go into?', `Make an empty deck in the project's "04_Review Decks" folder on Drive and pass its link.`);
  const meta = await getFile(id);
  if (meta.mimeType !== 'application/vnd.google-apps.presentation') throw new StudioError(`"${meta.name}" isn't a Google Slides file.`);
  const working = (readYaml(layout.clientYaml(client), {})?.links?.decks ?? []).some((d) => (typeof d === 'string' ? d.includes(id) : d.slides_id === id));
  if (working) throw new StudioError(`"${meta.name}" is a working deck. The review deck must be a separate file.`);
  const ro = new Set(readOnlyFolders(client).map((f) => f.id));
  if ((meta.parents ?? []).some((p) => ro.has(p))) throw new StudioError(`"${meta.name}" is in a read-only folder.`);
  const decksFolder = await projectFolder(client, project, 'decks');
  const sameFile = proj.links?.review_deck?.id === id;
  if (sameFile && proj.links?.review_deck?.paused) throw new StudioError(`The review deck "${meta.name}" is paused: it isn't being updated.`, 'Updates resume when the person asks: remove links.review_deck.paused from project.yaml.');
  const coverSha = cover ?? proj.links?.review_deck?.cover ?? null;
  // A different file starts fresh: no saved slide state, and the old file's pause doesn't apply.
  const { paused: _p, live: _l, ...carry } = proj.links?.review_deck ?? {};
  const prev = sameFile ? proj.links?.review_deck ?? {} : carry;
  let result;
  let live = null;
  if (rebuild) {
    // The whole file is replaced: comments on slides and hand-made slides are lost.
    const built = await buildReviewDeck(client, project, { only, cover: coverSha });
    await updateFile(id, { data: built.pptx, mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    result = { mode: 'rebuild', slides: built.slides, data: built.data };
  } else {
    const { updateLive } = await import('./review-deck-live.mjs');
    const built = await buildSections(client, project, { only, cover: coverSha, shortlist: prev.shortlist ?? null });
    const r = await updateLive(id, built.sections, prev.live, { tempFolder: decksFolder, ...deckRenames(client, project, prev.live, prev.updated) });
    live = r.state;
    result = { mode: 'update', slides: r.slides, data: built.data, changed: r.changed, unchanged: r.unchanged, removed: r.removed, migrated: r.migrated };
  }
  const { live: _old, ...rest } = prev;
  proj.links = { ...(proj.links ?? {}), review_deck: { ...rest, id, url: `https://docs.google.com/presentation/d/${id}/edit`, ...(cover ? { cover } : {}), ...(only ? { assets: only } : {}), updated: new Date().toISOString(), ...(live ? { live } : {}) } };
  writeYamlAtomic(file, proj);
  return {
    client,
    project,
    deck: meta.name,
    url: `https://docs.google.com/presentation/d/${id}/edit`,
    mode: result.mode,
    slides: result.slides,
    ...(result.mode === 'update' ? { changed: result.changed, unchanged: result.unchanged, removed: result.removed, ...(result.migrated ? { migrated: true } : {}) } : {}),
    assets: result.data.assets.map((a) => ({ code: a.code, versions: a.versions.length, open_comments: a.comments.length })),
    in_review_folder: (meta.parents ?? []).includes(decksFolder),
  };
}

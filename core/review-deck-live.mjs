import crypto from 'node:crypto';
import { buildPptx } from './pptx-write.mjs';
import { loadImages, thumbnailer } from './review-deck.mjs';

// Updates the review deck's Google Slides file in place, section by section.
//
// Each section (cover, overview, one per asset) has a fingerprint of its content. On refresh only
// sections whose fingerprint changed are redrawn, and a redrawn slide keeps its slide id: the studio
// clears the elements it drew (object ids starting "rd") and draws the new ones. So comments on a
// slide stay on it, untouched sections stay exactly as they are, and anything a person added by hand
// (their own shapes, notes or slides) is left alone. State lives in project.yaml:
//   links.review_deck.live: { version, sections: { <key>: { hash, slides: [slide ids] } } }
//
// Images: the Slides API inserts images by URL. To keep client images private they are never made
// public: changed images go into a temporary deck (a .pptx converted on upload) in the review folder,
// whose image URLs are only usable by this account, then copied in, and the temporary deck is deleted.

export const LIVE_VERSION = 2; // bump when the drawing code changes, to redraw every section once
const PREFIX = 'rd';
const EMU = 'EMU';

const newId = (kind) => `${PREFIX}${kind}_${crypto.randomBytes(9).toString('hex')}`;
const ours = (id) => String(id ?? '').startsWith(PREFIX);

/** Fingerprint of a section's content (images by sha; the "Updated" date is ignored). */
export function sectionHash(section) {
  const strip = (el) => {
    if (el.volatile) return null;
    const { data, ...rest } = el;
    return rest;
  };
  const body = section.slides.map((s) => ({ bg: s.background, el: s.elements.map(strip).filter(Boolean) }));
  return crypto.createHash('sha1').update(JSON.stringify({ v: LIVE_VERSION, body })).digest('hex').slice(0, 16);
}

/**
 * What to do, given the sections wanted now, the saved state and the slide ids in the file.
 * Returns { steps: [{ key, hash, reuse: [ids], create: n, drop: [ids], slides }], removed: [ids],
 * unchanged: [keys], migrate: bool }.
 */
export function planDeck(sections, state, existingIds, { dirty = [] } = {}) {
  const exists = new Set(existingIds);
  const isDirty = new Set(dirty); // slides whose studio drawing is gone (the file was overwritten)
  const saved = state?.sections ?? {};
  const migrate = !state?.sections; // first in-place update of a deck written as a whole file
  const sameVersion = state?.version === LIVE_VERSION;
  const steps = [];
  const unchanged = [];
  const seen = new Set();
  for (const sec of sections) {
    seen.add(sec.key);
    const hash = sectionHash(sec);
    const prev = saved[sec.key];
    const live = (prev?.slides ?? []).filter((id) => exists.has(id));
    if (!migrate && prev && prev.hash === hash && !live.some((x) => isDirty.has(x)) && live.length === prev.slides.length && live.length === sec.slides.length && sameVersion) {
      unchanged.push(sec.key);
      steps.push({ key: sec.key, hash, keep: live });
      continue;
    }
    const n = sec.slides.length;
    steps.push({ key: sec.key, hash, reuse: live.slice(0, n), create: Math.max(n - live.length, 0), drop: live.slice(n), slides: sec.slides });
  }
  const removed = Object.entries(saved)
    .filter(([k]) => !seen.has(k))
    .flatMap(([, v]) => v.slides ?? [])
    .filter((id) => exists.has(id));
  return { steps, removed, unchanged, migrate };
}

const rgb = (hex) => {
  const h = String(hex).replace('#', '');
  return { red: parseInt(h.slice(0, 2), 16) / 255, green: parseInt(h.slice(2, 4), 16) / 255, blue: parseInt(h.slice(4, 6), 16) / 255 };
};
const clean = (t) => String(t ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const props = (page, el) => ({
  pageObjectId: page,
  size: { width: { magnitude: Math.max(el.w, 1), unit: EMU }, height: { magnitude: Math.max(el.h, 1), unit: EMU } },
  transform: { scaleX: 1, scaleY: 1, translateX: el.x, translateY: el.y, unit: EMU },
});
const ALIGN = { r: 'END', ctr: 'CENTER', l: 'START' };

// Images carry their identity in their alt text, so a redraw can keep (and move) the same image.
export const imageTag = (el) => `sha:${el.sha}${el.full ? ':full' : ''}`;
const tagOf = (e) => (/^sha:[0-9a-f]{64}(:full)?$/.test(e.description ?? '') ? e.description : null);
const geom = (e) => ({ x: e.transform?.translateX ?? 0, y: e.transform?.translateY ?? 0, w: (e.size?.width?.magnitude ?? 0) * (e.transform?.scaleX ?? 1), h: (e.size?.height?.magnitude ?? 0) * (e.transform?.scaleY ?? 1) });
const near = (a, b) => Math.abs(a - b) < 2000; // EMU
const plainText = (e) => (e.shape?.text?.textElements ?? []).map((t) => t.textRun?.content ?? '').join('').replace(/\n$/, '');
const wantText = (el) => (Array.isArray(el.text) ? el.text : [el.text]).map((p) => clean(typeof p === 'string' ? p : p.text)).join('\n');

/**
 * Which elements already on a slide can stay: by stable id, then images by their alt-text tag
 * (moved or resized in place if needed), then text and shapes that are the same and in the same
 * place. Returns { keepIdx: Set(desired index), keepIds: Set(object id), updates: [requests] }.
 */
export function adoptElements(slide, existing, ids) {
  const keepIdx = new Set();
  const keepIds = new Set();
  const updates = [];
  const free = existing.filter((e) => ours(e.objectId));
  const take = (j, e) => {
    keepIdx.add(j);
    keepIds.add(e.objectId);
  };
  slide.elements.forEach((el, j) => {
    const e = free.find((x) => x.objectId === ids[j]);
    if (e) take(j, e);
  });
  slide.elements.forEach((el, j) => {
    if (keepIdx.has(j)) return;
    const avail = free.filter((x) => !keepIds.has(x.objectId));
    let e = null;
    if (el.type === 'image') e = avail.find((x) => x.image && x._tag === imageTag(el));
    else if (el.type === 'text') e = avail.find((x) => x.shape?.shapeType === 'TEXT_BOX' && plainText(x) === wantText(el) && near(geom(x).x, el.x) && near(geom(x).y, el.y) && near(geom(x).w, el.w));
    else e = avail.find((x) => x.shape?.shapeType === 'RECTANGLE' && near(geom(x).x, el.x) && near(geom(x).y, el.y) && near(geom(x).w, el.w) && near(geom(x).h, el.h) && JSON.stringify(x.shapeProperties?.shapeBackgroundFill?.solidFill?.color?.rgbColor ?? null) === JSON.stringify(el.fill ? rgb(el.fill) : null));
    if (!e) return;
    take(j, e);
    if (el.type === 'image') {
      const g = geom(e);
      if (!near(g.x, el.x) || !near(g.y, el.y) || !near(g.w, el.w) || !near(g.h, el.h)) {
        updates.push({ updatePageElementTransform: { objectId: e.objectId, applyMode: 'ABSOLUTE', transform: { scaleX: el.w / (e.size?.width?.magnitude || el.w), scaleY: el.h / (e.size?.height?.magnitude || el.h), translateX: el.x, translateY: el.y, unit: EMU } } });
      }
      if (!tagOf(e)) updates.push({ updatePageElementAltText: { objectId: e.objectId, title: 'studio', description: imageTag(el) } });
    }
  });
  return { keepIdx, keepIds, updates };
}

/**
 * A stable object id per element: the same element on the same slide always gets the same id, so a
 * redraw leaves unchanged elements (and comments attached to them) exactly where they are.
 */
export function elementIds(page, slide) {
  const seen = new Map();
  return slide.elements.map((el) => {
    const { data, ...spec } = el;
    const base = crypto.createHash('sha1').update(`${page}|${JSON.stringify(spec)}`).digest('hex').slice(0, 20);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const kind = el.type === 'image' ? 'i' : el.type === 'text' ? 't' : 'r';
    return `${PREFIX}${kind}_${base}${n ? `_${n}` : ''}`;
  });
}

/**
 * Slides API requests that draw one slide's elements on `page`. `urls`: sha → image URL.
 * Elements whose stable id is in `skip` are already on the slide and are left alone.
 */
export function slideRequests(page, slide, urls, { skip = new Set(), skipIdx = new Set() } = {}) {
  const out = [];
  const ids = elementIds(page, slide);
  let k = -1;
  if (slide.background && slide.background.toUpperCase() !== 'FFFFFF') {
    out.push({ updatePageProperties: { objectId: page, pageProperties: { pageBackgroundFill: { solidFill: { color: { rgbColor: rgb(slide.background) } } } }, fields: 'pageBackgroundFill.solidFill.color' } });
  }
  for (const el of slide.elements) {
    const id = ids[++k];
    if (skip.has(id) || skipIdx.has(k)) continue;
    if (el.type === 'image') {
      const url = urls[`${el.sha}:${!!el.full}`];
      if (url) out.push({ createImage: { objectId: id, url, elementProperties: props(page, el) } }, { updatePageElementAltText: { objectId: id, title: 'studio', description: imageTag(el) } });
      continue;
    }
    out.push({ createShape: { objectId: id, shapeType: el.type === 'text' ? 'TEXT_BOX' : 'RECTANGLE', elementProperties: props(page, el) } });
    const sp = {};
    const fields = [];
    if (el.fill) {
      sp.shapeBackgroundFill = { solidFill: { color: { rgbColor: rgb(el.fill) } } };
      fields.push('shapeBackgroundFill.solidFill.color');
    } else if (el.type === 'rect') {
      sp.shapeBackgroundFill = { propertyState: 'NOT_RENDERED' };
      fields.push('shapeBackgroundFill.propertyState');
    }
    if (el.type === 'rect') {
      if (el.line) {
        sp.outline = { outlineFill: { solidFill: { color: { rgbColor: rgb(el.line) } } }, weight: { magnitude: el.lineWidth ?? 12700, unit: EMU } };
        fields.push('outline.outlineFill.solidFill.color', 'outline.weight');
      } else {
        sp.outline = { propertyState: 'NOT_RENDERED' };
        fields.push('outline.propertyState');
      }
    }
    if (el.type === 'text' && el.anchor === 'ctr') {
      sp.contentAlignment = 'MIDDLE';
      fields.push('contentAlignment');
    }
    if (fields.length) out.push({ updateShapeProperties: { objectId: id, shapeProperties: sp, fields: fields.join(',') } });
    if (el.type !== 'text') continue;
    const paras = (Array.isArray(el.text) ? el.text : [el.text]).map((p) => (typeof p === 'string' ? { text: p } : p)).map((p) => ({ ...p, text: clean(p.text) }));
    const full = paras.map((p) => p.text).join('\n');
    if (!full.length) continue;
    out.push({ insertText: { objectId: id, insertionIndex: 0, text: full } });
    let at = 0;
    for (const p of paras) {
      if (p.text.length) {
        const style = { fontFamily: el.font ?? 'Arial', fontSize: { magnitude: p.size ?? el.size ?? 12, unit: 'PT' }, bold: !!(p.bold ?? el.bold), foregroundColor: { opaqueColor: { rgbColor: rgb(p.color ?? el.color ?? '333333') } } };
        out.push({ updateTextStyle: { objectId: id, textRange: { type: 'FIXED_RANGE', startIndex: at, endIndex: at + p.text.length }, style, fields: 'fontFamily,fontSize,bold,foregroundColor' } });
      }
      at += p.text.length + 1;
    }
    if (el.align && ALIGN[el.align] !== 'START') out.push({ updateParagraphStyle: { objectId: id, textRange: { type: 'ALL' }, style: { alignment: ALIGN[el.align] }, fields: 'alignment' } });
  }
  return out;
}

const textOfEl = (e) => (e.shape?.text?.textElements ?? []).map((t) => t.textRun?.content ?? '').join('').trim();

/** Old generated slides by section key: { cover: [id], overview: [ids], "asset:APS011": [ids] }. */
export function adoptSlides(slides) {
  const out = {};
  slides.forEach((sl, i) => {
    const texts = (sl.pageElements ?? []).map(textOfEl).filter(Boolean);
    const code = texts.find((t) => /^[A-Z]{2,4}\d{3}$/.test(t));
    const key = code ? `asset:${code}` : texts.includes('Overview') ? 'overview' : i === 0 ? 'cover' : null;
    if (key) (out[key] ??= []).push(sl.objectId);
  });
  return out;
}

/** Sets e._tag on every studio image of the slides being redrawn, matching untagged ones by look. */
async function tagUntagged(todo, byId, skipSlide) {
  const jobs = [];
  for (const st of todo)
    st.slides.forEach((sl, i) => {
      const sid = st.ids[i];
      if (skipSlide(sid)) return;
      const els = (byId.get(sid)?.pageElements ?? []).filter((e) => e.image && ours(e.objectId));
      for (const e of els) e._tag = tagOf(e);
      const untagged = els.filter((e) => !e._tag && e.image.contentUrl);
      const wanted = [...new Map(sl.elements.filter((el) => el.type === 'image').map((el) => [imageTag(el), el])).values()];
      if (untagged.length && wanted.length) jobs.push({ untagged, wanted });
    });
  if (!jobs.length) return;
  const { pyReady, runMedia } = await import('./py.mjs');
  if (!pyReady()) return;
  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-deck-'));
  try {
    const shaHash = new Map();
    const wantedAll = [...new Map(jobs.flatMap((j) => j.wanted).map((el) => [el.sha, el])).values()].filter((el) => !shaHash.has(el.sha));
    try {
      const r = await runMedia('dhash', { items: wantedAll.map((el) => ({ sha: el.sha })) });
      for (const h of r.hashes ?? []) shaHash.set(h.sha, BigInt(`0x${h.hash}`));
    } catch {
      return;
    }
    const files = [];
    for (const j of jobs)
      for (const e of j.untagged) {
        const res = await fetch(e.image.contentUrl);
        if (!res.ok) continue;
        const f = path.join(tmp, `${e.objectId}.img`);
        fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
        files.push({ e, f });
      }
    const got = files.length ? await runMedia('dhash', { items: files.map((x) => ({ path: x.f })) }) : { hashes: [] };
    const byPath = new Map((got.hashes ?? []).map((h) => [h.path, BigInt(`0x${h.hash}`)]));
    const bits = (x) => x.toString(2).split('').filter((c) => c === '1').length;
    for (const j of jobs)
      for (const e of j.untagged) {
        const h = byPath.get(files.find((x) => x.e === e)?.f);
        if (h === undefined) continue;
        let best = null;
        for (const el of j.wanted) {
          const w = shaHash.get(el.sha);
          if (w === undefined) continue;
          const d = bits(h ^ w);
          if (!best || d < best.d) best = { d, tag: imageTag(el) };
        }
        if (best && best.d <= 10) e._tag = best.tag;
      }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function api() {
  const { gfetch, hosts } = await import('./google/api.mjs');
  const batch = async (id, requests) => {
    for (let i = 0; i < requests.length; i += 400) {
      await gfetch(`${hosts().slides}/presentations/${id}:batchUpdate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requests: requests.slice(i, i + 400) }) });
    }
  };
  return { gfetch, hosts, batch };
}

/** Puts the images into a temporary deck and returns { urls: { "sha:full": url }, cleanup }. */
async function imageUrls(images, folder) {
  const { gfetch, hosts } = await api();
  if (!images.length) return { urls: {}, cleanup: async () => {} };
  const slides = await loadImages(
    images.map((im) => ({ elements: [{ type: 'image', sha: im.sha, full: im.full, ext: 'jpg', x: 0, y: 0, w: 4572000, h: 4572000 }] })),
    thumbnailer(),
  );
  const pptx = buildPptx({ slides, width: 9144000, height: 5143500 });
  const b = `stacked${crypto.randomBytes(8).toString('hex')}`;
  const meta = JSON.stringify({ name: '_studio temp images (safe to delete)', parents: [folder], mimeType: 'application/vnd.google-apps.presentation' });
  const body = Buffer.concat([
    Buffer.from(`--${b}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\ncontent-type: application/vnd.openxmlformats-officedocument.presentationml.presentation\r\n\r\n`),
    pptx,
    Buffer.from(`\r\n--${b}--`),
  ]);
  const tmp = await gfetch(`${hosts().upload}/files?uploadType=multipart&supportsAllDrives=true&fields=id`, { method: 'POST', headers: { 'content-type': `multipart/related; boundary=${b}` }, body, retry: false });
  const cleanup = () => gfetch(`${hosts().drive}/files/${tmp.id}?supportsAllDrives=true`, { method: 'DELETE', raw: true }).catch(() => {});
  try {
    const p = await gfetch(`${hosts().slides}/presentations/${tmp.id}`);
    const urls = {};
    images.forEach((im, i) => {
      const url = (p.slides?.[i]?.pageElements ?? []).find((e) => e.image)?.image?.contentUrl;
      if (url) urls[`${im.sha}:${!!im.full}`] = url;
    });
    return { urls, cleanup };
  } catch (e) {
    await cleanup();
    throw e;
  }
}

/**
 * Brings the Slides file `id` in line with `sections`. `state` is the saved links.review_deck.live.
 * Returns { state, slides, changed: [keys], unchanged: [keys], removed: n, migrated }.
 */
export async function updateLive(id, sections, state, { tempFolder }) {
  const { gfetch, hosts, batch } = await api();
  const pres = await gfetch(`${hosts().slides}/presentations/${id}`);
  const current = pres.slides ?? [];
  // A tracked slide with none of the studio's elements left was overwritten (e.g. the whole file
  // was replaced): redraw it, clearing what's on it.
  const tracked = new Set(Object.values(state?.sections ?? {}).flatMap((v) => v.slides ?? []));
  const dirty = current.filter((s) => tracked.has(s.objectId) && !(s.pageElements ?? []).some((e) => ours(e.objectId))).map((s) => s.objectId);
  const dirtySet = new Set(dirty);
  const plan = planDeck(sections, state, current.map((s) => s.objectId), { dirty });
  const requests = [];

  // First in-place update of a deck that was written as a whole file: its slides are adopted by
  // section (the asset code in each slide's header, "Overview", the first slide as the cover), so
  // comments stay on the same asset's slide. Unmatched old slides are removed.
  const drop = new Set(plan.removed);
  if (plan.migrate) {
    const adopted = adoptSlides(current);
    const used = new Set();
    for (const st of plan.steps) {
      if (!st.slides) continue;
      st.reuse = (adopted[st.key] ?? []).slice(0, st.slides.length);
      st.reuse.forEach((x) => used.add(x));
    }
    for (const sl of current) if (!used.has(sl.objectId)) drop.add(sl.objectId);
  }

  const todo = plan.steps.filter((st) => st.slides);
  const byId0 = new Map(current.map((s) => [s.objectId, s]));
  const onSlide = (sid) => new Set((byId0.get(sid)?.pageElements ?? []).map((e) => e.objectId));
  // Slides are planned first (ids for new ones), so only images that will really be added are uploaded.
  for (const st of todo) {
    st.ids = [...st.reuse];
    for (let i = st.ids.length; i < st.slides.length; i++) st.ids.push(newId('s'));
  }
  // Images on slides being redrawn that have no tag yet (drawn before tags existed, or a restored
  // version): identify them by look against the images the slide should show.
  await tagUntagged(todo, byId0, (sid) => plan.migrate || dirtySet.has(sid));
  const adopt = new Map(); // slide id -> adoptElements result
  const images = [];
  const seenImg = new Set();
  for (const st of todo)
    st.slides.forEach((sl, i) => {
      const sid = st.ids[i];
      const existing = plan.migrate || dirtySet.has(sid) ? [] : byId0.get(sid)?.pageElements ?? [];
      const a = adoptElements(sl, existing, elementIds(sid, sl));
      adopt.set(sid, a);
      sl.elements.forEach((el, j) => {
        if (el.type !== 'image' || a.keepIdx.has(j) || seenImg.has(`${el.sha}:${!!el.full}`)) return;
        seenImg.add(`${el.sha}:${!!el.full}`);
        images.push({ sha: el.sha, full: el.full });
      });
    });
  const { urls, cleanup } = await imageUrls(images, tempFolder);
  try {
    const byId = new Map(current.map((s) => [s.objectId, s]));
    const order = [];
    const next = { version: LIVE_VERSION, sections: {} };
    for (const st of plan.steps) {
      if (st.keep) {
        order.push(...st.keep);
        next.sections[st.key] = { hash: st.hash, slides: st.keep };
        continue;
      }
      const ids = st.ids;
      for (const sid of ids.slice(st.reuse.length)) requests.push({ createSlide: { objectId: sid, slideLayoutReference: { predefinedLayout: 'BLANK' } } });
      for (const d of plan.migrate ? [] : st.drop) drop.add(d);
      st.slides.forEach((sl, i) => {
        const sid = ids[i];
        // Only what changed is removed or added: elements that are the same keep their id (and any
        // comments attached to them). A person's own elements stay.
        const want = elementIds(sid, sl);
        const clearAll = plan.migrate || dirtySet.has(sid);
        const a = adopt.get(sid);
        for (const el of byId.get(sid)?.pageElements ?? []) {
          if (a.keepIds.has(el.objectId)) continue;
          if (clearAll || ours(el.objectId)) requests.push({ deleteObject: { objectId: el.objectId } });
        }
        requests.push(...a.updates);
        const draw = slideRequests(sid, sl, urls, { skipIdx: a.keepIdx });
        requests.push(...draw);
        // New text drawn under a kept shape would be hidden: keep text on top.
        const texts = sl.elements.map((el, j) => (el.type === 'text' && !a.keepIdx.has(j) ? want[j] : null)).filter(Boolean);
        const keptTexts = (byId.get(sid)?.pageElements ?? []).filter((e) => a.keepIds.has(e.objectId) && e.shape?.shapeType === 'TEXT_BOX').map((e) => e.objectId);
        if (draw.length && texts.length + keptTexts.length) requests.push({ updatePageElementsZOrder: { pageElementObjectIds: [...keptTexts, ...texts], operation: 'BRING_TO_FRONT' } });
      });
      order.push(...ids);
      next.sections[st.key] = { hash: st.hash, slides: ids };
    }
    const gone = [...drop].filter((d) => !order.includes(d));
    for (const d of gone) requests.push({ deleteObject: { objectId: d } });
    // Studio slides in section order at the top; slides a person added keep their order after them.
    // updateSlidesPosition moves one slide at a time here, against a simulated arrangement.
    const arr = [...current.map((s) => s.objectId), ...order.filter((x) => !byId.has(x))].filter((x) => !gone.includes(x));
    order.forEach((sid, i) => {
      const p = arr.indexOf(sid);
      if (p === i) return;
      requests.push({ updateSlidesPosition: { slideObjectIds: [sid], insertionIndex: i } });
      arr.splice(p, 1);
      arr.splice(i, 0, sid);
    });
    if (requests.length) await batch(id, requests);
    return { state: next, slides: arr.length, changed: todo.map((t) => t.key), unchanged: plan.unchanged, removed: gone.length, migrated: plan.migrate };
  } finally {
    await cleanup();
  }
}

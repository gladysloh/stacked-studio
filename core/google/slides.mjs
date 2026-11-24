import fs from 'node:fs';
import path from 'node:path';
import { readJsonl, slugify, writeFileAtomic, writeYamlAtomic, readYaml } from '../fsutil.mjs';
import { putMedia } from '../media.mjs';
import { clientDir, layout } from '../workspace.mjs';
import { StudioError } from '../errors.mjs';
import { fileId, gfetch, hosts } from './api.mjs';

// Google Slides decks into a client's decks/<slug>/: deck.yaml (ids, revision), slides.md (text and
// speaker notes per slide), comments.jsonl (every thread, with resolved state), and optionally a
// thumbnail per slide. Re-importing refreshes the mirror; nothing outside the deck folder changes.

const CODE = /\b[A-Z]{2,4}\d{3}\b/;

function textOf(elements = [], shapesOnly = null) {
  const out = [];
  const visit = (els) => {
    for (const e of els ?? []) {
      const runs = e.shape?.text?.textElements ?? [];
      const t = runs.map((r) => r.textRun?.content ?? '').join('').trim();
      if (t) out.push(t);
      if (t && shapesOnly) shapesOnly.push(t);
      if (e.table) for (const row of e.table.tableRows ?? []) for (const cell of row.tableCells ?? []) {
        const ct = (cell.text?.textElements ?? []).map((r) => r.textRun?.content ?? '').join('').trim();
        if (ct) out.push(ct);
      }
      if (e.elementGroup) visit(e.elementGroup.children);
    }
  };
  visit(elements);
  return out.join('\n');
}

/** The slide (page object id) a Slides comment is anchored to, if any. */
export function anchorPage(anchor) {
  if (!anchor) return null;
  try {
    const a = typeof anchor === 'string' ? JSON.parse(anchor) : anchor;
    return a.page ?? a.pages?.[0] ?? null;
  } catch {
    return null;
  }
}

export async function fetchComments(id) {
  const out = [];
  let page = '';
  const fields = 'nextPageToken,comments(id,author(displayName),content,quotedFileContent,resolved,createdTime,modifiedTime,anchor,replies(id,author(displayName),content,createdTime,action))';
  do {
    const r = await gfetch(`${hosts().drive}/files/${id}/comments?fields=${encodeURIComponent(fields)}&pageSize=100&includeDeleted=false${page ? `&pageToken=${page}` : ''}`);
    out.push(...(r.comments ?? []));
    page = r.nextPageToken ?? '';
  } while (page);
  return out;
}

/** Every deck linked in client.yaml (links.decks), for a re-sync without a link. */
export function linkedDecks(client) {
  return (readYaml(path.join(clientDir(client), 'client.yaml'), {})?.links?.decks ?? []).map((d) => (typeof d === 'string' ? d : d.slides_id ?? d.url)).filter(Boolean);
}

export async function importDeck(client, ref, { thumbnails = false } = {}) {
  const id = fileId(ref);
  const deck = await gfetch(`${hosts().slides}/presentations/${id}`);
  const meta = await gfetch(`${hosts().drive}/files/${id}?fields=id,name,modifiedTime,webViewLink,headRevisionId&supportsAllDrives=true`);
  const slug = slugify((deck.title ?? meta.name ?? id).replace(/^\[[^\]]*\]\s*/, ''));
  const dir = path.join(layout.decks(client), slug);

  const slides = (deck.slides ?? []).map((s, i) => {
    const shapeText = [];
    const body = textOf(s.pageElements, shapeText);
    const notes = textOf(s.slideProperties?.notesPage?.pageElements).replace(/^Click to add speaker notes$/m, '').trim();
    // A code in its own box (drawn on top) beats one in a table cell, which may sit hidden underneath.
    const inShapes = [...new Set(shapeText.join('\n').match(new RegExp(CODE.source, 'g')) ?? [])];
    const codes = inShapes.length ? inShapes : [...new Set(body.match(new RegExp(CODE.source, 'g')) ?? [])];
    return { n: i + 1, page_id: s.objectId, title: body.split('\n')[0]?.slice(0, 120) ?? '', body, notes, codes, code: codes[0] ?? null };
  });
  // A slide template can carry a leftover code box (the same code on many slides). When a slide has
  // several codes, the one that appears on the fewest slides is its own.
  const freq = new Map();
  for (const s of slides) for (const c of s.codes) freq.set(c, (freq.get(c) ?? 0) + 1);
  for (const s of slides) if (s.codes.length > 1) s.code = [...s.codes].sort((a, b) => freq.get(a) - freq.get(b))[0];

  if (thumbnails) {
    for (const s of slides) {
      const t = await gfetch(`${hosts().slides}/presentations/${id}/pages/${s.page_id}/thumbnail?thumbnailProperties.mimeType=PNG&thumbnailProperties.thumbnailSize=MEDIUM`);
      const res = await fetch(t.contentUrl, { signal: AbortSignal.timeout(60_000) });
      if (res.ok) s.thumbnail = putMedia(Buffer.from(await res.arrayBuffer()), 'image/png').sha;
    }
  }

  const raw = await fetchComments(id);
  // Comments migrated from New Gen Studio keep Google's id in source_id.
  const previous = new Map(readJsonl(path.join(dir, 'comments.jsonl')).map((c) => [c.source_id ?? c.id, c]));
  const byPage = new Map(slides.map((s) => [s.page_id, s]));
  const comments = raw.map((c) => {
    const text = `${c.quotedFileContent?.value ?? ''} ${c.content ?? ''}`;
    const on = byPage.get(anchorPage(c.anchor));
    return {
      id: c.id,
      author: c.author?.displayName ?? null,
      body: c.content ?? '',
      quote: c.quotedFileContent?.value ?? null,
      resolved: Boolean(c.resolved),
      created: c.createdTime,
      modified: c.modifiedTime,
      asset_code: on?.code ?? text.match(CODE)?.[0] ?? previous.get(c.id)?.asset_code ?? null,
      slide: on?.n ?? previous.get(c.id)?.slide ?? null,
      replies: (c.replies ?? []).map((r) => ({ id: r.id, author: r.author?.displayName ?? null, body: r.content ?? '', action: r.action ?? null, created: r.createdTime })),
    };
  });

  const existing = readYaml(path.join(dir, 'deck.yaml'), {}) ?? {};
  writeYamlAtomic(path.join(dir, 'deck.yaml'), {
    ...existing,
    title: deck.title ?? meta.name,
    source: 'google_slides',
    slides_id: id,
    url: meta.webViewLink ?? `https://docs.google.com/presentation/d/${id}/edit`,
    modified: meta.modifiedTime ?? null,
    revision: meta.headRevisionId ?? deck.revisionId ?? null,
    synced: new Date().toISOString(),
    slide_count: slides.length,
    slides: slides.map(({ n, page_id, code, thumbnail }) => ({ n, page_id, ...(code ? { code } : {}), ...(thumbnail ? { thumbnail } : {}) })),
  });
  writeFileAtomic(path.join(dir, 'slides.md'), `# ${deck.title ?? meta.name}\n\n` + slides.map((s) => `## Slide ${s.n}${s.title ? ` — ${s.title.split('\n')[0]}` : ''}\n\n${s.body}${s.notes ? `\n\nSpeaker notes: ${s.notes}` : ''}\n`).join('\n'));
  writeFileAtomic(path.join(dir, 'comments.jsonl'), comments.map((c) => JSON.stringify(c)).join('\n') + (comments.length ? '\n' : ''));

  // Remember the deck in client.yaml so `deck import <client>` re-syncs it later.
  const cfgFile = path.join(clientDir(client), 'client.yaml');
  const cfg = readYaml(cfgFile, {}) ?? {};
  const decks = cfg.links?.decks ?? [];
  if (!decks.some((d) => (typeof d === 'string' ? d.includes(id) : d.slides_id === id || String(d.url ?? '').includes(id)))) {
    cfg.links = { ...(cfg.links ?? {}), decks: [...decks, { title: deck.title ?? meta.name, url: meta.webViewLink ?? `https://docs.google.com/presentation/d/${id}/edit`, slides_id: id }] };
    writeYamlAtomic(cfgFile, cfg);
  }

  const newOnes = comments.filter((c) => !previous.has(c.id)).length;
  const nowResolved = comments.filter((c) => c.resolved && previous.get(c.id) && !previous.get(c.id).resolved).length;
  return { deck: slug, folder: path.relative(path.dirname(clientDir(client)), dir), slides: slides.length, comments: comments.length, open: comments.filter((c) => !c.resolved).length, new_comments: newOnes, newly_resolved: nowResolved, codes: [...new Set(slides.map((s) => s.code).filter(Boolean))], thumbnails: thumbnails ? slides.filter((s) => s.thumbnail).length : 0, first_import: !fs.existsSync(dir) || previous.size === 0 };
}

/**
 * The current visual for each asset code, from the latest slide carrying the code in the client's
 * working deck: the images in the creative-idea box (left of the slide, below the header). One image
 * filling the box is used at full size; a mock-up built from several images is cropped from a render
 * of the slide. Stored in the media cache and recorded in the deliverable's files
 * (role "visual", source "working-deck"), so review decks show what's in the deck today.
 */
export async function pullDeckVisuals(client, project, codes) {
  const { listDeliverables, deliverableDir } = await import('../workspace.mjs');
  const { writeYamlAtomic } = await import('../fsutil.mjs');
  const cfg = readYaml(path.join(clientDir(client), 'client.yaml'), {}) ?? {};
  const working = (cfg.links?.decks ?? []).find((d) => typeof d === 'object' && d.working) ?? (cfg.links?.decks ?? [])[0];
  if (!working) throw new StudioError(`${client} has no working deck linked.`);
  const id = fileId(typeof working === 'string' ? working : working.slides_id ?? working.url);
  const deck = await gfetch(`${hosts().slides}/presentations/${id}`);
  const dir = path.join(layout.decks(client), slugify((deck.title ?? '').replace(/^\[[^\]]*\]\s*/, '')));
  const meta = readYaml(path.join(dir, 'deck.yaml'), {}) ?? {};
  const out = [];
  const want = new Set(codes.map((c) => c.toUpperCase()));
  const known = new Set(listDeliverables(client, project).map((d) => d.code.toUpperCase()));
  for (const code of want) {
    const n = (meta.slides ?? []).filter((s) => s.code === code).map((s) => s.n).at(-1);
    const slide = n ? deck.slides[n - 1] : null;
    if (!slide || !known.has(code)) {
      out.push({ code, ok: false, error: slide ? 'no deliverable folder' : 'not in the working deck' });
      continue;
    }
    const PW = deck.pageSize.width.magnitude;
    const PH = deck.pageSize.height.magnitude;
    const imgs = [];
    const visit = (els) => {
      for (const e of els ?? []) {
        const t = e.transform ?? {};
        if (e.image && e.size) {
          const w = e.size.width.magnitude * Math.abs(t.scaleX ?? 1);
          const h = e.size.height.magnitude * Math.abs(t.scaleY ?? 1);
          imgs.push({ e, x: t.translateX ?? 0, y: t.translateY ?? 0, w, h, area: w * h });
        }
        if (e.elementGroup) visit(e.elementGroup.children);
      }
    };
    visit(slide.pageElements);
    // The creative-idea box: images starting in the left third, below the header band.
    const box = imgs.filter((i) => i.x < PW * 0.35 && i.y > PH * 0.18 && i.w > PW * 0.04);
    if (!box.length) {
      out.push({ code, ok: false, slide: n, error: 'no visual in the creative-idea box' });
      continue;
    }
    const main = box.sort((a, b) => b.area - a.area)[0];
    const inside = box.filter((i) => i !== main && i.x < main.x + main.w && i.x + i.w > main.x && i.y < main.y + main.h && i.y + i.h > main.y);
    let m;
    let mime;
    if (!inside.length && main.e.image.contentUrl) {
      const res = await fetch(main.e.image.contentUrl, { signal: AbortSignal.timeout(60_000) });
      mime = (res.headers.get('content-type') ?? 'image/png').split(';')[0];
      m = putMedia(Buffer.from(await res.arrayBuffer()), mime);
    } else {
      // A mock-up: crop the box from a render of the slide.
      const all = [main, ...inside];
      const l = Math.min(...all.map((i) => i.x)) / PW;
      const t = Math.min(...all.map((i) => i.y)) / PH;
      const r = Math.max(...all.map((i) => i.x + i.w)) / PW;
      const b = Math.max(...all.map((i) => i.y + i.h)) / PH;
      const th = await gfetch(`${hosts().slides}/presentations/${id}/pages/${slide.objectId}/thumbnail?thumbnailProperties.mimeType=PNG&thumbnailProperties.thumbnailSize=LARGE`);
      const res = await fetch(th.contentUrl, { signal: AbortSignal.timeout(60_000) });
      const shot = putMedia(Buffer.from(await res.arrayBuffer()), 'image/png');
      const { runMedia } = await import('../py.mjs');
      const c = await runMedia('crop', { sha: shot.sha, box: [l, t, Math.min(r, 1), Math.min(b, 1)] });
      mime = 'image/png';
      m = { sha: c.files[0].sha, width: c.width, height: c.height };
    }
    const file = path.join(deliverableDir(client, project, code), 'deliverable.yaml');
    const d = readYaml(file, {}) ?? {};
    d.files ??= [];
    const entry = { sha: m.sha, mime, width: m.width ?? null, height: m.height ?? null, role: 'visual', name: `Working deck · slide ${n}`, source: 'working-deck', slide: n, ...(inside.length ? { mockup: true } : {}), pulled: new Date().toISOString() };
    // The latest visual goes last (the review deck shows the last one as "Current").
    // Earlier pulls are replaced; visuals from the .pptx import stay as earlier rounds.
    d.files = [...d.files.filter((f) => f.sha !== m.sha && f.source !== 'working-deck'), entry];
    writeYamlAtomic(file, d);
    out.push({ code, ok: true, slide: n, sha: m.sha, width: m.width, height: m.height, mockup: inside.length > 0 });
  }
  return { client, project, visuals: out };
}

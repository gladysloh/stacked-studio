import fs from 'node:fs';
import path from 'node:path';
import { readJsonl, slugify, writeFileAtomic, writeYamlAtomic, readYaml } from '../fsutil.mjs';
import { putMedia } from '../media.mjs';
import { clientDir, layout } from '../workspace.mjs';
import { fileId, gfetch, hosts } from './api.mjs';

// Google Slides decks into a client's decks/<slug>/: deck.yaml (ids, revision), slides.md (text and
// speaker notes per slide), comments.jsonl (every thread, with resolved state), and optionally a
// thumbnail per slide. Re-importing refreshes the mirror; nothing outside the deck folder changes.

const CODE = /\b[A-Z]{2,4}\d{3}\b/;

function textOf(elements = []) {
  const out = [];
  const visit = (els) => {
    for (const e of els ?? []) {
      const runs = e.shape?.text?.textElements ?? [];
      const t = runs.map((r) => r.textRun?.content ?? '').join('').trim();
      if (t) out.push(t);
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
    const body = textOf(s.pageElements);
    const notes = textOf(s.slideProperties?.notesPage?.pageElements).replace(/^Click to add speaker notes$/m, '').trim();
    return { n: i + 1, page_id: s.objectId, title: body.split('\n')[0]?.slice(0, 120) ?? '', body, notes, code: body.match(CODE)?.[0] ?? null };
  });

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
  const comments = raw.map((c) => {
    const text = `${c.quotedFileContent?.value ?? ''} ${c.content ?? ''}`;
    return {
      id: c.id,
      author: c.author?.displayName ?? null,
      body: c.content ?? '',
      quote: c.quotedFileContent?.value ?? null,
      resolved: Boolean(c.resolved),
      created: c.createdTime,
      modified: c.modifiedTime,
      asset_code: text.match(CODE)?.[0] ?? previous.get(c.id)?.asset_code ?? null,
      slide: previous.get(c.id)?.slide ?? null,
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

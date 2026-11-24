import path from 'node:path';
import { StudioError } from './errors.mjs';
import { readYaml, slugify, writeYamlAtomic } from './fsutil.mjs';
import { mediaPath, putMedia } from './media.mjs';
import { clientDir, layout, SCRATCH } from './workspace.mjs';
import { checkIds } from './library.mjs';

// Moodboards: clients/<client>/research/<board>/board.yaml — references with where they came from and
// what to take from each. Images are downloaded into the media cache so they can be used as inputs.
// Research is "unverified" context: it never becomes brand rules by itself.

const MAX_IMAGE = 25 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** Downloads one image URL (http/https only, image types only, size-capped) into the media cache. */
export async function downloadImage(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new StudioError(`"${String(url).slice(0, 80)}" isn't a link.`);
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new StudioError('Only http(s) image links can be saved.');
  const res = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(30_000), headers: { 'user-agent': 'stacked-studio (moodboard)' } });
  if (!res.ok) throw new StudioError(`Couldn't download the image (${res.status}).`);
  const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  if (!IMAGE_TYPES.has(mime)) throw new StudioError(`That link isn't an image (${mime || 'unknown type'}).`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_IMAGE) throw new StudioError('That image is larger than 25 MB.');
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > MAX_IMAGE) throw new StudioError('That image is larger than 25 MB.');
  return putMedia(data, mime);
}

const boardFile = (client, slug) => layout.board(client, slug);

/**
 * Creates or extends a board. Items: { title, url, image_url | sha, take, tags, source }.
 * Items already on the board (same url or image) are skipped; a failed download keeps the item
 * with its link and says why, so nothing found is lost.
 */
export async function saveMoodboard({ client, name, for: purpose, notes, items = [] }) {
  const c = client ?? SCRATCH;
  if (!name?.trim()) throw new StudioError('A board needs a name.');
  const slug = slugify(name);
  const file = boardFile(c, slug);
  const board = readYaml(file, null) ?? { name: name.trim(), created: new Date().toISOString(), items: [] };
  if (purpose) board.for = purpose;
  if (notes) board.notes = notes;
  board.items ??= [];
  const have = new Set(board.items.flatMap((i) => [i.url, i.image_url, i.sha].filter(Boolean)));
  let added = 0;
  const problems = [];
  const unknownShots = new Set();
  for (const it of items) {
    if ([it.url, it.image_url, it.sha].some((k) => k && have.has(k))) continue;
    const tagged = checkIds(it.shots ?? []);
    for (const u of tagged.unknown) unknownShots.add(u);
    const entry = { title: it.title ?? null, url: it.url ?? null, image_url: it.image_url ?? null, take: it.take ?? null, subject: it.subject ?? null, shots: tagged.ok, tags: it.tags ?? [], source: it.source ?? null };
    if (it.sha) entry.sha = it.sha;
    else if (it.image_url) {
      // Try the full-size image, then the fallback (e.g. Pinterest's feed-size copy).
      for (const link of [it.image_url, it.fallback_url].filter(Boolean)) {
        try {
          entry.sha = (await downloadImage(link)).sha;
          delete entry.download_error;
          break;
        } catch (err) {
          entry.download_error = err.message;
        }
      }
      if (entry.download_error) problems.push({ title: it.title ?? it.image_url, error: entry.download_error });
    }
    board.items.push(Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== null && !(Array.isArray(v) && !v.length))));
    for (const k of [it.url, it.image_url, it.sha]) if (k) have.add(k);
    added++;
  }
  board.updated = new Date().toISOString();
  writeYamlAtomic(file, board);
  // Images saved but not yet tagged: the agent opens these and tags them (reference_tag).
  const untagged = board.items.map((i, index) => ({ index, title: i.title ?? null, file: i.sha ? mediaPath(i.sha) : null, shots: i.shots ?? [] })).filter((i) => i.file && !i.shots.length);
  return { client: c, board: slug, file: path.relative(path.dirname(clientDir(c)), file), items: board.items.length, added, problems, untagged, unknown_shots: [...unknownShots] };
}

export function readMoodboard(client, name) {
  const b = readYaml(boardFile(client ?? SCRATCH, slugify(name)), null);
  if (!b) throw new StudioError(`There's no board "${name}".`);
  return { ...b, items: (b.items ?? []).map((i) => ({ ...i, file: i.sha ? mediaPath(i.sha) : null })) };
}

// ---- Pinterest: public boards through their RSS feed (no login, no scraping) ----

const decode = (s) => String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

/** A Pinterest board link → its RSS feed URL. Works for public boards: pinterest.<tld>/<user>/<board>/. */
export function pinterestFeedUrl(link) {
  let u;
  try {
    u = new URL(link);
  } catch {
    throw new StudioError(`"${String(link).slice(0, 80)}" isn't a Pinterest board link.`);
  }
  if (!/(^|\.)pinterest\.[a-z.]+$/.test(u.hostname)) throw new StudioError('That is not a Pinterest link.');
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2 || parts[0] === 'pin') throw new StudioError('Use a board link like https://www.pinterest.com/<user>/<board>/.', 'For a single pin, save it with moodboard_save and its image link.');
  return `https://${u.hostname}/${parts[0]}/${parts[1].replace(/\.rss$/, '')}.rss`;
}

/** Reads a public Pinterest board's recent pins (Pinterest's feed shows the latest ~25–50). */
export async function pinterestBoard(link) {
  const feed = process.env.STACKED_PINTEREST_FEED ?? pinterestFeedUrl(link);
  const res = await fetch(feed, { signal: AbortSignal.timeout(30_000), headers: { 'user-agent': 'stacked-studio (moodboard)' } });
  if (!res.ok) throw new StudioError(`Pinterest didn't return the board (${res.status}). Is it public?`, 'Secret boards have no feed: make it public, or save pins one by one.');
  const xml = await res.text();
  const title = decode(xml.match(/<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/)?.[1]);
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const desc = decode(it.match(/<description>([\s\S]*?)<\/description>/)?.[1]);
    const img = desc.match(/<img[^>]+src="([^"]+)"/)?.[1] ?? null;
    return {
      title: decode(it.match(/<title>([\s\S]*?)<\/title>/)?.[1]) || null,
      url: decode(it.match(/<link>([\s\S]*?)<\/link>/)?.[1]) || null,
      // Feed images are small; the original size lives under /originals/.
      image_url: img ? img.replace(/\/\d+x(\d+)?\//, '/originals/') : null,
      fallback_url: img,
      note: desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null,
      source: 'pinterest',
    };
  });
  return { board: title || null, feed, pins: items };
}

/**
 * Tags references with shot-library ids (and optionally subject / what to take). Works on a
 * moodboard, the client's references or past work. Items are matched by index, sha or url.
 */
export function tagReferences({ client, board, where, tags }) {
  const c = client ?? SCRATCH;
  const file = board ? boardFile(c, slugify(board)) : where === 'past-work' ? layout.pastWork(c) : layout.references(c);
  const doc = readYaml(file, null);
  if (!doc?.items) throw new StudioError(board ? `There's no board "${board}".` : `No ${where ?? 'references'} file for ${c}.`);
  let updated = 0;
  const unknown = new Set();
  const missing = [];
  for (const t of tags) {
    const i = Number.isInteger(t.index) ? t.index : doc.items.findIndex((x) => (t.sha && x.sha === t.sha) || (t.url && (x.url === t.url || x.image_url === t.url)));
    const item = doc.items[i];
    if (!item) {
      missing.push(t.index ?? t.sha ?? t.url);
      continue;
    }
    const { ok, unknown: bad } = checkIds(t.shots ?? []);
    bad.forEach((b) => unknown.add(b));
    item.shots = [...new Set([...(t.replace ? [] : item.shots ?? []), ...ok])];
    if (t.subject) item.subject = t.subject;
    if (t.take) item.take = t.take;
    updated++;
  }
  writeYamlAtomic(file, doc);
  return { file: path.relative(path.dirname(clientDir(c)), file), updated, missing, unknown_shots: [...unknown] };
}

/**
 * Tags images inside a project's deliverables (e.g. earlier versions from the deck) by sha. Every
 * deliverable entry with that image gets the same tags.
 */
export async function tagDeliverableImages({ client, project, tags }) {
  const { listDeliverables } = await import('./workspace.mjs');
  const bySha = new Map(tags.map((t) => [t.sha, t]));
  const unknown = new Set();
  let updated = 0;
  for (const d of listDeliverables(client, project)) {
    const y = path.join(d.dir, 'deliverable.yaml');
    const meta = readYaml(y, null);
    if (!meta?.files) continue;
    let ch = false;
    for (const f of meta.files) {
      const t = bySha.get(f.sha);
      if (!t) continue;
      const { ok, unknown: bad } = checkIds(t.shots ?? []);
      bad.forEach((b) => unknown.add(b));
      f.shots = [...new Set([...(t.replace ? [] : f.shots ?? []), ...ok])];
      if (t.subject) f.subject = t.subject;
      if (t.take) f.take = t.take;
      ch = true;
      updated++;
    }
    if (ch) writeYamlAtomic(y, meta);
  }
  return { updated, unknown_shots: [...unknown] };
}

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { StudioError } from '../errors.mjs';
import { readJson, writeFileAtomic, writeJsonAtomic } from '../fsutil.mjs';
import { mediaPath, putMedia } from '../media.mjs';
import { paths } from '../paths.mjs';
import { fileId, gfetch, hosts } from './api.mjs';

// Google Drive as the shared asset library. Shared Drives are fully supported (supportsAllDrives
// on every call). The studio keeps only a listing (.cache/drive/<client>.jsonl, searchable) and
// downloads a file when it is actually used, caching it by content hash.

export const FOLDER = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,mimeType,modifiedTime,size,md5Checksum,description,webViewLink,parents,driveId';
const ALL = 'supportsAllDrives=true&includeItemsFromAllDrives=true';
const q = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export async function getFile(ref) {
  return gfetch(`${hosts().drive}/files/${fileId(ref)}?fields=${FIELDS}&supportsAllDrives=true`);
}

export async function listChildren(folderId) {
  const out = [];
  let page = '';
  do {
    const query = encodeURIComponent(`'${q(folderId)}' in parents and trashed = false`);
    const r = await gfetch(`${hosts().drive}/files?q=${query}&fields=nextPageToken,files(${FIELDS})&pageSize=1000&${ALL}${page ? `&pageToken=${page}` : ''}`);
    out.push(...(r.files ?? []));
    page = r.nextPageToken ?? '';
  } while (page);
  return out;
}

/** Every file under a folder, with its folder path. Stops at maxFiles so a huge drive can't run away. */
export async function walk(folderRef, { maxFiles = 20_000 } = {}) {
  const root = fileId(folderRef);
  const files = [];
  const queue = [{ id: root, path: '' }];
  while (queue.length && files.length < maxFiles) {
    const { id, path: p } = queue.shift();
    for (const f of await listChildren(id)) {
      if (f.mimeType === FOLDER) queue.push({ id: f.id, path: p ? `${p}/${f.name}` : f.name });
      else files.push({ ...f, folder_path: p });
    }
  }
  return { root, files, truncated: queue.length > 0 };
}

/**
 * Lists a client's Drive folders into .cache/drive/<client>.jsonl so search can find files.
 * roots: [{ id, label, read_only }]. Read-only folders are searched and fetched, never written to.
 */
export async function indexClientDrive(client, roots) {
  const rows = [];
  let truncated = false;
  const seen = new Set();
  for (const root of roots) {
    const w = await walk(root.id);
    truncated ||= w.truncated;
    for (const f of w.files) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      rows.push({ id: f.id, name: f.name, mimeType: f.mimeType, folder_path: [root.label, f.folder_path].filter(Boolean).join('/'), read_only: Boolean(root.read_only), modified: f.modifiedTime, size: f.size ? Number(f.size) : null, md5: f.md5Checksum ?? null, description: f.description ?? null, link: f.webViewLink ?? null });
    }
  }
  const file = path.join(paths().cache, 'drive', `${client}.jsonl`);
  writeFileAtomic(file, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  const byType = {};
  for (const r of rows) byType[r.mimeType.split('/')[0]] = (byType[r.mimeType.split('/')[0]] ?? 0) + 1;
  return { files: rows.length, by_type: byType, truncated, listing: path.relative(paths().workspace, file) };
}

// Drive id + md5 -> sha, so a file is downloaded once.
const fetchedFile = () => path.join(paths().cache, 'drive', 'fetched.json');

const EXPORTS = {
  'application/vnd.google-apps.presentation': { mime: 'application/pdf' },
  'application/vnd.google-apps.document': { mime: 'application/pdf' },
  'application/vnd.google-apps.drawing': { mime: 'image/png' },
};

/** Downloads a Drive file into the media cache (once). Google files are exported (PDF/PNG). */
export async function fetchFile(ref) {
  const meta = await getFile(ref);
  if (meta.mimeType === FOLDER) throw new StudioError(`"${meta.name}" is a folder. Fetch files inside it instead.`);
  const known = readJson(fetchedFile(), {}) ?? {};
  const hit = known[meta.id];
  if (hit && (!meta.md5Checksum || hit.md5 === meta.md5Checksum) && (!hit.modified || hit.modified === meta.modifiedTime) && mediaPath(hit.sha)) {
    return { drive_id: meta.id, name: meta.name, sha: hit.sha, mime: hit.mime, file: mediaPath(hit.sha), cached: true };
  }
  const exp = EXPORTS[meta.mimeType];
  if (meta.mimeType.startsWith('application/vnd.google-apps') && !exp) throw new StudioError(`"${meta.name}" is a Google file type the studio can't download (${meta.mimeType}).`);
  const url = exp ? `${hosts().drive}/files/${meta.id}/export?mimeType=${encodeURIComponent(exp.mime)}` : `${hosts().drive}/files/${meta.id}?alt=media&supportsAllDrives=true`;
  const res = await gfetch(url, { raw: true });
  const data = Buffer.from(await res.arrayBuffer());
  const mime = exp?.mime ?? meta.mimeType;
  const m = putMedia(data, mime);
  known[meta.id] = { sha: m.sha, mime, md5: meta.md5Checksum ?? null, modified: meta.modifiedTime ?? null, name: meta.name };
  writeJsonAtomic(fetchedFile(), known);
  return { drive_id: meta.id, name: meta.name, sha: m.sha, mime, file: m.file, width: m.width ?? null, height: m.height ?? null, cached: false };
}

/** Drive id for a hash we've fetched or saved before, if any. */
export function driveIdFor(sha) {
  const known = readJson(fetchedFile(), {}) ?? {};
  return Object.entries(known).find(([, v]) => v.sha === sha)?.[0] ?? null;
}

export async function createFolder(name, parentId) {
  return gfetch(`${hosts().drive}/files?supportsAllDrives=true&fields=${FIELDS}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }), retry: false });
}

/** Finds a child folder by name, creating it if it doesn't exist. */
export async function ensureFolder(name, parentId) {
  const query = encodeURIComponent(`'${q(parentId)}' in parents and name = '${q(name)}' and mimeType = '${FOLDER}' and trashed = false`);
  const r = await gfetch(`${hosts().drive}/files?q=${query}&fields=files(${FIELDS})&${ALL}`);
  return r.files?.[0] ?? createFolder(name, parentId);
}

/** Folder path like "Studio/2027-social/Approved" under a parent, created as needed. */
export async function ensurePath(parentId, rel) {
  let cur = { id: parentId };
  for (const part of String(rel).split('/').filter(Boolean)) cur = await ensureFolder(part, cur.id);
  return cur;
}

/** Uploads bytes as a new file (multipart). Never retried, so a file is never saved twice. */
export async function uploadFile({ data, name, mime, parentId, description }) {
  const boundary = `stacked${crypto.randomBytes(8).toString('hex')}`;
  const meta = JSON.stringify({ name, parents: [parentId], ...(description ? { description } : {}) });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: ${mime}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  return gfetch(`${hosts().upload}/files?uploadType=multipart&supportsAllDrives=true&fields=${FIELDS}`, { method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body, retry: false });
}

export async function uploadPath(file, { parentId, name, mime, description }) {
  return uploadFile({ data: fs.readFileSync(file), name: name ?? path.basename(file), mime, parentId, description });
}

/** Downloads any Drive file (e.g. a client pack zip) to a local path, outside the media cache. */
export async function downloadTo(ref, dest) {
  const meta = await getFile(ref);
  const res = await gfetch(`${hosts().drive}/files/${meta.id}?alt=media&supportsAllDrives=true`, { raw: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return { file: dest, name: meta.name, drive_id: meta.id };
}

/** Finds a file by exact name in a folder. */
export async function findByName(parentId, name) {
  const query = encodeURIComponent(`'${q(parentId)}' in parents and name = '${q(name)}' and trashed = false`);
  const r = await gfetch(`${hosts().drive}/files?q=${query}&fields=files(${FIELDS})&${ALL}`);
  return r.files?.[0] ?? null;
}

/** Replaces a file's content, keeping its id and link (Drive keeps the old version in its history). */
export async function updateFile(id, { data, mime }) {
  return gfetch(`${hosts().upload}/files/${id}?uploadType=media&supportsAllDrives=true&fields=${FIELDS}`, { method: 'PATCH', headers: { 'content-type': mime }, body: data, retry: false });
}

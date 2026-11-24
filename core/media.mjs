import fs from 'node:fs';
import path from 'node:path';
import { sha256, writeFileAtomic } from './fsutil.mjs';
import { imageSize } from './imagesize.mjs';
import { paths } from './paths.mjs';
import { StudioError } from './errors.mjs';

// The media cache: every image or video stored once by its content hash, in .cache/media/ab/abcd….png.
// Records refer to media by sha256 (and by Drive file id once uploaded), never by a folder path, so
// the same image can be used by many projects and the cache can be refilled from Drive.

export const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
};
export const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'application/pdf': '.pdf' };

export const mimeFromName = (name) => MIME[path.extname(name).toLowerCase()] ?? null;
export const isImage = (mime) => /^image\//.test(mime ?? '');

/** Stores bytes; storing the same bytes twice is a no-op. Returns { sha, mime, file, bytes, width, height }. */
export function putMedia(data, mime) {
  const ext = EXT[mime];
  if (!ext) throw new StudioError(`Can't store a file of type ${mime}.`);
  const sha = sha256(data);
  const file = path.join(paths().media, sha.slice(0, 2), sha + ext);
  if (!fs.existsSync(file)) writeFileAtomic(file, data);
  return { sha, mime, file, bytes: data.length, ...(isImage(mime) ? imageSize(data) : {}) };
}

/** The local file for a hash, or null if it isn't cached (fetch it from Drive then). */
export function mediaPath(sha) {
  if (!/^[0-9a-f]{64}$/.test(sha ?? '')) return null;
  const dir = path.join(paths().media, sha.slice(0, 2));
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const hit = names.find((n) => n.startsWith(sha + '.'));
  return hit ? path.join(dir, hit) : null;
}

/** Brings a local file into the cache (reference images given by path). */
export function importFile(file) {
  const full = file.startsWith('~') ? path.join(process.env.HOME || '', file.slice(1)) : path.resolve(file);
  const mime = mimeFromName(full);
  if (!mime) throw new StudioError(`"${path.basename(full)}" isn't a supported image or video file.`);
  let data;
  try {
    data = fs.readFileSync(full);
  } catch {
    throw new StudioError(`Can't read "${file}".`);
  }
  return { ...putMedia(data, mime), name: path.basename(full) };
}

export function readMedia(sha) {
  const file = mediaPath(sha);
  if (!file) return null;
  return { sha, file, data: fs.readFileSync(file), mime: mimeFromName(file) };
}

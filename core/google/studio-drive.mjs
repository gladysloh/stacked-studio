
import path from 'node:path';
import { teamConfig } from '../config.mjs';
import { StudioError } from '../errors.mjs';
import { readYaml, slugify, writeJsonAtomic, readJson, writeYamlAtomic } from '../fsutil.mjs';
import { EXT, mediaPath } from '../media.mjs';
import { paths } from '../paths.mjs';
import { addReview, requireGeneration, reviewsFor, withReview } from '../records.mjs';
import { SCRATCH, clientDir, readClient } from '../workspace.mjs';
import { fileId } from './api.mjs';
import { ensurePath, getFile, indexClientDrive, uploadPath } from './drive.mjs';

// How the studio uses Drive:
//   team.yaml  google.root_folder_id   the team's Shared Drive (or a folder in it)
//   client.yaml links.drive_folder     each client's folder, made by `studio drive init <client>`
//   saved images go to  <client folder>/<save_path>/<project>/   (save_path default "Studio")

const folderLink = (id) => `https://drive.google.com/drive/folders/${id}`;

export function clientFolderId(client) {
  if (client === SCRATCH) {
    const s = teamConfig().google?.scratch_folder_id;
    return s ? fileId(s) : null;
  }
  const f = readClient(client).links?.drive_folder;
  if (!f) return null;
  return fileId(typeof f === 'string' ? f : f.id ?? f.url);
}

function setClientFolder(client, id, url) {
  const file = path.join(clientDir(client), 'client.yaml');
  const c = readYaml(file, {});
  c.links = { ...(c.links ?? {}), drive_folder: { id, url: url ?? folderLink(id) } };
  writeYamlAtomic(file, c);
}

/** Read-only folders (e.g. where working decks live): indexed and fetched, never written to. */
export function readOnlyFolders(client) {
  if (client === SCRATCH) return [];
  return (readClient(client).links?.drive_read ?? []).map((f) => (typeof f === 'string' ? { id: fileId(f) } : { ...f, id: fileId(f.id ?? f.url) }));
}

/** Points a client at an existing Drive folder: the one the studio saves to, or (readOnly) one it only reads. */
export async function linkClientFolder(client, ref, { readOnly = false } = {}) {
  const meta = await getFile(ref);
  if (meta.mimeType !== 'application/vnd.google-apps.folder') throw new StudioError(`"${meta.name}" is not a folder.`);
  const url = meta.webViewLink ?? folderLink(meta.id);
  if (readOnly) {
    const file = path.join(clientDir(client), 'client.yaml');
    const c = readYaml(file, {});
    const list = (c.links?.drive_read ?? []).filter((f) => (typeof f === 'string' ? fileId(f) : f.id) !== meta.id);
    c.links = { ...(c.links ?? {}), drive_read: [...list, { id: meta.id, name: meta.name, url }] };
    if (clientFolderId(client) === meta.id) delete c.links.drive_folder;
    writeYamlAtomic(file, c);
    return { client, folder: meta.name, id: meta.id, url, read_only: true };
  }
  if (readOnlyFolders(client).some((f) => f.id === meta.id)) throw new StudioError(`"${meta.name}" is linked as read-only for ${client}.`, 'Pick a folder in the team Shared Drive to save into.');
  setClientFolder(client, meta.id, url);
  return { client, folder: meta.name, id: meta.id, url, read_only: false };
}

/** Creates the client's folder in the team's Shared Drive (or reuses one with the same name). */
export async function initClientFolder(client) {
  const existing = clientFolderId(client);
  if (existing) return { client, id: existing, url: folderLink(existing), created: false };
  const root = teamConfig().google?.root_folder_id;
  if (!root) throw new StudioError('The team pack has no google.root_folder_id (the Shared Drive to use).', 'Or link an existing folder: studio drive link <client> <folder link>');
  const c = readClient(client);
  const folder = await ensurePath(fileId(root), c.name);
  setClientFolder(client, folder.id, folder.webViewLink);
  return { client, id: folder.id, url: folder.webViewLink ?? folderLink(folder.id), created: true };
}

export async function indexDrive(client) {
  const id = clientFolderId(client);
  const roots = [...(id ? [{ id, label: '', read_only: false }] : []), ...readOnlyFolders(client).map((f) => ({ id: f.id, label: f.name ?? 'Read-only', read_only: true }))];
  if (!roots.length) throw new StudioError(`${client} has no Drive folder yet.`, `studio drive init ${client}   (or: studio drive link ${client} <folder link> [--read-only])`);
  return indexClientDrive(client, roots);
}

/**
 * Saves an image to Drive and records it ("save" in the review log, with the Drive id). Saving the
 * same image again returns the first upload instead of making a copy.
 */
export async function saveToDrive({ id, output = 0, folder = null, name = null }) {
  const g = withReview(requireGeneration(id));
  const o = g.outputs[output];
  if (!o) throw new StudioError(`That image has ${g.outputs.length} outputs.`);
  const prior = reviewsFor(g.client, g.project).filter((e) => e.target === id && (e.output ?? 0) === output && e.action === 'save').at(-1);
  if (prior && !folder) return { id, output, already_saved: true, ...prior.value };
  const file = mediaPath(o.sha);
  if (!file) throw new StudioError("The image file isn't on this computer.", 'Fetch it first (drive_fetch), or ask the teammate who made it to save it.');

  let parentId;
  if (folder && readOnlyFolders(g.client).some((f) => f.id === fileId(folder))) throw new StudioError('That folder is read-only for the studio.', `Save to the client's own folder (leave out the folder), or another folder in the team Shared Drive.`);
  if (folder) parentId = fileId(folder);
  else {
    const base = clientFolderId(g.client);
    if (!base) throw new StudioError(g.client === SCRATCH ? 'Images without a client need a folder to save to.' : `${g.client} has no Drive folder yet.`, g.client === SCRATCH ? 'Pass a folder link.' : `studio drive init ${g.client}`);
    const savePath = teamConfig().google?.save_path ?? 'Studio';
    parentId = (await ensurePath(base, `${savePath}/${g.project}`)).id;
  }
  const label = slugify([g.deliverable ?? g.project, g.concept].filter(Boolean).join(' ')).toUpperCase().replace(/-/g, '_');
  const fileName = name ?? `${label}_v${g.version}${g.outputs.length > 1 ? `_${output + 1}` : ''}_${o.status === 'approved' ? 'APPROVED_' : ''}${id.slice(-6)}${EXT[o.mime] ?? '.png'}`;
  const description = [`stacked-studio ${id} output ${output}`, g.prompt ? `Prompt: ${g.prompt.slice(0, 1500)}` : null].filter(Boolean).join('\n');
  const up = await uploadPath(file, { parentId, name: fileName, mime: o.mime ?? 'image/png', description });
  const value = { drive_id: up.id, link: up.webViewLink ?? `https://drive.google.com/file/d/${up.id}/view`, folder_id: parentId, name: up.name };
  addReview({ target: id, output, action: 'save', value });
  const known = readJson(path.join(paths().cache, 'drive', 'fetched.json'), {}) ?? {};
  known[up.id] = { sha: o.sha, mime: o.mime, md5: up.md5Checksum ?? null, modified: up.modifiedTime ?? null, name: up.name };
  writeJsonAtomic(path.join(paths().cache, 'drive', 'fetched.json'), known);
  return { id, output, status: o.status, ...value };
}

/** Uploads a client pack zip to the team's Shared Drive (_client-packs/), for teammates to import. */
export async function uploadClientPack(zipFile) {
  const root = teamConfig().google?.root_folder_id;
  if (!root) throw new StudioError('The team pack has no google.root_folder_id.', 'Share the zip by hand, or add the Shared Drive to team.yaml.');
  const folder = await ensurePath(fileId(root), '_client-packs');
  const up = await uploadPath(zipFile, { parentId: folder.id, mime: 'application/zip', description: 'stacked-studio client pack: studio client import <this link>' });
  return { drive_id: up.id, link: up.webViewLink ?? `https://drive.google.com/file/d/${up.id}/view`, name: up.name };
}


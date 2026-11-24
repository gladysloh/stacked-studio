
import path from 'node:path';
import { teamConfig } from '../config.mjs';
import { StudioError } from '../errors.mjs';
import { readYaml, slugify, writeJsonAtomic, readJson, writeYamlAtomic } from '../fsutil.mjs';
import { EXT, mediaPath } from '../media.mjs';
import { paths } from '../paths.mjs';
import { addReview, requireGeneration, reviewsFor, withReview } from '../records.mjs';
import { SCRATCH, clientDir, readClient } from '../workspace.mjs';
import { fileId } from './api.mjs';
import { downloadTo, ensurePath, findByName, getFile, indexClientDrive, updateFile, uploadPath } from './drive.mjs';

// How the studio uses Drive:
//   team.yaml  google.root_folder_id   the team's Shared Drive (or a folder in it)
//   client.yaml links.drive_folder     each client's folder, made by `studio drive init <client>`
//   saved images go to  <client folder>/<project name>/01_Generated (or 03_Final once approved)

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
// Project folders on Drive, for generated images and review. The folder an image is in is its status,
// with one subfolder per asset (deliverable code):
//   <client folder>/<project name>/01_Generated/<CODE>/   needs review (every new version)
//                                 02_Rejected/<CODE>/    didn't make it
//                                 03_Final/<CODE>/       approved
//                                 04_Review Decks/
// Approving or rejecting a saved image moves its Drive file (same id and link).
// The team can rename them in team.yaml (google.project_folders); the keys stay the same.
export const PROJECT_FOLDERS = { working: '01_Generated', rejected: '02_Rejected', final: '03_Final', decks: '04_Review Decks' };
const statusFolder = (status) => (status === 'approved' ? 'final' : status === 'rejected' ? 'rejected' : 'working');
export const projectFolderNames = () => ({ ...PROJECT_FOLDERS, ...(teamConfig().google?.project_folders ?? {}) });

/** Creates (or finds) the project's numbered folders in the client's Drive folder and records their ids in project.yaml. */
export async function ensureProjectFolders(client, project) {
  const base = clientFolderId(client);
  if (!base) throw new StudioError(`${client} has no Drive folder yet.`, `studio drive init ${client}`);
  const file = path.join(clientDir(client), 'projects', project, 'project.yaml');
  const meta = readYaml(file, null);
  if (!meta) throw new StudioError(`There's no project "${project}" for ${client}.`);
  const top = await ensurePath(base, meta.name ?? project);
  const folders = { folder: top.id };
  for (const [key, name] of Object.entries(projectFolderNames())) folders[key] = (await ensurePath(top.id, name)).id;
  meta.links = { ...(meta.links ?? {}), drive: folders };
  writeYamlAtomic(file, meta);
  return { client, project, name: meta.name ?? project, url: `https://drive.google.com/drive/folders/${top.id}`, folders };
}

/** The Drive folder id for one of a project's numbered folders, creating them on first use. */
export async function projectFolder(client, project, key) {
  const known = readYaml(path.join(clientDir(client), 'projects', project, 'project.yaml'), {})?.links?.drive;
  if (known?.[key]) return known[key];
  return (await ensureProjectFolders(client, project)).folders[key];
}

/** The folder a version belongs in: <status folder>/<asset code>. */
async function versionFolder(g, status) {
  return (await ensurePath(await projectFolder(g.client, g.project, statusFolder(status)), g.deliverable ?? 'Other')).id;
}

/**
 * Moves a saved version's Drive file to the folder for its current status (same file, same link).
 * Returns null when it was never saved; { moved: false } when it's already in place.
 */
export async function placeSaved(id, output = 0) {
  const g = withReview(requireGeneration(id));
  const o = g.outputs[output];
  const prior = reviewsFor(g.client, g.project).filter((e) => e.target === id && (e.output ?? 0) === output && e.action === 'save').at(-1);
  if (!o || !prior?.value?.drive_id || g.client === SCRATCH) return null;
  const want = await versionFolder(g, o.status);
  const meta = await getFile(prior.value.drive_id);
  const parents = meta.parents ?? [];
  if (parents.includes(want)) return { id, output, moved: false, status: o.status };
  const { gfetch, hosts } = await import('./api.mjs');
  await gfetch(`${hosts().drive}/files/${meta.id}?addParents=${want}&removeParents=${parents.join(',')}&supportsAllDrives=true&fields=id`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{}' });
  addReview({ target: id, output, action: 'save', value: { ...prior.value, folder_id: want } });
  return { id, output, moved: true, status: o.status, to: statusFolder(o.status) };
}

/** Uploads every version of a project that isn't on Drive yet, and moves saved ones to match their status. */
export async function pushProjectVersions(client, project, { includeTests = false } = {}) {
  const { listGenerations } = await import('../records.mjs');
  const out = { client, project, uploaded: 0, moved: 0, in_place: 0, by_status: {} };
  // Free test images (no key) never go to Drive unless asked.
  for (const g0 of listGenerations({ client, project, limit: 100_000, includeTests })) {
    if (g0.status !== 'done' || (g0.is_test && !includeTests)) continue;
    const g = withReview(g0);
    for (let i = 0; i < g.outputs.length; i++) {
      const st = g.outputs[i].status;
      out.by_status[st] = (out.by_status[st] ?? 0) + 1;
      const r = await placeSaved(g.id, i);
      if (!r) {
        if (!mediaPath(g.outputs[i].sha)) continue;
        await saveToDrive({ id: g.id, output: i });
        out.uploaded++;
      } else if (r.moved) out.moved++;
      else out.in_place++;
    }
  }
  const folders = readYaml(path.join(clientDir(client), 'projects', project, 'project.yaml'), {})?.links?.drive;
  return { ...out, url: folders?.folder ? `https://drive.google.com/drive/folders/${folders.folder}` : null };
}

export async function saveToDrive({ id, output = 0, folder = null, name = null }) {
  const g = withReview(requireGeneration(id));
  const o = g.outputs[output];
  if (!o) throw new StudioError(`That image has ${g.outputs.length} outputs.`);
  const prior = reviewsFor(g.client, g.project).filter((e) => e.target === id && (e.output ?? 0) === output && e.action === 'save').at(-1);
  if (prior && !folder) return { id, output, already_saved: true, ...prior.value, ...((await placeSaved(id, output))?.moved ? { moved_to: statusFolder(o.status) } : {}) };
  const file = mediaPath(o.sha);
  if (!file) throw new StudioError("The image file isn't on this computer.", 'Fetch it first (drive_fetch), or ask the teammate who made it to save it.');

  let parentId;
  if (folder && readOnlyFolders(g.client).some((f) => f.id === fileId(folder))) throw new StudioError('That folder is read-only for the studio.', `Save to the client's own folder (leave out the folder), or another folder in the team Shared Drive.`);
  if (folder) parentId = fileId(folder);
  else {
    const base = clientFolderId(g.client);
    if (!base) throw new StudioError(g.client === SCRATCH ? 'Images without a client need a folder to save to.' : `${g.client} has no Drive folder yet.`, g.client === SCRATCH ? 'Pass a folder link.' : `studio drive init ${g.client}`);
    parentId = await versionFolder(g, o.status);
  }
  const label = slugify([g.deliverable ?? g.project, g.concept].filter(Boolean).join(' ')).toUpperCase().replace(/-/g, '_');
  // No status in the name: the folder shows it, and the file moves when the status changes.
  const fileName = name ?? `${label}_v${g.version}${g.outputs.length > 1 ? `_${output + 1}` : ''}_${id.slice(-6)}${EXT[o.mime] ?? '.png'}`;
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


/**
 * Two-way sync of a client with the team's Shared Drive, through one pack per client
 * (_client-packs/<client>.zip): pull and merge the shared copy, then push the merged result.
 * If the merge finds conflicts, nothing is pushed until they are resolved.
 */
export async function syncClient(client) {
  const root = teamConfig().google?.root_folder_id;
  if (!root) throw new StudioError('The team pack has no google.root_folder_id.', 'Add the Shared Drive to team.yaml (docs/google-setup.md).');
  const os = await import('node:os');
  const fs = await import('node:fs');
  const { exportClient, importClient, textHashes } = await import('../share.mjs');
  const stateFile = path.join(paths().cache, 'drive', 'sync.json');
  const state = readJson(stateFile, {}) ?? {};
  const folder = await ensurePath(fileId(root), '_client-packs');
  const name = `${client}.zip`;
  const remote = await findByName(folder.id, name);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stacked-sync-'));
  try {
    let pulled = null;
    if (remote) {
      const { file } = await downloadTo(remote.id, path.join(tmp, 'remote.zip'));
      pulled = importClient(file, { as: client, base: state[client]?.base ?? null });
      if (pulled.conflicts.length) {
        return { client, pulled, pushed: null, message: `${pulled.conflicts.length} file(s) differ from the shared copy. Each has a .incoming version next to it: keep what's right, delete the .incoming file, then sync again.` };
      }
    }
    const { zip } = exportClient(client, { out: path.join(tmp, name) });
    const data = fs.readFileSync(zip);
    const up = remote ? await updateFile(remote.id, { data, mime: 'application/zip' }) : await uploadPath(zip, { parentId: folder.id, name, mime: 'application/zip', description: `stacked-studio shared copy of ${client}: studio client sync ${client}` });
    state[client] = { at: new Date().toISOString(), drive_id: up.id, base: textHashes(client) };
    writeJsonAtomic(stateFile, state);
    return { client, pulled, pushed: { drive_id: up.id, link: up.webViewLink ?? `https://drive.google.com/file/d/${up.id}/view` }, message: remote ? 'Merged with the shared copy and updated it.' : 'Made the first shared copy.' };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export const PUSH_PARTS = { brand: 'brand/logos', products: 'products', library: 'library', final: 'projects/*/*/final', versions: 'projects/*/*/versions', references: 'projects/*/*/references' };

/**
 * Uploads the client's readable folders to its Drive folder with the same names and layout, when the
 * person asks. Files already uploaded (same path and content) are skipped. Never touches read-only folders.
 */
export async function pushToDrive(client, { parts = ['brand', 'products', 'library', 'final'], dryRun = false } = {}) {
  const base = clientFolderId(client);
  if (!base) throw new StudioError(`${client} has no Drive folder yet.`, `studio drive init ${client}`);
  const fs = await import('node:fs');
  const crypto = await import('node:crypto');
  const { organiseClient } = await import('../organise.mjs');
  organiseClient(client);
  const dir = clientDir(client);
  const files = [];
  for (const part of parts) {
    const pattern = PUSH_PARTS[part];
    if (!pattern) throw new StudioError(`Unknown part "${part}". Use: ${Object.keys(PUSH_PARTS).join(', ')}.`);
    // Expand each * one folder level at a time (projects/*/*/final → every deliverable's final/).
    let roots = [''];
    for (const seg of pattern.split('/')) {
      roots = roots.flatMap((r) => {
        if (seg !== '*') return [path.posix.join(r, seg)];
        const abs = path.join(dir, r);
        return fs.existsSync(abs) ? fs.readdirSync(abs).filter((n) => !n.startsWith('.') && !n.startsWith('_') && fs.statSync(path.join(abs, n)).isDirectory()).map((n) => path.posix.join(r, n)) : [];
      });
    }
    for (const r of roots) {
      const abs = path.join(dir, r);
      if (!fs.existsSync(abs)) continue;
      for (const f of fs.readdirSync(abs, { recursive: true })) {
        const full = path.join(abs, String(f));
        if (fs.statSync(full).isFile() && /\.(png|jpe?g|webp|gif|mp4|mov|pdf)$/i.test(full)) files.push(path.relative(dir, full).split(path.sep).join('/'));
      }
    }
  }
  const stateFile = path.join(paths().cache, 'drive', 'pushed.json');
  const state = readJson(stateFile, {}) ?? {};
  const done = (state[client] ??= {});
  const todo = files.filter((rel) => {
    const md5 = crypto.createHash('md5').update(fs.readFileSync(path.join(dir, rel))).digest('hex');
    return done[rel]?.md5 !== md5;
  });
  if (dryRun) return { client, files: files.length, to_upload: todo.length, already: files.length - todo.length };
  const folders = new Map();
  let uploaded = 0;
  for (const rel of todo) {
    const parentRel = path.posix.dirname(rel);
    if (!folders.has(parentRel)) folders.set(parentRel, (await ensurePath(base, parentRel)).id);
    const full = path.join(dir, rel);
    const data = fs.readFileSync(full);
    const md5 = crypto.createHash('md5').update(data).digest('hex');
    const existing = await findByName(folders.get(parentRel), path.posix.basename(rel));
    const up = existing ? (existing.md5Checksum === md5 ? existing : await updateFile(existing.id, { data, mime: mimeOf(rel) })) : await uploadPath(full, { parentId: folders.get(parentRel), mime: mimeOf(rel) });
    done[rel] = { id: up.id, md5 };
    uploaded++;
    if (uploaded % 25 === 0) writeJsonAtomic(stateFile, state);
  }
  writeJsonAtomic(stateFile, state);
  return { client, files: files.length, uploaded, already: files.length - todo.length, folder: folderLink(base) };
}

const mimeOf = (f) => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.pdf': 'application/pdf' })[path.extname(f).toLowerCase()] ?? 'application/octet-stream';

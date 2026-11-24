import fs from 'node:fs';
import path from 'node:path';
import { StudioError } from './errors.mjs';
import { readYaml, sha256, slugify, writeYamlAtomic } from './fsutil.mjs';
import { mimeFromName, putMedia } from './media.mjs';
import { clientDir, deliverableDir, ensureProject, layout, SCRATCH } from './workspace.mjs';

// The inbox: clients/<client>/inbox/ is where uploads land (from the Workbench, Finder or the CLI).
// Filing moves each image to where it belongs — a product, a reference, past work, a moodboard, a
// deliverable — with a name and tags, then the readable folders are refreshed.

export const FILE_AS = ['product', 'reference', 'logo', 'past_work', 'board', 'deliverable', 'discard'];
const NOTES = 'inbox.yaml';
const inboxDir = (client) => layout.inbox(client);

/** Saves an uploaded image into the inbox (and the media cache). */
export function addToInbox(client, { data, name, note }) {
  const mime = mimeFromName(name ?? '');
  if (!mime || !/^image\//.test(mime)) throw new StudioError(`"${name}" isn't a PNG, JPEG, WebP or GIF image.`);
  if (data.length > 40 * 1024 * 1024) throw new StudioError(`"${name}" is larger than 40 MB.`);
  const m = putMedia(data, mime);
  const dir = inboxDir(client);
  fs.mkdirSync(dir, { recursive: true });
  const base = slugify(path.basename(name, path.extname(name))) || 'upload';
  let file = path.join(dir, `${base}${path.extname(name).toLowerCase()}`);
  for (let n = 2; fs.existsSync(file) && sha256(fs.readFileSync(file)) !== m.sha; n++) file = path.join(dir, `${base}-${n}${path.extname(name).toLowerCase()}`);
  if (!fs.existsSync(file)) fs.copyFileSync(m.file, file);
  if (note) {
    const notes = readYaml(path.join(dir, NOTES), {}) ?? {};
    notes[path.basename(file)] = note;
    writeYamlAtomic(path.join(dir, NOTES), notes);
  }
  return { client, file: path.basename(file), sha: m.sha, width: m.width ?? null, height: m.height ?? null };
}

/** Images waiting in the inbox, including ones dropped in with Finder. */
export function listInbox(client) {
  const dir = inboxDir(client);
  if (!fs.existsSync(dir)) return [];
  const notes = readYaml(path.join(dir, NOTES), {}) ?? {};
  return fs
    .readdirSync(dir)
    .filter((n) => !n.startsWith('.') && n !== NOTES && /^image\//.test(mimeFromName(n) ?? ''))
    .sort()
    .map((n) => {
      const full = path.join(dir, n);
      const data = fs.readFileSync(full);
      const m = putMedia(data, mimeFromName(n)); // registers Finder drops in the cache too
      return { name: n, sha: m.sha, file: full, cache_file: m.file, width: m.width ?? null, height: m.height ?? null, bytes: data.length, note: notes[n] ?? null };
    });
}

function appendItems(file, items) {
  const doc = readYaml(file, null) ?? { items: [] };
  doc.items ??= [];
  for (const it of items) if (!doc.items.some((x) => x.sha === it.sha)) doc.items.push(it);
  writeYamlAtomic(file, doc);
}

/**
 * Files inbox images. Each item: { name | sha, as, ...details }:
 *   product      product (name), label_text?, style?
 *   reference    shots?, subject?, take?, title?
 *   logo         title?
 *   past_work    title?, shots?, subject?, take?
 *   board        board (name), title?, take?, shots?
 *   deliverable  project, deliverable (code), role? (reference | visual | mood | lighting | other)
 *   discard      (removed from the inbox; nothing else)
 */
export async function fileInbox(client, items) {
  if (client === SCRATCH && items.some((i) => !['board', 'discard'].includes(i.as))) throw new StudioError('Without a client, inbox images can only go to a moodboard or be discarded.');
  const inbox = listInbox(client);
  const { checkIds } = await import('./library.mjs');
  const results = [];
  for (const it of items) {
    const entry = inbox.find((x) => x.name === it.name || x.sha === it.sha);
    if (!entry) {
      results.push({ name: it.name ?? it.sha, ok: false, error: 'not in the inbox' });
      continue;
    }
    if (!FILE_AS.includes(it.as)) {
      results.push({ name: entry.name, ok: false, error: `unknown destination "${it.as}"` });
      continue;
    }
    const tags = checkIds(it.shots ?? []);
    const base = { sha: entry.sha, mime: mimeFromName(entry.name), width: entry.width, height: entry.height, source: 'upload', added: new Date().toISOString() };
    let where;
    try {
      if (it.as === 'product') {
        if (!it.product) throw new StudioError('Which product?');
        const { addProduct } = await import('./products.mjs');
        const r = await addProduct(client, { name: it.product, label_text: it.label_text, image: { sha: entry.sha }, style: it.style ?? 'packshot', source: 'upload' });
        where = `products/${r.product}`;
      } else if (it.as === 'reference' || it.as === 'logo') {
        appendItems(layout.references(client), [{ ...base, kind: it.as === 'logo' ? 'logo' : 'reference', name: it.title ?? entry.name, subject: it.subject ?? null, shots: tags.ok, take: it.take ?? entry.note ?? null }]);
        where = it.as === 'logo' ? 'brand/logos' : 'library/references';
      } else if (it.as === 'past_work') {
        appendItems(layout.pastWork(client), [{ ...base, name: it.title ?? entry.name, subject: it.subject ?? null, shots: tags.ok, take: it.take ?? entry.note ?? null }]);
        where = 'library/past-work';
      } else if (it.as === 'board') {
        if (!it.board) throw new StudioError('Which board?');
        const { saveMoodboard } = await import('./research.mjs');
        const r = await saveMoodboard({ client: client === SCRATCH ? undefined : client, name: it.board, items: [{ sha: entry.sha, title: it.title ?? entry.name, take: it.take ?? entry.note ?? undefined, shots: tags.ok, subject: it.subject, source: 'upload' }] });
        where = `library/moodboards/${r.board}`;
      } else if (it.as === 'deliverable') {
        if (!it.project || !it.deliverable) throw new StudioError('Which project and deliverable?');
        const p = ensureProject(client, it.project, { create: false });
        const file = path.join(deliverableDir(client, p, it.deliverable, { create: true }), 'deliverable.yaml');
        const d = readYaml(file, null) ?? { code: it.deliverable, status: 'not_started' };
        d.files ??= [];
        if (!d.files.some((f) => f.sha === entry.sha)) d.files.push({ sha: entry.sha, mime: base.mime, width: base.width, height: base.height, role: it.role ?? 'reference', name: it.title ?? entry.name, source: 'upload' });
        writeYamlAtomic(file, d);
        where = path.relative(clientDir(client), path.dirname(file));
      } else where = 'discarded';
      fs.rmSync(entry.file, { force: true });
      results.push({ name: entry.name, ok: true, filed_to: where, ...(tags.unknown.length ? { unknown_shots: tags.unknown } : {}) });
    } catch (err) {
      results.push({ name: entry.name, ok: false, error: err.message });
    }
  }
  // Drop notes for files that left the inbox.
  const nfile = path.join(inboxDir(client), NOTES);
  if (fs.existsSync(nfile)) {
    const notes = readYaml(nfile, {}) ?? {};
    const left = new Set(listInbox(client).map((x) => x.name));
    for (const k of Object.keys(notes)) if (!left.has(k)) delete notes[k];
    writeYamlAtomic(nfile, notes);
  }
  if (client !== SCRATCH) {
    const { organiseClient } = await import('./organise.mjs');
    organiseClient(client);
  }
  const { refresh } = await import('./index.mjs');
  refresh();
  return { client, filed: results.filter((r) => r.ok).length, results, left_in_inbox: listInbox(client).length };
}


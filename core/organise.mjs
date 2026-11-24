import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readJson, readYaml, sha256, slugify, writeJsonAtomic } from './fsutil.mjs';
import { EXT, mediaPath } from './media.mjs';
import { listGenerations, withReview } from './records.mjs';
import { clientDir, layout, listDeliverables, listProjects } from './workspace.mjs';
import { listProducts } from './products.mjs';
import { readSections, sectionSlug } from './sections.mjs';

// Readable folders: every image a client uses gets a properly named copy inside the client folder,
// so people can browse, track and upload in Finder. On APFS (macOS) the copy is a clone — no extra
// disk space, and editing it never touches the stored original. The YAML files stay the record;
// this tree can be rebuilt at any time. Files a person added themselves are never touched: only
// files listed in clients/<c>/.organised.json (placed by the studio) are moved or removed.

const MANIFEST = '.organised.json';
const short = (sha) => sha.slice(0, 6);
const ext = (sha, mime) => EXT[mime] ?? path.extname(mediaPath(sha) ?? '') ?? '.png';
const nice = (s, max = 48) => slugify(String(s ?? '').replace(/^slide \d+ ·\s*/i, '')).slice(0, max).replace(/-+$/, '') || 'image';

/**
 * Copy-on-write clone where the filesystem supports it, a plain copy otherwise. On macOS Node's
 * COPYFILE_FICLONE silently makes a full copy, so APFS clones go through `cp -c` instead.
 */
export function placeCopy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (process.platform === 'darwin' && spawnSync('/bin/cp', ['-c', src, dest]).status === 0) return;
  fs.copyFileSync(src, dest, fs.constants.COPYFILE_FICLONE);
}

/** Every readable path the client should have: { rel: sha }. */
export function desiredTree(client) {
  const want = new Map();
  const put = (rel, sha, mime) => {
    if (!sha || !mediaPath(sha)) return;
    let r = rel + ext(sha, mime);
    // Same name, different image: add a counter.
    for (let n = 2; want.has(r) && want.get(r) !== sha; n++) r = `${rel}-${n}${ext(sha, mime)}`;
    want.set(r, sha);
  };
  const two = (n) => String(n).padStart(2, '0');

  // Products: products/<p>/photos|cutouts/<p>-NN, groups under products/_groups/<g>/
  for (const p of listProducts(client)) {
    const base = p.group ? `products/_groups/${p.slug}` : `products/${p.slug}`;
    const counts = {};
    for (const c of p.cutouts ?? []) {
      const kind = c.kind === 'cutout' ? 'cutouts' : 'photos';
      counts[kind] = (counts[kind] ?? 0) + 1;
      put(`${base}/${kind}/${p.slug}-${two(counts[kind])}`, c.sha, c.mime);
    }
  }

  // Logos → brand/logos; references by subject; past work by subject. Named by what they show.
  for (const it of readYaml(layout.references(client), {})?.items ?? []) {
    if (!it.sha || /^not a reference/i.test(it.take ?? '')) continue;
    const label = it.take ?? it.name ?? it.title ?? it.note;
    if (it.kind === 'logo') put(`brand/logos/${nice(it.name ?? 'logo')}-${short(it.sha)}`, it.sha, it.mime);
    else if (it.kind === 'document') continue;
    else put(`library/references/${slugify(it.subject ?? 'unsorted')}/${nice(label)}-${short(it.sha)}`, it.sha, it.mime);
  }
  for (const it of readYaml(layout.pastWork(client), {})?.items ?? []) {
    if (it.sha) put(`library/past-work/${slugify(it.subject ?? 'other')}/${nice(it.take ?? it.name ?? it.title)}-${short(it.sha)}`, it.sha, it.mime);
  }

  // Moodboards: library/moodboards/<board>/<title>
  const bdir = layout.boards(client);
  if (fs.existsSync(bdir)) {
    for (const b of fs.readdirSync(bdir)) {
      for (const it of readYaml(layout.board(client, b), {})?.items ?? []) if (it.sha) put(`library/moodboards/${b}/${nice(it.title ?? it.take)}-${short(it.sha)}`, it.sha);
    }
  }

  // Projects: per deliverable — references/ (deck inspiration), versions/ (earlier rounds from the
  // deck + everything made in the studio), final/ (approved). Blank deck crops are skipped.
  for (const p of listProjects(client)) {
    const deliverables = listDeliverables(client, p.slug);
    for (const d of deliverables) {
      const meta = readYaml(path.join(d.dir, 'deliverable.yaml'), null);
      const counts = {};
      for (const f of meta?.files ?? []) {
        if (f.blank) continue;
        const role = f.role ?? 'other';
        counts[role] = (counts[role] ?? 0) + 1;
        if (role === 'visual') put(`projects/${p.slug}/${d.folder}/versions/deck-${two(counts[role])}`, f.sha, f.mime);
        else put(`projects/${p.slug}/${d.folder}/references/${role}-${two(counts[role])}`, f.sha, f.mime);
      }
    }
    // Section mood/overview images, once per project: references/<section>/<role>-NN
    for (const sec of readSections(client, p.slug)) {
      const counts = {};
      for (const im of sec.images ?? []) {
        counts[im.role] = (counts[im.role] ?? 0) + 1;
        put(`projects/${p.slug}/references/${sectionSlug(sec.name)}/${im.role}-${two(counts[im.role])}`, im.sha, im.mime);
      }
    }
    const folderFor = new Map(deliverables.map((d) => [d.code.toLowerCase(), d.folder]));
    for (const g of listGenerations({ client, project: p.slug, limit: 100_000 })) {
      if (g.status !== 'done' || g.is_test) continue;
      const r = withReview(g);
      const label = (g.deliverable ?? nice(g.concept ?? 'image', 24)).replace(/[^A-Za-z0-9_-]/g, '');
      const folder = g.deliverable && folderFor.get(String(g.deliverable).toLowerCase());
      const base = folder ? `projects/${p.slug}/${folder}` : `projects/${p.slug}`;
      r.outputs.forEach((o, i) => {
        const name = `${label}_v${g.version}${r.outputs.length > 1 ? `_${i + 1}` : ''}_${g.id.slice(-6)}`;
        put(`${base}/versions/${name}`, o.sha, o.mime);
        if (o.status === 'approved') put(`${base}/final/${name}`, o.sha, o.mime);
      });
    }
  }
  return want;
}

/** Brings the readable tree in line with the records. Returns what changed. */
export function organiseClient(client, { dryRun = false } = {}) {
  const dir = clientDir(client);
  const manifestFile = path.join(dir, MANIFEST);
  const placed = readJson(manifestFile, {}) ?? {};
  const want = desiredTree(client);
  const out = { client, placed: 0, kept: 0, removed: 0, skipped_existing: [], files: want.size };

  for (const [rel, sha] of want) {
    const dest = path.join(dir, rel);
    if (placed[rel] === sha && fs.existsSync(dest)) {
      out.kept++;
      continue;
    }
    if (fs.existsSync(dest) && placed[rel] !== sha) {
      // Already the right image (e.g. moved with a renamed folder): adopt it.
      if (sha256(fs.readFileSync(dest)) === sha) {
        placed[rel] = sha;
        out.kept++;
        continue;
      }
      // Something the person put there: never overwrite it.
      out.skipped_existing.push(rel);
      continue;
    }
    if (!dryRun) placeCopy(mediaPath(sha), dest);
    placed[rel] = sha;
    out.placed++;
  }
  // Files the studio placed earlier that are no longer wanted (renamed, re-grouped): remove them,
  // but only if they're still the exact file it placed.
  for (const [rel, sha] of Object.entries(placed)) {
    if (want.get(rel) === sha) continue;
    const f = path.join(dir, rel);
    if (fs.existsSync(f) && !dryRun) {
      if (sha256(fs.readFileSync(f)) === sha) {
        fs.rmSync(f);
        out.removed++;
      }
    }
    delete placed[rel];
  }
  if (!dryRun) {
    writeJsonAtomic(manifestFile, placed);
    pruneEmpty(dir);
  }
  return out;
}

function pruneEmpty(dir) {
  for (const sub of ['products', 'brand', 'library', 'projects']) {
    const walk = (d) => {
      if (!fs.existsSync(d)) return;
      for (const n of fs.readdirSync(d)) {
        const f = path.join(d, n);
        if (fs.statSync(f).isDirectory()) {
          walk(f);
          if (!fs.readdirSync(f).length && /\/(versions|final|references|photos|cutouts|logos|unsorted|images|approved|deck)(\/|$)/.test(f)) fs.rmdirSync(f);
        }
      }
    };
    walk(path.join(dir, sub));
  }
}

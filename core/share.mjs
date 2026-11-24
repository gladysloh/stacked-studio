import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StudioError } from './errors.mjs';
import { readJsonl, readYaml, sha256, writeYamlAtomic } from './fsutil.mjs';
import { mediaPath, putMedia, mimeFromName } from './media.mjs';
import { paths, which } from './paths.mjs';
import { clientDir, readClient } from './workspace.mjs';

// Sharing a client with a teammate: a zip of the readable files (config, brand, knowledge, briefs,
// records, review logs). Media stays out by default — approved images live on Drive and are fetched
// when needed — but product cutouts are included because almost every product shot needs them.
// Importing merges: new files are added, append-only logs are merged by entry id, and nothing that
// already exists is overwritten. Differences are reported as conflicts for a person to resolve.

const TEXT = /\.(ya?ml|md|jsonl|json|txt)$/i;

function requireZip() {
  if (!which('zip') || !which('unzip')) throw new StudioError('zip and unzip are needed to share clients.', 'Install them with your package manager.');
}

/** Hashes of media worth shipping with the client: product cutouts (and everything with --with-media). */
function productMedia(slug) {
  const out = new Set();
  const dir = path.join(clientDir(slug), 'products');
  if (!fs.existsSync(dir)) return out;
  const scan = (v) => {
    if (!v || typeof v !== 'object') return;
    if (typeof v.sha === 'string') out.add(v.sha);
    for (const x of Object.values(v)) scan(x);
  };
  for (const f of fs.readdirSync(dir, { recursive: true })) if (String(f).endsWith('.yaml')) scan(readYaml(path.join(dir, String(f)), {}));
  return out;
}

function allMedia(slug) {
  const out = new Set();
  for (const f of fs.readdirSync(clientDir(slug), { recursive: true })) {
    const full = path.join(clientDir(slug), String(f));
    if (!TEXT.test(full) || !fs.statSync(full).isFile()) continue;
    for (const m of fs.readFileSync(full, 'utf8').matchAll(/\b[0-9a-f]{64}\b/g)) out.add(m[0]);
  }
  return out;
}

export function exportClient(slug, { out, withMedia = false } = {}) {
  requireZip();
  const c = readClient(slug);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'stacked-export-'));
  try {
    const root = path.join(stage, slug);
    fs.cpSync(clientDir(slug), root, { recursive: true, filter: (src) => !path.basename(src).startsWith('.') && (fs.statSync(src).isDirectory() || TEXT.test(src)) });
    const shas = withMedia ? allMedia(slug) : productMedia(slug);
    let media = 0;
    let missing = 0;
    for (const sha of shas) {
      const file = mediaPath(sha);
      if (!file) {
        missing++;
        continue;
      }
      const dest = path.join(root, '.media', path.basename(file));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(file, dest);
      media++;
    }
    writeYamlAtomic(path.join(root, '.export.yaml'), { client: slug, name: c.name, exported: new Date().toISOString(), media, with_media: withMedia });
    const zip = path.resolve(out ?? `${slug}-${new Date().toISOString().slice(0, 10)}.zip`);
    fs.rmSync(zip, { force: true });
    const r = spawnSync('zip', ['-qr', zip, slug], { cwd: stage });
    if (r.status !== 0) throw new StudioError('zip failed.');
    return { zip, client: slug, media, missing_media: missing, bytes: fs.statSync(zip).size };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

/** Merges append-only JSONL files by entry id (or by the whole line when there's no id). */
function mergeJsonl(dest, incoming) {
  const key = (e) => e.id ?? sha256(JSON.stringify(e));
  const have = new Set(readJsonl(dest).map(key));
  const add = readJsonl(incoming).filter((e) => !have.has(key(e)));
  if (add.length) fs.appendFileSync(dest, add.map((e) => JSON.stringify(e) + '\n').join(''));
  return add.length;
}

export function importClient(zip, { as } = {}) {
  requireZip();
  if (!fs.existsSync(zip)) throw new StudioError(`Can't find ${zip}.`);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'stacked-import-'));
  try {
    const list = spawnSync('unzip', ['-Z1', zip], { encoding: 'utf8' });
    if (list.status !== 0) throw new StudioError("That file isn't a readable zip.");
    const names = list.stdout.split('\n').filter(Boolean);
    // Refuse paths that would escape the client folder.
    if (names.some((n) => n.startsWith('/') || n.split('/').includes('..'))) throw new StudioError('The zip contains unsafe paths, so it was not imported.');
    const tops = [...new Set(names.map((n) => n.split('/')[0]))];
    if (tops.length !== 1) throw new StudioError('A client zip should contain exactly one client folder.');
    const r = spawnSync('unzip', ['-q', zip, '-d', stage]);
    if (r.status !== 0) throw new StudioError('unzip failed.');
    const src = path.join(stage, tops[0]);
    if (!fs.existsSync(path.join(src, 'client.yaml'))) throw new StudioError('The zip has no client.yaml, so it is not a client export.');
    const slug = as ?? tops[0];
    const dest = clientDir(slug);
    const report = { client: slug, added: 0, merged_entries: 0, unchanged: 0, conflicts: [], media: 0 };

    const walk = (rel = '') => {
      for (const n of fs.readdirSync(path.join(src, rel))) {
        const r2 = path.join(rel, n);
        const from = path.join(src, r2);
        if (n === '.media') {
          for (const m of fs.readdirSync(from)) {
            const mime = mimeFromName(m);
            if (!mime) continue;
            const data = fs.readFileSync(path.join(from, m));
            if (sha256(data) !== m.split('.')[0]) continue; // corrupted or renamed: skip
            putMedia(data, mime);
            report.media++;
          }
          continue;
        }
        if (n === '.export.yaml') continue;
        if (fs.statSync(from).isDirectory()) {
          walk(r2);
          continue;
        }
        const to = path.join(dest, r2);
        if (!fs.existsSync(to)) {
          fs.mkdirSync(path.dirname(to), { recursive: true });
          fs.copyFileSync(from, to);
          report.added++;
        } else if (n.endsWith('.jsonl')) {
          report.merged_entries += mergeJsonl(to, from);
        } else if (sha256(fs.readFileSync(to)) === sha256(fs.readFileSync(from))) {
          report.unchanged++;
        } else {
          const theirs = `${to}.incoming`;
          fs.copyFileSync(from, theirs);
          report.conflicts.push({ file: path.relative(paths().workspace, to), theirs: path.relative(paths().workspace, theirs) });
        }
      }
    };
    walk();
    return report;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

/** Installs a team pack: a zip (or folder) with team.yaml — shared defaults, Drive root, Google sign-in client. */
export function importTeam(src) {
  const p = paths();
  let file = src;
  let stage = null;
  try {
    if (src.endsWith('.zip')) {
      requireZip();
      stage = fs.mkdtempSync(path.join(os.tmpdir(), 'stacked-team-'));
      if (spawnSync('unzip', ['-q', src, '-d', stage]).status !== 0) throw new StudioError('unzip failed.');
      file = fs.readdirSync(stage, { recursive: true }).map((f) => path.join(stage, String(f))).find((f) => path.basename(f) === 'team.yaml');
      if (!file) throw new StudioError('The team pack has no team.yaml.');
    } else if (fs.statSync(src).isDirectory()) file = path.join(src, 'team.yaml');
    const team = readYaml(file, null);
    if (!team?.name) throw new StudioError('team.yaml needs at least a name.');
    if (JSON.stringify(team).match(/AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,}/)) throw new StudioError('team.yaml contains what looks like an API key. Keys are personal: remove it and send each teammate their own key.');
    writeYamlAtomic(p.teamConfig, team);
    return { team: team.name, file: path.relative(p.workspace, p.teamConfig) };
  } finally {
    if (stage) fs.rmSync(stage, { recursive: true, force: true });
  }
}

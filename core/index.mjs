import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readJsonl, readYaml, sha256 } from './fsutil.mjs';
import { paths } from './paths.mjs';
import { pickProvider } from './providers/index.mjs';
import { frontmatter } from './skills.mjs';
import { SCRATCH, clientDir, readClient } from './workspace.mjs';

// The local search index (.cache/index.db). It is only a cache: every row comes from files in
// clients/ (plus the cached Drive listing in .cache/drive/), so it can be deleted at any time and
// is rebuilt on the next search. Search is hybrid: FTS5 keywords + metadata filters + embeddings.
//
// Every chunk carries a trust label:
//   approved    brand.md and knowledge marked approved — follow it
//   source      briefs, decks, product facts — the client's own material
//   draft       knowledge drafts, studio notes — check before relying on it
//   unverified  research, comments, Drive files nobody has described — context only

const SCHEMA = `
create table if not exists source (path text primary key, mtime real, size integer);
create table if not exists chunk (
  id integer primary key,
  path text not null,
  client text not null,
  project text,
  kind text not null,
  status text not null,
  title text,
  body text,
  ref text,
  tags text,
  hash text
);
create index if not exists chunk_path on chunk(path);
create index if not exists chunk_client on chunk(client, kind);
create virtual table if not exists chunk_fts using fts5(title, body, tags, content='chunk', content_rowid='id', tokenize='porter unicode61');
create trigger if not exists chunk_ai after insert on chunk begin
  insert into chunk_fts(rowid, title, body, tags) values (new.id, new.title, new.body, new.tags);
end;
create trigger if not exists chunk_ad after delete on chunk begin
  insert into chunk_fts(chunk_fts, rowid, title, body, tags) values ('delete', old.id, old.title, old.body, old.tags);
end;
create table if not exists vec (hash text not null, model text not null, v blob not null, primary key (hash, model));
`;

export function openIndex() {
  fs.mkdirSync(paths().cache, { recursive: true });
  const db = new DatabaseSync(paths().index);
  db.exec('pragma journal_mode = wal; pragma synchronous = normal;');
  db.exec(SCHEMA);
  return db;
}

// ---- turning files into chunks ----

/** Splits markdown on "## " headings so each rule or section is found on its own. */
function sections(text, fallbackTitle) {
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const parts = body.split(/\n(?=##\s)/);
  return parts
    .map((p) => {
      const m = p.match(/^#{1,3}\s+(.+)\n?/);
      return { title: m ? m[1].trim() : fallbackTitle, body: (m ? p.slice(m[0].length) : p).trim() };
    })
    .filter((s) => s.body.length > 0);
}

const asText = (v) => (Array.isArray(v) ? v.join(', ') : v ?? '');

function chunksFor(file, client) {
  const rel = path.relative(clientDir(client), file).split(path.sep);
  const name = path.basename(file);
  const project = rel[0] === 'projects' ? rel[1] : null;
  const out = [];
  const add = (c) => out.push({ project, tags: '', ref: null, ...c });

  if (rel.length === 1 && name === 'brand.md') {
    for (const s of sections(fs.readFileSync(file, 'utf8'), 'Brand')) add({ kind: 'brand', status: 'approved', ...s });
  } else if (rel.length === 1 && name === 'client.yaml') {
    const c = readYaml(file, {});
    add({ kind: 'client', status: 'source', title: c.name, body: [c.industry, c.description].filter(Boolean).join('\n') || c.name });
  } else if (rel[0] === 'knowledge' && name.endsWith('.md')) {
    const text = fs.readFileSync(file, 'utf8');
    const fm = frontmatter(text);
    const status = fm.status === 'approved' ? 'approved' : fm.status === 'unverified' ? 'unverified' : 'draft';
    for (const s of sections(text, fm.title ?? name.replace(/\.md$/, ''))) add({ kind: 'knowledge', status, tags: asText(fm.tags ?? fm.topic), ...s });
  } else if ((rel[0] === 'products' || rel[0] === 'references' || rel[0] === 'past-work') && name.endsWith('.yaml')) {
    const kind = { products: 'product', references: 'reference', 'past-work': 'past_work' }[rel[0]];
    const data = readYaml(file, {});
    const items = Array.isArray(data) ? data : data.items ?? [data];
    for (const it of items) {
      add({
        kind,
        status: kind === 'product' ? 'source' : it.status ?? 'source',
        title: it.name ?? it.title ?? it.file ?? kind,
        body: [it.description, it.label_text && `Label: ${it.label_text}`, it.style && `Style: ${it.style}`, it.notes].filter(Boolean).join('\n') || (it.name ?? kind),
        tags: asText(it.tags),
        ref: it.sha ?? it.cutouts?.[0]?.sha ?? it.drive_id ?? null,
      });
    }
  } else if (rel[0] === 'research' && name.endsWith('.yaml')) {
    const b = readYaml(file, {});
    add({ kind: 'research', status: 'unverified', title: b.name ?? rel[1], body: [b.notes, ...(b.items ?? []).map((i) => [i.title, i.note].filter(Boolean).join(': '))].filter(Boolean).join('\n') || rel[1], tags: asText(b.tags) });
  } else if (rel[0] === 'research' && name.endsWith('.md')) {
    for (const s of sections(fs.readFileSync(file, 'utf8'), rel[1])) add({ kind: 'research', status: 'unverified', ...s });
  } else if (rel[0] === 'decks' && name === 'slides.md') {
    for (const s of sections(fs.readFileSync(file, 'utf8'), rel[1])) add({ kind: 'deck_slide', status: 'source', ...s, tags: rel[1] });
  } else if (rel[0] === 'decks' && name === 'comments.jsonl') {
    for (const c of readJsonl(file)) add({ kind: 'deck_comment', status: 'unverified', title: `${c.author ?? 'Comment'}${c.slide ? ` · slide ${c.slide}` : ''}${c.resolved ? ' (resolved)' : ''}`, body: [c.quote && `“${c.quote}”`, c.body].filter(Boolean).join('\n'), tags: [rel[1], c.asset_code].filter(Boolean).join(' ') });
  } else if (project && (name === 'brief.md' || rel[2] === 'concepts') && name.endsWith('.md')) {
    const kind = rel[2] === 'deliverables' ? 'deliverable' : rel[2] === 'concepts' ? 'concept' : 'brief';
    const label = kind === 'deliverable' ? rel[3] : kind === 'concept' ? name.replace(/\.md$/, '') : null;
    for (const s of sections(fs.readFileSync(file, 'utf8'), label ?? 'Brief')) add({ kind, status: 'source', ...s, title: label && s.title !== label ? `${label} · ${s.title}` : s.title, tags: label ?? '' });
  } else if (project && rel[2] === 'generations' && name.endsWith('.yaml')) {
    const g = readYaml(file, {});
    if (g.status === 'done' && !g.is_test) add({ kind: 'generation', status: 'draft', title: [g.deliverable, g.concept, `v${g.version}`].filter(Boolean).join(' · '), body: [g.instruction, g.prompt].filter(Boolean).join('\n'), ref: g.id, tags: g.model ?? '' });
  }
  return out;
}

function walk(dir, out = []) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    if (n.startsWith('.')) continue;
    const full = path.join(dir, n);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(md|ya?ml|jsonl)$/.test(n)) out.push({ file: full, mtime: st.mtimeMs, size: st.size });
  }
  return out;
}

const driveFile = (client) => path.join(paths().cache, 'drive', `${client}.jsonl`);

/** Brings the index up to date with the files: only changed files are re-read. */
export function refresh(db = openIndex()) {
  const root = paths().clients;
  const seen = new Set();
  const known = new Map(db.prepare('select path, mtime, size from source').all().map((r) => [r.path, r]));
  const del = db.prepare('delete from chunk where path = ?');
  const ins = db.prepare('insert into chunk (path, client, project, kind, status, title, body, ref, tags, hash) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const setSrc = db.prepare('insert or replace into source (path, mtime, size) values (?, ?, ?)');
  let changed = 0;
  const files = [];
  if (fs.existsSync(root)) {
    for (const c of fs.readdirSync(root)) {
      if (c.startsWith('.') || c === SCRATCH) continue;
      for (const f of walk(path.join(root, c))) files.push({ ...f, client: c });
      const dl = driveFile(c);
      if (fs.existsSync(dl)) {
        const st = fs.statSync(dl);
        files.push({ file: dl, mtime: st.mtimeMs, size: st.size, client: c, drive: true });
      }
    }
  }
  db.exec('begin');
  try {
    for (const f of files) {
      seen.add(f.file);
      const k = known.get(f.file);
      if (k && k.mtime === f.mtime && k.size === f.size) continue;
      del.run(f.file);
      let chunks = [];
      try {
        chunks = f.drive
          ? readJsonl(f.file).map((d) => ({ project: null, kind: 'drive_file', status: d.description ? 'source' : 'unverified', title: d.name, body: [d.name, d.description, d.folder_path].filter(Boolean).join('\n'), ref: d.id, tags: d.mimeType ?? '' }))
          : chunksFor(f.file, f.client);
      } catch {
        chunks = [];
      }
      for (const c of chunks) {
        const text = `${c.title ?? ''}\n${c.body ?? ''}`;
        ins.run(f.file, f.client, c.project ?? null, c.kind, c.status, c.title ?? null, c.body ?? null, c.ref ?? null, c.tags ?? '', sha256(text).slice(0, 24));
      }
      setSrc.run(f.file, f.mtime, f.size);
      changed++;
    }
    for (const p of known.keys()) {
      if (!seen.has(p)) {
        del.run(p);
        db.prepare('delete from source where path = ?').run(p);
        changed++;
      }
    }
    db.exec('commit');
  } catch (err) {
    db.exec('rollback');
    throw err;
  }
  return { files: files.length, changed, chunks: db.prepare('select count(*) n from chunk').get().n };
}

export function rebuild() {
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(paths().index + ext, { force: true });
  const db = openIndex();
  try {
    return refresh(db);
  } finally {
    db.close();
  }
}

// ---- embeddings ----

const toBlob = (arr) => Buffer.from(new Float32Array(arr).buffer);
const fromBlob = (b) => new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);

function embedder(requested) {
  const { provider, key } = pickProvider('embed', requested);
  return { provider, key, model: provider.EMBED_MODEL ?? `${provider.id}-embed` };
}

/** Embeds chunks that have no vector yet. Safe to stop and re-run. */
export async function embedMissing({ provider: requested, limit = 2000 } = {}) {
  const db = openIndex();
  try {
    refresh(db);
    const e = embedder(requested);
    const rows = db.prepare(`select distinct c.hash, c.title, c.body from chunk c left join vec v on v.hash = c.hash and v.model = ? where v.hash is null limit ?`).all(e.model, limit);
    if (!rows.length) return { embedded: 0, model: e.model };
    const vectors = await e.provider.embed({ key: e.key, texts: rows.map((r) => `${r.title ?? ''}\n${r.body ?? ''}`.slice(0, 6000)) });
    const ins = db.prepare('insert or replace into vec (hash, model, v) values (?, ?, ?)');
    db.exec('begin');
    rows.forEach((r, i) => ins.run(r.hash, e.model, toBlob(vectors[i])));
    db.exec('commit');
    return { embedded: rows.length, model: e.model };
  } finally {
    db.close();
  }
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const ftsQuery = (q) =>
  (String(q).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((w) => w.length > 1)
    .slice(0, 24)
    .map((w) => `"${w}"`)
    .join(' OR ');

/**
 * Hybrid search. Filters narrow first (client, project, kinds, statuses); then keyword and vector
 * rankings are merged with reciprocal rank fusion. Vectors are used only if they exist already, so a
 * search never makes a surprise paid call unless `semantic: true` is passed.
 */
export async function search(query, { client, project, kinds, statuses, k = 12, semantic = 'auto', provider } = {}) {
  const db = openIndex();
  try {
    refresh(db);
    const where = [];
    const args = [];
    if (client) where.push('c.client = ?') && args.push(client);
    if (project) where.push('(c.project = ? or c.project is null)') && args.push(project);
    if (kinds?.length) where.push(`c.kind in (${kinds.map(() => '?').join(',')})`) && args.push(...kinds);
    if (statuses?.length) where.push(`c.status in (${statuses.map(() => '?').join(',')})`) && args.push(...statuses);
    const filter = where.length ? ' and ' + where.join(' and ') : '';

    const ranks = new Map();
    const fq = ftsQuery(query);
    if (fq) {
      const rows = db.prepare(`select c.id from chunk_fts f join chunk c on c.id = f.rowid where chunk_fts match ?${filter} order by bm25(chunk_fts, 3.0, 1.0, 2.0) limit 60`).all(fq, ...args);
      rows.forEach((r, i) => ranks.set(r.id, (ranks.get(r.id) ?? 0) + 1 / (60 + i)));
    }

    let usedVectors = false;
    if (semantic !== false) {
      let e = null;
      try {
        e = embedder(provider);
      } catch {}
      const have = e ? db.prepare(`select c.id, v.v from chunk c join vec v on v.hash = c.hash and v.model = ? where 1=1${filter}`).all(e.model, ...args) : [];
      if (e && (have.length || semantic === true)) {
        const [qv] = await e.provider.embed({ key: e.key, texts: [query] });
        have
          .map((r) => ({ id: r.id, s: cosine(qv, fromBlob(r.v)) }))
          .sort((a, b) => b.s - a.s)
          .slice(0, 60)
          .forEach((r, i) => ranks.set(r.id, (ranks.get(r.id) ?? 0) + 1 / (60 + i)));
        usedVectors = have.length > 0;
      }
    }

    // Approved knowledge gets a small boost: it's what the studio should follow.
    const boost = { approved: 1.15, source: 1.05, draft: 1, unverified: 0.9 };
    const ids = [...ranks.keys()];
    if (!ids.length) return { results: [], used: { keywords: Boolean(fq), vectors: usedVectors } };
    const rows = db.prepare(`select * from chunk where id in (${ids.map(() => '?').join(',')})`).all(...ids);
    const results = rows
      .map((r) => ({ score: ranks.get(r.id) * (boost[r.status] ?? 1), client: r.client, project: r.project, kind: r.kind, status: r.status, title: r.title, text: r.body?.slice(0, 1200), ref: r.ref, file: path.relative(paths().workspace, r.path) }))
      .sort((a, b) => b.score - a.score)
      // The same text often appears many times (e.g. every image cropped from one slide): keep the best one, count the rest.
      .filter((r, i, arr) => {
        const key = `${r.kind}|${r.title}|${r.text}`;
        const first = arr.findIndex((x) => `${x.kind}|${x.title}|${x.text}` === key);
        if (first !== i) {
          arr[first].more = (arr[first].more ?? 0) + 1;
          return false;
        }
        return true;
      })
      .slice(0, k)
      .map(({ score, ...r }) => ({ ...r, score: Number((score * 1000).toFixed(2)) }));
    return { results, used: { keywords: Boolean(fq), vectors: usedVectors } };
  } finally {
    db.close();
  }
}

/**
 * What an agent needs before making work for a client: the client card, all approved brand rules,
 * and — when there's a request — the most relevant briefs, products, references and feedback.
 */
export async function clientContext(clientSlug, { query, project, k = 10 } = {}) {
  const c = readClient(clientSlug);
  const brandFile = path.join(clientDir(clientSlug), 'brand.md');
  const brand = fs.existsSync(brandFile) ? fs.readFileSync(brandFile, 'utf8') : null;
  const out = {
    client: { slug: c.slug, name: c.name, industry: c.industry ?? null, description: c.description ?? null, links: c.links ?? {}, defaults: c.defaults ?? {} },
    brand: { status: 'approved', file: `clients/${clientSlug}/brand.md`, text: brand },
    how_to_use: 'Follow "approved" items. Use "source" items as the client\'s own facts. Treat "draft" and "unverified" items as hints: say so if you rely on them.',
  };
  if (query) out.relevant = (await search(query, { client: clientSlug, project, k, statuses: ['source', 'draft', 'unverified', 'approved'] })).results.filter((r) => r.kind !== 'brand');
  return out;
}

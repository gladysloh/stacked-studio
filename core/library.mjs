import fs from 'node:fs';
import path from 'node:path';
import { StudioError } from './errors.mjs';
import { readYaml } from './fsutil.mjs';
import { mediaPath } from './media.mjs';
import { paths, repoRoot } from './paths.mjs';
import { layout } from './workspace.mjs';

// The shot library (library/shots/*.yaml, public): angles, placements, poses, hands, lighting,
// surfaces, motion and framing, each with prompt wording, pitfalls and search terms. Examples are
// private: any reference, board item or past-work item in clients/ tagged `shots: [<id>]`.

const DIR = path.join(repoRoot, 'library', 'shots');
let cache = null;

export function loadLibrary() {
  if (cache) return cache;
  const categories = [];
  const entries = new Map();
  let subjects = [];
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.yaml')).sort()) {
    const doc = readYaml(path.join(DIR, f), {});
    if (doc.subjects) {
      subjects = doc.subjects;
      continue;
    }
    categories.push({ id: doc.category, name: doc.name, count: doc.entries?.length ?? 0 });
    for (const e of doc.entries ?? []) {
      if (entries.has(e.id)) throw new Error(`Duplicate shot id ${e.id} in ${f}`);
      entries.set(e.id, { ...e, category: doc.category });
    }
  }
  cache = { categories, entries, subjects };
  return cache;
}

export const shotIds = () => new Set(loadLibrary().entries.keys());

/** Unknown ids are returned so callers can say so instead of silently storing typos. */
export function checkIds(ids = []) {
  const known = shotIds();
  return { ok: ids.filter((i) => known.has(i)), unknown: ids.filter((i) => !known.has(i)) };
}

const words = (s) => String(s ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Simple ranked lookup over names, aliases, descriptions. */
export function findShots({ query, category, subject, limit = 20 } = {}) {
  const lib = loadLibrary();
  let list = [...lib.entries.values()];
  if (category) list = list.filter((e) => e.category === category);
  if (subject) list = list.filter((e) => !e.applies || e.applies.includes(subject));
  if (query) {
    const q = words(query);
    list = list
      .map((e) => {
        const name = words(`${e.id} ${e.name} ${(e.aliases ?? []).join(' ')}`);
        const body = words(`${e.prompt} ${e.use_when}`);
        const score = q.reduce((s, w) => s + (name.includes(w) ? 3 : 0) + (body.includes(w) ? 1 : 0), 0);
        return { e, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.e);
  }
  return list.slice(0, limit);
}

/** Every tagged example in the workspace: board items, references and past work with `shots`. */
export function examples(ids) {
  const want = new Set([].concat(ids));
  const out = [];
  const root = paths().clients;
  if (!fs.existsSync(root)) return out;
  for (const client of fs.readdirSync(root)) {
    const cdir = path.join(root, client);
    if (client.startsWith('.') || !fs.statSync(cdir).isDirectory()) continue;
    const files = [];
    const rdir = layout.boards(client);
    if (fs.existsSync(rdir)) for (const b of fs.readdirSync(rdir)) files.push({ file: layout.board(client, b), where: `moodboards/${b}` });
    files.push({ file: layout.references(client), where: 'references' }, { file: layout.pastWork(client), where: 'past-work' });
    // Images inside deliverables (earlier versions, deck references) that have been tagged.
    const pdir = path.join(cdir, 'projects');
    if (fs.existsSync(pdir)) {
      for (const p of fs.readdirSync(pdir)) {
        const pp = path.join(pdir, p);
        if (!fs.statSync(pp).isDirectory()) continue;
        for (const d of fs.readdirSync(pp)) {
          const y = path.join(pp, d, 'deliverable.yaml');
          if (!fs.existsSync(y)) continue;
          for (const f of readYaml(y, {})?.files ?? []) {
            const hits = (f.shots ?? []).filter((s) => want.has(s));
            if (hits.length) out.push({ client, where: `projects/${p}/${d}`, shots: f.shots, matched: hits, title: f.name ?? null, take: f.take ?? null, url: null, sha: f.sha, file: f.sha ? mediaPath(f.sha) : null });
          }
        }
      }
    }
    for (const { file, where } of files) {
      if (!fs.existsSync(file)) continue;
      const doc = readYaml(file, {});
      for (const it of doc.items ?? []) {
        const hits = (it.shots ?? []).filter((s) => want.has(s));
        if (!hits.length) continue;
        out.push({ client, where, shots: it.shots, matched: hits, title: it.title ?? it.name ?? null, take: it.take ?? it.note ?? null, url: it.url ?? null, sha: it.sha ?? null, file: it.sha ? mediaPath(it.sha) : null });
      }
    }
  }
  return out;
}

export function getShot(id, { withExamples = true } = {}) {
  const e = loadLibrary().entries.get(id);
  if (!e) {
    const near = findShots({ query: id.replace(/^[a-z]+\./, '').replace(/-/g, ' '), limit: 5 }).map((x) => x.id);
    throw new StudioError(`No shot "${id}" in the library.`, near.length ? `Did you mean: ${near.join(', ')}?` : 'Browse with shot_library and a query or category.');
  }
  return withExamples ? { ...e, examples: examples([id]) } : e;
}

export function subjects() {
  return loadLibrary().subjects;
}

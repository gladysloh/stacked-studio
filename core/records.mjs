import fs from 'node:fs';
import path from 'node:path';
import { author } from './config.mjs';
import { StudioError } from './errors.mjs';
import { appendJsonl, readJsonl, readYaml, writeYamlAtomic } from './fsutil.mjs';
import { newId } from './ids.mjs';
import { mediaPath } from './media.mjs';
import { allProjects, layout } from './workspace.mjs';

// Generation records: one YAML file per image/video version in projects/<p>/generations/<id>.yaml.
// A record is written once and never edited; a change makes a new version that points at its parent.
// Feedback and approvals go in projects/<p>/review.jsonl, append-only.

export const REVIEW_ACTIONS = ['approve', 'reject', 'comment', 'rate', 'like', 'pick', 'compare', 'save', 'check'];

export function writeGeneration(rec) {
  const file = path.join(layout.generations(rec.client, rec.project), `${rec.id}.yaml`);
  if (fs.existsSync(file)) throw new StudioError(`Record ${rec.id} already exists; records are never overwritten.`);
  writeYamlAtomic(file, rec);
  index.set(rec.id, file);
  return file;
}

const newestFirst = (a, b) => String(b.created ?? '').localeCompare(String(a.created ?? '')) || (a.id < b.id ? 1 : -1);

// id -> file, filled lazily by scanning project folders.
const index = new Map();

function scan() {
  index.clear();
  for (const p of allProjects()) {
    const g = layout.generations(p.client, p.project);
    if (!fs.existsSync(g)) continue;
    for (const n of fs.readdirSync(g)) if (n.endsWith('.yaml')) index.set(n.slice(0, -5), path.join(g, n));
  }
}

export function findGeneration(id) {
  if (!id) return null;
  let file = index.get(id);
  if (!file || !fs.existsSync(file)) {
    scan();
    file = index.get(id);
  }
  return file ? readYaml(file, null) : null;
}

export function requireGeneration(id) {
  const g = findGeneration(id);
  if (!g) throw new StudioError(`There's no image or video with id ${id}.`, 'Use `history` or `studio images` to find the right id.');
  return g;
}

export function listGenerations({ client, project, limit = 50, includeTests = true } = {}) {
  scan();
  const out = [];
  for (const [, file] of index) {
    // …/clients/<client>/projects/<project>/_records/generations/<id>.yaml
    const rel = file.split(path.sep);
    const c = rel[rel.length - 6];
    const p = rel[rel.length - 4];
    if (client && c !== client) continue;
    if (project && p !== project) continue;
    const g = readYaml(file, null);
    if (g && (includeTests || !g.is_test)) out.push(g);
  }
  return out.sort(newestFirst).slice(0, limit);
}

/** Every version that shares a history (same root), oldest first, with review status. */
export function history(id) {
  const g = requireGeneration(id);
  return listGenerations({ client: g.client, project: g.project, limit: 10_000 })
    .filter((x) => x.root === g.root)
    .sort((a, b) => newestFirst(b, a))
    .map((x) => withReview(x));
}

export function findByRequestId(client, project, requestId) {
  if (!requestId) return null;
  return listGenerations({ client, project, limit: 10_000 }).find((g) => g.request_id === requestId) ?? null;
}

// ---- review ----

const reviewFile = (client, project) => layout.review(client, project);

export function addReview({ target, output = 0, action, value = null, note = null }) {
  if (!REVIEW_ACTIONS.includes(action)) throw new StudioError(`Unknown review action "${action}". Use one of: ${REVIEW_ACTIONS.join(', ')}.`);
  const g = requireGeneration(Array.isArray(target) ? target[0] : target);
  if (action === 'rate' && !(Number(value) >= 1 && Number(value) <= 5)) throw new StudioError('A rating is 1 to 5.');
  if (!Array.isArray(target) && (output < 0 || output >= Math.max(1, g.outputs?.length ?? 0))) throw new StudioError(`That record has ${g.outputs?.length ?? 0} outputs.`);
  const entry = { id: newId('r'), at: new Date().toISOString(), author: author(), target, output, action, value, note };
  appendJsonl(reviewFile(g.client, g.project), entry);
  return entry;
}

export function reviewsFor(client, project) {
  return readJsonl(reviewFile(client, project));
}

/** The record plus each output's current status (the latest approve/reject wins) and its notes. */
export function withReview(g) {
  const entries = reviewsFor(g.client, g.project).filter((e) => e.target === g.id || (Array.isArray(e.target) && e.target.includes(g.id)));
  const outputs = (g.outputs ?? []).map((o, i) => {
    const mine = entries.filter((e) => e.target === g.id && (e.output ?? 0) === i);
    const decision = mine.filter((e) => e.action === 'approve' || e.action === 'reject').at(-1);
    const save = mine.filter((e) => e.action === 'save').at(-1);
    return {
      ...o,
      file: mediaPath(o.sha),
      drive_id: o.drive_id ?? save?.value?.drive_id ?? null,
      status: decision ? (decision.action === 'approve' ? 'approved' : 'rejected') : 'new',
      rating: mine.filter((e) => e.action === 'rate').at(-1)?.value ?? null,
      liked: mine.some((e) => e.action === 'like'),
      comments: mine.filter((e) => e.action === 'comment' && !e.value?.check).map((e) => ({ at: e.at, author: e.author, note: e.note })),
      check: (() => {
        const c = mine.filter((e) => e.action === 'check' || (e.action === 'comment' && e.value?.check)).at(-1);
        if (!c) return null;
        // Checks migrated from New Gen Studio were "pass"/"issues" with a list; new ones use the rubric.
        if (c.action === 'comment') return { at: c.at, author: c.author, verdict: c.value.check === 'pass' ? 'meets_brief' : 'needs_changes', summary: c.note, issues: c.value.issues ?? [], legacy: true };
        return { at: c.at, author: c.author, summary: c.note, ...c.value };
      })(),
    };
  });
  return { ...g, outputs };
}

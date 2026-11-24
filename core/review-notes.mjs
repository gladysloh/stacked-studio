import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { author } from './config.mjs';
import { StudioError } from './errors.mjs';
import { deliverableDir } from './workspace.mjs';

// "Changes requested" for an asset: deliverable.yaml review_notes, one entry per requested change
//   { date: YYYY-MM-DD, change, from, done?, source? }
// Written by people (Workbench), by the agent from deck comments, and shown on the review deck.
// Edits keep the rest of deliverable.yaml (comments, order) as it is.

function fileFor(client, project, code) {
  const dir = deliverableDir(client, project, code);
  if (!dir) throw new StudioError(`There's no deliverable ${code} in ${project}.`);
  return path.join(dir, 'deliverable.yaml');
}

export function listNotes(client, project, code) {
  const f = fileFor(client, project, code);
  const doc = YAML.parseDocument(fs.readFileSync(f, 'utf8'));
  return (doc.get('review_notes')?.toJSON?.() ?? []).map((n, index) => ({ index, ...n, done: Boolean(n.done) }));
}

/** action: add (change, from?) | done | undone | remove (index). Returns the updated list. */
export function editNotes(client, project, code, { action, change, from, index, source } = {}) {
  const f = fileFor(client, project, code);
  const doc = YAML.parseDocument(fs.readFileSync(f, 'utf8'));
  const notes = doc.get('review_notes')?.toJSON?.() ?? [];
  if (action === 'add') {
    const text = String(change ?? '').trim();
    if (!text) throw new StudioError('Write the change first.');
    notes.push({ date: new Date().toISOString().slice(0, 10), change: text, from: from?.trim() || author(), ...(source ? { source } : {}) });
  } else {
    const n = notes[Number(index)];
    if (!n) throw new StudioError(`There's no change number ${index} on ${code}.`);
    if (action === 'done') n.done = true;
    else if (action === 'undone') delete n.done;
    else if (action === 'remove') notes.splice(Number(index), 1);
    else throw new StudioError(`Unknown action "${action}". Use add, done, undone or remove.`);
  }
  doc.set('review_notes', notes);
  fs.writeFileSync(f, String(doc));
  return listNotes(client, project, code);
}

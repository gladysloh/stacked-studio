import fs from 'node:fs';
import path from 'node:path';
import { readYaml, slugify, writeYamlAtomic } from './fsutil.mjs';
import { layout, listDeliverables, projectDir } from './workspace.mjs';

// Sections: a deck groups deliverables under a title ("GOLD SERIES") with shared mood and overview
// slides. Those images belong to the section, not to each deliverable, so they're stored once in
// projects/<p>/sections.yaml and shown with every deliverable in the section. Readable copies go in
// projects/<p>/references/<section>/.

const file = (client, project) => path.join(projectDir(client, project), 'sections.yaml');

export function readSections(client, project) {
  return readYaml(file(client, project), {})?.sections ?? [];
}

/** The section a deliverable belongs to, with its images. */
export function sectionFor(client, project, code) {
  return readSections(client, project).find((s) => (s.codes ?? []).some((c) => c.toLowerCase() === String(code).toLowerCase())) ?? null;
}

/**
 * Saves section images: [{ section, codes, sha, mime, width, height, role, slide }]. Entries from the
 * same source are replaced; others (e.g. added by hand) are kept. Returns the section count.
 */
export function saveSections(client, project, images, source) {
  // Replace what this source added before: its images go, and a section left without images keeps
  // only the deliverables named by the new images (or disappears).
  const existing = readSections(client, project)
    .map((s) => {
      const kept = (s.images ?? []).filter((i) => i.source !== source);
      return { ...s, images: kept, codes: kept.length === (s.images ?? []).length ? s.codes ?? [] : [] };
    })
    .filter((s) => s.images.length);
  const byName = new Map(existing.map((s) => [s.name, s]));
  for (const im of images) {
    const sec = byName.get(im.section) ?? { name: im.section, codes: [], images: [] };
    sec.codes = [...new Set([...(sec.codes ?? []), ...im.codes])].sort();
    if (!sec.images.some((x) => x.sha === im.sha && x.role === im.role)) sec.images.push({ sha: im.sha, mime: im.mime, width: im.width, height: im.height, role: im.role, slide: im.slide, source });
    byName.set(im.section, sec);
  }
  const sections = [...byName.values()].filter((s) => s.images.length);
  writeYamlAtomic(file(client, project), { sections });
  // Each deliverable records its section.
  for (const d of listDeliverables(client, project)) {
    const sec = sections.find((s) => s.codes.includes(d.code));
    const y = path.join(d.dir, 'deliverable.yaml');
    const meta = readYaml(y, {}) ?? {};
    if ((meta.section ?? null) === (sec?.name ?? null)) continue;
    if (sec) meta.section = sec.name;
    else delete meta.section;
    writeYamlAtomic(y, meta);
  }
  return sections.length;
}

/** Deck slide titles from decks/<deck>/slides.md: slide number → title. */
function slideTitles(client, deckSlug) {
  const f = deckSlug ? path.join(layout.decks(client), deckSlug, 'slides.md') : null;
  if (!f || !fs.existsSync(f)) return new Map();
  return new Map([...fs.readFileSync(f, 'utf8').matchAll(/^## Slide (\d+)(?: — (.*))?$/gm)].map((m) => [Number(m[1]), (m[2] ?? '').trim()]));
}

/**
 * Turns mood/overview images that were copied into several deliverables into shared sections.
 * Groups images by the exact set of deliverables that share them; names each group after the
 * nearest all-capitals title slide before it in the deck. Safe to run again.
 */
export function consolidateSections(client, project) {
  const dels = listDeliverables(client, project);
  const shared = new Map();
  for (const d of dels) {
    const meta = readYaml(path.join(d.dir, 'deliverable.yaml'), {}) ?? {};
    for (const f of meta.files ?? []) {
      if (!['mood', 'overview'].includes(f.role) || f.source === 'upload') continue;
      const key = `${f.sha}|${f.role}`;
      const e = shared.get(key) ?? { ...f, codes: new Set() };
      e.codes.add(d.code);
      shared.set(key, e);
    }
  }
  const groups = new Map();
  for (const e of shared.values()) {
    if (e.codes.size < 2) continue;
    const sig = [...e.codes].sort().join(',');
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push(e);
  }
  if (!groups.size) return { sections: 0, moved: 0 };
  const deck = readYaml(path.join(projectDir(client, project), 'project.yaml'), {})?.deck;
  const titles = slideTitles(client, deck);
  const titleBefore = (n) => {
    for (let i = n; i > 0; i--) {
      const t = titles.get(i) ?? '';
      if (t && t.length <= 60 && t === t.toUpperCase() && /[A-Z]/.test(t) && !/^CREATIVE\b/.test(t)) return t.replace(/\s+/g, ' ');
    }
    return null;
  };
  const images = [];
  let i = 0;
  for (const [sig, list] of groups) {
    i++;
    const firstSlide = Math.min(...list.map((x) => x.slide ?? Infinity));
    const name = (Number.isFinite(firstSlide) && titleBefore(firstSlide)) || `Section ${i}`;
    for (const e of list) images.push({ section: name, codes: sig.split(','), sha: e.sha, mime: e.mime, width: e.width ?? null, height: e.height ?? null, role: e.role, slide: e.slide ?? null });
  }
  const count = saveSections(client, project, images, 'deck');
  // Remove the per-deliverable copies that are now shared.
  const movedKeys = new Set(images.map((x) => `${x.sha}|${x.role}`));
  let moved = 0;
  for (const d of dels) {
    const y = path.join(d.dir, 'deliverable.yaml');
    const meta = readYaml(y, {}) ?? {};
    const before = (meta.files ?? []).length;
    meta.files = (meta.files ?? []).filter((f) => !movedKeys.has(`${f.sha}|${f.role}`) || f.source === 'upload');
    moved += before - meta.files.length;
    if (meta.files.length !== before) writeYamlAtomic(y, meta);
  }
  return { sections: count, moved };
}

export const sectionSlug = (name) => slugify(name) || 'section';

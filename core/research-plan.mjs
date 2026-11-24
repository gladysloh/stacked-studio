import { StudioError } from './errors.mjs';
import { examples, loadLibrary, subjects } from './library.mjs';
import { searchProvider } from './providers/search.mjs';
import { readClient, SCRATCH } from './workspace.mjs';

// Turns "what are we shooting" into targeted searches: per subject type (product, model, texture…)
// and per shot category (angles, placements, poses, lighting…), with ready links per source.
// The agent runs them (image_search with a key, or its own web/browser tools) and saves the good
// results with moodboard_save, tagged with the shot ids they illustrate.

export const SOURCES = {
  pinterest: (q) => `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(q)}`,
  google_images: (q) => `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`,
  behance: (q) => `https://www.behance.net/search/projects?search=${encodeURIComponent(q)}`,
};

const fill = (t, v) => t.replaceAll('{subject}', v.subject).replaceAll('{category}', v.category).replace(/\s+/g, ' ').trim();

export function planResearch({ subject = 'product', subject_name, category, shots = [], per_category = 3, client, competitors = [], sources = Object.keys(SOURCES) }) {
  const subs = subjects();
  const s = subs.find((x) => x.id === subject);
  if (!s) throw new StudioError(`Unknown subject "${subject}". Use one of: ${subs.map((x) => x.id).join(', ')}.`);
  for (const src of sources) if (!SOURCES[src]) throw new StudioError(`Unknown source "${src}". Use: ${Object.keys(SOURCES).join(', ')}.`);
  const v = { subject: subject_name || category || s.name.toLowerCase(), category: category || subject_name || '' };
  const lib = loadLibrary();
  const links = (q) => Object.fromEntries(sources.map((src) => [src, SOURCES[src](q)]));
  const uniq = (arr) => [...new Set(arr)];

  const groups = [{ group: 'overview', shots: [], queries: uniq(s.search.map((t) => fill(t, v))).map((q) => ({ q, links: links(q) })) }];

  const picked = shots.length ? shots.map((id) => lib.entries.get(id)).filter(Boolean) : [];
  const unknown = shots.filter((id) => !lib.entries.has(id));
  for (const cat of s.categories) {
    // Default: the subject's focus shots first (e.g. dynamic layouts for products), then the rest.
    const focus = (s.focus ?? []).map((id) => lib.entries.get(id)).filter((e) => e?.category === cat);
    const rest = [...lib.entries.values()].filter((e) => e.category === cat && (!e.applies || e.applies.includes(subject)) && !focus.includes(e));
    const entries = picked.length ? picked.filter((e) => e.category === cat) : [...focus, ...rest].slice(0, per_category);
    if (!entries.length) continue;
    const queries = uniq(entries.flatMap((e) => (e.search ?? []).slice(0, 2).map((t) => fill(t, v))));
    groups.push({ group: cat, shots: entries.map((e) => ({ id: e.id, name: e.name })), queries: queries.map((q) => ({ q, links: links(q) })) });
  }

  const rivals = [...competitors];
  if (client && client !== SCRATCH) rivals.push(...(readClient(client).competitors ?? []).map((c) => (typeof c === 'string' ? c : c.name)));
  if (rivals.length) {
    const qs = uniq(rivals.flatMap((r) => [`${r} ${v.category || v.subject} campaign`, `${r} ${v.subject} product photography`]));
    groups.push({ group: 'competitors', shots: [], queries: qs.map((q) => ({ q, links: links(q) })) });
  }

  const allShots = groups.flatMap((g) => g.shots.map((x) => x.id));
  const have = examples(allShots);
  const provider = searchProvider();
  return {
    subject: s.id,
    filled: v,
    groups,
    unknown_shots: unknown,
    existing_examples: have.length,
    image_search: provider ? provider.id : null,
    next: provider
      ? 'Run image_search for the queries you need, open the best results, then moodboard_save them with `shots` tags.'
      : 'No image search key: use your web search or browser on these queries (links included), then moodboard_save the image links with `shots` tags.',
  };
}

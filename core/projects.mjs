import fs from 'node:fs';
import path from 'node:path';
import { readJsonl, readYaml } from './fsutil.mjs';
import { listGenerations, withReview } from './records.mjs';
import { clientDir, deliverableDir, layout, listClients, listDeliverables, listProjects } from './workspace.mjs';
import { listProducts } from './products.mjs';
import { sectionFor } from './sections.mjs';

// Read models for the Workbench: clients → projects → deliverables, with the brief, deck images,
// made images and open deck comments for each deliverable.

function section(md, name) {
  const m = md.match(new RegExp(`##\\s*${name}\\s*\\n+([\\s\\S]*?)(?=\\n##\\s|$)`, 'i'));
  return m ? m[1].trim() : null;
}

const deliverableDirs = (client, project) => listDeliverables(client, project).map((d) => d.code);

function deliverableSummary(client, project, code, gens) {
  const dir = deliverableDir(client, project, code) ?? '';
  const brief = fs.existsSync(path.join(dir, 'brief.md')) ? fs.readFileSync(path.join(dir, 'brief.md'), 'utf8') : '';
  const meta = readYaml(path.join(dir, 'deliverable.yaml'), {}) ?? {};
  const mine = gens.filter((g) => g.deliverable === code && g.status === 'done');
  const outs = mine.flatMap((g) => withReview(g).outputs.map((o) => ({ ...o, id: g.id, created: g.created })));
  const approved = outs.filter((o) => o.status === 'approved');
  const latest = outs.sort((a, b) => String(b.created).localeCompare(String(a.created)))[0];
  const deckVisual = (meta.files ?? []).find((f) => f.role === 'visual' && !f.blank) ?? (meta.files ?? []).find((f) => !f.blank);
  const status = approved.length ? 'approved' : mine.length ? 'in_progress' : meta.status === 'approved' ? 'approved' : 'not_started';
  return {
    code,
    status,
    product: section(brief, 'Product') ?? meta.messaging?.at(-1)?.product ?? null,
    key_message: section(brief, 'Key message') ?? meta.messaging?.at(-1)?.key_message ?? null,
    images: mine.length,
    approved: approved.length,
    thumb: approved[0]?.sha ?? latest?.sha ?? deckVisual?.sha ?? null,
    thumb_kind: approved[0] ? 'approved' : latest ? 'made' : deckVisual ? 'deck' : null,
  };
}

export function clientsOverview() {
  return listClients().map((c) => {
    const projects = listProjects(c.slug);
    const gens = listGenerations({ client: c.slug, limit: 100_000 }).filter((g) => g.status === 'done' && !g.is_test);
    const cover = gens.map((g) => withReview(g)).flatMap((g) => g.outputs).find((o) => o.status === 'approved')?.sha ?? gens[0]?.outputs?.[0]?.sha ?? null;
    return { slug: c.slug, name: c.name, industry: c.industry ?? null, projects: projects.length, images: gens.length, cover };
  });
}

export function clientPage(client) {
  const c = listClients().find((x) => x.slug === client) ?? { slug: client, name: client };
  const gens = listGenerations({ client, limit: 100_000 });
  const projects = listProjects(client).map((p) => {
    const codes = deliverableDirs(client, p.slug);
    const ds = codes.map((code) => deliverableSummary(client, p.slug, code, gens));
    const imgs = gens.filter((g) => g.project === p.slug && g.status === 'done');
    return {
      slug: p.slug,
      name: p.name,
      status: p.status ?? 'active',
      deliverables: ds.length,
      by_status: ds.reduce((s, d) => ((s[d.status] = (s[d.status] ?? 0) + 1), s), {}),
      images: imgs.length,
      cover: ds.find((d) => d.thumb_kind === 'approved')?.thumb ?? imgs[0]?.outputs?.[0]?.sha ?? ds.find((d) => d.thumb)?.thumb ?? null,
    };
  });
  const count = (file) => (readYaml(file, {})?.items ?? []).length;
  const refs = readYaml(layout.references(client), {})?.items ?? [];
  return {
    client: { slug: c.slug, name: c.name, industry: c.industry ?? null, links: c.links ?? {} },
    projects,
    library: { products: listProducts(client).length, references: refs.filter((r) => r.kind !== 'logo').length, logos: refs.filter((r) => r.kind === 'logo').length, past_work: count(layout.pastWork(client)), boards: fs.existsSync(layout.boards(client)) ? fs.readdirSync(layout.boards(client)).length : 0 },
  };
}

export function projectPage(client, project) {
  const dir = path.join(clientDir(client), 'projects', project);
  const meta = readYaml(path.join(dir, 'project.yaml'), {}) ?? {};
  const brief = fs.existsSync(path.join(dir, 'brief.md')) ? fs.readFileSync(path.join(dir, 'brief.md'), 'utf8') : null;
  const gens = listGenerations({ client, project, limit: 100_000 });
  const deliverables = deliverableDirs(client, project).map((code) => deliverableSummary(client, project, code, gens));
  const loose = gens.filter((g) => g.status === 'done' && !g.deliverable).length;
  return { client, project, name: meta.name ?? project, status: meta.status ?? 'active', deck: meta.deck ?? null, brief, deliverables, other_images: loose };
}

export function deliverablePage(client, project, code) {
  const dir = deliverableDir(client, project, code) ?? '';
  const meta = readYaml(path.join(dir, 'deliverable.yaml'), {}) ?? {};
  const brief = fs.existsSync(path.join(dir, 'brief.md')) ? fs.readFileSync(path.join(dir, 'brief.md'), 'utf8') : null;
  const gens = listGenerations({ client, project, limit: 100_000 }).filter((g) => g.deliverable === code);
  // One entry per image history (its newest version), newest first.
  const latest = new Map();
  for (const g of gens) if (g.status === 'done' && !latest.has(g.root)) latest.set(g.root, g);
  const images = [...latest.values()].map((g) => {
    const r = withReview(g);
    return { id: g.id, version: g.version, versions: gens.filter((x) => x.root === g.root).length, concept: g.concept ?? null, created: g.created, outputs: r.outputs.map((o) => ({ sha: o.sha, status: o.status })) };
  });
  const deckDir = layout.decks(client);
  const comments = fs.existsSync(deckDir)
    ? fs.readdirSync(deckDir).flatMap((d) => readJsonl(path.join(deckDir, d, 'comments.jsonl')).filter((c) => c.asset_code === code).map((c) => ({ deck: d, author: c.author, body: c.body, resolved: Boolean(c.resolved), created: c.created ?? null })))
    : [];
  const roles = {};
  for (const f of meta.files ?? []) if (!f.blank) (roles[f.role === 'visual' ? 'earlier versions' : f.role ?? 'other'] ??= []).push(f.sha);
  const section = sectionFor(client, project, code);
  for (const im of section?.images ?? []) if (!im.blank) (roles[`${section.name} · ${im.role}`] ??= []).push(im.sha);
  const concepts = fs.existsSync(path.join(dir, 'concepts')) ? fs.readdirSync(path.join(dir, 'concepts')).filter((n) => n.endsWith('.md')).map((n) => ({ file: n, text: fs.readFileSync(path.join(dir, 'concepts', n), 'utf8') })) : [];
  return { client, project, code, section: section?.name ?? null, folder: path.relative(clientDir(client), dir), concepts, status: deliverableSummary(client, project, code, gens).status, brief, deck_images: roles, images, comments: comments.sort((a, b) => Number(a.resolved) - Number(b.resolved)) };
}

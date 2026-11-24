import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { StudioError } from './errors.mjs';
import { readYaml, slugify, writeFileAtomic, writeYamlAtomic } from './fsutil.mjs';
import { paths } from './paths.mjs';

// Client and project folders: the source of truth, readable and editable by hand.
//
//   clients/<client>/client.yaml, brand.md, knowledge/, products/, references/, past-work/, research/, decks/
//   clients/<client>/projects/<project>/project.yaml, brief.md, deliverables/, concepts/, generations/, review.jsonl
//
// Work without a client goes to clients/_scratch/projects/scratch/ with the same layout.

export const SCRATCH = '_scratch';
export const SCRATCH_PROJECT = 'scratch';

const Link = z.union([z.string(), z.object({ title: z.string().optional(), url: z.string().optional(), drive_id: z.string().optional() }).passthrough()]);

export const ClientSchema = z
  .object({
    name: z.string().min(1),
    industry: z.string().optional(),
    description: z.string().optional(),
    links: z
      .object({
        drive_folder: Link.optional(),
        guidelines: z.array(Link).optional(),
        product_assets: z.array(Link).optional(),
        decks: z.array(Link).optional(),
        figma: z.array(Link).optional(),
        pinterest: z.array(Link).optional(),
        past_campaigns: z.array(Link).optional(),
      })
      .passthrough()
      .optional(),
    defaults: z.object({ image_model: z.string().optional(), aspect: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

export const ProjectSchema = z
  .object({
    name: z.string().min(1),
    status: z.string().optional(),
    links: z.record(z.string(), z.any()).optional(),
  })
  .passthrough();

const CLIENT_DIRS = ['knowledge', 'products', 'references', 'past-work', 'research', 'decks', 'projects'];
const PROJECT_DIRS = ['deliverables', 'concepts', 'generations'];

export const clientDir = (slug) => path.join(paths().clients, slug);
export const projectDir = (client, project) => path.join(clientDir(client), 'projects', project);

export function listClients() {
  const root = paths().clients;
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((n) => !n.startsWith('.') && n !== SCRATCH && fs.existsSync(path.join(root, n, 'client.yaml')))
    .sort()
    .map((slug) => ({ slug, ...readYaml(path.join(root, slug, 'client.yaml'), {}) }));
}

/** Finds a client by folder name or display name (case-insensitive). */
export function resolveClient(ref) {
  if (!ref || ref === SCRATCH) return SCRATCH;
  const want = String(ref).toLowerCase();
  const hit = listClients().find((c) => c.slug === want || c.slug === slugify(ref) || String(c.name).toLowerCase() === want);
  if (!hit) throw new StudioError(`There's no client "${ref}".`, 'See clients with `studio client list`, or add one with `studio client new "<name>"`.');
  return hit.slug;
}

export function readClient(slug) {
  if (slug === SCRATCH) return { slug, name: 'No client' };
  const file = path.join(clientDir(slug), 'client.yaml');
  const data = readYaml(file, null);
  if (!data) throw new StudioError(`Client folder "${slug}" has no client.yaml.`);
  const parsed = ClientSchema.safeParse(data);
  if (!parsed.success) throw new StudioError(`client.yaml for "${slug}" has a problem: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return { slug, ...parsed.data };
}

export function createClient(name, fields = {}) {
  const slug = slugify(name);
  const dir = clientDir(slug);
  if (fs.existsSync(path.join(dir, 'client.yaml'))) throw new StudioError(`Client "${slug}" already exists.`);
  const data = ClientSchema.parse({ name, links: {}, ...fields });
  writeYamlAtomic(path.join(dir, 'client.yaml'), data);
  for (const d of CLIENT_DIRS) fs.mkdirSync(path.join(dir, d), { recursive: true });
  if (!fs.existsSync(path.join(dir, 'brand.md'))) {
    writeFileAtomic(
      path.join(dir, 'brand.md'),
      `# ${name} — brand\n\nApproved brand knowledge only. Drafts and unverified notes go in knowledge/.\n\n## Palette\n\n## Typography\n\n## Tone of voice\n\n## Do\n\n## Don't\n\n## Products\n`
    );
  }
  return slug;
}

export function listProjects(client) {
  const dir = path.join(clientDir(client), 'projects');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => !n.startsWith('.') && fs.statSync(path.join(dir, n)).isDirectory())
    .sort()
    .map((slug) => ({ slug, ...readYaml(path.join(dir, slug, 'project.yaml'), { name: slug }) }));
}

/** Returns the project folder slug, creating the folder when `create` is set. */
export function ensureProject(client, project, { create = true } = {}) {
  const slug = project ? slugify(project) : client === SCRATCH ? SCRATCH_PROJECT : null;
  if (!slug) throw new StudioError('Which project is this for?', `Pass a project, or see them with: studio project list ${client}`);
  const dir = projectDir(client, slug);
  if (!fs.existsSync(path.join(dir, 'project.yaml'))) {
    const existing = listProjects(client).find((p) => String(p.name).toLowerCase() === String(project ?? '').toLowerCase());
    if (existing) return existing.slug;
    if (!create) throw new StudioError(`There's no project "${project}" for ${client}.`);
    writeYamlAtomic(path.join(dir, 'project.yaml'), { name: project ?? slug, status: 'active', created: new Date().toISOString() });
  }
  for (const d of PROJECT_DIRS) fs.mkdirSync(path.join(dir, d), { recursive: true });
  return slug;
}

/** Every project folder in the workspace (including scratch): [{client, project, dir}]. */
export function allProjects() {
  const root = paths().clients;
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const c of fs.readdirSync(root)) {
    const pdir = path.join(root, c, 'projects');
    if (c.startsWith('.') || !fs.existsSync(pdir)) continue;
    for (const p of fs.readdirSync(pdir)) {
      const dir = path.join(pdir, p);
      if (!p.startsWith('.') && fs.statSync(dir).isDirectory()) out.push({ client: c, project: p, dir });
    }
  }
  return out;
}

import { z } from 'zod';
import { compare, INPUT_ROLES, makeImage } from './generate.mjs';
import { clientContext, search } from './index.mjs';
import { listProviders } from './providers/index.mjs';
import { addReview, history, listGenerations, REVIEW_ACTIONS, requireGeneration, withReview } from './records.mjs';
import { catalog, readSkill } from './skills.mjs';
import { spendSummary } from './spend.mjs';
import { listClients, listProjects, resolveClient } from './workspace.mjs';

// The studio's operations, defined once. The MCP server, the CLI (`studio run <op>`) and the
// Workbench all call these, so every interface behaves the same. Model knowledge lives in skills;
// these stay few and general.

const Input = z.object({
  path: z.string().optional().describe('A local PNG, JPEG or WebP file'),
  sha: z.string().optional().describe('An image already in the media cache, by its sha256'),
  generation: z.string().optional().describe('An earlier image, by record id'),
  output: z.number().int().min(0).optional().describe('Which output of that record (default 0)'),
  role: z.enum(INPUT_ROLES).optional().describe('What the image is for: product (keep exact), reference, style, person, layout'),
  note: z.string().optional().describe('What to take from it, e.g. "lighting only"'),
});

const Where = {
  client: z.string().optional().describe('Client folder or name. Leave out to work without a client (scratch).'),
  project: z.string().optional().describe('Project folder or name. Created if new.'),
};

const imageOpts = {
  n: z.number().int().min(1).max(4).default(1).describe('How many variations'),
  provider: z.string().optional().describe('gemini, fal or test. Leave out for the default.'),
  model: z.string().optional(),
  size: z.enum(['1K', '2K', '4K']).optional(),
  aspect: z.string().optional().describe('e.g. 4:5, 1:1, 9:16, 16:9'),
  allow_text: z.boolean().optional().describe('Allow headlines or copy in the image. Default: only text printed on the product.'),
  context_used: z.array(z.object({ kind: z.string(), ref: z.string(), version: z.string().optional() })).optional().describe('Client knowledge you relied on (from client_context), so the record shows it'),
  request_id: z.string().optional().describe('A unique id for this request: repeating it returns the first result instead of paying twice'),
};

/** Keeps answers small for agents: the files to open, ids, status. */
export function summarize(g) {
  const r = withReview(g);
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    client: r.client,
    project: r.project,
    deliverable: r.deliverable,
    version: r.version,
    previous_version: r.parent,
    branch_of: r.branch_of,
    history: r.root,
    prompt: r.prompt,
    what_changed: r.what_changed,
    provider: r.provider,
    model: r.model,
    settings: r.params,
    inputs: r.inputs?.map((i) => ({ role: i.role, note: i.note, name: i.name })),
    cost_usd: r.cost_usd,
    error: r.error ?? null,
    outputs: r.outputs.map((o, i) => ({ output: i, file: o.file, width: o.width, height: o.height, status: o.status, drive_id: o.drive_id })),
    ...(g.repeated ? { repeated: true } : {}),
  };
}

export const OPS = {
  studio_status: {
    title: 'Studio status',
    description: 'Checks that the studio works: keys, providers, skills, optional tools. Same as `studio doctor`.',
    input: {},
    run: async () => {
      const { runChecks } = await import('./doctor.mjs');
      return { checks: await runChecks(), providers: listProviders(), spend: spendSummary(7) };
    },
  },

  studio_capabilities: {
    title: 'What the studio can do',
    description:
      'Lists every skill and pipeline (research, concepts, image generation, editing, product photography, video, campaign, QA) with when to use it. ' +
      'Pass a name to get that skill\'s full instructions. Start here when unsure which capability fits the request.',
    input: { name: z.string().optional().describe('A skill or pipeline name to read in full') },
    run: async ({ name }) => {
      if (!name) return { capabilities: catalog() };
      const s = readSkill(name);
      if (!s) throw new Error(`No skill "${name}". Call studio_capabilities without a name to see them all.`);
      return { name: s.name, type: s.type, instructions: s.text, folder: s.dir };
    },
  },

  client_list: {
    title: 'Clients and projects',
    description: 'Lists clients (folders in clients/) and, for one client, its projects.',
    input: { client: z.string().optional() },
    run: async ({ client }) => {
      if (client) {
        const slug = resolveClient(client);
        return { client: slug, projects: listProjects(slug) };
      }
      return { clients: listClients().map((c) => ({ slug: c.slug, name: c.name, industry: c.industry ?? null })) };
    },
  },

  client_context: {
    title: 'Client context',
    description:
      "A client's card, links and all APPROVED brand rules, plus (with a query) the most relevant briefs, deliverables, products, references, deck comments and past images, each labelled approved / source / draft / unverified. " +
      'Call this before making anything for a client, and pass what you relied on as context_used when generating.',
    input: { client: z.string(), query: z.string().optional().describe('What you are about to make, e.g. "EPS005 honey jar product shot, warm light"'), project: z.string().optional(), k: z.number().int().min(1).max(40).optional() },
    run: async ({ client, query, project, k }) => clientContext(resolveClient(client), { query, project, k }),
  },

  search: {
    title: 'Search',
    description: 'Searches client knowledge, briefs, decks, comments, products, references, Drive files and past generations (keywords + meaning). Filters by client, project, kind and trust status.',
    input: {
      query: z.string().min(1),
      client: z.string().optional(),
      project: z.string().optional(),
      kinds: z.array(z.string()).optional().describe('brand, knowledge, brief, deliverable, concept, product, reference, past_work, research, deck_slide, deck_comment, drive_file, generation'),
      statuses: z.array(z.enum(['approved', 'source', 'draft', 'unverified'])).optional(),
      k: z.number().int().min(1).max(50).optional(),
    },
    run: async ({ query, client, ...rest }) => search(query, { client: client ? resolveClient(client) : undefined, ...rest }),
  },

  image_generate: {
    title: 'Make images',
    description:
      'Makes new images from a prompt, optionally with reference images (products, style, people, layout), and records them with full history. ' +
      'Always use this (or image_edit) to make images; never call image services directly. Costs money with a real provider (about $0.04–0.15 per image). ' +
      'Returns file paths: open them to check the result.',
    input: {
      prompt: z.string().min(1).describe('The final prompt for the image model'),
      instruction: z.string().optional().describe("The person's request in their own words"),
      ...Where,
      inputs: z.array(Input).max(14).optional().describe('Reference images, most important first'),
      deliverable: z.string().optional().describe('Deliverable code, e.g. EPS005'),
      concept: z.string().optional(),
      ...imageOpts,
    },
    run: async (a) => summarize(await makeImage({ ...a, mode: 'new' })),
  },

  image_edit: {
    title: 'Change an image',
    description:
      'Changes an existing image without starting over: natural-language or targeted edits ("softer lighting", "remove the shadow on the left"), product fixes, compositing extra inputs. ' +
      'mode "edit" makes the next version of the same image; mode "branch" starts a new direction from it. The source image is passed automatically.',
    input: {
      id: z.string().describe('Record id of the image to change'),
      output: z.number().int().min(0).optional().describe('Which of its outputs (default 0)'),
      prompt: z.string().min(1).describe('What to change, as an instruction to the image model'),
      instruction: z.string().optional(),
      what_changed: z.string().optional().describe('One short line for the history'),
      mode: z.enum(['edit', 'branch']).default('edit'),
      inputs: z.array(Input).max(13).optional().describe('Extra images to use (e.g. a product cutout to composite)'),
      ...imageOpts,
    },
    run: async ({ id, output = 0, ...a }) => summarize(await makeImage({ ...a, mode: a.mode ?? 'edit', parent: id, parent_output: output })),
  },

  image_upscale: {
    title: 'Upscale an image',
    description: 'Makes a higher-resolution version of an image, keeping it otherwise identical. Recorded as the next version.',
    input: { id: z.string(), output: z.number().int().min(0).optional(), provider: z.string().optional() },
    run: async ({ id, output = 0, provider }) => summarize(await makeImage({ mode: 'upscale', parent: id, parent_output: output, provider, what_changed: 'Upscaled' })),
  },

  image_compare: {
    title: 'Compare images',
    description: 'Puts 2–4 images side by side (files, prompts, a word diff of the prompts) and records the comparison; optionally records which one was picked.',
    input: {
      items: z.array(z.union([z.string(), z.object({ id: z.string(), output: z.number().int().min(0).optional() })])).min(2).max(4),
      pick: z.union([z.string(), z.object({ id: z.string(), output: z.number().int().min(0).optional() })]).optional(),
      note: z.string().optional(),
    },
    run: async (a) => compare(a),
  },

  history: {
    title: 'History',
    description: 'With an id: every version of that image, oldest first, with status and what changed. Without: recent images, filtered by client/project.',
    input: { id: z.string().optional(), ...Where, limit: z.number().int().min(1).max(200).optional() },
    run: async ({ id, client, project, limit = 20 }) => {
      if (id) return { versions: history(id).map(summarize) };
      return { images: listGenerations({ client: client ? resolveClient(client) : undefined, project, limit }).map(summarize) };
    },
  },

  review: {
    title: 'Review',
    description: 'Approves, rejects, rates (1–5), likes or comments on an image. Approval is a person\'s decision: only approve or reject when they say so.',
    input: { id: z.string(), output: z.number().int().min(0).optional(), action: z.enum(REVIEW_ACTIONS.filter((a) => !['pick', 'compare', 'save'].includes(a))), value: z.number().optional(), note: z.string().optional() },
    run: async ({ id, output = 0, action, value, note }) => {
      requireGeneration(id);
      addReview({ target: id, output, action, value: value ?? null, note: note ?? null });
      return summarize(requireGeneration(id));
    },
  },

  drive_index: {
    title: 'Index a client\'s Drive folder',
    description: "Lists every file in the client's Google Drive folder (Shared Drives included) so `search` can find guidelines, decks, product shots and past work by name, folder and description. Downloads nothing.",
    input: { client: z.string() },
    run: async ({ client }) => {
      const { indexDrive } = await import('./google/studio-drive.mjs');
      const r = await indexDrive(resolveClient(client));
      const { refresh } = await import('./index.mjs');
      refresh();
      return r;
    },
  },

  drive_fetch: {
    title: 'Fetch from Drive',
    description: 'Downloads a Google Drive file (link or id) into the local cache, once, and returns its local file and sha — ready to use as an image input (`{sha}`) or to read. Google Slides/Docs come back as PDF. Find ids with `search` (kind drive_file).',
    input: { file: z.string().describe('Drive link or file id') },
    run: async ({ file }) => {
      const { fetchFile } = await import('./google/drive.mjs');
      return fetchFile(file);
    },
  },

  drive_save: {
    title: 'Save to Drive',
    description: "Uploads an image to Google Drive — by default the client's folder under Studio/<project>/ — and records the Drive link in its history. Saving the same image twice returns the first upload. Usually for approved images.",
    input: { id: z.string(), output: z.number().int().min(0).optional(), folder: z.string().optional().describe('A Drive folder link or id, instead of the client folder'), name: z.string().optional() },
    run: async ({ id, output = 0, folder, name }) => {
      const { saveToDrive } = await import('./google/studio-drive.mjs');
      return saveToDrive({ id, output, folder, name });
    },
  },

  deck_import: {
    title: 'Import a Google Slides deck',
    description: "Imports or re-syncs a Google Slides deck into the client's decks/ folder: slide text, speaker notes and every comment thread with its resolved state (plus slide thumbnails if asked). Safe to repeat; reports new and newly resolved comments.",
    input: { client: z.string(), deck: z.string().optional().describe('Slides link or id. Leave out to re-sync every deck linked to the client.'), thumbnails: z.boolean().optional() },
    run: async ({ client, deck, thumbnails }) => {
      const { importDeck, linkedDecks } = await import('./google/slides.mjs');
      const slug = resolveClient(client);
      const list = deck ? [deck] : linkedDecks(slug);
      if (!list.length) throw new Error(`${slug} has no linked decks yet. Pass a Slides link.`);
      const results = [];
      for (const d of list) results.push(await importDeck(slug, d, { thumbnails }));
      const r = deck ? results[0] : { decks: results };
      const { refresh } = await import('./index.mjs');
      refresh();
      return r;
    },
  },

  sheet_read: {
    title: 'Read a Google Sheet',
    description: 'Reads a Google Sheet (shot list, deliverables tracker, batch of prompts) as rows keyed by the header row. Each row has _row, its sheet row number, for writing results back.',
    input: { sheet: z.string().describe('Sheets link or id'), range: z.string().optional().describe('e.g. "Shots!A1:H200"; default: the first sheet'), limit: z.number().int().min(1).max(5000).optional() },
    run: async ({ sheet, range, limit }) => {
      const { readSheet } = await import('./google/sheets.mjs');
      return readSheet(sheet, { range, limit });
    },
  },

  sheet_write: {
    title: 'Write to a Google Sheet',
    description: 'Writes values into a Google Sheet range, e.g. a status and a Drive link next to each shot. Only write where the person asked for results to go.',
    input: { sheet: z.string(), range: z.string().describe('e.g. "Shots!G2:H2"'), values: z.array(z.array(z.union([z.string(), z.number(), z.boolean()]))) },
    run: async ({ sheet, range, values }) => {
      const { writeSheet } = await import('./google/sheets.mjs');
      return writeSheet(sheet, { range, values });
    },
  },

  media_run: {
    title: 'Media tools',
    description: 'Runs a local media tool (Python, optional): cutout, palette, ocr, image_info, video_probe… Call with tool "list" to see what is installed.',
    input: { tool: z.string(), args: z.record(z.string(), z.any()).optional() },
    run: async ({ tool, args = {} }) => {
      const { runMedia, listMedia } = await import('./py.mjs');
      return tool === 'list' ? listMedia() : runMedia(tool, args);
    },
  },
};

/** Validates input with the op's schema, then runs it. */
export async function runOp(name, args = {}) {
  const op = OPS[name];
  if (!op) throw new Error(`Unknown operation "${name}". Known: ${Object.keys(OPS).join(', ')}.`);
  const parsed = z.object(op.input).safeParse(args);
  if (!parsed.success) throw new Error(`Bad input for ${name}: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`);
  return op.run(parsed.data);
}

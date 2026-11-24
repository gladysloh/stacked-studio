import { z } from 'zod';
import { compare, INPUT_ROLES, makeImage } from './generate.mjs';
import { clientContext, search } from './index.mjs';
import { listProviders } from './providers/index.mjs';
import { addReview, history, listGenerations, REVIEW_ACTIONS, requireGeneration, withReview } from './records.mjs';
import { catalog, readSkill } from './skills.mjs';
import { spendSummary } from './spend.mjs';
import { ensureProject, listClients, listProjects, resolveClient } from './workspace.mjs';

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
  use_look: z.boolean().optional().describe('false to leave out the project colour palette (looks/) for this image'),
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
    outputs: r.outputs.map((o, i) => ({ output: i, file: o.file, width: o.width, height: o.height, status: o.status, drive_id: o.drive_id, ...(o.check ? { check: { verdict: o.check.verdict, overall: o.check.overall ?? null, summary: o.check.summary ?? null } } : {}) })),
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
    input: { client: z.string(), query: z.string().optional().describe('What you are about to make, e.g. "D01 honey jar product shot, warm light"'), project: z.string().optional(), k: z.number().int().min(1).max(40).optional() },
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
      deliverable: z.string().optional().describe('Deliverable code, e.g. D01'),
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
    input: { id: z.string(), output: z.number().int().min(0).optional(), action: z.enum(REVIEW_ACTIONS.filter((a) => !['pick', 'compare', 'save', 'check'].includes(a))), value: z.number().optional(), note: z.string().optional() },
    run: async ({ id, output = 0, action, value, note }) => {
      requireGeneration(id);
      addReview({ target: id, output, action, value: value ?? null, note: note ?? null });
      let drive = null;
      if (action === 'approve' || action === 'reject') {
        // A version already saved to Drive moves to 03_Final or 02_Rejected. Never blocks the review.
        try {
          const { placeSaved } = await import('./google/studio-drive.mjs');
          drive = await placeSaved(id, output);
        } catch (err) {
          drive = { moved: false, error: err.message };
        }
      }
      return { ...summarize(requireGeneration(id)), ...(drive ? { drive } : {}) };
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

  drive_project_folders: {
    title: 'Make project folders on Drive',
    description: "Creates (or finds) a project's numbered folders in the client's Drive folder: <project name>/01_Generated (needs review), 02_Rejected, 03_Final (approved), 04_Review Decks, each with one subfolder per asset code. Safe to run again.",
    input: { client: z.string(), project: z.string() },
    run: async ({ client, project }) => {
      const { ensureProjectFolders } = await import('./google/studio-drive.mjs');
      return ensureProjectFolders(resolveClient(client), ensureProject(resolveClient(client), project, { create: false }));
    },
  },

  drive_push_versions: {
    title: 'Put every version on Drive',
    description: "Uploads every version of a project that isn't on Drive yet into <project>/01_Generated/<CODE>/ (or 02_Rejected / 03_Final by status), and moves saved ones whose status changed. Safe to run again.",
    input: { client: z.string(), project: z.string() },
    run: async ({ client, project }) => {
      const c = resolveClient(client);
      const { pushProjectVersions } = await import('./google/studio-drive.mjs');
      return pushProjectVersions(c, ensureProject(c, project, { create: false }));
    },
  },

  review_deck: {
    title: 'Update the review deck',
    description: "Builds the project's review deck (cover, overview, then one slide per asset: the current working-deck visual and every version in order, each with what changed, date, model and status, next to the creative idea and open comments) and keeps it up to date in a Google Slides file in the project's 04_Review Decks folder, keeping its link. Pass `deck` (a Slides link) the first time; later runs reuse it. Updates in place: only sections (cover, overview, each asset) whose content changed are redrawn, on the same slides, so comments and anything added by hand stay. `rebuild: true` replaces the whole file instead (loses comments).",
    input: {
      client: z.string(),
      project: z.string(),
      deck: z.string().optional().describe('Google Slides link, the first time'),
      only: z.array(z.string()).optional().describe('Only these asset codes'),
      cover: z.string().optional().describe('Image sha for a full-bleed cover (kept for later runs)'),
      rebuild: z.boolean().optional().describe('Replace the whole file instead of updating in place (comments on slides are lost)'),
    },
    run: async ({ client, project, deck, only, cover, rebuild }) => {
      const c = resolveClient(client);
      const { publishReviewDeck } = await import('./review-deck.mjs');
      return publishReviewDeck(c, ensureProject(c, project, { create: false }), { deck, only, cover, rebuild });
    },
  },

  prune_rejected: {
    title: 'Free disk space from rejected images',
    description: "Deletes this computer's copies of a project's REJECTED versions, keeping them on Drive (02_Rejected). Uploads any rejected version not on Drive first; deletes only when Drive has a live file with the same checksum, and never an image a kept version, deliverable or product still uses. History and Drive links stay. dry_run shows what would go.",
    input: { client: z.string(), project: z.string(), dry_run: z.boolean().optional() },
    run: async ({ client, project, dry_run }) => {
      const c = resolveClient(client);
      const { pruneRejected } = await import('./prune.mjs');
      return pruneRejected(c, ensureProject(c, project, { create: false }), { dryRun: Boolean(dry_run) });
    },
  },

  review_notes: {
    title: 'Changes requested',
    description: "An asset's \"changes requested\" list (deliverable.yaml review_notes), shown on the review deck and used for the next prompts. action list (default), add (change, from), done / undone (index, marks a change as handled), remove (index).",
    input: {
      client: z.string(),
      project: z.string(),
      deliverable: z.string(),
      action: z.enum(['list', 'add', 'done', 'undone', 'remove']).optional(),
      change: z.string().optional(),
      from: z.string().optional().describe('Who asked for it'),
      index: z.number().int().min(0).optional(),
    },
    run: async ({ client, project, deliverable, action = 'list', change, from, index }) => {
      const c = resolveClient(client);
      const p = ensureProject(c, project, { create: false });
      const { listNotes, editNotes } = await import('./review-notes.mjs');
      return { client: c, project: p, deliverable, notes: action === 'list' ? listNotes(c, p, deliverable) : editNotes(c, p, deliverable, { action, change, from, index }) };
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

  deck_import_file: {
    title: 'Import deck images (.pptx)',
    description:
      'Reads a deck downloaded from Google Slides as PowerPoint and files its images: each asset slide (code like ABC006) → that deliverable (earlier versions, lighting, references, plus its creative idea, description, lighting and palette in the brief), a section\'s mood and overview slides → every deliverable in that section, other images → library/references. Deliverables found in the deck but missing are created. Safe to repeat with a newer download.',
    input: { client: z.string(), file: z.string().describe('Path to the .pptx'), project: z.string().optional(), force: z.boolean().optional().describe('Import even if the file name doesn\'t match the working deck') },
    run: async ({ client, file, project, force }) => {
      const slug = resolveClient(client);
      const { importPptx } = await import('./pptx.mjs');
      const r = importPptx(slug, file, { project, force });
      const { organiseClient } = await import('./organise.mjs');
      r.readable_files = organiseClient(slug).files;
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

  product_list: {
    title: 'Products',
    description: "A client's products: exact name, label text and the photos/cutouts to pass as `product` inputs (by sha). Use before any product shot.",
    input: { client: z.string() },
    run: async ({ client }) => {
      const { listProducts } = await import('./products.mjs');
      return { products: listProducts(resolveClient(client)) };
    },
  },

  product_add: {
    title: 'Add a product',
    description: 'Adds a product (or another photo of one) to the client library with its exact label text. With cutout: true and the media tools installed, also stores a background-free cutout.',
    input: {
      client: z.string(),
      name: z.string(),
      label_text: z.string().optional().describe('The label exactly as printed, lines separated by " / "'),
      shape: z.string().optional().describe('What the pack looks like, for prompts: form, cap, finish, colours, windows (e.g. "slim tall gold cylinder, flat gold cap, clear band at the base showing beige powder")'),
      size: z.string().optional().describe('Real size, always added to prompts (e.g. "compact 60 g travel can, about the length of a hand")'),
      notes: z.string().optional().describe('Known quirks, e.g. "small print always garbles: keep label front-facing"'),
      image: z.object({ path: z.string().optional(), sha: z.string().optional(), name: z.string().optional().describe('What the photo shows, e.g. "60ml front"'), drive_id: z.string().optional() }).optional(),
      style: z.enum(['packshot', 'group', 'angles', 'lifestyle']).optional(),
      cutout: z.boolean().optional(),
    },
    run: async ({ client, ...a }) => {
      const { addProduct } = await import('./products.mjs');
      return addProduct(resolveClient(client), a);
    },
  },

  qa_basics: {
    title: 'Measured checks',
    description: "Checks without AI: the image's format and resolution against what was asked, and (with the media tools) how much of it sits near the brand palette in brand.md. Run before a creative review.",
    input: { id: z.string(), output: z.number().int().min(0).optional(), aspect: z.string().optional(), min_px: z.number().int().optional() },
    run: async (a) => {
      const { basics } = await import('./qa.mjs');
      return basics(a);
    },
  },

  qa_record: {
    title: 'Save a creative check',
    description:
      'Saves a creative-qa review of an image (scores 1–5 per area, labels read letter by letter, up to 3 paste-ready fixes). The verdict and overall score are computed from the scores by the fixed rule. Shows on the image in the Workbench. Never approves or rejects.',
    input: {
      id: z.string(),
      output: z.number().int().min(0).optional(),
      scores: z.record(z.string(), z.object({ score: z.number().int().min(1).max(5).nullable(), note: z.string(), severity: z.enum(['none', 'minor', 'major', 'critical']).optional() })),
      labels: z.array(z.object({ product: z.string(), expected: z.string().optional(), read: z.string(), ok: z.boolean().nullable() })).optional(),
      suggestions: z.array(z.string()).max(3).optional(),
      summary: z.string().optional(),
      aesthetic: z.enum(['poor', 'competent', 'strong', 'exceptional']).optional(),
    },
    run: async (a) => {
      const { recordCheck } = await import('./qa.mjs');
      return recordCheck(a);
    },
  },

  moodboard_save: {
    title: 'Save a moodboard',
    description:
      'Creates or extends a moodboard in research/<board>/board.yaml: each reference with its link, image, what to take from it, and the shot-library ids it shows. Image links are downloaded into the cache so they can be used as inputs (by sha). Returns `untagged` images: open each and tag it with reference_tag so the shot library learns from it. Leave out client to save without one. Research stays unverified context.',
    input: {
      client: z.string().optional(),
      name: z.string(),
      for: z.string().optional().describe('What the board is for, e.g. "D01 concept routes"'),
      notes: z.string().optional().describe('What the set says, in 2–3 lines'),
      items: z.array(z.object({ title: z.string().optional(), url: z.string().optional(), image_url: z.string().optional(), fallback_url: z.string().optional(), sha: z.string().optional(), take: z.string().optional().describe('What to borrow'), subject: z.string().optional().describe('product, model, product_with_model, texture…'), shots: z.array(z.string()).optional().describe('Shot-library ids it shows, e.g. angle.low-hero, placement.podium'), tags: z.array(z.string()).optional(), source: z.string().optional() })).max(100),
    },
    run: async ({ client, ...a }) => {
      const { saveMoodboard } = await import('./research.mjs');
      const r = await saveMoodboard({ client: client ? resolveClient(client) : undefined, ...a });
      const { refresh } = await import('./index.mjs');
      refresh();
      return r;
    },
  },

  pinterest_board: {
    title: 'Read a Pinterest board',
    description: "Reads a public Pinterest board's recent pins (title, link, image, note) through its RSS feed — no login. With save_as, saves them straight into a moodboard; otherwise returns them so you can pick and annotate before moodboard_save.",
    input: { link: z.string().describe('https://www.pinterest.com/<user>/<board>/'), client: z.string().optional(), save_as: z.string().optional().describe('Moodboard name to save into') },
    run: async ({ link, client, save_as }) => {
      const { pinterestBoard, saveMoodboard } = await import('./research.mjs');
      const b = await pinterestBoard(link);
      if (!save_as) return b;
      const r = await saveMoodboard({ client: client ? resolveClient(client) : undefined, name: save_as, for: b.board ? `Pinterest: ${b.board}` : undefined, items: b.pins.map((p) => ({ title: p.title, url: p.url, image_url: p.image_url, fallback_url: p.fallback_url, take: p.note, tags: ['pinterest'], source: 'pinterest' })) });
      const { refresh } = await import('./index.mjs');
      refresh();
      return { ...r, pinterest_board: b.board };
    },
  },

  shot_library: {
    title: 'Shot library',
    description:
      'The shared vocabulary of angles, placements and layouts, model poses, hands, lighting, surfaces, motion and framing. Each entry has prompt wording that image models follow, when to use it, pitfalls and search terms. With an id: that entry plus the team\'s own tagged example images (use them as inputs). With a query/category/subject: matching entries. Use it to name shots precisely in prompts and plans.',
    input: { id: z.string().optional().describe('e.g. placement.podium'), query: z.string().optional().describe('e.g. "floating dynamic"'), category: z.enum(['angle', 'placement', 'pose', 'hands', 'lighting', 'surface', 'motion', 'framing']).optional(), subject: z.string().optional().describe('product, model, product_with_model, hands, texture, food_beverage, fashion, device, interior'), limit: z.number().int().min(1).max(100).optional() },
    run: async ({ id, query, category, subject, limit }) => {
      const lib = await import('./library.mjs');
      if (id) return lib.getShot(id);
      const list = lib.findShots({ query, category, subject, limit });
      return { categories: lib.loadLibrary().categories, subjects: lib.subjects().map((s) => ({ id: s.id, name: s.name })), entries: list.map(({ id: i, name, category: c, prompt, use_when, watch_out }) => ({ id: i, name, category: c, prompt, use_when, watch_out })) };
    },
  },

  research_plan: {
    title: 'Plan reference research',
    description:
      'Turns what you are shooting into targeted searches: per subject type (product → packshots, dynamic layouts, angles, groupings; model → poses, hands, application; texture → smears, drops…) and per shot category, with ready links for Pinterest, Google Images and Behance, plus competitor searches from client.yaml. Says whether image_search is available. Run the searches, then moodboard_save the best images tagged with shot ids.',
    input: {
      subject: z.string().default('product').describe('product, product_with_model, model, hands, texture, food_beverage, fashion, device, interior'),
      subject_name: z.string().optional().describe('What exactly, e.g. "amber glass serum bottle"'),
      category: z.string().optional().describe('e.g. "skincare"'),
      shots: z.array(z.string()).optional().describe('Specific shot ids to research; default: the most relevant per category'),
      per_category: z.number().int().min(1).max(10).optional(),
      client: z.string().optional(),
      competitors: z.array(z.string()).optional(),
      sources: z.array(z.enum(['pinterest', 'google_images', 'behance'])).optional(),
    },
    run: async ({ client, ...a }) => {
      const { planResearch } = await import('./research-plan.mjs');
      return planResearch({ ...a, client: client ? resolveClient(client) : undefined });
    },
  },

  image_search: {
    title: 'Image search',
    description: 'Searches the web for reference images (direct image links) with the team\'s image-search key (Brave or SerpAPI). Without a key it says so: then use your own web/browser tools on research_plan\'s queries. Results are not saved: pick the good ones and moodboard_save them.',
    input: { query: z.string().min(2), count: z.number().int().min(1).max(50).optional(), provider: z.enum(['brave', 'serpapi']).optional() },
    run: async (a) => {
      const { imageSearch } = await import('./providers/search.mjs');
      return imageSearch(a);
    },
  },

  reference_tag: {
    title: 'Tag references',
    description:
      'Tags saved references with the shot-library ids they show (angle, placement, pose, lighting…), plus optional subject and what to take. Use right after moodboard_save on its `untagged` images (open each first), or on the client\'s references / past work. Tagged images become examples in shot_library.',
    input: {
      client: z.string().optional(),
      board: z.string().optional().describe('Moodboard name; leave out to tag the client references (or past work with where)'),
      project: z.string().optional().describe('Tag images inside this project\'s deliverables instead (match by sha)'),
      where: z.enum(['references', 'past-work']).optional(),
      tags: z.array(z.object({ index: z.number().int().min(0).optional(), sha: z.string().optional(), url: z.string().optional(), shots: z.array(z.string()), subject: z.string().optional(), take: z.string().optional(), replace: z.boolean().optional() })).min(1).max(200),
    },
    run: async ({ client, project, ...a }) => {
      if (project) {
        const { tagDeliverableImages } = await import('./research.mjs');
        return tagDeliverableImages({ client: resolveClient(client), project, tags: a.tags });
      }
      const { tagReferences } = await import('./research.mjs');
      const r = tagReferences({ client: client ? resolveClient(client) : undefined, ...a });
      const { refresh } = await import('./index.mjs');
      refresh();
      return r;
    },
  },

  adapt_plan: {
    title: 'Plan format adaptations',
    description:
      'For a key visual and a list of sizes (names like INSTAGRAM_STORY, LEADERBOARD, PAID_SOCIAL_4_5, or WIDTHxHEIGHT), returns per size: exact pixels, the safe box for product/logo/copy, the layout archetype, and the action — resize, crop (with the crop box), recompose (with the model aspect and a prompt hint for image_edit), or lay out in Figma for extreme banners.',
    input: { id: z.string().optional().describe('The source image (approved KV)'), output: z.number().int().min(0).optional(), formats: z.array(z.union([z.string(), z.object({ name: z.string().optional(), w: z.number().int(), h: z.number().int() })])).min(1).max(40) },
    run: async (a) => {
      const { planAdapts } = await import('./adapt.mjs');
      return planAdapts(a);
    },
  },

  client_sync: {
    title: 'Sync a client with the team Drive',
    description: "Two-way sync of a client folder with the team's Shared Drive (one shared copy per client): pulls and merges teammates' changes, then pushes the result. Files changed on both sides are flagged, not overwritten.",
    input: { client: z.string() },
    run: async ({ client }) => {
      const { syncClient } = await import('./google/studio-drive.mjs');
      const r = await syncClient(resolveClient(client));
      const { refresh } = await import('./index.mjs');
      refresh();
      return r;
    },
  },

  inbox_list: {
    title: 'Inbox',
    description: "Images waiting in a client's inbox (clients/<client>/inbox/) to be filed: name, local file (open it to look), size and the uploader's note.",
    input: { client: z.string().optional() },
    run: async ({ client }) => {
      const { listInbox } = await import('./inbox.mjs');
      const c = client ? resolveClient(client) : '_scratch';
      return { client: c, items: listInbox(c).map(({ cache_file, ...x }) => x) };
    },
  },

  inbox_file: {
    title: 'File inbox images',
    description:
      'Files inbox images where they belong: as a product photo (product name, exact label text), a reference or logo, past work, a moodboard image, or a deliverable reference (project + code) — with shot-library tags, subject and what to take. Or discard. Then the readable folders are refreshed. Look at each image before filing it.',
    input: {
      client: z.string().optional(),
      items: z.array(z.object({
        name: z.string().optional(), sha: z.string().optional(),
        as: z.enum(['product', 'reference', 'logo', 'past_work', 'board', 'deliverable', 'discard']),
        product: z.string().optional(), label_text: z.string().optional(), style: z.enum(['packshot', 'group', 'angles', 'lifestyle']).optional(),
        board: z.string().optional(), project: z.string().optional(), deliverable: z.string().optional(), role: z.string().optional(),
        title: z.string().optional(), take: z.string().optional(), subject: z.string().optional(), shots: z.array(z.string()).optional(),
      })).min(1).max(200),
    },
    run: async ({ client, items }) => {
      const { fileInbox } = await import('./inbox.mjs');
      return fileInbox(client ? resolveClient(client) : '_scratch', items);
    },
  },

  organise_folders: {
    title: 'Refresh readable folders',
    description: "Rebuilds a client's readable folders (brand/logos, products/<p>/photos|cutouts, library/references|past-work|moodboards, projects/<p>/<CODE-name>/references|versions|final) from the records, with clear file names. Files people added themselves are never touched.",
    input: { client: z.string() },
    run: async ({ client }) => {
      const { organiseClient } = await import('./organise.mjs');
      const r = organiseClient(resolveClient(client));
      return { ...r, skipped_existing: r.skipped_existing.slice(0, 20) };
    },
  },

  drive_push: {
    title: 'Upload folders to Drive',
    description: "Uploads the client's readable folders to its Drive folder with the same names and layout — only when the person asks. Parts: brand (logos), products, library (references, past work, moodboards), final (approved images), versions (every made image), references (deck inspiration per deliverable). Already-uploaded files are skipped.",
    input: { client: z.string(), parts: z.array(z.enum(['brand', 'products', 'library', 'final', 'versions', 'references'])).optional(), dry_run: z.boolean().optional() },
    run: async ({ client, parts, dry_run }) => {
      const { pushToDrive } = await import('./google/studio-drive.mjs');
      return pushToDrive(resolveClient(client), { parts, dryRun: dry_run });
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

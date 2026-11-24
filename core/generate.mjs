import fs from 'node:fs';
import path from 'node:path';
import { author, settings } from './config.mjs';
import { StudioError } from './errors.mjs';
import { sha256 } from './fsutil.mjs';
import { newId } from './ids.mjs';
import { importFile, isImage, putMedia, readMedia } from './media.mjs';
import { pickProvider } from './providers/index.mjs';
import { addReview, findByRequestId, requireGeneration, withReview, writeGeneration } from './records.mjs';
import { skillVersions } from './skills.mjs';
import { checkBudget, recordSpend } from './spend.mjs';
import { SCRATCH, ensureProject, layout, resolveClient } from './workspace.mjs';

// The one path that makes images. Every call — new image, edit, variation, upscale — checks the daily
// limit, renders, stores the files by hash and writes one record with its inputs and lineage. Failed
// attempts are recorded too, so history is never missing a step.

export const INPUT_ROLES = ['source', 'product', 'reference', 'style', 'person', 'layout'];

/**
 * Inputs can be given three ways, mixed freely:
 *   { path: 'file.png' }            a local file
 *   { sha: '<sha256>' }             something already in the media cache
 *   { generation: '<id>', output }  an earlier image
 */
export function loadInputs(inputs = []) {
  return inputs.map((r, i) => {
    let m;
    if (r.path) m = importFile(r.path);
    else if (r.sha) {
      m = readMedia(r.sha);
      if (!m) throw new StudioError(`Image ${r.sha.slice(0, 12)}… isn't in the local cache.`, 'Fetch it first with drive_fetch, or pass a file path.');
    } else if (r.generation) {
      const g = requireGeneration(r.generation);
      const out = g.outputs?.[r.output ?? 0];
      if (!out) throw new StudioError(`Record ${r.generation} has no output ${r.output ?? 0}.`);
      m = readMedia(out.sha);
      if (!m) throw new StudioError(`The file for ${r.generation} isn't in the local cache.`, 'Fetch it with drive_fetch.');
    } else throw new StudioError(`Input ${i + 1} needs a path, sha or generation.`);
    const media = m.data ? m : readMedia(m.sha);
    if (!isImage(media.mime)) throw new StudioError(`Input ${i + 1} isn't an image.`);
    const role = r.role ?? 'reference';
    if (!INPUT_ROLES.includes(role)) throw new StudioError(`Unknown input role "${role}". Use one of: ${INPUT_ROLES.join(', ')}.`);
    return { sha: media.sha, mime: media.mime, data: media.data, role, note: r.note ?? null, name: r.name ?? m.name ?? null, from: r.generation ? { generation: r.generation, output: r.output ?? 0 } : undefined };
  });
}

/** The brand file version in use, so a record says which brand rules shaped it. */
function autoContext(client) {
  if (client === SCRATCH) return [];
  const brand = layout.brand(client);
  return fs.existsSync(brand) ? [{ kind: 'brand', ref: 'brand/brand.md', version: sha256(fs.readFileSync(brand)).slice(0, 12) }] : [];
}

/**
 * Makes images and records them.
 * mode: 'new' (default), 'edit' (next version of `parent`), 'branch' (new direction from `parent`),
 *       'upscale' (same image, more pixels).
 */
export async function makeImage(input) {
  const {
    mode = 'new',
    prompt,
    instruction = null,
    what_changed = null,
    parent = null,
    parent_output = 0,
    inputs = [],
    n = 1,
    provider: wantProvider,
    model,
    size,
    aspect,
    allow_text = false,
    request_id = null,
    deliverable = null,
    concept = null,
    context_used = [],
    run_id = process.env.STACKED_RUN_ID ?? null,
  } = input;

  if (!['new', 'edit', 'branch', 'upscale'].includes(mode)) throw new StudioError(`Unknown mode "${mode}".`);
  if (mode !== 'new' && !parent) throw new StudioError(`To ${mode === 'branch' ? 'start a new direction' : mode}, say which image (parent).`);
  if (mode !== 'upscale' && !prompt?.trim()) throw new StudioError('A prompt is needed.');

  const prev = parent ? requireGeneration(parent) : null;
  const client = prev ? prev.client : resolveClient(input.client);
  const project = prev ? prev.project : ensureProject(client, input.project);

  const repeated = findByRequestId(client, project, request_id);
  if (repeated) return { ...withReview(repeated), repeated: true };

  const s = settings();
  const kind = mode === 'upscale' ? 'upscale' : 'image';
  // Edits stay with the provider that made the parent when it's still usable, so the look holds.
  let inherit;
  if (!wantProvider && prev && kind === 'image') {
    try {
      pickProvider(kind, prev.provider);
      inherit = prev.provider;
    } catch {}
  }
  const { provider, key, fingerprint } = pickProvider(kind, wantProvider ?? inherit);
  const useModel = kind === 'image' ? model || s.image_model || provider.DEFAULT_MODEL : model ?? null;
  const resolvedModel = provider.MODELS?.[useModel] ? useModel : provider.DEFAULT_MODEL;
  const useSize = size || s.size;
  const useAspect = aspect || prev?.params?.aspect || s.aspect;

  // Edits and upscales start from the parent image: it's always the first input.
  let all = [...inputs];
  if (mode === 'edit' || mode === 'upscale' || (mode === 'branch' && input.keep_source !== false)) {
    all = [{ generation: prev.id, output: parent_output, role: 'source' }, ...inputs.filter((i) => i.role !== 'source')];
  }
  const loaded = loadInputs(all);

  const estimate = kind === 'upscale' ? (provider.UPSCALERS ? 0.03 : provider.id === 'gemini' ? 0.24 : 0) : provider.estimate({ model: resolvedModel, size: useSize, n });
  checkBudget(estimate);

  const id = newId('g');
  const now = new Date().toISOString();
  const lineage = {
    parent: mode === 'edit' || mode === 'upscale' ? prev.id : null,
    parent_output: mode === 'edit' || mode === 'upscale' ? parent_output : null,
    branch_of: mode === 'branch' ? { id: prev.id, output: parent_output } : null,
    root: mode === 'edit' || mode === 'upscale' ? prev.root : id,
    version: mode === 'edit' || mode === 'upscale' ? (prev.version ?? 1) + 1 : 1,
  };
  const base = {
    id,
    kind: mode === 'new' ? 'image' : mode,
    status: 'done',
    client,
    project,
    deliverable: deliverable ?? prev?.deliverable ?? null,
    concept: concept ?? (mode === 'edit' ? prev?.concept ?? null : null),
    ...lineage,
    instruction,
    what_changed,
    prompt: mode === 'upscale' ? prompt ?? null : prompt,
    inputs: loaded.map(({ sha, mime, role, note, name, from }) => ({ sha, mime, role, note, name, ...(from ? { from } : {}) })),
    provider: provider.id,
    model: kind === 'image' ? resolvedModel : model ?? null,
    params: { n: kind === 'upscale' ? 1 : n, size: useSize, aspect: useAspect, allow_text },
    context_used: [...autoContext(client), ...context_used],
    skills: skillVersions(),
    author: author(),
    created: now,
    request_id,
    run_id,
    is_test: provider.id === 'test',
  };

  const refs = loaded.map((l) => ({ data: l.data, mime: l.mime, role: l.role }));
  let result;
  try {
    if (kind === 'upscale') result = await provider.upscale({ key, source: refs[0], aspect: useAspect });
    else result = await provider.image({ key, prompt, n, model: resolvedModel, size: useSize, aspect: useAspect, references: refs, noText: !allow_text });
  } catch (err) {
    writeGeneration({ ...base, status: 'failed', error: err.message, outputs: [], cost_usd: 0 });
    throw new StudioError(err.message);
  }

  const outputs = result.images.map((img) => {
    const m = putMedia(img.data, img.mime);
    return { sha: m.sha, mime: m.mime, bytes: m.bytes, width: m.width ?? null, height: m.height ?? null };
  });
  const rec = { ...base, outputs, cost_usd: result.cost_usd, ...(result.failures?.length ? { error: result.failures.join('; ') } : {}) };
  writeGeneration(rec);
  recordSpend({ provider: provider.id, model: rec.model, cost_usd: rec.cost_usd, fingerprint, record_id: id });
  return withReview(rec);
}

/** Records a side-by-side comparison, and (optionally) which one was picked. */
export function compare({ items, pick = null, note = null, record = true }) {
  if (!Array.isArray(items) || items.length < 2) throw new StudioError('Compare needs at least two images.');
  const targets = items.map((i) => (typeof i === 'string' ? { id: i, output: 0 } : { id: i.id, output: i.output ?? 0 }));
  const records = targets.map((t) => withReview(requireGeneration(t.id)));
  const entry = record ? addReview({ target: targets.map((t) => t.id), action: 'compare', value: { items: targets, pick }, note }) : null;
  if (pick && record) addReview({ target: pick.id ?? pick, output: pick.output ?? 0, action: 'pick', note });
  return {
    compared: entry?.id ?? null,
    items: targets.map((t, i) => {
      const r = records[i];
      const o = r.outputs[t.output];
      return { id: t.id, output: t.output, version: r.version, prompt: r.prompt, model: r.model, inputs: r.inputs.map((x) => x.role), file: o?.file ?? null, status: o?.status ?? null };
    }),
    prompt_diff: targets.length === 2 ? wordDiff(records[0].prompt ?? '', records[1].prompt ?? '') : null,
  };
}

/** A word-level diff: [{op: '=', '-', '+', text}]. Small LCS; prompts are short. */
export function wordDiff(a, b) {
  const x = a.split(/(\s+)/);
  const y = b.split(/(\s+)/);
  const dp = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  const push = (op, text) => (out.at(-1)?.op === op ? (out.at(-1).text += text) : out.push({ op, text }));
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      push('=', x[i++]);
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push('-', x[i++]);
    else push('+', y[j++]);
  }
  while (i < x.length) push('-', x[i++]);
  while (j < y.length) push('+', y[j++]);
  return out;
}

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { StudioError } from './errors.mjs';
import { sha256, slugify, writeFileAtomic, writeYamlAtomic } from './fsutil.mjs';
import { EXT, putMedia } from './media.mjs';
import { paths, which } from './paths.mjs';
import { clientDir, createClient } from './workspace.mjs';

// One-time move from New Gen Studio (studio-app's ~/.studio data folder) into client folders.
// The source is never written to: the database is copied with `sqlite3 .backup` (which folds in the
// WAL, where the newest writes live) and read from that copy. Every table is accounted for in
// migration-report.md: rows read vs. records written.

const J = (s, d = null) => {
  try {
    return s ? JSON.parse(s) : d;
  } catch {
    return d;
  }
};
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)));

function snapshot(dbFile) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stacked-migrate-'));
  const copy = path.join(dir, 'studio.db');
  if (which('sqlite3')) {
    const r = spawnSync('sqlite3', ['-readonly', dbFile, `.backup '${copy.replace(/'/g, "''")}'`], { encoding: 'utf8' });
    if (r.status !== 0) throw new StudioError(`Couldn't copy the database: ${r.stderr.trim()}`);
  } else {
    // Without the sqlite3 command: copy the files together; opening the copy replays the WAL.
    for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(dbFile + ext)) fs.copyFileSync(dbFile + ext, copy + ext);
  }
  return { copy, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const has = (db, table) => Boolean(db.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(table));
const all = (db, table, sql = `select * from ${table}`) => (has(db, table) ? db.prepare(sql).all() : []);

export async function migrateStudioData(from, { dryRun = false } = {}) {
  if (!from) throw new StudioError('Where is the studio-data folder?', 'studio migrate studio-data ~/.studio');
  const root = path.resolve(from.replace(/^~/, os.homedir()));
  const dbFile = [path.join(root, 'system', 'studio.db'), path.join(root, 'studio.db')].find((f) => fs.existsSync(f));
  if (!dbFile) throw new StudioError(`No studio.db under ${root}.`);
  const blobs = [path.join(root, 'system', 'blobs'), path.join(root, 'blobs')].find((d) => fs.existsSync(d));

  const snap = snapshot(dbFile);
  const db = new DatabaseSync(snap.copy, { readOnly: true });
  const counts = {};
  const wrote = {};
  const notes = [];
  const bump = (k, n = 1) => (wrote[k] = (wrote[k] ?? 0) + n);

  try {
    const T = (t) => {
      const rows = all(db, t);
      counts[t] = rows.length;
      return rows;
    };
    const clients = T('client');
    const kItems = T('knowledge_item');
    const kVersions = T('knowledge_version');
    const assets = T('asset');
    const cAssets = T('client_asset');
    const decks = T('deck');
    const slides = T('deck_slide');
    const comments = T('deck_comment');
    const revisions = T('deck_revision');
    const projects = T('project');
    const deliverables = T('deliverable');
    const messaging = T('deliverable_messaging');
    const dSlides = T('deliverable_slide');
    const dFiles = T('deliverable_file');
    const dLikes = T('deliverable_like');
    const concepts = T('concept');
    const gens = T('generation');
    const gIn = T('generation_input');
    const gOut = T('generation_output');
    const gCtx = T('generation_context');
    const feedback = T('feedback');
    const checks = T('image_check');
    const runs = T('agent_run');
    const layouts = T('compose_layout');

    const existing = clients.map((c) => slugify(c.name)).filter((s) => fs.existsSync(path.join(clientDir(s), 'client.yaml')));
    if (existing.length && !dryRun) throw new StudioError(`Client folders already exist: ${existing.join(', ')}. Nothing was changed.`, 'Move them aside first, or run with --dry-run to preview.');

    const assetBy = new Map(assets.map((a) => [a.hash, a]));
    const clientSlug = new Map(clients.map((c) => [c.id, slugify(c.name)]));
    const projectOf = new Map(projects.map((p) => [p.id, p]));
    const projectSlug = new Map(projects.map((p) => [p.id, slugify(p.name)]));
    const deliverableOf = new Map(deliverables.map((d) => [d.id, d]));
    const conceptOf = new Map(concepts.map((c) => [c.id, c]));
    const deckSlug = new Map();
    const media = (hash) => (hash ? { sha: hash, mime: assetBy.get(hash)?.mime ?? null, width: assetBy.get(hash)?.width ?? null, height: assetBy.get(hash)?.height ?? null } : null);
    const used = new Set();
    const use = (h) => (h && used.add(h), h);

    const write = (file, value) => (dryRun ? null : writeYamlAtomic(file, value));
    const writeText = (file, text) => (dryRun ? null : writeFileAtomic(file, text));
    const writeJsonl = (file, rows) => (dryRun || !rows.length ? null : writeFileAtomic(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n'));

    // ---- clients ----
    for (const c of clients) {
      const slug = clientSlug.get(c.id);
      const myDecks = decks.filter((d) => d.client_id === c.id);
      if (!dryRun) createClient(c.name, clean({ industry: c.industry, description: c.description }));
      const cfg = clean({
        name: c.name,
        industry: c.industry,
        description: c.description,
        links: clean({ website: c.website, decks: myDecks.map((d) => clean({ title: d.title, url: d.source_url, slides_id: d.source_id })) }),
        archived: c.archived ? true : null,
        migrated_from: { system: 'new-gen-studio', id: c.id, at: new Date().toISOString() },
      });
      write(path.join(clientDir(slug), 'client.yaml'), cfg);
      bump('client');

      // knowledge: one file per item; latest current version is the body, all versions kept alongside.
      for (const item of kItems.filter((k) => k.client_id === c.id)) {
        const versions = kVersions.filter((v) => v.item_id === item.id).sort((a, b) => a.version - b.version);
        const current = [...versions].reverse().find((v) => v.status !== 'replaced') ?? versions.at(-1);
        const name = `${item.kind}-${slugify(item.title)}`;
        const fm = clean({ title: item.title, topic: item.kind, status: current?.status === 'approved' ? 'approved' : 'draft', source: current?.source, version: current?.version, studio_id: item.id });
        const yamlFm = Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n');
        writeText(path.join(clientDir(slug), 'knowledge', `${name}.md`), `---\n${yamlFm}\n---\n\n# ${item.title}\n\n${current?.body ?? ''}\n`);
        write(path.join(clientDir(slug), 'knowledge', 'history', `${name}.yaml`), versions.map((v) => clean({ id: v.id, version: v.version, status: v.status, body: v.body, note: v.note, source: v.source, created: v.created_at, by: v.created_by, approved: v.approved_at })));
        bump('knowledge_item');
        bump('knowledge_version', versions.length);
      }

      // brand files: products grouped by name; references, talent, logos, documents; past work.
      const mine = cAssets.filter((a) => a.client_id === c.id);
      const item = (a) => clean({ ...media(use(a.asset_hash)), name: a.name, note: a.note, style: a.style, label_text: a.label_text, source: a.source, archived: a.archived ? true : null, studio_id: a.id, created: a.created_at });
      const products = new Map();
      for (const a of mine.filter((x) => x.kind === 'product')) {
        const key = slugify(a.name ?? 'product');
        if (!products.has(key)) products.set(key, []);
        products.get(key).push(a);
      }
      for (const [key, list] of products) {
        write(path.join(clientDir(slug), 'products', key, 'product.yaml'), clean({ name: list[0].name ?? key, label_text: list.find((x) => x.label_text)?.label_text, cutouts: list.map(item) }));
        bump('client_asset', list.length);
      }
      const refs = mine.filter((x) => ['reference', 'talent', 'logo', 'document'].includes(x.kind)).map((a) => ({ kind: a.kind, ...item(a) }));
      if (refs.length) write(path.join(clientDir(slug), 'references', 'refs.yaml'), { items: refs });
      bump('client_asset', refs.length);
      const past = mine.filter((x) => x.kind === 'past_work').map(item);
      if (past.length) write(path.join(clientDir(slug), 'past-work', 'past.yaml'), { items: past });
      bump('client_asset', past.length);

      // decks: config, slides as markdown, comments as an append-only log, full text.
      for (const d of myDecks) {
        const ds = slugify(d.title.replace(/^\[[^\]]*\]\s*/, ''));
        deckSlug.set(d.id, ds);
        const dir = path.join(clientDir(slug), 'decks', ds);
        write(path.join(dir, 'deck.yaml'), clean({
          title: d.title, source: d.source, slides_id: d.source_id, url: d.source_url, modified: d.modified_at, imported: d.imported_at, synced: d.synced_at, slide_count: d.slide_count,
          file: media(use(d.file_hash)),
          revisions: revisions.filter((r) => r.deck_id === d.id).map((r) => clean({ id: r.source_id, modified: r.modified_at, author: r.author })),
          studio_id: d.id,
        }));
        const mySlides = slides.filter((s) => s.deck_id === d.id).sort((a, b) => a.idx - b.idx);
        writeText(path.join(dir, 'slides.md'), `# ${d.title}\n\n` + mySlides.map((s) => `## Slide ${s.idx + 1}${s.title ? ` — ${s.title}` : ''}\n\n${s.body ?? ''}${s.notes ? `\n\nSpeaker notes: ${s.notes}` : ''}\n`).join('\n'));
        const myComments = comments.filter((x) => x.deck_id === d.id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
        writeJsonl(path.join(dir, 'comments.jsonl'), myComments.map((x) => clean({ id: x.id, source_id: x.source_id, parent: x.parent_id, slide: x.slide, asset_code: x.asset_code, author: x.author, body: x.body, quote: x.quoted, resolved: Boolean(x.resolved), created: x.created_at, imported: x.imported_at })));
        if (d.full_text) writeText(path.join(dir, 'full-text.txt'), d.full_text);
        bump('deck');
        bump('deck_slide', mySlides.length);
        bump('deck_comment', myComments.length);
        bump('deck_revision', revisions.filter((r) => r.deck_id === d.id).length);
      }
    }

    // ---- projects, deliverables, concepts ----
    for (const p of projects) {
      const cs = clientSlug.get(p.client_id);
      const ps = projectSlug.get(p.id);
      const dir = path.join(clientDir(cs), 'projects', ps);
      write(path.join(dir, 'project.yaml'), clean({ name: p.name, status: p.archived ? 'archived' : 'active', deck: deckSlug.get(p.deck_id), created: p.created_at, updated: p.updated_at, studio_id: p.id }));
      if (p.brief) writeText(path.join(dir, 'brief.md'), `# ${p.name} — brief\n\n${p.brief}\n`);
      bump('project');
    }
    for (const d of deliverables) {
      const p = projectOf.get(d.project_id);
      const dir = path.join(clientDir(clientSlug.get(p.client_id)), 'projects', projectSlug.get(p.id), 'deliverables', d.code);
      const msgs = messaging.filter((m) => m.deliverable_id === d.id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      const sl = dSlides.filter((s) => s.deliverable_id === d.id).sort((a, b) => a.slide - b.slide);
      const files = dFiles.filter((f) => f.deliverable_id === d.id);
      const likes = dLikes.filter((l) => l.deliverable_id === d.id);
      write(path.join(dir, 'deliverable.yaml'), clean({
        code: d.code,
        status: d.status,
        created: d.created_at,
        updated: d.updated_at,
        messaging: msgs.map((m) => clean({ id: m.id, source: m.source, campaign: m.campaign, product: m.product, key_message: m.key_message, super: m.super, remarks: m.remarks, description: m.description, deck_iterations: m.deck_iterations, created: m.created_at })),
        slides: sl.map((s) => clean({ slide: s.slide, label: s.label, creative_idea: s.creative_idea, description: s.description, lighting: s.lighting, palette: J(s.palette, []) })),
        files: files.map((f) => clean({ ...media(use(f.asset_hash)), role: f.role, slide: f.slide, name: f.name })),
        liked: likes.map((l) => ({ sha: l.asset_hash, liked: Boolean(l.liked), at: l.created_at })),
        studio_id: d.id,
      }));
      const m = msgs.at(-1) ?? {};
      const s0 = sl[0] ?? {};
      const palette = sl.flatMap((s) => J(s.palette, []));
      writeText(
        path.join(dir, 'brief.md'),
        [
          `# ${d.code}`,
          m.product && `## Product\n\n${m.product}`,
          m.key_message && `## Key message\n\n${m.key_message}`,
          m.campaign && `## Campaign\n\n${m.campaign}`,
          (m.description || s0.description) && `## Description\n\n${m.description ?? s0.description}`,
          s0.creative_idea && `## Creative idea\n\n${s0.creative_idea}`,
          s0.lighting && `## Lighting\n\n${s0.lighting}`,
          palette.length && `## Colour palette\n\n${palette.map((c) => (typeof c === 'string' ? c : c.hex ?? JSON.stringify(c))).join(', ')}`,
          m.super && `## Super\n\n${m.super}`,
          m.remarks && `## Client remarks\n\n${m.remarks}`,
        ]
          .filter(Boolean)
          .join('\n\n') + '\n'
      );
      bump('deliverable');
      bump('deliverable_messaging', msgs.length);
      bump('deliverable_slide', sl.length);
      bump('deliverable_file', files.length);
      bump('deliverable_like', likes.length);
    }
    for (const c of concepts) {
      const d = deliverableOf.get(c.deliverable_id);
      const p = projectOf.get(d.project_id);
      const file = path.join(clientDir(clientSlug.get(p.client_id)), 'projects', projectSlug.get(p.id), 'concepts', `${d.code}-${slugify(c.name)}.md`);
      writeText(file, `---\nname: ${JSON.stringify(c.name)}\ndeliverable: ${d.code}\nstudio_id: ${c.id}\ncreated: ${c.created_at}${c.archived ? '\narchived: true' : ''}\n---\n\n# ${d.code} · ${c.name}\n\n${c.note ?? ''}\n`);
      bump('concept');
    }

    // ---- generations (ids kept, so version links survive) ----
    const where = (g) => {
      if (g.deliverable_id) {
        const d = deliverableOf.get(g.deliverable_id);
        const p = projectOf.get(d.project_id);
        return { client: clientSlug.get(p.client_id), project: projectSlug.get(p.id), deliverable: d.code };
      }
      if (g.client_id) return { client: clientSlug.get(g.client_id), project: 'studio-images', deliverable: null };
      return { client: '_scratch', project: 'scratch', deliverable: null };
    };
    const genWhere = new Map(gens.map((g) => [g.id, where(g)]));
    const reviewRows = new Map();
    const addReview = (gid, entry) => {
      const w = genWhere.get(gid);
      const key = `${w.client}/${w.project}`;
      if (!reviewRows.has(key)) reviewRows.set(key, []);
      reviewRows.get(key).push(entry);
    };
    for (const g of gens) {
      const w = genWhere.get(g.id);
      const params = J(g.params, {});
      const ctx = gCtx.filter((x) => x.generation_id === g.id);
      const rec = clean({
        id: g.id,
        kind: g.parent_id ? 'edit' : g.fork_of_id ? 'branch' : 'image',
        status: g.status,
        client: w.client,
        project: w.project,
        deliverable: w.deliverable,
        concept: g.concept_id ? conceptOf.get(g.concept_id)?.name : null,
        parent: g.parent_id,
        parent_output: g.parent_id ? 0 : null,
        branch_of: g.fork_of_id ? { id: g.fork_of_id, output: 0 } : null,
        root: g.root_id || g.id,
        version: g.version,
        instruction: g.instruction,
        what_changed: g.change_note,
        prompt: g.prompt,
        inputs: gIn.filter((x) => x.generation_id === g.id).sort((a, b) => a.idx - b.idx).map((x) => clean({ ...media(use(x.asset_hash)), role: /^product\b/i.test(x.note ?? '') ? 'product' : 'reference', note: x.note, name: x.original_name })),
        provider: g.provider,
        model: g.model,
        params: clean({ n: params.variants, size: params.size, aspect: params.aspect, allow_text: params.no_text_line === false ? true : null }),
        outputs: gOut.filter((x) => x.generation_id === g.id).sort((a, b) => a.idx - b.idx).map((x) => ({ ...media(use(x.asset_hash)), bytes: assetBy.get(x.asset_hash)?.bytes ?? null })),
        cost_usd: g.cost_usd,
        error: g.error,
        context_used: ctx.filter((x) => x.kind === 'knowledge').map((x) => clean({ kind: 'knowledge', ref: x.ref_id, label: x.label, version: x.version })),
        skills: Object.fromEntries(ctx.filter((x) => x.kind === 'skill').map((x) => [x.label, x.version ?? x.ref_id])),
        author: g.agent_name ? `${g.agent_name} ${g.agent_version ?? ''}`.trim() : null,
        created: g.created_at,
        request_id: g.request_id,
        run_id: g.run_id,
        is_test: g.is_test ? true : null,
      });
      rec.outputs ??= [];
      rec.inputs ??= [];
      write(path.join(clientDir(w.client), 'projects', w.project, 'generations', `${g.id}.yaml`), rec);
      if (!dryRun && !fs.existsSync(path.join(clientDir(w.client), 'projects', w.project, 'project.yaml'))) {
        writeYamlAtomic(path.join(clientDir(w.client), 'projects', w.project, 'project.yaml'), { name: w.project === 'studio-images' ? 'Studio images' : 'Scratch', status: 'active' });
      }
      bump('generation');
      bump('generation_input', rec.inputs.length);
      bump('generation_output', rec.outputs.length);
      bump('generation_context', ctx.length);
    }
    const actionFor = { approval: (v) => (v === 'approved' || v === 'approve' ? 'approve' : 'reject'), rating: () => 'rate', comment: () => 'comment', like: () => 'like' };
    for (const f of feedback) {
      addReview(f.generation_id, clean({ id: `fb_${f.id}`, at: f.created_at, author: 'studio-app', target: f.generation_id, output: 0, action: actionFor[f.kind]?.(f.value) ?? 'comment', value: f.kind === 'rating' ? Number(f.value) : null, note: f.body }));
      bump('feedback');
    }
    for (const c of checks) {
      addReview(c.generation_id, clean({ id: `ck_${c.id}`, at: c.created_at, author: 'creative-qa', target: c.generation_id, output: 0, action: 'comment', note: c.summary, value: { check: c.status, issues: J(c.issues, []), labels_read: J(c.labels_read, []) } }));
      bump('image_check');
    }
    for (const [key, rows] of reviewRows) writeJsonl(path.join(paths().clients, key.split('/')[0], 'projects', key.split('/')[1], 'review.jsonl'), rows.sort((a, b) => String(a.at).localeCompare(String(b.at))));

    // ---- operational history: kept as an archive, not used by the studio ----
    const archive = new Map();
    for (const r of runs) {
      const c = clientSlug.get(r.client_id) ?? '_scratch';
      if (!archive.has(c)) archive.set(c, { runs: [], layouts: [] });
      archive.get(c).runs.push(clean({ ...r, settings: J(r.settings, {}), steps: J(r.steps, []), result: J(r.result, r.result) }));
      bump('agent_run');
    }
    for (const l of layouts) {
      const w = genWhere.get(l.generation_id);
      const c = w?.client ?? '_scratch';
      if (!archive.has(c)) archive.set(c, { runs: [], layouts: [] });
      archive.get(c).layouts.push(clean({ ...l, data: J(l.data, l.data) }));
      bump('compose_layout');
    }
    for (const [c, a] of archive) {
      writeJsonl(path.join(paths().clients, c, 'archive', 'studio-app-agent-runs.jsonl'), a.runs);
      writeJsonl(path.join(paths().clients, c, 'archive', 'studio-app-layouts.jsonl'), a.layouts);
    }

    // ---- media: every blob, verified by hash ----
    let copied = 0;
    const bad = [];
    const missing = [];
    for (const a of assets) {
      const file = blobs && [EXT[a.mime], '.png', '.jpg', '.webp', '.pdf'].filter(Boolean).map((e) => path.join(blobs, a.hash.slice(0, 2), a.hash + e)).find((f) => fs.existsSync(f));
      if (!file) {
        missing.push(a.hash);
        continue;
      }
      if (dryRun) {
        copied++;
        continue;
      }
      const data = fs.readFileSync(file);
      if (sha256(data) !== a.hash) {
        bad.push(a.hash);
        continue;
      }
      putMedia(data, a.mime);
      copied++;
    }
    bump('asset', copied);
    const unreferenced = assets.map((a) => a.hash).filter((h) => !used.has(h));
    if (unreferenced.length) notes.push(`${unreferenced.length} image file(s) aren't used by any record; they were copied to the media cache anyway: ${unreferenced.map((h) => h.slice(0, 12)).join(', ')}`);
    if (missing.length) notes.push(`${missing.length} image file(s) listed in the database were not found on disk: ${missing.map((h) => h.slice(0, 12)).join(', ')}`);
    if (bad.length) notes.push(`${bad.length} image file(s) didn't match their hash and were skipped: ${bad.map((h) => h.slice(0, 12)).join(', ')}`);
    const draftOnly = kVersions.length && !kVersions.some((v) => v.status === 'approved');
    if (draftOnly) notes.push('No client info was approved in the old studio, so brand.md files are empty templates and everything is in knowledge/ as drafts. Approve rules by moving them into brand.md.');

    const tables = Object.keys(counts).map((t) => ({ table: t, rows: counts[t], written: wrote[t] ?? 0, ok: (wrote[t] ?? 0) === counts[t] }));
    const ok = tables.every((t) => t.ok) && !bad.length;
    const report = { ok, dry_run: dryRun, source: dbFile.replace(os.homedir(), '~'), clients: clients.map((c) => clientSlug.get(c.id)), tables, notes };
    if (!dryRun) {
      const md = [
        `# Migration report — ${new Date().toISOString()}`,
        '',
        `Source: \`${report.source}\` (read from a snapshot; the original was not changed)`,
        '',
        `Result: **${ok ? 'every row accounted for' : 'CHECK THE ROWS MARKED ✗'}**`,
        '',
        '| Table | Rows | Written | |',
        '|---|---:|---:|---|',
        ...tables.map((t) => `| ${t.table} | ${t.rows} | ${t.written} | ${t.ok ? '✓' : '✗'} |`),
        '',
        ...(notes.length ? ['## Notes', '', ...notes.map((n) => `- ${n}`), ''] : []),
      ].join('\n');
      writeFileAtomic(path.join(paths().clients, 'migration-report.md'), md);
      report.report = 'clients/migration-report.md';
    }
    return report;
  } finally {
    db.close();
    snap.cleanup();
  }
}

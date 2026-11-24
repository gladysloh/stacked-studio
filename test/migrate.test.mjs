import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, test } from 'node:test';
import { makePng } from '../core/png.mjs';
import { repo, tempStudio } from './helpers.mjs';

let t;
beforeEach(() => (t = tempStudio()));
afterEach(() => t.cleanup());

/** A small New Gen Studio data folder with the real schema and one of everything. */
function oldStudio() {
  const root = path.join(t.dir, 'studio-data');
  fs.mkdirSync(path.join(root, 'system', 'blobs'), { recursive: true });
  const db = new DatabaseSync(path.join(root, 'system', 'studio.db'));
  db.exec(fs.readFileSync(path.join(repo, 'test/fixtures/studio-app-schema.sql'), 'utf8'));
  const now = '2026-11-01T00:00:00.000Z';
  const blob = (rgb) => {
    const data = makePng(4, 4, () => rgb);
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    fs.mkdirSync(path.join(root, 'system', 'blobs', hash.slice(0, 2)), { recursive: true });
    fs.writeFileSync(path.join(root, 'system', 'blobs', hash.slice(0, 2), hash + '.png'), data);
    db.prepare('insert into asset (hash, mime, bytes, created_at, width, height) values (?, ?, ?, ?, 4, 4)').run(hash, 'image/png', data.length, now);
    return hash;
  };
  const [h1, h2, h3, h4] = [blob([1, 2, 3]), blob([4, 5, 6]), blob([7, 8, 9]), blob([9, 9, 9])];
  db.prepare("insert into client (id, name, created_at, updated_at) values ('c1', 'Acme Beauty', ?, ?)").run(now, now);
  db.prepare("insert into knowledge_item (id, client_id, kind, title, created_at) values ('k1', 'c1', 'brand', 'Palette', ?)").run(now);
  db.prepare("insert into knowledge_version (id, item_id, version, body, status, created_at) values ('kv1', 'k1', 1, 'Old amber', 'replaced', ?), ('kv2', 'k1', 2, 'Warm amber #C8862B', 'approved', ?)").run(now, now);
  db.prepare("insert into client_asset (id, client_id, kind, asset_hash, name, created_at, source, label_text) values ('a1', 'c1', 'product', ?, 'Night Serum', ?, 'Previous studio', 'NIGHT SERUM'), ('a2', 'c1', 'reference', ?, 'Mood', ?, 'deck', null)").run(h1, now, h2, now);
  db.prepare("insert into deck (id, client_id, title, source_id, source_url, imported_at, full_text) values ('d1', 'c1', '[INT] Acme Working Deck', 'SLIDES1', 'https://docs.google.com/presentation/d/SLIDES1/edit', ?, 'all text')").run(now);
  db.prepare("insert into deck_slide (deck_id, idx, title, body) values ('d1', 0, 'Cover', 'Spring'), ('d1', 1, 'D01', 'Serum hero')").run();
  db.prepare("insert into deck_comment (id, deck_id, slide, author, body, resolved, imported_at, asset_code) values ('cm1', 'd1', 2, 'Client', 'Bigger bottle', 0, ?, 'D01')").run(now);
  db.prepare("insert into project (id, client_id, name, brief, deck_id, created_at, updated_at) values ('p1', 'c1', 'Spring 2027', 'The brief', 'd1', ?, ?)").run(now, now);
  db.prepare("insert into deliverable (id, project_id, code, status, created_at, updated_at) values ('dl1', 'p1', 'D01', 'in_progress', ?, ?)").run(now, now);
  db.prepare("insert into deliverable_messaging (id, deliverable_id, created_at, source, product, key_message) values ('m1', 'dl1', ?, 'deck', 'Night Serum', 'Wake up glowing')").run(now);
  db.prepare("insert into deliverable_slide (deliverable_id, slide, lighting, palette, created_at) values ('dl1', 1, 'Golden side light', '[\"#C8862B\"]', ?)").run(now);
  db.prepare("insert into deliverable_file (deliverable_id, asset_hash, slide, created_at, role) values ('dl1', ?, 1, ?, 'mood')").run(h2, now);
  db.prepare("insert into concept (id, deliverable_id, name, created_at) values ('cc1', 'dl1', 'Concept A', ?)").run(now);
  db.prepare("insert into generation (id, created_at, instruction, prompt, provider, model, params, root_id, version, cost_usd, client_id, deliverable_id, concept_id) values ('g1', ?, 'make it', 'serum on marble', 'gemini', 'gemini-3.1-flash-image', '{\"variants\":1,\"size\":\"1K\",\"aspect\":\"4:5\"}', 'g1', 1, 0.067, 'c1', 'dl1', 'cc1')").run(now);
  db.prepare("insert into generation (id, created_at, prompt, provider, model, parent_id, root_id, version, status, error, client_id, deliverable_id) values ('g2', '2026-11-02T00:00:00.000Z', 'softer', 'gemini', 'gemini-3.1-flash-image', 'g1', 'g1', 2, 'failed', 'quota', 'c1', 'dl1')").run();
  db.prepare("insert into generation_input (generation_id, idx, kind, asset_hash, note) values ('g1', 0, 'reference', ?, 'Product: Night Serum')").run(h1);
  db.prepare("insert into generation_output (generation_id, idx, asset_hash) values ('g1', 0, ?)").run(h3);
  db.prepare("insert into generation_context (generation_id, kind, ref_id, label, version) values ('g1', 'knowledge', 'kv2', 'Palette', '2'), ('g1', 'skill', 'abc', 'image-prompt-craft', '1.1.0')").run();
  db.prepare("insert into feedback (id, generation_id, created_at, kind, value) values ('f1', 'g1', ?, 'approval', 'approved')").run(now);
  db.prepare("insert into image_check (id, generation_id, created_at, status, summary) values ('ic1', 'g1', ?, 'issues', 'Label blurred')").run(now);
  db.prepare("insert into agent_run (id, created_at, kind, text, client_id) values ('r1', ?, 'prompt', 'write a prompt', 'c1')").run(now);
  db.close();
  return { root, h4 };
}

test('migration accounts for every row, keeps lineage, review and media, and never touches the source', async () => {
  const { root, h4 } = oldStudio();
  const before = fs.readFileSync(path.join(root, 'system', 'studio.db'));
  const { migrateStudioData } = await import('../core/migrate-studio-data.mjs');
  const r = await migrateStudioData(root);
  assert.equal(r.ok, true, JSON.stringify(r.tables.filter((x) => !x.ok)));
  assert.deepEqual(fs.readFileSync(path.join(root, 'system', 'studio.db')), before);
  assert.ok(r.notes.some((n) => n.includes(h4.slice(0, 12)))); // unused image reported

  const c = path.join(t.ws, 'clients', 'acme-beauty');
  const yaml = (await import('yaml')).default;
  const cfg = yaml.parse(fs.readFileSync(path.join(c, 'client.yaml'), 'utf8'));
  assert.equal(cfg.links.decks[0].slides_id, 'SLIDES1');
  assert.match(fs.readFileSync(path.join(c, 'brand', 'notes', 'brand-palette.md'), 'utf8'), /status: "approved"[\s\S]*Warm amber/);
  assert.equal(yaml.parse(fs.readFileSync(path.join(c, 'brand', 'notes', 'history', 'brand-palette.yaml'), 'utf8')).length, 2);
  assert.equal(yaml.parse(fs.readFileSync(path.join(c, 'products', 'night-serum', 'product.yaml'), 'utf8')).label_text, 'NIGHT SERUM');
  assert.match(fs.readFileSync(path.join(c, 'projects', 'spring-2027', 'D01-night-serum', 'brief.md'), 'utf8'), /Wake up glowing[\s\S]*Golden side light[\s\S]*#C8862B/);
  assert.match(fs.readFileSync(path.join(c, 'decks', 'acme-working-deck', 'comments.jsonl'), 'utf8'), /Bigger bottle/);

  const rec = await import('../core/records.mjs');
  const g2 = rec.requireGeneration('g2');
  assert.equal(g2.status, 'failed');
  assert.equal(g2.parent, 'g1');
  assert.equal(g2.kind, 'edit');
  const g1 = rec.withReview(rec.requireGeneration('g1'));
  assert.equal(g1.inputs[0].role, 'product');
  assert.equal(g1.deliverable, 'D01');
  assert.equal(g1.concept, 'Concept A');
  assert.equal(g1.outputs[0].status, 'approved');
  assert.ok(g1.outputs[0].file && fs.existsSync(g1.outputs[0].file));
  assert.equal(rec.history('g2').length, 2);
  assert.ok(fs.existsSync(path.join(t.ws, 'clients', 'migration-report.md')));

  // Running it again refuses instead of overwriting.
  await assert.rejects(migrateStudioData(root), /already exist/);
});

test('dry run writes nothing', async () => {
  const { root } = oldStudio();
  const { migrateStudioData } = await import('../core/migrate-studio-data.mjs');
  const r = await migrateStudioData(root, { dryRun: true });
  assert.equal(r.ok, true);
  assert.equal(fs.existsSync(path.join(t.ws, 'clients', 'acme-beauty')), false);
});

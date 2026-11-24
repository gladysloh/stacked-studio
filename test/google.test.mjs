import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { makePng } from '../core/png.mjs';
import { cliAsync, fakeServer, tempStudio } from './helpers.mjs';

let t;
let g;
const png = makePng(6, 6, () => [120, 60, 30]);
const FOLDER = 'application/vnd.google-apps.folder';

/** A small fake of Google's OAuth, Drive, Slides and Sheets APIs. */
function fakeGoogle() {
  const files = {
    clientroot0001: { id: 'clientroot0001', name: 'Acme', mimeType: FOLDER, parents: ['teamroot00001'] },
    guidelines001: { id: 'guidelines001', name: 'Acme brand guidelines.pdf', mimeType: 'application/pdf', parents: ['clientroot0001'], md5Checksum: 'm1', description: 'Official brand book 2026' },
    productsfold1: { id: 'productsfold1', name: 'Products', mimeType: FOLDER, parents: ['clientroot0001'] },
    serumpng00001: { id: 'serumpng00001', name: 'Night serum front.png', mimeType: 'image/png', parents: ['productsfold1'], md5Checksum: 'm2' },
    deck000000001: { id: 'deck000000001', name: 'Spring deck', mimeType: 'application/vnd.google-apps.presentation', parents: ['clientroot0001'] },
  };
  let n = 0;
  const state = { files, uploads: [], tokenCalls: 0, sheetWrites: [] };
  const handler = (req, body) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (p === '/token') {
      state.tokenCalls++;
      const params = new URLSearchParams(body.toString());
      if (params.get('refresh_token') === 'revoked') return { status: 400, json: { error: 'invalid_grant' } };
      return { json: { access_token: `at${state.tokenCalls}`, expires_in: 3600, refresh_token: 'rt-1', scope: 'openid email drive', id_token: `x.${Buffer.from(JSON.stringify({ email: 'tester@example.com' })).toString('base64url')}.y` } };
    }
    if (req.headers.authorization?.startsWith('Bearer ') !== true) return { status: 401, json: {} };
    if (p === '/drive/v3/files' && req.method === 'GET') {
      const qy = url.searchParams.get('q');
      const parent = qy.match(/'([^']+)' in parents/)[1];
      const name = qy.match(/name = '([^']+)'/)?.[1];
      let list = Object.values(files).filter((f) => f.parents?.includes(parent));
      if (name) list = list.filter((f) => f.name === name && (!qy.includes('mimeType') || f.mimeType === FOLDER));
      return { json: { files: list } };
    }
    if (p === '/drive/v3/files' && req.method === 'POST') {
      const id = `newfolder${String(++n).padStart(4, '0')}`;
      files[id] = { id, name: body.name, mimeType: body.mimeType, parents: body.parents, webViewLink: `https://drive.google.com/drive/folders/${id}` };
      return { json: files[id] };
    }
    if (p === '/upload/drive/v3/files') {
      const text = body.toString('latin1');
      const meta = JSON.parse(text.match(/\r\n\r\n(\{.*?\})\r\n/s)[1]);
      const id = `upload${String(++n).padStart(6, '0')}`;
      // The media part: after the second part's blank line, up to the closing boundary.
      const boundary = req.headers['content-type'].match(/boundary=(\S+)/)[1];
      const second = body.indexOf(Buffer.from(`--${boundary}`), 10);
      const start = body.indexOf(Buffer.from('\r\n\r\n'), second) + 4;
      const data = body.subarray(start, body.lastIndexOf(Buffer.from(`\r\n--${boundary}--`)));
      files[id] = { id, name: meta.name, mimeType: 'image/png', parents: meta.parents, description: meta.description, webViewLink: `https://drive.google.com/file/d/${id}/view`, data };
      state.uploads.push({ id, meta, bytes: body.length });
      return { json: files[id] };
    }
    const up = p.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/);
    if (up && req.method === 'PATCH') {
      files[up[1]].data = body;
      state.updates = (state.updates ?? 0) + 1;
      return { json: files[up[1]] };
    }
    const fm = p.match(/^\/drive\/v3\/files\/([^/]+)(\/export|\/comments)?$/);
    if (fm) {
      const f = files[fm[1]];
      if (!f) return { status: 404, json: { error: { message: 'File not found' } } };
      if (req.method === 'PATCH' && url.searchParams.get('addParents')) {
        f.parents = [url.searchParams.get('addParents')];
        return { json: f };
      }
      if (fm[2] === '/comments') {
        return { json: { comments: [
          { id: 'cm1', author: { displayName: 'Client' }, content: 'ABC005: make the jar bigger', resolved: false, createdTime: '2026-11-01T00:00:00Z', replies: [{ id: 'r1', author: { displayName: 'Studio' }, content: 'Will do' }] },
          { id: 'cm2', author: { displayName: 'Client' }, content: 'Love this', quotedFileContent: { value: 'Golden hour' }, resolved: true, anchor: JSON.stringify({ type: 'page', pages: ['p2'] }) },
        ] } };
      }
      if (fm[2] === '/export') return { raw: Buffer.from('%PDF-1.4 fake'), type: 'application/pdf' };
      if (url.searchParams.get('alt') === 'media') return { raw: f.data ?? (f.id === 'serumpng00001' ? png : Buffer.from('PK fake zip')), type: f.mimeType };
      return { json: { ...f, modifiedTime: '2026-11-01T00:00:00Z', headRevisionId: 'rev9', webViewLink: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view` } };
    }
    if (p === '/v1/presentations/deck000000001') {
      const shape = (text) => ({ shape: { text: { textElements: [{ textRun: { content: text } }] } } });
      return { json: { title: '[INT] Acme Spring Deck', slides: [
        { objectId: 'p1', pageElements: [shape('Spring 2027\n'), shape('Overview')] },
        { objectId: 'p2', pageElements: [shape('ABC005 Night serum hero\n'), shape('Golden hour, warm amber light')], slideProperties: { notesPage: { pageElements: [shape('Client loves amber')] } } },
      ] } };
    }
    if (p === '/v4/spreadsheets/sheet00000001') return { json: { sheets: [{ properties: { title: 'Shots' } }] } };
    if (p === '/v4/spreadsheets/sheet00000001/values/Shots') return { json: { range: 'Shots!A1:C3', values: [['Code', 'Prompt', 'Status'], ['D01', 'jar on marble'], ['D02', 'jar on linen', 'Done']] } };
    if (p.startsWith('/v4/spreadsheets/sheet00000001/values/') && req.method === 'PUT') {
      state.sheetWrites.push(body);
      return { json: { updatedRange: body.range, updatedCells: body.values.flat().length } };
    }
    return { status: 404, json: { error: { message: `no route ${p}` } } };
  };
  return { state, handler };
}

beforeEach(async () => {
  t = tempStudio();
  const fake = fakeGoogle();
  const srv = await fakeServer(fake.handler);
  g = { ...fake, srv };
  process.env.STACKED_GOOGLE_BASE = srv.url;
  process.env.STACKED_GOOGLE_CLIENT_ID = 'client-id.apps.googleusercontent.com';
  t.env.STACKED_GOOGLE_BASE = srv.url;
  t.env.STACKED_GOOGLE_CLIENT_ID = 'client-id.apps.googleusercontent.com';
});
afterEach(async () => {
  await g.srv.close();
  delete process.env.STACKED_GOOGLE_BASE;
  delete process.env.STACKED_GOOGLE_CLIENT_ID;
  t.cleanup();
});

async function signedIn() {
  const auth = await import('../core/google/auth.mjs');
  return auth.exchangeCode({ code: 'c', verifier: 'v', redirectUri: 'http://127.0.0.1/callback' });
}

test('sign-in stores a refresh token in the keychain, refreshes access tokens, and can disconnect', async () => {
  const auth = await import('../core/google/auth.mjs');
  assert.equal(auth.googleStatus().connected, false);
  await assert.rejects(auth.accessToken(), /not connected/);
  const r = await signedIn();
  assert.equal(r.email, 'tester@example.com');
  assert.equal(auth.googleStatus().email, 'tester@example.com');
  const a1 = await auth.accessToken();
  const a2 = await auth.accessToken();
  assert.equal(a1, a2); // cached until near expiry
  const keys = await import('../core/keys.mjs');
  assert.match(keys.getSecret('google-oauth'), /rt-1/);
  const { paths } = await import('../core/paths.mjs');
  assert.ok(!(fs.existsSync(paths().userConfig) && fs.readFileSync(paths().userConfig, 'utf8').includes('rt-1')));
  await auth.disconnect();
  assert.equal(auth.googleStatus().connected, false);
});

test('without a team sign-in client, the fix points to the setup doc', async () => {
  delete process.env.STACKED_GOOGLE_CLIENT_ID;
  const auth = await import('../core/google/auth.mjs');
  assert.throws(() => auth.oauthClient(), (e) => /not set up/.test(e.message) && /google-setup/.test(e.fix));
});

test('drive: link a client folder, index it for search, fetch a file once', async () => {
  await signedIn();
  const ws = await import('../core/workspace.mjs');
  const sd = await import('../core/google/studio-drive.mjs');
  const { runOp } = await import('../core/ops.mjs');
  const slug = ws.createClient('Acme');
  const linked = await sd.linkClientFolder(slug, 'https://drive.google.com/drive/folders/clientroot0001');
  assert.equal(linked.id, 'clientroot0001');
  const idx = await runOp('drive_index', { client: slug });
  assert.equal(idx.files, 3);
  const found = await runOp('search', { query: 'brand book guidelines', client: slug, kinds: ['drive_file'] });
  assert.equal(found.results[0].ref, 'guidelines001');
  const serum = await runOp('search', { query: 'night serum', client: slug });
  assert.ok(serum.results.some((x) => x.ref === 'serumpng00001'));
  const f1 = await runOp('drive_fetch', { file: 'serumpng00001' });
  assert.equal(f1.cached, false);
  assert.ok(fs.existsSync(f1.file));
  const f2 = await runOp('drive_fetch', { file: 'https://drive.google.com/file/d/serumpng00001/view' });
  assert.equal(f2.cached, true);
  assert.equal(f2.sha, f1.sha);
  const pdf = await runOp('drive_fetch', { file: 'deck000000001' });
  assert.equal(pdf.mime, 'application/pdf');
  // A fetched image works as an input straight away.
  const img = await runOp('image_generate', { prompt: 'serum on marble', client: slug, project: 'P1', inputs: [{ sha: f1.sha, role: 'product' }] });
  assert.equal(img.inputs[0].role, 'product');
});

test('drive: init makes the client folder in the Shared Drive; save uploads once, into the project numbered folders (approved → 03_Final)', async () => {
  await signedIn();
  const { importTeam } = await import('../core/share.mjs');
  const dir = path.join(t.dir, 'pack');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'team.yaml'), 'name: Team\ngoogle:\n  root_folder_id: teamroot00001\n');
  importTeam(dir);
  const ws = await import('../core/workspace.mjs');
  const sd = await import('../core/google/studio-drive.mjs');
  const { runOp } = await import('../core/ops.mjs');
  const slug = ws.createClient('Acme');
  const init = await sd.initClientFolder(slug);
  assert.equal(init.id, 'clientroot0001'); // reused the existing folder with the same name
  const again = await sd.initClientFolder(slug);
  assert.equal(again.created, false);

  const img = await runOp('image_generate', { prompt: 'x', client: slug, project: 'Spring', deliverable: 'D01' });
  await runOp('review', { id: img.id, action: 'approve' });
  const s1 = await runOp('drive_save', { id: img.id });
  assert.match(s1.name, /^D01_v1_/);
  const byName = (n, parent) => Object.values(g.state.files).find((f) => f.name === n && (!parent || f.parents?.[0] === parent));
  const projFolder = byName('Spring');
  const finalFolder = byName('03_Final', projFolder.id);
  assert.deepEqual(projFolder.parents, ['clientroot0001']);
  for (const n of ['01_Generated', '02_Rejected', '04_Review Decks']) assert.ok(byName(n, projFolder.id), n);
  // Approved → 03_Final/<asset code>/
  assert.deepEqual(g.state.files[s1.drive_id].parents, [byName('D01', finalFolder.id).id]);
  assert.equal((await import('../core/fsutil.mjs')).readYaml(path.join(t.ws, 'clients', slug, 'projects', 'spring', 'project.yaml')).links.drive.final, finalFolder.id);
  assert.match(g.state.files[s1.drive_id].description, new RegExp(img.id));
  const s2 = await runOp('drive_save', { id: img.id });
  assert.equal(s2.already_saved, true);
  assert.equal(g.state.uploads.length, 1);
  const h = await runOp('history', { id: img.id });
  assert.equal(h.versions[0].outputs[0].drive_id, s1.drive_id);

  // Rejecting it later moves the same file to 02_Rejected/D01 (no new upload).
  const r = await runOp('review', { id: img.id, action: 'reject' });
  assert.equal(r.drive.moved, true);
  assert.deepEqual(g.state.files[s1.drive_id].parents, [byName('D01', byName('02_Rejected', projFolder.id).id).id]);
  assert.equal(g.state.uploads.length, 1);

  // Pushing the project uploads versions not on Drive yet into 01_Generated/<code>/, and leaves placed ones.
  const img2 = await runOp('image_generate', { prompt: 'y', client: slug, project: 'Spring', deliverable: 'D02' });
  // Free test images stay off Drive by default.
  assert.equal((await runOp('drive_push_versions', { client: slug, project: 'Spring' })).uploaded, 0);
  const sd2 = await import('../core/google/studio-drive.mjs');
  const push = await sd2.pushProjectVersions(slug, 'spring', { includeTests: true });
  assert.equal(push.uploaded, 1);
  assert.equal(push.in_place, 1);
  const up = g.state.uploads.at(-1);
  assert.deepEqual(up.meta.parents, [byName('D02', byName('01_Generated', projFolder.id).id).id]);
  assert.match(up.meta.name, new RegExp(img2.id.slice(-6)));
  const again2 = await sd2.pushProjectVersions(slug, 'spring', { includeTests: true });
  assert.equal(again2.uploaded, 0);
});

test('slides: deck import writes slides, notes and comments; re-import reports nothing new', async () => {
  await signedIn();
  const ws = await import('../core/workspace.mjs');
  const { runOp } = await import('../core/ops.mjs');
  const slug = ws.createClient('Acme');
  const r = await runOp('deck_import', { client: slug, deck: 'https://docs.google.com/presentation/d/deck000000001/edit' });
  assert.equal(r.slides, 2);
  assert.equal(r.comments, 2);
  assert.equal(r.open, 1);
  assert.equal(r.new_comments, 2);
  assert.deepEqual(r.codes, ['ABC005']);
  const dir = path.join(t.ws, 'clients', slug, 'decks', 'acme-spring-deck');
  assert.match(fs.readFileSync(path.join(dir, 'slides.md'), 'utf8'), /Speaker notes: Client loves amber/);
  const comments = fs.readFileSync(path.join(dir, 'comments.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(comments[0].asset_code, 'ABC005');
  assert.equal(comments[0].replies[0].body, 'Will do');
  // A comment anchored to a slide gets that slide's number and code, even without the code in its text.
  assert.equal(comments[1].slide, 2);
  assert.equal(comments[1].asset_code, 'ABC005');
  const again = await runOp('deck_import', { client: slug, deck: 'deck000000001' });
  assert.equal(again.new_comments, 0);
  const s = await runOp('search', { query: 'jar bigger', client: slug, kinds: ['deck_comment'] });
  assert.equal(s.results.length, 1);
});

test('sheets: rows keyed by header with row numbers; write back', async () => {
  await signedIn();
  const { runOp } = await import('../core/ops.mjs');
  const r = await runOp('sheet_read', { sheet: 'https://docs.google.com/spreadsheets/d/sheet00000001/edit' });
  assert.deepEqual(r.columns, ['Code', 'Prompt', 'Status']);
  assert.deepEqual(r.rows[0], { _row: 2, Code: 'D01', Prompt: 'jar on marble', Status: '' });
  const w = await runOp('sheet_write', { sheet: 'sheet00000001', range: 'Shots!C2', values: [['Done']] });
  assert.equal(w.updated_cells, 1);
});

test('client pack through Drive: export --drive uploads to _client-packs; doctor shows Google', async () => {
  await signedIn();
  const { importTeam } = await import('../core/share.mjs');
  const dir = path.join(t.dir, 'pack');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'team.yaml'), 'name: Team\ngoogle:\n  root_folder_id: teamroot00001\n');
  importTeam(dir);
  const ws = await import('../core/workspace.mjs');
  ws.createClient('Acme');
  const r = await cliAsync(['client', 'export', 'acme', '--out', path.join(t.dir, 'acme.zip'), '--drive'], t.env);
  assert.equal(r.code, 0, r.stderr);
  const out = r.json();
  assert.ok(out.drive.drive_id);
  const packs = Object.values(g.state.files).find((f) => f.name === '_client-packs');
  assert.deepEqual(g.state.files[out.drive.drive_id].parents, [packs.id]);
  const d = (await cliAsync(['doctor', '--json'], t.env)).json();
  assert.match(d.checks.find((c) => c.id === 'google').detail, /tester@example.com/);
});

test('read-only folder: indexed and fetched, never saved to; decks re-sync from client.yaml', async () => {
  await signedIn();
  const ws = await import('../core/workspace.mjs');
  const sd = await import('../core/google/studio-drive.mjs');
  const { runOp } = await import('../core/ops.mjs');
  const slug = ws.createClient('Acme');
  g.state.files.readonlydecks = { id: 'readonlydecks', name: 'Working decks', mimeType: FOLDER, parents: ['elsewhere'] };
  g.state.files.deck000000001.parents = ['readonlydecks'];
  const ro = await sd.linkClientFolder(slug, 'https://drive.google.com/drive/folders/readonlydecks', { readOnly: true });
  assert.equal(ro.read_only, true);
  await sd.linkClientFolder(slug, 'clientroot0001');
  await assert.rejects(sd.linkClientFolder(slug, 'readonlydecks'), /read-only/);
  const idx = await runOp('drive_index', { client: slug });
  assert.equal(idx.files, 3); // guidelines + serum in the studio folder, the deck in the read-only one
  const found = await runOp('search', { query: 'spring deck', client: slug, kinds: ['drive_file'] });
  assert.equal(found.results[0].ref, 'deck000000001');
  const img = await runOp('image_generate', { prompt: 'x', client: slug, project: 'P1' });
  await assert.rejects(runOp('drive_save', { id: img.id, folder: 'readonlydecks' }), /read-only/);
  // A deck imported once is remembered; `deck_import` without a link re-syncs it.
  await runOp('deck_import', { client: slug, deck: 'deck000000001' });
  const again = await runOp('deck_import', { client: slug });
  assert.equal(again.decks.length, 1);
  assert.equal(again.decks[0].new_comments, 0);
});

test('client sync: two teammates through the Shared Drive; one-sided edits merge, two-sided edits are flagged', async () => {
  await signedIn();
  const share = await import('../core/share.mjs');
  const dir = path.join(t.dir, 'pack');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'team.yaml'), 'name: Team\ngoogle:\n  root_folder_id: teamroot00001\n');
  const wsA = t.ws;
  const wsB = path.join(t.dir, 'wsB');
  const as = (w) => (process.env.STACKED_WORKSPACE = w);
  const ws = await import('../core/workspace.mjs');
  const { runOp } = await import('../core/ops.mjs');
  const brand = (w) => path.join(w, 'clients', 'acme', 'brand', 'brand.md');

  // A makes the client and the first shared copy.
  as(wsA);
  share.importTeam(dir);
  ws.createClient('Acme');
  const first = await runOp('client_sync', { client: 'acme' });
  assert.match(first.message, /first shared copy/);

  // B imports it from the Drive link and syncs (nothing to change).
  as(wsB);
  share.importTeam(dir);
  const r = await cliAsync(['client', 'import', first.pushed.link], { ...t.env, STACKED_WORKSPACE: wsB });
  assert.equal(r.code, 0, r.stderr);
  const b1 = await runOp('client_sync', { client: 'acme' });
  assert.deepEqual(b1.pulled.conflicts, []);

  // B edits brand.md; A adds a knowledge note. Both sync: each gets the other's change.
  fs.appendFileSync(brand(wsB), '\nFrom B: amber only.\n');
  await runOp('client_sync', { client: 'acme' });
  as(wsA);
  fs.writeFileSync(path.join(wsA, 'clients/acme/brand/notes/tone.md'), '---\nstatus: draft\n---\nCalm.\n');
  const a2 = await runOp('client_sync', { client: 'acme' });
  assert.equal(a2.pulled.updated, 1);
  assert.deepEqual(a2.pulled.conflicts, []);
  assert.match(fs.readFileSync(brand(wsA), 'utf8'), /From B/);
  as(wsB);
  const b2 = await runOp('client_sync', { client: 'acme' });
  assert.equal(b2.pulled.added, 1);
  assert.ok(fs.existsSync(path.join(wsB, 'clients/acme/brand/notes/tone.md')));

  // Both edit brand.md: flagged, nothing pushed, nothing overwritten.
  fs.appendFileSync(brand(wsB), '\nB again\n');
  await runOp('client_sync', { client: 'acme' });
  as(wsA);
  fs.appendFileSync(brand(wsA), '\nA too\n');
  const updatesBefore = g.state.updates;
  const a3 = await runOp('client_sync', { client: 'acme' });
  assert.equal(a3.pulled.conflicts.length, 1);
  assert.equal(a3.pushed, null);
  assert.equal(g.state.updates, updatesBefore);
  assert.match(fs.readFileSync(brand(wsA), 'utf8'), /A too/);
  assert.ok(fs.existsSync(brand(wsA) + '.incoming'));
  as(wsA);
});

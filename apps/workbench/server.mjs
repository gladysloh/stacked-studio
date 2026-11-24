import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare } from '../../core/generate.mjs';
import { runOp, summarize } from '../../core/ops.mjs';
import { mediaPath, MIME } from '../../core/media.mjs';
import { listProviders } from '../../core/providers/index.mjs';
import { history, listGenerations, withReview } from '../../core/records.mjs';
import { pickAgent, Runner } from '../../core/runner.mjs';
import { spendSummary } from '../../core/spend.mjs';
import { clientDir, listClients, listProjects, resolveClient, SCRATCH } from '../../core/workspace.mjs';
import { clientPage, clientsOverview, deliverablePage, projectPage } from '../../core/projects.mjs';
import { addToInbox, fileInbox, listInbox } from '../../core/inbox.mjs';
import { organiseClient } from '../../core/organise.mjs';

// The Workbench's local server. Listens on 127.0.0.1 only. Every API call needs the session cookie,
// set from a one-time link printed at start; requests whose Host or Origin isn't this server are
// refused, so other websites can't reach it. Decisions (approve, compare) call the core directly;
// requests that need judgement (Refine, New direction, New image) run the person's own agent.

const UI = path.dirname(fileURLToPath(import.meta.url));
const STATIC = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

/** Tiles: the newest version of each image history, with its first output. */
function board({ client, project, status }) {
  const all = listGenerations({ client: client || undefined, project: project || undefined, limit: 2000 }).filter((g) => g.status === 'done');
  const latest = new Map();
  for (const g of all) if (!latest.has(g.root)) latest.set(g.root, g);
  const tiles = [...latest.values()].map((g) => {
    const r = withReview(g);
    const versions = all.filter((x) => x.root === g.root).length;
    const best = r.outputs.find((o) => o.status === 'approved') ?? r.outputs[0];
    return { id: r.id, history: r.root, client: r.client, project: r.project, deliverable: r.deliverable, version: r.version, versions, outputs: r.outputs.length, status: best?.status ?? 'new', sha: best?.sha, mime: best?.mime, prompt: r.prompt?.slice(0, 160), created: r.created, test: Boolean(r.is_test) };
  });
  return status ? tiles.filter((t) => t.status === status) : tiles;
}

export async function startServer({ port = 4321, host = '127.0.0.1', open = true, quiet = false } = {}) {
  const runner = new Runner();
  const token = crypto.randomBytes(24).toString('base64url');
  let actual = port;
  const hosts = () => [`127.0.0.1:${actual}`, `localhost:${actual}`];

  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (c) => {
        data += c;
        if (data.length > 1_000_000) reject(new Error('Too large.'));
      });
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          reject(new Error('Bad request.'));
        }
      });
    });
  const readRaw = (req, limit = 40 * 1024 * 1024) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) reject(new Error('That file is larger than 40 MB.'));
        else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
    });
  const client = (c) => (c === SCRATCH ? SCRATCH : resolveClient(c));
  const meta = () => {
    const s = spendSummary(1);
    return { agent: pickAgent()?.label ?? null, providers: listProviders().filter((p) => p.ready && p.id !== 'test').map((p) => p.label), spent_today: Number(s.today.toFixed(2)), daily_cap: s.cap, runs: runner.list() };
  };
  const cookieOk = (req) => (req.headers.cookie || '').split(';').some((c) => c.trim() === `ss_session=${token}`);

  async function api(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean).slice(1);
    const m = req.method;
    const q = Object.fromEntries(url.searchParams);
    if (m === 'GET' && parts[0] === 'state') {
      const s = spendSummary(1);
      return send(res, 200, {
        clients: listClients().map((c) => ({ slug: c.slug, name: c.name })),
        projects: q.client ? listProjects(q.client).map((p) => ({ slug: p.slug, name: p.name })) : [],
        tiles: board(q),
        agent: pickAgent()?.label ?? null,
        providers: listProviders().filter((p) => p.ready && p.id !== 'test').map((p) => p.label),
        spent_today: Number(s.today.toFixed(2)),
        daily_cap: s.cap,
        runs: runner.list(),
      });
    }
    if (m === 'GET' && parts[0] === 'overview') return send(res, 200, { clients: clientsOverview(), scratch_inbox: listInbox(SCRATCH).length, ...meta() });
    if (m === 'GET' && parts[0] === 'client' && parts[1]) {
      const c = client(parts[1]);
      const { googleStatus } = await import('../../core/google/auth.mjs');
      const { clientFolderId } = await import('../../core/google/studio-drive.mjs');
      let drive = null;
      try {
        drive = clientFolderId(c);
      } catch {}
      const page = c === SCRATCH ? { client: { slug: SCRATCH, name: 'No client' }, projects: listProjects(SCRATCH).map((p) => ({ slug: p.slug, name: p.name })), library: {} } : clientPage(c);
      return send(res, 200, { ...page, inbox: listInbox(c).map(({ name, sha, note, width, height }) => ({ name, sha, note, width, height })), google: googleStatus(), drive_folder: drive ? `https://drive.google.com/drive/folders/${drive}` : null, ...meta() });
    }
    if (m === 'GET' && parts[0] === 'project' && parts[2]) return send(res, 200, { ...projectPage(client(parts[1]), parts[2]), ...meta() });
    if (m === 'GET' && parts[0] === 'deliverable' && parts[3]) return send(res, 200, { ...deliverablePage(client(parts[1]), parts[2], parts[3]), ...meta() });
    if (m === 'POST' && parts[0] === 'upload') {
      const data = await readRaw(req);
      return send(res, 200, addToInbox(client(q.client || SCRATCH), { data, name: q.name ?? 'upload.png', note: q.note || null }));
    }
    if (m === 'POST' && parts[0] === 'inbox') {
      const b = await readBody(req);
      return send(res, 200, await fileInbox(client(b.client || SCRATCH), b.items ?? []));
    }
    if (m === 'POST' && parts[0] === 'organise') {
      const b = await readBody(req);
      const r = organiseClient(client(b.client));
      return send(res, 200, { ...r, skipped_existing: r.skipped_existing.length });
    }
    if (m === 'POST' && parts[0] === 'drive-push') {
      const b = await readBody(req);
      const { pushToDrive } = await import('../../core/google/studio-drive.mjs');
      return send(res, 200, await pushToDrive(client(b.client), { parts: b.parts }));
    }
    if (m === 'POST' && parts[0] === 'open') {
      // Opens the client's folder (or a subfolder of it) in Finder / the file manager. Never outside it.
      const b = await readBody(req);
      const base = clientDir(client(b.client));
      const target = path.resolve(base, String(b.sub ?? ''));
      if (!target.startsWith(base) || !fs.existsSync(target)) return send(res, 400, { error: 'No such folder.' });
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
      spawn(opener, [target], { stdio: 'ignore', detached: true }).unref();
      return send(res, 200, { opened: path.relative(path.dirname(base), target) });
    }
    if (m === 'GET' && parts[0] === 'image' && parts[1]) {
      const versions = history(parts[1]).map(summarize);
      const all = history(parts[1]);
      const me = withReview(all.find((g) => g.id === parts[1]));
      return send(res, 200, { image: { ...summarize(me), instruction: me.instruction, comments: me.outputs.map((o) => o.comments), checks: me.outputs.map((o) => o.check) }, versions, shas: Object.fromEntries(all.map((g) => [g.id, withReview(g).outputs.map((o) => ({ sha: o.sha, mime: o.mime, status: o.status }))])) });
    }
    if (m === 'POST' && parts[0] === 'review') {
      const b = await readBody(req);
      return send(res, 200, await runOp('review', { id: b.id, output: b.output ?? 0, action: b.action, note: b.note, value: b.value }));
    }
    if (m === 'POST' && parts[0] === 'compare') {
      const b = await readBody(req);
      // Viewing a comparison records nothing; picking one records the comparison and the pick.
      return send(res, 200, compare({ items: b.items, pick: b.pick ?? null, note: b.note ?? null, record: Boolean(b.pick) }));
    }
    if (m === 'GET' && parts[0] === 'runs') return send(res, 200, runner.list());
    if (m === 'POST' && parts[0] === 'runs' && parts.length === 1) {
      const b = await readBody(req);
      return send(res, 200, runner.start({ kind: b.kind, text: b.text, target: b.id ?? null, output: b.output ?? 0, client: b.client && b.client !== SCRATCH ? b.client : null, project: b.project || null, deliverable: b.deliverable || null, n: b.n ?? 1, aspect: b.aspect ?? null }));
    }
    if (m === 'POST' && parts[0] === 'runs' && parts[2] === 'stop') return send(res, 200, runner.stop(parts[1]));
    return send(res, 404, { error: 'Not found.' });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (!hosts().includes(req.headers.host)) return send(res, 403, { error: 'Wrong host.' });
      if (req.headers.origin && !hosts().some((h) => req.headers.origin === `http://${h}`)) return send(res, 403, { error: 'Wrong origin.' });
      if (url.pathname === '/login') {
        if (url.searchParams.get('t') !== token) return send(res, 403, { error: 'This link has expired. Run studio ui again.' });
        // ?to=image/<id> opens a page straight away (only Workbench routes are allowed).
        const to = url.searchParams.get('to') ?? '';
        const dest = /^(image|compare|c|all)(\/[\w:,.-]+)*$/.test(to) ? `/#/${to}` : '/';
        res.writeHead(302, { 'set-cookie': `ss_session=${token}; HttpOnly; SameSite=Strict; Path=/`, location: dest });
        return res.end();
      }
      if (!cookieOk(req)) {
        res.writeHead(401, { 'content-type': 'text/plain' });
        return res.end('Open the Workbench with the link printed by `studio ui`.');
      }
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      const media = url.pathname.match(/^\/media\/([0-9a-f]{64})$/);
      if (media) {
        const file = mediaPath(media[1]);
        if (!file) return send(res, 404, { error: 'Not in the local cache.' });
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'private, max-age=31536000, immutable' });
        return fs.createReadStream(file).pipe(res);
      }
      const name = STATIC[url.pathname];
      if (!name) return send(res, 404, { error: 'Not found.' });
      res.writeHead(200, { 'content-type': TYPES[path.extname(name)], 'cache-control': 'no-store' });
      res.end(fs.readFileSync(path.join(UI, name)));
    } catch (err) {
      send(res, 400, { error: err.message, fix: err.fix });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  actual = server.address().port;
  const link = `http://127.0.0.1:${actual}/login?t=${token}`;
  if (!quiet) console.log(`Workbench: ${link}\nKeep this window open. Ctrl+C to stop.`);
  if (open) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    try {
      spawn(opener, [link], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
    } catch {}
  }
  return { server, port: actual, link, token, runner, close: () => new Promise((r) => server.close(r)) };
}

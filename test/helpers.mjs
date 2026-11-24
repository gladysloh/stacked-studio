import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePng } from '../core/png.mjs';

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A fresh workspace and user folder for one test, wired through env vars so every module call
 * goes there. Keys go to a file, never the real keychain; no real API keys are visible.
 */
export function tempStudio() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stacked-test-'));
  const env = {
    STACKED_WORKSPACE: path.join(dir, 'ws'),
    STACKED_USER_HOME: path.join(dir, 'user'),
    STACKED_KEYCHAIN: 'file',
    STACKED_AUTHOR: 'tester',
    GEMINI_API_KEY: '',
    FAL_KEY: '',
  };
  fs.mkdirSync(env.STACKED_WORKSPACE, { recursive: true });
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  return {
    dir,
    env: { ...process.env, ...env },
    ws: env.STACKED_WORKSPACE,
    cleanup: () => {
      for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function cli(args, env, input) {
  const r = spawnSync(process.execPath, [path.join(repo, 'bin/studio.mjs'), ...args], { cwd: repo, env, input, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json: () => JSON.parse(r.stdout) };
}

export function pngFile(dir, name, rgb = [200, 40, 40]) {
  const f = path.join(dir, name);
  fs.writeFileSync(f, makePng(8, 8, () => rgb));
  return f;
}

/** A tiny HTTP server: handler(req, body) -> { status, json }. Records requests. */
export async function fakeServer(handler) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', async () => {
      const body = Buffer.concat(chunks);
      let parsed = null;
      try {
        parsed = body.length ? JSON.parse(body.toString()) : null;
      } catch {
        parsed = body;
      }
      calls.push({ url: req.url, headers: req.headers, body: parsed });
      const out = await handler(req, parsed, calls);
      if (out.raw) {
        res.writeHead(out.status ?? 200, { 'content-type': out.type ?? 'image/png' });
        return res.end(out.raw);
      }
      res.writeHead(out.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out.json ?? {}));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((r) => server.close(r)) };
}

/** Like cli(), but doesn't block, for tests where the CLI talks to a fake server in this process. */
export function cliAsync(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(repo, 'bin/studio.mjs'), ...args], { cwd: repo, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr, json: () => JSON.parse(stdout) }));
  });
}

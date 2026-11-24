import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { StudioError } from './errors.mjs';
import { paths, repoRoot, which } from './paths.mjs';

// The bridge to the optional Python media pack (py/, a uv project). Node sends one JSON object on
// stdin and reads one JSON object from stdout. Python tools only touch local files — they never call
// model APIs (Node owns those), so there's no logic in both languages.

export const PY_DIR = path.join(repoRoot, 'py');

export function uvPath() {
  return process.env.STACKED_UV || which('uv');
}

export function pyReady() {
  return Boolean(uvPath()) && fs.existsSync(path.join(PY_DIR, '.venv'));
}

function uvRun(args, input, { timeout = 600_000 } = {}) {
  const uv = uvPath();
  if (!uv) throw new StudioError('Media tools need uv (a Python manager).', 'Install it: curl -LsSf https://astral.sh/uv/install.sh | sh — then run ./setup.sh --with-media');
  return new Promise((resolve, reject) => {
    const child = spawn(uv, ['run', '--quiet', '--project', PY_DIR, ...args], { cwd: PY_DIR, env: { ...process.env, STACKED_MEDIA_DIR: paths().media }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      let json = null;
      try {
        json = JSON.parse(out.trim().split('\n').at(-1) || 'null');
      } catch {}
      if (code === 0 && json && !json.error) return resolve(json);
      reject(new StudioError(json?.error ?? `Media tool failed (exit ${code}): ${err.trim().split('\n').slice(-3).join(' ')}`, json?.fix));
    });
    child.stdin.end(JSON.stringify(input));
  });
}

export async function runMedia(tool, args = {}) {
  if (!/^[a-z_]+$/.test(tool)) throw new StudioError(`Bad tool name "${tool}".`);
  if (!pyReady()) throw new StudioError('The media tools are not installed.', './setup.sh --with-media');
  // Tools run inside py/, so relative paths are resolved here first.
  if (typeof args.path === 'string') args = { ...args, path: path.resolve(args.path.replace(/^~(?=\/)/, process.env.HOME ?? '~')) };
  const result = await uvRun(['python', '-m', 'stacked_media', tool], args);
  // Files a tool made go into the media cache here (Node owns the cache), returned by hash.
  if (Array.isArray(result.files)) {
    const { importFile } = await import('./media.mjs');
    result.files = result.files.map((f) => {
      const m = importFile(f.path);
      fs.rmSync(path.dirname(f.path), { recursive: true, force: true });
      return { ...f, path: m.file, sha: m.sha };
    });
  }
  return result;
}

export async function listMedia() {
  return uvRun(['python', '-m', 'stacked_media', 'list'], {});
}

/** `uv sync` with the chosen extras. Called by setup --with-media. */
export function syncPy(extras = []) {
  const uv = uvPath();
  if (!uv) throw new StudioError('uv is not installed.', 'curl -LsSf https://astral.sh/uv/install.sh | sh');
  const r = spawnSync(uv, ['sync', '--quiet', '--project', PY_DIR, ...extras.flatMap((e) => ['--extra', e])], { cwd: PY_DIR, encoding: 'utf8' });
  if (r.status !== 0) throw new StudioError(`uv sync failed: ${(r.stderr || '').trim().split('\n').slice(-3).join(' ')}`);
}

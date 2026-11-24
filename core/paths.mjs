import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The folder this checkout lives in. */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The workspace: clients/, team/ and .cache/ (all gitignored). Defaults to the checkout itself so a
 * teammate can see everything in one place. Override with STACKED_WORKSPACE (tests, or a second studio).
 */
export function workspaceRoot() {
  return process.env.STACKED_WORKSPACE ? path.resolve(process.env.STACKED_WORKSPACE) : repoRoot;
}

/** Personal settings that belong to the person, not the workspace: spend log, key fallback, browser profiles. */
export function userHome() {
  return process.env.STACKED_USER_HOME ? path.resolve(process.env.STACKED_USER_HOME) : path.join(os.homedir(), '.stacked-studio');
}

export function paths(ws = workspaceRoot(), user = userHome()) {
  const cache = path.join(ws, '.cache');
  return {
    workspace: ws,
    clients: path.join(ws, 'clients'),
    team: path.join(ws, 'team'),
    teamConfig: path.join(ws, 'team', 'team.yaml'),
    cache,
    media: path.join(cache, 'media'),
    index: path.join(cache, 'index.db'),
    skillsLock: path.join(cache, 'skills.lock.json'),
    setupState: path.join(cache, 'setup-state.json'),
    user,
    userConfig: path.join(user, 'config.json'),
    spend: path.join(user, 'spend.jsonl'),
    secrets: path.join(user, 'secrets.json'),
    profiles: path.join(user, 'profiles'),
  };
}

/** Shows paths under the home folder as ~/… so output never contains a username. */
export function displayPath(p) {
  const h = os.homedir();
  return p === h || p.startsWith(h + path.sep) ? '~' + p.slice(h.length) : p;
}

/** Finds a command on PATH without running a shell. Returns its full path or null. */
export function which(cmd) {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, cmd + ext);
      try {
        if (fs.statSync(full).isFile()) return full;
      } catch {}
    }
  }
  return null;
}

export function osName() {
  return { darwin: 'macOS', linux: 'Linux', win32: 'Windows' }[process.platform] ?? process.platform;
}

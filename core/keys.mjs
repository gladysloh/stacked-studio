import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { readJson, sha256, writeJsonAtomic } from './fsutil.mjs';
import { paths, which } from './paths.mjs';

// API keys and tokens live in the OS keychain (macOS Keychain, or libsecret on Linux). Where neither
// exists they go in ~/.stacked-studio/secrets.json with owner-only permissions. A key is never printed,
// logged or passed on a command line, and is only ever sent to its own service.
//
// Team billing: the team owner creates one key per teammate in the team's Google Cloud / fal account,
// so billing is shared but each key can be revoked on its own. `studio keys import` stores it here.

const SERVICE = 'stacked-studio';

export const SERVICES = {
  gemini: { label: 'Gemini', env: 'GEMINI_API_KEY', used_for: 'images, video (Veo), embeddings' },
  fal: { label: 'fal.ai', env: 'FAL_KEY', used_for: 'images, video, upscaling' },
  brave: { label: 'Brave Search', env: 'BRAVE_API_KEY', used_for: 'image search for references (optional)' },
  serpapi: { label: 'SerpAPI', env: 'SERPAPI_KEY', used_for: 'Google Images search for references (optional)' },
};

/** Secrets that aren't API keys a person types (e.g. the Google sign-in token). */
const INTERNAL = new Set(['google-oauth']);

export function keyBackend() {
  const forced = process.env.STACKED_KEYCHAIN;
  if (forced) return forced;
  if (process.platform === 'darwin' && which('security')) return 'macos';
  if (process.platform === 'linux' && which('secret-tool')) return 'libsecret';
  return 'file';
}

export function backendLabel(b = keyBackend()) {
  return { macos: 'macOS Keychain', libsecret: 'system keyring', file: 'private file in ~/.stacked-studio' }[b] ?? b;
}

function assertAccount(a) {
  if (!SERVICES[a] && !INTERNAL.has(a)) throw new Error(`Unknown service "${a}". Use one of: ${Object.keys(SERVICES).join(', ')}.`);
}

export function validKey(key) {
  return typeof key === 'string' && /^[A-Za-z0-9_\-.:]{8,512}$/.test(key);
}

const fileStore = () => readJson(paths().secrets, {});

function store(account, value) {
  const b = keyBackend();
  if (b === 'macos') {
    // Sent on stdin to `security -i`, so the value never appears in the process list.
    // Values are limited to a safe character set (see setSecret), so no quoting is needed.
    const r = spawnSync('security', ['-i'], { input: `add-generic-password -U -a ${account} -s ${SERVICE} -w ${value}\n`, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('Could not save to the macOS Keychain.');
  } else if (b === 'libsecret') {
    const r = spawnSync('secret-tool', ['store', `--label=stacked-studio ${account}`, 'service', SERVICE, 'account', account], { input: value, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('Could not save to the system keyring.');
  } else {
    const all = fileStore();
    all[account] = value;
    writeJsonAtomic(paths().secrets, all, 0o600);
  }
  return b;
}

function load(account) {
  const b = keyBackend();
  if (b === 'macos') {
    const r = spawnSync('security', ['find-generic-password', '-a', account, '-s', SERVICE, '-w'], { encoding: 'utf8' });
    return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
  }
  if (b === 'libsecret') {
    const r = spawnSync('secret-tool', ['lookup', 'service', SERVICE, 'account', account], { encoding: 'utf8' });
    return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
  }
  return fileStore()[account] ?? null;
}

function forget(account) {
  const b = keyBackend();
  if (b === 'macos') spawnSync('security', ['delete-generic-password', '-a', account, '-s', SERVICE], { encoding: 'utf8' });
  else if (b === 'libsecret') spawnSync('secret-tool', ['clear', 'service', SERVICE, 'account', account], { encoding: 'utf8' });
  else {
    const file = paths().secrets;
    const all = fileStore();
    delete all[account];
    if (Object.keys(all).length) writeJsonAtomic(file, all, 0o600);
    else fs.rmSync(file, { force: true });
  }
}

/** A short, non-reversible fingerprint so spend can be grouped per key without storing the key. */
export const fingerprint = (key) => sha256(key).slice(0, 8);

export function setKey(service, key, { label } = {}) {
  assertAccount(service);
  if (!validKey(key)) throw new Error('That does not look like an API key. Check that you copied the whole key.');
  const b = store(service, key);
  if (load(service) !== key) throw new Error('The key was not saved correctly. Try again.');
  const cfg = readJson(paths().userConfig, {}) ?? {};
  cfg.keys = { ...(cfg.keys ?? {}), [service]: { label: label ?? null, fingerprint: fingerprint(key), saved_at: new Date().toISOString() } };
  writeJsonAtomic(paths().userConfig, cfg);
  return b;
}

/** Returns { key, source, label, fingerprint } or null. An environment variable wins over a saved key. */
export function getKey(service) {
  assertAccount(service);
  const env = SERVICES[service] && process.env[SERVICES[service].env];
  const key = env || load(service);
  if (!key) return null;
  const meta = readJson(paths().userConfig, {})?.keys?.[service] ?? {};
  return { key, source: env ? 'environment' : 'saved', label: env ? 'environment' : meta.label ?? null, fingerprint: fingerprint(key) };
}

export function removeKey(service) {
  assertAccount(service);
  forget(service);
  const cfg = readJson(paths().userConfig, {}) ?? {};
  if (cfg.keys) delete cfg.keys[service];
  writeJsonAtomic(paths().userConfig, cfg);
}

// Internal secrets (JSON tokens) are base64url-encoded so they fit the keychain's safe character set.
export const setSecret = (account, value) => (assertAccount(account), store(account, Buffer.from(value).toString('base64url')));
export function getSecret(account) {
  assertAccount(account);
  const v = load(account);
  return v ? Buffer.from(v, 'base64url').toString('utf8') : null;
}
export const removeSecret = (account) => (assertAccount(account), forget(account));

/** Which services have a key. Never includes the keys themselves. */
export function keyStatus() {
  return Object.entries(SERVICES).map(([id, s]) => {
    const found = getKey(id);
    return { id, label: s.label, used_for: s.used_for, saved: Boolean(found), source: found?.source ?? null, key_label: found?.label ?? null, fingerprint: found?.fingerprint ?? null };
  });
}

/** Reads a secret without showing it: from a pipe, or from a hidden prompt in a terminal. */
export async function readSecret(promptText) {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    let data = '';
    for await (const chunk of stdin) data += chunk;
    return data.trim();
  }
  process.stderr.write(promptText);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const done = (err) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stderr.write('\n');
      err ? reject(err) : resolve(value.trim());
    };
    const onData = (chars) => {
      for (const ch of chars) {
        if (ch === '\r' || ch === '\n') return done();
        if (ch === '\u0003') return done(new Error('Cancelled.'));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

import crypto from 'node:crypto';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { teamConfig } from '../config.mjs';
import { StudioError } from '../errors.mjs';
import { getSecret, removeSecret, setSecret } from '../keys.mjs';

// Google sign-in for Drive, Slides and Sheets: the standard desktop-app flow (loopback redirect +
// PKCE). The sign-in client (client_id/secret of a "Desktop app" OAuth client, which Google treats
// as non-confidential) comes from the team pack; tokens are personal and live in the keychain.

export const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/presentations.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
];

const AUTH_URL = () => process.env.STACKED_GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = () => (process.env.STACKED_GOOGLE_BASE ? `${process.env.STACKED_GOOGLE_BASE}/token` : 'https://oauth2.googleapis.com/token');
const REVOKE_URL = () => (process.env.STACKED_GOOGLE_BASE ? `${process.env.STACKED_GOOGLE_BASE}/revoke` : 'https://oauth2.googleapis.com/revoke');

const SETUP_FIX = 'Your team pack needs google.client_id and google.client_secret (see docs/google-setup.md), then: studio team import <pack>';

export function oauthClient() {
  const g = teamConfig().google ?? {};
  const id = process.env.STACKED_GOOGLE_CLIENT_ID || g.client_id;
  const secret = process.env.STACKED_GOOGLE_CLIENT_SECRET || g.client_secret;
  if (!id) throw new StudioError('Google sign-in is not set up for this team yet.', SETUP_FIX);
  return { id, secret };
}

const loadToken = () => {
  const raw = getSecret('google-oauth');
  return raw ? JSON.parse(raw) : null;
};
const saveToken = (t) => setSecret('google-oauth', JSON.stringify(t));

function emailFrom(idToken) {
  try {
    return JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString()).email ?? null;
  } catch {
    return null;
  }
}

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL(), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params), signal: AbortSignal.timeout(30_000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (json.error === 'invalid_grant') throw new StudioError('Your Google sign-in has expired or was revoked.', 'studio connect google');
    throw new StudioError(`Google sign-in failed: ${json.error_description ?? json.error ?? res.status}`);
  }
  return json;
}

/** Exchanges the code from the browser redirect for tokens and stores them. */
export async function exchangeCode({ code, verifier, redirectUri }) {
  const c = oauthClient();
  const t = await tokenRequest({ code, code_verifier: verifier, redirect_uri: redirectUri, client_id: c.id, ...(c.secret ? { client_secret: c.secret } : {}), grant_type: 'authorization_code' });
  if (!t.refresh_token) throw new StudioError('Google did not return a long-lived sign-in.', 'Run `studio disconnect google`, then `studio connect google` again.');
  const token = { refresh_token: t.refresh_token, access_token: t.access_token, expires_at: Date.now() + (t.expires_in ?? 3600) * 1000, scope: t.scope, email: emailFrom(t.id_token ?? '') };
  saveToken(token);
  return { email: token.email, scopes: String(token.scope ?? '').split(' ') };
}

/** Opens the browser, waits for the redirect on 127.0.0.1, stores the tokens. */
export async function connect({ open = true, timeoutMs = 5 * 60_000, onUrl } = {}) {
  const c = oauthClient();
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('base64url');
  let finish;
  const done = new Promise((resolve, reject) => (finish = { resolve, reject }));
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/callback') return res.writeHead(404).end();
    const ok = url.searchParams.get('state') === state && url.searchParams.get('code');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(ok ? '<p style="font:16px system-ui;margin:40px">Signed in. You can close this tab and go back to the terminal.</p>' : '<p style="font:16px system-ui;margin:40px">Sign-in was cancelled.</p>');
    if (!ok) return finish.reject(new StudioError(url.searchParams.get('error') === 'access_denied' ? 'Google sign-in was cancelled.' : 'Google sign-in failed (state mismatch).'));
    try {
      finish.resolve(await exchangeCode({ code: url.searchParams.get('code'), verifier, redirectUri: `http://127.0.0.1:${server.address().port}/callback` }));
    } catch (err) {
      finish.reject(err);
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
  const authUrl = `${AUTH_URL()}?${new URLSearchParams({ client_id: c.id, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state })}`;
  onUrl?.(authUrl);
  if (open) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    try {
      spawn(opener, [authUrl], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
    } catch {}
  }
  const timer = setTimeout(() => finish.reject(new StudioError('Timed out waiting for Google sign-in.', 'studio connect google')), timeoutMs);
  try {
    return await done;
  } finally {
    clearTimeout(timer);
    server.close();
  }
}

/** A fresh access token, refreshed when it's about to expire. */
export async function accessToken() {
  const t = loadToken();
  if (!t) throw new StudioError('Google is not connected.', 'In a terminal: studio connect google');
  if (t.access_token && t.expires_at > Date.now() + 60_000) return t.access_token;
  const c = oauthClient();
  const r = await tokenRequest({ refresh_token: t.refresh_token, client_id: c.id, ...(c.secret ? { client_secret: c.secret } : {}), grant_type: 'refresh_token' });
  saveToken({ ...t, access_token: r.access_token, expires_at: Date.now() + (r.expires_in ?? 3600) * 1000 });
  return r.access_token;
}

export function googleStatus() {
  const t = loadToken();
  let configured = true;
  try {
    oauthClient();
  } catch {
    configured = false;
  }
  return { configured, connected: Boolean(t), email: t?.email ?? null };
}

export async function disconnect() {
  const t = loadToken();
  if (t?.refresh_token) {
    try {
      await fetch(REVOKE_URL(), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: t.refresh_token }) });
    } catch {}
  }
  removeSecret('google-oauth');
}

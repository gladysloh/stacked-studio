import { StudioError } from '../errors.mjs';
import { accessToken } from './auth.mjs';

// One fetch wrapper for every Google API: auth header, a short retry on rate limits and server
// errors (reads only — uploads are never retried, so nothing is saved twice), plain error messages.

export const hosts = () => ({
  drive: `${process.env.STACKED_GOOGLE_BASE || 'https://www.googleapis.com'}/drive/v3`,
  upload: `${process.env.STACKED_GOOGLE_BASE || 'https://www.googleapis.com'}/upload/drive/v3`,
  slides: `${process.env.STACKED_GOOGLE_BASE || 'https://slides.googleapis.com'}/v1`,
  sheets: `${process.env.STACKED_GOOGLE_BASE || 'https://sheets.googleapis.com'}/v4`,
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function gfetch(url, { method = 'GET', headers = {}, body, raw = false, retry = method === 'GET' } = {}) {
  for (let attempt = 0; ; attempt++) {
    const token = await accessToken();
    let res;
    try {
      res = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, ...headers }, body, signal: AbortSignal.timeout(120_000) });
    } catch (err) {
      throw new StudioError(`Couldn't reach Google (${err.name === 'TimeoutError' ? 'timed out' : 'network error'}).`);
    }
    if ((res.status === 429 || res.status >= 500) && retry && attempt < 2) {
      await wait(500 * 2 ** attempt);
      continue;
    }
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      const msg = json?.error?.message ?? res.statusText;
      if (res.status === 401) throw new StudioError('Google sign-in is no longer valid.', 'studio connect google');
      if (res.status === 403 && /insufficient|scope/i.test(msg)) throw new StudioError('The Google sign-in is missing a permission.', 'studio disconnect google && studio connect google');
      if (res.status === 403) throw new StudioError(`Google says you don't have access: ${msg}`, 'Ask the owner to share the folder or Shared Drive with your Google account.');
      if (res.status === 404) throw new StudioError("Google can't find that file, or you don't have access to it.", 'Check the link, and that it is shared with your Google account.');
      throw new StudioError(`Google error ${res.status}: ${String(msg).slice(0, 200)}`);
    }
    if (raw) return res;
    return res.status === 204 ? null : res.json();
  }
}

/** Accepts a URL from Drive, Docs, Slides or Sheets, or a bare id. */
export function fileId(ref) {
  const s = String(ref ?? '').trim();
  const m = s.match(/\/(?:d|folders)\/([A-Za-z0-9_-]{10,})/) ?? s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(s)) return s;
  throw new StudioError(`"${s.slice(0, 80)}" isn't a Google file link or id.`);
}

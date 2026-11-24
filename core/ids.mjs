import crypto from 'node:crypto';

// Time-sortable ids (ULID-style, Crockford base32). Two teammates working offline never collide,
// and sorting ids sorts by creation time.
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newId(prefix = '', now = Date.now()) {
  let t = '';
  let n = now;
  for (let i = 0; i < 10; i++) {
    t = ALPHA[n % 32] + t;
    n = Math.floor(n / 32);
  }
  const rand = crypto.randomBytes(10);
  let r = '';
  for (let i = 0; i < 16; i++) r += ALPHA[rand[i % 10] >> (i < 10 ? 3 : 0) & 31];
  return (prefix ? prefix + '_' : '') + t + r;
}

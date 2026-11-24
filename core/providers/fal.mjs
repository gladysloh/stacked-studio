// fal.ai: hosted image models (including Nano Banana), upscalers and video models, over plain HTTPS.
// Endpoint ids and prices change often: they live in this table only. Prices are estimates per output
// (checked November 2026) and only feed the daily cap — fal's own billing is the real number.

export const id = 'fal';
export const label = 'fal.ai';
export const keyService = 'fal';
export const kinds = ['image', 'upscale'];

export const MODELS = {
  'nano-banana': { label: 'Nano Banana (fal)', text: 'fal-ai/nano-banana', edit: 'fal-ai/nano-banana/edit', price: 0.039, refs: 10 },
  'nano-banana-pro': { label: 'Nano Banana Pro (fal)', text: 'fal-ai/nano-banana-pro', edit: 'fal-ai/nano-banana-pro/edit', price: 0.15, refs: 14 },
};
export const DEFAULT_MODEL = 'nano-banana';
export const UPSCALERS = {
  clarity: { label: 'Clarity upscaler', endpoint: 'fal-ai/clarity-upscaler', price: 0.03 },
};
export const ASPECTS = ['1:1', '4:5', '5:4', '3:4', '4:3', '2:3', '3:2', '9:16', '16:9', '21:9'];

const base = () => process.env.STACKED_FAL_BASE || 'https://fal.run';
const dataUri = (r) => `data:${r.mime};base64,${r.data.toString('base64')}`;

async function call(key, endpoint, body, timeout = 180_000) {
  let res;
  try {
    res = await fetch(`${base()}/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Key ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    throw new Error(`Couldn't reach fal.ai (${err.name === 'TimeoutError' ? 'timed out' : 'network error'}).`);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof json.detail === 'string' ? json.detail : JSON.stringify(json.detail ?? json).slice(0, 200);
    if (res.status === 401 || res.status === 403) throw new Error('fal.ai refused the key. Check it with: studio keys set fal');
    if (res.status === 402 || /balance|credit/i.test(msg)) throw new Error('fal.ai says the account has no credit left, so nothing was made. Top up at https://fal.ai/dashboard/billing.');
    throw new Error(`fal.ai error ${res.status}: ${msg}`);
  }
  return json;
}

async function download(url) {
  if (url.startsWith('data:')) {
    const [, mime, b64] = url.match(/^data:([^;]+);base64,(.*)$/) ?? [];
    return { data: Buffer.from(b64, 'base64'), mime };
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Couldn't download the result from fal.ai (${res.status}).`);
  return { data: Buffer.from(await res.arrayBuffer()), mime: (res.headers.get('content-type') || 'image/png').split(';')[0] };
}

export const estimate = ({ model = DEFAULT_MODEL, n = 1 }) => (MODELS[model]?.price ?? 0.05) * n;

export async function image({ key, prompt, n = 1, model = DEFAULT_MODEL, aspect = '4:5', references = [] }) {
  const m = MODELS[model];
  if (!m) throw new Error(`Unknown fal model "${model}". Use one of: ${Object.keys(MODELS).join(', ')}.`);
  if (references.length > m.refs) throw new Error(`${m.label} takes up to ${m.refs} reference images.`);
  const body = { prompt, num_images: n, aspect_ratio: aspect, output_format: 'png' };
  const endpoint = references.length ? m.edit : m.text;
  if (references.length) body.image_urls = references.map(dataUri);
  const json = await call(key, endpoint, body);
  const images = await Promise.all((json.images ?? []).map((i) => download(i.url)));
  if (!images.length) throw new Error('fal.ai returned no image.');
  return { images, failures: [], cost_usd: Number((m.price * images.length).toFixed(4)) };
}

export async function upscale({ key, source, factor = 2, model = 'clarity' }) {
  const u = UPSCALERS[model];
  if (!u) throw new Error(`Unknown upscaler "${model}".`);
  const json = await call(key, u.endpoint, { image_url: dataUri(source), upscale_factor: factor });
  const url = json.image?.url ?? json.images?.[0]?.url;
  if (!url) throw new Error('fal.ai returned no image.');
  return { images: [await download(url)], failures: [], cost_usd: u.price };
}

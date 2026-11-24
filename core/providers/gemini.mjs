// Gemini: image models ("Nano Banana"), text embeddings. Plain HTTPS with the person's own key.
// Prices are per image, from https://ai.google.dev/gemini-api/docs/pricing (standard tier,
// checked October 2026). Check them again before relying on them.

export const id = 'gemini';
export const label = 'Gemini';
export const keyService = 'gemini';
export const kinds = ['image', 'upscale', 'embed'];

// Reference image limits per model, from https://ai.google.dev/gemini-api/docs/image-generation
// (checked November 2026): 14 in total, split by kind. "style: null" means the model has no
// separate style slot, so style images count as objects.
export const MODELS = {
  'gemini-3.1-flash-image': { label: 'Nano Banana 2', price: { '1K': 0.067, '2K': 0.101, '4K': 0.151 }, refs: { total: 14, objects: 10, people: 4, style: null } },
  'gemini-3-pro-image': { label: 'Nano Banana Pro', price: { '1K': 0.134, '2K': 0.134, '4K': 0.24 }, refs: { total: 14, objects: 6, people: 5, style: 3 } },
};
export const DEFAULT_MODEL = 'gemini-3.1-flash-image';
export const SIZES = ['1K', '2K', '4K'];
export const ASPECTS = ['1:1', '4:5', '5:4', '3:4', '4:3', '2:3', '3:2', '9:16', '16:9', '21:9'];
export const MAX_REFERENCES = 14;
export const maxReferences = (model) => MODELS[model]?.refs.total ?? MAX_REFERENCES;

// Added at render time, not stored in the prompt, so a new version never gets it twice.
// Copy goes on later in layout.
export const NO_TEXT_LINE =
  'No added text, headlines, captions, badges, logos or graphic overlays anywhere in the image. The only text visible is what is printed on the product packaging.';

const base = () => process.env.STACKED_GEMINI_BASE || 'https://generativelanguage.googleapis.com';

export function price(model, size) {
  const p = MODELS[model]?.price?.[size];
  if (p === undefined) throw new Error(`No price for ${model} at ${size}, so it can't be used yet.`);
  return p;
}

async function renderOnce({ key, model, prompt, size, aspect, references, noText }) {
  const body = {
    contents: [
      {
        role: 'user',
        parts: [...references.map((r) => ({ inlineData: { mimeType: r.mime, data: r.data.toString('base64') } })), { text: noText ? `${prompt}\n\n${NO_TEXT_LINE}` : prompt }],
      },
    ],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect, imageSize: size } },
  };
  let res;
  try {
    res = await fetch(`${base()}/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    throw new Error(`Couldn't reach Gemini (${err.name === 'TimeoutError' ? 'timed out' : 'network error'}).`);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || res.statusText;
    if (res.status === 400 && /api key/i.test(msg)) throw new Error('Gemini refused the key. Check it with: studio keys set gemini');
    if (/billing account|outstanding balance/i.test(msg) && !/spending cap/i.test(msg)) {
      throw new Error('Google says the billing account for your Gemini key has a problem (usually an unpaid balance or a declined card), so nothing was made or charged. Fix it at https://console.cloud.google.com/billing, then try again.');
    }
    if (res.status === 429) {
      // A limit of 0 means this key's Google project can't make images at all (usually: no billing).
      if (/spending cap/i.test(msg)) {
        throw new Error('Your Google billing account has reached its monthly spending cap, so Gemini made nothing (nothing was charged). Raise the cap at https://ai.studio/billing, then try again.');
      }
      if (/limit:\s*0\b|free_tier/i.test(msg)) {
        throw new Error('Gemini says this key has no quota for image generation. In Google AI Studio, turn on billing for the key\'s project, then try again.');
      }
      throw new Error(`Gemini rate limit or quota reached: ${String(msg).slice(0, 240)}`);
    }
    throw new Error(`Gemini error ${res.status}: ${String(msg).slice(0, 200)}`);
  }
  const cand = json.candidates?.[0];
  const part = cand?.content?.parts?.find((p) => p.inlineData || p.inline_data);
  const inline = part?.inlineData || part?.inline_data;
  if (!inline?.data) {
    const reason = cand?.finishReason || json.promptFeedback?.blockReason || 'unknown';
    throw new Error(`Gemini returned no image (reason: ${reason}).`);
  }
  const mime = inline.mimeType || inline.mime_type || 'image/png';
  return { data: Buffer.from(inline.data, 'base64'), mime, ext: mime === 'image/jpeg' ? '.jpg' : mime === 'image/webp' ? '.webp' : '.png' };
}

/**
 * One call per variation. A failed variation doesn't sink the others; if every one fails, this
 * throws. Never retries by itself, so a failure never costs twice. For an edit, the source image is
 * simply the first reference and the prompt says what to change.
 */
export async function image({ key, prompt, n = 1, model = DEFAULT_MODEL, size = '1K', aspect = '4:5', references = [], noText = true }) {
  if (!MODELS[model]) throw new Error(`Unknown Gemini model "${model}". Use one of: ${Object.keys(MODELS).join(', ')}.`);
  if (!SIZES.includes(size)) throw new Error(`Size must be one of ${SIZES.join(', ')}.`);
  if (!ASPECTS.includes(aspect)) throw new Error(`Format must be one of ${ASPECTS.join(', ')}.`);
  if (references.length > maxReferences(model)) throw new Error(`${MODELS[model].label} takes up to ${maxReferences(model)} reference images. ${references.length} were given.`);
  const unit = price(model, size);
  const results = await Promise.allSettled(Array.from({ length: n }, () => renderOnce({ key, model, prompt, size, aspect, references, noText })));
  const images = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const failures = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
  if (!images.length) {
    const err = new Error(failures[0]);
    err.failures = failures;
    throw err;
  }
  return { images, failures, cost_usd: Number((unit * images.length).toFixed(4)) };
}

export const estimate = ({ model = DEFAULT_MODEL, size = '1K', n = 1 }) => price(model, size) * n;

// Text embeddings for local search. Price is small enough to ignore in the daily cap.
export const EMBED_MODEL = 'gemini-embedding-001';
export async function embed({ key, texts, dims = 768 }) {
  const out = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const res = await fetch(`${base()}/v1beta/models/${EMBED_MODEL}:batchEmbedContents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ requests: batch.map((t) => ({ model: `models/${EMBED_MODEL}`, content: { parts: [{ text: t }] }, outputDimensionality: dims })) }),
      signal: AbortSignal.timeout(60_000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Gemini embeddings error ${res.status}: ${String(json?.error?.message ?? res.statusText).slice(0, 200)}`);
    out.push(...json.embeddings.map((e) => e.values));
  }
  return out;
}

// Upscale by re-rendering at 4K with Nano Banana Pro, holding everything else fixed.
export const UPSCALE_PROMPT =
  'Reproduce this exact image at higher resolution. Keep composition, framing, colours, lighting, product shape, label text and every detail identical. Only add natural fine detail and sharpness. Do not add, remove or move anything.';
export async function upscale({ key, source, aspect = '4:5' }) {
  return image({ key, prompt: UPSCALE_PROMPT, n: 1, model: 'gemini-3-pro-image', size: '4K', aspect, references: [source], noText: false });
}

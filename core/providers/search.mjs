import { StudioError } from '../errors.mjs';
import { getKey } from '../keys.mjs';

// Optional image-search providers for reference research. Without a key, agents use their own
// web and browser tools instead. Each returns [{ title, page_url, image_url, thumb_url, source, width, height }].

const BRAVE = () => process.env.STACKED_BRAVE_BASE || 'https://api.search.brave.com';
const SERP = () => process.env.STACKED_SERPAPI_BASE || 'https://serpapi.com';

async function getJson(url, headers = {}) {
  let res;
  try {
    res = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new StudioError("Couldn't reach the image search service.");
  }
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) throw new StudioError('The image search service refused the key.', 'Check it: studio keys set brave (or serpapi)');
  if (res.status === 429) throw new StudioError('Image search rate limit or monthly quota reached.');
  if (!res.ok) throw new StudioError(`Image search error ${res.status}.`);
  return json;
}

export const SEARCH_PROVIDERS = {
  brave: {
    label: 'Brave Search',
    async images({ key, query, count }) {
      const j = await getJson(`${BRAVE()}/res/v1/images/search?${new URLSearchParams({ q: query, count: String(Math.min(count, 100)), safesearch: 'strict' })}`, { 'x-subscription-token': key });
      return (j.results ?? []).map((r) => ({ title: r.title ?? null, page_url: r.url ?? null, image_url: r.properties?.url ?? null, thumb_url: r.thumbnail?.src ?? null, source: r.source ?? null, width: r.properties?.width ?? null, height: r.properties?.height ?? null }));
    },
  },
  serpapi: {
    label: 'SerpAPI (Google Images)',
    async images({ key, query, count }) {
      const j = await getJson(`${SERP()}/search.json?${new URLSearchParams({ engine: 'google_images', q: query, api_key: key, safe: 'active' })}`);
      return (j.images_results ?? []).slice(0, count).map((r) => ({ title: r.title ?? null, page_url: r.link ?? null, image_url: r.original ?? null, thumb_url: r.thumbnail ?? null, source: r.source ?? null, width: r.original_width ?? null, height: r.original_height ?? null }));
    },
  },
};

export function searchProvider(requested) {
  const order = requested ? [requested] : ['brave', 'serpapi'];
  for (const id of order) {
    if (!SEARCH_PROVIDERS[id]) throw new StudioError(`Unknown image search "${id}". Use brave or serpapi.`);
    const k = getKey(id);
    if (k) return { id, ...SEARCH_PROVIDERS[id], key: k.key };
  }
  return null;
}

export async function imageSearch({ query, count = 20, provider }) {
  const p = searchProvider(provider);
  if (!p) {
    throw new StudioError(
      'No image search key is set, so search with your own tools instead.',
      'Use your web search or browser on the planned queries and pass image links to moodboard_save. For faster boards, the person can add a key: studio keys set brave (or serpapi).'
    );
  }
  const results = (await p.images({ key: p.key, query, count })).filter((r) => r.image_url);
  return { provider: p.id, query, results };
}

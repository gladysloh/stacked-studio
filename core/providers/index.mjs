import { StudioError } from '../errors.mjs';
import { getKey } from '../keys.mjs';
import { settings } from '../config.mjs';
import * as fal from './fal.mjs';
import * as gemini from './gemini.mjs';
import * as mock from './mock.mjs';

// Every model call goes through here. To add a provider: write a module with
// { id, label, keyService, kinds, MODELS, DEFAULT_MODEL, estimate, image?, upscale?, video?, embed? }
// and add it to this list. Nothing else in the studio needs to change.

export const PROVIDERS = { gemini, fal, test: mock };

export function listProviders() {
  return Object.values(PROVIDERS).map((p) => ({
    id: p.id,
    label: p.label,
    kinds: p.kinds,
    models: Object.entries(p.MODELS ?? {}).map(([id, m]) => ({ id, label: m.label })),
    ready: !p.keyService || Boolean(getKey(p.keyService)),
  }));
}

/**
 * Picks a provider for a kind of work. An explicit choice must have its key; otherwise the
 * configured default, then the first provider with a key, then the free test provider.
 */
export function pickProvider(kind, requested) {
  const want = requested ?? settings()[`${kind}_provider`] ?? null;
  if (want) {
    const p = PROVIDERS[want];
    if (!p) throw new StudioError(`Unknown provider "${want}". Use one of: ${Object.keys(PROVIDERS).join(', ')}.`);
    if (!p.kinds.includes(kind)) throw new StudioError(`${p.label} can't do ${kind}.`);
    if (!p.keyService) return { provider: p };
    const k = getKey(p.keyService);
    if (!k) throw new StudioError(`No ${p.label} key is saved yet.`, `In a terminal: studio keys set ${p.keyService}`);
    return { provider: p, key: k.key, fingerprint: k.fingerprint };
  }
  for (const p of [gemini, fal]) {
    if (!p.kinds.includes(kind)) continue;
    const k = getKey(p.keyService);
    if (k) return { provider: p, key: k.key, fingerprint: k.fingerprint };
  }
  return { provider: mock };
}

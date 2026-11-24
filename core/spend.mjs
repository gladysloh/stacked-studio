import { appendJsonl, readJsonl } from './fsutil.mjs';
import { paths } from './paths.mjs';
import { settings } from './config.mjs';
import { StudioError } from './errors.mjs';

// A local spend log per person (~/.stacked-studio/spend.jsonl): one line per paid call, with the
// key's fingerprint, so spend can be shown per key and per day. Billing itself is the provider's.

export function spentToday(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return readJsonl(paths().spend)
    .filter((e) => new Date(e.at) >= start)
    .reduce((s, e) => s + (e.cost_usd || 0), 0);
}

export function checkBudget(estimate) {
  const cap = settings().daily_cap_usd;
  const spent = spentToday();
  if (estimate > 0 && spent + estimate > cap + 1e-9) {
    throw new StudioError(
      `This would go over today's limit of $${cap.toFixed(2)} ($${spent.toFixed(2)} spent, about $${estimate.toFixed(2)} for this).`,
      'Raise it with: studio config daily_cap_usd 10   (or try again tomorrow)'
    );
  }
  return { cap, spent };
}

export function recordSpend({ provider, model, cost_usd, fingerprint, record_id }) {
  if (!cost_usd) return;
  appendJsonl(paths().spend, { at: new Date().toISOString(), provider, model, cost_usd, key: fingerprint ?? null, record: record_id ?? null });
}

export function spendSummary(days = 30) {
  const since = Date.now() - days * 864e5;
  const byDay = {};
  const byKey = {};
  for (const e of readJsonl(paths().spend)) {
    if (new Date(e.at).getTime() < since) continue;
    const d = e.at.slice(0, 10);
    byDay[d] = (byDay[d] ?? 0) + e.cost_usd;
    const k = `${e.provider}:${e.key ?? '?'}`;
    byKey[k] = (byKey[k] ?? 0) + e.cost_usd;
  }
  return { today: spentToday(), cap: settings().daily_cap_usd, by_day: byDay, by_key: byKey };
}

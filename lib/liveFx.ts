/**
 * Live market FX — USD / CNY (RMB) / EUR → IDR, from open.er-api.com (free,
 * keyless; the upstream refreshes daily). Fetched from the BROWSER — the app
 * has no FX backend — cached in localStorage so the tab paints instantly on
 * revisit, and re-fetched automatically once the cache is over an hour old.
 * A failed fetch falls back to the cached snapshot: a stale reference rate
 * beats none, and the "updated" stamp says how stale it is.
 *
 * This is a REFERENCE rate for sanity-checking supplier implied rates and
 * pricing new POs — not a trading feed.
 */

export interface LiveFxSnapshot {
  /** IDR per 1 unit of each currency. */
  rates: Record<string, number>;
  /** When the upstream provider last refreshed its rates (ISO). */
  providerUpdatedAt: string;
  /** When this browser fetched it (ISO) — drives the staleness clock. */
  fetchedAt: string;
}

const CACHE_KEY = 'icaproc_live_fx';
const MAX_AGE_MS = 60 * 60 * 1000;

/** CNY is displayed as RMB to match how supplier quotes name it. */
export const LIVE_FX_CURRENCIES = ['USD', 'CNY', 'EUR'] as const;

function readCache(): LiveFxSnapshot | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LiveFxSnapshot;
    return parsed?.rates && parsed.fetchedAt ? parsed : null;
  } catch {
    return null;
  }
}

function isFresh(snap: LiveFxSnapshot | null): snap is LiveFxSnapshot {
  return !!snap && Date.now() - new Date(snap.fetchedAt).getTime() < MAX_AGE_MS;
}

export async function fetchLiveFx(force = false): Promise<LiveFxSnapshot | null> {
  const cached = typeof window === 'undefined' ? null : readCache();
  if (!force && isFresh(cached)) return cached;
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const r = data?.rates as Record<string, number> | undefined;
    const idr = Number(r?.IDR);
    if (!idr || idr <= 0) throw new Error('no IDR rate');
    const rates: Record<string, number> = { USD: idr };
    for (const c of LIVE_FX_CURRENCIES) {
      if (c === 'USD') continue;
      const v = Number(r?.[c]);
      if (v > 0) rates[c] = idr / v; // cross rate: IDR per 1 unit of c
    }
    const snap: LiveFxSnapshot = {
      rates,
      providerUpdatedAt: data.time_last_update_utc
        ? new Date(data.time_last_update_utc).toISOString()
        : new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
    };
    try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(snap)); } catch { /* private mode */ }
    return snap;
  } catch {
    return cached; // stale beats nothing; the stamp shows the age
  }
}

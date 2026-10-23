/**
 * The morning check against KlikBCA e-Rate (owner, 2026-10-24): "use BCA
 * e-Rate, warn above 1.5% … round up to the nearest hundreds digit — if the
 * USD e-rate is 18.128, use 18.200, if CNY / CNH is 2.745 use 2.800. Check
 * daily every morning. and update itself." And: "this is supposed to be
 * KlikBCA e-Rate not TT Counter".
 *
 * The reference is the e-Rate SELL ("Jual") — what BCA charges us for the
 * currency we pay suppliers in. BCA quotes the yuan as CNH; it is our CNY.
 *
 * Pure: the page is fetched by /api/cron/fx-benchmark and handed in as text.
 */

/** Our benchmark currency → BCA's code for it. */
export const BCA_CODES: Record<string, string> = { USD: 'USD', CNY: 'CNH' };
/** The company rate follows the e-Rate once they are this far apart. */
export const FOLLOW_PCT = 1.5;
/**
 * What a parsed figure must look like before anything is written: a misread
 * page must never become the company rate.
 */
export const SANE: Record<string, [number, number]> = { USD: [10_000, 30_000], CNY: [1_000, 5_000] };

export interface BcaQuote { buy: number | null; sell: number }
export interface BcaPage { quotedAt: string; rates: Record<string, BcaQuote> }

/** "18.128,00" (BCA's Indonesian format) → 18128. */
export const idNumber = (s: string): number => Number(s.replace(/\./g, '').replace(',', '.'));
const NUM = /\d{1,3}(?:\.\d{3})*,\d{2}/g;

/**
 * KlikBCA's rate table, read for the e-Rate columns.
 *
 * Each currency is a table row (`<tr code="USD">`), and each figure carries a
 * `rate-type` such as `eRate-sell`. Read by that attribute first; if BCA ever
 * drops it, the row's figures in column order (e-Rate buy, e-Rate sell, TT
 * buy, TT sell, Bank Notes buy, Bank Notes sell) still answer — the e-Rate
 * is always the first pair.
 */
export function parseBcaKurs(html: string): BcaPage {
  const rates: Record<string, BcaQuote> = {};
  for (const [ours, code] of Object.entries(BCA_CODES)) {
    const row = rowFor(html, code);
    if (!row) continue;
    const attr = (side: 'buy' | 'sell') => {
      const m = new RegExp(`rate-type="\\s*e-?rate[-_ ]?${side}\\s*"[^>]*>\\s*([\\d.,]+)`, 'i').exec(row);
      return m ? idNumber(m[1]) : null;
    };
    let buy = attr('buy');
    let sell = attr('sell');
    if (sell == null) {
      const [b0, s0] = row.match(NUM) ?? [];
      if (b0 && s0) { buy = idNumber(b0); sell = idNumber(s0); }
    }
    if (sell != null && sell > 0) rates[ours] = { buy: buy && buy > 0 ? buy : null, sell };
  }
  // "23 Okt 2026 / 15:40 WIB" — the e-Rate's own update stamp, the first on the page.
  const stamp = /(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\s*\/\s*\d{1,2}[.:]\d{2}\s*WIB)/.exec(html.replace(/<[^>]+>/g, ' '));
  return { quotedAt: stamp ? stamp[1].replace(/\s+/g, ' ').trim() : '', rates };
}

/** The HTML of the table row for one currency code. */
function rowFor(html: string, code: string): string | null {
  const byAttr = new RegExp(`<tr[^>]*code="${code}"[^>]*>([\\s\\S]*?)</tr>`, 'i').exec(html);
  if (byAttr) return byAttr[1];
  // No `code` attribute: the row whose first cell names the currency.
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const text = m[1].replace(/<[^>]+>/g, ' ');
    if (new RegExp(`^\\s*${code}\\b`).test(text)) return m[1];
  }
  return null;
}

/** Up to the next hundred: 18,128 → 18,200; 2,745 → 2,800; 2,800 stays. */
export const roundUpToHundred = (n: number): number => Math.ceil(Math.round(n * 100) / 100 / 100) * 100;

export interface FollowDecision {
  currency: string;
  sell: number;
  target: number;
  current: number | null;
  /** Target against the current company rate, in percent. */
  changePct: number | null;
  update: boolean;
  /** Why nothing was written, when nothing was. */
  reason: 'no-rate-yet' | 'moved' | 'within' | 'insane';
}

/**
 * Should the company rate follow this morning's e-Rate?
 *
 * Only when it has moved more than 1.5% (either way) from the rate in force,
 * or when there is no rate yet. Inside that band the rate stays put, so the
 * company rate does not twitch every morning and POs a day apart are planned
 * at the same figure.
 */
export function decideFollow(currency: string, sell: number, current: number | null): FollowDecision {
  const target = roundUpToHundred(sell);
  const [lo, hi] = SANE[currency] ?? [0, Infinity];
  if (!(sell >= lo && sell <= hi)) return { currency, sell, target, current, changePct: null, update: false, reason: 'insane' };
  if (!current) return { currency, sell, target, current, changePct: null, update: true, reason: 'no-rate-yet' };
  const changePct = (target / current - 1) * 100;
  const update = Math.abs(changePct) > FOLLOW_PCT;
  return { currency, sell, target, current, changePct, update, reason: update ? 'moved' : 'within' };
}

/**
 * What is still owed on a deal — in the currency the supplier is actually owed.
 *
 * OWNER, 2026-09-22: *"for the deals in deal lookup, it will be helpful for the
 * procurement and finance team to see the remaining balance to be paid so they
 * know how much to transfer without calculating manually."*
 *
 * ── WHY THE EXISTING `outstandingIdr` DID NOT ANSWER THIS ────────────────────
 *
 * Deal Lookup already shows an outstanding figure, in rupiah, at the rate the
 * PO was booked at. That is the right number for "what do we still owe, in our
 * books". It is the wrong number for "what do I type into the transfer", for
 * two reasons, and the team was doing both conversions by hand:
 *
 *   1. **The obligation is in units of the supplier's currency.** PIO-2026017
 *      owes CNY 81,060 whatever the rupiah does; the supplier does not care
 *      what rate we booked. Rupiah at a months-old rate is not the amount to
 *      send, and it is not even a good estimate of what the transfer will cost.
 *   2. **A payment recorded in rupiah made the foreign figure vanish.** The
 *      old tracking only counted payments recorded in the PO's own currency
 *      (`foreignPaid`), so PIO-2026012 — a USD 60,765 order paid with an
 *      IDR 325,314,350 transfer — showed no foreign progress at all. The
 *      payment carries its own rate (17,845), so the USD it bought is knowable
 *      exactly: 18,230. This module converts back instead of giving up.
 *
 * ── AND WHY IT REPORTS AN OVERPAYMENT RATHER THAN HIDING IT ──────────────────
 *
 * PIO-013-ISL-07-2026 is a USD 216 order against an IDR 5,652,000 payment at
 * 18,000 — USD 314, which is USD 98 more than the order. Clamping that to
 * "nothing outstanding" is the polite lie; either the PO total is wrong or the
 * transfer was, and both are worth somebody's minute. So `remaining` clamps at
 * zero (you cannot transfer a negative amount) and `overpaid` carries the rest.
 *
 * Pure, and everything it needs is an argument — the display sites cannot grow
 * a second opinion about what is still owed.
 */
// Relative, not `@/`: this module is imported by a node:test file, and
// node --test resolves no tsconfig path alias. `lib/computeTUC.ts` and
// `lib/exchangeRates.ts` import it the same way, for the same reason.
import { PRINCIPAL_CATS } from '../constants/costCategories.ts';

export interface BalancePo {
  po_id: string | number;
  po_number?: string | null;
  currency?: string | null;
  total_value?: number | string | null;
  exchange_rate?: number | string | null;
  status?: string | null;
}

export interface BalanceCost {
  po_id: string | number;
  cost_category: string;
  currency?: string | null;
  amount?: number | string | null;
  exchange_rate?: number | string | null;
}

export interface PoBalance {
  poId: string;
  poNumber: string | null;
  currency: string;
  total: number;
  paid: number;
  /** What to transfer. Never negative — you cannot send a negative amount. */
  remaining: number;
  /** Paid beyond the order, if any. Reported, never folded away. */
  overpaid: number;
  settled: boolean;
  /** A payment was recorded in another currency and converted back. */
  derived: boolean;
  /** …and at least one of those conversions had no rate of its own to use. */
  assumedRate: boolean;
  /** The rupiah this would cost today, and the rate that says so. */
  idr: number | null;
  idrRate: number | null;
  idrSource: 'live' | 'po' | null;
  /** The PO's booked rate disagrees with the market by more than 3×. */
  rateSuspect: boolean;
}

export interface DealBalance {
  /** One line per currency owed — a deal can hold a CNY PO and a USD PO. */
  lines: { currency: string; total: number; paid: number; remaining: number }[];
  /** Every remaining line converted to rupiah, when a rate could be had. */
  idr: number | null;
  idrSource: 'live' | 'po' | 'mixed' | null;
  /** The rate behind `idr` — only when ONE rate was used, so it can be named. */
  idrRate: number | null;
  anyDerived: boolean;
  anyAssumedRate: boolean;
  anySuspectRate: boolean;
  /** Nothing left to transfer on any active PO. */
  settled: boolean;
  overpaid: { currency: string; amount: number }[];
  perPo: PoBalance[];
}

/** A superseded or abandoned order is not a bill. */
export const VOID_PO_STATUS = new Set(['Replaced', 'Cancelled']);

/**
 * Principal only. Bank fees, duty, VAT and freight are real money, but they are
 * not what this supplier is owed on this order, and a transfer sized to include
 * them would be wrong. `overpayment_credit` is excluded to match every other
 * payment total in the app — one opinion about what "paid" means, not two.
 */
export const isPrincipal = (c: BalanceCost): boolean =>
  PRINCIPAL_CATS.has(c.cost_category) && c.cost_category !== 'overpayment_credit';

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Off by more than this from the market and the booked rate is not credible. */
export const RATE_SUSPECT_FACTOR = 3;

/**
 * Converted figures cannot land on the cent: a payment recorded in rupiah is
 * divided by a rate stored to six decimals, so an order settled to the last
 * rupiah still shows a fraction of a dollar outstanding. An exact payment gets
 * an exact tolerance; a derived one gets a tenth of a percent.
 */
export const settledTolerance = (total: number, derived: boolean): number =>
  derived ? Math.max(1, Math.abs(total) * 0.001) : 0.01;

export function poBalance(
  po: BalancePo,
  costs: BalanceCost[],
  opts: { liveRates?: Record<string, number> | null } = {},
): PoBalance {
  const currency = (po.currency || 'IDR').toUpperCase();
  const poRate = n(po.exchange_rate) || null;
  const total = n(po.total_value);
  const live = opts.liveRates?.[currency] ?? null;

  const mine = costs.filter((c) => String(c.po_id) === String(po.po_id) && isPrincipal(c));

  let paid = 0;
  let derived = false;
  let assumedRate = false;

  for (const c of mine) {
    const amt = n(c.amount);
    const ccy = (c.currency || 'IDR').toUpperCase();
    if (ccy === currency) { paid += amt; continue; }
    derived = true;
    // The payment's OWN rate is the rate that transfer actually got. The PO's
    // rate is a fallback, and most rows have no rate of their own — 60 of the
    // 77 balance payments in production — so this branch is the common one and
    // the reason `assumedRate` exists to say the figure is approximate.
    const rate = n(c.exchange_rate) || poRate;
    if (!n(c.exchange_rate)) assumedRate = true;
    if (!rate) continue;                       // unconvertible; counted as unpaid
    if (ccy === 'IDR') paid += amt / rate;     // rupiah → the PO's currency
    else if (currency === 'IDR') paid += amt * rate;
    else paid += (amt * rate) / (poRate || rate); // cross, via rupiah
  }

  const balance = total - paid;
  const tol = settledTolerance(total, derived);
  const remaining = balance > tol ? balance : 0;
  const overpaid = balance < -tol ? -balance : 0;

  const rateSuspect = !!(live && poRate && (poRate / live > RATE_SUSPECT_FACTOR || live / poRate > RATE_SUSPECT_FACTOR));

  let idr: number | null = null;
  let idrRate: number | null = null;
  let idrSource: 'live' | 'po' | null = null;
  if (currency === 'IDR') {
    idr = remaining; idrRate = 1; idrSource = null;
  } else if (remaining > 0) {
    // Today's market rate first: the question is what the transfer will COST,
    // and the rate the PO was booked at months ago does not answer it. The
    // booked rate is the fallback, and either way the source is displayed —
    // a number whose rate is not shown cannot be checked.
    if (live) { idrRate = live; idrSource = 'live'; }
    else if (poRate) { idrRate = poRate; idrSource = 'po'; }
    idr = idrRate ? remaining * idrRate : null;
  } else {
    idr = 0;
  }

  return {
    poId: String(po.po_id),
    poNumber: po.po_number ?? null,
    currency, total, paid, remaining, overpaid,
    settled: remaining === 0,
    derived, assumedRate,
    idr, idrRate, idrSource, rateSuspect,
  };
}

export function dealBalance(
  pos: BalancePo[],
  costs: BalanceCost[],
  opts: { liveRates?: Record<string, number> | null } = {},
): DealBalance {
  const perPo = pos
    .filter((p) => !VOID_PO_STATUS.has(p.status ?? ''))
    .map((p) => poBalance(p, costs, opts));

  const byCcy = new Map<string, { currency: string; total: number; paid: number; remaining: number }>();
  const over = new Map<string, number>();
  let idr = 0;
  let idrKnown = true;
  const sources = new Set<'live' | 'po'>();
  const usedRates = new Set<number>();

  for (const b of perPo) {
    let line = byCcy.get(b.currency);
    if (!line) { line = { currency: b.currency, total: 0, paid: 0, remaining: 0 }; byCcy.set(b.currency, line); }
    line.total += b.total; line.paid += b.paid; line.remaining += b.remaining;
    if (b.overpaid > 0) over.set(b.currency, (over.get(b.currency) ?? 0) + b.overpaid);
    if (b.idr == null) idrKnown = false; else idr += b.idr;
    if (b.idrSource) { sources.add(b.idrSource); if (b.idrRate) usedRates.add(b.idrRate); }
  }

  const lines = [...byCcy.values()]
    .filter((l) => l.total !== 0 || l.paid !== 0)
    .sort((a, b) => b.remaining - a.remaining || a.currency.localeCompare(b.currency));

  return {
    lines,
    idr: idrKnown ? idr : null,
    idrSource: sources.size === 0 ? null : sources.size > 1 ? 'mixed' : [...sources][0],
    // Named only when one rate did all the work. Two currencies on one deal
    // have two rates, and printing either as "the" rate would be a lie.
    idrRate: usedRates.size === 1 ? [...usedRates][0] : null,
    anyDerived: perPo.some((b) => b.derived),
    anyAssumedRate: perPo.some((b) => b.assumedRate),
    anySuspectRate: perPo.some((b) => b.rateSuspect),
    settled: perPo.every((b) => b.settled),
    overpaid: [...over.entries()].map(([currency, amount]) => ({ currency, amount })),
    perPo,
  };
}

/** The one-line answer: "CNY 81,060 · USD 30,903" — or null when nothing is owed. */
export function remainingLabel(
  d: DealBalance,
  fmt: (amount: number, currency: string) => string,
): string | null {
  const owed = d.lines.filter((l) => l.remaining > 0);
  if (!owed.length) return null;
  return owed.map((l) => fmt(l.remaining, l.currency)).join(' · ');
}

/**
 * Capital allocation — where the company's cash earns most, and (just as
 * important, more so in a slow market) where it must NOT go.
 *
 * The Item Score says which items are good TRADES. This layer turns that into a
 * CASH decision: given an item's return on the cash it locks up, its downside
 * risks, and whether it's actually due to buy, should the next rupiah go here?
 *
 * The north-star number is GMROI — Gross Margin Return On Inventory investment,
 * = annual gross margin ÷ average inventory cost = margin × turns. GMROI of 2
 * means a rupiah of stock returns two rupiah of gross margin a year. It is the
 * one figure that compares "bang for cash" across any item, price or category.
 *
 * The verdict is gated DOWNSIDE-FIRST: the reasons not to allocate (below cost,
 * dead stock, obsolete, weak return) are checked before any reason to deploy,
 * because a capital trap that also happens to score well is still a trap. A
 * defensive mode tightens the deploy bar and widens the traps — for the slow
 * market, when protecting cash matters more than chasing it.
 */
import type { ScoreBand } from './itemScore';

export type CapitalVerdict = 'deploy' | 'hold' | 'trim' | 'divest';

export interface CapitalInput {
  band: ScoreBand;
  superseded: boolean;
  /** Realized gross margin %, or null when nothing has sold. */
  marginPct: number | null;
  /** Has the item sold in the recent demand window? */
  soldRecently: boolean;
  /** Held stock that has not moved in the slow-mover window — aging cash. */
  slow: boolean;
  /** Is the item at/below its reorder point right now? */
  dueToReorder: boolean;
  /** Cash currently locked in this item (on-hand × avg cost). */
  stockValue: number;
  /** GMROI = annual GP ÷ avg inventory cost. null when nothing is held
   *  (pure-flow: margin earned with no cash locked — maximally efficient). */
  gmroi: number | null;
}

export interface CapitalCall {
  verdict: CapitalVerdict;
  reason: string;
  /** Cash this verdict says is misallocated — frozen and worth freeing. */
  frozenCash: number;
}

/** GMROI a healthy staple should clear; and the floor below which cash idles. */
export const GMROI_GOOD = 2;
export const GMROI_FLOOR = 1;

const call = (verdict: CapitalVerdict, reason: string, frozenCash = 0): CapitalCall => ({ verdict, reason, frozenCash });

/**
 * The capital verdict for one item. `defensive` = slow-market mode: deploy less,
 * protect more. Downside gates run first and win.
 */
export function capitalCall(it: CapitalInput, defensive = false): CapitalCall {
  const held = Math.max(0, it.stockValue);

  // ── Downside gates — where NOT to allocate. Checked first; they veto. ──
  if (it.marginPct != null && it.marginPct < 0)
    return call('divest', 'Selling below cost — stop buying; reprice or clear', held);
  if (it.superseded && held > 0)
    return call('divest', 'Superseded — clear the remaining stock, don’t restock', held);
  if (it.slow && held > 0)
    return call('divest', 'Dead stock — cash frozen with no recent sales; liquidate to free it', held);
  if (it.band === 'reduce' && held > 0)
    return call('divest', 'Weak trade with cash locked in it — free the cash', held);
  // In a slow market, stock that barely earns its keep is cash better held back.
  if (defensive && it.gmroi != null && it.gmroi < GMROI_FLOOR && held > 0)
    return call('trim', 'Low return on cash — don’t add; let the stock run down', held);

  // ── Deploy — the best use of the next rupiah. ──
  const strong = it.band === 'core' || it.band === 'solid';
  // Pure-flow items (nothing held → gmroi null) earn margin without locking
  // cash, so they clear the return bar by definition.
  const returnOk = it.gmroi == null ? true : it.gmroi >= (defensive ? GMROI_GOOD : GMROI_FLOOR);
  if (strong && it.soldRecently && returnOk && (!defensive || it.dueToReorder))
    return call('deploy', it.dueToReorder ? 'Proven earner and due to reorder — buy now' : 'Proven earner — keep it stocked');

  // ── Trim — don't add cash; let it wind down. ──
  if (it.band === 'watch')
    return call('trim', 'Marginal — hold off on new cash until it proves itself');
  if (it.gmroi != null && it.gmroi < GMROI_FLOOR && held > 0)
    return call('trim', 'Weak return on the cash tied up — don’t add to it');

  return call('hold', 'Steady — no capital action needed');
}

export const VERDICT_LABEL: Record<CapitalVerdict, string> = {
  deploy: 'Deploy', hold: 'Hold', trim: 'Trim', divest: 'Divest',
};

/** A whole-book roll-up, for the allocation summary. */
export interface CapitalSummary {
  deploy: number; hold: number; trim: number; divest: number;
  /** Cash the verdicts flag as misallocated (trim + divest). The "don't-go" total. */
  frozenCash: number;
  /** Stock cash sitting in healthy deploy/hold items. */
  workingCash: number;
}

export function summariseCapital(calls: { call: CapitalCall; stockValue: number }[]): CapitalSummary {
  const s: CapitalSummary = { deploy: 0, hold: 0, trim: 0, divest: 0, frozenCash: 0, workingCash: 0 };
  for (const { call: c, stockValue } of calls) {
    s[c.verdict] += 1;
    if (c.verdict === 'trim' || c.verdict === 'divest') s.frozenCash += Math.max(0, stockValue);
    else s.workingCash += Math.max(0, stockValue);
  }
  return s;
}

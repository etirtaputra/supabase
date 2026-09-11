/**
 * What an item COSTS, and — just as important — how we know.
 *
 * Owner, 2026-09-11: *"for setting Selling Prices, please also allow to
 * reference not only Landed Cost, but based on Quotes first. But once there's
 * Landed Cost, it should use Landed Cost."*
 *
 * WHY THIS MATTERS MORE THAN IT SOUNDS. Measured 2026-09-11, 1,022 active
 * items:
 *
 *   164  have a landed cost in the ledger
 *   149  have no ledger cost but a settled PO behind them
 *   170  have neither, but a supplier has quoted them
 *   539  have nothing at all — of which only 37 carry a sell price
 *
 * So Selling Prices could judge 164 items and was blank for the other 858 —
 * on the one screen whose entire job is deciding what to charge. The chain
 * below takes it to 483. A supplier quote is a real number somebody
 * negotiated; refusing to price against it does not make the pricing more
 * careful, it makes it absent.
 *
 * THE ORDER, best evidence first:
 *
 *   1. `landed` — the moving-average landed cost from the stock ledger
 *      (`30.1_stock_balances.avg_cost_idr`). Goods we received, at what they
 *      actually cost us to get here. The locked architectural decision.
 *   2. `tuc`    — total unit cost from a settled PO (`computeTUC`), line cost
 *      plus its share of freight, duty, PIB and bank charges. Also a real
 *      landed cost; it covers the item whose stock has since sold out, or
 *      whose ledger row has not caught up.
 *   3. `quote`  — a supplier's quoted price, converted to IDR at the rate on
 *      the quote. What we have before we have ever bought the thing.
 *   4. `none`   — say so. Never guess.
 *
 * **A QUOTE BASIS IS NOT A CAUTIOUS LANDED COST. IT IS AN OPTIMISTIC ONE.**
 * That distinction is the whole reason this file has a `provisional` flag
 * rather than a confidence score. A supplier quote is EXW or FOB: it excludes
 * freight, duty, PIB and bank charges, which on the imports this business runs
 * are not a rounding error. So a margin computed on a quote basis is
 * systematically too GOOD, and a floor "cleared" on one can be breached the
 * day the container lands. A number that is merely uncertain can be shown
 * quietly; a number that is biased in a known direction has to say which way.
 *
 * Nothing here re-implements a cost rule. `getComponentCost` in
 * `lib/computeTUC.ts` already resolves TUC → quote with FX conversion, staleness
 * and a full history, and the Project Quote builder has used it for months.
 * This adds the ledger's landed cost in front of it and names the result, so
 * one sentence — "landed wins, quote fills in" — has one implementation.
 */
import type { ComponentCost } from './computeTUC.ts';

export type CostBasis = 'landed' | 'tuc' | 'quote' | 'none';

export interface ResolvedCost {
  /** IDR per unit, or null when nothing can price it. */
  cost: number | null;
  basis: CostBasis;
  /** The date the basis is as of — '' when unknown, always '' for `landed`. */
  asOf: string;
  /**
   * The cost is a supplier quote, so it EXCLUDES freight, duty and fees.
   * Any margin built on it reads better than the truth. Never suppress this.
   */
  provisional: boolean;
}

export const NO_COST: ResolvedCost = { cost: null, basis: 'none', asOf: '', provisional: false };

/**
 * Resolve one item's cost from the two sources a screen can hold.
 *
 * `landed` is the ledger's moving average; `fallback` is whatever
 * `getComponentCost` returned (TUC, then supplier quote). Passing `null` for
 * either is normal — most items have exactly one of them.
 */
export function resolveCost(
  landed: number | null | undefined,
  fallback: ComponentCost | null | undefined,
): ResolvedCost {
  const l = Number(landed);
  if (Number.isFinite(l) && l > 0) {
    // The ledger wins outright, even against a newer quote. It is the only
    // number derived from goods that actually arrived.
    return { cost: l, basis: 'landed', asOf: '', provisional: false };
  }
  if (fallback && Number(fallback.cost) > 0) {
    const basis: CostBasis = fallback.source === 'tuc' ? 'tuc' : 'quote';
    return {
      cost: Number(fallback.cost),
      basis,
      asOf: fallback.asOf ?? '',
      // 'used' (a cost stored on a past project quote) resolves here too and is
      // treated as provisional for the same reason a quote is: it was never a
      // landed cost, it was somebody's working figure.
      provisional: basis === 'quote',
    };
  }
  return NO_COST;
}

/** Is this basis something goods actually arriving proved? */
export const isMeasured = (b: CostBasis): boolean => b === 'landed' || b === 'tuc';

export const BASIS_LABEL: Record<CostBasis, string> = {
  landed: 'Landed cost',
  tuc: 'Landed cost (from PO)',
  quote: 'Supplier quote',
  none: 'No cost',
};

/** The short form that fits in a table cell beside a number. */
export const BASIS_TAG: Record<CostBasis, string> = {
  landed: '',          // the expected case earns no badge — only exceptions do
  tuc: 'PO',
  quote: 'QUOTE',
  none: '',
};

export const BASIS_NOTE: Record<CostBasis, string> = {
  landed: 'Moving-average landed cost from the stock ledger — goods received, at what they cost to get here.',
  tuc: 'Total unit cost from a settled purchase order: the line price plus its share of freight, duty, PIB and bank charges.',
  quote: 'A supplier’s quoted price. It excludes freight, duty and fees, so the margin shown against it is BETTER than the real one will be. Treat a floor cleared on this basis as unproven.',
  none: 'Nothing prices this item yet — no goods received, no settled PO, no supplier quote.',
};

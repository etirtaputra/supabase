/**
 * Pricing intelligence — the right sell price, and a score for how close the
 * current one is to it.
 *
 * Selling above cost is not enough. The right price is settled between four
 * forces, resolved in this order:
 *
 *  1. COST FLOOR, FX-adjusted. Never below the price that covers REPLACEMENT
 *     landed cost plus the margin floor. The cost of record is what we paid;
 *     the price must cover what the next PO will cost, so the floor uses landed
 *     cost inflated by an FX-risk buffer — when the rupiah weakens against the
 *     buying currency, the floor rises ahead of the reorder.
 *  2. MARKET BAND. Competitor prices give a low/mid/high band. Above it we lose
 *     deals; below it we leave money on the table. Cost-plus alone is blind to
 *     this — the market is what tells us if we're too dear or too cheap.
 *  3. TARGET MARGIN. Aim for the desired gross margin — but only as far as the
 *     market bears.
 *  4. DEMAND. A strong, rising item can sit near the top of the band; a slow or
 *     declining one prices toward the bottom to keep moving.
 *
 * All margins are GROSS MARGIN (share of PRICE), matching the rest of ICAPROC.
 * Pure: the caller supplies landed cost, the market band, and the settings.
 */

export interface MarketBand {
  low: number;    // cheapest competitor (IDR)
  mid: number;    // typical / weighted-average competitor price (IDR)
  high: number;   // dearest competitor (IDR)
  count: number;  // how many competitor points back this band
}

export type DemandLevel = 'strong' | 'normal' | 'weak';

export interface PricingInput {
  /** Landed unit cost (TUC) in IDR — the cost of record. */
  landedCost: number;
  /** Current sell price in IDR, or null when none is set. */
  currentPrice: number | null;
  /** Minimum gross margin %, the floor (e.g. 15). */
  marginFloorPct: number;
  /** Desired gross margin %, the aim (e.g. 30). */
  targetMarginPct: number;
  /** Extra % added to landed cost for FX exposure — the replacement-cost
   *  buffer for goods bought in a currency that has moved against the rupiah. */
  fxRiskPct?: number;
  /** Competitor band, or null when there is no market data. */
  market?: MarketBand | null;
  /** Where demand lets us sit in the band. Defaults to 'normal'. */
  demand?: DemandLevel;
  /** Round the ideal to a clean multiple (IDR). Defaults to 1000. */
  roundingStep?: number;
}

export type PricingVerdict =
  | 'below-cost' | 'below-floor' | 'underpriced' | 'well-priced' | 'overpriced' | 'uncompetitive';

export interface PricingResult {
  /** FX-adjusted cost floor (min-margin price). */
  floor: number;
  /** Price that hits the target margin on the FX-adjusted cost. */
  target: number;
  /** The recommended price. */
  ideal: number;
  band: MarketBand | null;
  hasMarket: boolean;
  /** True when even the floor sits above the whole market — a cost problem. */
  uncompetitive: boolean;
  /** 0–1: how much the recommendation can be trusted (market depth). */
  confidence: number;
  idealMarginPct: number;
  currentMarginPct: number | null;
  /** (ideal − current) ÷ current, %. Positive = room to raise. */
  gapPct: number | null;
  /** 0–100: how close and how healthy the CURRENT price is. Null with no price. */
  score: number | null;
  verdict: PricingVerdict | null;
  reason: string;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const roundTo = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : Math.round(v));
const marginOf = (price: number, cost: number) => (price > 0 ? ((price - cost) / price) * 100 : 0);
/** Price that yields a gross margin `m`% on `cost`, guarded against m ≥ 100. */
const priceForMargin = (cost: number, mPct: number) => cost / (1 - Math.min(0.95, Math.max(0, mPct / 100)));

export function computePricing(input: PricingInput): PricingResult {
  const step = input.roundingStep ?? 1000;
  const cost = Math.max(0, input.landedCost);
  const demand = input.demand ?? 'normal';
  const effCost = cost * (1 + Math.max(0, input.fxRiskPct ?? 0) / 100);   // replacement cost
  const floor = priceForMargin(effCost, input.marginFloorPct);
  const target = priceForMargin(effCost, input.targetMarginPct);
  const mkt = input.market && input.market.count > 0 && input.market.high > 0 ? input.market : null;

  // ── The ideal price ──
  let ideal: number;
  let uncompetitive = false;
  let confidence: number;
  if (mkt) {
    // Where demand says we should sit in the band — the price we aim for.
    const want = demand === 'strong' ? mkt.high : demand === 'weak' ? mkt.low : mkt.mid;
    ideal = Math.max(floor, want);
    // If the target margin needs more than that point and the dearest
    // competitor still supports it, capture the extra margin (up to the top).
    ideal = Math.max(ideal, Math.min(target, mkt.high));
    uncompetitive = floor > mkt.high;
    if (uncompetitive) ideal = floor;        // our cost alone prices us out of the market
    confidence = clamp(mkt.count / (mkt.count + 2)) / 100;   // 0..1
  } else {
    ideal = Math.max(floor, target);         // cost-plus only, no market to check against
    confidence = 0.3;
  }
  ideal = roundTo(ideal, step);

  const idealMarginPct = marginOf(ideal, cost);
  const cur = input.currentPrice;
  const currentMarginPct = cur != null && cur > 0 ? marginOf(cur, cost) : null;
  const gapPct = cur != null && cur > 0 ? ((ideal - cur) / cur) * 100 : null;

  // ── Score the current price ──
  let score: number | null = null;
  let verdict: PricingVerdict | null = null;
  let reason = '';
  if (cur != null && cur > 0) {
    const dist = ideal > 0 ? Math.abs(cur - ideal) / ideal : 1;
    let s = clamp(100 - dist * 250);         // ~40% off the ideal → 0
    if (cur < cost) {
      verdict = 'below-cost'; s = Math.min(s, 8);
      reason = 'Below landed cost — every sale loses money.';
    } else if (cur < floor) {
      verdict = 'below-floor'; s = Math.min(s, 38);
      reason = `Below the ${input.marginFloorPct}% margin floor${(input.fxRiskPct ?? 0) > 0 ? ' (FX-adjusted)' : ''} — thin cover for the next restock.`;
    } else if (uncompetitive) {
      verdict = 'uncompetitive'; s = Math.min(s, 55);
      reason = 'Landed cost sits above the whole market — renegotiate supply or accept a thin margin.';
    } else if (mkt && cur > mkt.high * 1.02) {
      verdict = 'overpriced'; s = clamp(s - 12);
      reason = 'Dearer than every competitor on file — you may be losing deals on price.';
    } else if (mkt && cur < mkt.low * 0.98) {
      verdict = 'underpriced'; s = clamp(s - 8);
      reason = 'Cheaper than the cheapest competitor — there is room to raise and keep the deal.';
    } else if (gapPct != null && gapPct > 6) {
      verdict = 'underpriced';
      reason = 'Below the ideal — room to raise toward the market.';
    } else if (gapPct != null && gapPct < -6) {
      verdict = 'overpriced';
      reason = 'Above the ideal for its demand and market.';
    } else {
      verdict = 'well-priced';
      reason = 'In the sweet spot — at target margin and in the market band.';
    }
    score = Math.round(clamp(s));
  } else {
    reason = 'No sell price set — start from the ideal.';
  }

  return {
    floor: roundTo(floor, step), target: roundTo(target, step), ideal,
    band: mkt, hasMarket: !!mkt, uncompetitive, confidence,
    idealMarginPct, currentMarginPct, gapPct, score, verdict, reason,
  };
}

export const PRICING_VERDICT_LABEL: Record<PricingVerdict, string> = {
  'below-cost': 'Below cost', 'below-floor': 'Below floor', underpriced: 'Underpriced',
  'well-priced': 'Well priced', overpriced: 'Overpriced', uncompetitive: 'Uncompetitive',
};

/**
 * Item Score — a GuruFocus-GF-Score analog for stock items (roadmap Module 6).
 *
 * One 0–100 number per item that answers "how good a trade is this to keep
 * buying?", blended from six factors the owner picked. Like GuruFocus, most
 * factors are scored as a PERCENTILE RANK against peers rather than an absolute
 * threshold — a 22% margin is excellent for a commodity cable and thin for an
 * inverter, so each item is graded against items in its OWN category (with a
 * global fallback when a category is too small to rank within). Two factors —
 * position and consistency — are absolute by nature and scored directly.
 *
 * The engine is pure: the caller assembles the inputs (the Profitability
 * dashboard already measures every one) and passes the weights (owner-tunable
 * in Settings). Nothing here reads the catalog or the database.
 *
 * The score is a RANK, not a valuation: it never books COGS, values inventory
 * or prices anything. It ranks what to keep buying, and pairs with a plain
 * action so the screen proposes a next step instead of only a number.
 */

/** The factor weights (need not sum to 100 — they are normalised). */
export interface ItemScoreWeights {
  volume: number;       // sales-volume contribution vs the whole book
  margin: number;       // gross profit margin
  momentum: number;     // demand growth, recent vs prior
  leadTime: number;     // supplier speed (shorter is better)
  position: number;     // is the trade already whole (in profit)?
  consistency: number;  // a dependable staple vs a one-off / EOL model
  cashCycle: number;    // days inventory outstanding — cash locked as stock
}

export const DEFAULT_ITEM_SCORE_WEIGHTS: ItemScoreWeights = {
  volume: 18, margin: 18, momentum: 13, leadTime: 12, position: 12, consistency: 12, cashCycle: 15,
};

/** Everything the score needs about one item — all measured elsewhere. */
export interface ItemScoreInput {
  id: string;
  category: string | null;
  /** Period revenue (IDR). Drives the volume-contribution rank. */
  revenue: number;
  /** Realised GP margin %, or null when nothing sold in the period. */
  marginPct: number | null;
  /** Sales VALUE in the last 90 days, and the item's TYPICAL 90-day value —
   *  a smoothed baseline (avg 90d over the prior window), not the single
   *  prior quarter, so one lumpy B2B order doesn't read as a swing. */
  salesRecent: number;
  salesBaseline: number;
  /** Measured PO → goods-receipt days, or null when never received. */
  leadDays: number | null;
  /** How many received POs the lead time was measured from — its confidence. */
  leadSamples: number;
  /** All-time realised GP ÷ value still on the shelf. ≥1 = trade whole.
   *  null when nothing is held (a pure-flow item carries no open position). */
  recoveryRatio: number | null;
  /** A newer version supersedes this item (8.0_component_links). */
  superseded: boolean;
  /** Distinct delivery events — how repeatedly the item actually sells. */
  saleEvents: number;
  /** Coefficient of variation of purchase unit cost; null under 2 buys. */
  costCoV: number | null;
  /** Days inventory outstanding (stock value ÷ daily COGS). Shorter = cash
   *  cycles faster. null when nothing is held or nothing shipped to measure it. */
  dioDays: number | null;
}

export type ScoreBand = 'core' | 'solid' | 'watch' | 'reduce';

export interface ItemFactorScores {
  volume: number; margin: number; momentum: number; leadTime: number; position: number; consistency: number; cashCycle: number;
}

export interface ItemScoreResult {
  id: string;
  score: number;               // 0–100, weighted blend
  factors: ItemFactorScores;   // each 0–100, for the breakdown
  band: ScoreBand;
  action: string;              // the proposed next step
  superseded: boolean;
  /** 0–1: how much evidence stands behind the score. A thin history is pulled
   *  toward neutral, so a one-sale item can't masquerade as a confident buy. */
  confidence: number;
  lowData: boolean;
}

const MIN_PEERS = 8;           // below this a category can't rank on its own
const NEUTRAL = 50;            // an unknown factor neither helps nor hurts
// Confidence half-lives: this many observations count as much as the prior.
const K_SALES = 3;             // sale events for the sales-derived factors
const K_LEAD = 2;              // received POs for the lead-time factor
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
/** Pull a raw factor toward neutral by confidence c∈[0,1] (0 → all the way). */
const shrink = (raw: number, c: number) => NEUTRAL + (raw - NEUTRAL) * clamp(c, 0, 1);

/**
 * Percentile of `v` within a sorted ascending distribution — the share of the
 * distribution at or below it, midpoint-adjusted for ties, 0–100. Higher `v`
 * ranks higher; callers invert the input for "lower is better" factors.
 */
function percentileOf(v: number, sortedAsc: number[]): number {
  const n = sortedAsc.length;
  if (n === 0) return NEUTRAL;
  if (n === 1) return NEUTRAL;
  let below = 0, equal = 0;
  for (const x of sortedAsc) {
    if (x < v) below++;
    else if (x === v) equal++;
  }
  return clamp(((below + equal / 2) / n) * 100);
}

/**
 * Build a percentile scorer for one factor: group the values by category, and
 * for each item return its percentile within its category — or within the
 * whole catalog when its category has too few items to rank meaningfully.
 * `valueOf` returns null for items the factor can't judge; those get NEUTRAL
 * and never enter a distribution.
 */
function rankFactor(
  items: ItemScoreInput[],
  valueOf: (it: ItemScoreInput) => number | null,
): Map<string, number> {
  const catKey = (it: ItemScoreInput) => it.category ?? '(uncategorised)';
  const byCat = new Map<string, number[]>();
  const globalDist: number[] = [];
  for (const it of items) {
    const v = valueOf(it);
    if (v === null || !Number.isFinite(v)) continue;
    (byCat.get(catKey(it)) ?? byCat.set(catKey(it), []).get(catKey(it))!).push(v);
    globalDist.push(v);
  }
  for (const arr of byCat.values()) arr.sort((a, b) => a - b);
  globalDist.sort((a, b) => a - b);

  const out = new Map<string, number>();
  for (const it of items) {
    const v = valueOf(it);
    if (v === null || !Number.isFinite(v)) { out.set(it.id, NEUTRAL); continue; }
    const peers = byCat.get(catKey(it))!;
    const dist = peers.length >= MIN_PEERS ? peers : globalDist;
    out.set(it.id, percentileOf(v, dist));
  }
  return out;
}

/** Demand growth: recent 90-day sales VALUE vs the item's typical 90-day value
 *  (a smoothed baseline). Value, not unit count, and a smoothed baseline, not
 *  the single prior quarter — so a lumpy B2B order can't fake a swing. A first
 *  sale reads as strong positive; a stall to zero as strong negative; no sales
 *  at all as flat. */
function growthOf(it: ItemScoreInput): number | null {
  const r = it.salesRecent, b = it.salesBaseline;
  if (r === 0 && b === 0) return null;         // dormant — momentum can't judge it
  if (b === 0) return r > 0 ? 2 : 0;           // brand-new demand, capped
  return clamp((r - b) / b, -1, 3);            // -100%..+300%
}

/** The position factor, absolute: a whole trade is full marks, a deep unpaid
 *  position is low, a pure-flow item (nothing held) is good — no locked cash. */
function positionScore(it: ItemScoreInput): number {
  if (it.recoveryRatio === null) return 80;    // no open position to recover
  if (it.recoveryRatio >= 1) return 100;       // in profit — the trade is whole
  return clamp(40 + 60 * clamp(it.recoveryRatio, 0, 1) / 1); // 40 → 100 as it recovers
}

/**
 * The consistency factor, absolute-ish: how dependable a line this is. Built
 * from repeat-sale frequency (does it actually keep selling), purchase-cost
 * stability (a steady cost is a steady supply), and whether a successor has
 * made it end-of-life. Repeat frequency is compared to peers; the other two
 * are absolute.
 */
function consistencyScores(items: ItemScoreInput[]): Map<string, number> {
  const repeat = rankFactor(items, (it) => it.saleEvents > 0 ? it.saleEvents : null);
  const out = new Map<string, number>();
  for (const it of items) {
    const repeatScore = it.saleEvents > 0 ? (repeat.get(it.id) ?? NEUTRAL) : 20; // never sold → weak
    // Cost stability: CoV 0 → 100, CoV ≥ 0.5 → 0; unknown (few buys) → neutral.
    const stability = it.costCoV === null ? NEUTRAL : clamp(100 - it.costCoV * 200);
    const lifecycle = it.superseded ? 0 : 100;
    out.set(it.id, clamp(0.5 * repeatScore + 0.3 * stability + 0.2 * lifecycle));
  }
  return out;
}

function bandOf(score: number): ScoreBand {
  if (score >= 80) return 'core';
  if (score >= 60) return 'solid';
  if (score >= 40) return 'watch';
  return 'reduce';
}

const BAND_ACTION: Record<ScoreBand, string> = {
  core:   'Keep stocked — reorder on the point',
  solid:  'Healthy — buy to demand',
  watch:  'Watch — buy cautiously',
  reduce: 'Reduce / clear — free the cash',
};

function actionOf(band: ScoreBand, superseded: boolean, warning: string | null): string {
  if (warning) return warning;
  const base = BAND_ACTION[band];
  // A superseded item should not be restocked however well it still scores —
  // buy only to clear the pipeline, and switch demand to its successor.
  if (superseded) return band === 'reduce' ? base : 'Superseded — sell through, don’t restock';
  return base;
}

const ORDER: ScoreBand[] = ['reduce', 'watch', 'solid', 'core'];
const capBand = (b: ScoreBand, ceiling: ScoreBand): ScoreBand =>
  ORDER.indexOf(b) > ORDER.indexOf(ceiling) ? ceiling : b;

/**
 * Absolute reality checks on top of the relative rank — so a top band means
 * good in absolute terms, not merely "best of a weak category". Each returns a
 * band ceiling and, when it fires, the action that should override the generic
 * one. The rank still orders items; these only stop a misleading badge.
 */
function guardrails(it: ItemScoreInput): { ceiling: ScoreBand; warning: string | null } {
  // Selling below cost is never a "keep buying" — whatever the rank says.
  if (it.marginPct != null && it.marginPct < 0) {
    return { ceiling: 'watch', warning: 'Selling below cost — fix pricing before buying more' };
  }
  // Holding stock that hasn't moved in the recent window isn't a core buy —
  // it's a clearance question, no matter how it sold historically.
  if (it.salesRecent === 0 && it.saleEvents > 0 && (it.dioDays ?? 0) > 0) {
    return { ceiling: 'watch', warning: 'Stalled — held stock, no recent sales; clear before restocking' };
  }
  return { ceiling: 'core', warning: null };
}

/**
 * Score every item, 0–100, against its peers. Weights need not sum to 100.
 * Returns a map keyed by item id.
 */
export function computeItemScores(
  items: ItemScoreInput[],
  weights: ItemScoreWeights = DEFAULT_ITEM_SCORE_WEIGHTS,
): Map<string, ItemScoreResult> {
  const volume = rankFactor(items, (it) => it.revenue > 0 ? it.revenue : null);
  const margin = rankFactor(items, (it) => it.marginPct);
  const momentum = rankFactor(items, growthOf);
  // Lead time and cash cycle: shorter is better, so rank the NEGATED days.
  const leadTime = rankFactor(items, (it) => it.leadDays === null ? null : -it.leadDays);
  const cashCycle = rankFactor(items, (it) => it.dioDays === null ? null : -it.dioDays);
  const consistency = consistencyScores(items);

  const sumW = (x: ItemScoreWeights) => x.volume + x.margin + x.momentum + x.leadTime + x.position + x.consistency + x.cashCycle;
  const wsum = sumW(weights);
  const w = wsum > 0 ? weights : DEFAULT_ITEM_SCORE_WEIGHTS;
  const wtot = wsum > 0 ? wsum : sumW(DEFAULT_ITEM_SCORE_WEIGHTS);

  const out = new Map<string, ItemScoreResult>();
  for (const it of items) {
    // Confidence from the evidence each factor actually rests on: the
    // sales-derived factors (margin, momentum, cash cycle) from how many times
    // the item has sold; lead time from how many POs measured it. Thin
    // evidence pulls the factor toward neutral rather than trusting a fluke.
    const salesC = it.saleEvents / (it.saleEvents + K_SALES);
    const leadC = it.leadSamples / (it.leadSamples + K_LEAD);
    const factors: ItemFactorScores = {
      // Volume, position and consistency stand on their own evidence (size,
      // capital at risk, repeat count), so they are not shrunk.
      volume: volume.get(it.id) ?? NEUTRAL,
      margin: shrink(margin.get(it.id) ?? NEUTRAL, salesC),
      momentum: shrink(momentum.get(it.id) ?? NEUTRAL, salesC),
      leadTime: shrink(leadTime.get(it.id) ?? NEUTRAL, leadC),
      position: positionScore(it),
      consistency: consistency.get(it.id) ?? NEUTRAL,
      cashCycle: shrink(cashCycle.get(it.id) ?? NEUTRAL, salesC),
    };
    const score = clamp((
      factors.volume * w.volume +
      factors.margin * w.margin +
      factors.momentum * w.momentum +
      factors.leadTime * w.leadTime +
      factors.position * w.position +
      factors.consistency * w.consistency +
      factors.cashCycle * w.cashCycle
    ) / wtot);
    const { ceiling, warning } = guardrails(it);
    const band = capBand(bandOf(score), ceiling);
    out.set(it.id, {
      id: it.id, score, factors, band, action: actionOf(band, it.superseded, warning), superseded: it.superseded,
      confidence: salesC, lowData: it.saleEvents < 2,
    });
  }
  return out;
}

/** The factors in display order, with their labels — shared by the breakdown. */
export const ITEM_SCORE_FACTORS: { key: keyof ItemFactorScores; label: string; hint: string }[] = [
  { key: 'volume',      label: 'Volume',      hint: 'Share of sales vs the whole book' },
  { key: 'margin',      label: 'Margin',      hint: 'Gross profit margin vs peers' },
  { key: 'momentum',    label: 'Momentum',    hint: 'Sales growth vs the item’s typical 90 days (value, smoothed)' },
  { key: 'leadTime',    label: 'Lead time',   hint: 'Supplier speed — shorter ranks higher' },
  { key: 'position',    label: 'Position',    hint: 'Is the trade already in profit' },
  { key: 'consistency', label: 'Consistency', hint: 'Repeat sales, cost stability, still current' },
  { key: 'cashCycle',   label: 'Cash cycle',  hint: 'Days inventory outstanding — cash locked as stock, shorter ranks higher' },
];

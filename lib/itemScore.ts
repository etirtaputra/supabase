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

/** The six factor weights (need not sum to 100 — they are normalised). */
export interface ItemScoreWeights {
  volume: number;       // sales-volume contribution vs the whole book
  margin: number;       // gross profit margin
  momentum: number;     // demand growth, recent vs prior
  leadTime: number;     // supplier speed (shorter is better)
  position: number;     // is the trade already whole (in profit)?
  consistency: number;  // a dependable staple vs a one-off / EOL model
}

export const DEFAULT_ITEM_SCORE_WEIGHTS: ItemScoreWeights = {
  volume: 20, margin: 20, momentum: 15, leadTime: 15, position: 15, consistency: 15,
};

/** Everything the score needs about one item — all measured elsewhere. */
export interface ItemScoreInput {
  id: string;
  category: string | null;
  /** Period revenue (IDR). Drives the volume-contribution rank. */
  revenue: number;
  /** Realised GP margin %, or null when nothing sold in the period. */
  marginPct: number | null;
  /** Units shipped in the last 90 days, and in the 90 before that. */
  demandRecent: number;
  demandPrior: number;
  /** Measured PO → goods-receipt days, or null when never received. */
  leadDays: number | null;
  /** All-time realised GP ÷ value still on the shelf. ≥1 = trade whole.
   *  null when nothing is held (a pure-flow item carries no open position). */
  recoveryRatio: number | null;
  /** A newer version supersedes this item (8.0_component_links). */
  superseded: boolean;
  /** Distinct delivery events — how repeatedly the item actually sells. */
  saleEvents: number;
  /** Coefficient of variation of purchase unit cost; null under 2 buys. */
  costCoV: number | null;
}

export type ScoreBand = 'core' | 'solid' | 'watch' | 'reduce';

export interface ItemFactorScores {
  volume: number; margin: number; momentum: number; leadTime: number; position: number; consistency: number;
}

export interface ItemScoreResult {
  id: string;
  score: number;               // 0–100, weighted blend
  factors: ItemFactorScores;   // each 0–100, for the breakdown
  band: ScoreBand;
  action: string;              // the proposed next step
  superseded: boolean;
}

const MIN_PEERS = 8;           // below this a category can't rank on its own
const NEUTRAL = 50;            // an unknown factor neither helps nor hurts
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

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

/** Demand growth, recent vs prior 90-day window. A first sale reads as strong
 *  positive; a stall to zero as strong negative; no demand at all as flat. */
function growthOf(it: ItemScoreInput): number | null {
  const { demandRecent: r, demandPrior: p } = it;
  if (r === 0 && p === 0) return null;         // dormant — momentum can't judge it
  if (p === 0) return r > 0 ? 2 : 0;           // brand-new demand, capped
  return clamp((r - p) / p, -1, 3);            // -100%..+300%
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

function actionOf(band: ScoreBand, superseded: boolean): string {
  const base = BAND_ACTION[band];
  // A superseded item should not be restocked however well it still scores —
  // buy only to clear the pipeline, and switch demand to its successor.
  if (superseded) return band === 'reduce' ? base : 'Superseded — sell through, don’t restock';
  return base;
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
  // Lead time: shorter is better, so rank the NEGATED days.
  const leadTime = rankFactor(items, (it) => it.leadDays === null ? null : -it.leadDays);
  const consistency = consistencyScores(items);

  const wsum = weights.volume + weights.margin + weights.momentum + weights.leadTime + weights.position + weights.consistency;
  const w = wsum > 0 ? weights : DEFAULT_ITEM_SCORE_WEIGHTS;
  const wtot = wsum > 0 ? wsum : (DEFAULT_ITEM_SCORE_WEIGHTS.volume + DEFAULT_ITEM_SCORE_WEIGHTS.margin + DEFAULT_ITEM_SCORE_WEIGHTS.momentum + DEFAULT_ITEM_SCORE_WEIGHTS.leadTime + DEFAULT_ITEM_SCORE_WEIGHTS.position + DEFAULT_ITEM_SCORE_WEIGHTS.consistency);

  const out = new Map<string, ItemScoreResult>();
  for (const it of items) {
    const factors: ItemFactorScores = {
      volume: volume.get(it.id) ?? NEUTRAL,
      margin: margin.get(it.id) ?? NEUTRAL,
      momentum: momentum.get(it.id) ?? NEUTRAL,
      leadTime: leadTime.get(it.id) ?? NEUTRAL,
      position: positionScore(it),
      consistency: consistency.get(it.id) ?? NEUTRAL,
    };
    const score = clamp((
      factors.volume * w.volume +
      factors.margin * w.margin +
      factors.momentum * w.momentum +
      factors.leadTime * w.leadTime +
      factors.position * w.position +
      factors.consistency * w.consistency
    ) / wtot);
    const band = bandOf(score);
    out.set(it.id, { id: it.id, score, factors, band, action: actionOf(band, it.superseded), superseded: it.superseded });
  }
  return out;
}

/** The factors in display order, with their labels — shared by the breakdown. */
export const ITEM_SCORE_FACTORS: { key: keyof ItemFactorScores; label: string; hint: string }[] = [
  { key: 'volume',      label: 'Volume',      hint: 'Share of sales vs the whole book' },
  { key: 'margin',      label: 'Margin',      hint: 'Gross profit margin vs peers' },
  { key: 'momentum',    label: 'Momentum',    hint: 'Demand growth, recent vs prior 90 days' },
  { key: 'leadTime',    label: 'Lead time',   hint: 'Supplier speed — shorter ranks higher' },
  { key: 'position',    label: 'Position',    hint: 'Is the trade already in profit' },
  { key: 'consistency', label: 'Consistency', hint: 'Repeat sales, cost stability, still current' },
];

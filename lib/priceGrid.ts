/**
 * Which items need a pricing decision, and why.
 *
 * Set Pricing used to be a MODE on the Item Editor — one more column set on a
 * grid that already carries brand, category, specs, suppliers, market intel
 * and cash cycle. Pricing 990 items is its own job with its own question
 * ("what should this earn?"), so it moved to Catalog → Pricing Tiers, beside
 * the tier ladder and the margin bands that decide the answer.
 *
 * The four questions this file answers are the ones the owner asked for:
 * what has no price, what is priced below the floor, what is under-earning
 * against its band, and what we cannot judge at all.
 *
 * NOTHING HERE HARDCODES A NUMBER. Floors come from 21.0_price_tiers, bands
 * from 21.2_margin_profiles, cost from the stock ledger. An admin moves a band
 * on /pricing and this follows without a deploy — the same rule marginProfiles
 * was written under.
 *
 * Pure: the page does the I/O. See lib/priceGrid.test.ts.
 */

import { standingOf, type MarginProfile } from './marginProfiles.ts';

export type PriceIssue =
  /** No net price at all — the item cannot be quoted. */
  | 'no_price'
  /** A tier's price earns less than that tier's margin floor. Compliance. */
  | 'below_floor'
  /** Legal, but earning less than its category is supposed to. Optimisation. */
  | 'below_band'
  /** Earning more than the band. Not a fault; shown so it can be checked. */
  | 'above_band'
  /** No margin profile, or no cost — we do not know what it should earn. */
  | 'unclassified';

export interface TierFloor {
  tier_id: string;
  /** Minimum GP% this tier must earn against landed cost. */
  margin_floor_pct: number;
}

export interface RowInput {
  /** The item's net price — Tier 1 — from 3.0_components.selling_price_idr. */
  net: number | null;
  /** Landed cost (moving average). null = the ledger cannot price it yet. */
  cost: number | null;
  /** Effective price per tier, overrides already applied (computeTierChain). */
  priceByTier: Map<string, number | null>;
  tiers: TierFloor[];
  profile: MarginProfile | null;
}

/** GP% of a price against cost. null when either side cannot support the sum. */
export function marginPct(price: number | null, cost: number | null): number | null {
  if (price == null || price <= 0) return null;
  if (cost == null || cost < 0) return null;
  return ((price - cost) / price) * 100;
}

/**
 * Every issue this row has. A row can have several: an item priced below its
 * floor is usually below its band too, and the person fixing it wants to see
 * both rather than whichever one happened to be checked first.
 *
 * `unclassified` is a real answer, not a missing one — 693 of 990 items carry
 * no profile today, and saying so out loud is what lets that gap be closed
 * deliberately. It is never combined with a band verdict, because without a
 * profile there is no band to be inside or outside of.
 */
export function issuesFor(row: RowInput): Set<PriceIssue> {
  const out = new Set<PriceIssue>();

  if (row.net == null || row.net <= 0) {
    out.add('no_price');
    // Nothing else is knowable: every tier chains from the net, so there are
    // no prices to judge and no margin to compare against a band.
    return out;
  }

  // Floors are per tier, because each tier sells at its own price.
  for (const t of row.tiers) {
    const price = row.priceByTier.get(t.tier_id) ?? null;
    const gp = marginPct(price, row.cost);
    if (gp == null) continue;
    // The 0.05 slack matches the Floor Audit: a rounding hair under the floor
    // is not a breach, and flagging it trains people to ignore the flag.
    if (gp < (Number(t.margin_floor_pct) || 0) - 0.05) out.add('below_floor');
  }

  // The band is judged on the item's OWN economics — the net price against
  // landed cost. The upper tiers are markup steps on top of that, so judging
  // them against the band would say every item beats its target.
  const netGp = marginPct(row.net, row.cost);
  const standing = standingOf(netGp, row.profile);
  if (standing === 'unclassified') out.add('unclassified');
  else if (standing === 'below') out.add('below_band');
  else if (standing === 'above') out.add('above_band');

  return out;
}

/** Does this row match the filter? An empty filter set matches everything. */
export function matchesIssues(issues: Set<PriceIssue>, wanted: Set<PriceIssue>): boolean {
  if (wanted.size === 0) return true;
  for (const w of wanted) if (issues.has(w)) return true;
  return false;
}

/**
 * Scope: facts about the item rather than verdicts on its price.
 *
 * Separate from PriceIssue because they combine differently. The issue chips
 * are an OR — "show me the unpriced ones AND the under-target ones" widens the
 * list on purpose. Scope ANDs with that, because "under target, of the stock I
 * am actually holding" is a narrower question, and the whole point of asking it
 * is to get a shorter list.
 */
export type PriceScope =
  /** We hold some. Pricing this wrong costs money on stock already bought. */
  | 'in_stock'
  /** The ledger knows what it cost, so margin is a fact rather than a guess. */
  | 'has_cost'
  /** It does not, so no margin, floor or band verdict is possible. */
  | 'no_cost';

export interface RowFacts {
  qtyOnHand: number;
  cost: number | null;
}

export const factsOf = (r: RowFacts) => ({
  in_stock: r.qtyOnHand > 0,
  has_cost: r.cost != null && r.cost > 0,
  no_cost: !(r.cost != null && r.cost > 0),
});

/**
 * Scope narrows: every selected chip must hold. Picking both cost chips is the
 * one self-cancelling combination, and it honestly means "either", so it is
 * allowed to return everything rather than nothing.
 */
export function matchesScope(facts: RowFacts, wanted: Set<PriceScope>): boolean {
  if (wanted.size === 0) return true;
  const f = factsOf(facts);
  if (wanted.has('has_cost') && wanted.has('no_cost')) {
    // "either" — drop the pair and judge on whatever else is selected.
    const rest = new Set([...wanted].filter((w) => w !== 'has_cost' && w !== 'no_cost'));
    return matchesScope(facts, rest);
  }
  for (const w of wanted) if (!f[w]) return false;
  return true;
}

export const SCOPE_LABEL: Record<PriceScope, string> = {
  in_stock: 'In stock',
  has_cost: 'Has landed cost',
  no_cost: 'No landed cost',
};

/**
 * What the net price would have to be for this item to sit at the bottom of
 * its band — the "raise it to where it should be" suggestion.
 *
 * From margin = (price − cost) / price, price = cost / (1 − margin). Returns
 * null when there is nothing to compute from, or when the target is so close
 * to 100% that the division stops meaning anything.
 */
export function priceForMargin(cost: number | null, targetPct: number): number | null {
  if (cost == null || cost <= 0) return null;
  if (!Number.isFinite(targetPct) || targetPct >= 95) return null;
  return cost / (1 - targetPct / 100);
}

/** The label a person reads for each issue. */
export const ISSUE_LABEL: Record<PriceIssue, string> = {
  no_price: 'No price',
  below_floor: 'Below floor',
  below_band: 'Under target',
  above_band: 'Above target',
  unclassified: 'Unclassified',
};

// ── Sorting ──────────────────────────────────────────────────────────────────

export type SortDir = 'asc' | 'desc';

/**
 * Compare two cells, with EMPTY ALWAYS LAST — in both directions.
 *
 * The naive version treats null as 0 or as the empty string, and then "sort by
 * price, lowest first" opens with 902 unpriced rows: technically ordered,
 * useless as a worklist. A missing value is not a small value, it is the
 * absence of one, so it sinks whichever way the arrow points and the rows that
 * can answer the question stay at the top.
 */
export function compareCells(
  a: number | string | null | undefined,
  b: number | string | null | undefined,
  dir: SortDir,
): number {
  const aEmpty = a == null || a === '';
  const bEmpty = b == null || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  const sign = dir === 'asc' ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * sign;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }) * sign;
}

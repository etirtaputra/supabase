/**
 * The three questions the owner asks of an item before pricing it
 * (2026-10-22): "Track historical costs, are they trending up or down; what
 * was the last price? when? — If I set this selling price, what's the margin?
 * is it cheaper or more expensive than the rest? — How long is the usual lead
 * time?" Selling Prices › Prices answers all three on one row.
 *
 * Every number is ASSEMBLED from an engine that already owns it — the settled
 * TUC per PO (lib/computeTUC), the goods-in landed cost the ledger stamped
 * (30.0), the markup chain (lib/tierPricing), the per-product lead time
 * (lib/supplierLeadTimes). This file only decides what to put next to what.
 *
 * Pure: no fetch, no React.
 */
import { CATEGORY_UNITS } from '../constants/categoryUnits.ts';

/** One unit cost the item was actually bought at. */
export interface CostPoint {
  date: string;          // YYYY-MM-DD
  unitCost: number;      // IDR per unit, landed
  label: string;         // PO number
  /** 'paid' = a settled PO's true unit cost; 'received' = goods-in landed cost, PO not settled yet. */
  source: 'paid' | 'received';
}

/**
 * Paid purchases first-class, goods received filling in what is not paid yet.
 *
 * A PO that is both settled and received appears once, as the settled figure:
 * that is the cost once every invoice is in. A receipt with no settled PO
 * behind it (PIO-2026012 on 20 Oct, received, not paid) still counts — it is
 * the newest cost we know, and leaving it out would show last January's price
 * as "the last cost" of panels that arrived this week.
 */
export function costHistory(
  paid: { label: string; date: string; unitCost: number }[],
  received: { label: string; date: string; unitCost: number }[],
): CostPoint[] {
  const paidLabels = new Set(paid.map((p) => p.label));
  const out: CostPoint[] = [
    ...paid.filter((p) => p.unitCost > 0 && p.date).map((p) => ({ ...p, date: p.date.slice(0, 10), source: 'paid' as const })),
    ...received.filter((r) => r.unitCost > 0 && r.date && !paidLabels.has(r.label))
      .map((r) => ({ ...r, date: r.date.slice(0, 10), source: 'received' as const })),
  ];
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.unitCost - a.unitCost);
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export type TrendDir = 'up' | 'down' | 'flat' | 'first' | 'none';
export interface CostTrend {
  last: CostPoint | null;
  prev: CostPoint | null;
  /** (last − prev) / prev, %; null without two purchases. */
  changePct: number | null;
  dir: TrendDir;
  /** Costs left out of the trend because they sit far from the rest (a costing slip, a one-off sample). */
  outliers: CostPoint[];
}

/** A change smaller than this reads as "flat" — rounding and FX noise, not a trend. */
export const FLAT_PCT = 2;

/**
 * Up, down or flat, between the last two purchases.
 *
 * A cost wildly off the rest is set aside first and SHOWN, not hidden: with
 * three or more purchases, one above 1.8× or below 0.55× their median is an
 * outlier (EPEVER QI1522: Rp 7,222,499 on a 1-piece PO beside two at ~3.08M).
 * Drawing a trend through it would put a red arrow on an item whose price
 * never moved.
 */
export function costTrend(points: CostPoint[]): CostTrend {
  if (!points.length) return { last: null, prev: null, changePct: null, dir: 'none', outliers: [] };
  let kept = points;
  let outliers: CostPoint[] = [];
  if (points.length >= 3) {
    const m = median(points.map((p) => p.unitCost));
    outliers = points.filter((p) => p.unitCost > m * 1.8 || p.unitCost < m * 0.55);
    if (outliers.length && outliers.length < points.length) kept = points.filter((p) => !outliers.includes(p));
    else outliers = [];
  }
  const [last, prev] = kept;
  if (!prev) return { last, prev: null, changePct: null, dir: 'first', outliers };
  const changePct = (last.unitCost - prev.unitCost) / prev.unitCost * 100;
  const dir: TrendDir = Math.abs(changePct) < FLAT_PCT ? 'flat' : changePct > 0 ? 'up' : 'down';
  return { last, prev, changePct, dir, outliers };
}

export interface SimilarItem { componentId: string; name: string; perUnit: number; normValue: number }
export interface Similarity {
  /** The unit the comparison is per (Wp, W, A, Wh, VA). */
  unit: string;
  /** This item's price per unit at the price being considered. */
  perUnit: number;
  /** The median per-unit price of the similar items. */
  peerPerUnit: number;
  /** perUnit vs peerPerUnit, % (negative = cheaper). */
  diffPct: number;
  peers: SimilarItem[];
}

/**
 * Cheaper or dearer than the rest — "the rest" being what WE sell in the same
 * category at a similar size, per Wp / W / A / Wh.
 *
 * Similar size = half to double this item's rating. Size matters: a 100 Wp
 * panel costs far more per Wp than a 620 Wp one, so comparing across sizes
 * would call every small item expensive. Categories whose unit price is not a
 * per-capacity price (cable, priced per metre) are not compared. Only items
 * with a selling price take part; the item itself never does.
 */
export function similarTo(
  item: { component_id: string; category: string | null; norm_value: number | null },
  price: number,
  catalog: { component_id: string; category: string | null; norm_value: number | null; selling_price_idr: number | null; name: string }[],
): Similarity | null {
  const unit = item.category ? CATEGORY_UNITS[item.category] : undefined;
  const size = Number(item.norm_value) || 0;
  if (!unit || unit.priceIsPerUnit || size <= 0 || !(price > 0)) return null;
  const peers: SimilarItem[] = [];
  for (const c of catalog) {
    if (c.component_id === item.component_id || c.category !== item.category) continue;
    const n = Number(c.norm_value) || 0, p = Number(c.selling_price_idr) || 0;
    if (n <= 0 || p <= 0 || n < size * 0.5 || n > size * 2) continue;
    peers.push({ componentId: c.component_id, name: c.name, perUnit: p / n, normValue: n });
  }
  if (!peers.length) return null;
  const perUnit = price / size;
  const peerPerUnit = median(peers.map((p) => p.perUnit));
  return { unit: unit.unit, perUnit, peerPerUnit, diffPct: (perUnit - peerPerUnit) / peerPerUnit * 100, peers: peers.sort((a, b) => a.perUnit - b.perUnit) };
}

/**
 * The restock warning: the last purchase cost clearly more than the stock on
 * hand did, so today's margin is not the margin of the next sale after
 * restocking. Worth saying only when it moves the margin by 3 points or more.
 */
export function restockGap(lastCost: number | null, stockCost: number | null, price: number): { lastMargin: number; stockMargin: number } | null {
  if (!(lastCost && stockCost && price > 0)) return null;
  if (lastCost <= stockCost * 1.05) return null;
  const lastMargin = (price - lastCost) / price * 100, stockMargin = (price - stockCost) / price * 100;
  return stockMargin - lastMargin >= 3 ? { lastMargin, stockMargin } : null;
}

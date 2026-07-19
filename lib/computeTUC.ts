import type { PurchaseOrder, PurchaseLineItem, POCost, PriceQuote, PriceQuoteLineItem } from '../types/database';
import { TAX_CATS, BALANCE_CATS } from '../constants/costCategories';

/**
 * THE canonical True Unit Cost engine. Catalog's Last Price column,
 * Insights' Cost Lookup, and the Quotes app all read from here so the same
 * component never shows two different costs.
 *
 * Canonical semantics:
 * - Only SETTLED POs count (a balance payment exists) — an unpaid PO is not a
 *   proven cost yet.
 * - Costs convert to IDR via the cost row's own exchange rate, falling back to
 *   the PO's rate; IDR amounts pass through untouched.
 * - Line share = line value / PO value; TUC = share × (principal + bank fees
 *   + landed costs) / qty. Taxes (VAT / income tax) are excluded.
 * - Headline TUC = max(latest settled PO's TUC, weighted average) — a
 *   conservative floor so one cheap recent PO can't understate your cost.
 */

// Fallback rates for price-quote lines, which carry no exchange rate of their own
const FX: Record<string, number> = { USD: 16000, RMB: 2200, IDR: 1 };

export type CostKind = 'tuc' | 'quote' | 'used';

export interface CostEntry {
  kind: CostKind;
  label: string;      // PO number, supplier-quote PI number, or project-quote number
  date: string;
  unitCost: number;   // IDR
}

export interface TUCResult {
  tuc: number;                  // headline: max(latestTuc, avgTuc)
  avgTuc: number;               // weighted average across settled POs
  latestTuc: number;            // most recent settled PO's line TUC
  latestPoDate: string;
  latestXr: number | null;      // exchange rate of the latest settled PO
  poCount: number;              // distinct settled POs
  entries: CostEntry[];         // per-PO history, newest first
}

export interface ComponentCost {
  cost: number;             // recommended cost — see getComponentCost for the fallback order
  source: CostKind;
  asOf: string;             // date the recommended cost is based on ('' if unknown)
  history: CostEntry[];     // all TUC + quote + last-used entries, newest first
  buffered?: boolean;       // true when cost (and TUC history) carry the Cost Basis safety buffer
}

/** How a component's cost appears in the Project Quote BOM builder. */
export type QuoteCostMode = 'tuc' | 'buffered' | 'hidden';
export interface QuoteCostOpts {
  mode?: QuoteCostMode;   // default 'tuc' (raw)
  bufferPct?: number;     // applied only when mode === 'buffered'
}

/**
 * Bulk, single-pass TUC for every component at once. O(POs + items + costs).
 */
export function computeTUCMap(
  pos: PurchaseOrder[],
  poItems: PurchaseLineItem[],
  poCosts: POCost[],
): Map<string, TUCResult> {
  const poMap = new Map(pos.map((p) => [String(p.po_id), p]));

  const itemsByPo = new Map<string, PurchaseLineItem[]>();
  for (const i of poItems) {
    const k = String(i.po_id);
    if (!itemsByPo.has(k)) itemsByPo.set(k, []);
    itemsByPo.get(k)!.push(i);
  }

  // Pre-aggregate each PO once: settled? + cost buckets in IDR + line-value total
  interface PoAgg { settled: boolean; costPool: number; totalValue: number }
  const aggByPo = new Map<string, PoAgg>();
  const costsByPo = new Map<string, POCost[]>();
  for (const c of poCosts) {
    const k = String(c.po_id);
    if (!costsByPo.has(k)) costsByPo.set(k, []);
    costsByPo.get(k)!.push(c);
  }
  for (const [k, costs] of costsByPo) {
    const po = poMap.get(k);
    if (!po) continue;
    const toIdr = (c: POCost) => c.currency === 'IDR'
      ? Number(c.amount)
      : Number(c.amount) * (Number(c.exchange_rate) || Number(po.exchange_rate) || 1);
    let pool = 0;
    let settled = false;
    for (const c of costs) {
      if (BALANCE_CATS.has(c.cost_category)) settled = true;
      if (TAX_CATS.has(c.cost_category)) continue;
      // principal + bank fees + everything else except taxes
      pool += toIdr(c);
    }
    const totalValue = (itemsByPo.get(k) ?? []).reduce((s, i) => s + i.unit_cost * i.quantity, 0);
    aggByPo.set(k, { settled, costPool: pool, totalValue });
  }

  interface Acc { wSum: number; wQty: number; latestDate: string; latestTuc: number; latestXr: number | null; poIds: Set<string>; entries: CostEntry[] }
  const acc = new Map<string, Acc>();

  for (const item of poItems) {
    if (!item.component_id || item.quantity <= 0) continue;
    const k = String(item.po_id);
    const po = poMap.get(k);
    const agg = aggByPo.get(k);
    if (!po || !agg || !agg.settled || agg.totalValue <= 0) continue;

    const share = (item.unit_cost * item.quantity) / agg.totalValue;
    const tuc = (share * agg.costPool) / item.quantity;
    if (tuc <= 0) continue;

    const cid = item.component_id;
    if (!acc.has(cid)) acc.set(cid, { wSum: 0, wQty: 0, latestDate: '', latestTuc: 0, latestXr: null, poIds: new Set(), entries: [] });
    const a = acc.get(cid)!;
    a.wSum += tuc * item.quantity;
    a.wQty += item.quantity;
    a.poIds.add(k);
    a.entries.push({ kind: 'tuc', label: po.po_number || `PO ${po.po_id}`, date: po.po_date ?? '', unitCost: tuc });
    if ((po.po_date ?? '') > a.latestDate) {
      a.latestDate = po.po_date ?? '';
      a.latestTuc = tuc;
      a.latestXr = Number(po.exchange_rate) || null;
    }
  }

  const result = new Map<string, TUCResult>();
  for (const [cid, a] of acc) {
    if (a.wQty <= 0) continue;
    const avgTuc = a.wSum / a.wQty;
    a.entries.sort((x, y) => y.date.localeCompare(x.date));
    result.set(cid, {
      tuc: Math.max(a.latestTuc, avgTuc),
      avgTuc,
      latestTuc: a.latestTuc,
      latestPoDate: a.latestDate,
      latestXr: a.latestXr,
      poCount: a.poIds.size,
      entries: a.entries,
    });
  }
  return result;
}

/**
 * Single-component convenience wrapper. For loops over many components, build
 * the map once with computeTUCMap instead.
 */
export function computeTUC(
  componentId: string,
  pos: PurchaseOrder[],
  poItems: PurchaseLineItem[],
  poCosts: POCost[],
): TUCResult | null {
  return computeTUCMap(pos, poItems, poCosts).get(componentId) ?? null;
}

/**
 * Price-quote history for a component (IDR), newest first.
 * Quote lines carry no exchange rate, so foreign currencies use FX fallbacks.
 */
export function quotePriceHistory(
  componentId: string,
  quotes: PriceQuote[],
  quoteItems: PriceQuoteLineItem[],
): CostEntry[] {
  const entries: CostEntry[] = [];
  for (const li of quoteItems) {
    if (li.component_id !== componentId) continue;
    const q = quotes.find((x) => x.quote_id === li.quote_id);
    if (!q) continue;
    const cur = li.currency || q.currency;
    const idr = cur === 'IDR' ? Number(li.unit_price) : Number(li.unit_price) * (FX[cur] || 1);
    if (idr <= 0) continue;
    entries.push({
      kind: 'quote',
      label: q.pi_number || `Quote ${q.quote_id}`,
      date: q.quote_date ?? '',
      unitCost: idr,
    });
  }
  entries.sort((a, b) => b.date.localeCompare(a.date));
  return entries;
}

/**
 * Recommended cost for a component with full price history.
 * Prefers TUC from settled POs; when no TUC exists, falls back to the newest
 * of: supplier price-quote line (FX-converted) or the cost last used in a
 * previous project quote (usedEntries, supplied by the caller).
 *
 * Pass a precomputed tucMap (from computeTUCMap) — callers looping over many
 * components must build it once.
 *
 * opts: the per-product Cost Basis setting for Project Quotes
 * (3.0_components.quote_cost_mode / quote_cost_buffer_pct + global default):
 * - mode 'tuc'       → raw TUC (Catalog/Insights callers never pass opts, so
 *                      they always get this).
 * - mode 'buffered'  → Cost Basis: TUC × (1 + bufferPct/100). Every per-PO TUC
 *                      history entry carries the same multiplier so the raw
 *                      number never leaks; result is flagged `buffered`.
 * - mode 'hidden'    → TUC neither recommended nor listed — the fallback order
 *                      (supplier quote / last-used cost) takes over.
 */
export function getComponentCost(
  componentId: string,
  tucMap: Map<string, TUCResult>,
  quotes: PriceQuote[],
  quoteItems: PriceQuoteLineItem[],
  usedEntries: CostEntry[] = [],
  opts?: QuoteCostOpts,
): ComponentCost | null {
  const mode: QuoteCostMode = opts?.mode ?? 'tuc';
  const mul = mode === 'buffered' ? 1 + (Math.max(0, opts?.bufferPct ?? 0) / 100) : 1;
  const raw = mode === 'hidden' ? null : (tucMap.get(componentId) ?? null);
  const buffered = mul !== 1 && !!raw;

  const tucEntries = (raw?.entries ?? []).map((e) =>
    mul === 1 ? e : { ...e, unitCost: e.unitCost * mul });
  const quoteEntries = quotePriceHistory(componentId, quotes, quoteItems);

  const history = [...tucEntries, ...quoteEntries, ...usedEntries]
    .sort((a, b) => b.date.localeCompare(a.date));

  if (raw) return { cost: raw.tuc * mul, source: 'tuc', asOf: raw.latestPoDate, history, buffered };
  const fallback = history.find((h) => h.kind !== 'tuc');
  if (fallback) return { cost: fallback.unitCost, source: fallback.kind, asOf: fallback.date, history };
  return null;
}

/** Days since an ISO date; Infinity when unknown. */
export function priceAgeDays(asOf: string): number {
  if (!asOf) return Infinity;
  const t = new Date(asOf).getTime();
  if (isNaN(t)) return Infinity;
  return Math.floor((Date.now() - t) / 86_400_000);
}

/** A price is "aged" when its source is older than ~6 months. */
export const AGED_PRICE_DAYS = 180;

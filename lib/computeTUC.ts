import type { PurchaseOrder, PurchaseLineItem, POCost, PriceQuote, PriceQuoteLineItem } from '../types/database';
import { PRINCIPAL_CATS, BANK_FEE_CATS, TAX_CATS } from '../constants/costCategories';

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
  tuc: number;
  latestPoDate: string;
  poCount: number;
  entries: CostEntry[];
}

export interface ComponentCost {
  cost: number;             // recommended cost — see getComponentCost for the fallback order
  source: CostKind;
  history: CostEntry[];     // all TUC + quote + last-used entries, newest first
}

/**
 * Compute weighted-average True Unit Cost (IDR) for a component across all settled POs.
 * Same logic as ProductCostLookup — principal + bank fees + landed costs, allocated by
 * line share of PO value, divided by quantity.
 */
export function computeTUC(
  componentId: string,
  pos: PurchaseOrder[],
  poItems: PurchaseLineItem[],
  poCosts: POCost[],
  quotes: PriceQuote[],
): TUCResult | null {
  void quotes; // reserved for future supplier resolution

  const costsByPo = new Map<number, POCost[]>();
  for (const c of poCosts) {
    const arr = costsByPo.get(c.po_id) ?? [];
    arr.push(c);
    costsByPo.set(c.po_id, arr);
  }
  const itemsByPo = new Map<number, PurchaseLineItem[]>();
  for (const i of poItems) {
    const arr = itemsByPo.get(i.po_id) ?? [];
    arr.push(i);
    itemsByPo.set(i.po_id, arr);
  }

  const toIdr = (c: POCost, poExRate: number) =>
    c.currency === 'IDR' ? Number(c.amount) :
    Number(c.amount) * (Number(c.exchange_rate) || poExRate || 1);

  let wSum = 0, wQty = 0, latestDate = '';
  const seen = new Set<number>();
  const entries: CostEntry[] = [];

  for (const item of poItems) {
    if (item.component_id !== componentId) continue;

    const po = pos.find((p) => p.po_id === item.po_id);
    if (!po) continue;

    const costs = costsByPo.get(po.po_id) ?? [];
    if (!costs.length) continue;

    const allItems = itemsByPo.get(po.po_id) ?? [];
    const totalFx = allItems.reduce((s, i) => s + i.unit_cost * i.quantity, 0);
    if (totalFx === 0 || item.quantity === 0) continue;

    const share = (item.unit_cost * item.quantity) / totalFx;
    const exRate = Number(po.exchange_rate) || 1;

    const principal = costs.filter((c) => PRINCIPAL_CATS.has(c.cost_category)).reduce((s, c) => s + toIdr(c, exRate), 0);
    const bank     = costs.filter((c) => BANK_FEE_CATS.has(c.cost_category)).reduce((s, c) => s + toIdr(c, exRate), 0);
    const landed   = costs.filter((c) => !PRINCIPAL_CATS.has(c.cost_category) && !BANK_FEE_CATS.has(c.cost_category) && !TAX_CATS.has(c.cost_category)).reduce((s, c) => s + toIdr(c, exRate), 0);

    const tuc = (share * (principal + bank + landed)) / item.quantity;
    if (tuc <= 0) continue;

    wSum += tuc * item.quantity;
    wQty += item.quantity;
    seen.add(po.po_id);
    if ((po.po_date ?? '') > latestDate) latestDate = po.po_date ?? '';
    entries.push({ kind: 'tuc', label: po.po_number || `PO ${po.po_id}`, date: po.po_date ?? '', unitCost: tuc });
  }

  if (wQty === 0) return null;
  entries.sort((a, b) => b.date.localeCompare(a.date));
  return { tuc: wSum / wQty, latestPoDate: latestDate, poCount: seen.size, entries };
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
 * Prefers weighted-average TUC from settled POs; when no TUC exists, falls back
 * to the newest of: supplier price-quote line (FX-converted) or the cost last
 * used in a previous project quote (usedEntries, supplied by the caller).
 */
export function getComponentCost(
  componentId: string,
  pos: PurchaseOrder[],
  poItems: PurchaseLineItem[],
  poCosts: POCost[],
  quotes: PriceQuote[],
  quoteItems: PriceQuoteLineItem[],
  usedEntries: CostEntry[] = [],
): ComponentCost | null {
  const tuc = computeTUC(componentId, pos, poItems, poCosts, quotes);
  const quoteEntries = quotePriceHistory(componentId, quotes, quoteItems);

  const history = [...(tuc?.entries ?? []), ...quoteEntries, ...usedEntries]
    .sort((a, b) => b.date.localeCompare(a.date));

  if (tuc) return { cost: tuc.tuc, source: 'tuc', history };
  const fallback = history.find((h) => h.kind !== 'tuc');
  if (fallback) return { cost: fallback.unitCost, source: fallback.kind, history };
  return null;
}

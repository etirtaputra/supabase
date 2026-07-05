import type { PurchaseOrder, PurchaseLineItem, POCost, PriceQuote } from '../types/database';
import { PRINCIPAL_CATS, BANK_FEE_CATS, TAX_CATS } from '../constants/costCategories';

export interface TUCResult {
  tuc: number;
  latestPoDate: string;
  poCount: number;
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
  }

  if (wQty === 0) return null;
  return { tuc: wSum / wQty, latestPoDate: latestDate, poCount: seen.size };
}

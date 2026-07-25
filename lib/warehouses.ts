/**
 * Warehouse master (30.3_warehouses) helpers.
 *
 * Stock is tracked per (component, warehouse): 30.1_stock_balances is keyed
 * that way and the moving-average cost is maintained per warehouse, so each
 * location carries its own quantity AND its own unit cost. Anything that
 * aggregates across warehouses must SUM quantities and take a QUANTITY-WEIGHTED
 * average cost — never just read the last row.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface Warehouse {
  code: string; name: string; address?: string;
  is_active: boolean; is_default: boolean; sort_order: number;
}

export interface BalanceRow { component_id: string; location: string; qty_on_hand: number; avg_cost_idr: number | null }

/** Active warehouses in display order (default first among equals). */
export async function fetchWarehouses(supabase: SupabaseClient): Promise<Warehouse[]> {
  const { data, error } = await supabase.from('30.3_warehouses')
    .select('code, name, address, is_active, is_default, sort_order')
    .order('sort_order');
  if (error || !data) return [];
  return (data as Warehouse[]).filter((w) => w.is_active !== false);
}

export const defaultWarehouse = (list: Warehouse[]): string =>
  list.find((w) => w.is_default)?.code ?? list[0]?.code ?? 'MAIN';

export const warehouseLabel = (list: Warehouse[], code: string): string =>
  list.find((w) => w.code === code)?.name || code;

/**
 * Roll balance rows up per component across every warehouse.
 * qty = Σ qty; avg = Σ(qty × avg) ÷ Σ qty (quantity-weighted — a plain "last
 * row wins" is wrong the moment an item sits in two warehouses at different
 * landed costs).
 */
export function rollUpByComponent(rows: BalanceRow[]): Map<string, { qty: number; avg: number; value: number }> {
  const acc = new Map<string, { qty: number; value: number }>();
  for (const r of rows) {
    const qty = Number(r.qty_on_hand) || 0;
    const avg = Number(r.avg_cost_idr) || 0;
    const e = acc.get(r.component_id) ?? { qty: 0, value: 0 };
    e.qty += qty;
    e.value += qty * avg;              // value carries the per-warehouse cost
    acc.set(r.component_id, e);
  }
  const out = new Map<string, { qty: number; avg: number; value: number }>();
  for (const [cid, e] of acc) {
    out.set(cid, { qty: e.qty, avg: e.qty > 0 ? e.value / e.qty : 0, value: e.value });
  }
  return out;
}

/** Same weighted roll-up for a single component's rows. */
export function rollUpOne(rows: { qty_on_hand: number; avg_cost_idr: number | null }[]): { qty: number; avg: number } {
  let qty = 0, value = 0;
  for (const r of rows) {
    const q = Number(r.qty_on_hand) || 0;
    qty += q;
    value += q * (Number(r.avg_cost_idr) || 0);
  }
  return { qty, avg: qty > 0 ? value / qty : 0 };
}

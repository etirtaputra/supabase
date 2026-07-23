import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Split-fulfillment reservation input: quantities already DELIVERED per
 * (order, component) via 24.x Delivery Orders. Reserved stock on a committed
 * order = ordered qty − this — partial shipments release their share of the
 * reserve (the shipped units already left Physical via the stock ledger).
 * Returns a map keyed `${quote_id}·${component_id}`; empty on any error
 * (callers then fall back to the pre-split behaviour).
 */
export async function fetchDeliveredByQuoteComp(supabase: SupabaseClient): Promise<Map<string, number>> {
  const [doRes, itemRes] = await Promise.all([
    supabase.from('24.0_delivery_orders').select('do_id, quote_id, status'),
    supabase.from('24.1_delivery_order_items').select('do_id, component_id, qty'),
  ]);
  const m = new Map<string, number>();
  if (doRes.error || itemRes.error) return m;
  const quoteByDo = new Map(
    ((doRes.data ?? []) as { do_id: string; quote_id: string; status: string }[])
      .filter((d) => d.status === 'delivered')
      .map((d) => [d.do_id, d.quote_id]),
  );
  for (const it of ((itemRes.data ?? []) as { do_id: string; component_id: string | null; qty: number }[])) {
    const qid = quoteByDo.get(it.do_id);
    if (!qid || !it.component_id) continue;
    const k = `${qid}·${it.component_id}`;
    m.set(k, (m.get(k) ?? 0) + (Number(it.qty) || 0));
  }
  return m;
}

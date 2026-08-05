/**
 * Stock Reorder Alerts — "order it BEFORE the shortage exists".
 *
 * The Shortages panel answers "which committed orders can't ship today?".
 * This engine answers the question one step earlier: given how fast an item
 * actually moves and how long its supplier actually takes, is today the day
 * to raise the next PO?
 *
 * The algorithm (classic reorder-point, built from numbers ICAPROC already
 * measures — nothing is typed in by hand):
 *
 *   daily demand  d  = outbound stock movements over the last 90 days ÷ 90
 *                      (the stock moving average; warehouse transfers excluded)
 *   lead time     L  = measured PO → goods-receipt days for THIS item
 *                      (the same number Deal Lookup / the item hub shows);
 *                      fallback: the average across all received POs, else 30d
 *   safety stock  S  = d × max(7 days, 25% of L)
 *                      (buffer for demand spikes and late shipments)
 *   reorder point ROP = d × L + S
 *   pipeline          = live stock (on-hand − reserved) + qty on open POs
 *
 *   ALERT when pipeline ≤ ROP        → time to order (amber)
 *   URGENT when pipeline < d × L     → even a PO raised today lands after the
 *                                      projected stock-out (red)
 *   suggested qty = d × (L + safety + 30d runway) − pipeline
 *
 * Items with no outbound movement in the window never alert — a dead item is
 * a clearance problem, not a reorder problem.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { COMMITTED_STATUSES } from './salesStatus';
import { fetchDeliveredByQuoteComp } from './reservedStock';

/** PO statuses that mean "ordered, on the way, not yet fully arrived" —
 *  the same set Products and the item hub use for their Incoming figures. */
export const INCOMING_PO_STATUSES = new Set(['Sent', 'Confirmed', 'Partially Received']);

export const DEMAND_WINDOW_DAYS = 90;
const FALLBACK_LEAD_DAYS = 30;
const RUNWAY_DAYS = 30;   // suggested order lands this far above the ROP

export interface ReorderAlert {
  component_id: string;
  name: string;
  model: string;
  unit: string | null;
  live: number;             // on-hand − reserved on committed orders
  incoming: number;         // qty on open (not fully received) POs
  dailyDemand: number;      // moving average over DEMAND_WINDOW_DAYS
  leadDays: number;
  leadMeasured: boolean;    // false = fallback (global avg or default)
  safetyDays: number;
  reorderPoint: number;
  /** Days until the pipeline runs dry at the current demand rate. */
  coverDays: number;
  suggestedQty: number;
  urgent: boolean;          // stock-out projected before a PO raised today lands
}

export async function fetchReorderAlerts(supabase: SupabaseClient): Promise<ReorderAlert[]> {
  const since = new Date(Date.now() - DEMAND_WINDOW_DAYS * 86_400_000).toISOString();
  const [balRes, movRes, poRes, poiRes, sqRes, sqiRes, delivered] = await Promise.all([
    supabase.from('30.1_stock_balances').select('component_id, qty_on_hand'),
    supabase.from('30.0_stock_movements')
      .select('component_id, quantity, source_type')
      .eq('direction', 'out').neq('source_type', 'transfer').gte('moved_at', since)
      .limit(20000),
    supabase.from('5.0_purchases').select('po_id, status, po_date, actual_received_date'),
    supabase.from('5.1_purchase_line_items').select('po_id, component_id, quantity').limit(8000),
    supabase.from('22.0_sales_quotes').select('quote_id, status'),
    supabase.from('22.1_sales_quote_items').select('quote_id, component_id, quantity, is_section'),
    fetchDeliveredByQuoteComp(supabase),
  ]);
  if (balRes.error || movRes.error || poRes.error || poiRes.error) return [];

  // Demand: the stock ledger's own outbound average
  const demand = new Map<string, number>();
  for (const m of (movRes.data ?? []) as { component_id: string; quantity: number }[]) {
    demand.set(m.component_id, (demand.get(m.component_id) ?? 0) + (Number(m.quantity) || 0));
  }
  if (demand.size === 0) return [];

  // On-hand and reserved → live
  const onHand = new Map<string, number>();
  for (const b of (balRes.data ?? []) as { component_id: string; qty_on_hand: number }[]) {
    onHand.set(b.component_id, (onHand.get(b.component_id) ?? 0) + (Number(b.qty_on_hand) || 0));
  }
  const reserved = new Map<string, number>();
  if (!sqRes.error && !sqiRes.error) {
    const committed = new Set(((sqRes.data ?? []) as { quote_id: string; status: string }[])
      .filter((q) => COMMITTED_STATUSES.has(q.status)).map((q) => q.quote_id));
    for (const it of (sqiRes.data ?? []) as { quote_id: string; component_id: string | null; quantity: number; is_section: boolean }[]) {
      if (!it.component_id || it.is_section || !committed.has(it.quote_id)) continue;
      const open = Math.max(0, (Number(it.quantity) || 0) - (delivered.get(`${it.quote_id}·${it.component_id}`) ?? 0));
      if (open > 0) reserved.set(it.component_id, (reserved.get(it.component_id) ?? 0) + open);
    }
  }

  // Incoming on open POs + measured lead time per item (Deal Lookup's number)
  const pos = (poRes.data ?? []) as { po_id: string | number; status: string | null; po_date: string | null; actual_received_date: string | null }[];
  const poById = new Map(pos.map((p) => [String(p.po_id), p]));
  const incoming = new Map<string, number>();
  const leadSamples = new Map<string, number[]>();
  const seenPoComp = new Set<string>();
  const allLeads: number[] = [];
  const globalSeen = new Set<string>();
  for (const p of pos) {
    if (p.actual_received_date && p.po_date && !globalSeen.has(String(p.po_id))) {
      globalSeen.add(String(p.po_id));
      const d = Math.round((new Date(p.actual_received_date).getTime() - new Date(p.po_date).getTime()) / 86_400_000);
      if (d >= 0) allLeads.push(d);
    }
  }
  for (const it of (poiRes.data ?? []) as { po_id: string | number; component_id: string | null; quantity: number }[]) {
    if (!it.component_id) continue;
    const po = poById.get(String(it.po_id));
    if (!po) continue;
    if (INCOMING_PO_STATUSES.has(po.status ?? '')) {
      incoming.set(it.component_id, (incoming.get(it.component_id) ?? 0) + (Number(it.quantity) || 0));
    }
    const k = `${it.po_id}·${it.component_id}`;
    if (po.actual_received_date && po.po_date && !seenPoComp.has(k)) {
      seenPoComp.add(k);
      const d = Math.round((new Date(po.actual_received_date).getTime() - new Date(po.po_date).getTime()) / 86_400_000);
      if (d >= 0) leadSamples.set(it.component_id, [...(leadSamples.get(it.component_id) ?? []), d]);
    }
  }
  const globalLead = allLeads.length ? allLeads.reduce((s, d) => s + d, 0) / allLeads.length : FALLBACK_LEAD_DAYS;

  // The verdict per moving item
  const hits: Omit<ReorderAlert, 'name' | 'model' | 'unit'>[] = [];
  for (const [cid, outQty] of demand) {
    const d = outQty / DEMAND_WINDOW_DAYS;
    if (d <= 0) continue;
    const samples = leadSamples.get(cid);
    const leadMeasured = !!samples?.length;
    const leadDays = leadMeasured ? samples!.reduce((s, x) => s + x, 0) / samples!.length : globalLead;
    const safetyDays = Math.max(7, leadDays * 0.25);
    const reorderPoint = d * (leadDays + safetyDays);
    const live = (onHand.get(cid) ?? 0) - (reserved.get(cid) ?? 0);
    const inc = incoming.get(cid) ?? 0;
    const pipeline = live + inc;
    if (pipeline > reorderPoint) continue;
    hits.push({
      component_id: cid,
      live, incoming: inc, dailyDemand: d,
      leadDays, leadMeasured, safetyDays, reorderPoint,
      coverDays: pipeline > 0 ? pipeline / d : 0,
      suggestedQty: Math.max(0, Math.ceil(d * (leadDays + safetyDays + RUNWAY_DAYS) - pipeline)),
      urgent: pipeline < d * leadDays,
    });
  }
  if (!hits.length) return [];

  // Names only for the items that alert (chunked .in() — the list is small)
  const names = new Map<string, { name: string; model: string; unit: string | null }>();
  const ids = hits.map((h) => h.component_id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('3.0_components')
      .select('component_id, supplier_model, internal_description, unit')
      .in('component_id', ids.slice(i, i + 200));
    for (const c of (data ?? []) as { component_id: string; supplier_model: string; internal_description: string | null; unit: string | null }[]) {
      names.set(c.component_id, { name: c.internal_description || c.supplier_model || c.component_id, model: c.supplier_model ?? '', unit: c.unit });
    }
  }

  return hits
    .map((h) => ({ ...h, ...(names.get(h.component_id) ?? { name: h.component_id, model: '', unit: null }) }))
    .sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.coverDays - b.coverDays);
}

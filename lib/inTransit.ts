/**
 * Goods on the water — the money that has left (often PREPAID on imports, which
 * is what makes ICAPROC's DPO negative) while the goods it bought are not yet in
 * the warehouse. No screen used to name this capital; it hid between "we owe"
 * (a liability) and "on hand" (an asset it hasn't become).
 *
 * The unit is the OPEN purchase order — Sent / Confirmed / Partially Received,
 * i.e. ordered, not yet fully arrived (the same set Products and the item hub
 * use for "Incoming"). For each open PO we work out when it should land:
 *
 *   expected arrival = estimated_delivery_date, if the PO carries one
 *                      else po_date + measured lead time (this SUPPLIER's own
 *                      average PO→goods-receipt days, falling back to the global
 *                      average across all received POs, then 30d)
 *
 * A PO past its expected arrival with nothing received is OVERDUE — cash out the
 * door, late, and worth a phone call. Paid capital is read the same way the AP
 * tile reads it (PRINCIPAL_CATS at the recorded rate); a PO whose rate was never
 * recorded cannot be valued and is counted aside, never taken at face value.
 *
 * Pure and exported for tests; no fetch, no React. The fetch wrappers that feed
 * the dashboard and the item lists call these with rows they already hold.
 */
// Relative import keeps this runnable under `node --test` (no @/ alias there)
import type { SupabaseClient } from '@supabase/supabase-js';
import { PRINCIPAL_CATS } from '../constants/costCategories.ts';

/** Ordered, on the way, not yet fully arrived — the "Incoming" set, one owner. */
export const INCOMING_PO_STATUSES = new Set(['Sent', 'Confirmed', 'Partially Received']);

/** No ETA and no supplier/global history to lean on: assume a month at sea. */
export const FALLBACK_LEAD_DAYS = 30;

// ── Row shapes (only the columns the math reads) ─────────────────────────────
export interface OpenPo {
  po_id: string | number;
  po_number: string | null;
  status: string | null;
  po_date: string | null;
  estimated_delivery_date: string | null;
  supplier_id: string | null;
  currency: string;
  exchange_rate: number | null;
  total_value: number;
}
/** A received PO, for measuring how long its supplier actually takes. */
export interface ReceivedPo { supplier_id: string | null; po_date: string | null; actual_received_date: string | null }
export interface PoCost { po_id: string | number; cost_category: string; amount: number; currency: string; exchange_rate: number | null }

const day = (iso: string): number => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
/** a − b, whole days. */
const dayDiff = (a: string, b: string): number => Math.round((day(a) - day(b)) / 86_400_000);
const addDays = (iso: string, n: number): string => {
  const d = new Date(day(iso));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ── Measured lead time ───────────────────────────────────────────────────────
export interface LeadInfo {
  /** supplier_id → average PO→goods-receipt days (only suppliers with history). */
  bySupplier: Map<string, number>;
  /** Average across every received PO, or FALLBACK_LEAD_DAYS if none. */
  global: number;
}

const avg = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

export function measureLead(received: ReceivedPo[]): LeadInfo {
  const bySup = new Map<string, number[]>();
  const all: number[] = [];
  for (const r of received) {
    if (!r.po_date || !r.actual_received_date) continue;
    const d = dayDiff(r.actual_received_date, r.po_date);
    if (d < 0) continue;                       // a received-before-ordered date is bad data
    all.push(d);
    const k = r.supplier_id ?? '';
    if (k) bySup.set(k, [...(bySup.get(k) ?? []), d]);
  }
  const bySupplier = new Map<string, number>();
  for (const [k, xs] of bySup) if (xs.length) bySupplier.set(k, avg(xs));
  return { bySupplier, global: all.length ? avg(all) : FALLBACK_LEAD_DAYS };
}

// ── Expected arrival for one PO ──────────────────────────────────────────────
export type EtaSource = 'eta' | 'lead' | null;
export interface Expected { expected: string | null; source: EtaSource; leadDays: number | null }

export function expectedArrival(
  po: Pick<OpenPo, 'estimated_delivery_date' | 'po_date' | 'supplier_id'>,
  lead: LeadInfo,
): Expected {
  if (po.estimated_delivery_date) return { expected: po.estimated_delivery_date.slice(0, 10), source: 'eta', leadDays: null };
  if (po.po_date) {
    const supLead = po.supplier_id ? lead.bySupplier.get(po.supplier_id) : undefined;
    const L = Math.round(supLead ?? lead.global);
    return { expected: addDays(po.po_date, L), source: 'lead', leadDays: L };
  }
  return { expected: null, source: null, leadDays: null };
}

// ── Dashboard summary: capital on the water + the overdue slice ──────────────
export interface InTransitPo {
  po_id: string;
  po_number: string | null;
  supplier_id: string | null;
  status: string | null;
  expected: string | null;
  etaSource: EtaSource;
  /** > 0 late, < 0 upcoming, null when the PO carries neither ETA nor po_date. */
  daysLate: number | null;
  overdue: boolean;
  valueIdr: number;      // PO total in IDR (0 when the rate is missing)
  noRate: boolean;
  paidIdr: number;       // principal payments already made against this PO
}

export interface InTransitSummary {
  count: number;
  valueIdr: number;         // Σ PO value of rated open POs
  paidIdr: number;          // Σ principal paid on open POs — the cash on the water
  overdueCount: number;
  overduePaidIdr: number;
  overdueValueIdr: number;
  /** Oldest overdue PO, in days late (0 when nothing is overdue). */
  maxDaysLate: number;
  excludedNoRate: number;
  pos: InTransitPo[];       // overdue first, then most money at stake
}

function paidByPo(costs: PoCost[]): Map<string, number> {
  const paid = new Map<string, number>();
  for (const c of costs) {
    if (!PRINCIPAL_CATS.has(c.cost_category)) continue;
    const idr = c.currency === 'IDR' ? Number(c.amount) : Number(c.amount) * (Number(c.exchange_rate) || 0);
    paid.set(String(c.po_id), (paid.get(String(c.po_id)) ?? 0) + (idr || 0));
  }
  return paid;
}

export function computeInTransit(
  pos: OpenPo[], costs: PoCost[], received: ReceivedPo[], nowIso: string,
): InTransitSummary {
  const lead = measureLead(received);
  const today = nowIso.slice(0, 10);
  const paid = paidByPo(costs);

  const rows: InTransitPo[] = [];
  for (const po of pos) {
    if (!INCOMING_PO_STATUSES.has(po.status ?? '')) continue;
    const { expected, source } = expectedArrival(po, lead);
    const daysLate = expected ? dayDiff(today, expected) : null;
    const overdue = daysLate != null && daysLate > 0;
    const rate = po.currency === 'IDR' ? 1 : Number(po.exchange_rate) || 0;
    const totalIdr = (Number(po.total_value) || 0) * rate;
    const noRate = (Number(po.total_value) || 0) > 0 && rate === 0;
    rows.push({
      po_id: String(po.po_id), po_number: po.po_number, supplier_id: po.supplier_id, status: po.status ?? null,
      expected, etaSource: source, daysLate, overdue,
      valueIdr: noRate ? 0 : totalIdr, noRate,
      paidIdr: paid.get(String(po.po_id)) ?? 0,
    });
  }
  rows.sort((a, b) =>
    Number(b.overdue) - Number(a.overdue) || (b.paidIdr - a.paidIdr) || (b.valueIdr - a.valueIdr));

  const s: InTransitSummary = {
    count: rows.length, valueIdr: 0, paidIdr: 0,
    overdueCount: 0, overduePaidIdr: 0, overdueValueIdr: 0, maxDaysLate: 0,
    excludedNoRate: 0, pos: rows,
  };
  for (const r of rows) {
    s.valueIdr += r.valueIdr;
    s.paidIdr += r.paidIdr;
    if (r.noRate) s.excludedNoRate += 1;
    if (r.overdue) {
      s.overdueCount += 1;
      s.overduePaidIdr += r.paidIdr;
      s.overdueValueIdr += r.valueIdr;
      if (r.daysLate != null && r.daysLate > s.maxDaysLate) s.maxDaysLate = r.daysLate;
    }
  }
  return s;
}

// ── Per-item arrival, for the "Incoming" chips on Products / the item hub ─────
export interface ItemArrival {
  /** Earliest expected arrival across the item's open POs. */
  nearest: string | null;
  source: EtaSource;
  /** True when any open PO for this item is already past its expected arrival. */
  overdue: boolean;
}

export function itemArrivals(
  openLines: { po_id: string | number; component_id: string | null }[],
  pos: OpenPo[], received: ReceivedPo[], nowIso: string,
): Map<string, ItemArrival> {
  const lead = measureLead(received);
  const today = nowIso.slice(0, 10);
  const exp = new Map<string, { expected: string | null; source: EtaSource; overdue: boolean }>();
  for (const po of pos) {
    if (!INCOMING_PO_STATUSES.has(po.status ?? '')) continue;
    const { expected, source } = expectedArrival(po, lead);
    exp.set(String(po.po_id), { expected, source, overdue: !!expected && dayDiff(today, expected) > 0 });
  }

  const out = new Map<string, ItemArrival>();
  for (const li of openLines) {
    if (!li.component_id) continue;
    const e = exp.get(String(li.po_id));
    if (!e) continue;                                  // not an open PO — no arrival to show
    const cur = out.get(li.component_id);
    if (!cur) { out.set(li.component_id, { nearest: e.expected, source: e.source, overdue: e.overdue }); continue; }
    // Keep the earliest expected date; overdue if ANY of the item's open POs is late
    const takeEarlier = !!e.expected && (!cur.nearest || e.expected < cur.nearest);
    out.set(li.component_id, {
      nearest: takeEarlier ? e.expected : cur.nearest,
      source: takeEarlier ? e.source : cur.source,
      overdue: cur.overdue || e.overdue,
    });
  }
  return out;
}

// ── Fetch wrapper (independent, so a slow read never blocks the /stock view) ──
export async function fetchInTransit(
  supabase: SupabaseClient, nowIso = new Date().toISOString(),
): Promise<InTransitSummary> {
  const [poRes, costRes] = await Promise.all([
    supabase.from('5.0_purchases').select('po_id, po_number, status, po_date, estimated_delivery_date, supplier_id, currency, exchange_rate, total_value, actual_received_date'),
    supabase.from('6.0_po_costs').select('po_id, cost_category, amount, currency, exchange_rate'),
  ]);
  const pos = (poRes.data ?? []) as unknown as OpenPo[];
  return computeInTransit(pos, (costRes.data ?? []) as PoCost[], pos as unknown as ReceivedPo[], nowIso);
}

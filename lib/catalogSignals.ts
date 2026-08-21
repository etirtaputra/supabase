/**
 * Two questions an item-centric ERP should answer before anyone asks:
 * WHAT JUST LANDED that we can sell, and WHAT IS ON ITS WAY.
 *
 * Both are about the same pivot — the item — read from opposite ends of the
 * cycle. Neither invents a source: "just landed" is the goods-receipt ledger
 * (30.0), "on its way" is the open purchase order, read through the SAME
 * expected-arrival engine `/products` and the in-transit tile already use. A
 * date shown here and a date shown there can never disagree, because there is
 * only one of them.
 *
 * SELL-SIDE SAFE BY CONSTRUCTION. Neither answer needs a cost, a supplier or a
 * PO number, so the fetchers do not request them unless the role is buy-side —
 * the /products network-tab rule: a column a role may not see is never
 * fetched, not merely not rendered.
 *
 * Pure functions plus thin fetchers, so the maths is unit-tested without a
 * database and the dashboard and any future screen share one answer.
 */
// Relative imports keep this runnable under `node --test` (no @/ alias there)
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  INCOMING_PO_STATUSES, itemArrivalDetails, measureLead, expectedArrival,
  type OpenPo, type ReceivedPo, type EtaSource,
} from './inTransit.ts';

// ── Row shapes (only the columns the maths reads) ────────────────────────────
export interface ReceiptMove { component_id: string | null; moved_at: string | null }
export interface CompRow {
  component_id: string;
  internal_description: string | null;
  supplier_model: string | null;
  unit: string | null;
  selling_price_idr: number | string | null;
}
export interface BalanceRow { component_id: string; qty_on_hand: number | string | null }
export interface PoLine { po_id: string | number; component_id: string | null; quantity: number | string | null }

const day = (iso: string): number => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
const daysBetween = (a: string, b: string): number => Math.round((day(a) - day(b)) / 86_400_000);
/** What to call an item on screen: our own words first, the supplier's second. */
export const itemName = (c: CompRow): string =>
  (c.internal_description || '').trim() || (c.supplier_model || '').trim() || 'Unnamed item';
const num = (v: unknown): number => Number(v) || 0;

// ── What just landed ─────────────────────────────────────────────────────────

/** The first and last day we ever booked this item into the warehouse. */
export interface FirstLast { first: string; last: string }

export function receiptDates(moves: ReceiptMove[]): Map<string, FirstLast> {
  const out = new Map<string, FirstLast>();
  for (const m of moves) {
    const d = (m.moved_at ?? '').slice(0, 10);
    if (!d || !m.component_id) continue;
    const e = out.get(m.component_id);
    if (!e) out.set(m.component_id, { first: d, last: d });
    else { if (d < e.first) e.first = d; if (d > e.last) e.last = d; }
  }
  return out;
}

export interface NewArrival {
  component_id: string;
  name: string;
  unit: string | null;
  /** On hand now — what a salesperson can actually promise. */
  qty: number;
  /** The day it came in (its most recent receipt inside the window). */
  arrivedAt: string;
  daysAgo: number;
  /**
   * The FIRST time we have ever received this item: a product that is new to
   * the business, not a restock of something we have always carried. The
   * distinction is the whole point — one is news, the other is replenishment.
   */
  brandNew: boolean;
  /**
   * No selling price recorded, so it cannot be quoted as it stands. This is
   * the actionable half: goods on the shelf that nobody can sell.
   */
  needsPrice: boolean;
}

/**
 * Items received within the window, newest first, brand-new ones leading.
 *
 * The window is a setting rather than a constant because what counts as "new"
 * is a trading judgement, not a fact: a fortnight is right for fast movers and
 * far too short for a business whose containers land quarterly.
 */
export function newArrivals(
  comps: CompRow[],
  receipts: Map<string, FirstLast>,
  balances: BalanceRow[],
  opts: { days: number; nowIso: string },
): NewArrival[] {
  const today = opts.nowIso.slice(0, 10);
  const cutoff = new Date(day(today) - opts.days * 86_400_000).toISOString().slice(0, 10);
  const onHand = new Map<string, number>();
  for (const b of balances) {
    if (!b.component_id) continue;
    onHand.set(b.component_id, (onHand.get(b.component_id) ?? 0) + num(b.qty_on_hand));
  }

  const out: NewArrival[] = [];
  for (const c of comps) {
    const r = receipts.get(c.component_id);
    if (!r || r.last < cutoff) continue;
    out.push({
      component_id: c.component_id,
      name: itemName(c),
      unit: c.unit,
      qty: onHand.get(c.component_id) ?? 0,
      arrivedAt: r.last,
      daysAgo: daysBetween(today, r.last),
      brandNew: r.first >= cutoff,
      needsPrice: !(num(c.selling_price_idr) > 0),
    });
  }
  // Newest first; a brand-new item outranks a restock that landed the same day.
  return out.sort((a, b) =>
    b.arrivedAt.localeCompare(a.arrivedAt)
    || Number(b.brandNew) - Number(a.brandNew)
    || a.name.localeCompare(b.name));
}

// ── What is on its way ───────────────────────────────────────────────────────

export interface ArrivingItem {
  component_id: string;
  name: string;
  unit: string | null;
  /** Quantity on open POs — the same "Incoming" definition /products uses. */
  qty: number;
  /** Nearest expected arrival across this item's open POs. */
  expected: string | null;
  source: EtaSource;
  /** Positive = days still to wait, negative = days past due, null = no date. */
  daysAway: number | null;
  overdue: boolean;
  /** PO numbers, buy-side only — a sell-side reader gets dates, not documents. */
  pos: string[];
}

export interface ArrivingSummary {
  /** Expected in the future, or too soon to be late. */
  soon: ArrivingItem[];
  /** Expected date already passed and nothing received against the PO. */
  late: ArrivingItem[];
  openPos: number;
  /** Open POs with no supplier ETA — their dates are estimates, and we say so. */
  posWithoutEta: number;
  /**
   * Open POs past their expected date with NOT ONE receipt booked against
   * them. Two readings — the shipment is genuinely late, or it arrived and was
   * never received into the system — and the widget refuses to guess which.
   * Buy-side only: it is a purchasing hygiene signal, not a sales one.
   */
  stalePos: number;
  /** How long the oldest of those has been sitting, in days. */
  oldestStaleDays: number | null;
}

/**
 * Read the open purchase orders as a per-item arrival list.
 *
 * Dates come from `itemArrivalDetails`, so a stamped supplier ETA wins, then
 * the lead time stated on that PO's supplier quote, then the supplier's own
 * measured history — and `source` says which, because an estimate presented as
 * a promise is how a customer gets told the wrong week.
 */
export function summariseArrivals(
  pos: OpenPo[],
  lines: PoLine[],
  comps: CompRow[],
  receivedPoIds: Set<string>,
  statedByPo: Map<string, string | null>,
  nowIso: string,
): ArrivingSummary {
  const today = nowIso.slice(0, 10);
  const open = pos.filter((p) => INCOMING_PO_STATUSES.has(p.status ?? ''));
  const openIds = new Set(open.map((p) => String(p.po_id)));
  const openLines = lines
    .filter((l) => l.component_id && openIds.has(String(l.po_id)))
    .map((l) => ({ po_id: l.po_id, component_id: l.component_id, quantity: num(l.quantity) }));

  const details = itemArrivalDetails(openLines, pos, pos as unknown as ReceivedPo[], nowIso, statedByPo);
  const byId = new Map(comps.map((c) => [c.component_id, c]));

  const items: ArrivingItem[] = [];
  for (const [cid, rows] of details) {
    const c = byId.get(cid);
    if (!c) continue;                                  // an item we cannot name
    // The nearest date wins; a line with no date at all never beats a real one.
    const dated = rows.filter((r) => r.expected);
    const nearest = dated.length
      ? dated.reduce((a, b) => (a.expected! <= b.expected! ? a : b))
      : null;
    const expected = nearest?.expected ?? null;
    items.push({
      component_id: cid,
      name: itemName(c),
      unit: c.unit,
      qty: rows.reduce((s, r) => s + r.qty, 0),
      expected,
      source: nearest?.source ?? null,
      daysAway: expected ? daysBetween(expected, today) : null,
      overdue: !!nearest?.overdue,
      pos: rows.map((r) => r.po_number).filter((n): n is string => !!n),
    });
  }

  // Soonest first within each group; an item with no date sits at the end,
  // where "we don't know" belongs — never mixed in among dates that are known.
  const bySoonest = (a: ArrivingItem, b: ArrivingItem) =>
    (a.expected ? 0 : 1) - (b.expected ? 0 : 1)
    || (a.expected ?? '').localeCompare(b.expected ?? '')
    || a.name.localeCompare(b.name);
  const late = items.filter((i) => i.overdue).sort(bySoonest);
  const soon = items.filter((i) => !i.overdue).sort(bySoonest);

  // Asked of the PO itself rather than of any one of its lines: the same
  // expected-arrival rule, one answer per document.
  const lead = measureLead(pos as unknown as ReceivedPo[]);
  let stalePos = 0;
  let oldestStaleDays: number | null = null;
  for (const p of open) {
    if (receivedPoIds.has(String(p.po_id))) continue;   // something did arrive
    const { expected } = expectedArrival(p, lead, statedByPo.get(String(p.po_id)));
    if (!expected || daysBetween(today, expected) <= 0) continue;
    stalePos += 1;
    const age = p.po_date ? daysBetween(today, p.po_date) : null;
    if (age != null && (oldestStaleDays == null || age > oldestStaleDays)) oldestStaleDays = age;
  }

  return {
    soon, late,
    openPos: open.length,
    posWithoutEta: open.filter((p) => !p.estimated_delivery_date).length,
    stalePos, oldestStaleDays,
  };
}

// ── Fetchers ─────────────────────────────────────────────────────────────────

/** What landed in the last `days` days, and what still cannot be quoted. */
export async function fetchNewArrivals(
  supabase: SupabaseClient, days: number, nowIso = new Date().toISOString(),
): Promise<NewArrival[]> {
  const [moveRes, compRes, balRes] = await Promise.all([
    // Goods-receipt DATES only — no unit_cost_idr, which is buy-side.
    supabase.from('30.0_stock_movements').select('component_id, moved_at')
      .eq('direction', 'in').eq('source_type', 'receipt'),
    supabase.from('3.0_components').select('component_id, internal_description, supplier_model, unit, selling_price_idr'),
    supabase.from('30.1_stock_balances').select('component_id, qty_on_hand'),
  ]);
  return newArrivals(
    (compRes.data ?? []) as unknown as CompRow[],
    receiptDates((moveRes.data ?? []) as ReceiptMove[]),
    (balRes.data ?? []) as unknown as BalanceRow[],
    { days, nowIso },
  );
}

/** What is on the water, when it should land, and what is past due. */
export async function fetchArrivals(
  supabase: SupabaseClient, opts: { buySide: boolean }, nowIso = new Date().toISOString(),
): Promise<ArrivingSummary> {
  // po_number is a buy-side document reference: fetched only for buy-side eyes.
  const poCols = 'po_id, quote_id, status, po_date, estimated_delivery_date, supplier_id, actual_received_date'
    + (opts.buySide ? ', po_number' : '');
  const [poRes, lineRes, compRes, pqRes, recRes] = await Promise.all([
    supabase.from('5.0_purchases').select(poCols as string),
    supabase.from('5.1_purchase_line_items').select('po_id, component_id, quantity'),
    supabase.from('3.0_components').select('component_id, internal_description, supplier_model, unit, selling_price_idr'),
    supabase.from('4.0_price_quotes').select('quote_id, estimated_lead_time_days'),
    supabase.from('30.0_stock_movements').select('source_id').eq('direction', 'in').eq('source_type', 'receipt'),
  ]);
  const pos = (poRes.data ?? []) as unknown as OpenPo[];
  const leadByQuote = new Map(((pqRes.data ?? []) as { quote_id: string | number; estimated_lead_time_days: string | null }[])
    .map((q) => [String(q.quote_id), q.estimated_lead_time_days]));
  const statedByPo = new Map<string, string | null>(
    ((poRes.data ?? []) as unknown as { po_id: string | number; quote_id: string | number | null }[])
      .map((p) => [String(p.po_id), p.quote_id == null ? null : (leadByQuote.get(String(p.quote_id)) ?? null)]));
  const receivedPoIds = new Set(((recRes.data ?? []) as { source_id: string | null }[])
    .map((m) => String(m.source_id ?? '')).filter(Boolean));

  return summariseArrivals(
    pos,
    (lineRes.data ?? []) as unknown as PoLine[],
    (compRes.data ?? []) as unknown as CompRow[],
    receivedPoIds, statedByPo, nowIso,
  );
}

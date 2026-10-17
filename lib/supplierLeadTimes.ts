/**
 * Supplier lead times — how long each supplier really takes, from the quote
 * to the goods fully in (owner, 2026-10-16: "track each supplier's lead time
 * summary of previous POs from quote, payment to actually fully received").
 *
 * One timeline per purchase order, from dates ICAPROC already holds:
 *
 *   quote      4.0_price_quotes.quote_date (the PO's linked quote)
 *   PO         5.0_purchases.po_date
 *   1st pay    the first principal payment (6.0_po_costs, PRINCIPAL_CATS)
 *   last pay   the last principal payment — the deposit-to-balance span
 *   received   5.0.actual_received_date, else the last goods receipt (30.2)
 *
 * The received date prefers the PO's own field: goods receipts were entered
 * when the stock ledger started, weeks or months after the container landed
 * (one 2025-12 arrival carries a 2026-09 receipt), so the receipt date is a
 * fallback, never the first answer. Same rule as poProgress.goodsReceived.
 *
 * Stages are measured in calendar days. A stage whose end is BEFORE its start
 * (a quote dated after its PO, a payment before the PO it pays) is bad or
 * unusual data: it is shown on the PO, counted as odd, and left out of that
 * stage's statistics, never averaged in as a negative.
 *
 * The supplier summary uses the MEDIAN as its headline — with five or ten
 * POs, one stuck container would drag an average a month off — and keeps
 * average, min and max beside it.
 *
 * Promised vs actual: the quote's stated lead time ("45 working days",
 * "50-60 days after deposit") counted from the first payment (factories start
 * on the deposit), else from the PO date. Late = received − promised.
 *
 * Shipping (5.0.method_of_shipment — Sea, Air, Local Delivery) is carried on
 * every PO and summarised per supplier per way of shipping: an air order is
 * judged late against the supplier's AIR history, never its sea median.
 *
 * Pure: no fetch, no React. `today` is an argument so the tests are stable.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { PRINCIPAL_CATS } from '../constants/costCategories.ts';
import { fetchAllRows } from './fetchAllRows.ts';
import { parseLeadDays, addWorkingDays, INCOMING_PO_STATUSES } from './inTransit.ts';

export type Stage = 'quoteToPo' | 'poToPay' | 'payToPaid' | 'payToReceived' | 'poToReceived' | 'quoteToReceived';
export const STAGES: Stage[] = ['quoteToPo', 'poToPay', 'payToPaid', 'payToReceived', 'poToReceived', 'quoteToReceived'];

/** Statuses that are not a real order (yet, or any more). */
export const NOT_AN_ORDER = new Set(['Draft', 'Replaced', 'Cancelled']);

export interface LtPo {
  po_id: string | number;
  po_number: string | null;
  status: string | null;
  po_date: string | null;
  quote_id?: string | number | null;
  supplier_id?: string | null;
  actual_received_date?: string | null;
  currency?: string | null;
  /** 5.0.method_of_shipment: 'Sea' | 'Air' | 'Local Delivery' | null. */
  method_of_shipment?: string | null;
}
export interface LtQuote { quote_id: string | number; quote_date: string | null; supplier_id?: string | null; estimated_lead_time_days?: string | null }
export interface LtCost { po_id: string | number; cost_category: string; payment_date: string | null }
export interface LtGrn { po_id: string | number; received_at: string | null }

/** How the goods travel — air and sea take very different times, so they are never averaged together. */
export type ShipVia = 'Sea' | 'Air' | 'Local';
export const SHIP_VIAS: ShipVia[] = ['Sea', 'Air', 'Local'];
export const shipVia = (m: string | null | undefined): ShipVia | null =>
  m === 'Sea' ? 'Sea' : m === 'Air' ? 'Air' : m === 'Local Delivery' || m === 'Local' ? 'Local' : null;

export interface PoTimeline {
  poId: string;
  poNumber: string;
  supplierId: string | null;
  status: string;
  currency: string | null;
  /** Null = not set on the PO. */
  via: ShipVia | null;
  quoteDate: string | null;
  poDate: string | null;
  firstPay: string | null;
  lastPay: string | null;
  received: string | null;
  /** Where the received date came from. */
  receivedFrom: 'po' | 'grn' | null;
  stages: Record<Stage, number | null>;
  /** Stages left out because their dates run backwards. */
  odd: Stage[];
  statedText: string | null;
  /** Date the quote's lead time promised, or null when the quote states none. */
  promised: string | null;
  /** received − promised, days (negative = early); null until both exist. */
  lateDays: number | null;
  /** Ordered, not yet fully in. */
  open: boolean;
  /** today − PO date, for an open PO. */
  waitingDays: number | null;
}

export interface StageStats { n: number; median: number; avg: number; min: number; max: number }

export interface SupplierLead {
  supplierId: string;
  /** POs fully received (the ones a lead time can be measured on). */
  completed: number;
  open: number;
  stages: Record<Stage, StageStats | null>;
  /** Against the quote's stated lead time, over received POs that had one. */
  promise: { measured: number; onTime: number; medianLateDays: number } | null;
  /** Open POs past their promised date, else past PO date + this supplier's median PO → received. */
  overdue: number;
  odd: number;
  /**
   * The bar: the typical end-to-end time (median quote → fully received, PO →
   * received where a PO has no quote), split by where the time goes — each
   * stage's share of the days summed over the received POs whose three stages
   * are all known. Medians do not add up (half of one supplier's POs were paid
   * on the PO date, half 40–70 days later), shares do.
   */
  split: { total: number; shares: Record<'quoteToPo' | 'poToPay' | 'payToReceived', number> | null; basis: number } | null;
  /** Marked Fully Received with no received date anywhere — cannot be measured. */
  noDate: number;
  /** The same supplier, per way of shipping — a sea median says nothing about an air order. */
  byVia: { via: ShipVia | null; completed: number; open: number; poToReceived: StageStats | null }[];
  lastPoDate: string | null;
  pos: PoTimeline[];
}

const DAY = 86_400_000;
const day = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
export const daysBetween = (from: string | null, to: string | null): number | null =>
  from && to ? Math.round((day(to) - day(from)) / DAY) : null;
const addDays = (iso: string, n: number) => new Date(day(iso) + n * DAY).toISOString().slice(0, 10);
const iso = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);

export function stageStats(xs: number[]): StageStats | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return { n: s.length, median, avg: Math.round(s.reduce((a, b) => a + b, 0) / s.length * 10) / 10, min: s[0], max: s[s.length - 1] };
}

/**
 * The quote's stated lead time. A range ("50-60 days after deposit") is held
 * to its LONGER end — the supplier promised 60, not 50 — so a delivery on day
 * 55 is on time.
 */
export function statedLead(text: string | null): { days: number; working: boolean } | null {
  const base = parseLeadDays(text);
  if (!base || !text) return base;
  const nums = (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Math.round(Number(n.replace(',', '.'))));
  return { ...base, days: Math.max(base.days, ...nums) };
}

/** One PO's timeline. */
export function poTimeline(po: LtPo, quote: LtQuote | null, costs: LtCost[], grns: LtGrn[], today: string): PoTimeline {
  const pays = costs.filter((c) => PRINCIPAL_CATS.has(c.cost_category) && c.payment_date).map((c) => iso(c.payment_date)!).sort();
  const grnDates = grns.map((g) => iso(g.received_at)).filter((d): d is string => !!d).sort();
  const status = po.status ?? '';
  const ownReceived = iso(po.actual_received_date);
  // A receipt alone does not make a PO fully in: the last receipt counts only once the PO says so.
  const received = ownReceived ?? (status === 'Fully Received' && grnDates.length ? grnDates[grnDates.length - 1] : null);
  const receivedFrom = ownReceived ? 'po' : received ? 'grn' : null;
  const quoteDate = iso(quote?.quote_date);
  const poDate = iso(po.po_date);
  const firstPay = pays[0] ?? null;
  const lastPay = pays[pays.length - 1] ?? null;

  const raw: Record<Stage, number | null> = {
    quoteToPo: daysBetween(quoteDate, poDate),
    poToPay: daysBetween(poDate, firstPay),
    payToPaid: pays.length > 1 ? daysBetween(firstPay, lastPay) : null,
    payToReceived: daysBetween(firstPay, received),
    poToReceived: daysBetween(poDate, received),
    quoteToReceived: daysBetween(quoteDate, received),
  };
  const odd = STAGES.filter((s) => raw[s] != null && raw[s]! < 0);
  const stages = Object.fromEntries(STAGES.map((s) => [s, odd.includes(s) ? null : raw[s]])) as Record<Stage, number | null>;

  const statedText = quote?.estimated_lead_time_days?.trim() || null;
  const stated = statedLead(statedText);
  const start = firstPay ?? poDate;
  const promised = stated && start ? (stated.working ? addWorkingDays(start, stated.days) : addDays(start, stated.days)) : null;
  const open = !received && INCOMING_PO_STATUSES.has(status);

  return {
    poId: String(po.po_id), poNumber: po.po_number ?? '', supplierId: po.supplier_id ?? quote?.supplier_id ?? null,
    status, currency: po.currency ?? null, via: shipVia(po.method_of_shipment), quoteDate, poDate, firstPay, lastPay, received, receivedFrom,
    stages, odd, statedText, promised,
    lateDays: promised && received ? daysBetween(promised, received) : null,
    open, waitingDays: open && poDate ? daysBetween(poDate, today) : null,
  };
}

/** Every supplier's lead-time summary, biggest buying history first. */
export function supplierLeadTimes(input: { pos: LtPo[]; quotes: LtQuote[]; costs: LtCost[]; grns: LtGrn[]; today: string }): SupplierLead[] {
  const quoteById = new Map(input.quotes.map((q) => [String(q.quote_id), q]));
  const costsByPo = new Map<string, LtCost[]>();
  for (const c of input.costs) (costsByPo.get(String(c.po_id)) ?? costsByPo.set(String(c.po_id), []).get(String(c.po_id))!).push(c);
  const grnsByPo = new Map<string, LtGrn[]>();
  for (const g of input.grns) (grnsByPo.get(String(g.po_id)) ?? grnsByPo.set(String(g.po_id), []).get(String(g.po_id))!).push(g);

  const bySupplier = new Map<string, PoTimeline[]>();
  for (const po of input.pos) {
    if (NOT_AN_ORDER.has(po.status ?? '')) continue;
    const quote = po.quote_id != null ? quoteById.get(String(po.quote_id)) ?? null : null;
    const tl = poTimeline(po, quote, costsByPo.get(String(po.po_id)) ?? [], grnsByPo.get(String(po.po_id)) ?? [], input.today);
    if (!tl.supplierId) continue;
    (bySupplier.get(tl.supplierId) ?? bySupplier.set(tl.supplierId, []).get(tl.supplierId)!).push(tl);
  }

  const out: SupplierLead[] = [];
  for (const [supplierId, pos] of bySupplier) {
    pos.sort((a, b) => (b.poDate ?? '').localeCompare(a.poDate ?? ''));
    const done = pos.filter((p) => p.received);
    const stages = Object.fromEntries(STAGES.map((s) => [s, stageStats(done.map((p) => p.stages[s]).filter((v): v is number => v != null))])) as Record<Stage, StageStats | null>;
    // quote → PO and PO → payment are known before the goods arrive, so open POs count there too.
    for (const s of ['quoteToPo', 'poToPay', 'payToPaid'] as Stage[]) {
      stages[s] = stageStats(pos.map((p) => p.stages[s]).filter((v): v is number => v != null));
    }
    const endToEnd = stageStats(done.map((p) => p.stages.quoteToReceived ?? (p.quoteDate ? null : p.stages.poToReceived)).filter((v): v is number => v != null));
    const complete = done.filter((p) => (p.stages.quoteToPo != null || !p.quoteDate) && p.stages.poToPay != null && p.stages.payToReceived != null);
    const sumOf = (k: 'quoteToPo' | 'poToPay' | 'payToReceived') => complete.reduce((a, p) => a + (p.stages[k] ?? 0), 0);
    const sums = { quoteToPo: sumOf('quoteToPo'), poToPay: sumOf('poToPay'), payToReceived: sumOf('payToReceived') };
    const all = sums.quoteToPo + sums.poToPay + sums.payToReceived;
    // Received but no PO with all three stages known (no payment recorded): the total stands, the split is unknown.
    const split = endToEnd ? {
      total: endToEnd.median, basis: complete.length,
      shares: all > 0 ? { quoteToPo: sums.quoteToPo / all, poToPay: sums.poToPay / all, payToReceived: sums.payToReceived / all } : null,
    } : null;
    const promisedDone = done.filter((p) => p.lateDays != null);
    const late = promisedDone.map((p) => p.lateDays!);
    const viaKeys = [...SHIP_VIAS, null].filter((v) => pos.some((p) => p.via === v));
    const byVia = viaKeys.map((via) => {
      const mine = pos.filter((p) => p.via === via);
      return {
        via, completed: mine.filter((p) => p.received).length, open: mine.filter((p) => p.open).length,
        poToReceived: stageStats(mine.filter((p) => p.received).map((p) => p.stages.poToReceived).filter((v): v is number => v != null)),
      };
    });
    // "Usual" means this supplier, this way of shipping; only without that history the supplier overall.
    const overall = stages.poToReceived?.median ?? null;
    const overdue = pos.filter((p) => {
      if (!p.open || !p.poDate) return false;
      const typical = byVia.find((b) => b.via === p.via)?.poToReceived?.median ?? overall;
      const due = p.promised ?? (typical != null ? addDays(p.poDate, Math.round(typical)) : null);
      return due != null && input.today > due;
    }).length;
    out.push({
      supplierId, completed: done.length, open: pos.filter((p) => p.open).length, stages, split,
      promise: promisedDone.length ? { measured: promisedDone.length, onTime: late.filter((d) => d <= 0).length, medianLateDays: stageStats(late)!.median } : null,
      overdue, odd: pos.filter((p) => p.odd.length).length,
      noDate: pos.filter((p) => p.status === 'Fully Received' && !p.received).length,
      byVia, lastPoDate: pos[0]?.poDate ?? null, pos,
    });
  }
  return out.sort((a, b) => (b.completed + b.open) - (a.completed + a.open) || (b.lastPoDate ?? '').localeCompare(a.lastPoDate ?? ''));
}

// ── The headline, shared by the page and the dashboard panel ─────────────────

export interface LeadDigest {
  /** PO → fully received per way of shipping, over the POs passed in. */
  byVia: { via: ShipVia | null; count: number; stats: StageStats | null }[];
  received: number;
  open: number;
  /** Median PO → fully received across every supplier. */
  poToReceived: StageStats | null;
  promised: number;
  onTime: number;
  lateOpen: number;
  odd: number;
  noDate: number;
  /** Suppliers worth a look first: late open POs, then late against their quotes, then busiest. */
  watch: SupplierLead[];
}

export function leadDigest(leads: SupplierLead[], watchCount = 5): LeadDigest {
  const all = leads.flatMap((l) => l.pos);
  const received = all.filter((p) => p.received);
  const promised = received.filter((p) => p.lateDays != null);
  const stats = (ps: PoTimeline[]) => stageStats(ps.map((p) => p.stages.poToReceived).filter((v): v is number => v != null));
  const late = (l: SupplierLead) => (l.promise ? l.promise.measured - l.promise.onTime : 0);
  return {
    byVia: ([...SHIP_VIAS, null] as (ShipVia | null)[])
      .map((via) => ({ via, count: all.filter((p) => p.via === via).length, stats: stats(received.filter((p) => p.via === via)) }))
      .filter((b) => b.count > 0),
    received: received.length, open: all.filter((p) => p.open).length,
    poToReceived: stats(received),
    promised: promised.length, onTime: promised.filter((p) => p.lateDays! <= 0).length,
    lateOpen: leads.reduce((a, l) => a + l.overdue, 0),
    odd: leads.reduce((a, l) => a + l.odd, 0),
    noDate: leads.reduce((a, l) => a + l.noDate, 0),
    watch: [...leads].filter((l) => l.completed + l.open > 0)
      .sort((a, b) => b.overdue - a.overdue || late(b) - late(a) || (b.completed + b.open) - (a.completed + a.open))
      .slice(0, watchCount),
  };
}

/**
 * Everything the lead times need, read straight from the tables — for a
 * screen (the dashboard) that does not hold the shared data hook. Buy-side
 * only: it reads supplier payments.
 */
export async function fetchSupplierLeadTimes(supabase: SupabaseClient, today: string): Promise<{ leads: SupplierLead[]; names: Map<string, string> }> {
  const page = <T>(table: string, cols: string, order: string) =>
    fetchAllRows<T>((f, t) => supabase.from(table).select(cols).order(order).range(f, t) as unknown as PromiseLike<{ data: T[] | null; error: { message: string } | null }>)
      .then((r) => r.rows ?? []);
  const [pos, quotes, costs, grns, sups] = await Promise.all([
    page<LtPo>('5.0_purchases', 'po_id, po_number, status, po_date, quote_id, supplier_id, actual_received_date, currency, method_of_shipment', 'po_id'),
    page<LtQuote>('4.0_price_quotes', 'quote_id, quote_date, supplier_id, estimated_lead_time_days', 'quote_id'),
    page<LtCost>('6.0_po_costs', 'po_id, cost_category, payment_date', 'cost_id'),
    page<LtGrn>('30.2_goods_receipts', 'po_id, received_at', 'grn_id'),
    page<{ supplier_id: string; supplier_name: string | null }>('2.0_suppliers', 'supplier_id, supplier_name', 'supplier_id'),
  ]);
  return {
    leads: supplierLeadTimes({ pos, quotes, costs: costs.filter((c) => PRINCIPAL_CATS.has(c.cost_category)), grns, today }),
    names: new Map(sups.map((s) => [s.supplier_id, s.supplier_name ?? ''])),
  };
}

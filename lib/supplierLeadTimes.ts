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
 * Pure: no fetch, no React. `today` is an argument so the tests are stable.
 */
import { PRINCIPAL_CATS } from '../constants/costCategories.ts';
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
}
export interface LtQuote { quote_id: string | number; quote_date: string | null; supplier_id?: string | null; estimated_lead_time_days?: string | null }
export interface LtCost { po_id: string | number; cost_category: string; payment_date: string | null }
export interface LtGrn { po_id: string | number; received_at: string | null }

export interface PoTimeline {
  poId: string;
  poNumber: string;
  supplierId: string | null;
  status: string;
  currency: string | null;
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
    status, currency: po.currency ?? null, quoteDate, poDate, firstPay, lastPay, received, receivedFrom,
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
    const typical = stages.poToReceived?.median ?? null;
    const overdue = pos.filter((p) => {
      if (!p.open || !p.poDate) return false;
      const due = p.promised ?? (typical != null ? addDays(p.poDate, Math.round(typical)) : null);
      return due != null && input.today > due;
    }).length;
    out.push({
      supplierId, completed: done.length, open: pos.filter((p) => p.open).length, stages, split,
      promise: promisedDone.length ? { measured: promisedDone.length, onTime: late.filter((d) => d <= 0).length, medianLateDays: stageStats(late)!.median } : null,
      overdue, odd: pos.filter((p) => p.odd.length).length,
      noDate: pos.filter((p) => p.status === 'Fully Received' && !p.received).length,
      lastPoDate: pos[0]?.poDate ?? null, pos,
    });
  }
  return out.sort((a, b) => (b.completed + b.open) - (a.completed + a.open) || (b.lastPoDate ?? '').localeCompare(a.lastPoDate ?? ''));
}

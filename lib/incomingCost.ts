/**
 * What the NEXT units of an item will cost — and whether that is more than
 * the cost we are pricing it on today.
 *
 * Owner, 2026-10-27: *"for items that are in reorder or quoted, we need to see
 * whether the landed cost or the new quote item is higher, and please warn the
 * user in Setting SELLING PRICES. For example item epever LR51100, has
 * increased in price in the new PO, but when setting prices, it only uses
 * Landed Cost price."*
 *
 * The cost basis (lib/costBasis.ts) rightly prefers the ledger's landed cost:
 * it is the only number goods that actually arrived proved. But it looks
 * BACKWARDS. LR51100 landed at Rp 9,477,538 from a USD 509 PO; the reorder
 * (PIO-017, Confirmed) is USD 539 at 17,912 — Rp 9,654,568 before freight,
 * already above the landed cost, and ≈ Rp 10.28m once it lands with the same
 * import costs. Priced on the landed cost, the net of Rp 11m reads 13.8% GP;
 * on the stock that is coming it is 6.6%. A distributor prices to
 * REPLACEMENT cost — the stock on hand is sold once, the price has to fund
 * the next container.
 *
 * WHAT COUNTS AS "INCOMING":
 *   - an open PO line: status Sent, Confirmed or Partially Received, at the
 *     PO's own committed rate (the rate the money will actually move at).
 *     Draft POs do NOT count: 148 of them sit untouched since 2023–2025 and a
 *     draft commits nobody to anything.
 *   - a supplier quote, Open or Accepted, dated AFTER the item last arrived —
 *     an older quote is already history the landed cost has absorbed.
 * The NEWEST of these wins (a tie goes to the PO). Newest, not highest: the
 * latest price is the one the next order will be placed at.
 *
 * FOB IS NOT LANDED. A PO or quote price excludes freight, duty, PIB and bank
 * charges, so comparing it raw against a landed cost flatters it. The estimate
 * applies an import UPLIFT (landed ÷ the PO price it landed from — LR51100:
 * 9,477,538 ÷ (509 × 17,490) = 1.065) learned from past deliveries, and the
 * rise is measured on that estimated landed cost, never on the bare FOB.
 *
 * WHERE THE UPLIFT COMES FROM (owner, 2026-10-27: *"it should use the previous
 * estimated Landed Cost mark up from the same supplier"*), most specific first:
 *   1. `item`           — this item's last delivery FROM THE SAME SUPPLIER.
 *                         Duty is set per product (HS code), so the item's own
 *                         history with that supplier is the closest match.
 *   2. `supplier`       — the same supplier's last delivered PO, all its lines
 *                         together, weighted by value (Σ landed ÷ Σ FOB). This
 *                         is what prices an item that supplier has never sent.
 *   3. `item_elsewhere` — this item's last delivery from another supplier.
 *   4. none             — the raw price, flagged `provisional`: it can only be
 *                         too LOW, never too high, so a warning it raises is real.
 */
import type { FxRate } from './computeTUC.ts';

/** Type-only import above: computeTUC.ts cannot load under `node --test`. A
 *  currency with no known rate converts to 0 and is skipped — never guessed. */
const rateOf = (fx: Record<string, FxRate>, ccy: string): number => Number(fx[ccy]?.rate) || 0;

/** A rise smaller than this is exchange-rate rounding, not news. */
export const RISE_THRESHOLD_PCT = 1;

/** An uplift outside this band is a data error (wrong rate, unit mismatch), not an import cost. */
const UPLIFT_MIN = 1;
const UPLIFT_MAX = 2;
/**
 * An IMPORT (foreign-currency PO) that "landed" at under +0.5% did not land
 * free — its freight and duty were never added to the receipt. Measured
 * 2026-10-27: several KSTAR deliveries sit at exactly the USD price. Learning
 * 0% from them would understate every estimate for that supplier, so they
 * teach nothing. A rupiah PO from a local supplier really can land at ~0%.
 */
const IMPORT_UPLIFT_MIN = 1.005;

const OPEN_PO = new Set(['Sent', 'Confirmed', 'Partially Received']);
const LIVE_QUOTE = new Set(['Open', 'Accepted']);

export interface IncPo { po_id: string | number; po_number?: string | null; po_date?: string | null; status?: string | null; currency?: string | null; exchange_rate?: number | string | null; supplier_id?: string | null; quote_id?: string | number | null; total_value?: number | string | null }
/** A PO payment row (6.0_po_costs). Only principal categories count toward the exchange rate. */
export interface IncPoCost { po_id: string | number; cost_category: string; amount: number | string; currency?: string | null; exchange_rate?: number | string | null }

/** Supplier principal — the money that converts currency. Freight, tax and fees never do. */
const PRINCIPAL = new Set(['down_payment', 'balance_payment', 'additional_balance_payment', 'overpayment_credit']);

/**
 * Where the rate on a PO came from (owner, 2026-10-27: *"if we do not know the
 * final exchange rate yet, we can use the benchmark first, as it is updated
 * daily anyways"*):
 *   'paid'       — fully paid: the rate the bank actually charged.
 *   'blend'      — part paid: the paid share at its real rate, the rest at the
 *                  company benchmark (Settings › Exchange rates, follows
 *                  KlikBCA e-Rate each morning).
 *   'benchmark'  — nothing paid yet: all at the benchmark.
 *   'po'         — no benchmark for this currency: the rate typed on the PO.
 */
export type RateSource = 'paid' | 'blend' | 'benchmark' | 'po';
export interface PoRate { rate: number; source: RateSource; paidPct: number }

/**
 * The rupiah rate a PO will cost, as best we know it today. Payment rows in
 * the PO's currency carry the bank rate; rupiah rows carry it when the person
 * typed one, else the PO's rate stands in for that slice.
 */
export function poRate(po: IncPo, costs: IncPoCost[], fx: Record<string, FxRate>): PoRate {
  const cur = po.currency || 'IDR';
  if (cur === 'IDR') return { rate: 1, source: 'paid', paidPct: 100 };
  const typed = n(po.exchange_rate);
  const bench = rateOf(fx, cur);
  let paidF = 0, paidIdr = 0;
  for (const c of costs) {
    if (!PRINCIPAL.has(c.cost_category)) continue;
    const amt = n(c.amount);
    const r = n(c.exchange_rate) || typed;
    if (!amt || !(r > 0)) continue;
    if ((c.currency || cur) === 'IDR') { paidIdr += amt; paidF += amt / r; }
    else { paidF += amt; paidIdr += amt * r; }
  }
  const total = n(po.total_value);
  const rest = bench > 0 ? bench : typed;
  if (paidF > 0 && (total <= 0 || paidF >= total * 0.995)) {
    return { rate: paidIdr / paidF, source: 'paid', paidPct: 100 };
  }
  if (paidF > 0 && total > 0) {
    return { rate: (paidIdr + (total - paidF) * rest) / total, source: bench > 0 ? 'blend' : 'po', paidPct: (paidF / total) * 100 };
  }
  return { rate: rest, source: bench > 0 ? 'benchmark' : 'po', paidPct: 0 };
}
export interface IncPoLine { po_id: string | number; component_id: string; unit_cost: number | string; currency?: string | null }
export interface IncQuote { quote_id: string | number; pi_number?: string | null; quote_date?: string | null; status?: string | null; currency?: string | null; supplier_id?: string | null }
export interface IncQuoteLine { quote_id: string | number; component_id: string; unit_price: number | string; currency?: string | null }
/** A goods-in movement (30.0, source_type 'receipt'): landed IDR per unit, and the PO it came from. */
export interface IncReceipt { component_id: string; unit_cost_idr: number | string | null; moved_at: string; source_id: string | null; quantity?: number | string | null }

export type UpliftSource = 'item' | 'supplier' | 'item_elsewhere';

export interface IncomingCost {
  source: 'po' | 'quote';
  /** PO number or the supplier's PI/quote number. */
  label: string;
  date: string;
  status: string;
  currency: string;
  /** Price per unit in the document's currency. */
  unitForeign: number;
  /** Rate used to convert — see RateSource. A quote converts at the company benchmark. */
  rate: number;
  rateSource: RateSource;
  /** Share of the PO already paid (0 for a quote), for the "29% paid at 17,912" line. */
  ratePaidPct: number;
  /** unitForeign × rate — before freight, duty and fees. */
  fobIdr: number;
  /** landed ÷ FOB learned from a past delivery (see UpliftSource), or null when there is none. */
  uplift: number | null;
  /** Which past delivery the uplift was learned from. */
  upliftSource: UpliftSource | null;
  /** The PO number it was learned from. */
  upliftRef: string | null;
  /** The supplier of the incoming PO / quote, when known. */
  supplierId: string | null;
  /** fobIdr × uplift — what a unit will cost once it lands. */
  estLandedIdr: number;
  /** No uplift known: the estimate is the raw FOB and can only be too low. */
  provisional: boolean;
}

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const day = (s: string | null | undefined) => (s ?? '').slice(0, 10);

/** Newest incoming cost per component. Items with nothing on order or quoted are absent. */
export function incomingCosts(
  input: { pos: IncPo[]; poItems: IncPoLine[]; quotes: IncQuote[]; quoteItems: IncQuoteLine[]; receipts: IncReceipt[]; poCosts?: IncPoCost[] },
  fx: Record<string, FxRate>,
): Map<string, IncomingCost> {
  const poById = new Map(input.pos.map((p) => [String(p.po_id), p]));
  const quoteById = new Map(input.quotes.map((q) => [String(q.quote_id), q]));
  const costsByPo = new Map<string, IncPoCost[]>();
  for (const c of input.poCosts ?? []) (costsByPo.get(String(c.po_id)) ?? costsByPo.set(String(c.po_id), []).get(String(c.po_id))!).push(c);
  const rateCache = new Map<string, PoRate>();
  const rateOfPo = (po: IncPo): PoRate => {
    const k = String(po.po_id);
    return rateCache.get(k) ?? rateCache.set(k, poRate(po, costsByPo.get(k) ?? [], fx)).get(k)!;
  };

  const supplierOfPo = (po: IncPo | undefined): string | null =>
    po ? (po.supplier_id || (po.quote_id != null ? quoteById.get(String(po.quote_id))?.supplier_id : null) || null) : null;

  // Every past delivery that can teach an uplift: landed IDR vs the FOB of
  // the PO line it came from, at that PO's own rate.
  interface Lesson { cid: string; date: string; poId: string; poNo: string; supplier: string | null; landed: number; fob: number; qty: number; imported: boolean }
  const lessons: Lesson[] = [];
  // When each item last arrived — any delivery, usable uplift or not. A quote
  // older than this is history the landed cost has already absorbed.
  const lastArrived = new Map<string, string>();
  for (const r of input.receipts) {
    const d = day(r.moved_at);
    if ((lastArrived.get(r.component_id) ?? '') < d) lastArrived.set(r.component_id, d);
    const landed = n(r.unit_cost_idr);
    const po = r.source_id ? poById.get(String(r.source_id)) : undefined;
    const line = po && input.poItems.find((l) => String(l.po_id) === String(po.po_id) && l.component_id === r.component_id);
    if (!po || !line || !(landed > 0)) continue;
    const cur = line.currency || po.currency || 'IDR';
    // The rate this PO really cost (paid, else blended with the benchmark), so
    // the uplift learned is freight and duty, not last year's rupiah.
    const rate = cur === 'IDR' ? 1 : rateOfPo(po).rate;
    const fob = n(line.unit_cost) * rate;
    if (!(fob > 0)) continue;
    lessons.push({ cid: r.component_id, date: d, poId: String(po.po_id), poNo: po.po_number || 'PO',
      supplier: supplierOfPo(po), landed, fob, qty: n(r.quantity) || 1, imported: cur !== 'IDR' });
  }
  const sane = (u: number, imported: boolean) => u >= (imported ? IMPORT_UPLIFT_MIN : UPLIFT_MIN) && u <= UPLIFT_MAX;
  const newestFirst = (a: Lesson, b: Lesson) => b.date.localeCompare(a.date);
  lessons.sort(newestFirst);

  // 1 + 3: per item (and per item × supplier), the newest sane delivery.
  const byItemSupplier = new Map<string, Lesson>();
  const byItem = new Map<string, Lesson>();
  for (const l of lessons) {
    if (!sane(l.landed / l.fob, l.imported)) continue;
    if (l.supplier && !byItemSupplier.has(`${l.cid}|${l.supplier}`)) byItemSupplier.set(`${l.cid}|${l.supplier}`, l);
    if (!byItem.has(l.cid)) byItem.set(l.cid, l);
  }
  // 2: per supplier, its most recently delivered PO, every line weighted by value.
  const bySupplier = new Map<string, { uplift: number; ref: string }>();
  const poLessons = new Map<string, Lesson[]>();
  for (const l of lessons) (poLessons.get(l.poId) ?? poLessons.set(l.poId, []).get(l.poId)!).push(l);
  const posNewestFirst = [...poLessons.values()].sort((a, b) => newestFirst(a[0], b[0]));
  for (const ls of posNewestFirst) {
    const sup = ls[0].supplier;
    if (!sup || bySupplier.has(sup)) continue;
    const landed = ls.reduce((s, l) => s + l.landed * l.qty, 0);
    const fob = ls.reduce((s, l) => s + l.fob * l.qty, 0);
    const u = fob > 0 ? landed / fob : 0;
    // An unbooked import PO is skipped, and the supplier's PO before it gets the chance.
    if (sane(u, ls[0].imported)) bySupplier.set(sup, { uplift: u, ref: ls[0].poNo });
  }

  const upliftFor = (cid: string, supplier: string | null): { uplift: number; source: UpliftSource; ref: string } | null => {
    const own = supplier ? byItemSupplier.get(`${cid}|${supplier}`) : undefined;
    if (own) return { uplift: own.landed / own.fob, source: 'item', ref: own.poNo };
    const sup = supplier ? bySupplier.get(supplier) : undefined;
    if (sup) return { uplift: sup.uplift, source: 'supplier', ref: sup.ref };
    const any = byItem.get(cid);
    if (any) return { uplift: any.landed / any.fob, source: 'item_elsewhere', ref: any.poNo };
    return null;
  };

  const best = new Map<string, IncomingCost>();
  const offer = (cid: string, c: Omit<IncomingCost, 'uplift' | 'upliftSource' | 'upliftRef' | 'estLandedIdr' | 'provisional'>) => {
    if (!(c.fobIdr > 0) || !c.date) return;
    const prev = best.get(cid);
    if (prev && (prev.date > c.date || (prev.date === c.date && prev.source === 'po'))) return;
    const u = upliftFor(cid, c.supplierId);
    best.set(cid, {
      ...c, uplift: u?.uplift ?? null, upliftSource: u?.source ?? null, upliftRef: u?.ref ?? null,
      estLandedIdr: Math.round(c.fobIdr * (u?.uplift ?? 1)), provisional: u == null,
    });
  };

  for (const l of input.poItems) {
    const po = poById.get(String(l.po_id));
    if (!po || !OPEN_PO.has(po.status ?? '')) continue;
    const cur = l.currency || po.currency || 'IDR';
    const pr = cur === 'IDR' ? { rate: 1, source: 'paid' as RateSource, paidPct: 100 } : rateOfPo(po);
    const rate = pr.rate;
    const unit = n(l.unit_cost);
    offer(l.component_id, {
      rateSource: pr.source, ratePaidPct: pr.paidPct,
      source: 'po', label: po.po_number || 'PO', date: day(po.po_date), status: po.status ?? '',
      currency: cur, unitForeign: unit, rate, fobIdr: unit * rate, supplierId: supplierOfPo(po),
    });
  }
  for (const l of input.quoteItems) {
    const q = quoteById.get(String(l.quote_id));
    if (!q || !LIVE_QUOTE.has(q.status ?? '')) continue;
    const d = day(q.quote_date);
    const arrived = lastArrived.get(l.component_id);
    if (arrived && d <= arrived) continue;
    const cur = l.currency || q.currency || 'IDR';
    const rate = cur === 'IDR' ? 1 : rateOf(fx, cur);
    const unit = n(l.unit_price);
    offer(l.component_id, {
      source: 'quote', label: q.pi_number || 'Quote', date: d, status: q.status ?? '',
      currency: cur, unitForeign: unit, rate, fobIdr: unit * rate, supplierId: q.supplier_id || null,
      rateSource: cur === 'IDR' ? 'paid' : fx[cur]?.source === 'benchmark' ? 'benchmark' : 'po', ratePaidPct: 0,
    });
  }
  return best;
}

export interface CostRise {
  incoming: IncomingCost;
  /** The cost the price is judged on today (landed / TUC / quote). */
  current: number;
  /** % the incoming estimate is above `current`. */
  risePct: number;
  /** The supplier price ALONE, before any import cost, already beats today's cost. */
  fobAlreadyAbove: boolean;
}

/**
 * Is the next unit dearer than the cost we price on today? Null when there is
 * nothing incoming, no current cost, or the move is under RISE_THRESHOLD_PCT.
 * Only a RISE is returned: a cheaper reorder is good news that does not need a
 * warning, and pricing it down early would give margin away on stock bought dear.
 */
export function costRise(current: number | null | undefined, incoming: IncomingCost | null | undefined): CostRise | null {
  const cur = n(current);
  if (!incoming || !(cur > 0)) return null;
  const risePct = ((incoming.estLandedIdr - cur) / cur) * 100;
  if (risePct < RISE_THRESHOLD_PCT) return null;
  return { incoming, current: cur, risePct, fobAlreadyAbove: incoming.fobIdr > cur };
}

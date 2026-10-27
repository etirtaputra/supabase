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
 * BACKWARDS. LR51100 landed at Rp 9,477,538; the reorder (PIO-017, Confirmed)
 * is USD 539 — at today's rates ≈ Rp 9.84m once it lands, and the Rp 12m net
 * that reads 21% GP on the stock in hand is ~18% on the stock that is coming.
 * A distributor prices to REPLACEMENT cost — the stock on hand is sold once,
 * the price has to fund the next container.
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
 * FOB IS NOT LANDED. A PO or quote price excludes freight, duty, local
 * delivery and bank charges. The estimate adds the supplier's import MARKUP,
 * read from the bills of a past delivered PO (see ADDON_CATS), and the rise is
 * measured on that estimated landed cost, never on the bare FOB.
 *
 * WHERE THE MARKUP COMES FROM (owner, 2026-10-27: *"it should use the previous
 * estimated Landed Cost mark up from the same supplier"*), most specific first:
 *   1. `item`           — the last fully paid PO that carried this item, from
 *                         the SAME supplier.
 *   2. `supplier`       — that supplier's last fully paid, delivered PO. This
 *                         prices an item the supplier has never sent.
 *   3. `item_elsewhere` — the last fully paid PO for this item, other supplier.
 *   4. none             — the raw price, flagged `provisional`: it can only be
 *                         too LOW, never too high, so a warning it raises is real.
 */
import type { FxRate } from './computeTUC.ts';

/** Type-only import above: computeTUC.ts cannot load under `node --test`. A
 *  currency with no known rate converts to 0 and is skipped — never guessed. */
const rateOf = (fx: Record<string, FxRate>, ccy: string): number => Number(fx[ccy]?.rate) || 0;

/** A rise smaller than this is exchange-rate rounding, not news. */
export const RISE_THRESHOLD_PCT = 1;

/**
 * THE IMPORT MARKUP, FROM THE BILLS (2026-10-27). A delivered, fully paid PO
 * says what getting its goods here cost on top of the goods themselves:
 *
 *     markup = 1 + (freight + duty + local delivery + courier + bank fees)
 *                  ÷ (the supplier principal paid, in rupiah)
 *
 * VAT and income tax are excluded (creditable, and excluded from landed cost
 * everywhere else); a penalty is excluded (a one-off, not a forecast). No
 * exchange rate enters it — both sides are rupiah actually paid.
 *
 * CORRECTION, 2026-10-27. Earlier versions learned the markup as landed ÷
 * (PO price × rate) from the stock receipts. That mixed currency into it: rupiah
 * payments booked without a rate made EB.41875 look +7% (its rate was really
 * 2,669, not the 2,502 typed), and PIO-008's extra balance payments made
 * LR51100 look +6.5% when its freight, duty and fees were +0.75% (EPEVER and
 * KSTAR both ship CIF; China duty is ~0). The receipts-based reading also
 * called KSTAR "under-booked", which it is not.
 */
export const ADDON_CATS = new Set([
  'freight_cost', 'local_import_duty', 'local_delivery', 'dhl_advance_payment_fee',
  'full_amount_bank_fee', 'telex_bank_fee', 'value_today_bank_fee', 'admin_bank_fee', 'inter_bank_transfer_fee',
]);
/** A markup outside this band is a booking error, not an import cost. */
const UPLIFT_MIN = 1;
const UPLIFT_MAX = 2;

const OPEN_PO = new Set(['Sent', 'Confirmed', 'Partially Received']);
const LIVE_QUOTE = new Set(['Open', 'Accepted']);

export interface IncPo { po_id: string | number; po_number?: string | null; po_date?: string | null; status?: string | null; currency?: string | null; exchange_rate?: number | string | null; supplier_id?: string | null; quote_id?: string | number | null; total_value?: number | string | null; incoterms?: string | null }

/**
 * WHO PAYS THE FREIGHT (owner, 2026-10-27, on EPEVER TCP 306: the reorder
 * PIO-017 is FOB Shenzhen, but the markup came from PIO-008, CIF Jakarta —
 * +0.75% instead of the ~10% EPEVER's FOB orders carry). Learn a markup only
 * from POs shipped on the same footing:
 *   'buyer'  — EXW, FCA, FAS, FOB: we pay the sea/air freight on top.
 *   'seller' — CFR, CIF, CPT, CIP, DAP, DPU, DDP: the price includes it.
 * null when the PO says nothing (and for quotes, which carry no terms).
 */
export type FreightTerms = 'buyer' | 'seller';
export function freightTerms(incoterms: string | null | undefined): FreightTerms | null {
  const t = (incoterms ?? '').trim().toUpperCase();
  if (/^(EXW|FCA|FAS|FOB)\b/.test(t)) return 'buyer';
  if (/^(CFR|CNF|C&F|CIF|CPT|CIP|DAP|DPU|DAT|DDP|DDU)\b/.test(t)) return 'seller';
  return null;
}
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
  /**
   * The incoming PO's freight terms, and whether the markup was learned on the
   * same terms. `false` = only a delivery on the OTHER terms could teach it
   * (say, a CIF markup on a FOB order): the freight may be missing.
   */
  freightTerms: FreightTerms | null;
  termsMatch: boolean | null;
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

  // When each item last arrived — a quote older than this is history the
  // landed cost has already absorbed.
  const lastArrived = new Map<string, string>();
  const poArrived = new Map<string, string>();
  for (const r of input.receipts) {
    const d = day(r.moved_at);
    if ((lastArrived.get(r.component_id) ?? '') < d) lastArrived.set(r.component_id, d);
    if (r.source_id && (poArrived.get(String(r.source_id)) ?? '') < d) poArrived.set(String(r.source_id), d);
  }

  // One lesson per delivered, fully paid PO line: that PO's import markup
  // (ADDON_CATS ÷ principal, both in rupiah). Every line of a PO shares it —
  // the true-up allocates the add-ons by value.
  interface Lesson { cid: string; date: string; poId: string; poNo: string; supplier: string | null; uplift: number; weight: number; terms: FreightTerms | null }
  const lessons: Lesson[] = [];
  for (const po of input.pos) {
    if (po.status !== 'Fully Received') continue;
    const k = String(po.po_id);
    const costs = costsByPo.get(k) ?? [];
    const cur = po.currency || 'IDR';
    if (cur !== 'IDR' && rateOfPo(po).source !== 'paid') continue;   // bills not final
    const typed = n(po.exchange_rate);
    let principal = 0, addons = 0;
    for (const c of costs) {
      const amt = n(c.amount);
      if (PRINCIPAL.has(c.cost_category)) {
        principal += (c.currency || cur) === 'IDR' ? amt : amt * (n(c.exchange_rate) || typed || rateOf(fx, c.currency || cur));
      } else if (ADDON_CATS.has(c.cost_category)) addons += amt;
    }
    if (!(principal > 0)) continue;
    const uplift = 1 + addons / principal;
    const date = poArrived.get(k) ?? day(po.po_date);
    for (const l of input.poItems) {
      if (String(l.po_id) !== k) continue;
      lessons.push({ cid: l.component_id, date, poId: k, poNo: po.po_number || 'PO', supplier: supplierOfPo(po), uplift, weight: principal, terms: freightTerms(po.incoterms) });
    }
  }
  const sane = (u: number) => u >= UPLIFT_MIN && u <= UPLIFT_MAX;
  const newestFirst = (a: Lesson, b: Lesson) => b.date.localeCompare(a.date);
  lessons.sort(newestFirst);

  // The newest sane lesson per key — each key kept twice: any terms, and per terms.
  const newest = new Map<string, Lesson>();
  const keep = (k: string, l: Lesson) => { if (!newest.has(k)) newest.set(k, l); };
  for (const l of lessons) {
    if (!sane(l.uplift)) continue;
    for (const t of ['*', l.terms ?? '?']) {
      if (l.supplier) { keep(`is|${l.cid}|${l.supplier}|${t}`, l); keep(`s|${l.supplier}|${t}`, l); }
      keep(`i|${l.cid}|${t}`, l);
    }
  }

  /**
   * Most specific first, and SAME FREIGHT TERMS before anything else: this
   * item from this supplier → this supplier → this item elsewhere, each tried
   * on matching terms first; only then on any terms (and said so).
   */
  const upliftFor = (cid: string, supplier: string | null, terms: FreightTerms | null):
    { uplift: number; source: UpliftSource; ref: string; termsMatch: boolean | null } | null => {
    const tiers: [string, UpliftSource][] = [];
    if (supplier) tiers.push([`is|${cid}|${supplier}`, 'item'], [`s|${supplier}`, 'supplier']);
    tiers.push([`i|${cid}`, 'item_elsewhere']);
    const passes: string[] = terms ? [terms, '*'] : ['*'];
    // Matching terms across every tier first, then any terms across every tier.
    for (const t of passes) {
      for (const [k, source] of tiers) {
        const l = newest.get(`${k}|${t}`);
        if (l) return { uplift: l.uplift, source, ref: l.poNo, termsMatch: terms ? l.terms === terms : null };
      }
    }
    return null;
  };

  const best = new Map<string, IncomingCost>();
  const offer = (cid: string, c: Omit<IncomingCost, 'uplift' | 'upliftSource' | 'upliftRef' | 'termsMatch' | 'estLandedIdr' | 'provisional'>) => {
    if (!(c.fobIdr > 0) || !c.date) return;
    const prev = best.get(cid);
    if (prev && (prev.date > c.date || (prev.date === c.date && prev.source === 'po'))) return;
    const u = upliftFor(cid, c.supplierId, c.freightTerms);
    best.set(cid, {
      ...c, uplift: u?.uplift ?? null, upliftSource: u?.source ?? null, upliftRef: u?.ref ?? null, termsMatch: u?.termsMatch ?? null,
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
      currency: cur, unitForeign: unit, rate, fobIdr: unit * rate, supplierId: supplierOfPo(po), freightTerms: freightTerms(po.incoterms),
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
      currency: cur, unitForeign: unit, rate, fobIdr: unit * rate, supplierId: q.supplier_id || null, freightTerms: null,
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

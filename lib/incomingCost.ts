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
 * charges, so comparing it raw against a landed cost flatters it. The item's
 * own last landing tells us its import uplift (landed ÷ the PO price it landed
 * from — LR51100: 9,477,538 ÷ (509 × 17,490) = 1.065), and the estimate
 * applies it. With no landing to learn from, the raw price is used and flagged
 * `provisional` — it can only be too LOW, never too high, so a warning it
 * raises is real.
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

const OPEN_PO = new Set(['Sent', 'Confirmed', 'Partially Received']);
const LIVE_QUOTE = new Set(['Open', 'Accepted']);

export interface IncPo { po_id: string | number; po_number?: string | null; po_date?: string | null; status?: string | null; currency?: string | null; exchange_rate?: number | string | null }
export interface IncPoLine { po_id: string | number; component_id: string; unit_cost: number | string; currency?: string | null }
export interface IncQuote { quote_id: string | number; pi_number?: string | null; quote_date?: string | null; status?: string | null; currency?: string | null }
export interface IncQuoteLine { quote_id: string | number; component_id: string; unit_price: number | string; currency?: string | null }
/** A goods-in movement (30.0, source_type 'receipt'): landed IDR per unit, and the PO it came from. */
export interface IncReceipt { component_id: string; unit_cost_idr: number | string | null; moved_at: string; source_id: string | null }

export interface IncomingCost {
  source: 'po' | 'quote';
  /** PO number or the supplier's PI/quote number. */
  label: string;
  date: string;
  status: string;
  currency: string;
  /** Price per unit in the document's currency. */
  unitForeign: number;
  /** Rate used to convert: the PO's own, or the company/latest rate for a quote. */
  rate: number;
  /** unitForeign × rate — before freight, duty and fees. */
  fobIdr: number;
  /** landed ÷ FOB from this item's last landing, or null when it never landed from a priced PO. */
  uplift: number | null;
  /** fobIdr × uplift — what a unit will cost once it lands. */
  estLandedIdr: number;
  /** No uplift known: the estimate is the raw FOB and can only be too low. */
  provisional: boolean;
}

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const day = (s: string | null | undefined) => (s ?? '').slice(0, 10);

/** Newest incoming cost per component. Items with nothing on order or quoted are absent. */
export function incomingCosts(
  input: { pos: IncPo[]; poItems: IncPoLine[]; quotes: IncQuote[]; quoteItems: IncQuoteLine[]; receipts: IncReceipt[] },
  fx: Record<string, FxRate>,
): Map<string, IncomingCost> {
  const poById = new Map(input.pos.map((p) => [String(p.po_id), p]));
  const quoteById = new Map(input.quotes.map((q) => [String(q.quote_id), q]));

  // The newest landing per item: when it arrived, and the uplift it implies.
  const lastIn = new Map<string, { date: string; uplift: number | null }>();
  for (const r of input.receipts) {
    const landed = n(r.unit_cost_idr);
    const d = day(r.moved_at);
    const prev = lastIn.get(r.component_id);
    if (prev && prev.date > d) continue;
    let uplift: number | null = null;
    const po = r.source_id ? poById.get(String(r.source_id)) : undefined;
    const line = po && input.poItems.find((l) => String(l.po_id) === String(po.po_id) && l.component_id === r.component_id);
    if (po && line && landed > 0) {
      const cur = line.currency || po.currency || 'IDR';
      const rate = cur === 'IDR' ? 1 : n(po.exchange_rate) || rateOf(fx, cur);
      const fob = n(line.unit_cost) * rate;
      const u = fob > 0 ? landed / fob : 0;
      if (u >= UPLIFT_MIN && u <= UPLIFT_MAX) uplift = u;
    }
    // A later landing with no usable uplift still moves the "arrived" date,
    // but keeps the uplift we learned from the one before.
    lastIn.set(r.component_id, { date: d, uplift: uplift ?? prev?.uplift ?? null });
  }

  const best = new Map<string, IncomingCost>();
  const offer = (cid: string, c: Omit<IncomingCost, 'uplift' | 'estLandedIdr' | 'provisional'>) => {
    if (!(c.fobIdr > 0) || !c.date) return;
    const prev = best.get(cid);
    if (prev && (prev.date > c.date || (prev.date === c.date && prev.source === 'po'))) return;
    const uplift = lastIn.get(cid)?.uplift ?? null;
    best.set(cid, { ...c, uplift, estLandedIdr: Math.round(c.fobIdr * (uplift ?? 1)), provisional: uplift == null });
  };

  for (const l of input.poItems) {
    const po = poById.get(String(l.po_id));
    if (!po || !OPEN_PO.has(po.status ?? '')) continue;
    const cur = l.currency || po.currency || 'IDR';
    const rate = cur === 'IDR' ? 1 : n(po.exchange_rate) || rateOf(fx, cur);
    const unit = n(l.unit_cost);
    offer(l.component_id, {
      source: 'po', label: po.po_number || 'PO', date: day(po.po_date), status: po.status ?? '',
      currency: cur, unitForeign: unit, rate, fobIdr: unit * rate,
    });
  }
  for (const l of input.quoteItems) {
    const q = quoteById.get(String(l.quote_id));
    if (!q || !LIVE_QUOTE.has(q.status ?? '')) continue;
    const d = day(q.quote_date);
    const arrived = lastIn.get(l.component_id)?.date;
    if (arrived && d <= arrived) continue;
    const cur = l.currency || q.currency || 'IDR';
    const rate = cur === 'IDR' ? 1 : rateOf(fx, cur);
    const unit = n(l.unit_price);
    offer(l.component_id, {
      source: 'quote', label: q.pi_number || 'Quote', date: d, status: q.status ?? '',
      currency: cur, unitForeign: unit, rate, fobIdr: unit * rate,
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

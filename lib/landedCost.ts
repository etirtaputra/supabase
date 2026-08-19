/**
 * Landed-cost reconciliation — truing up what a goods receipt GUESSED against
 * what the import actually cost.
 *
 * The problem this exists to solve: goods arrive before their bills do. When
 * /stock/receive books a receipt it values the stock at the costs recorded SO
 * FAR (principal, whatever fees are in), because that is all anyone knows on
 * the day the truck shows up. The freight invoice, the customs duty, the telex
 * fee and the final balance payment land weeks later. Nothing used to go back
 * and correct the ledger, so every import sat in stock at roughly its principal
 * — and every gross margin computed off that cost was flattered by the
 * difference.
 *
 * The correction has two halves, and the honest thing is to name both:
 *   • the units STILL ON HAND can be revalued — inventory carries the real cost
 *     from now on (this is what gets posted to the ledger);
 *   • the units ALREADY SOLD cannot — their COGS was booked at the estimate and
 *     that sale is history. That part is reported, never silently swallowed,
 *     because it is exactly how much past gross profit was overstated.
 *
 * Allocation mirrors `computeTUC` (the cost engine of record) so a landed cost
 * never means two different things: pool = every recorded cost except local
 * taxes, converted at the cost row's own rate (falling back to the PO's), and
 * spread over lines by value. Because the pool is IDR and a foreign PO's lines
 * are not, the factor carries the exchange rate with it — the same trick
 * /stock/receive uses for its prefill.
 *
 * Pure and exported for tests; no React, no fetch. `fetchLandedVariances` is
 * the thin wrapper that feeds the screens.
 */
// Relative import keeps this runnable under `node --test` (no @/ alias there)
import type { SupabaseClient } from '@supabase/supabase-js';
import { TAX_CATS, BALANCE_CATS } from '../constants/costCategories.ts';

/**
 * What counts as worth a human's attention. A correction clears the floor if it
 * is either big in rupiah OR big relative to what the goods cost: a bank fee of
 * Rp 3,000 spread over a 5,000,000 domestic PO is real, but posting it moves no
 * decision, while the same rupiah on a tiny PO does move the unit cost.
 * Whatever falls below is counted and reported, never silently dropped.
 */
export const MATERIAL_IDR = 50_000;
export const MATERIAL_PCT = 0.01;
/** Under this, it is arithmetic noise whatever the percentage says. */
export const DUST_IDR = 1_000;

/** What a revaluation movement is called in the ledger. */
export const REVALUE_DIRECTION = 'revalue';
export const REVALUE_SOURCE_TYPE = 'revaluation';

// ── Row shapes (only the columns the math reads) ─────────────────────────────
export interface LcPo {
  po_id: string | number;
  po_number: string | null;
  po_date: string | null;
  status: string | null;
  currency: string | null;
  exchange_rate: number | null;
  supplier_id: string | null;
  /** Most POs carry the vendor only on their supplier quote — the screens resolve through it. */
  quote_id: string | number | null;
}
export interface LcLine { po_id: string | number; component_id: string | null; quantity: number; unit_cost: number }
export interface LcCost {
  po_id: string | number;
  cost_category: string;
  amount: number;
  currency: string;
  exchange_rate: number | null;
  payment_date?: string | null;
}
/** A ledger row. Receipts and revaluations both carry the PO id in `source_id`. */
export interface LcMovement {
  component_id: string;
  location: string;
  direction: string;
  quantity: number;
  unit_cost_idr: number | null;
  source_type: string | null;
  source_id: string | null;
  moved_at?: string | null;
}
export interface LcBalance { component_id: string; location: string; qty_on_hand: number; avg_cost_idr: number | null }

const num = (v: unknown): number => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};

// ── The cost pool ────────────────────────────────────────────────────────────
/**
 * Every recorded cost of a PO in IDR, except local taxes — principal, bank
 * fees, freight, duty, penalties. Identical to computeTUC's pool so the two
 * engines can never disagree about what "landed" includes.
 */
export function poolIdrOf(costs: LcCost[], poRate: number | null): number {
  let pool = 0;
  for (const c of costs) {
    if (TAX_CATS.has(c.cost_category)) continue;
    pool += c.currency === 'IDR'
      ? num(c.amount)
      : num(c.amount) * (num(c.exchange_rate) || num(poRate) || 1);
  }
  return pool;
}

/** A balance payment exists — the supplier is paid off, so the costs are final. */
export const isSettled = (costs: LcCost[]): boolean => costs.some((c) => BALANCE_CATS.has(c.cost_category));

/**
 * IDR landed cost per unit of PO-currency line value. Multiply a line's unit
 * cost (in the PO's own currency) by this to get its landed cost in rupiah.
 * Null when there is nothing to allocate — no costs recorded yet, or a PO whose
 * lines carry no value.
 */
export function landedFactorOf(lines: LcLine[], costs: LcCost[], poRate: number | null): number | null {
  const lineValue = lines.reduce((s, l) => s + num(l.unit_cost) * num(l.quantity), 0);
  const pool = poolIdrOf(costs, poRate);
  if (lineValue <= 0 || pool <= 0) return null;
  return pool / lineValue;
}

// ── The variance ─────────────────────────────────────────────────────────────
/** One item at one warehouse, received against one PO. */
export interface ItemVariance {
  componentId: string;
  location: string;
  /** Units booked in against this PO at this location. */
  received: number;
  /** What the receipt valued them at, per unit (weighted across partial receipts). */
  bookedUnit: number;
  /** What they actually cost, per unit, at the cost pool as it stands today. */
  actualUnit: number;
  /** actualUnit − bookedUnit. Negative when the estimate was too generous. */
  deltaUnit: number;
  /** received × deltaUnit — the whole correction this PO owes for this item. */
  deltaValue: number;
  /** On hand right now at this location (all POs, moving average). */
  onHand: number;
  /** Units this correction can still reach: min(received, onHand). */
  revaluable: number;
  /** revaluable × deltaUnit — what posting will add to stock value. */
  inventoryDelta: number;
  /** The rest: units already gone, booked into COGS at the old estimate. */
  cogsDelta: number;
  /** Moving-average cost before and after posting. */
  oldAvg: number;
  newAvg: number;
}

export type ReconStatus =
  /** Supplier paid off — the costs are final and this is worth posting. */
  | 'ready'
  /** Goods in, bills still arriving — the number will move; posting now just means posting again later. */
  | 'awaiting';

export interface PoVariance {
  poId: string;
  poNumber: string;
  poDate: string;
  currency: string;
  supplierId: string | null;
  quoteId: string | null;
  status: ReconStatus;
  /** IDR per unit of line value — carries the exchange rate for foreign POs. */
  factor: number;
  /** The whole PO's cost pool in IDR (taxes excluded). */
  poolIdr: number;
  /** What the receipts booked, in total. */
  bookedValue: number;
  /** What those same received units actually cost. */
  actualValue: number;
  /** actualValue − bookedValue: the correction still owed. */
  delta: number;
  /** Share of the booked value, as a fraction (0.07 = 7% understated). */
  deltaPct: number;
  inventoryDelta: number;
  cogsDelta: number;
  items: ItemVariance[];
  /** Components received against this PO that no PO line explains — never guessed at. */
  unmatched: number;
  /** True once a revaluation has been posted for this PO. */
  trued: boolean;
}

export interface LandedSummary {
  /** Every PO carrying a material variance, biggest first. */
  pos: PoVariance[];
  ready: PoVariance[];
  awaiting: PoVariance[];
  /** Totals across `ready` only — the number a human should act on. */
  readyDelta: number;
  readyInventoryDelta: number;
  readyCogsDelta: number;
  /** Received POs with no costs recorded at all — nothing to allocate yet. */
  uncosted: number;
  /** POs whose correction is too small to be worth posting, and what they add up to. */
  immaterial: number;
  immaterialDelta: number;
}

const keyOf = (componentId: string, location: string): string => `${componentId}·${location}`;

/**
 * The whole reconciliation, computed from rows the caller already holds.
 *
 * Previously posted revaluations count as booked value, so a PO that has been
 * trued up falls out of the list — and if new costs arrive afterwards, only the
 * INCREMENT comes back. Running this twice on unchanged data is a no-op, which
 * is what makes the "Post true-up" button safe to press.
 */
export function computeLandedVariances(
  pos: LcPo[],
  lines: LcLine[],
  costs: LcCost[],
  movements: LcMovement[],
  balances: LcBalance[],
  opts: { materialIdr?: number; materialPct?: number } = {},
): LandedSummary {
  const materialIdr = opts.materialIdr ?? MATERIAL_IDR;
  const materialPct = opts.materialPct ?? MATERIAL_PCT;
  const linesByPo = new Map<string, LcLine[]>();
  for (const l of lines) {
    const k = String(l.po_id);
    const arr = linesByPo.get(k);
    if (arr) arr.push(l); else linesByPo.set(k, [l]);
  }
  const costsByPo = new Map<string, LcCost[]>();
  for (const c of costs) {
    const k = String(c.po_id);
    const arr = costsByPo.get(k);
    if (arr) arr.push(c); else costsByPo.set(k, [c]);
  }
  const balByKey = new Map<string, LcBalance>();
  for (const b of balances) balByKey.set(keyOf(b.component_id, b.location), b);

  // Booked value per PO → item → location: receipts, plus any true-up already
  // posted against them. A revaluation carries the units it relates to and the
  // per-unit correction, so quantity × unit_cost is the value it recognised.
  interface Booked { received: number; value: number; revalued: boolean }
  const bookedByPo = new Map<string, Map<string, Booked>>();
  for (const m of movements) {
    const poKey = String(m.source_id ?? '');
    if (!poKey) continue;
    const isReceipt = m.direction === 'in' && m.source_type === 'receipt';
    const isRevalue = m.source_type === REVALUE_SOURCE_TYPE;
    if (!isReceipt && !isRevalue) continue;
    let byItem = bookedByPo.get(poKey);
    if (!byItem) { byItem = new Map(); bookedByPo.set(poKey, byItem); }
    const k = keyOf(m.component_id, m.location);
    const e = byItem.get(k) ?? { received: 0, value: 0, revalued: false };
    const qty = num(m.quantity);
    e.value += qty * num(m.unit_cost_idr);
    if (isReceipt) e.received += qty;
    else e.revalued = true;
    byItem.set(k, e);
  }

  const out: PoVariance[] = [];
  let uncosted = 0;
  let immaterial = 0;
  let immaterialDelta = 0;

  for (const po of pos) {
    const poKey = String(po.po_id);
    const booked = bookedByPo.get(poKey);
    if (!booked || booked.size === 0) continue;              // nothing received against it

    const poLines = linesByPo.get(poKey) ?? [];
    const poCosts = costsByPo.get(poKey) ?? [];
    const factor = landedFactorOf(poLines, poCosts, po.exchange_rate);
    if (factor == null) { uncosted += 1; continue; }         // no bills yet — nothing to allocate

    // A component can sit on several PO lines; the receive screen aggregates
    // them, so the reconciliation must aggregate them the same way.
    const unitCostByComp = new Map<string, { value: number; qty: number }>();
    for (const l of poLines) {
      if (!l.component_id) continue;
      const a = unitCostByComp.get(l.component_id) ?? { value: 0, qty: 0 };
      a.value += num(l.unit_cost) * num(l.quantity);
      a.qty += num(l.quantity);
      unitCostByComp.set(l.component_id, a);
    }

    const items: ItemVariance[] = [];
    let unmatched = 0;
    let trued = false;
    for (const [k, b] of booked) {
      if (b.revalued) trued = true;
      if (b.received <= 0) continue;                          // a stray revaluation with no receipt
      const sep = k.lastIndexOf('·');
      const componentId = k.slice(0, sep);
      const location = k.slice(sep + 1);
      const line = unitCostByComp.get(componentId);
      if (!line || line.qty <= 0) { unmatched += 1; continue; }

      const actualUnit = (line.value / line.qty) * factor;
      const bookedUnit = b.value / b.received;
      const deltaUnit = actualUnit - bookedUnit;
      const deltaValue = deltaUnit * b.received;
      const bal = balByKey.get(k);
      const onHand = Math.max(0, num(bal?.qty_on_hand));
      const oldAvg = num(bal?.avg_cost_idr);
      const revaluable = Math.min(b.received, onHand);
      const inventoryDelta = revaluable * deltaUnit;
      items.push({
        componentId, location,
        received: b.received, bookedUnit, actualUnit, deltaUnit, deltaValue,
        onHand, revaluable, inventoryDelta,
        cogsDelta: deltaValue - inventoryDelta,
        oldAvg,
        // Spread over everything on hand — moving average holds no lots, so the
        // correction lands on the pool the units are mixed into.
        newAvg: onHand > 0 ? Math.max(0, oldAvg + inventoryDelta / onHand) : oldAvg,
      });
    }
    if (items.length === 0) continue;

    const bookedValue = items.reduce((s, i) => s + i.bookedUnit * i.received, 0);
    const actualValue = items.reduce((s, i) => s + i.actualUnit * i.received, 0);
    const delta = actualValue - bookedValue;
    const deltaPct = bookedValue > 0 ? delta / bookedValue : 0;
    const big = Math.abs(delta) >= materialIdr
      || (Math.abs(deltaPct) >= materialPct && Math.abs(delta) >= DUST_IDR);
    if (!big) {
      if (Math.abs(delta) >= DUST_IDR) { immaterial += 1; immaterialDelta += delta; }
      continue;
    }

    items.sort((a, b) => Math.abs(b.deltaValue) - Math.abs(a.deltaValue));
    out.push({
      poId: poKey,
      poNumber: (po.po_number ?? '').trim() || `PO ${poKey.slice(0, 8)}`,
      poDate: (po.po_date ?? '').slice(0, 10),
      currency: po.currency ?? 'IDR',
      supplierId: po.supplier_id ?? null,
      quoteId: po.quote_id != null ? String(po.quote_id) : null,
      status: isSettled(poCosts) ? 'ready' : 'awaiting',
      factor,
      poolIdr: poolIdrOf(poCosts, po.exchange_rate),
      bookedValue, actualValue, delta, deltaPct,
      inventoryDelta: items.reduce((s, i) => s + i.inventoryDelta, 0),
      cogsDelta: items.reduce((s, i) => s + i.cogsDelta, 0),
      items, unmatched, trued,
    });
  }

  out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const ready = out.filter((p) => p.status === 'ready');
  return {
    pos: out,
    ready,
    awaiting: out.filter((p) => p.status === 'awaiting'),
    readyDelta: ready.reduce((s, p) => s + p.delta, 0),
    readyInventoryDelta: ready.reduce((s, p) => s + p.inventoryDelta, 0),
    readyCogsDelta: ready.reduce((s, p) => s + p.cogsDelta, 0),
    uncosted, immaterial, immaterialDelta,
  };
}

// ── Posting ──────────────────────────────────────────────────────────────────
/** A ledger row ready to insert — one per item whose correction can still reach stock. */
export interface RevaluationRow {
  component_id: string;
  location: string;
  direction: string;
  quantity: number;
  unit_cost_idr: number;
  source_type: string;
  source_id: string;
  moved_at?: string;
  notes: string;
}

/**
 * The movements that post a PO's true-up.
 *
 * `quantity` is the units RECEIVED and `unit_cost_idr` the per-unit correction,
 * so the row states the whole economic event; the database applies only the
 * part inventory can still absorb (units still on hand) and leaves the rest —
 * the units already sold — as the reported COGS miss. Items with no units left
 * anywhere write no row at all: there is nothing to revalue, and a ledger entry
 * that changes nothing is noise.
 */
export function revaluationRows(v: PoVariance, movedAt?: string): RevaluationRow[] {
  const rows: RevaluationRow[] = [];
  for (const i of v.items) {
    if (i.revaluable <= 0 || Math.abs(i.deltaUnit) < 0.5) continue;
    rows.push({
      component_id: i.componentId,
      location: i.location,
      direction: REVALUE_DIRECTION,
      quantity: i.received,
      unit_cost_idr: Math.round(i.deltaUnit),
      source_type: REVALUE_SOURCE_TYPE,
      source_id: v.poId,
      ...(movedAt ? { moved_at: movedAt } : {}),
      notes: `Landed true-up · ${v.poNumber} · ${i.deltaUnit >= 0 ? '+' : '−'}${Math.round(Math.abs(i.deltaUnit)).toLocaleString('en-US')}/unit on ${Math.round(i.received).toLocaleString('en-US')} received, ${Math.round(i.revaluable).toLocaleString('en-US')} still on hand`,
    });
  }
  return rows;
}

// ── Fetch wrapper ────────────────────────────────────────────────────────────
/** Page past PostgREST's default 1,000-row ceiling — the ledger is long. */
async function pageAll<T>(supabase: SupabaseClient, table: string, cols: string): Promise<T[]> {
  const PAGE = 1000;
  let all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(cols).range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    all = all.concat(data as unknown as T[]);
    if (data.length < PAGE) break;
  }
  return all;
}

export async function fetchLandedVariances(supabase: SupabaseClient): Promise<LandedSummary> {
  const [pos, lines, costs, movements, balances] = await Promise.all([
    pageAll<LcPo>(supabase, '5.0_purchases', 'po_id, po_number, po_date, status, currency, exchange_rate, supplier_id, quote_id'),
    pageAll<LcLine>(supabase, '5.1_purchase_line_items', 'po_id, component_id, quantity, unit_cost'),
    pageAll<LcCost>(supabase, '6.0_po_costs', 'po_id, cost_category, amount, currency, exchange_rate, payment_date'),
    pageAll<LcMovement>(supabase, '30.0_stock_movements', 'component_id, location, direction, quantity, unit_cost_idr, source_type, source_id, moved_at'),
    pageAll<LcBalance>(supabase, '30.1_stock_balances', 'component_id, location, qty_on_hand, avg_cost_idr'),
  ]);
  return computeLandedVariances(pos, lines, costs, movements, balances);
}

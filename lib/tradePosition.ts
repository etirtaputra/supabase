/**
 * TRADE HISTORY ANALYSIS — the position view of an item.
 *
 * A stock item is a trade: cash goes out as purchases, comes back as sales, and
 * whatever is still on the shelf is an OPEN POSITION. This module answers the
 * question a trader asks about an open position and a WAP report never can:
 *
 *     what do I still need to get back before this trade is whole?
 *
 *     Position Cost     = Σ purchase value − Σ invoiced value      (all time)
 *     Position Qty      = Σ received qty   − Σ invoiced qty
 *     Avg Position Cost = Position Cost ÷ Position Qty
 *
 * Which is the same thing as
 *
 *     Avg Position Cost = WAP − (realized GP ÷ remaining qty)
 *
 * — every rupiah of profit already banked lowers the break-even on what is
 * left. That is why this is NOT a cost and must never value inventory or book
 * COGS: `30.1_stock_balances.avg_cost_idr` remains the only cost of record.
 * This number is a RECOVERY THRESHOLD, and its job is to answer "can I discount
 * this to clear it?" — below Avg Position Cost the trade never recovers.
 *
 * Deliberate choices, because each one silently biases the answer:
 *
 * - RECEIVED basis, not ordered. Position Qty has to reconcile to the
 *   warehouse or nobody will trust the screen; goods still on the water are
 *   reported separately as in-transit.
 * - Purchase value comes from the movement ledger's `unit_cost_idr`, which
 *   /stock/receive already writes as LANDED cost with creditable taxes
 *   excluded (see computeTUC) — PPN Masukan and PPh 22 are recoverable and
 *   would otherwise inflate the position.
 * - Sales value is `line_total`, i.e. NET of PPN. Comparing a gross invoice
 *   against an ex-tax purchase overstates recovery by the full VAT rate.
 * - ALL TIME, always. A date range would count sales of units bought before
 *   the window and the position arithmetic stops meaning anything.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface PositionRow {
  component_id: string;
  label: string;
  brand: string | null;
  category: string | null;
  unit: string | null;

  /** Received, at landed cost. */
  poQty: number;
  poValue: number;
  avgPoPrice: number | null;

  /** Invoiced, net of PPN. */
  invQty: number;
  invValue: number;
  avgInvPrice: number | null;

  posQty: number;
  posCost: number;
  /** null when nothing is left, or when the position has been fully recovered. */
  avgPosCost: number | null;
  /** Σ invoiced ≥ Σ purchased: the remaining units are free carry. */
  recovered: boolean;
  /** Profit already banked beyond the entire purchase cost (recovered rows only). */
  surplus: number;

  /** Mark: the item's net sell price (Tier 1, excl. PPN) — the conservative mark. */
  mark: number | null;
  posValue: number | null;
  /** Position Value − Position Cost. Identically equal to total realized + unrealized P&L. */
  pnl: number | null;
  roiPct: number | null;

  /** Reconciliation against the physical ledger. */
  onHand: number;
  deliveredQty: number;
  /** invoiced − delivered: positive = invoiced ahead of shipment, negative = shipped not yet invoiced. */
  billingGap: number;

  inTransitQty: number;
  inTransitValue: number;

  firstBuy: string | null;
  lastBuy: string | null;
  lastSale: string | null;
}

export interface PositionTotals {
  poValue: number;
  invValue: number;
  posCost: number;
  posValue: number;
  pnl: number;
  roiPct: number | null;
  recoveredCount: number;
  recoveredValue: number;
  openCount: number;
  inTransitValue: number;
  /** Rows whose mark price is missing — their posValue and P&L are excluded from the totals. */
  unmarked: number;
}

const num = (v: unknown): number => Number(v) || 0;

/** Supabase caps a select at 1000 rows; walk the whole table. */
async function pageAll<T>(
  supabase: SupabaseClient, table: string, cols: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(cols).range(from, from + 999);
    if (error || !data || !data.length) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

interface Move { component_id: string; direction: string; quantity: number; unit_cost_idr: number | null; moved_at: string; source_type: string | null; source_id: string | null }
interface Bal { component_id: string; qty_on_hand: number; avg_cost_idr: number | null }
interface Comp { component_id: string; internal_description: string | null; supplier_model: string | null; brand: string | null; category: string | null; unit: string | null; selling_price_idr: number | null }
interface InvItem { invoice_id: string; so_item_id: string | null; qty: number; line_total: number }
interface Inv { invoice_id: string; kind: string | null; issued_at: string | null }
interface SoItem { item_id: string; component_id: string | null }
interface PoLine { po_id: string; component_id: string | null; quantity: number; unit_cost: number; currency: string | null }
interface Po { po_id: string; status: string | null; currency: string | null; exchange_rate: number | null }

export async function fetchTradePositions(
  supabase: SupabaseClient,
): Promise<{ rows: PositionRow[]; totals: PositionTotals }> {
  const [moves, bals, comps, invItems, invs, soItems, poLines, pos] = await Promise.all([
    pageAll<Move>(supabase, '30.0_stock_movements', 'component_id, direction, quantity, unit_cost_idr, moved_at, source_type, source_id'),
    pageAll<Bal>(supabase, '30.1_stock_balances', 'component_id, qty_on_hand, avg_cost_idr'),
    pageAll<Comp>(supabase, '3.0_components', 'component_id, internal_description, supplier_model, brand, category, unit, selling_price_idr'),
    pageAll<InvItem>(supabase, '25.1_sales_invoice_items', 'invoice_id, so_item_id, qty, line_total'),
    pageAll<Inv>(supabase, '25.0_sales_invoices', 'invoice_id, kind, issued_at'),
    pageAll<SoItem>(supabase, '22.1_sales_quote_items', 'item_id, component_id'),
    pageAll<PoLine>(supabase, '5.1_purchase_line_items', 'po_id, component_id, quantity, unit_cost, currency'),
    pageAll<Po>(supabase, '5.0_purchases', 'po_id, status, currency, exchange_rate'),
  ]);

  // ── Buy side: received qty and LANDED value, from the movement ledger ──────
  interface Agg { poQty: number; poValue: number; delivered: number; firstBuy: string | null; lastBuy: string | null }
  const buy = new Map<string, Agg>();
  const receivedByPoComp = new Map<string, number>();
  for (const m of moves) {
    const a = buy.get(m.component_id) ?? { poQty: 0, poValue: 0, delivered: 0, firstBuy: null, lastBuy: null };
    const q = num(m.quantity);
    if (m.direction === 'in') {
      a.poQty += q;
      a.poValue += q * num(m.unit_cost_idr);
      const d = (m.moved_at ?? '').slice(0, 10);
      if (d) {
        if (!a.firstBuy || d < a.firstBuy) a.firstBuy = d;
        if (!a.lastBuy || d > a.lastBuy) a.lastBuy = d;
      }
      if (m.source_type === 'receipt' && m.source_id) {
        const k = `${String(m.source_id)}·${m.component_id}`;
        receivedByPoComp.set(k, (receivedByPoComp.get(k) ?? 0) + q);
      }
    } else if (m.direction === 'revalue') {
      // Value only: a landed-cost true-up buys no units, it re-prices the ones
      // already received. Counting it as quantity would invent stock.
      a.poValue += q * num(m.unit_cost_idr);
    } else {
      a.delivered += q;
    }
    buy.set(m.component_id, a);
  }

  // ── Sell side: invoiced qty and value NET of PPN ───────────────────────────
  // Percentage / down-payment invoices carry no item lines, so joining through
  // 25.1 excludes them naturally; the kind filter is belt and braces.
  const compOfSoItem = new Map<string, string>();
  for (const s of soItems) if (s.component_id) compOfSoItem.set(String(s.item_id), s.component_id);
  const invMeta = new Map(invs.map((i) => [String(i.invoice_id), i]));

  interface SAgg { invQty: number; invValue: number; lastSale: string | null }
  const sell = new Map<string, SAgg>();
  for (const li of invItems) {
    const inv = invMeta.get(String(li.invoice_id));
    if (!inv || !inv.issued_at) continue;
    if (inv.kind && inv.kind !== 'items') continue;
    const cid = li.so_item_id ? compOfSoItem.get(String(li.so_item_id)) : undefined;
    if (!cid) continue;
    const a = sell.get(cid) ?? { invQty: 0, invValue: 0, lastSale: null };
    a.invQty += num(li.qty);
    a.invValue += num(li.line_total);
    const d = inv.issued_at.slice(0, 10);
    if (!a.lastSale || d > a.lastSale) a.lastSale = d;
    sell.set(cid, a);
  }

  // ── Goods still on the water — reported beside the position, never in it ───
  const poById = new Map(pos.map((p) => [String(p.po_id), p]));
  const transit = new Map<string, { qty: number; value: number }>();
  for (const l of poLines) {
    if (!l.component_id) continue;
    const po = poById.get(String(l.po_id));
    if (!po || po.status !== 'Confirmed') continue;   // ordered, nothing received yet
    const got = receivedByPoComp.get(`${String(l.po_id)}·${l.component_id}`) ?? 0;
    const open = num(l.quantity) - got;
    if (open <= 0) continue;
    const ccy = l.currency ?? po.currency;
    const fx = ccy === 'IDR' ? 1 : num(po.exchange_rate);
    const t = transit.get(l.component_id) ?? { qty: 0, value: 0 };
    t.qty += open;
    t.value += open * num(l.unit_cost) * fx;          // PO value, not landed
    transit.set(l.component_id, t);
  }

  const balOf = new Map<string, number>();
  for (const b of bals) balOf.set(b.component_id, (balOf.get(b.component_id) ?? 0) + num(b.qty_on_hand));

  // ── Assemble ──────────────────────────────────────────────────────────────
  const compById = new Map(comps.map((c) => [c.component_id, c]));
  const ids = new Set<string>([...buy.keys(), ...sell.keys(), ...transit.keys()]);

  const rows: PositionRow[] = [];
  for (const id of ids) {
    const c = compById.get(id);
    const b = buy.get(id) ?? { poQty: 0, poValue: 0, delivered: 0, firstBuy: null, lastBuy: null };
    const s = sell.get(id) ?? { invQty: 0, invValue: 0, lastSale: null };
    const t = transit.get(id) ?? { qty: 0, value: 0 };
    if (b.poQty <= 0 && s.invQty <= 0 && t.qty <= 0) continue;

    const posQty = b.poQty - s.invQty;
    const posCost = b.poValue - s.invValue;
    const recovered = posCost <= 0 && b.poValue > 0;

    const mark = c?.selling_price_idr != null && num(c.selling_price_idr) > 0 ? num(c.selling_price_idr) : null;
    const posValue = mark != null && posQty > 0 ? posQty * mark : posQty > 0 ? null : 0;
    const pnl = posValue != null ? posValue - posCost : null;

    rows.push({
      component_id: id,
      label: (c?.internal_description?.trim() || c?.supplier_model || '(no description)'),
      brand: c?.brand ?? null,
      category: c?.category ?? null,
      unit: c?.unit ?? null,

      poQty: b.poQty,
      poValue: b.poValue,
      avgPoPrice: b.poQty > 0 ? b.poValue / b.poQty : null,

      invQty: s.invQty,
      invValue: s.invValue,
      avgInvPrice: s.invQty > 0 ? s.invValue / s.invQty : null,

      posQty,
      posCost,
      // Negative cost is not a price — it is recovery, and it gets its own badge
      avgPosCost: posQty > 0 && posCost > 0 ? posCost / posQty : null,
      recovered,
      surplus: recovered ? -posCost : 0,

      mark,
      posValue,
      pnl,
      roiPct: pnl != null && b.poValue > 0 ? (pnl / b.poValue) * 100 : null,

      onHand: balOf.get(id) ?? 0,
      deliveredQty: b.delivered,
      billingGap: s.invQty - b.delivered,

      inTransitQty: t.qty,
      inTransitValue: t.value,

      firstBuy: b.firstBuy,
      lastBuy: b.lastBuy,
      lastSale: s.lastSale,
    });
  }

  // Biggest capital at risk first — the position screen exists to rank exposure
  rows.sort((a, b) => b.posCost - a.posCost);

  const totals: PositionTotals = {
    poValue: rows.reduce((s, r) => s + r.poValue, 0),
    invValue: rows.reduce((s, r) => s + r.invValue, 0),
    posCost: rows.reduce((s, r) => s + r.posCost, 0),
    posValue: rows.reduce((s, r) => s + (r.posValue ?? 0), 0),
    pnl: 0,
    roiPct: null,
    recoveredCount: rows.filter((r) => r.recovered).length,
    recoveredValue: rows.reduce((s, r) => s + r.surplus, 0),
    openCount: rows.filter((r) => r.posQty > 0).length,
    inTransitValue: rows.reduce((s, r) => s + r.inTransitValue, 0),
    unmarked: rows.filter((r) => r.posQty > 0 && r.mark == null).length,
  };
  totals.pnl = totals.posValue - totals.posCost;
  totals.roiPct = totals.poValue > 0 ? (totals.pnl / totals.poValue) * 100 : null;

  return { rows, totals };
}

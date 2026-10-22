/**
 * POs that SAY they arrived but never reached the stock ledger.
 *
 * The PO status is a label; only a goods receipt (Stock › Receive against PO)
 * writes on-hand and landed cost. Marking a PO "Fully Received" in Deal Lookup
 * — or an agent syncing that status — left the two disagreeing, and nothing
 * said so (owner, 2026-10-22: PIO-2026012 was "Fully Received" on 20 Oct with
 * 2,200 panels that ON HAND never showed, while a sales order waited on 16 of
 * them as a shortage).
 *
 * A gap is a received-status PO whose STOCK lines are short of what the ledger
 * has received against it:
 *   - Fully Received: any stock line received below its ordered quantity;
 *   - Partially Received: nothing at all received yet (a part receipt is the
 *     normal state of a partial PO, so only "none" is a contradiction).
 * Lines whose reason is "For a project" are skipped — those goods go to site,
 * not to the warehouse.
 *
 * Only POs received on or after LEDGER_START count: older ones were settled
 * by the opening stock count, and their stock has long been sold.
 *
 * Pure: no fetch, no React.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from './fetchAllRows.ts';

/** The day the stock ledger went live (first receipt movement written, 2026-07-19). */
export const LEDGER_START = '2026-07-19';
export const RECEIVED_STATUSES = new Set(['Fully Received', 'Partially Received']);

export interface GapPo {
  po_id: string | number; po_number?: string | null; status?: string | null;
  po_date?: string | null; actual_received_date?: string | null;
}
export interface GapLine { po_id: string | number; component_id: string | null; quantity: number | string | null; reason?: string | null }
/** A receipt movement: `source_id` is the PO id. */
export interface ReceiptMove { source_id: string | null; component_id: string; quantity: number | string }

export interface ReceiptGap {
  poId: string;
  poNumber: string;
  status: string;
  receivedOn: string | null;
  /** Stock lines short of their ordered quantity. */
  missing: { componentId: string; ordered: number; received: number }[];
  /** Units ordered on stock lines that the ledger has not received. */
  missingQty: number;
}

/** "poId·componentId" → quantity received into stock. */
export function receivedByPoComp(moves: ReceiptMove[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of moves) {
    if (!r.source_id) continue;
    const k = `${r.source_id}·${r.component_id}`;
    m.set(k, (m.get(k) ?? 0) + (Number(r.quantity) || 0));
  }
  return m;
}

export function receiptGaps(pos: GapPo[], lines: GapLine[], moves: ReceiptMove[]): ReceiptGap[] {
  const received = receivedByPoComp(moves);
  const linesByPo = new Map<string, GapLine[]>();
  for (const l of lines) {
    const k = String(l.po_id);
    (linesByPo.get(k) ?? linesByPo.set(k, []).get(k)!).push(l);
  }
  const out: ReceiptGap[] = [];
  for (const po of pos) {
    const status = po.status ?? '';
    if (!RECEIVED_STATUSES.has(status)) continue;
    const on = (po.actual_received_date ?? po.po_date ?? '').slice(0, 10) || null;
    if (!on || on < LEDGER_START) continue;
    const k = String(po.po_id);
    const ordered = new Map<string, number>();
    for (const l of linesByPo.get(k) ?? []) {
      if (!l.component_id || l.reason === 'project') continue;
      const q = Number(l.quantity) || 0;
      if (q > 0) ordered.set(l.component_id, (ordered.get(l.component_id) ?? 0) + q);
    }
    if (!ordered.size) continue;
    const rows = [...ordered].map(([componentId, qty]) => ({ componentId, ordered: qty, received: received.get(`${k}·${componentId}`) ?? 0 }));
    const missing = status === 'Fully Received'
      ? rows.filter((r) => r.received < r.ordered - 1e-9)
      : rows.every((r) => r.received <= 0) ? rows : [];
    if (!missing.length) continue;
    out.push({
      poId: k, poNumber: po.po_number ?? '', status, receivedOn: po.actual_received_date ?? null, missing,
      missingQty: missing.reduce((s, r) => s + Math.max(0, r.ordered - r.received), 0),
    });
  }
  return out.sort((a, b) => (b.receivedOn ?? '').localeCompare(a.receivedOn ?? ''));
}

/** Everything receiptGaps needs, read from the tables (buy-side screens only). */
export async function fetchReceiptGaps(supabase: SupabaseClient): Promise<ReceiptGap[]> {
  type Res<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
  const [pos, lines, moves] = await Promise.all([
    fetchAllRows<GapPo>((f, t) => supabase.from('5.0_purchases')
      .select('po_id, po_number, status, po_date, actual_received_date').order('po_id').range(f, t) as unknown as Res<GapPo>),
    fetchAllRows<GapLine>((f, t) => supabase.from('5.1_purchase_line_items')
      .select('po_id, component_id, quantity, reason').order('po_line_item_id').range(f, t) as unknown as Res<GapLine>),
    fetchAllRows<ReceiptMove>((f, t) => supabase.from('30.0_stock_movements')
      .select('source_id, component_id, quantity').eq('source_type', 'receipt').order('movement_id').range(f, t) as unknown as Res<ReceiptMove>),
  ]);
  return receiptGaps(pos.rows ?? [], lines.rows ?? [], moves.rows ?? []);
}

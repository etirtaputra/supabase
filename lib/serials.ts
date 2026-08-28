/**
 * Serial numbers — the identity of one physical unit, and the walk back from
 * it to the paperwork.
 *
 * The after-sales desk works from a label, not from a sales order: a customer
 * calls holding a machine, reads out the serial, and everything that matters —
 * which order, which invoice, which delivery, which customer, and whether the
 * warranty is still running — has to fall out of that one string. Until the
 * register existed, that walk happened in someone's memory.
 *
 * Two things make the walk work in practice rather than in theory:
 *
 *   • MATCHING IS FORGIVING. The same unit gets typed "SN-1234", "sn 1234" and
 *     "SN1234" by three different people. Everything is compared on the
 *     normalised form (letters and digits only, upper case) while the string as
 *     printed is kept for reading back.
 *   • ENTRY IS BULK. The warehouse is copying a column off a packing list, not
 *     filling one field at a time. Paste is the primary input, and it has to
 *     survive commas, tabs, line breaks, blank lines and the same serial
 *     appearing twice in one paste.
 *
 * Pure and exported for tests; no React, no fetch.
 */
// Relative import keeps this runnable under `node --test` (no @/ alias there)
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows, type PageResult } from './fetchAllRows.ts';

/** How a serial is compared: letters and digits only, upper case. */
export const normSerial = (s: string): string => (s ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/**
 * Where a unit is in its life. The register's job is to answer "is it still
 * ours, and if not, whose order took it" — so the states that matter are on
 * the shelf, spoken for, and gone.
 */
export const SERIAL_STATUS: Record<string, { label: string; cls: string }> = {
  in_stock:  { label: 'In stock',  cls: 'bg-sky-500/15 text-sky-300' },
  allocated: { label: 'Allocated', cls: 'bg-violet-500/15 text-violet-300' },
  delivered: { label: 'Out',       cls: 'bg-emerald-500/15 text-emerald-300' },
  returned:  { label: 'Returned',  cls: 'bg-amber-500/15 text-amber-300' },
  scrapped:  { label: 'Scrapped',  cls: 'bg-slate-700/40 text-slate-400' },
};

/** Has this unit left the warehouse? */
export const isOut = (r: { status: string }): boolean => r.status === 'delivered';

/**
 * The state a unit should carry, given the paperwork on it — the same rule the
 * database applies, so the screen never shows a different answer than the row.
 * A returned or scrapped unit keeps its own state: those are facts about the
 * unit, not about the documents.
 */
export function statusFor(r: { quote_id: string | null; do_id: string | null; status?: string }): string {
  if (r.status === 'returned' || r.status === 'scrapped') return r.status;
  if (r.do_id) return 'delivered';
  if (r.quote_id) return 'allocated';
  return 'in_stock';
}

// ── Row shapes (only the columns the logic reads) ────────────────────────────
export interface SerialRow {
  serial_id: string;
  serial: string;
  serial_norm?: string | null;
  component_id: string | null;
  product_text: string;
  customer_id: string | null;
  quote_id: string | null;
  do_id: string | null;
  invoice_id: string | null;
  status: string;
  is_external: boolean;
  delivered_at: string | null;
  location: string | null;
  notes: string;
  created_at?: string;
  created_by_email?: string;
}
export interface SerialSalesDoc {
  quote_id: string;
  quote_number: string | null;
  order_number: string | null;
  invoice_number: string | null;
  do_number: string | null;
  customer_id: string | null;
  status: string | null;
  ordered_at?: string | null;
  delivered_at?: string | null;
}
export interface SerialDo { do_id: string; do_number: string | null; quote_id: string | null; delivery_date: string | null; delivered_at: string | null; status: string | null }
export interface SerialInvoice { invoice_id: string; invoice_number: string | null; quote_id: string | null; issued_at: string | null }

// ── Bulk entry ───────────────────────────────────────────────────────────────
export interface ParsedBatch {
  /** Unique, in the order first seen — what will actually be written. */
  serials: string[];
  /** Serials the paste itself repeated, with how many times. */
  repeated: { serial: string; times: number }[];
  /** Non-empty tokens the parser refused (nothing normalises to characters). */
  rejected: string[];
}

/**
 * Turn whatever came out of a packing list into a clean list of serials.
 *
 * Split on line breaks, tabs, commas and semicolons — NOT on spaces, because
 * plenty of real serials contain them. A serial repeated inside one paste is a
 * transcription slip, so it is reported rather than silently written twice.
 */
export function parseSerialBatch(text: string): ParsedBatch {
  const seen = new Map<string, { serial: string; times: number }>();
  const rejected: string[] = [];
  for (const raw of (text ?? '').split(/[\n\r\t,;]+/)) {
    const s = raw.trim();
    if (!s) continue;
    const key = normSerial(s);
    if (!key) { rejected.push(s); continue; }
    const hit = seen.get(key);
    if (hit) hit.times += 1;
    else seen.set(key, { serial: s, times: 1 });
  }
  const all = [...seen.values()];
  return {
    serials: all.map((v) => v.serial),
    repeated: all.filter((v) => v.times > 1),
    rejected,
  };
}

/**
 * Which of these serials the register already holds FOR THIS PRODUCT.
 *
 * The same serial on a different product is not a clash — two manufacturers
 * can run the same counter — so the check is per product, exactly like the
 * database's own unique index.
 */
export function findExisting(
  serials: string[], componentId: string | null, register: SerialRow[],
): Map<string, SerialRow> {
  const key = (cid: string | null, norm: string) => `${cid ?? ''}·${norm}`;
  const byKey = new Map<string, SerialRow>();
  for (const r of register) byKey.set(key(r.component_id, r.serial_norm || normSerial(r.serial)), r);
  const out = new Map<string, SerialRow>();
  for (const s of serials) {
    const hit = byKey.get(key(componentId, normSerial(s)));
    if (hit) out.set(s, hit);
  }
  return out;
}

// ── The walk back ────────────────────────────────────────────────────────────
export interface SerialTrace {
  serial: SerialRow;
  /** The sales order the unit was sold on, when it was ours. */
  order: SerialSalesDoc | null;
  delivery: SerialDo | null;
  invoice: SerialInvoice | null;
  customerId: string | null;
  /** The date warranty runs from: the delivery, falling back to the register. */
  deliveredAt: string | null;
  /** Nothing of ours ever carried this unit. */
  external: boolean;
}

/**
 * Everything the desk needs about one unit, assembled from what the register
 * points at.
 *
 * The register's own links lead; where a link is missing, the documents fill
 * each other in — a unit attached only to a delivery still knows its order,
 * because the delivery does. Nothing is invented: a unit we never sold comes
 * back with empty documents and `external`, which is the honest answer and the
 * one that lets a ticket be opened anyway.
 */
export function traceSerial(
  row: SerialRow,
  orders: SerialSalesDoc[],
  dos: SerialDo[],
  invoices: SerialInvoice[],
): SerialTrace {
  const doById = new Map(dos.map((d) => [String(d.do_id), d]));
  const invById = new Map(invoices.map((i) => [String(i.invoice_id), i]));
  const orderById = new Map(orders.map((o) => [String(o.quote_id), o]));

  const delivery = row.do_id ? doById.get(String(row.do_id)) ?? null : null;
  const invoice = row.invoice_id ? invById.get(String(row.invoice_id)) ?? null : null;
  // The order named on the unit, else the one its delivery or invoice belongs to
  const quoteId = row.quote_id ?? delivery?.quote_id ?? invoice?.quote_id ?? null;
  const order = quoteId ? orderById.get(String(quoteId)) ?? null : null;

  return {
    serial: row,
    order,
    delivery,
    invoice,
    customerId: row.customer_id ?? order?.customer_id ?? null,
    deliveredAt: row.delivered_at ?? delivery?.delivered_at ?? delivery?.delivery_date ?? order?.delivered_at ?? null,
    external: row.is_external || (!order && !delivery && !invoice),
  };
}

/**
 * Look a typed serial up across the register.
 *
 * Returns every match, because the same string CAN belong to two products —
 * and when it does, the desk must choose rather than be handed a guess.
 */
export function lookupSerial(typed: string, register: SerialRow[]): SerialRow[] {
  const norm = normSerial(typed);
  if (!norm) return [];
  return register.filter((r) => (r.serial_norm || normSerial(r.serial)) === norm);
}

/**
 * Serials on a document, in the order they were entered — what the warehouse
 * sees when it opens a delivery it already worked on.
 */
export function serialsForDoc(
  register: SerialRow[], key: 'quote_id' | 'do_id' | 'invoice_id', id: string,
): SerialRow[] {
  return register
    .filter((r) => String(r[key] ?? '') === String(id))
    .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
}

// ── Fetch wrappers ───────────────────────────────────────────────────────────
const SERIAL_COLS = 'serial_id, serial, serial_norm, component_id, product_text, customer_id, quote_id, do_id, invoice_id, status, is_external, delivered_at, location, notes, created_at, created_by_email';

/** Page past PostgREST's 1,000-row ceiling — a register only ever grows. */
export async function fetchSerials(supabase: SupabaseClient): Promise<SerialRow[]> {
  const { rows } = await fetchAllRows<SerialRow>((from, to) =>
    supabase.from('30.4_serial_numbers').select(SERIAL_COLS)
      .order('created_at', { ascending: false })
      .range(from, to) as unknown as PromiseLike<PageResult<SerialRow>>);
  return rows;
}

/** One serial, matched the forgiving way. Empty when the register has never seen it. */
export async function lookupSerialRemote(supabase: SupabaseClient, typed: string): Promise<SerialRow[]> {
  const norm = normSerial(typed);
  if (!norm) return [];
  const { data } = await supabase.from('30.4_serial_numbers').select(SERIAL_COLS).eq('serial_norm', norm);
  return (data ?? []) as unknown as SerialRow[];
}

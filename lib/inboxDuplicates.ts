/**
 * Is this supplier document already in ICAPROC? — the ONE duplicate check
 * (owner, 2026-11-22: "how will the Inbox and MIRA check for duplicates? This
 * is important"). Used when a document is read (lib/inboxMatch, the snapshot
 * an agent gets back), on the Inbox screen every time it opens (live — a deal
 * typed by hand in the meantime still shows), and by MIRA's
 * GET /api/agent/inbox?doc=… before she creates a deal herself. Pure, no I/O.
 *
 * Four answers, strongest first:
 *   same      — same supplier + same document number (PI, quote or PO number,
 *               case/space/dash/slash aside) as a deal, totals agree or unknown.
 *   revision  — same number, but the totals differ: a REVISED PI. Change that
 *               deal (Deal Lookup), do not create a second one.
 *   inbox     — same number as another document still waiting in the Inbox
 *               (a PDF and a photo of one PI, a re-scan, two people).
 *   lookalike — NO number was read: same supplier, same currency, total
 *               within 0.5 %, within 120 days — "possibly" the same.
 * The same FILE twice never gets this far: POST /api/inbox refuses it by its
 * sha256 (unique in the table).
 */
import { docNumberKey } from './docMatch.ts';

/** What the duplicate check (lib/inboxDuplicates) reads — the same columns on the server and the screen. */
export const DEAL_QUOTE_COLS = 'quote_id, pi_number, supplier_id, total_value, currency, quote_date';
export const DEAL_PO_COLS = 'po_id, po_number, pi_number, quote_id, supplier_id, total_value, currency, pi_date, po_date';
export const INBOX_DUP_COLS = 'item_id, file_name, received_at, status, proposal, extracted';

export interface DupDeal {
  quote_id: string | null; po_id: string | null;
  label: string; supplier_id: string | null;
  numbers: (string | null)[];
  total: number | null; currency: string | null; date: string | null;
}
export interface DupInboxItem {
  item_id: string; file_name: string; received_at: string; status: string;
  supplier_id: string | null; numbers: (string | null)[];
  total: number | null; currency: string | null; date: string | null;
}
export interface DupDoc {
  item_id?: string | null;
  supplier_id: string | null; numbers: (string | null)[];
  total: number | null; currency: string | null; date: string | null;
}
export type DupKind = 'same' | 'revision' | 'inbox' | 'lookalike';
export interface DupHit {
  kind: DupKind; where: 'deal' | 'inbox'; label: string;
  quote_id?: string | null; po_id?: string | null; item_id?: string | null;
  ours?: number | null; theirs?: number | null; date?: string | null;
}

/** A deal per PO, plus every quote that has no PO — how Deal Lookup counts them. */
export function dealsFrom(
  quotes: { quote_id: string; pi_number: string | null; supplier_id: string | null; total_value?: number | string | null; currency?: string | null; quote_date?: string | null }[],
  pos: { po_id: string; po_number: string | null; pi_number: string | null; quote_id?: string | null; supplier_id: string | null; total_value?: number | string | null; currency?: string | null; pi_date?: string | null; po_date?: string | null }[],
): DupDeal[] {
  const withPo = new Set(pos.map((p) => p.quote_id).filter(Boolean).map(String));
  const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  return [
    ...pos.map((p) => ({
      quote_id: p.quote_id ? String(p.quote_id) : null, po_id: String(p.po_id),
      label: p.po_number || p.pi_number || '', supplier_id: p.supplier_id ? String(p.supplier_id) : null,
      numbers: [p.pi_number, p.po_number], total: num(p.total_value), currency: p.currency ?? null,
      date: p.pi_date || p.po_date || null,
    })),
    ...quotes.filter((q) => !withPo.has(String(q.quote_id))).map((q) => ({
      quote_id: String(q.quote_id), po_id: null,
      label: q.pi_number || '', supplier_id: q.supplier_id ? String(q.supplier_id) : null,
      numbers: [q.pi_number], total: num(q.total_value), currency: q.currency ?? null, date: q.quote_date ?? null,
    })),
  ];
}

const keysOf = (ns: (string | null)[]) => [...new Set(ns.map(docNumberKey).filter(Boolean))];
const sameMoney = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005);
const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

export function findDuplicates(doc: DupDoc, deals: DupDeal[], inbox: DupInboxItem[] = []): DupHit[] {
  const keys = keysOf(doc.numbers);
  // Unknown supplier on either side: the number alone decides.
  const sameSup = (s: string | null) => !doc.supplier_id || !s || s === doc.supplier_id;
  const shares = (ns: (string | null)[]) => keysOf(ns).some((k) => keys.includes(k));
  const hits: DupHit[] = [];

  if (keys.length) {
    for (const d of deals) {
      if (!sameSup(d.supplier_id) || !shares(d.numbers)) continue;
      const comparable = doc.total != null && d.total != null && (!doc.currency || !d.currency || doc.currency === d.currency);
      const differs = comparable && !sameMoney(doc.total as number, d.total as number);
      hits.push({ kind: differs ? 'revision' : 'same', where: 'deal', label: d.label, quote_id: d.quote_id, po_id: d.po_id, ours: doc.total, theirs: d.total, date: d.date });
    }
    for (const i of inbox) {
      if (i.item_id === doc.item_id || i.status === 'dismissed' || i.status === 'done') continue;
      if (!sameSup(i.supplier_id) || !shares(i.numbers)) continue;
      hits.push({ kind: 'inbox', where: 'inbox', label: i.file_name, item_id: i.item_id, date: i.received_at });
    }
    return hits;
  }

  // No number read: the weaker check, supplier + currency + total (+ date when both have one).
  if (doc.total == null || !doc.supplier_id) return hits;
  const near = (x: { supplier_id: string | null; total: number | null; currency: string | null; date: string | null }) =>
    x.supplier_id === doc.supplier_id && x.total != null && sameMoney(doc.total as number, x.total)
    && (!doc.currency || !x.currency || doc.currency === x.currency)
    && (!doc.date || !x.date || days(doc.date, x.date) <= 120);
  for (const d of deals) if (near(d)) hits.push({ kind: 'lookalike', where: 'deal', label: d.label, quote_id: d.quote_id, po_id: d.po_id, ours: doc.total, theirs: d.total, date: d.date });
  for (const i of inbox) {
    if (i.item_id === doc.item_id || i.status === 'dismissed' || i.status === 'done') continue;
    if (near(i)) hits.push({ kind: 'lookalike', where: 'inbox', label: i.file_name, item_id: i.item_id, date: i.received_at });
  }
  return hits;
}

/** The phrase (phrase book, tf) and its values for one hit. */
export function dupMessage(h: DupHit): { text: string; vars: Record<string, string | number> } {
  const money = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US'));
  if (h.kind === 'same') return { text: 'Already in ICAPROC: {label}. Check before creating it again.', vars: { label: h.label } };
  if (h.kind === 'revision') return { text: 'Same number as {label}, but the total differs ({ours} vs {theirs}): a revised PI? Change that deal in Deal Lookup instead of creating a new one.', vars: { label: h.label, ours: money(h.ours), theirs: money(h.theirs) } };
  if (h.kind === 'inbox') return { text: 'The same document is also in the Inbox: {label}. Keep one, dismiss the other.', vars: { label: h.label } };
  return h.where === 'deal'
    ? { text: 'Possibly already in ICAPROC: {label}. Same supplier, currency and total; no document number was read.', vars: { label: h.label } }
    : { text: 'Possibly the same document as {label} in the Inbox. Same supplier, currency and total.', vars: { label: h.label } };
}

/** The duplicate phrases — a screen showing the LIVE check drops these from a stored proposal's notes. */
export const DUP_TEXTS: readonly string[] = (['same', 'revision', 'inbox'] as DupKind[])
  .map((kind) => dupMessage({ kind, where: kind === 'inbox' ? 'inbox' : 'deal', label: '' }).text)
  .concat([dupMessage({ kind: 'lookalike', where: 'deal', label: '' }).text, dupMessage({ kind: 'lookalike', where: 'inbox', label: '' }).text]);

/** An Inbox row as the duplicate check sees it (from its stored proposal). */
export function inboxDupView(row: {
  item_id: string; file_name: string; received_at: string; status: string;
  proposal: { supplier: { id: string | null }; docNumber: string | null; total: number | null; itemsSum: number; currency: string | null; docDate: string | null } | null;
  extracted?: { pi_number?: string | null; quote_number?: string | null; po_number?: string | null } | null;
}): DupInboxItem {
  const p = row.proposal;
  const e = row.extracted ?? {};
  return {
    item_id: row.item_id, file_name: row.file_name, received_at: row.received_at, status: row.status,
    supplier_id: p?.supplier.id ?? null,
    numbers: [p?.docNumber ?? null, e.pi_number ?? null, e.quote_number ?? null, e.po_number ?? null],
    total: p ? (p.total ?? (p.itemsSum || null)) : null, currency: p?.currency ?? null, date: p?.docDate ?? null,
  };
}

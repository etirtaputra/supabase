/**
 * Sales Orders — "Needs action": what to do next on the sell side (owner,
 * 2026-10-23, with the Sales menu cut to four entries). The twin of
 * lib/purchasingInbox.ts on Deal Lookup.
 *
 * Four questions, walking order-to-cash in order:
 *   - quotes waiting for an answer ... offered, no order yet, a week on or expired
 *   - orders not delivered ........... confirmed, goods not fully out
 *   - delivered, not invoiced ........ money earned and not billed yet
 *   - invoices unpaid ................ billed and not collected (overdue first)
 *
 * Pure: no fetch, no React. Amounts are VAT-inclusive, the way invoices and
 * receipts are written.
 */
import { COMMITTED_STATUSES } from './salesStatus.ts';

const DAY = 86_400_000;
const at = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
const daysBetween = (from: string, to: string) => Math.round((at(to) - at(from)) / DAY);
/** Rupiah cents and rounding on split invoices: anything under this is settled. */
const TOLERANCE = 0.5;

/** A quote on the table this long without an order is worth a nudge. */
export const QUOTE_NUDGE_DAYS = 7;

export interface InboxQuote {
  quote_id: string;
  status: string;
  grand_total: number | string | null;
  quote_date?: string | null;
  valid_until?: string | null;
  validated_at?: string | null;
  sent_at?: string | null;
  accepted_at?: string | null;
  ordered_at?: string | null;
  delivery_date?: string | null;
  updated_at?: string | null;
}
export interface InboxDo { quote_id: string; status: string }
export interface InboxInvoice {
  invoice_id: string;
  quote_id: string;
  invoice_number: string;
  grand_total: number | string | null;
  issued_at?: string | null;
  due_date?: string | null;
}
export interface InboxReceipt { quote_id: string; invoice_id?: string | null; amount: number | string | null }

const num = (v: number | string | null | undefined) => Number(v) || 0;
const OFFERED = new Set(['validated', 'sent', 'accepted']);

export interface WaitingQuote {
  quoteId: string;
  status: string;
  /** When it last moved: accepted, else sent, else validated, else its date. */
  since: string;
  days: number;
  expired: boolean;
  total: number;
}

/**
 * Quotes offered and not yet an order, a week or more after their last step —
 * or past their own valid-until date, whichever comes first. Oldest first.
 */
export function waitingQuotes(quotes: InboxQuote[], today: string): WaitingQuote[] {
  const out: WaitingQuote[] = [];
  for (const q of quotes) {
    if (!OFFERED.has(q.status)) continue;
    const since = (q.accepted_at ?? q.sent_at ?? q.validated_at ?? q.quote_date ?? q.updated_at ?? '').slice(0, 10);
    if (!since) continue;
    const days = daysBetween(since, today);
    const expired = !!q.valid_until && q.valid_until < today;
    if (days < QUOTE_NUDGE_DAYS && !expired) continue;
    out.push({ quoteId: q.quote_id, status: q.status, since, days, expired, total: num(q.grand_total) });
  }
  return out.sort((a, b) => b.days - a.days);
}

export interface OpenOrder {
  quoteId: string;
  since: string;
  days: number;
  /** Some goods are already out (a delivered DO), not all. */
  partly: boolean;
  /** The promised delivery date, when it has passed. */
  lateSince: string | null;
  total: number;
}

/** Confirmed orders whose goods are not all out yet. Oldest first. */
export function undeliveredOrders(quotes: InboxQuote[], dos: InboxDo[], today: string): OpenOrder[] {
  const deliveredDo = new Set(dos.filter((d) => d.status === 'delivered').map((d) => d.quote_id));
  const out: OpenOrder[] = [];
  for (const q of quotes) {
    if (!COMMITTED_STATUSES.has(q.status)) continue;
    const since = (q.ordered_at ?? q.quote_date ?? q.updated_at ?? today).slice(0, 10);
    out.push({
      quoteId: q.quote_id, since, days: Math.max(0, daysBetween(since, today)),
      partly: deliveredDo.has(q.quote_id),
      lateSince: q.delivery_date && q.delivery_date < today ? q.delivery_date : null,
      total: num(q.grand_total),
    });
  }
  return out.sort((a, b) => b.days - a.days);
}

export interface Unbilled { quoteId: string; total: number; invoiced: number; remaining: number }

/**
 * Goods out (the order is delivered, or a DO on it is) and the invoices on it
 * add up to less than the order — the gap is money earned and not billed.
 */
export function deliveredNotInvoiced(quotes: InboxQuote[], dos: InboxDo[], invoices: InboxInvoice[]): Unbilled[] {
  const deliveredDo = new Set(dos.filter((d) => d.status === 'delivered').map((d) => d.quote_id));
  const billed = new Map<string, number>();
  for (const i of invoices) billed.set(i.quote_id, (billed.get(i.quote_id) ?? 0) + num(i.grand_total));
  const out: Unbilled[] = [];
  for (const q of quotes) {
    const goodsOut = q.status === 'delivered' || (COMMITTED_STATUSES.has(q.status) && deliveredDo.has(q.quote_id));
    if (!goodsOut) continue;
    const total = num(q.grand_total);
    const invoiced = billed.get(q.quote_id) ?? 0;
    const remaining = total - invoiced;
    if (total <= 0 || remaining <= TOLERANCE) continue;
    out.push({ quoteId: q.quote_id, total, invoiced, remaining });
  }
  return out.sort((a, b) => b.remaining - a.remaining);
}

export interface UnpaidInvoice {
  invoiceId: string;
  quoteId: string;
  number: string;
  total: number;
  remaining: number;
  due: string | null;
  /** Days past the due date; null when it has no due date or is not due yet. */
  overdueDays: number | null;
}

/**
 * Invoices with money still to collect. A receipt names its invoice; an older
 * receipt that only names the order is spread over that order's invoices,
 * oldest first — the same way a customer pays down what they owe. Cancelled
 * and rejected orders are not chased. Overdue first, then the biggest.
 */
export function unpaidInvoices(quotes: InboxQuote[], invoices: InboxInvoice[], receipts: InboxReceipt[], today: string): UnpaidInvoice[] {
  const dead = new Set(quotes.filter((q) => q.status === 'cancelled' || q.status === 'rejected').map((q) => q.quote_id));
  const paid = new Map<string, number>();
  const loose = new Map<string, number>();
  for (const r of receipts) {
    if (r.invoice_id) paid.set(r.invoice_id, (paid.get(r.invoice_id) ?? 0) + num(r.amount));
    else loose.set(r.quote_id, (loose.get(r.quote_id) ?? 0) + num(r.amount));
  }
  const byOrder = new Map<string, InboxInvoice[]>();
  for (const i of invoices) (byOrder.get(i.quote_id) ?? byOrder.set(i.quote_id, []).get(i.quote_id)!).push(i);

  const out: UnpaidInvoice[] = [];
  for (const [quoteId, list] of byOrder) {
    if (dead.has(quoteId)) continue;
    let spare = loose.get(quoteId) ?? 0;
    const ordered = [...list].sort((a, b) => (a.issued_at ?? '').localeCompare(b.issued_at ?? ''));
    for (const i of ordered) {
      const total = num(i.grand_total);
      let owed = total - (paid.get(i.invoice_id) ?? 0);
      if (owed <= TOLERANCE) continue;           // settled — a rounding crumb takes no loose money
      const take = Math.min(owed, spare);
      owed -= take;
      spare -= take;
      if (owed <= TOLERANCE) continue;
      const due = i.due_date ?? null;
      out.push({
        invoiceId: i.invoice_id, quoteId, number: i.invoice_number, total, remaining: owed, due,
        overdueDays: due && due < today ? daysBetween(due, today) : null,
      });
    }
  }
  return out.sort((a, b) => (b.overdueDays ?? -1) - (a.overdueDays ?? -1) || b.remaining - a.remaining);
}

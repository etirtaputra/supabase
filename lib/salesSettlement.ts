/**
 * Is it paid? Is it delivered? — the two DERIVED states of a sales order,
 * decided in one place (2026-11-11).
 *
 * Neither is stored. Payment is receipts against the total; delivery is the
 * order's delivery orders. Until now the half-rupiah rule was typed out nine
 * times in five files (sales list ×4, sales editor ×3, print, invoices,
 * customers ×2) and the screens named the answer differently — 'paid' here,
 * 'Paid' there, a 3-word vocabulary on Customers and a 5-word one on Sales.
 * The arithmetic below is exactly what each of them did; only the copies went.
 *
 * Declared in lib/lifecycles.ts as `sales_payment` and `sales_delivery`, so
 * agents are served the same states and rule (/api/agent/onboarding).
 */
import { inGroup } from './lifecycles.ts';

/**
 * Bank amounts land a few sen light on rounding; an order one rupiah short of
 * its total is paid. The same tolerance everywhere, or two screens disagree
 * about whether a customer still owes.
 */
export const PAID_TOLERANCE_IDR = 0.5;

/** Has `received` covered `total`? A zero total is never "paid" — there is nothing to pay. */
export const isSettled = (total: number, received: number): boolean =>
  total > 0 && received >= total - PAID_TOLERANCE_IDR;

/** Is this amount still owed (more than rounding)? */
export const isOwed = (amount: number): boolean => amount > PAID_TOLERANCE_IDR;

export type Settlement = 'unpaid' | 'partial' | 'paid';

/** One invoice, or one order's total, against what was received for it. */
export function settlement(total: number, received: number): Settlement {
  if (isSettled(total, received)) return 'paid';
  return received > 0 ? 'partial' : 'unpaid';
}

export type OrderPayState = 'none' | Settlement | 'outstanding';

/**
 * The Payment state of a sales document:
 *   none        — not an order yet (or nothing to bill)
 *   unpaid / partial / paid
 *   outstanding — DELIVERED and still not fully paid: the receivable to chase
 */
export function orderPayState(doc: { status: string | null | undefined; total: number; received: number }): OrderPayState {
  if (!inGroup('sales_document', 'order', doc.status) || doc.total <= 0) return 'none';
  if (doc.received >= doc.total - PAID_TOLERANCE_IDR) return 'paid';
  if (doc.status === 'delivered') return 'outstanding';
  return doc.received > 0 ? 'partial' : 'unpaid';
}

export type OrderDeliveryState = 'none' | 'preparing' | 'partial' | 'delivered';

/** The Delivery state of a sales document, from its own status and its delivery orders'. */
export function orderDeliveryState(status: string | null | undefined, doStatuses: (string | null | undefined)[]): OrderDeliveryState {
  if (status === 'delivered') return 'delivered';
  if (doStatuses.some((s) => s === 'delivered')) return 'partial';
  return doStatuses.length > 0 ? 'preparing' : 'none';
}

/** The word the invoice chips show — 'Paid' | 'Partial' | 'Unpaid', as before. */
export const SETTLEMENT_WORD: Record<Settlement, 'Paid' | 'Partial' | 'Unpaid'> = {
  paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid',
};

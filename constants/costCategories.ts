/**
 * Shared cost-category sets used across PO payment logic.
 * Single source of truth — import from here instead of redefining locally.
 */

/**
 * Principal: what this supplier is paid on this order. `overpayment_credit` is
 * a NEGATIVE principal row — money coming back on the order (e.g. the PI was
 * reduced after the balance went out: PIO-013-ISL-10-2025_R1 paid IDR 226.1M,
 * then −42.9M credit). It counts everywhere, signed, so the order's net paid
 * is one number on every screen (owner's call, 2026-11-16 — until then Deal
 * Lookup, the deal list and the FX comparison skipped it while AP, the
 * dashboard and in-transit counted it). A refund that is not the supplier's —
 * a staff cash advance coming back — is NOT an overpayment credit; it reduces
 * the cost it came from (local_delivery etc.).
 */
export const PRINCIPAL_CATS = new Set([
  'down_payment',
  'balance_payment',
  'additional_balance_payment',
  'overpayment_credit',
]);

/** Balance-only payments (subset of PRINCIPAL_CATS, excludes down payment) */
export const BALANCE_CATS = new Set([
  'balance_payment',
  'additional_balance_payment',
]);

/** Bank transfer fees */
export const BANK_FEE_CATS = new Set([
  'full_amount_bank_fee',
  'telex_bank_fee',
  'value_today_bank_fee',
  'admin_bank_fee',
  'inter_bank_transfer_fee',
]);

/** Local taxes (excluded from landed cost TUC allocation) */
export const TAX_CATS = new Set([
  'local_vat',
  'local_income_tax',
]);

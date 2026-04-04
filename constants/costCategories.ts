/**
 * Shared cost-category sets used across PO payment logic.
 * Single source of truth — import from here instead of redefining locally.
 */

/** Principal payments (down payment, balance, etc.) */
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

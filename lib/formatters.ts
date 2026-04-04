/**
 * Shared number/currency formatting helpers.
 * Single source of truth — import from here instead of redefining locally.
 */

/** Format a number as Indonesian Rupiah: "IDR 1,234,567" */
export const fmtIdr = (n: number): string =>
  'IDR ' + Math.round(n).toLocaleString('en-US');

/**
 * Format a number with fixed decimal places (default 2).
 * Example: fmtNum(1234.5) → "1,234.50"
 */
export const fmtNum = (n: number, dp = 2): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

/**
 * Format a currency amount with its code.
 * Example: fmtCcy(1500.5, 'USD') → "USD 1,500.5"
 */
export const fmtCcy = (n: number, ccy: string): string =>
  `${ccy} ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

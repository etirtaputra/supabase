/**
 * Shared number/currency formatting helpers.
 * Single source of truth — import from here instead of redefining locally.
 */

/** Format a number as Indonesian Rupiah: "IDR 1,234,567" */
export const fmtIdr = (n: number): string =>
  'IDR ' + Math.round(n).toLocaleString('en-US');

/** Quotes-app Rupiah style: "Rp1,234,567" (matches the quote editor/PDF) */
export const fmtRp = (n: number): string =>
  'Rp' + Math.round(n).toLocaleString('en-US');

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

/**
 * Format an ISO date string compactly: "5 Mar '26"
 * Returns '—' for empty/null input.
 */
export const fmtDate = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }).replace(/ /g, '\u00A0');
};

// ── Canonical app-screen helpers ────────────────────────────────────────────
// These match the style the pages already render, so importing them changes no
// output — they exist to stop the same helper being redefined in every file.
//
// LOCALE RULE (decided 2026-07-25):
//   • Internal screens use en-US grouping — "1,234,567" — because the whole
//     team reads these tables all day and they were built that way.
//   • CUSTOMER-FACING output (the WhatsApp price copy, printed documents) uses
//     Indonesian formatting — "1.234.567" — via toLocaleString('id-ID').
//   • Dates on internal screens are en-GB "24 Jul 26": day-first like Indonesian
//     convention, unambiguous, and short enough for dense tables.
// Add new formats HERE rather than locally, or the drift starts again.

/** Whole number with thousands separators: "1,234,567" */
export const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US');

/** Rupiah for app screens, spaced: "Rp 1,234,567" */
export const fmtRupiah = (n: number): string => `Rp ${fmtInt(n)}`;

/** Compact rupiah for KPI tiles and dense cells: "Rp 2.2B" / "Rp 12.4M" */
export const fmtRupiahShort = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1e9) return `Rp ${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `Rp ${(n / 1e6).toFixed(1)}M`;
  return fmtRupiah(n);
};

/**
 * Date for app screens: "24 Jul 26". Timezone-safe — a date-only string
 * ("2026-07-24") is pinned to local midnight so it can never render as the
 * previous day.
 */
export const fmtDay = (d?: string | null): string => {
  if (!d) return '';
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
};

/** Date + time, for "last edited"-style stamps: "24 Jul 26, 14:32" */
export const fmtDayTime = (d?: string | null): string => {
  if (!d) return '';
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
    + ', ' + dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

/** Customer-facing Indonesian amount: "1.234.567" (no currency prefix). */
export const fmtIdLocale = (n: number): string => Math.round(n).toLocaleString('id-ID');

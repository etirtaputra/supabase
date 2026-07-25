/**
 * Shared number / currency / date formatting.
 * Single source of truth — import from here instead of redefining locally.
 *
 * These are no longer static: every helper reads the live values from
 * `lib/settings.ts` (backed by `40.0_settings`, edited at /settings), while the
 * DEFAULTS reproduce exactly what the app printed before Settings existed — an
 * unconfigured install formats identically.
 *
 * LOCALE RULE (unchanged, now configurable rather than hard-coded):
 *   • INTERNAL screens use the *internal* profile — en-US grouping
 *     ("1,234,567") because the team reads these tables all day, en-GB dates
 *     ("24 Jul 26": day-first, unambiguous, short enough for dense tables).
 *   • CUSTOMER-FACING output (printed quote / invoice / Surat Jalan / EPC
 *     proposal, the WhatsApp price copy) uses the *document* profile —
 *     Indonesian long dates ("24 Juli 2026") and its own number punctuation.
 * The two profiles are configured separately on purpose. Do not collapse them.
 *
 * Helpers ending in `Doc` are the customer-facing ones; everything else is
 * internal. Add new formats HERE rather than locally, or the drift starts again.
 */
import { getSettings, type NumberFormat, type CurrencyFormat, type DateStyle, type DateLocale } from './settings';

// ── Primitives ──────────────────────────────────────────────────────────────

/**
 * Group and punctuate a number. Grouping/rounding is delegated to Intl with a
 * fixed en-US locale and the separators are then swapped for the configured
 * ones, so the digits are always grouped the way Intl would and only the
 * punctuation is ours.
 */
export function formatNumber(n: number, f: NumberFormat, min = f.decimals, max = min): string {
  if (!Number.isFinite(n)) return '';
  const base = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: Math.max(0, Math.min(20, min)),
    maximumFractionDigits: Math.max(0, Math.min(20, Math.max(min, max))),
  }).format(n);
  // en-US → ',' groups, '.' decimal. Park the groups first so a '.' thousands
  // separator can't be re-read as the decimal point.
  return base.replace(/,/g, '\u0001').replace(/\./g, f.decimal).replace(/\u0001/g, f.thousands);
}

/** Wrap a formatted amount in its currency symbol per the profile. */
export function applyCurrency(amount: string, c: CurrencyFormat): string {
  const gap = c.space ? ' ' : '';
  return c.position === 'after' ? `${amount}${gap}${c.symbol}` : `${c.symbol}${gap}${amount}`;
}

const MONTH_CACHE = new Map<string, string>();
const monthName = (dt: Date, locale: DateLocale, long: boolean): string => {
  const key = `${locale}|${long}|${dt.getMonth()}`;
  const hit = MONTH_CACHE.get(key);
  if (hit) return hit;
  const v = dt.toLocaleDateString(locale, { month: long ? 'long' : 'short' });
  MONTH_CACHE.set(key, v);
  return v;
};

/**
 * Parse a date-only string safely. "2026-07-24" is pinned to LOCAL midnight so
 * it can never render as the previous day; full timestamps pass through.
 */
export const parseDate = (d?: string | null): Date | null => {
  if (!d) return null;
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  return isNaN(dt.getTime()) ? null : dt;
};

/** Render a date in one of the configured styles. `padDay` zero-pads the day. */
export function formatDate(d: string | null | undefined | Date, style: DateStyle, locale: DateLocale, padDay = true): string {
  const dt = d instanceof Date ? d : parseDate(d);
  if (!dt) return '';
  const day = dt.getDate();
  const dd = padDay ? String(day).padStart(2, '0') : String(day);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = String(dt.getFullYear());
  const yy = yyyy.slice(-2);
  switch (style) {
    case 'dd MMM yyyy':  return `${dd} ${monthName(dt, locale, false)} ${yyyy}`;
    case 'dd MMMM yyyy': return `${dd} ${monthName(dt, locale, true)} ${yyyy}`;
    case 'dd/MM/yyyy':   return `${dd}/${mm}/${yyyy}`;
    case 'MM/dd/yyyy':   return `${mm}/${dd}/${yyyy}`;
    case 'yyyy-MM-dd':   return `${yyyy}-${mm}-${String(day).padStart(2, '0')}`;
    case 'dd MMM yy':
    default:             return `${dd} ${monthName(dt, locale, false)} ${yy}`;
  }
}

// ── Internal screens ────────────────────────────────────────────────────────

/** Whole number with thousands separators: "1,234,567" */
export const fmtInt = (n: number): string => formatNumber(Math.round(n), getSettings().numberInternal, 0);

/**
 * Format a number with fixed decimal places (default 2): "1,234.50"
 */
export const fmtNum = (n: number, dp = 2): string => formatNumber(n, getSettings().numberInternal, dp);

/**
 * Amount spelled with the currency CODE: "IDR 1,234,567".
 * Buy-side screens grew this style while sell-side screens use the symbol;
 * Settings › "Use the currency symbol everywhere" collapses the two.
 */
export const fmtIdr = (n: number): string => {
  const s = getSettings();
  const amount = formatNumber(Math.round(n), s.numberInternal, 0);
  return s.useSymbolEverywhere ? applyCurrency(amount, s.currencyInternal) : `${s.currencyCode} ${amount}`;
};

/** Rupiah for app screens: "Rp 1,234,567" (symbol, position and spacing configurable). */
export const fmtRupiah = (n: number): string =>
  applyCurrency(formatNumber(Math.round(n), getSettings().numberInternal, 0), getSettings().currencyInternal);

/**
 * Alias kept for the EPC screens that imported it. Same internal currency
 * style as `fmtRupiah` — the old hard-coded "Rp1,234,567" (no space) now
 * follows the configured spacing like everything else.
 */
export const fmtRp = (n: number): string => fmtRupiah(n);

/**
 * Compact figure for KPI tiles: "2.20B" / "12.4M" / "1,234". Negative or small
 * values fall through to the full number.
 */
export const fmtCompact = (n: number): string => {
  const s = getSettings();
  if (n >= 1e9) return formatNumber(n / 1e9, s.numberInternal, 2) + 'B';
  if (n >= 1e6) return formatNumber(n / 1e6, s.numberInternal, 1) + 'M';
  return fmtInt(n);
};

/** Compact amount carrying the currency code: "IDR 2.20B". */
export const fmtIdrShort = (n: number): string => {
  const s = getSettings();
  return s.useSymbolEverywhere ? applyCurrency(fmtCompact(n), s.currencyInternal) : `${s.currencyCode} ${fmtCompact(n)}`;
};

/** Compact rupiah for KPI tiles and dense cells: "Rp 2.2B" / "Rp 12.4M" */
export const fmtRupiahShort = (n: number): string => {
  const s = getSettings();
  const a = Math.abs(n);
  const unit = a >= 1e9 ? { div: 1e9, suffix: 'B' } : a >= 1e6 ? { div: 1e6, suffix: 'M' } : null;
  if (!unit) return fmtRupiah(n);
  return applyCurrency(formatNumber(n / unit.div, s.numberInternal, 1) + unit.suffix, s.currencyInternal);
};

/**
 * Format a currency amount with its code: fmtCcy(1500.5, 'USD') → "USD 1,500.5"
 * (up to 2 decimals, trailing zeros trimmed).
 */
export const fmtCcy = (n: number, ccy: string): string =>
  `${ccy} ${formatNumber(Number(n), getSettings().numberInternal, 0, 2)}`;

/** Date for app screens: "24 Jul 26". */
export const fmtDay = (d?: string | null): string => {
  const s = getSettings();
  return formatDate(d, s.dateInternal, s.dateLocaleInternal);
};

/**
 * Compact date with a non-breaking space so it never wraps mid-date, and an
 * unpadded day ("5 Mar 26"). Returns '—' for empty input.
 */
export const fmtDate = (iso?: string | null): string => {
  if (!iso) return '—';
  const s = getSettings();
  return formatDate(iso, s.dateInternal, s.dateLocaleInternal, false).replace(/ /g, '\u00A0');
};

/** Date + time, for "last edited"-style stamps: "24 Jul 26, 14:32" */
export const fmtDayTime = (d?: string | null): string => {
  const s = getSettings();
  const dt = parseDate(d);
  if (!dt) return '';
  return formatDate(dt, s.dateInternal, s.dateLocaleInternal)
    + ', ' + dt.toLocaleTimeString(s.time24h ? 'en-GB' : 'en-US', { hour: '2-digit', minute: '2-digit', hour12: !s.time24h });
};

// ── Customer-facing documents ───────────────────────────────────────────────

/** Document amount, no currency, per the document punctuation profile. */
export const fmtNumDoc = (n: number, dp = 0): string => formatNumber(n, getSettings().numberDocument, dp);

/** Whole document amount: "1,234,567" */
export const fmtIntDoc = (n: number): string => formatNumber(Math.round(n), getSettings().numberDocument, 0);

/** Rupiah on a printed document: "Rp1,234,567" (symbol/position/spacing configurable). */
export const fmtRupiahDoc = (n: number): string =>
  applyCurrency(formatNumber(Math.round(n), getSettings().numberDocument, 0), getSettings().currencyDocument);

/**
 * Document rupiah keeping up to two decimals ("Rp1,234.56") — per-kWh figures
 * and other rates where whole rupiah would round the number away.
 */
export const fmtRupiahDoc2 = (n: number): string =>
  applyCurrency(formatNumber(n, getSettings().numberDocument, 0, 2), getSettings().currencyDocument);

/** Date on a printed document: "24 Juli 2026". */
export const fmtDayDoc = (d?: string | null): string => {
  const s = getSettings();
  return formatDate(d, s.dateDocument, s.dateLocaleDocument);
};

/**
 * Customer-facing amount without a currency prefix — the WhatsApp price copy.
 * Follows the document number profile.
 */
export const fmtIdLocale = (n: number): string => fmtIntDoc(n);

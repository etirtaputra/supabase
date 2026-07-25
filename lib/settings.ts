/**
 * ICAPROC — application settings (`40.0_settings`).
 *
 * The one place values that used to be hard-coded per page are defined, so a
 * change lands everywhere at once. Two things make this safe to depend on:
 *
 *  1. **Defaults reproduce today's output exactly.** `DEFAULT_SETTINGS` below
 *     is the behaviour the app already had before this module existed — an
 *     empty `40.0_settings` table changes nothing.
 *  2. **It works outside React.** Settings live in a module-level store, not
 *     only in a context, so pure helpers (`lib/formatters.ts`), print pages and
 *     non-component code can read them synchronously. `SettingsLoader` (mounted
 *     in the root layout) seeds the store from localStorage on mount and then
 *     from the database; `useSettings()` re-renders subscribers when it lands.
 *     Anything that renders before that gets the defaults — never a crash and
 *     never a blank.
 *
 * INTERNAL vs DOCUMENT is deliberate and preserved: internal screens are read
 * by the team all day (en-US grouping "1,234,567", en-GB dates "24 Jul 26");
 * customer-facing documents follow Indonesian convention. Each profile is
 * configured independently — Settings must never flatten the two into one.
 *
 * Storage shape: one row per top-level field (`key` = the field name, `value` =
 * JSONB). Unknown rows are ignored and missing rows fall back to the default,
 * so adding a field here needs no migration.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const SETTINGS_TABLE = '40.0_settings';

// ── Shape ───────────────────────────────────────────────────────────────────

/** How a number is punctuated. `decimals` is the default fraction length. */
export interface NumberFormat {
  thousands: string;   // '' | ',' | '.' | ' ' | "'"
  decimal: string;     // '.' | ','
  decimals: number;    // default fraction digits for plain amounts (0 = whole)
}

/** How a currency amount is dressed: "Rp 1,234" / "1.234 Rp" / "Rp1,234". */
export interface CurrencyFormat {
  symbol: string;
  position: 'before' | 'after';
  space: boolean;
}

export type DateStyle =
  | 'dd MMM yy'      // 24 Jul 26   (internal default)
  | 'dd MMM yyyy'    // 24 Jul 2026
  | 'dd MMMM yyyy'   // 24 Juli 2026 (document default)
  | 'dd/MM/yyyy'     // 24/07/2026
  | 'MM/dd/yyyy'     // 07/24/2026
  | 'yyyy-MM-dd';    // 2026-07-24

export type DateLocale = 'en-GB' | 'en-US' | 'id-ID';

export interface AppSettings {
  // ── Internal screens ──────────────────────────────────────────────────────
  numberInternal: NumberFormat;
  currencyInternal: CurrencyFormat;
  dateInternal: DateStyle;
  dateLocaleInternal: DateLocale;
  time24h: boolean;

  // ── Customer-facing documents (quote / invoice / Surat Jalan / EPC print,
  //    WhatsApp price copy) ────────────────────────────────────────────────
  numberDocument: NumberFormat;
  currencyDocument: CurrencyFormat;
  dateDocument: DateStyle;
  dateLocaleDocument: DateLocale;

  /** ISO code used where the app spells the currency out ("IDR 1,234,567"). */
  currencyCode: string;
  /**
   * Buy-side screens show the ISO code (`IDR 1,234,567`) while sell-side screens
   * show the symbol (`Rp 1,234,567`) — a split that grew by accident. Turn this
   * on to make the symbol win everywhere.
   */
  useSymbolEverywhere: boolean;

  // ── Operational defaults ─────────────────────────────────────────────────
  defaultPpnPct: number;          // VAT % prefilled on new sales documents
  defaultPoPaymentTerms: string;  // prefilled on a new PI/PO
  defaultMarginFloorPct: number;  // prefilled when creating a price tier
  epcCostBufferPct: number;       // EPC Cost Basis buffer (was app_settings)
  slowMoverDays: number;          // /economics: "no movement in N days"
  costDriftPct: number;           // proposals list: flag costs N% off today's

  // ── Company / letterhead ─────────────────────────────────────────────────
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  companyTaxId: string;
  companyBankDetails: string;
  documentFooterNote: string;
}

/**
 * Exactly the behaviour the app had before Settings existed. Change these only
 * if you intend every unconfigured install to change with them.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  numberInternal:     { thousands: ',', decimal: '.', decimals: 0 },
  currencyInternal:   { symbol: 'Rp', position: 'before', space: true },
  dateInternal:       'dd MMM yy',
  dateLocaleInternal: 'en-GB',
  time24h:            true,

  numberDocument:     { thousands: ',', decimal: '.', decimals: 0 },
  currencyDocument:   { symbol: 'Rp', position: 'before', space: false },
  dateDocument:       'dd MMMM yyyy',
  dateLocaleDocument: 'id-ID',

  currencyCode:        'IDR',
  useSymbolEverywhere: false,

  defaultPpnPct:         11,
  defaultPoPaymentTerms: '100% in advance',
  defaultMarginFloorPct: 15,
  epcCostBufferPct:      5,
  slowMoverDays:         60,
  costDriftPct:          10,

  companyName:        '',
  companyAddress:     '',
  companyPhone:       '',
  companyEmail:       '',
  companyTaxId:       '',
  companyBankDetails: '',
  documentFooterNote: '',
};

/** Indonesian punctuation, one click — "1.234.567,89". */
export const NUMBER_PRESET_ID: NumberFormat = { thousands: '.', decimal: ',', decimals: 0 };
/** English punctuation — "1,234,567.89". */
export const NUMBER_PRESET_EN: NumberFormat = { thousands: ',', decimal: '.', decimals: 0 };

// ── Store (module-level, so non-React callers can read it) ──────────────────

const LS_KEY = 'icaproc.settings.v1';

let current: AppSettings = DEFAULT_SETTINGS;
let loaded = false;
const listeners = new Set<() => void>();

/** The settings in force right now (defaults until the loader has run). */
export const getSettings = (): AppSettings => current;
/** True once the database copy has been read at least once this session. */
export const settingsLoaded = (): boolean => loaded;

export function subscribeSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function publish(next: AppSettings) {
  current = next;
  listeners.forEach((fn) => { try { fn(); } catch { /* a bad subscriber must not break the rest */ } });
}

// ── Coercion — never trust a stored row to have the right shape ─────────────

const str = (v: unknown, fb: string): string => (typeof v === 'string' ? v : fb);
const bool = (v: unknown, fb: boolean): boolean => (typeof v === 'boolean' ? v : fb);
const numOr = (v: unknown, fb: number): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fb;
};
const numFmt = (v: unknown, fb: NumberFormat): NumberFormat => {
  if (!v || typeof v !== 'object') return fb;
  const o = v as Partial<NumberFormat>;
  return {
    thousands: typeof o.thousands === 'string' ? o.thousands : fb.thousands,
    decimal:   typeof o.decimal === 'string' && o.decimal ? o.decimal : fb.decimal,
    decimals:  Math.max(0, Math.min(6, Math.round(numOr(o.decimals, fb.decimals)))),
  };
};
const ccyFmt = (v: unknown, fb: CurrencyFormat): CurrencyFormat => {
  if (!v || typeof v !== 'object') return fb;
  const o = v as Partial<CurrencyFormat>;
  return {
    symbol:   typeof o.symbol === 'string' ? o.symbol : fb.symbol,
    position: o.position === 'after' ? 'after' : 'before',
    space:    typeof o.space === 'boolean' ? o.space : fb.space,
  };
};
const DATE_STYLES: DateStyle[] = ['dd MMM yy', 'dd MMM yyyy', 'dd MMMM yyyy', 'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd'];
const dateStyle = (v: unknown, fb: DateStyle): DateStyle =>
  (typeof v === 'string' && (DATE_STYLES as string[]).includes(v)) ? (v as DateStyle) : fb;
const DATE_LOCALES: DateLocale[] = ['en-GB', 'en-US', 'id-ID'];
const dateLocale = (v: unknown, fb: DateLocale): DateLocale =>
  (typeof v === 'string' && (DATE_LOCALES as string[]).includes(v)) ? (v as DateLocale) : fb;

/** Merge an arbitrary object of stored values over the defaults, field by field. */
export function coerceSettings(raw: Record<string, unknown>): AppSettings {
  const d = DEFAULT_SETTINGS;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(raw, k) && raw[k] !== null && raw[k] !== undefined;
  const pick = <T,>(k: keyof AppSettings, fn: (v: unknown) => T, fb: T): T => (has(k as string) ? fn(raw[k as string]) : fb);
  return {
    numberInternal:     pick('numberInternal',     (v) => numFmt(v, d.numberInternal), d.numberInternal),
    currencyInternal:   pick('currencyInternal',   (v) => ccyFmt(v, d.currencyInternal), d.currencyInternal),
    dateInternal:       pick('dateInternal',       (v) => dateStyle(v, d.dateInternal), d.dateInternal),
    dateLocaleInternal: pick('dateLocaleInternal', (v) => dateLocale(v, d.dateLocaleInternal), d.dateLocaleInternal),
    time24h:            pick('time24h',            (v) => bool(v, d.time24h), d.time24h),

    numberDocument:     pick('numberDocument',     (v) => numFmt(v, d.numberDocument), d.numberDocument),
    currencyDocument:   pick('currencyDocument',   (v) => ccyFmt(v, d.currencyDocument), d.currencyDocument),
    dateDocument:       pick('dateDocument',       (v) => dateStyle(v, d.dateDocument), d.dateDocument),
    dateLocaleDocument: pick('dateLocaleDocument', (v) => dateLocale(v, d.dateLocaleDocument), d.dateLocaleDocument),

    currencyCode:        pick('currencyCode',        (v) => str(v, d.currencyCode) || d.currencyCode, d.currencyCode),
    useSymbolEverywhere: pick('useSymbolEverywhere', (v) => bool(v, d.useSymbolEverywhere), d.useSymbolEverywhere),

    defaultPpnPct:         pick('defaultPpnPct',         (v) => numOr(v, d.defaultPpnPct), d.defaultPpnPct),
    defaultPoPaymentTerms: pick('defaultPoPaymentTerms', (v) => str(v, d.defaultPoPaymentTerms), d.defaultPoPaymentTerms),
    defaultMarginFloorPct: pick('defaultMarginFloorPct', (v) => numOr(v, d.defaultMarginFloorPct), d.defaultMarginFloorPct),
    epcCostBufferPct:      pick('epcCostBufferPct',      (v) => numOr(v, d.epcCostBufferPct), d.epcCostBufferPct),
    slowMoverDays:         pick('slowMoverDays',         (v) => Math.max(1, Math.round(numOr(v, d.slowMoverDays))), d.slowMoverDays),
    costDriftPct:          pick('costDriftPct',          (v) => Math.max(0, numOr(v, d.costDriftPct)), d.costDriftPct),

    companyName:        pick('companyName',        (v) => str(v, d.companyName), d.companyName),
    companyAddress:     pick('companyAddress',     (v) => str(v, d.companyAddress), d.companyAddress),
    companyPhone:       pick('companyPhone',       (v) => str(v, d.companyPhone), d.companyPhone),
    companyEmail:       pick('companyEmail',       (v) => str(v, d.companyEmail), d.companyEmail),
    companyTaxId:       pick('companyTaxId',       (v) => str(v, d.companyTaxId), d.companyTaxId),
    companyBankDetails: pick('companyBankDetails', (v) => str(v, d.companyBankDetails), d.companyBankDetails),
    documentFooterNote: pick('documentFooterNote', (v) => str(v, d.documentFooterNote), d.documentFooterNote),
  };
}

// ── Loading / saving ────────────────────────────────────────────────────────

/**
 * Seed the store from the last known copy in localStorage. Synchronous, so the
 * first render after mount already formats the way this browser last saw —
 * the database round-trip only confirms it.
 */
export function hydrateSettingsFromCache(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return false;
    publish(coerceSettings(JSON.parse(raw) as Record<string, unknown>));
    return true;
  } catch { return false; }
}

function cacheToStorage(s: AppSettings) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* private mode / quota */ }
}

/** Read `40.0_settings` and publish it. Falls back to whatever is in force. */
export async function loadSettings(supabase: SupabaseClient): Promise<AppSettings> {
  const { data, error } = await supabase.from(SETTINGS_TABLE).select('key, value');
  if (error || !data) return current;             // offline / not signed in yet
  const raw: Record<string, unknown> = {};
  for (const row of data as { key: string; value: unknown }[]) raw[row.key] = row.value;
  const next = coerceSettings(raw);
  loaded = true;
  publish(next);
  cacheToStorage(next);
  return next;
}

/**
 * Write the changed fields only (one row per field) and publish immediately.
 * Owner-only at the RLS level — a non-owner gets an error back, unchanged state.
 */
export async function saveSettings(
  supabase: SupabaseClient,
  patch: Partial<AppSettings>,
  email: string,
): Promise<{ error: string | null }> {
  const keys = Object.keys(patch) as (keyof AppSettings)[];
  if (!keys.length) return { error: null };
  const rows = keys.map((k) => ({
    key: k as string,
    value: patch[k] as unknown,
    updated_at: new Date().toISOString(),
    updated_by_email: email || '',
  }));
  const { error } = await supabase.from(SETTINGS_TABLE).upsert(rows, { onConflict: 'key' });
  if (error) return { error: error.message };
  const next = coerceSettings({ ...(current as unknown as Record<string, unknown>), ...(patch as Record<string, unknown>) });
  publish(next);
  cacheToStorage(next);
  return { error: null };
}

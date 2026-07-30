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
import type { RangePreset } from './dateRange';
import { DEFAULT_LIST_DEFAULTS } from '@/constants/listDefaults';

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

/**
 * How every list renders by default.
 *   compact — dense rows, everything relevant on one line, click to expand
 *   card    — roomier rows with the secondary decoration (progress meters,
 *             milestone dots, per-row sub-lines) shown inline
 * A list can still be flipped per screen; that choice is remembered locally and
 * never changes this default.
 */
export type ListLayout = 'compact' | 'card';

/** How one list opens: its order, and the period it covers. */
export interface ListDefault { sort: string; period: RangePreset }

export interface AppSettings {
  // ── Internal screens ──────────────────────────────────────────────────────
  numberInternal: NumberFormat;
  currencyInternal: CurrencyFormat;
  dateInternal: DateStyle;
  dateLocaleInternal: DateLocale;
  time24h: boolean;
  listLayout: ListLayout;
  /**
   * Per-list opening order and period, keyed by the list's key in
   * constants/listDefaults.ts. Unknown keys are ignored; a missing key falls
   * back to that list's shipped default.
   */
  listDefaults: Record<string, ListDefault>;

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

  // ── Pricing ──────────────────────────────────────────────────────────────
  /**
   * Tier prices are rounded UP to a multiple of this (Rp 1,000 by default) so
   * every quotable number is clean — the markup chain and the floor-audit
   * suggestion both use it.
   */
  priceRoundingStep: number;
  defaultTierStepPct: number;     // markup step prefilled when creating a tier (0 = leave blank)
  defaultMarginFloorPct: number;  // margin floor prefilled when creating a tier
  /**
   * Tier code a new customer starts on, and the tier used to price a customer
   * who carries none. Blank = no tier (the item's net price), as before.
   */
  defaultCustomerTier: string;

  // ── Operational defaults ─────────────────────────────────────────────────
  defaultPpnPct: number;          // VAT % prefilled on new sales documents
  defaultPoPaymentTerms: string;  // prefilled on a new PI/PO
  defaultCompanyId: string;       // issuing company prefilled on a new sales doc ('' = first)
  defaultSalesTerms: string;      // terms prefilled into a new quotation's notes
  epcCostBufferPct: number;       // EPC Cost Basis buffer (was app_settings)
  slowMoverDays: number;          // /profitability: "no movement in N days"
  economicsPeriod: '90' | '365' | 'all';  // /profitability period the page opens on
  costDriftPct: number;           // proposals list: flag costs N% off today's
  /** Dashboard: an issued invoice older than this with money outstanding is chased. */
  arOverdueDays: number;
  /** Dashboard: a quotation sent this long ago with no answer needs a nudge. */
  quoteFollowUpDays: number;
  /**
   * How close a PO's IDR principal must sit to its expected value before the
   * realised FX rate is trusted (a shared or part payment would otherwise
   * masquerade as a rate). Percent.
   */
  fxSettledTolerancePct: number;

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
  listLayout:         'compact',
  listDefaults:       DEFAULT_LIST_DEFAULTS,

  numberDocument:     { thousands: ',', decimal: '.', decimals: 0 },
  currencyDocument:   { symbol: 'Rp', position: 'before', space: false },
  dateDocument:       'dd MMMM yyyy',
  dateLocaleDocument: 'id-ID',

  currencyCode:        'IDR',
  useSymbolEverywhere: false,

  priceRoundingStep:     1000,
  defaultTierStepPct:    0,
  defaultMarginFloorPct: 15,
  defaultCustomerTier:   '',

  defaultPpnPct:         11,
  defaultPoPaymentTerms: '100% in advance',
  defaultCompanyId:      '',
  defaultSalesTerms:     '',
  epcCostBufferPct:      5,
  slowMoverDays:         60,
  economicsPeriod:       '365',
  costDriftPct:          10,
  arOverdueDays:         30,
  quoteFollowUpDays:     7,
  fxSettledTolerancePct: 5,

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

/**
 * Stored per-list defaults, merged over the shipped ones. A stored entry for a
 * list that no longer exists is dropped rather than kept as dead weight.
 */
const listDefaults = (v: unknown): Record<string, ListDefault> => {
  const out: Record<string, ListDefault> = { ...DEFAULT_LIST_DEFAULTS };
  if (!v || typeof v !== 'object') return out;
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!(k in out) || !raw || typeof raw !== 'object') continue;
    const o = raw as Partial<ListDefault>;
    out[k] = {
      sort: typeof o.sort === 'string' ? o.sort : out[k].sort,
      period: (typeof o.period === 'string' ? o.period : out[k].period) as RangePreset,
    };
  }
  return out;
};

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
    listLayout:         pick('listLayout',         (v) => (v === 'card' ? 'card' : 'compact'), d.listLayout),
    listDefaults:       pick('listDefaults',       (v) => listDefaults(v), d.listDefaults),

    numberDocument:     pick('numberDocument',     (v) => numFmt(v, d.numberDocument), d.numberDocument),
    currencyDocument:   pick('currencyDocument',   (v) => ccyFmt(v, d.currencyDocument), d.currencyDocument),
    dateDocument:       pick('dateDocument',       (v) => dateStyle(v, d.dateDocument), d.dateDocument),
    dateLocaleDocument: pick('dateLocaleDocument', (v) => dateLocale(v, d.dateLocaleDocument), d.dateLocaleDocument),

    currencyCode:        pick('currencyCode',        (v) => str(v, d.currencyCode) || d.currencyCode, d.currencyCode),
    useSymbolEverywhere: pick('useSymbolEverywhere', (v) => bool(v, d.useSymbolEverywhere), d.useSymbolEverywhere),

    priceRoundingStep:     pick('priceRoundingStep',     (v) => Math.max(1, Math.round(numOr(v, d.priceRoundingStep))), d.priceRoundingStep),
    defaultTierStepPct:    pick('defaultTierStepPct',    (v) => Math.max(0, numOr(v, d.defaultTierStepPct)), d.defaultTierStepPct),
    defaultCustomerTier:   pick('defaultCustomerTier',   (v) => str(v, d.defaultCustomerTier), d.defaultCustomerTier),

    defaultPpnPct:         pick('defaultPpnPct',         (v) => numOr(v, d.defaultPpnPct), d.defaultPpnPct),
    defaultPoPaymentTerms: pick('defaultPoPaymentTerms', (v) => str(v, d.defaultPoPaymentTerms), d.defaultPoPaymentTerms),
    defaultCompanyId:      pick('defaultCompanyId',      (v) => str(v, d.defaultCompanyId), d.defaultCompanyId),
    defaultSalesTerms:     pick('defaultSalesTerms',     (v) => str(v, d.defaultSalesTerms), d.defaultSalesTerms),
    economicsPeriod:       pick('economicsPeriod',       (v) => (v === '90' || v === 'all' ? v : '365'), d.economicsPeriod),
    fxSettledTolerancePct: pick('fxSettledTolerancePct', (v) => Math.max(0.1, numOr(v, d.fxSettledTolerancePct)), d.fxSettledTolerancePct),
    defaultMarginFloorPct: pick('defaultMarginFloorPct', (v) => numOr(v, d.defaultMarginFloorPct), d.defaultMarginFloorPct),
    epcCostBufferPct:      pick('epcCostBufferPct',      (v) => numOr(v, d.epcCostBufferPct), d.epcCostBufferPct),
    slowMoverDays:         pick('slowMoverDays',         (v) => Math.max(1, Math.round(numOr(v, d.slowMoverDays))), d.slowMoverDays),
    costDriftPct:          pick('costDriftPct',          (v) => Math.max(0, numOr(v, d.costDriftPct)), d.costDriftPct),
    arOverdueDays:         pick('arOverdueDays',         (v) => Math.max(1, Math.round(numOr(v, d.arOverdueDays))), d.arOverdueDays),
    quoteFollowUpDays:     pick('quoteFollowUpDays',     (v) => Math.max(1, Math.round(numOr(v, d.quoteFollowUpDays))), d.quoteFollowUpDays),

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

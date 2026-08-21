/**
 * ICAPROC — Settings (Module 40.x). Owner-only.
 *
 * The one screen where the values that used to be hard-coded per page are set:
 *  • Formatting — number punctuation, currency symbol/position/spacing and date
 *    style, configured SEPARATELY for internal screens and for customer-facing
 *    documents (that split is deliberate; see lib/formatters.ts). Every panel
 *    previews live off the draft, so you see the change before you save it.
 *  • Defaults — PPN %, PO payment terms, default warehouse, margin floor, EPC
 *    cost buffer, slow-mover threshold, cost-drift threshold.
 *  • Company — the letterhead block printed on customer-facing documents.
 *  • Users — role assignment (absorbed from the old /admin page) plus the
 *    sign-up allowlist, so granting access is one screen instead of an SQL fix.
 *
 * Everything writes to `40.0_settings` (owner-only RLS) except the default
 * warehouse, which stays the `is_default` flag on `30.3_warehouses` — one
 * source of truth per fact, no shadow copies.
 */
'use client';
import { Fragment, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth, type UserProfile } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { ROLE_PERMISSIONS, ROLE_LABELS, ROLE_DESCRIPTIONS, ASSIGNABLE_ROLES, PERMISSION_MATRIX, type UserRole } from '@/constants/roles';
import { canOpenPath } from '@/constants/navigation';
import BrandMenu from '@/components/ui/BrandMenu';
import {
  DEFAULT_SETTINGS, NUMBER_PRESET_EN, NUMBER_PRESET_ID, saveSettings,
  type AppSettings, type CurrencyFormat, type DateLocale, type DateStyle, type NumberFormat,
} from '@/lib/settings';
import { applyCurrency, formatDate, formatNumber } from '@/lib/formatters';
import { fetchWarehouses, type Warehouse } from '@/lib/warehouses';
import { LIST_SPECS } from '@/constants/listDefaults';
import { PRODUCT_COLS } from '@/constants/productColumns';
import { orderedNavGroups, orderedGroupItems, DEFAULT_MENU_ORDER, DESTINATIONS } from '@/constants/navigation';
import {
  orderedWidgetKeys, hiddenWidgetKeys, WIDGET_BY_KEY,
  DEFAULT_WIDGET_ORDER, DEFAULT_WIDGET_HIDDEN, type DashboardLayout,
} from '@/constants/dashboardWidgets';
import WidgetArranger from '@/components/ui/WidgetArranger';
import { ITEM_SCORE_FACTORS, DEFAULT_ITEM_SCORE_WEIGHTS, type ItemScoreWeights } from '@/lib/itemScore';
import { PRESET_LABELS, type RangePreset } from '@/lib/dateRange';
import { accountLabel, type BankAccount } from '@/lib/banks';
import { THEMES, previewTheme, endThemePreview } from '@/lib/theme';
import Autocomplete from '@/components/ui/Autocomplete';
import { fmtRupiah } from '@/lib/formatters';
import Link from 'next/link';

type Tab = 'format' | 'appearance' | 'menu' | 'dashboard' | 'lists' | 'pricing' | 'defaults' | 'terms' | 'company' | 'banks' | 'users';
const TABS: [Tab, string][] = [
  ['format', 'Formatting'], ['appearance', 'Appearance'], ['menu', 'Menu'], ['dashboard', 'Dashboard'], ['lists', 'Lists'], ['pricing', 'Pricing'],
  ['defaults', 'Defaults'], ['terms', 'Terms'], ['company', 'Company'], ['banks', 'Banks'], ['users', 'Users'],
];

const SEPARATORS: { value: string; label: string }[] = [
  { value: ',', label: 'Comma  ,' },
  { value: '.', label: 'Period  .' },
  { value: ' ', label: 'Space' },
  { value: "'", label: "Apostrophe  '" },
  { value: '',  label: 'None' },
];
const DECIMAL_SEPARATORS = SEPARATORS.filter((s) => s.value === ',' || s.value === '.');
const DATE_STYLES: DateStyle[] = ['dd MMM yy', 'dd MMM yyyy', 'dd MMMM yyyy', 'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd'];
const DATE_LOCALES: { value: DateLocale; label: string }[] = [
  { value: 'en-GB', label: 'English (UK) — Jul / July' },
  { value: 'en-US', label: 'English (US) — Jul / July' },
  { value: 'id-ID', label: 'Indonesian — Jul / Juli' },
];

// The periods worth offering as a default — the rolling windows stay in the
// picker, where someone is answering a specific question.
const PERIOD_CHOICES: Exclude<RangePreset, 'custom'>[] = ['all', 'today', 'week', 'mtd', 'month', 'quarter', 'ytd', 'year', 'last30', 'last90'];

const SAMPLE = 1234567.89;
const SAMPLE_DATE = '2026-07-24';

// Field chrome, so every input on the page looks the same
const inputCls = 'w-full bg-slate-900/80 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500/60 transition-colors';
const labelCls = 'block text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide sm:tracking-wider text-slate-500 mb-1 truncate';

function Field({ label, hint, children, className = '' }: {
  label: string; hint?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={className}>
      <label className={labelCls}>{label}</label>
      {children}
      {hint && <p className="text-[11px] text-slate-600 mt-1 leading-snug">{hint}</p>}
    </div>
  );
}

export default function SettingsPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const live = useSettings();
  const isOwner = !!profile && ROLE_PERMISSIONS[profile.role].canManageUsers;

  const [tab, setTab] = useState<Tab>('format');
  // `null` = untouched, so the form simply mirrors whatever is in force; the
  // moment the owner edits anything it becomes a real draft to diff against.
  const [edited, setEdited] = useState<AppSettings | null>(null);
  const draft = edited ?? live;
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000); };

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null;
    if (t && TABS.some(([k]) => k === t)) setTab(t);
  }, []);
  useEffect(() => {
    const label = TABS.find(([k]) => k === tab)?.[1] ?? '';
    document.title = `Settings · ${label} — ICAPROC`;
  }, [tab]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/settings')}`); return; }
    if (profile && !canOpenPath(ROLE_PERMISSIONS[profile.role], '/settings')) router.replace('/unauthorized');
  }, [authLoading, user, profile, router]);

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setEdited((d) => ({ ...(d ?? live), [key]: value }));
  };

  const dirtyKeys = useMemo(
    () => (Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[])
      .filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(live[k])),
    [draft, live],
  );

  // A thousands separator that equals the decimal separator makes every number
  // unreadable ("1.234.567.89") — block the save rather than ship it.
  const formatError = useMemo(() => {
    const bad = (f: NumberFormat, which: string) =>
      f.thousands && f.thousands === f.decimal ? `${which}: the thousands and decimal separators must differ.` : null;
    return bad(draft.numberInternal, 'Internal screens') ?? bad(draft.numberDocument, 'Documents');
  }, [draft]);

  const save = async () => {
    if (!dirtyKeys.length || formatError) return;
    setSaving(true);
    const patch: Partial<AppSettings> = {};
    for (const k of dirtyKeys) (patch as Record<string, unknown>)[k as string] = draft[k];
    const n = dirtyKeys.length;
    const { error } = await saveSettings(supabase, patch, profile?.email ?? '');
    setSaving(false);
    if (error) { flash(`Could not save — ${error}`); return; }
    setEdited(null);   // saved values are now the live ones
    flash(`Saved — ${n} setting${n !== 1 ? 's' : ''} updated everywhere`);
  };

  const revert = () => setEdited(null);

  if (authLoading || !user || (profile && !isOwner)) {
    return (
      <div className="min-h-screen bg-chrome flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between sm:flex-wrap gap-2.5 sm:gap-4">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle={`Settings · ${TABS.find(([k]) => k === tab)?.[1]}`} />
          <div className="flex items-center gap-2 flex-wrap">
            {dirtyKeys.length > 0 && (
              <>
                <span className="text-[11px] text-amber-300">{dirtyKeys.length} unsaved change{dirtyKeys.length !== 1 ? 's' : ''}</span>
                <button onClick={revert} className="text-xs text-slate-400 hover:text-white px-3 py-1.5 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors">
                  Revert
                </button>
              </>
            )}
            <button onClick={save} disabled={!dirtyKeys.length || saving || !!formatError}
              className="text-xs font-bold px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-white transition-colors">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-6 space-y-5">
        {/* 6 tabs never fit a phone: scroll horizontally rather than wrap into
            a second row that pushes the content down. */}
        <div className="flex items-center gap-4 sm:gap-5 border-b border-slate-800/80 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-none">
          {TABS.map(([k, label]) => (
            <button key={k}
              onClick={() => { setTab(k); window.history.replaceState(null, '', `/settings?tab=${k}`); }}
              className={`pb-2.5 -mb-px text-[13px] whitespace-nowrap transition-colors border-b-2 ${tab === k ? 'border-emerald-400 text-white font-bold' : 'border-transparent text-slate-500 hover:text-slate-300 font-medium'}`}>
              {label}
            </button>
          ))}
        </div>

        {formatError && (
          <div className="bg-rose-500/10 border border-rose-500/40 rounded-xl px-4 py-2.5 text-xs text-rose-200">{formatError}</div>
        )}

        {tab === 'format'   && <FormatTab draft={draft} set={set} />}
        {tab === 'appearance' && <AppearanceTab draft={draft} set={set} />}
        {tab === 'menu'     && <MenuOrderTab draft={draft} set={set} />}
        {tab === 'dashboard' && <DashboardTab draft={draft} set={set} />}
        {tab === 'lists'    && <ListsTab draft={draft} set={set} />}
        {tab === 'pricing'  && <PricingTab draft={draft} set={set} />}
        {tab === 'defaults' && <DefaultsTab draft={draft} set={set} flash={flash} />}
        {tab === 'terms'    && <TermsTab draft={draft} set={set} />}
        {tab === 'company'  && <CompanyTab draft={draft} set={set} />}
        {tab === 'banks'    && <BanksTab flash={flash} email={profile?.email ?? ''} />}
        {tab === 'users'    && <UsersTab myId={profile?.id ?? ''} flash={flash} />}
      </main>

      {toast && (
        <div className="fixed bottom-6 right-6 z-[110] px-4 py-2.5 bg-slate-800 border border-slate-700 text-white text-sm font-semibold rounded-xl shadow-lg max-w-[90vw] truncate">{toast}</div>
      )}
    </div>
  );
}

// ── Formatting ──────────────────────────────────────────────────────────────

function NumberPanel({
  title, tone, blurb, number, currency, dateStyle, dateLocale,
  onNumber, onCurrency, onDateStyle, onDateLocale,
}: {
  title: string; tone: string; blurb: string;
  number: NumberFormat; currency: CurrencyFormat; dateStyle: DateStyle; dateLocale: DateLocale;
  onNumber: (v: NumberFormat) => void; onCurrency: (v: CurrencyFormat) => void;
  onDateStyle: (v: DateStyle) => void; onDateLocale: (v: DateLocale) => void;
}) {
  const amount = formatNumber(SAMPLE, number, number.decimals);
  const whole = formatNumber(Math.round(SAMPLE), number, 0);
  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800/80">
        <p className={`text-xs font-bold uppercase tracking-widest ${tone}`}>{title}</p>
        <p className="text-[11px] text-slate-500 mt-1 leading-snug">{blurb}</p>
      </div>

      {/* Live preview off the draft — what this profile will print once saved */}
      <div className="px-4 py-3 bg-slate-950/40 border-b border-slate-800/60 space-y-1">
        <p className="text-[10px] uppercase tracking-widest text-slate-600">Preview</p>
        <p className="text-lg font-bold text-white tabular-nums">{applyCurrency(whole, currency)}</p>
        <p className="text-xs text-slate-400 tabular-nums">{amount} · {formatDate(SAMPLE_DATE, dateStyle, dateLocale)}</p>
      </div>

      <div className="p-4 space-y-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-slate-500">Presets:</span>
          <button onClick={() => onNumber({ ...NUMBER_PRESET_EN, decimals: number.decimals })}
            className="text-[11px] px-2.5 py-1 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 transition-colors">
            English 1,234,567
          </button>
          <button onClick={() => onNumber({ ...NUMBER_PRESET_ID, decimals: number.decimals })}
            className="text-[11px] px-2.5 py-1 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 transition-colors">
            Indonesian 1.234.567
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Field label="Thousands">
            <select className={inputCls} value={number.thousands} onChange={(e) => onNumber({ ...number, thousands: e.target.value })}>
              {SEPARATORS.map((s) => <option key={s.label} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Decimal">
            <select className={inputCls} value={number.decimal} onChange={(e) => onNumber({ ...number, decimal: e.target.value })}>
              {DECIMAL_SEPARATORS.map((s) => <option key={s.label} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Decimal places" hint="Rupiah amounts are whole numbers (0)." className="col-span-2 sm:col-span-1">
            <input type="number" min={0} max={4} className={inputCls} value={number.decimals}
              onChange={(e) => onNumber({ ...number, decimals: Math.max(0, Math.min(4, Number(e.target.value) || 0)) })} />
          </Field>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Field label="Currency symbol">
            <input className={inputCls} value={currency.symbol} onChange={(e) => onCurrency({ ...currency, symbol: e.target.value })} placeholder="Rp" />
          </Field>
          <Field label="Position">
            <select className={inputCls} value={currency.position} onChange={(e) => onCurrency({ ...currency, position: e.target.value as 'before' | 'after' })}>
              <option value="before">Before</option>
              <option value="after">After</option>
            </select>
          </Field>
          <Field label="Spacing" className="col-span-2 sm:col-span-1">
            <select className={inputCls} value={currency.space ? 'yes' : 'no'} onChange={(e) => onCurrency({ ...currency, space: e.target.value === 'yes' })}>
              <option value="yes">With space</option>
              <option value="no">No space</option>
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Date format">
            <select className={inputCls} value={dateStyle} onChange={(e) => onDateStyle(e.target.value as DateStyle)}>
              {DATE_STYLES.map((s) => <option key={s} value={s}>{s} — {formatDate(SAMPLE_DATE, s, dateLocale)}</option>)}
            </select>
          </Field>
          <Field label="Month names">
            <select className={inputCls} value={dateLocale} onChange={(e) => onDateLocale(e.target.value as DateLocale)}>
              {DATE_LOCALES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </Field>
        </div>
      </div>
    </div>
  );
}

function FormatTab({ draft, set }: { draft: AppSettings; set: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void }) {
  return (
    <div className="space-y-5">
      <div className="bg-sky-500/[0.07] border border-sky-500/25 rounded-xl px-4 py-3">
        <p className="text-xs text-sky-100/90 leading-relaxed">
          <span className="font-bold">Two profiles, on purpose.</span> Internal screens are read by the team all day and
          were built with English punctuation; customer-facing documents follow Indonesian convention. Changing one never
          touches the other — that split is the reason this page has two panels instead of one.
        </p>
        <p className="text-[11px] text-sky-200/60 mt-1.5 leading-relaxed">
          Printed documents currently punctuate numbers the English way (Rp1,234,567) while the WhatsApp price copy uses
          Indonesian (1.234.567). Press <span className="font-semibold">Indonesian</span> on the Documents panel to settle
          it in favour of Indonesian everywhere a customer sees it.
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <NumberPanel
          title="Internal screens" tone="text-emerald-300"
          blurb="Catalog, Products, Sales, Stock, Economics — every table the team reads."
          number={draft.numberInternal} currency={draft.currencyInternal}
          dateStyle={draft.dateInternal} dateLocale={draft.dateLocaleInternal}
          onNumber={(v) => set('numberInternal', v)} onCurrency={(v) => set('currencyInternal', v)}
          onDateStyle={(v) => set('dateInternal', v)} onDateLocale={(v) => set('dateLocaleInternal', v)}
        />
        <NumberPanel
          title="Customer-facing documents" tone="text-violet-300"
          blurb="Printed quotation, invoice, Surat Jalan, EPC proposal, and the WhatsApp price copy."
          number={draft.numberDocument} currency={draft.currencyDocument}
          dateStyle={draft.dateDocument} dateLocale={draft.dateLocaleDocument}
          onNumber={(v) => set('numberDocument', v)} onCurrency={(v) => set('currencyDocument', v)}
          onDateStyle={(v) => set('dateDocument', v)} onDateLocale={(v) => set('dateLocaleDocument', v)}
        />
      </div>

      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 space-y-3.5">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-300">Currency code</p>
          <p className="text-[11px] text-slate-500 mt-1">
            Buy-side screens spell the amount with the ISO code (<span className="font-mono">IDR 1,234,567</span>) while
            sell-side screens use the symbol (<span className="font-mono">Rp 1,234,567</span>). Decide which wins.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-3 max-w-xl">
          <Field label="Code" hint="Used wherever the currency is spelled out, and for foreign-currency amounts.">
            <input className={inputCls} value={draft.currencyCode} onChange={(e) => set('currencyCode', e.target.value)} placeholder="IDR" />
          </Field>
          <Field label="Everywhere" hint="On: those screens show the symbol instead of the code.">
            <select className={inputCls} value={draft.useSymbolEverywhere ? 'yes' : 'no'} onChange={(e) => set('useSymbolEverywhere', e.target.value === 'yes')}>
              <option value="no">Keep the ISO code on buy-side screens</option>
              <option value="yes">Use the symbol everywhere</option>
            </select>
          </Field>
        </div>
        <div className="grid sm:grid-cols-2 gap-3 max-w-xl pt-1">
          <div>
            <p className={labelCls}>Preview</p>
            <p className="text-sm text-slate-200 tabular-nums py-1.5">
              {draft.useSymbolEverywhere
                ? applyCurrency(formatNumber(Math.round(SAMPLE), draft.numberInternal, 0), draft.currencyInternal)
                : `${draft.currencyCode} ${formatNumber(Math.round(SAMPLE), draft.numberInternal, 0)}`}
            </p>
          </div>
          <Field label="Clock" hint="Used by the “last edited” stamps.">
            <select className={inputCls} value={draft.time24h ? 'yes' : 'no'} onChange={(e) => set('time24h', e.target.value === 'yes')}>
              <option value="yes">24-hour (14:32)</option>
              <option value="no">12-hour (2:32 PM)</option>
            </select>
          </Field>
        </div>
      </div>
    </div>
  );
}

// ── Appearance ──────────────────────────────────────────────────────────────
// The COMPANY DEFAULT skin — what a browser shows before its person touches
// the switcher in the ICAPROC menu. A personal choice always wins and is never
// overwritten by changing this (see lib/theme.ts for the resolution order).

function AppearanceTab({ draft, set }: { draft: AppSettings; set: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void }) {
  // Selecting a card paints the whole screen in that skin immediately — the
  // choice must be judged on real pages, not on a miniature. The preview
  // follows the DRAFT (so Revert repaints too) and ends when the tab is left:
  // nothing is persisted until Save, and a personal pick from the ICAPROC
  // menu still wins on this browser afterwards.
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current) previewTheme(draft.defaultTheme);
  }, [draft.defaultTheme]);
  useEffect(() => () => { endThemePreview(); }, []);
  return (
    <div className="space-y-5">
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-300">Default skin</p>
          <p className="text-[11px] text-slate-500 mt-1 leading-snug max-w-2xl">
            What every browser shows before its person picks for themselves. Selecting a skin previews it on this
            screen right away; it becomes the company default only when you Save. Anyone can still choose their own
            skin from the ICAPROC menu (Appearance) — that personal choice is remembered on their device, wins over
            this default there, and is never overwritten by it.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {THEMES.map((t) => {
            const p = t.swatch;
            const active = draft.defaultTheme === t.value;
            return (
              <button key={t.value} onClick={() => { touched.current = true; set('defaultTheme', t.value); }}
                className={`text-left rounded-xl border p-3 transition-colors ${
                  active ? 'border-emerald-500/50 bg-emerald-500/[0.07]' : 'border-slate-700 hover:border-slate-600 hover:bg-slate-800/40'
                }`}>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold ${active ? 'text-emerald-300' : 'text-slate-200'}`}>{t.label}</span>
                  {active && <span className="text-[10px] font-semibold text-emerald-400">DEFAULT</span>}
                </div>
                <p className="text-[11px] text-slate-500 mt-1 leading-snug min-h-[2.4em]">{t.blurb}</p>
                {/* A miniature painted with the skin's REAL values */}
                <div className="mt-2.5 rounded-lg p-2 space-y-1.5 border border-black/10" style={{ background: p.bg }}>
                  {[0, 1].map((i) => (
                    <div key={i} className="rounded px-2 py-1.5 flex items-center gap-2" style={{ background: p.card }}>
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: p.accent }} />
                      <span className="h-1.5 rounded-full flex-1" style={{ background: p.ink, opacity: 0.55 }} />
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-slate-600 leading-snug max-w-2xl">
          For office monitors: <span className="text-slate-400">Dim</span> keeps the dark look without the harsh
          near-black, and <span className="text-slate-400">Paper</span> is the gentlest for reading all day.
        </p>
      </div>
    </div>
  );
}

// ── Lists ───────────────────────────────────────────────────────────────────
// How every list opens: its layout, its order, and the period it covers. The
// rows come from constants/listDefaults.ts, which is also what the pages read —
// a list can only be configured here if its page honours the setting.

function ListsTab({ draft, set }: { draft: AppSettings; set: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void }) {
  const setList = (key: string, patch: Partial<{ sort: string; period: RangePreset }>) =>
    set('listDefaults', { ...draft.listDefaults, [key]: { ...draft.listDefaults[key], ...patch } });

  return (
    <div className="space-y-5">
      {/* ── Layout ─────────────────────────────────────────────────────── */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-300">Layout</p>
          <p className="text-[11px] text-slate-500 mt-1 leading-snug">
            How every list opens — Sales, Customers, Invoices, Delivery, Banks, Proposals, Deal Lookup.
            Anyone can flip a single list without changing this; that choice is remembered on their device only,
            and it lasts until this default is next changed — changing it here applies everywhere again.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-3 max-w-2xl">
          {([
            { v: 'compact' as const, title: 'Compact', blurb: 'Dense rows, everything relevant on one line. Click a row to expand it. Best once a list is long.' },
            { v: 'card' as const,    title: 'Card',    blurb: 'Roomier rows that carry their secondary detail inline — progress meters, milestone dots, sub-lines.' },
          ]).map((opt) => (
            <button key={opt.v} onClick={() => set('listLayout', opt.v)}
              className={`text-left rounded-xl border p-3 transition-colors ${
                draft.listLayout === opt.v
                  ? 'border-emerald-500/50 bg-emerald-500/[0.07]'
                  : 'border-slate-700 hover:border-slate-600 hover:bg-slate-800/40'
              }`}>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-bold ${draft.listLayout === opt.v ? 'text-emerald-300' : 'text-slate-200'}`}>{opt.title}</span>
                {draft.listLayout === opt.v && <span className="text-[10px] font-semibold text-emerald-400">DEFAULT</span>}
              </div>
              <p className="text-[11px] text-slate-500 mt-1 leading-snug">{opt.blurb}</p>
              {/* A miniature of what the choice looks like */}
              <div className="mt-2.5 space-y-1">
                {[0, 1, 2].map((i) => (
                  <div key={i} className={`rounded bg-slate-800/70 ${opt.v === 'compact' ? 'h-2' : 'h-5'}`} />
                ))}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Products columns — what everyone sees ─────────────────────────── */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-300">Products columns</p>
          <p className="text-[11px] text-slate-500 mt-1 leading-snug">
            Columns switched off here disappear from the Products table for EVERYONE — they also leave the
            page&apos;s own Columns menu, so nobody can turn them back on. A person&apos;s Columns menu can
            still hide more for themselves. Description always shows; Brand additionally follows the role permission.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 max-w-2xl">
          {PRODUCT_COLS.map((c) => {
            const hidden = draft.productHiddenColumns.includes(c.key);
            return (
              <button key={c.key}
                onClick={() => set('productHiddenColumns', hidden
                  ? draft.productHiddenColumns.filter((k) => k !== c.key)
                  : [...draft.productHiddenColumns, c.key])}
                className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                  hidden
                    ? 'border-slate-700 bg-slate-950/60 text-slate-600 line-through'
                    : 'border-emerald-500/40 bg-emerald-500/[0.07] text-emerald-300'
                }`}
                title={hidden ? 'Hidden for everyone — click to show' : 'Visible — click to hide for everyone'}>
                {c.label}
              </button>
            );
          })}
        </div>
      </div>


      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800/80">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-300">Opening order &amp; period</p>
          <p className="text-[11px] text-slate-500 mt-1 leading-snug">
            What each list shows before anyone touches a filter. The period is resolved when the page opens, so
            “month to date” always means the month it is opened in — and anyone can still widen or re-sort a list
            for themselves.
          </p>
        </div>
        <div className="divide-y divide-slate-800/60">
          {LIST_SPECS.map((spec) => {
            const cur = draft.listDefaults[spec.key] ?? spec.defaults;
            return (
              <div key={spec.key} className="px-4 py-3 grid grid-cols-1 sm:grid-cols-[1fr_180px_170px] gap-3 sm:items-center">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-100">{spec.label}</p>
                  <p className="text-[11px] text-slate-600 leading-snug">
                    {spec.hint ? `${spec.hint} ` : ''}{spec.dateLabel ? `Period filters the ${spec.dateLabel}.` : ''}
                  </p>
                </div>
                {spec.sorts.length > 0 ? (
                  <Field label="Sort by">
                    <select className={inputCls} value={cur.sort} onChange={(e) => setList(spec.key, { sort: e.target.value })}>
                      {spec.sorts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </Field>
                ) : (
                  <p className="text-[11px] text-slate-600 sm:text-center">One natural order</p>
                )}
                {spec.dateLabel ? (
                  <Field label="Period">
                    <select className={inputCls} value={cur.period} onChange={(e) => setList(spec.key, { period: e.target.value as RangePreset })}>
                      {PERIOD_CHOICES.map((p) => <option key={p} value={p}>{PRESET_LABELS[p]}</option>)}
                    </select>
                  </Field>
                ) : (
                  <p className="text-[11px] text-slate-600 sm:text-center">Not a dated list</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Pricing ─────────────────────────────────────────────────────────────────

interface TierRow { tier_id: string; tier_code: string; name: string; sort_order: number; is_active: boolean }

function PricingTab({ draft, set }: {
  draft: AppSettings;
  set: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void;
}) {
  const supabase = createSupabaseClient();
  const [tiers, setTiers] = useState<TierRow[]>([]);

  useEffect(() => {
    supabase.from('21.0_price_tiers').select('tier_id, tier_code, name, sort_order, is_active').order('sort_order')
      .then(({ data }) => setTiers(((data as TierRow[]) ?? []).filter((t) => t.is_active !== false)));
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // What the rounding step does to a real number, live
  const step = Math.max(1, draft.priceRoundingStep);
  const roundedSample = Math.ceil(1234001 / step) * step;

  return (
    <div className="space-y-5">
      <div className="bg-emerald-500/[0.07] border border-emerald-500/25 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <p className="text-xs text-emerald-100/90 leading-relaxed">
          <span className="font-bold">The tiers themselves live on Pricing.</span> This tab holds the house rules a
          new tier or a new customer starts from, and the rounding every tier price obeys.
        </p>
        <Link href="/pricing" className="text-xs font-semibold text-emerald-300 hover:text-emerald-200 whitespace-nowrap px-3 py-1.5 rounded-lg border border-emerald-500/30 hover:bg-emerald-500/10 transition-colors">
          Open Pricing →
        </Link>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 space-y-3.5">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">Markup chain</p>
            <p className="text-[11px] text-slate-500 mt-1 leading-snug">
              The price entered on an item IS the first (net) tier; each tier above is
              previous ÷ (1 − step%), rounded UP to the step below.
            </p>
          </div>
          <Field label="Round prices up to" hint={`Every computed tier price and every "raise to floor" suggestion lands on a multiple of this.`}>
            <input type="number" min={1} step={100} className={inputCls} value={draft.priceRoundingStep}
              onChange={(e) => set('priceRoundingStep', Math.max(1, Math.round(Number(e.target.value) || 1)))} />
          </Field>
          <p className="text-[11px] text-slate-500 tabular-nums">
            Preview: {formatNumber(1234001, draft.numberInternal, 0)} → <span className="text-slate-200 font-semibold">{formatNumber(roundedSample, draft.numberInternal, 0)}</span>
          </p>
          <Field label="Default markup step %" hint="Prefilled when a new tier is created. 0 leaves the field blank.">
            <input type="number" step="0.5" min={0} className={inputCls} value={draft.defaultTierStepPct}
              onChange={(e) => set('defaultTierStepPct', Math.max(0, Number(e.target.value) || 0))} />
          </Field>
          <Field label="Default margin floor %" hint="Prefilled when a new tier is created — the minimum GP vs landed cost the Floor Audit polices.">
            <input type="number" step="1" className={inputCls} value={draft.defaultMarginFloorPct}
              onChange={(e) => set('defaultMarginFloorPct', Number(e.target.value) || 0)} />
          </Field>
        </div>

        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 space-y-3.5">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">Customers</p>
            <p className="text-[11px] text-slate-500 mt-1 leading-snug">
              Which tier a customer sits on decides the price the sales editor fills in.
            </p>
          </div>
          <Field label="Default customer tier"
            hint="A new customer starts here, and a customer carrying no tier is priced at it. Blank keeps today's behaviour: the item's net price.">
            <select className={inputCls} value={draft.defaultCustomerTier}
              onChange={(e) => set('defaultCustomerTier', e.target.value)}>
              <option value="">No tier — use the item's net price</option>
              {tiers.map((t) => <option key={t.tier_id} value={t.tier_code}>{t.name} ({t.tier_code})</option>)}
            </select>
          </Field>
          {!tiers.length && (
            <p className="text-[11px] text-amber-300/80">No active tiers yet — create them on Pricing first.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Defaults ────────────────────────────────────────────────────────────────

function DefaultsTab({ draft, set, flash }: {
  draft: AppSettings;
  set: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void;
  flash: (m: string) => void;
}) {
  const supabase = createSupabaseClient();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [companies, setCompanies] = useState<{ company_id: string; legal_name: string }[]>([]);
  const [whBusy, setWhBusy] = useState(false);

  useEffect(() => {
    fetchWarehouses(supabase).then(setWarehouses);
    supabase.from('1.0_companies').select('company_id, legal_name').order('legal_name')
      .then(({ data }) => setCompanies((data as { company_id: string; legal_name: string }[]) ?? []));
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // The default warehouse stays where it already lives — the `is_default` flag
  // on 30.3_warehouses (a partial unique index enforces exactly one), so this
  // page edits that fact rather than keeping a second copy of it.
  const setDefaultWarehouse = async (code: string) => {
    setWhBusy(true);
    const clear = await supabase.from('30.3_warehouses').update({ is_default: false }).eq('is_default', true);
    if (clear.error) { setWhBusy(false); flash(`Could not update — ${clear.error.message}`); return; }
    const { error } = await supabase.from('30.3_warehouses').update({ is_default: true }).eq('code', code);
    setWhBusy(false);
    if (error) { flash(`Could not update — ${error.message}`); return; }
    setWarehouses((prev) => prev.map((w) => ({ ...w, is_default: w.code === code })));
    flash(`Default warehouse is now ${code}`);
  };

  const defaultCode = warehouses.find((w) => w.is_default)?.code ?? '';

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 space-y-3.5">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">Sell side</p>
        <Field label="Default PPN %" hint="Prefilled on a new sales quotation and on new invoices.">
          <input type="number" step="0.5" className={inputCls} value={draft.defaultPpnPct}
            onChange={(e) => set('defaultPpnPct', Number(e.target.value) || 0)} />
        </Field>
        <Field label="Issuing company" hint="Prefilled as the company a new quotation is issued from.">
          <select className={inputCls} value={draft.defaultCompanyId} onChange={(e) => set('defaultCompanyId', e.target.value)}>
            <option value="">First company on the list</option>
            {companies.map((c) => <option key={c.company_id} value={c.company_id}>{c.legal_name}</option>)}
          </select>
        </Field>
        <Field label="Standard terms on a new quotation"
          hint="Prefilled into the notes of a new quotation and printed as Syarat & Ketentuan. A line ending in ':' prints as a heading.">
          <textarea rows={4} className={`${inputCls} resize-y leading-relaxed`} value={draft.defaultSalesTerms}
            onChange={(e) => set('defaultSalesTerms', e.target.value)} />
        </Field>
        <Field label="Quotation valid for (days)" hint="Prefills the Valid until date on a new quotation — printed on the PDF; a validated/sent quote past it shows Expired.">
          <input type="number" min={1} className={inputCls} value={draft.quoteValidityDays}
            onChange={(e) => set('quoteValidityDays', Math.max(1, Math.round(Number(e.target.value) || 1)))} />
        </Field>
        <Field label="An item counts as new for (days)"
          hint="How long after it lands an item is still NEW: the Dashboard's New arrivals panel and the Just arrived filter on Products both use it. A fortnight suits fast movers; if containers land quarterly, try 90.">
          <input type="number" min={1} className={inputCls} value={draft.newArrivalDays}
            onChange={(e) => set('newArrivalDays', Math.max(1, Math.round(Number(e.target.value) || 1)))} />
        </Field>
        <Field label="Language of the descriptions"
          hint="Menu names, column headings and document numbers always stay English \u2014 they are the words the team already shares with suppliers and customers. This setting changes the text that EXPLAINS: the one-liners under menu entries, the page subtitles, the hints under these fields, and the tooltips people hover. Anything not translated yet simply stays English.">
          <select className={inputCls} value={draft.language}
            onChange={(e) => set('language', e.target.value === 'id' ? 'id' : 'en')}>
            <option value="en">English</option>
            <option value="id">Bahasa Indonesia</option>
          </select>
        </Field>
        <Field label="After Sales opens on"
          hint="By ticket: one row per service ticket, newest first, and a new ticket starts from the serial number — type it and the order, invoice, delivery and customer fill themselves in. By order: the original view, grouped by status and started from the sales order. Either way both views stay available from the toolbar.">
          <select className={inputCls} value={draft.aftersalesEntry}
            onChange={(e) => set('aftersalesEntry', e.target.value === 'order' ? 'order' : 'ticket')}>
            <option value="ticket">Ticket number + serial number</option>
            <option value="order">Sales order</option>
          </select>
        </Field>
        <Field label="Invoice overdue after (days)" hint="The dashboard chases an issued invoice this old that still has money outstanding.">
          <input type="number" min={1} className={inputCls} value={draft.arOverdueDays}
            onChange={(e) => set('arOverdueDays', Math.max(1, Math.round(Number(e.target.value) || 1)))} />
        </Field>
        <Field label="Follow up a quotation after (days)" hint="A quotation sent this long ago with no answer shows up on the dashboard.">
          <input type="number" min={1} className={inputCls} value={draft.quoteFollowUpDays}
            onChange={(e) => set('quoteFollowUpDays', Math.max(1, Math.round(Number(e.target.value) || 1)))} />
        </Field>
        <Field label="Slow-mover threshold (days)" hint="Economics flags stock with no movement for this long.">
          <input type="number" min={1} className={inputCls} value={draft.slowMoverDays}
            onChange={(e) => set('slowMoverDays', Math.max(1, Math.round(Number(e.target.value) || 1)))} />
        </Field>
        <Field label="Economics opens on" hint="The period the Economics dashboard measures when you land on it.">
          <select className={inputCls} value={draft.economicsPeriod} onChange={(e) => set('economicsPeriod', e.target.value as AppSettings['economicsPeriod'])}>
            <option value="90">Last 90 days</option>
            <option value="365">Last 365 days</option>
            <option value="all">All time</option>
          </select>
        </Field>
      </div>

      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 space-y-3.5">
        <p className="text-xs font-bold uppercase tracking-widest text-sky-300">Buy side &amp; projects</p>
        <Field label="Default PO payment terms" hint="Prefilled on a new PI / PO — override per purchase when it differs.">
          <input className={inputCls} value={draft.defaultPoPaymentTerms}
            onChange={(e) => set('defaultPoPaymentTerms', e.target.value)} />
        </Field>
        <Field label="EPC cost buffer %" hint="Cost Basis buffer added to a proposal's costs. Per-item overrides still win.">
          <input type="number" step="0.5" className={inputCls} value={draft.epcCostBufferPct}
            onChange={(e) => set('epcCostBufferPct', Number(e.target.value) || 0)} />
        </Field>
        <Field label="Cost-drift threshold %" hint="The proposals list flags a quote whose item costs sit this far from today's cost.">
          <input type="number" step="1" min={0} className={inputCls} value={draft.costDriftPct}
            onChange={(e) => set('costDriftPct', Math.max(0, Number(e.target.value) || 0))} />
        </Field>
        <Field label="FX settled tolerance %"
          hint="A PO's realised exchange rate is only trusted once its IDR principal lands this close to the expected amount — a shared or part payment would otherwise masquerade as a rate.">
          <input type="number" step="0.5" min={0.1} className={inputCls} value={draft.fxSettledTolerancePct}
            onChange={(e) => set('fxSettledTolerancePct', Math.max(0.1, Number(e.target.value) || 0.1))} />
        </Field>
        <Field label="Default warehouse" hint="Preselected when receiving, adjusting or shipping stock. Saved immediately — warehouses themselves are managed on Stock.">
          <select className={inputCls} value={defaultCode} disabled={whBusy || !warehouses.length}
            onChange={(e) => setDefaultWarehouse(e.target.value)}>
            {!warehouses.length && <option value="">Loading…</option>}
            {warehouses.map((w) => <option key={w.code} value={w.code}>{w.code} — {w.name}</option>)}
          </select>
        </Field>
        <Link href="/stock" className="inline-block text-[11px] font-semibold text-sky-300 hover:text-sky-200 transition-colors">
          Open Stock →
        </Link>
      </div>

      {/* Item Score weights — how the Profitability dashboard ranks items. */}
      <div className="lg:col-span-2 bg-slate-900/50 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">Item Score weights</p>
          <button onClick={() => set('itemScoreWeights', { ...DEFAULT_ITEM_SCORE_WEIGHTS })}
            disabled={JSON.stringify(draft.itemScoreWeights) === JSON.stringify(DEFAULT_ITEM_SCORE_WEIGHTS)}
            className="text-[11px] font-semibold text-slate-400 hover:text-white disabled:text-slate-700 disabled:hover:text-slate-700 transition-colors">
            Reset to default
          </button>
        </div>
        <p className="text-[11px] text-slate-500 leading-snug">
          How much each factor counts toward an item’s 0–100 score on Profitability. The weights need not add up to 100 —
          the score normalises them, so the share each one actually carries is shown beside it.
        </p>
        {(() => {
          const w = draft.itemScoreWeights;
          const total = ITEM_SCORE_FACTORS.reduce((s, f) => s + (Number(w[f.key as keyof ItemScoreWeights]) || 0), 0);
          return (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {ITEM_SCORE_FACTORS.map((f) => {
                const val = Number(w[f.key as keyof ItemScoreWeights]) || 0;
                const share = total > 0 ? Math.round((val / total) * 100) : 0;
                return (
                  <Field key={f.key} label={`${f.label} · ${share}%`} hint={f.hint}>
                    <input type="number" min={0} step="1" className={inputCls} value={val}
                      onChange={(e) => set('itemScoreWeights', { ...w, [f.key]: Math.max(0, Number(e.target.value) || 0) })} />
                  </Field>
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ── Menu order ────────────────────────────────────────────────────────────

/** A small up/down arrow pair, disabled at the ends. */
/**
 * The HOUSE dashboard — what everyone's dashboard starts as.
 *
 * A starting point, not a cage: anyone can arrange their own on the dashboard
 * itself (Customise), including switching back on something switched off here.
 * Changing anything on this screen DISSOLVES every stale personal arrangement,
 * so a house change actually reaches people instead of being outvoted by an
 * old local preference — the lesson of the 2026-08-13 list-layout bug.
 *
 * A role still only sees the widgets it may open: the gate lives in
 * constants/dashboardWidgets.ts and is not negotiable from here.
 */
function DashboardTab({ draft, set }: { draft: AppSettings; set: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void }) {
  const hidden = hiddenWidgetKeys(draft.dashboardOrder, draft.dashboardHidden);
  const rows = orderedWidgetKeys(draft.dashboardOrder)
    .map((k) => ({ widget: WIDGET_BY_KEY.get(k)!, shown: !hidden.has(k) }));

  const apply = (next: DashboardLayout) => {
    set('dashboardOrder', next.order);
    set('dashboardHidden', next.hidden);
  };
  const isDefault = JSON.stringify(rows.map((r) => r.widget.key)) === JSON.stringify(DEFAULT_WIDGET_ORDER)
    && JSON.stringify([...hidden].sort()) === JSON.stringify([...DEFAULT_WIDGET_HIDDEN].sort());
  const resetAll = () => {
    set('dashboardOrder', [...DEFAULT_WIDGET_ORDER]);
    set('dashboardHidden', [...DEFAULT_WIDGET_HIDDEN]);
  };
  const off = rows.filter((r) => !r.shown).length;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 space-y-3.5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">Dashboard widgets</p>
          <button onClick={resetAll} disabled={isDefault}
            className="text-[11px] font-semibold text-slate-400 hover:text-white disabled:text-slate-700 disabled:hover:text-slate-700 transition-colors">
            Reset to default
          </button>
        </div>
        <p className="text-[11px] text-slate-500 leading-snug">
          What the Dashboard shows, and in what order, for everyone.
          <span className="text-slate-400 font-semibold"> Tick</span> a widget to include it,
          <span className="text-slate-400 font-semibold"> drag a row</span> to move it (the arrows do the same on touch).
          Each person can still arrange their own from the Dashboard’s Customise button — and changing anything here
          resets those personal arrangements, so a change made here actually reaches everyone.
          A role only ever sees the widgets it may open: the buy-side tiles never render for a sell-side login.
        </p>
        <WidgetArranger rows={rows} onChange={apply} />
        <p className="text-[11px] text-slate-600">
          {off === 0 ? 'Every widget is on.' : `${off} widget${off !== 1 ? 's' : ''} switched off for everyone.`}
        </p>
      </div>
    </div>
  );
}

function MoveArrows({ onUp, onDown, upDisabled, downDisabled, label, small }: {
  onUp: () => void; onDown: () => void; upDisabled: boolean; downDisabled: boolean; label: string; small?: boolean;
}) {
  const cls = `${small ? 'w-6 h-6' : 'w-7 h-7'} flex items-center justify-center rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition-colors`;
  const icon = small ? 'w-3 h-3' : 'w-3.5 h-3.5';
  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      <button onClick={onUp} disabled={upDisabled} aria-label={`Move ${label} up`} className={cls}>
        <svg className={icon} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
      </button>
      <button onClick={onDown} disabled={downDisabled} aria-label={`Move ${label} down`} className={cls}>
        <svg className={icon} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
      </button>
    </div>
  );
}

/** The drag grip — six dots, the universal "pick me up and drag" affordance. */
function Grip({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
      <circle cx="2" cy="2" r="1.3" /><circle cx="8" cy="2" r="1.3" />
      <circle cx="2" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" />
      <circle cx="2" cy="14" r="1.3" /><circle cx="8" cy="14" r="1.3" />
    </svg>
  );
}

/**
 * The order the daily menu groups appear in, AND the order of the entries
 * within each group. Home is pinned first (it is the wordmark's Dashboard) and
 * Admin last (configuration), so only the domain groups in between move.
 *
 * Reorder by DRAGGING — the whole row is a drag handle, dropped where the
 * pointer sits (top half = before, bottom half = after), so any position is
 * reachable. The arrows do the same for touch and keyboard, where native drag
 * isn't available. Open a group to reorder its entries. Native HTML5 DnD, the
 * same mechanism the sales editor uses — no library.
 */
function MenuOrderTab({ draft, set }: { draft: AppSettings; set: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void }) {
  // orderedNavGroups leads with Home; the reorderable rows are what follows.
  const order = orderedNavGroups(draft.menuOrder).filter((g) => g !== 'Home');
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  // Drag state: a group being dragged, or an entry (scoped to its group).
  const [dragG, setDragG] = useState<string | null>(null);
  const [overG, setOverG] = useState<string | null>(null);
  const [dragItem, setDragItem] = useState<{ group: string; href: string } | null>(null);
  const [overItem, setOverItem] = useState<string | null>(null);
  const endDrag = () => { setDragG(null); setOverG(null); setDragItem(null); setOverItem(null); };

  // A group's entries as they'll appear, honouring the stored sub-order.
  const shippedItems = (g: string) => DESTINATIONS.filter((d) => d.group === g && d.inNav);
  const itemsOf = (g: string) => orderedGroupItems(shippedItems(g), draft.menuItemOrder[g]);

  // Move `from` next to `to`, before or after by where the pointer landed.
  const reorder = (list: string[], from: string, to: string, after: boolean): string[] => {
    if (from === to) return list;
    const out = list.filter((x) => x !== from);
    let idx = out.indexOf(to);
    if (idx < 0) return list;
    if (after) idx += 1;
    out.splice(idx, 0, from);
    return out;
  };
  const dropIsAfter = (e: React.DragEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY > r.top + r.height / 2;
  };

  const moveGroup = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    set('menuOrder', next);
  };
  const moveItem = (g: string, i: number, dir: -1 | 1) => {
    const items = itemsOf(g);
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const hrefs = items.map((d) => d.href);
    [hrefs[i], hrefs[j]] = [hrefs[j], hrefs[i]];
    set('menuItemOrder', { ...draft.menuItemOrder, [g]: hrefs });
  };

  const groupsDefault = JSON.stringify(order) === JSON.stringify(DEFAULT_MENU_ORDER);
  const itemsDefault = order.every((g) =>
    JSON.stringify(itemsOf(g).map((d) => d.href)) === JSON.stringify(shippedItems(g).map((d) => d.href)));
  const isDefault = groupsDefault && itemsDefault;
  const resetAll = () => { set('menuOrder', [...DEFAULT_MENU_ORDER]); set('menuItemOrder', {}); };

  return (
    <div className="max-w-2xl space-y-4">
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 space-y-3.5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">Menu order</p>
          <button onClick={resetAll} disabled={isDefault}
            className="text-[11px] font-semibold text-slate-400 hover:text-white disabled:text-slate-700 disabled:hover:text-slate-700 transition-colors">
            Reset to default
          </button>
        </div>
        <p className="text-[11px] text-slate-500 leading-snug">
          The order the groups — and the entries inside each — appear across the menu: the wordmark dropdown, the desktop
          bar and the phone’s More sheet. <span className="text-slate-400 font-semibold">Drag a row</span> to move it
          (the arrows do the same on touch); open a group to reorder its entries.
          <span className="text-slate-400 font-semibold"> Home</span> always leads and
          <span className="text-slate-400 font-semibold"> Admin</span> (Pricing, Settings, Import &amp; Export) always
          sits last, so neither moves. A role still only sees what it may open.
        </p>

        <ol className="space-y-1.5">
          {order.map((g, i) => {
            const items = itemsOf(g);
            const isOpen = openGroup === g;
            const canExpand = items.length > 1;
            return (
              <li key={g} className="bg-slate-950/50 border border-slate-800 rounded-xl overflow-hidden">
                {/* Group header — a drag handle for the whole row (the sub-list
                    below is NOT part of it, so entry drags never conflict). */}
                <div
                  draggable
                  onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragG(g); }}
                  onDragOver={(e) => { if (dragG && dragG !== g) { e.preventDefault(); setOverG(g); } }}
                  onDragLeave={() => setOverG((o) => (o === g ? null : o))}
                  onDrop={(e) => { e.preventDefault(); if (dragG) set('menuOrder', reorder(order, dragG, g, dropIsAfter(e))); endDrag(); }}
                  onDragEnd={endDrag}
                  className={`flex items-center gap-2 px-3 py-2.5 cursor-grab active:cursor-grabbing transition-shadow ${
                    overG === g ? 'ring-2 ring-emerald-500/60' : ''} ${dragG === g ? 'opacity-40' : ''}`}>
                  <Grip className="w-2.5 h-4 text-slate-600 flex-shrink-0" />
                  <span className="text-[11px] font-bold tabular-nums text-slate-600 w-4 text-center flex-shrink-0">{i + 1}</span>
                  <button onClick={() => canExpand && setOpenGroup(isOpen ? null : g)} disabled={!canExpand}
                    className="min-w-0 flex-1 flex items-center gap-2 text-left disabled:cursor-grab">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-white">{g}</span>
                      {items.length > 0 && <span className="block text-[11px] text-slate-500 truncate">{items.map((d) => d.label).join(' · ')}</span>}
                    </span>
                    {canExpand && (
                      <svg className={`w-3.5 h-3.5 flex-shrink-0 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                    )}
                  </button>
                  <MoveArrows label={g} onUp={() => moveGroup(i, -1)} onDown={() => moveGroup(i, 1)}
                    upDisabled={i === 0} downDisabled={i === order.length - 1} />
                </div>
                {isOpen && canExpand && (
                  <ol className="border-t border-slate-800/70 bg-slate-950/40 px-3 py-2 space-y-1">
                    {items.map((d, k) => {
                      const dragging = dragItem?.group === g && dragItem.href === d.href;
                      return (
                        <li key={d.href}
                          draggable
                          onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragItem({ group: g, href: d.href }); }}
                          onDragOver={(e) => { if (dragItem?.group === g && dragItem.href !== d.href) { e.preventDefault(); setOverItem(d.href); } }}
                          onDragLeave={() => setOverItem((o) => (o === d.href ? null : o))}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (dragItem?.group === g) set('menuItemOrder', { ...draft.menuItemOrder, [g]: reorder(items.map((x) => x.href), dragItem.href, d.href, dropIsAfter(e)) });
                            endDrag();
                          }}
                          onDragEnd={endDrag}
                          className={`flex items-center gap-2 pl-3 pr-1 py-1.5 rounded-lg cursor-grab active:cursor-grabbing transition-shadow ${
                            overItem === d.href ? 'ring-2 ring-emerald-500/50' : ''} ${dragging ? 'opacity-40' : ''}`}>
                          <Grip className="w-2.5 h-4 text-slate-700 flex-shrink-0" />
                          <span className="min-w-0 flex-1 text-[13px] text-slate-300 truncate">{d.label}</span>
                          <MoveArrows small label={d.label} onUp={() => moveItem(g, k, -1)} onDown={() => moveItem(g, k, 1)}
                            upDisabled={k === 0} downDisabled={k === items.length - 1} />
                        </li>
                      );
                    })}
                  </ol>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

// ── Company ─────────────────────────────────────────────────────────────────

/** Preset payment & delivery terms the sales quotation offers as choices. */
function TermsTab({ draft, set }: { draft: AppSettings; set: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void }) {
  const listArea = (k: 'salesPaymentTermsOptions' | 'salesDeliveryTermsOptions' | 'leadTimeOptions', rows: number) => (
    <textarea rows={rows} className={`${inputCls} resize-y leading-relaxed`}
      value={draft[k].join('\n')}
      onChange={(e) => set(k, e.target.value.split('\n'))} />
  );
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 space-y-3.5">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">Payment terms</p>
        <Field label="Choices offered on a sales quotation"
          hint="One term per line. The quotation editor offers these in the Payment terms dropdown; the chosen term prints on the quotation, order confirmation and invoice.">
          {listArea('salesPaymentTermsOptions', 14)}
        </Field>
      </div>
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 space-y-3.5">
        <p className="text-xs font-bold uppercase tracking-widest text-sky-300">Delivery terms</p>
        <Field label="Choices offered on a sales quotation"
          hint="One term per line (Di antar / Di ambil sendiri / …). Prints on the quotation and order confirmation.">
          {listArea('salesDeliveryTermsOptions', 6)}
        </Field>
      </div>
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 space-y-3.5">
        <p className="text-xs font-bold uppercase tracking-widest text-violet-300">Lead times</p>
        <Field label="Choices offered on the New Deal form (buy side)"
          hint={'One per line, e.g. "120 working days". Include a number so the Incoming column can project an arrival date from the PO date; "working" makes it skip weekends.'}>
          {listArea('leadTimeOptions', 12)}
        </Field>
      </div>
    </div>
  );
}

function CompanyTab({ draft, set }: { draft: AppSettings; set: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void }) {
  const rows: [keyof AppSettings, string, string][] = [
    ['companyName',    'Company name',   'Falls back to the issuing company on the document when blank.'],
    ['companyTaxId',   'NPWP / Tax ID',  ''],
    ['companyPhone',   'Phone',          ''],
    ['companyEmail',   'Email',          ''],
  ];
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 space-y-3.5">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-violet-300">Letterhead</p>
          <p className="text-[11px] text-slate-500 mt-1">Printed at the top of the quotation, invoice and Surat Jalan.</p>
        </div>
        {rows.map(([k, label, hint]) => (
          <Field key={k as string} label={label} hint={hint}>
            <input className={inputCls} value={String(draft[k] ?? '')} onChange={(e) => set(k, e.target.value as AppSettings[typeof k])} />
          </Field>
        ))}
        <Field label="Address">
          <textarea rows={3} className={`${inputCls} resize-y leading-relaxed`} value={draft.companyAddress}
            onChange={(e) => set('companyAddress', e.target.value)} />
        </Field>
      </div>

      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 space-y-3.5">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-violet-300">Document footer</p>
          <p className="text-[11px] text-slate-500 mt-1">Printed under the totals — payment instructions and standing terms.</p>
        </div>
        <Field label="Bank details" hint="Bank, account name and number as they should appear on an invoice.">
          <textarea rows={4} className={`${inputCls} resize-y leading-relaxed`} value={draft.companyBankDetails}
            onChange={(e) => set('companyBankDetails', e.target.value)} />
        </Field>
        <Field label="Footer note" hint="Standing terms — validity, delivery, anything printed on every document.">
          <textarea rows={4} className={`${inputCls} resize-y leading-relaxed`} value={draft.documentFooterNote}
            onChange={(e) => set('documentFooterNote', e.target.value)} />
        </Field>
      </div>
    </div>
  );
}

// ── Banks ───────────────────────────────────────────────────────────────────
// The account master, grouped by the company that owns each account — each PT
// banks separately, so the company is the organising fact, not a field buried
// in a card. Within a company the order is the owner's (▲▼), and one account
// can be flagged as the default for PAYING suppliers and one for RECEIVING
// customer money; those flags are what the payment and receipt forms preselect.
// Statements, balances and corrections live on /banks.

const BANK_CURRENCIES = ['IDR', 'USD', 'EUR', 'CNY', 'SGD'];

function BanksTab({ flash, email }: { flash: (m: string) => void; email: string }) {
  const supabase = createSupabaseClient();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [companies, setCompanies] = useState<{ company_id: string; legal_name: string }[]>([]);
  const [bankNames, setBankNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const [newBank, setNewBank] = useState('');
  // What is being typed into each Bank field; the account row keeps the SAVED
  // value, so a commit can tell whether anything actually changed.
  const [bankDraft, setBankDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [accRes, coRes, nameRes] = await Promise.all([
      supabase.from('41.0_bank_accounts').select('*').order('sort_order'),
      supabase.from('1.0_companies').select('company_id, legal_name').order('legal_name'),
      supabase.from('41.2_bank_names').select('bank_name, is_active, sort_order').order('sort_order').order('bank_name'),
    ]);
    if (accRes.error) { setMissing(true); setLoading(false); return; }
    setAccounts((accRes.data as BankAccount[]) ?? []);
    setCompanies((coRes.data as { company_id: string; legal_name: string }[]) ?? []);
    setBankNames(((nameRes.data as { bank_name: string; is_active: boolean }[]) ?? [])
      .filter((b) => b.is_active !== false).map((b) => b.bank_name));
    setLoading(false);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const patch = async (a: BankAccount, p: Partial<BankAccount>) => {
    setSaving(a.bank_account_id);
    const { error } = await supabase.from('41.0_bank_accounts')
      .update({ ...p, updated_at: new Date().toISOString(), updated_by_email: email })
      .eq('bank_account_id', a.bank_account_id);
    setSaving(null);
    if (error) { flash(`Could not save — ${error.message}`); return; }
    setAccounts((prev) => prev.map((x) => (x.bank_account_id === a.bank_account_id ? { ...x, ...p } : x)));
  };

  // A new bank name joins the library as it is typed, so the next account
  // autocompletes it instead of inviting a second spelling.
  const rememberBank = async (name: string) => {
    const n = name.trim();
    if (!n || bankNames.some((b) => b.toLowerCase() === n.toLowerCase())) return;
    const { error } = await supabase.from('41.2_bank_names').insert({ bank_name: n, sort_order: 90, created_by_email: email });
    if (!error) setBankNames((prev) => [...prev, n]);
  };

  const setBankName = async (a: BankAccount, name: string) => {
    if (name === a.bank_name) return;
    await patch(a, { bank_name: name });
    rememberBank(name);
  };

  // Exactly one default of each kind per company (a partial unique index says
  // so), which means the old flag has to go before the new one lands.
  const setDefault = async (a: BankAccount, kind: 'payment' | 'receipt', on: boolean) => {
    const col = kind === 'payment' ? 'is_default_payment' : 'is_default_receipt';
    setSaving(a.bank_account_id);
    if (on) {
      const siblings = accounts.filter((x) => x.company_id === a.company_id && x.bank_account_id !== a.bank_account_id);
      if (siblings.length) {
        await supabase.from('41.0_bank_accounts').update({ [col]: false })
          .in('bank_account_id', siblings.map((x) => x.bank_account_id));
      }
    }
    const { error } = await supabase.from('41.0_bank_accounts')
      .update({ [col]: on, updated_at: new Date().toISOString(), updated_by_email: email })
      .eq('bank_account_id', a.bank_account_id);
    setSaving(null);
    if (error) { flash(`Could not save — ${error.message}`); return; }
    setAccounts((prev) => prev.map((x) => {
      if (x.bank_account_id === a.bank_account_id) return { ...x, [col]: on };
      if (on && x.company_id === a.company_id) return { ...x, [col]: false };
      return x;
    }));
    flash(on ? `Default ${kind} account for this company` : `No longer the default ${kind} account`);
  };

  // Reorder within the company — swap sort_order with the neighbour above/below
  const move = async (a: BankAccount, group: BankAccount[], dir: -1 | 1) => {
    const i = group.findIndex((x) => x.bank_account_id === a.bank_account_id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= group.length) return;
    const b = group[j];
    setSaving(a.bank_account_id);
    await Promise.all([
      supabase.from('41.0_bank_accounts').update({ sort_order: b.sort_order }).eq('bank_account_id', a.bank_account_id),
      supabase.from('41.0_bank_accounts').update({ sort_order: a.sort_order }).eq('bank_account_id', b.bank_account_id),
    ]);
    setSaving(null);
    setAccounts((prev) => prev.map((x) =>
      x.bank_account_id === a.bank_account_id ? { ...x, sort_order: b.sort_order }
        : x.bank_account_id === b.bank_account_id ? { ...x, sort_order: a.sort_order } : x));
  };

  const addAccount = async (companyId: string | null) => {
    const { error } = await supabase.from('41.0_bank_accounts').insert({
      company_id: companyId,
      bank_name: '', account_name: '', account_number: '', currency: 'IDR',
      opening_balance: 0, is_active: true,
      sort_order: accounts.reduce((m, a) => Math.max(m, a.sort_order), 0) + 1,
      created_by_email: email, updated_by_email: email,
    });
    if (error) { flash(`Could not add — ${error.message}`); return; }
    await load();
    flash('Account added — fill in the bank and number');
  };

  const remove = async (a: BankAccount) => {
    const { error } = await supabase.from('41.0_bank_accounts').delete().eq('bank_account_id', a.bank_account_id);
    if (error) { flash(`Could not delete — ${error.message} (deactivate it instead)`); return; }
    setAccounts((prev) => prev.filter((x) => x.bank_account_id !== a.bank_account_id));
    flash('Account removed');
  };

  const addBankName = async () => {
    const n = newBank.trim();
    if (!n) return;
    if (bankNames.some((b) => b.toLowerCase() === n.toLowerCase())) { flash('Already in the library'); return; }
    const { error } = await supabase.from('41.2_bank_names').insert({ bank_name: n, sort_order: 90, created_by_email: email });
    if (error) { flash(`Could not add — ${error.message}`); return; }
    setBankNames((prev) => [...prev, n]);
    setNewBank('');
  };

  const removeBankName = async (n: string) => {
    const inUse = accounts.filter((a) => (a.bank_name ?? '').toLowerCase() === n.toLowerCase()).length;
    if (inUse) { flash(`${n} is on ${inUse} account${inUse !== 1 ? 's' : ''} — rename those first`); return; }
    const { error } = await supabase.from('41.2_bank_names').delete().eq('bank_name', n);
    if (error) { flash(`Could not remove — ${error.message}`); return; }
    setBankNames((prev) => prev.filter((b) => b !== n));
  };

  // ── Grouped by company, companies alphabetical, accounts in the owner's order
  const groups = useMemo(() => {
    const byId = new Map(companies.map((c) => [c.company_id, c.legal_name]));
    const map = new Map<string, BankAccount[]>();
    for (const a of accounts) {
      const key = a.company_id ?? '';
      (map.get(key) ?? map.set(key, []).get(key)!).push(a);
    }
    const out = [...map.entries()].map(([id, list]) => ({
      companyId: id || null,
      name: byId.get(id) ?? 'No company',
      list: [...list].sort((x, y) => (x.sort_order - y.sort_order) || x.bank_name.localeCompare(y.bank_name)),
    }));
    // Companies with no account yet still get a section, so adding one is obvious
    for (const c of companies) {
      if (!map.has(c.company_id)) out.push({ companyId: c.company_id, name: c.legal_name, list: [] });
    }
    return out.sort((a, b) => {
      if (!a.companyId) return 1;      // "No company" last
      if (!b.companyId) return -1;
      return a.name.localeCompare(b.name);
    });
  }, [accounts, companies]);

  if (missing) {
    return (
      <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-4 text-xs text-amber-200">
        Bank tables are not set up yet — run <span className="font-mono">migrations/create_bank_accounts.sql</span> in Supabase → SQL Editor.
      </div>
    );
  }
  if (loading) return <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-slate-800/40 rounded-2xl animate-pulse" />)}</div>;

  return (
    <div className="space-y-5">
      <div className="bg-sky-500/[0.07] border border-sky-500/25 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <p className="text-xs text-sky-100/90 leading-relaxed">
          <span className="font-bold">Accounts here, money on Banks.</span> Accounts are grouped by the company that owns
          them. Flag one account per company as the default for <span className="font-semibold">paying</span> suppliers and
          one for <span className="font-semibold">receiving</span> customer money — the payment and receipt forms preselect them.
        </p>
        <Link href="/banks" className="text-xs font-semibold text-sky-300 hover:text-sky-200 whitespace-nowrap px-3 py-1.5 rounded-lg border border-sky-500/30 hover:bg-sky-500/10 transition-colors">
          Open Banks →
        </Link>
      </div>

      {groups.map((g) => (
        <section key={g.companyId ?? 'none'} className="space-y-3">
          <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 pb-2">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white truncate">{g.name}</h3>
              <p className="text-[11px] text-slate-600">
                {g.list.length === 0 ? 'No accounts yet' : `${g.list.length} account${g.list.length !== 1 ? 's' : ''}`}
                {g.list.some((a) => a.is_default_payment) ? '' : g.list.length ? ' · no default for payments' : ''}
                {g.list.some((a) => a.is_default_receipt) ? '' : g.list.length ? ' · no default for receipts' : ''}
              </p>
            </div>
            <button onClick={() => addAccount(g.companyId)}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors whitespace-nowrap">
              + Add account
            </button>
          </div>

          {g.list.length === 0 ? (
            <p className="text-[11px] text-slate-600 px-1">Nothing banked under this company yet.</p>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {g.list.map((a, i) => (
                <div key={a.bank_account_id}
                  className={`bg-slate-900/50 border rounded-2xl p-4 space-y-3 transition-colors ${a.is_active ? 'border-slate-800' : 'border-slate-800/40 opacity-60'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {/* Ranking within the company */}
                      <div className="flex flex-col -my-1 flex-shrink-0">
                        <button onClick={() => move(a, g.list, -1)} disabled={i === 0}
                          className="text-slate-600 hover:text-white disabled:opacity-20 leading-none text-[10px] px-1 py-0.5 transition-colors" title="Move up">▲</button>
                        <button onClick={() => move(a, g.list, 1)} disabled={i === g.list.length - 1}
                          className="text-slate-600 hover:text-white disabled:opacity-20 leading-none text-[10px] px-1 py-0.5 transition-colors" title="Move down">▼</button>
                      </div>
                      <p className="text-sm font-bold text-white truncate">{accountLabel(a)}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {saving === a.bank_account_id && <div className="w-3.5 h-3.5 border border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />}
                      <label className="flex items-center gap-1.5 text-[10px] text-slate-500 cursor-pointer select-none">
                        <input type="checkbox" checked={a.is_active} onChange={(e) => patch(a, { is_active: e.target.checked })} className="accent-emerald-500 w-3.5 h-3.5" />
                        Active
                      </label>
                    </div>
                  </div>

                  {/* Defaults — what the payment and receipt forms preselect */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => setDefault(a, 'payment', !a.is_default_payment)}
                      title="Preselected when this company pays a supplier"
                      className={`text-[11px] px-2.5 py-1 rounded-lg border font-semibold transition-colors ${
                        a.is_default_payment ? 'bg-sky-500/15 border-sky-500/40 text-sky-300' : 'border-slate-700 text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                      }`}>
                      {a.is_default_payment ? '✓ ' : ''}Default for payments
                    </button>
                    <button onClick={() => setDefault(a, 'receipt', !a.is_default_receipt)}
                      title="Preselected when a customer payment is recorded for this company"
                      className={`text-[11px] px-2.5 py-1 rounded-lg border font-semibold transition-colors ${
                        a.is_default_receipt ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'border-slate-700 text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                      }`}>
                      {a.is_default_receipt ? '✓ ' : ''}Default for receipts
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Bank" hint="Autocompletes from the library below.">
                      <Autocomplete value={bankDraft[a.bank_account_id] ?? a.bank_name} suggestions={bankNames} placeholder="BCA"
                        inputClassName={inputCls}
                        onChange={(v) => setBankDraft((d) => ({ ...d, [a.bank_account_id]: v }))}
                        onCommit={(v) => setBankName(a, v)} />
                    </Field>
                    <Field label="Account number">
                      <input className={`${inputCls} font-mono`} defaultValue={a.account_number} placeholder="0123456789"
                        onBlur={(e) => { if (e.target.value !== a.account_number) patch(a, { account_number: e.target.value }); }} />
                    </Field>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Account name" hint="As it appears on a transfer.">
                      <input className={inputCls} defaultValue={a.account_name}
                        onBlur={(e) => { if (e.target.value !== a.account_name) patch(a, { account_name: e.target.value }); }} />
                    </Field>
                    <Field label="Currency">
                      <select className={inputCls} value={a.currency} onChange={(e) => patch(a, { currency: e.target.value })}>
                        {BANK_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </Field>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Opening balance" hint="Where the statement starts. Later corrections are recorded on Banks.">
                      <input className={`${inputCls} text-right tabular-nums`} defaultValue={String(a.opening_balance ?? 0)} inputMode="decimal"
                        onBlur={(e) => {
                          const v = Number(String(e.target.value).replace(/[, ]/g, ''));
                          if (!isNaN(v) && v !== Number(a.opening_balance)) patch(a, { opening_balance: v });
                        }} />
                    </Field>
                    <Field label="Opening date">
                      <input type="date" className={inputCls} defaultValue={a.opening_date ?? ''}
                        onBlur={(e) => { if (e.target.value !== (a.opening_date ?? '')) patch(a, { opening_date: e.target.value || null }); }} />
                    </Field>
                  </div>

                  <div className="flex items-center justify-between pt-1 gap-3">
                    <select className="text-[11px] bg-transparent text-slate-600 hover:text-slate-400 focus:outline-none cursor-pointer max-w-[60%] truncate"
                      value={a.company_id ?? ''} onChange={(e) => patch(a, { company_id: e.target.value || null })}
                      title="Move this account to another company">
                      <option value="">Move to: no company</option>
                      {companies.map((c) => <option key={c.company_id} value={c.company_id}>Move to: {c.legal_name}</option>)}
                    </select>
                    <button onClick={() => remove(a)} className="text-[11px] text-slate-600 hover:text-rose-400 transition-colors flex-shrink-0"
                      title="Only possible while nothing references the account — otherwise untick Active">
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}

      {/* ── Bank library ─────────────────────────────────────────────────── */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
        <button onClick={() => setLibOpen((o) => !o)} className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-white/[0.02] transition-colors">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-300">Bank library</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {bankNames.length} bank{bankNames.length !== 1 ? 's' : ''} — what the Bank field suggests, so one bank never
              becomes three spellings. A name typed on an account joins the list automatically.
            </p>
          </div>
          <span className="text-slate-500 text-xs flex-shrink-0">{libOpen ? 'Hide' : 'Show'}</span>
        </button>
        {libOpen && (
          <div className="border-t border-slate-800/60 p-4 space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <input value={newBank} onChange={(e) => setNewBank(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addBankName(); }}
                placeholder="Add a bank — e.g. BNI" className={`${inputCls} sm:flex-1`} />
              <button onClick={addBankName} disabled={!newBank.trim()}
                className="text-xs font-bold px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-white transition-colors whitespace-nowrap">
                Add
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {bankNames.map((b) => {
                const uses = accounts.filter((a) => (a.bank_name ?? '').toLowerCase() === b.toLowerCase()).length;
                return (
                  <span key={b} className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg border border-slate-700 text-slate-300">
                    {b}
                    {uses > 0 && <span className="text-slate-600">×{uses}</span>}
                    <button onClick={() => removeBankName(b)} className="text-slate-600 hover:text-rose-400 transition-colors" title={uses ? 'In use — rename those accounts first' : 'Remove from the library'}>×</button>
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Users (absorbed from the old /admin page) ───────────────────────────────

interface AllowRow { email: string; role: UserRole }

function UsersTab({ myId, flash }: { myId: string; flash: (m: string) => void }) {
  const supabase = createSupabaseClient();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [allow, setAllow] = useState<AllowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingUser, setSavingUser] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('viewer');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [uRes, aRes] = await Promise.all([
      supabase.from('user_profiles').select('*').order('created_at', { ascending: true }),
      supabase.from('allowed_emails').select('email, role').order('email'),
    ]);
    setUsers((uRes.data as UserProfile[]) ?? []);
    setAllow((aRes.data as AllowRow[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const signedUp = useMemo(() => new Set(users.map((u) => u.email.toLowerCase())), [users]);

  // The account role and the allowlist role are two rows for one person —
  // change either and the other must follow, or the two panels drift apart
  // (the allowlist would keep showing the invite-time role forever).
  const updateRole = async (userId: string, role: UserRole) => {
    setSavingUser(userId);
    const { error } = await supabase.from('user_profiles').update({ role }).eq('id', userId);
    setSavingUser(null);
    if (error) { flash(`Could not update — ${error.message}`); return; }
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)));
    const email = users.find((u) => u.id === userId)?.email.toLowerCase();
    if (email) {
      const allowRow = allow.find((a) => a.email.toLowerCase() === email);
      await supabase.from('allowed_emails').upsert({ email: allowRow?.email ?? email, role }, { onConflict: 'email' });
      setAllow((prev) => prev.some((a) => a.email.toLowerCase() === email)
        ? prev.map((a) => (a.email.toLowerCase() === email ? { ...a, role } : a))
        : [...prev, { email, role }].sort((a, b) => a.email.localeCompare(b.email)));
    }
    flash('Role updated');
  };

  const updateName = async (userId: string, display_name: string) => {
    await supabase.from('user_profiles').update({ display_name }).eq('id', userId);
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, display_name } : u)));
  };

  // Granting access = an allowlist row (the sign-up trigger reads it) PLUS a
  // role sync if that person already has a profile — otherwise the invite only
  // takes effect for someone who has never signed in.
  const addAllow = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    setAdding(true);
    const { error } = await supabase.from('allowed_emails').upsert({ email, role: newRole }, { onConflict: 'email' });
    if (!error && signedUp.has(email)) {
      const existing = users.find((u) => u.email.toLowerCase() === email);
      if (existing) await supabase.from('user_profiles').update({ role: newRole }).eq('id', existing.id);
    }
    setAdding(false);
    if (error) { flash(`Could not add — ${error.message}`); return; }
    setNewEmail('');
    await load();
    flash(`${email} can now sign in as ${ROLE_LABELS[newRole]}`);
  };

  // Mirrors updateRole: the header promises that changing an allowlisted role
  // also updates an existing account, so make that true. Your own account is
  // the one exception — demoting yourself from the allowlist row would lock
  // you out of this very screen.
  const setAllowRole = async (email: string, role: UserRole) => {
    const { error } = await supabase.from('allowed_emails').update({ role }).eq('email', email);
    if (error) { flash(`Could not update — ${error.message}`); return; }
    setAllow((prev) => prev.map((a) => (a.email === email ? { ...a, role } : a)));
    const existing = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (!existing) { flash('Allowlist updated — applies when they sign up'); return; }
    if (existing.id === myId) { flash('Allowlist updated — your own account role stays as it is'); return; }
    const { error: accErr } = await supabase.from('user_profiles').update({ role }).eq('id', existing.id);
    if (accErr) { flash(`Allowlist updated, but their account could not follow — ${accErr.message}`); return; }
    setUsers((prev) => prev.map((u) => (u.id === existing.id ? { ...u, role } : u)));
    flash('Role updated — allowlist and account');
  };

  const removeAllow = async (email: string) => {
    const { error } = await supabase.from('allowed_emails').delete().eq('email', email);
    if (error) { flash(`Could not remove — ${error.message}`); return; }
    setAllow((prev) => prev.filter((a) => a.email !== email));
    flash(`${email} removed from the allowlist`);
  };

  if (loading) return <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-slate-800/40 rounded-2xl animate-pulse" />)}</div>;

  return (
    <div className="space-y-5">
      {/* Role legend */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {ASSIGNABLE_ROLES.map((role) => (
          <div key={role} className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
            <p className="text-xs font-bold text-slate-200 mb-0.5">{ROLE_LABELS[role]}</p>
            <p className="text-[11px] text-slate-500 leading-snug">{ROLE_DESCRIPTIONS[role]}</p>
          </div>
        ))}
      </div>

      {/* ── Permission matrix — read straight off ROLE_PERMISSIONS, so what
             this table says IS what the code enforces; it cannot drift. ── */}
      <details className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden group">
        <summary className="px-4 py-3 cursor-pointer flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-400 hover:text-slate-200 transition-colors list-none">
          <svg className="w-3.5 h-3.5 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          What each role can see and do
        </summary>
        <div className="overflow-x-auto border-t border-slate-800">
          <table className="w-full min-w-[760px] text-[11px]">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] uppercase tracking-widest text-slate-500">
                <th className="text-left px-4 py-2 font-semibold min-w-[16rem]">Capability</th>
                {ASSIGNABLE_ROLES.map((r) => (
                  <th key={r} className="px-2 py-2 font-semibold text-center whitespace-nowrap" title={ROLE_DESCRIPTIONS[r]}>{ROLE_LABELS[r]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_MATRIX.map(({ group, rows }) => (
                <Fragment key={group}>
                  <tr className="bg-slate-950/50">
                    <td colSpan={1 + ASSIGNABLE_ROLES.length} className="px-4 py-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-600">{group}</td>
                  </tr>
                  {rows.map(({ key, label }) => (
                    <tr key={key} className="border-b border-slate-800/40 hover:bg-slate-800/20 transition-colors">
                      <td className="px-4 py-1.5 text-slate-400">{label}</td>
                      {ASSIGNABLE_ROLES.map((r) => {
                        const on = ROLE_PERMISSIONS[r][key] as boolean;
                        return (
                          <td key={r} className="px-2 py-1.5 text-center">
                            {on
                              ? <span className="text-emerald-400 font-bold">✓</span>
                              : <span className="text-slate-700">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2.5 text-[10px] text-slate-600 border-t border-slate-800/60">
          This table is generated from the same permission flags the pages enforce — changing a role's access is a code
          change, and this view updates with it automatically.
        </p>
      </details>

      {/* Signed-in users */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            {users.length} user{users.length !== 1 ? 's' : ''}
          </p>
          <p className="text-[11px] text-slate-600">New users appear here after their first sign-in</p>
        </div>
        {users.length === 0 ? (
          <div className="px-4 py-8 text-center text-slate-600 text-sm">No users yet</div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {users.map((u) => (
              <div key={u.id} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-slate-300 flex-shrink-0 uppercase">
                  {(u.display_name || u.email).charAt(0)}
                </div>
                <div className="flex-1 min-w-[140px]">
                  <p className="text-sm text-white truncate">{u.email}</p>
                  <input
                    defaultValue={u.display_name ?? ''}
                    onBlur={(e) => { if (e.target.value !== u.display_name) updateName(u.id, e.target.value); }}
                    placeholder="Add display name…"
                    className="text-[11px] text-slate-500 bg-transparent focus:outline-none focus:text-slate-300 placeholder-slate-700 w-full"
                  />
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
                  {u.id === myId && <span className="text-[10px] text-emerald-500/70 font-semibold">You</span>}
                  <select
                    value={u.role}
                    disabled={savingUser === u.id || u.id === myId}
                    onChange={(e) => updateRole(u.id, e.target.value as UserRole)}
                    className="text-xs bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 disabled:opacity-50 cursor-pointer"
                  >
                    {/* A legacy role stays listed while someone still carries it */}
                    {(ASSIGNABLE_ROLES.includes(u.role) ? ASSIGNABLE_ROLES : [...ASSIGNABLE_ROLES, u.role]).map((r) => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                  {savingUser === u.id && <div className="w-3.5 h-3.5 border border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sign-up allowlist */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Sign-up allowlist</p>
          <p className="text-[11px] text-slate-600 mt-1">
            Only these addresses can create an account, and each one lands on the role set here. Changing a role for
            somebody who has already signed in updates their account too.
          </p>
        </div>

        <div className="px-4 py-3 border-b border-slate-800/60 flex flex-col sm:flex-row gap-2">
          <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addAllow(); }}
            placeholder="name@company.com" className={`${inputCls} sm:flex-1`} />
          <select value={newRole} onChange={(e) => setNewRole(e.target.value as UserRole)} className={`${inputCls} sm:w-56`}>
            {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
          <button onClick={addAllow} disabled={!newEmail.trim() || adding}
            className="text-xs font-bold px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-white transition-colors whitespace-nowrap">
            {adding ? 'Adding…' : 'Grant access'}
          </button>
        </div>

        {allow.length === 0 ? (
          <div className="px-4 py-8 text-center text-slate-600 text-sm">
            Nobody is allowlisted — no new account can be created.
          </div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {allow.map((a) => (
              <div key={a.email} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <div className="flex-1 min-w-[150px]">
                  <p className="text-sm text-slate-200 truncate">{a.email}</p>
                  <p className="text-[10px] text-slate-600">
                    {signedUp.has(a.email.toLowerCase()) ? 'Signed up' : 'Invited — has not signed in yet'}
                  </p>
                </div>
                <select value={a.role}
                  onChange={(e) => setAllowRole(a.email, e.target.value as UserRole)}
                  className="text-xs bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 cursor-pointer ml-auto">
                  {(ASSIGNABLE_ROLES.includes(a.role) ? ASSIGNABLE_ROLES : [...ASSIGNABLE_ROLES, a.role]).map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
                <button onClick={() => removeAllow(a.email)}
                  className="text-[11px] text-slate-600 hover:text-rose-400 px-2 py-1 transition-colors">
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

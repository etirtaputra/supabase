'use client';
import { useMemo, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { useAuth } from '@/hooks/useAuth';
import CommandPalette from '@/components/ui/CommandPalette';
import BrandMenu from '@/components/ui/BrandMenu';
import { PRINCIPAL_CATS } from '@/constants/costCategories';

// ── Formatting ──────────────────────────────────────────────────────────────
const fmtCompact = (n: number) =>
  n >= 1_000_000_000 ? `${(n / 1_000_000_000).toFixed(2)}B`
  : n >= 1_000_000   ? `${(n / 1_000_000).toFixed(1)}M`
  : Math.round(n).toLocaleString('en-US');
const fmtIdr = (n: number) => `IDR ${fmtCompact(n)}`;
const fmtMoney = (n: number, ccy: string) => `${ccy} ${fmtCompact(n)}`;

function fmtDate(d?: string | null) {
  if (!d) return '';
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}
function humanize(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
function today() { return new Date().toISOString().slice(0, 10); }
function thisMonth() { return new Date().toISOString().slice(0, 7); }

const dealLookupHref = (n: string) => `/catalog?tab=lookup&q=${encodeURIComponent(n)}`;

interface ProjectQuoteLite {
  quote_id: string; quote_number: string; quote_date: string;
  customer_name: string; status: string; created_at?: string; updated_at?: string;
}

// Most-recent-activity key: prefer updated_at, fall back to created/business date
const recencyKey = (updated?: string | null, created?: string | null, biz?: string | null) =>
  (updated || created || biz || '') as string;

const PQ_STATUS: Record<string, string> = {
  draft: 'text-slate-400', sent: 'text-blue-300',
  accepted: 'text-emerald-300', rejected: 'text-red-400',
};

export default function Home() {
  const router = useRouter();
  const supabase = createSupabaseClient();
  const { user, loading: authLoading } = useAuth();
  const { data, loading } = useSupabaseData();
  const [projectQuotes, setProjectQuotes] = useState<ProjectQuoteLite[]>([]);
  const [stockValue, setStockValue] = useState<number | null>(null);

  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '');
  const modKey = isMac ? '⌘' : 'Ctrl';

  useEffect(() => { document.title = 'Dashboard | ICAPROC'; }, []);

  // PO values and payment status are sensitive — sign-in required
  useEffect(() => {
    if (!authLoading && !user) router.replace('/login?next=/');
  }, [authLoading, user, router]);

  // Project quotes live in the Quotes app tables (not in useSupabaseData)
  useEffect(() => {
    if (!user) return;
    supabase.from('10.0_project_quotes')
      .select('quote_id, quote_number, quote_date, customer_name, status, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .then(({ data }) => setProjectQuotes((data as ProjectQuoteLite[]) ?? []));
    // Warehouse value = Σ on-hand × moving-avg landed cost (30.1 balances)
    supabase.from('30.1_stock_balances')
      .select('qty_on_hand, avg_cost_idr')
      .then(({ data, error }) => {
        if (error || !data) { setStockValue(0); return; }
        setStockValue(data.reduce((s, b) => s + (Number(b.qty_on_hand) || 0) * (Number(b.avg_cost_idr) || 0), 0));
      });
  }, [user]);

  // ── Lookups ─────────────────────────────────────────────────────────────
  const supById = useMemo(
    () => new Map(data.suppliers.map((s) => [s.supplier_id as string, s])),
    [data.suppliers]);
  const quoteById = useMemo(
    () => new Map(data.quotes.map((q) => [String(q.quote_id), q])),
    [data.quotes]);
  const poById = useMemo(
    () => new Map(data.pos.map((p) => [String(p.po_id), p])),
    [data.pos]);

  const supplierForPo = (po: (typeof data.pos)[number]) => {
    if (po.supplier_id && supById.has(po.supplier_id)) return supById.get(po.supplier_id);
    const q = po.quote_id != null ? quoteById.get(String(po.quote_id)) : null;
    return q?.supplier_id ? supById.get(q.supplier_id) : undefined;
  };

  // ── Per-PO payment status ─────────────────────────────────────────────────
  const poStatus = useMemo(() => {
    const r: Record<string, { totalIdr: number; paidIdr: number; pct: number }> = {};
    for (const po of data.pos) {
      const val = Number(po.total_value) || 0;
      const xr  = Number(po.exchange_rate) || 1;
      const totalIdr = po.currency === 'IDR' ? val : val * xr;
      const paidIdr = data.poCosts
        .filter((c) => String(c.po_id) === String(po.po_id) && PRINCIPAL_CATS.has(c.cost_category))
        .reduce((s, c) => s + (c.currency === 'IDR' ? Number(c.amount) : Number(c.amount) * xr), 0);
      r[String(po.po_id)] = { totalIdr, paidIdr, pct: totalIdr > 0 ? Math.min(100, (paidIdr / totalIdr) * 100) : 0 };
    }
    return r;
  }, [data.pos, data.poCosts]);

  const poCode = useMemo(() => {
    const r: Record<string, string> = {};
    for (const po of data.pos) {
      const s = supplierForPo(po);
      if (s?.supplier_code) r[String(po.po_id)] = s.supplier_code as string;
    }
    return r;
  }, [data.pos, supById, quoteById]);

  // ── KPI stats ─────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const monthStr = thisMonth();
    const activePOs = data.pos.filter((p) => p.status !== 'Cancelled');
    const outstandingIdr = activePOs.reduce((s, p) => {
      const { totalIdr, paidIdr } = poStatus[String(p.po_id)] ?? { totalIdr: 0, paidIdr: 0 };
      return s + Math.max(0, totalIdr - paidIdr);
    }, 0);
    const paidThisMonthIdr = data.poCosts
      .filter((c) => c.payment_date?.startsWith(monthStr) && PRINCIPAL_CATS.has(c.cost_category))
      .reduce((s, c) => {
        const xr = Number(c.exchange_rate) || Number(poById.get(String(c.po_id))?.exchange_rate) || 1;
        return s + (c.currency === 'IDR' ? Number(c.amount) : Number(c.amount) * xr);
      }, 0);
    return {
      activePOs: activePOs.length,
      outstandingIdr,
      paidThisMonthIdr,
      componentCount: data.components.length,
    };
  }, [data, poStatus, poById]);

  // ── Recent feeds ──────────────────────────────────────────────────────────
  // All feeds order by most-recent activity (updated_at first), newest on top.
  // localeCompare keeps ties (e.g. missing timestamps) in their incoming order.
  const byRecency = <T,>(get: (o: T) => string) => (a: T, b: T) => get(b).localeCompare(get(a));

  const recentComponents = useMemo(
    () => [...data.components]
      .sort(byRecency((c) => recencyKey(c.updated_at, c.created_at)))
      .slice(0, 10),
    [data.components]);

  const recentSupplierQuotes = useMemo(
    () => [...data.quotes]
      .sort(byRecency((q) => recencyKey(q.updated_at, q.created_at, q.quote_date)))
      .slice(0, 10),
    [data.quotes]);

  const recentPos = useMemo(
    () => [...data.pos]
      .sort(byRecency((p) => recencyKey(p.updated_at, p.created_at, p.po_date)))
      .slice(0, 10),
    [data.pos]);

  const recentPayments = useMemo(
    () => data.poCosts
      .filter((c) => c.payment_date || c.updated_at)
      .sort(byRecency((c) => recencyKey(c.updated_at, c.created_at, c.payment_date)))
      .slice(0, 10),
    [data.poCosts]);

  const recentProjectQuotes = useMemo(() => projectQuotes.slice(0, 10), [projectQuotes]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-[#141518] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1012] text-slate-200 font-sans text-sm">
      {/* ── Header ── */}
      <div className="border-b border-slate-800/60 bg-[#0f1012]/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 py-4 flex items-center justify-between gap-4">
          <BrandMenu
            wordmarkClass="text-xl md:text-2xl font-extrabold"
            subtitle={new Date().toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
          />
        </div>
      </div>

      <main className="max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 py-8 xl:py-10 space-y-8">

        {/* ── Spotlight hero (inline, searches in place — no popup) ── */}
        <div className="relative flex flex-col items-center pt-4 pb-2">
          <div className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 w-[520px] max-w-full h-40 bg-emerald-500/10 blur-3xl rounded-full" />
          <CommandPalette variant="inline" />
          <p className="mt-3 text-[11px] text-slate-600 text-center px-4">
            <span className="hidden sm:inline">Press <span className="text-slate-400 font-medium">{modKey} + I</span> anywhere for Spotlight — </span>
            <span className="sm:hidden">Tap to search — </span>
            jump to any vendor, deal, or item
          </p>
        </div>

        {/* ── KPI row ── */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 xl:gap-5">
          {[
            { label: 'Outstanding', value: loading ? '—' : fmtIdr(stats.outstandingIdr), sub: 'unpaid across active POs',
              color: stats.outstandingIdr > 0 ? 'text-amber-300' : 'text-emerald-300',
              ring: stats.outstandingIdr > 0 ? 'ring-amber-500/20' : 'ring-emerald-500/20' },
            { label: 'Paid This Month', value: loading ? '—' : fmtIdr(stats.paidThisMonthIdr),
              sub: new Date().toLocaleDateString('en-US', { month: 'long' }), color: 'text-rose-300', ring: 'ring-rose-500/20' },
            { label: 'Stock Value', value: stockValue == null ? '—' : fmtIdr(stockValue), sub: 'on-hand × avg landed cost', color: 'text-violet-300', ring: 'ring-violet-500/20' },
            { label: 'Active POs', value: loading ? '—' : stats.activePOs.toString(), sub: 'not cancelled', color: 'text-sky-300', ring: 'ring-sky-500/20' },
            { label: 'Components', value: loading ? '—' : stats.componentCount.toLocaleString('en-US'), sub: 'in catalog', color: 'text-emerald-300', ring: 'ring-emerald-500/20' },
          ].map(({ label, value, sub, color, ring }) => (
            <div key={label} className={`bg-slate-900/60 border border-slate-800/80 ring-1 ${ring} rounded-2xl p-4 xl:p-5`}>
              <p className="text-[10px] xl:text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">{label}</p>
              <p className={`text-2xl xl:text-3xl font-extrabold tabular-nums ${color} leading-none`}>{value}</p>
              <p className="text-[11px] text-slate-600 mt-1.5">{sub}</p>
            </div>
          ))}
        </div>

        {/* ── Recent feeds ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">

          {/* Recent Components */}
          <FeedPanel title="Recent Components" accent="emerald" href="/catalog" loading={loading} empty={recentComponents.length === 0} icon={ICONS.cube}>
            {recentComponents.map((c) => (
              <FeedRow key={c.component_id} href={`/insights?tab=lookup&q=${encodeURIComponent(c.supplier_model ?? '')}`} accent="emerald"
                title={c.supplier_model || '(no model)'}
                sub={[c.brand, c.category].filter(Boolean).join(' · ') || '—'}
                right={fmtDate(c.updated_at || c.created_at)} />
            ))}
          </FeedPanel>

          {/* Recent Project Quotes */}
          <FeedPanel title="Recent Project Quotes" accent="violet" href="/quotes" loading={loading} empty={recentProjectQuotes.length === 0} icon={ICONS.doc}>
            {recentProjectQuotes.map((q) => (
              <FeedRow key={q.quote_id} href={`/quotes/${q.quote_id}`} accent="violet"
                title={q.quote_number || '(no number)'}
                sub={<span>{q.customer_name || 'No customer'} · <span className={PQ_STATUS[q.status] ?? 'text-slate-400'}>{(q.status || 'draft').toUpperCase()}</span></span>}
                right={fmtDate(q.updated_at || q.created_at || q.quote_date)} />
            ))}
          </FeedPanel>

          {/* Recent Supplier Quotes (PI) */}
          <FeedPanel title="Recent Supplier Quotes" accent="blue" href="/catalog?tab=lookup" loading={loading} empty={recentSupplierQuotes.length === 0} icon={ICONS.tag}>
            {recentSupplierQuotes.map((q) => {
              const sup = q.supplier_id ? supById.get(q.supplier_id) : undefined;
              return (
                <FeedRow key={String(q.quote_id)} href={dealLookupHref((q.pi_number as string) || String(q.quote_id))} accent="blue"
                  title={(q.pi_number as string) || `Quote #${q.quote_id}`}
                  sub={[sup?.supplier_name, q.status].filter(Boolean).join(' · ') || '—'}
                  right={q.total_value ? fmtMoney(Number(q.total_value), q.currency) : fmtDate(q.quote_date)} />
              );
            })}
          </FeedPanel>

          {/* Recent POs */}
          <FeedPanel title="Recent Purchase Orders" accent="amber" href="/catalog?tab=lookup" loading={loading} empty={recentPos.length === 0} icon={ICONS.clipboard}>
            {recentPos.map((po) => {
              const key = String(po.po_id);
              const { pct, totalIdr } = poStatus[key] ?? { pct: 0, totalIdr: 0 };
              const code = poCode[key];
              return (
                <FeedRow key={key} href={dealLookupHref(po.po_number || po.pi_number || key)} accent="amber"
                  badge={code}
                  title={po.pi_number || po.po_number || `PO ${po.po_id}`}
                  sub={supplierForPo(po)?.supplier_name || po.po_date || '—'}
                  right={totalIdr > 0
                    ? <PctBar pct={pct} />
                    : <span className="text-[10px] text-slate-600">no value</span>} />
              );
            })}
          </FeedPanel>

          {/* Recent Payments */}
          <FeedPanel title="Recent Payments" accent="rose" href="/catalog?tab=financials" loading={loading} empty={recentPayments.length === 0} icon={ICONS.cash}>
            {recentPayments.map((c) => {
              const po = poById.get(String(c.po_id));
              const isFee = !PRINCIPAL_CATS.has(c.cost_category);
              return (
                <FeedRow key={c.cost_id} href={dealLookupHref(po?.po_number || po?.pi_number || String(c.po_id))} accent="rose"
                  title={fmtMoney(Number(c.amount), c.currency)}
                  titleClass={isFee ? 'text-slate-300' : 'text-rose-200'}
                  sub={<span>{humanize(c.cost_category)}{po ? <span className="text-slate-600"> · {po.pi_number || po.po_number}</span> : null}</span>}
                  right={fmtDate(c.payment_date)} />
              );
            })}
          </FeedPanel>

          {/* Quick actions (text only, no emoji) */}
          <div className="bg-slate-900/40 border border-slate-800/80 ring-1 ring-white/5 rounded-2xl p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-3">Quick Actions</p>
            <div className="space-y-2">
              {[
                { href: '/catalog?tab=quoting',    label: 'Enter Supplier Quote / PI', accent: 'blue' },
                { href: '/catalog?tab=ordering',   label: 'Create Purchase Order',      accent: 'amber' },
                { href: '/catalog?tab=financials', label: 'Log Payment',                accent: 'rose' },
                { href: '/quotes',                 label: 'New Project Quote',          accent: 'violet' },
              ].map(({ href, label, accent }) => (
                <Link key={href} href={href}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-800/30 hover:bg-slate-800/60 border border-transparent hover:border-slate-700 transition-colors group">
                  <span className={`w-1.5 h-1.5 rounded-full ${DOT[accent]}`} />
                  <span className="text-sm text-slate-300 group-hover:text-white transition-colors">{label}</span>
                  <span className="ml-auto text-slate-700 group-hover:text-slate-400 transition-colors">→</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// ── Accent maps ───────────────────────────────────────────────────────────────
const DOT: Record<string, string> = {
  emerald: 'bg-emerald-400', violet: 'bg-violet-400', blue: 'bg-blue-400',
  amber: 'bg-amber-400', rose: 'bg-rose-400',
};
const ACCENT_TEXT: Record<string, string> = {
  emerald: 'text-emerald-300', violet: 'text-violet-300', blue: 'text-blue-300',
  amber: 'text-amber-300', rose: 'text-rose-300',
};
const ACCENT_TILE: Record<string, string> = {
  emerald: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  violet: 'bg-violet-500/10 text-violet-300 border-violet-500/20',
  blue: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
  amber: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  rose: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
};

// ── Inline icons (no emoji) ─────────────────────────────────────────────────
const ICONS = {
  cube: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  doc: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  tag: 'M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4z',
  clipboard: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  cash: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z',
};

// ── Feed panel ────────────────────────────────────────────────────────────────
function FeedPanel({
  title, accent, href, icon, loading, empty, children,
}: {
  title: string; accent: string; href: string; icon: string;
  loading: boolean; empty: boolean; children: React.ReactNode;
}) {
  return (
    <div className="bg-slate-900/40 border border-slate-800/80 ring-1 ring-white/5 rounded-2xl p-5 flex flex-col">
      <div className="flex items-center gap-2.5 mb-3">
        <span className={`w-7 h-7 rounded-lg border flex items-center justify-center flex-shrink-0 ${ACCENT_TILE[accent]}`}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d={icon} /></svg>
        </span>
        <h2 className="text-sm font-bold text-white flex-1">{title}</h2>
        <Link href={href} className={`text-[11px] ${ACCENT_TEXT[accent]} opacity-50 hover:opacity-100 transition-opacity`}>
          View all →
        </Link>
      </div>
      {loading ? (
        <div className="space-y-1.5">{[...Array(6)].map((_, i) => <div key={i} className="h-11 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>
      ) : empty ? (
        <p className="text-slate-600 text-xs italic py-6 text-center">Nothing recent.</p>
      ) : (
        <div className="space-y-1 max-h-[22rem] overflow-y-auto -mr-1 pr-1">{children}</div>
      )}
    </div>
  );
}

// ── Feed row ──────────────────────────────────────────────────────────────────
function FeedRow({
  href, accent, title, titleClass, sub, right, badge,
}: {
  href: string; accent: string; title: string; titleClass?: string;
  sub: React.ReactNode; right: React.ReactNode; badge?: string;
}) {
  return (
    <Link href={href} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-3 px-3 py-2 rounded-xl bg-slate-800/20 hover:bg-slate-800/50 transition-colors group">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${DOT[accent]}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {badge && (
            <span className={`inline-block px-1.5 py-0.5 border text-[10px] font-bold rounded leading-none flex-shrink-0 ${ACCENT_TILE[accent]}`}>{badge}</span>
          )}
          <span className={`text-xs font-semibold truncate ${titleClass || 'text-slate-100'} group-hover:text-white transition-colors`}>{title}</span>
        </div>
        <p className="text-[11px] text-slate-500 truncate mt-0.5">{sub}</p>
      </div>
      <div className="flex-shrink-0 text-[10px] text-slate-500 tabular-nums text-right">{right}</div>
    </Link>
  );
}

// ── Payment progress bar ──────────────────────────────────────────────────────
function PctBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-14 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-amber-400' : 'bg-slate-600'}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[10px] font-semibold w-8 text-right ${pct >= 100 ? 'text-emerald-400' : pct > 0 ? 'text-amber-300' : 'text-slate-600'}`}>{pct.toFixed(0)}%</span>
    </div>
  );
}

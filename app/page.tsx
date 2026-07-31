'use client';
import { useMemo, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import BrandMenu from '@/components/ui/BrandMenu';
import { PRINCIPAL_CATS } from '@/constants/costCategories';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { fmtIdrShort, parseDate } from '@/lib/formatters';
import { getSettings } from '@/lib/settings';
import { fetchActionQueue, fetchActivity, type ActionItem, type ActivityRow } from '@/lib/dashboard';

// ── Formatting ──────────────────────────────────────────────────────────────
// Shapes live in lib/formatters (settings-driven); only the day+month stamp is
// local, because no other screen prints a date without its year.
const fmtIdr = (n: number) => fmtIdrShort(n);

function fmtDate(d?: string | null) {
  const dt = parseDate(d);
  if (!dt) return '';
  return dt.toLocaleDateString(getSettings().dateLocaleInternal, { day: '2-digit', month: 'short' });
}
function thisMonth() { return new Date().toISOString().slice(0, 7); }

export default function Home() {
  const router = useRouter();
  const supabase = createSupabaseClient();
  const { user, profile, loading: authLoading } = useAuth();
  const { data, loading } = useSupabaseData();
  const { arOverdueDays, quoteFollowUpDays } = useSettings();
  // Module visibility mirrors the nav: a role only sees panels for flows it
  // can access (nothing sensitive renders until the profile has resolved).
  const perms = profile ? ROLE_PERMISSIONS[profile.role] : null;
  const [stockValue, setStockValue] = useState<number | null>(null);
  const [queue, setQueue] = useState<ActionItem[] | null>(null);
  const [activity, setActivity] = useState<ActivityRow[] | null>(null);

  useEffect(() => { document.title = 'Dashboard — ICAPROC'; }, []);

  // PO values and payment status are sensitive — sign-in required
  useEffect(() => {
    if (!authLoading && !user) router.replace('/login?next=/');
  }, [authLoading, user, router]);

  // ── What needs a human, and what has moved ────────────────────────────────
  // Both derive from the owning modules' own tables, so fixing a row on Sales
  // or Banks clears it here on the next load — no second source of truth.
  useEffect(() => {
    if (!user || !perms) return;
    let live = true;
    fetchActionQueue(supabase, perms, { arOverdueDays, quoteFollowUpDays })
      .then((r) => { if (live) setQueue(r); })
      .catch(() => { if (live) setQueue([]); });
    fetchActivity(supabase, perms)
      .then((r) => { if (live) setActivity(r); })
      .catch(() => { if (live) setActivity([]); });
    return () => { live = false; };
  }, [user, profile?.role, arOverdueDays, quoteFollowUpDays]);

  useEffect(() => {
    if (!user || !perms?.buySide) return;
    // Warehouse value = Σ on-hand × moving-avg landed cost (30.1 balances)
    supabase.from('30.1_stock_balances')
      .select('qty_on_hand, avg_cost_idr')
      .then(({ data, error }) => {
        if (error || !data) { setStockValue(0); return; }
        setStockValue(data.reduce((s, b) => s + (Number(b.qty_on_hand) || 0) * (Number(b.avg_cost_idr) || 0), 0));
      });
  }, [user, perms?.buySide]);

  const poById = useMemo(
    () => new Map(data.pos.map((p) => [String(p.po_id), p])),
    [data.pos]);

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

  const atStake = useMemo(() => (queue ?? []).reduce((s, i) => s + i.amount, 0), [queue]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      {/* ── Header ── */}
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1800px] 2xl:max-w-[2460px] mx-auto px-3 sm:px-4 md:px-6 xl:px-8 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between sm:flex-wrap gap-2.5 sm:gap-4">
          <BrandMenu
            wordmarkClass="text-xl md:text-2xl font-extrabold"
            subtitle={new Date().toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
          />
        </div>
      </div>

      <main className="max-w-[1800px] 2xl:max-w-[2460px] mx-auto px-3 sm:px-4 md:px-6 xl:px-8 py-6 xl:py-8 space-y-8">

        {/* Spotlight used to open this page as a hero. It now lives in the nav
            bar on every page including this one, so the dashboard leads with
            the thing only the dashboard can tell you: what needs a human. */}

        {/* ── Needs you today ── */}
        <ActionQueue items={queue} atStake={atStake} />

        {/* ── KPI row (buy-side economics — hidden from sell-side-only roles) ── */}
        {perms?.buySide && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 xl:gap-5">
          {[
            { label: 'Outstanding', value: loading ? '—' : fmtIdr(stats.outstandingIdr), sub: 'unpaid across active POs',
              color: stats.outstandingIdr > 0 ? 'text-amber-300' : 'text-emerald-300',
              ring: stats.outstandingIdr > 0 ? 'ring-amber-500/20' : 'ring-emerald-500/20' },
            { label: 'Paid This Month', value: loading ? '—' : fmtIdr(stats.paidThisMonthIdr),
              sub: new Date().toLocaleDateString('en-GB', { month: 'long' }), color: 'text-rose-300', ring: 'ring-rose-500/20' },
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
        )}

        {/* ── Activity + quick actions ── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <div className="xl:col-span-2"><ActivityStream rows={activity} /></div>

          {/* Quick actions (text only, no emoji) */}
          <div className="bg-slate-900/40 border border-slate-800/80 ring-1 ring-white/5 rounded-2xl p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-3">Quick Actions</p>
            <div className="space-y-2">
              {[
                ...(perms?.sellSide ? [
                  { href: '/sales/new',  label: 'New Sales Quotation', accent: 'emerald' },
                  { href: '/customers',  label: 'Customers',           accent: 'emerald' },
                ] : []),
                ...(perms?.buySide ? [
                  { href: '/purchasing?tab=quoting',    label: 'Enter Supplier Quote / PI', accent: 'blue' },
                  { href: '/purchasing?tab=ordering',   label: 'Create Purchase Order',      accent: 'amber' },
                  { href: '/purchasing?tab=financials', label: 'Log Payment',                accent: 'rose' },
                ] : []),
                ...(perms?.projects ? [
                  { href: '/proposals',              label: 'New EPC Proposal',          accent: 'violet' },
                ] : []),
                ...(perms?.canViewBanks ? [
                  { href: '/banks',                  label: 'Bank Accounts',             accent: 'amber' },
                ] : []),
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

// Domain colours follow the app: buy = sky, sell = emerald, EPC = violet.
// Cash is amber — it is neither side, it is the thing both sides move.
const DOMAIN_DOT: Record<string, string> = {
  sell: 'bg-emerald-400', buy: 'bg-sky-400', cash: 'bg-amber-400', epc: 'bg-violet-400',
};
const DOMAIN_TEXT: Record<string, string> = {
  sell: 'text-emerald-300', buy: 'text-sky-300', cash: 'text-amber-300', epc: 'text-violet-300',
};

/**
 * The queue is the point of the dashboard: what is stuck, what it is worth,
 * and one tap to the screen that unsticks it. Ranked by money, not recency.
 */
function ActionQueue({ items, atStake }: { items: ActionItem[] | null; atStake: number }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800/80 ring-1 ring-white/5 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5 border-b border-slate-800/70">
        <h2 className="text-sm font-bold text-white">Needs you today</h2>
        {items && items.length > 0 && (
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            {items.length} item{items.length !== 1 ? 's' : ''}
          </span>
        )}
        {atStake > 0 && (
          <span className="ml-auto text-right">
            <span className="block text-[10px] uppercase tracking-widest text-slate-500 leading-none">At stake</span>
            <span className="block text-sm font-extrabold tabular-nums text-amber-300 mt-1 leading-none">{fmtIdr(atStake)}</span>
          </span>
        )}
      </div>

      {items === null ? (
        <div className="p-4 sm:p-5 space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-slate-800/40 rounded-xl animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs text-slate-500">
          Nothing is blocked — every confirmed order can ship, and no invoice or quotation is waiting on a chase.
        </p>
      ) : (
        <div className="divide-y divide-slate-800/50">
          {items.map((it) => (
            <Link key={it.key} href={it.href}
              className="flex items-center gap-3 px-4 sm:px-5 py-3 hover:bg-slate-800/40 transition-colors group">
              <span className={`rounded-full flex-shrink-0 ${DOMAIN_DOT[it.domain]} ${it.tone === 'urgent' ? 'w-2 h-2' : 'w-1.5 h-1.5 opacity-60'}`} />
              <div className="min-w-0 flex-1">
                <p className={`text-[13px] font-semibold truncate ${it.tone === 'urgent' ? 'text-white' : 'text-slate-200'}`}>{it.title}</p>
                <p className="text-[11px] text-slate-500 truncate mt-0.5">{it.detail}</p>
              </div>
              {it.amount > 0 && (
                <span className={`flex-shrink-0 text-sm font-extrabold tabular-nums ${it.tone === 'urgent' ? 'text-amber-300' : DOMAIN_TEXT[it.domain]}`}>
                  {fmtIdr(it.amount)}
                </span>
              )}
              <span className="flex-shrink-0 text-slate-700 group-hover:text-slate-400 transition-colors">→</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One stream instead of five parallel feeds — a sales document no longer hides
 * behind a wall of purchase orders, and the space that bought pays for the
 * queue above.
 */
function ActivityStream({ rows }: { rows: ActivityRow[] | null }) {
  return (
    <div className="bg-slate-900/40 border border-slate-800/80 ring-1 ring-white/5 rounded-2xl p-5 h-full">
      <div className="flex items-center gap-2.5 mb-3">
        <h2 className="text-sm font-bold text-white flex-1">Latest activity</h2>
        <span className="text-[10px] uppercase tracking-widest text-slate-600">across every module</span>
      </div>
      {rows === null ? (
        <div className="space-y-1.5">{[...Array(8)].map((_, i) => <div key={i} className="h-10 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>
      ) : rows.length === 0 ? (
        <p className="text-slate-600 text-xs italic py-8 text-center">Nothing recent.</p>
      ) : (
        <div className="space-y-1">
          {rows.map((r) => (
            <Link key={r.key} href={r.href}
              className="flex items-center gap-3 px-3 py-2 rounded-xl bg-slate-800/20 hover:bg-slate-800/50 transition-colors group">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${DOMAIN_DOT[r.domain]}`} />
              <span className={`flex-shrink-0 w-[4.5rem] text-[10px] font-bold uppercase tracking-wider ${DOMAIN_TEXT[r.domain]}`}>{r.kind}</span>
              <span className="text-xs font-semibold text-slate-100 group-hover:text-white transition-colors truncate">{r.title}</span>
              <span className="text-[11px] text-slate-500 truncate hidden sm:block">{r.sub}</span>
              <span className="ml-auto flex-shrink-0 text-[10px] text-slate-500 tabular-nums">{fmtDate(r.at)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

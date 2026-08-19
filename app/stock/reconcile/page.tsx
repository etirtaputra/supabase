'use client';
/**
 * ICAPROC — Buy-side: Landed-cost reconciliation
 *
 * Goods arrive before their bills do. /stock/receive values a receipt at the
 * costs recorded that day — usually the principal and whatever fees are in —
 * because that is all anyone knows when the truck shows up. The freight
 * invoice, the customs duty and the final balance payment land weeks later, and
 * until someone goes back, every one of those items sits in stock below what it
 * actually cost, quietly flattering the margin on everything sold out of it.
 *
 * This screen is the going back. Per PO it shows what the receipt booked, what
 * the bills now say, and the correction — split honestly:
 *   • units STILL ON HAND revalue (the ledger takes it, moving average moves);
 *   • units ALREADY SOLD cannot (their COGS is history) — that number is shown
 *     as gross profit that was overstated, never swallowed.
 *
 * Posting writes 'revalue' movements: value only, no phantom quantity. Safe to
 * press twice — the variance is recomputed from the ledger, so a trued-up PO
 * drops off the list and later bills bring back only the increment.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { fmtDay, fmtInt, fmtIdr, fmtRupiah } from '@/lib/formatters';
import {
  fetchLandedVariances, revaluationRows, type LandedSummary, type PoVariance,
} from '@/lib/landedCost';

interface Comp { component_id: string; supplier_model: string | null; internal_description: string | null; unit: string | null }

export default function ReconcilePage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const canView = !!profile && ROLE_PERMISSIONS[profile.role].buySide;
  const canManage = !!profile && ROLE_PERMISSIONS[profile.role].canManageStock;

  const [summary, setSummary] = useState<LandedSummary | null>(null);
  const [comps, setComps] = useState<Map<string, Comp>>(new Map());
  const [suppliers, setSuppliers] = useState<Map<string, string>>(new Map());
  // Most POs name their vendor only on the supplier quote they came from
  const [quoteSupplier, setQuoteSupplier] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState('');
  const [open, setOpen] = useState<string | null>(null);      // expanded PO
  const [busy, setBusy] = useState<string | null>(null);      // PO being posted
  const [showAwaiting, setShowAwaiting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 5000); };

  useEffect(() => { document.title = 'Stock · Landed cost — ICAPROC'; }, []);
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/stock/reconcile')}`); return; }
    if (profile && !ROLE_PERMISSIONS[profile.role].buySide) router.replace('/unauthorized');
  }, [authLoading, user, profile, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed('');
    try {
      const [s, compRes, supRes, quoteRes] = await Promise.all([
        fetchLandedVariances(supabase),
        supabase.from('3.0_components').select('component_id, supplier_model, internal_description, unit').limit(5000),
        supabase.from('2.0_suppliers').select('supplier_id, supplier_name'),
        supabase.from('4.0_price_quotes').select('quote_id, supplier_id'),
      ]);
      setSummary(s);
      setComps(new Map(((compRes.data ?? []) as Comp[]).map((c) => [c.component_id, c])));
      setSuppliers(new Map(((supRes.data ?? []) as { supplier_id: string; supplier_name: string }[])
        .map((r) => [String(r.supplier_id), r.supplier_name])));
      setQuoteSupplier(new Map(((quoteRes.data ?? []) as { quote_id: string; supplier_id: string | null }[])
        .filter((q) => q.supplier_id).map((q) => [String(q.quote_id), String(q.supplier_id)])));
    } catch (e) {
      // Make the failure speak — a silent empty screen reads as "nothing to do"
      setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { if (canView) load(); }, [canView, load]);

  /** The vendor: named on the PO when it is, otherwise on the quote it came from. */
  const supplierOf = useCallback((v: PoVariance): string => {
    const sid = v.supplierId ?? (v.quoteId ? quoteSupplier.get(v.quoteId) ?? null : null);
    return (sid && suppliers.get(sid)) || '';
  }, [suppliers, quoteSupplier]);

  const nameOf = useCallback((id: string) => {
    const c = comps.get(id);
    if (!c) return id.slice(0, 8);
    return `${c.supplier_model ?? ''}${c.internal_description ? ` — ${c.internal_description}` : ''}`.trim() || id.slice(0, 8);
  }, [comps]);

  async function post(v: PoVariance) {
    if (!canManage) return;
    const rows = revaluationRows(v);
    if (rows.length === 0) {
      flash(`${v.poNumber}: nothing left on hand to revalue — the whole ${fmtIdr(Math.abs(v.delta))} sits in past gross profit`);
      return;
    }
    // A true-up moves the valuation of everything on hand; say the number out
    // loud before it is posted, because undoing it means an opposite entry.
    const ok = window.confirm(
      `True up ${v.poNumber}?\n\n`
      + `${fmtIdr(v.inventoryDelta)} into the value of stock still on hand`
      + `${Math.abs(v.cogsDelta) >= 1000 ? `\n${fmtIdr(v.cogsDelta)} relates to units already sold and cannot be recovered` : ''}`
      + `\n\n${rows.length} ledger entr${rows.length === 1 ? 'y' : 'ies'}, value only — no quantity moves.`,
    );
    if (!ok) return;
    setBusy(v.poId);
    try {
      const { error } = await supabase.from('30.0_stock_movements').insert(rows);
      if (error) {
        // A missing 'revalue' direction means the migration hasn't run here
        flash(/violates check constraint/i.test(error.message)
          ? 'The ledger does not accept revaluations yet — run migrations/landed_cost_revaluation.sql'
          : `True-up failed: ${error.message}`);
        return;
      }
      flash(`${v.poNumber} trued up — ${fmtIdr(v.inventoryDelta)} into stock value${
        Math.abs(v.cogsDelta) >= 1000 ? `, ${fmtIdr(v.cogsDelta)} was already sold` : ''}`);
      setOpen(null);
      await load();
    } catch (e) {
      flash(`True-up failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  const shown = useMemo(() => {
    if (!summary) return [];
    return showAwaiting ? summary.pos : summary.ready;
  }, [summary, showAwaiting]);

  if (authLoading || !profile || !canView) {
    return (
      <div className="min-h-screen bg-chrome flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/stock" className="text-slate-500 hover:text-white transition-colors flex-shrink-0" title="Back to Stock">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            </Link>
            <div className="min-w-0">
              <h1 className="text-lg md:text-xl font-extrabold text-white truncate">Landed cost — true up</h1>
              <p className="text-[11px] text-slate-500">What the receipt guessed vs what the import actually cost</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link href="/stock/receive"
              className="px-3 py-1.5 rounded-xl border border-slate-700 text-slate-400 hover:text-sky-300 hover:border-sky-500/40 text-xs font-semibold whitespace-nowrap transition-colors">
              Receive goods →
            </Link>
            <button onClick={load} disabled={loading}
              className="px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-50 text-xs font-semibold whitespace-nowrap transition-colors">
              {loading ? 'Reading…' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-6 space-y-5">
        {failed && (
          <div className="bg-red-500/10 border border-red-500/40 rounded-2xl p-4 text-sm">
            <span className="text-red-300 font-semibold">Could not read the ledger.</span>
            <span className="text-red-200/80 text-xs ml-2 font-mono">{failed}</span>
          </div>
        )}

        {/* The headline: money that belongs in stock value but isn't there yet */}
        {summary && (
          <div className="bg-amber-500/[0.06] border border-amber-500/25 rounded-2xl px-4 py-3.5">
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-amber-300">
                {summary.ready.length} PO{summary.ready.length !== 1 ? 's' : ''} ready to true up
              </h2>
              <span className="text-lg font-extrabold tabular-nums text-white">{fmtRupiah(summary.readyDelta)}</span>
              <span className="text-[11px] text-slate-400">
                understated landed cost
              </span>
              {summary.readyInventoryDelta !== 0 && (
                <span className="text-[11px] tabular-nums text-emerald-300">
                  <span className="text-slate-500">still recoverable into stock value </span>{fmtIdr(summary.readyInventoryDelta)}
                </span>
              )}
              {Math.abs(summary.readyCogsDelta) >= 1000 && (
                <span className="text-[11px] tabular-nums text-slate-400" title="These units were already sold at the estimated cost — that gross profit was overstated by this much">
                  <span className="text-slate-500">already sold </span>{fmtIdr(summary.readyCogsDelta)}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">
              Costs are allocated the way the Item Editor computes true unit cost: every recorded cost except local
              taxes, spread over the PO&apos;s lines by value. Ready = the supplier has been paid off, so the bills are final.
            </p>
          </div>
        )}

        {summary && (summary.awaiting.length > 0 || summary.uncosted > 0 || summary.immaterial > 0) && (
          <div className="flex flex-wrap items-center gap-3 text-[11px]">
            {summary.awaiting.length > 0 && (
              <button onClick={() => setShowAwaiting((s) => !s)}
                className={`px-2.5 py-1 rounded-lg border font-semibold transition-colors ${
                  showAwaiting ? 'border-sky-500/40 text-sky-300 bg-sky-500/10' : 'border-slate-700 text-slate-400 hover:text-white'}`}>
                {showAwaiting ? '✓ ' : ''}Include {summary.awaiting.length} still awaiting final bills
              </button>
            )}
            {summary.uncosted > 0 && (
              <span className="text-slate-500" title="Goods received, but not one cost recorded — there is nothing to allocate yet">
                {summary.uncosted} received PO{summary.uncosted !== 1 ? 's' : ''} have no costs recorded at all
              </span>
            )}
            {summary.immaterial > 0 && (
              <span className="text-slate-500" title="Too small in rupiah and too small a share of the goods to be worth a ledger entry — shown here so it is never silently dropped">
                {summary.immaterial} below the materiality floor ({fmtIdr(summary.immaterialDelta)} in total)
              </span>
            )}
          </div>
        )}

        {loading ? (
          <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-slate-800/40 rounded-2xl animate-pulse" />)}</div>
        ) : shown.length === 0 ? (
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl px-4 py-12 text-center">
            <p className="text-slate-400 font-semibold">Every received PO is carrying its real cost.</p>
            <p className="text-[11px] text-slate-600 mt-1">
              Nothing to true up{summary && summary.awaiting.length > 0 ? ' among POs whose bills are final' : ''} — stock value matches what the imports actually cost.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {shown.map((v) => {
              const isOpen = open === v.poId;
              const up = v.delta >= 0;
              return (
                <div key={v.poId} className={`rounded-2xl border overflow-hidden ${
                  v.status === 'ready' ? 'border-slate-800/80 bg-slate-900/40' : 'border-slate-800/50 bg-slate-900/20'}`}>
                  <button onClick={() => setOpen(isOpen ? null : v.poId)} className="w-full text-left px-4 py-3 hover:bg-white/[0.02] transition-colors">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                      <span className="text-sky-300 font-bold">{v.poNumber}</span>
                      {v.status === 'awaiting' && (
                        <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-slate-800 text-slate-400"
                          title="No balance payment recorded yet — more bills are still coming">bills open</span>
                      )}
                      {v.trued && (
                        <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300"
                          title="This PO has been trued up before — what is shown is what has come in since">trued before</span>
                      )}
                      <span className="text-[11px] text-slate-500 truncate">
                        {supplierOf(v) || '—'} · {fmtDay(v.poDate)} · {v.currency}
                      </span>
                      <span className={`ml-auto text-base font-extrabold tabular-nums ${up ? 'text-amber-300' : 'text-emerald-300'}`}>
                        {up ? '+' : '−'}{fmtIdr(Math.abs(v.delta))}
                      </span>
                      <span className={`text-[11px] tabular-nums font-semibold ${up ? 'text-amber-400/80' : 'text-emerald-400/80'}`}>
                        {up ? '+' : '−'}{Math.abs(v.deltaPct * 100).toFixed(1)}%
                      </span>
                      <span className="text-slate-600 text-xs">{isOpen ? '▲' : '▼'}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      received at {fmtIdr(v.bookedValue)} · bills now say {fmtIdr(v.actualValue)}
                      {v.inventoryDelta !== 0 && <> · <span className="text-emerald-400/80">{fmtIdr(v.inventoryDelta)} still in stock</span></>}
                      {Math.abs(v.cogsDelta) >= 1000 && <> · <span className="text-slate-500">{fmtIdr(v.cogsDelta)} already sold</span></>}
                    </p>
                  </button>

                  {isOpen && (
                    <div className="border-t border-slate-800/60">
                      <div className="hidden md:grid grid-cols-[1fr_80px_110px_110px_100px_90px_120px] gap-3 px-4 py-2 bg-slate-900/60 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                        <span>Item</span><span className="text-right">Received</span><span className="text-right">Booked at</span>
                        <span className="text-right">Actually</span><span className="text-right">Δ / unit</span>
                        <span className="text-right">On hand</span><span className="text-right">New avg cost</span>
                      </div>
                      <div className="divide-y divide-slate-800/40">
                        {v.items.map((i) => (
                          <div key={`${i.componentId}·${i.location}`} className="px-4 py-2.5 md:grid md:grid-cols-[1fr_80px_110px_110px_100px_90px_120px] md:gap-3 md:items-center">
                            <div className="min-w-0">
                              <p className="text-slate-200 truncate text-xs">{nameOf(i.componentId)}</p>
                              <p className="text-[10px] text-slate-600">
                                {i.location}
                                {i.revaluable < i.received && (
                                  <span className="text-slate-500"> · {fmtInt(i.received - i.revaluable)} of {fmtInt(i.received)} already sold</span>
                                )}
                              </p>
                            </div>
                            <span className="hidden md:block text-right tabular-nums text-xs text-slate-400">{fmtInt(i.received)}</span>
                            <span className="hidden md:block text-right tabular-nums text-xs text-slate-400">{fmtInt(i.bookedUnit)}</span>
                            <span className="hidden md:block text-right tabular-nums text-xs text-slate-200 font-semibold">{fmtInt(i.actualUnit)}</span>
                            <span className={`hidden md:block text-right tabular-nums text-xs font-semibold ${i.deltaUnit >= 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
                              {i.deltaUnit >= 0 ? '+' : '−'}{fmtInt(Math.abs(i.deltaUnit))}
                            </span>
                            <span className="hidden md:block text-right tabular-nums text-xs text-slate-400">{fmtInt(i.onHand)}</span>
                            <span className="hidden md:block text-right tabular-nums text-xs">
                              {i.revaluable > 0
                                ? <span className="text-emerald-300 font-semibold">{fmtInt(i.newAvg)}</span>
                                : <span className="text-slate-600" title="Nothing on hand — this correction cannot reach inventory">—</span>}
                            </span>
                            {/* Phone: the same facts, stacked */}
                            <div className="md:hidden mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
                              <span className="text-slate-500">{fmtInt(i.received)} rcvd</span>
                              <span className="text-slate-500">{fmtInt(i.bookedUnit)} → <span className="text-slate-200">{fmtInt(i.actualUnit)}</span></span>
                              <span className={i.deltaUnit >= 0 ? 'text-amber-300' : 'text-emerald-300'}>
                                {i.deltaUnit >= 0 ? '+' : '−'}{fmtInt(Math.abs(i.deltaUnit))}/unit
                              </span>
                              <span className="text-slate-500">{fmtInt(i.onHand)} on hand</span>
                              {i.revaluable > 0 && <span className="text-emerald-300">avg → {fmtInt(i.newAvg)}</span>}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="px-4 py-3 bg-slate-900/60 border-t border-slate-800/60 flex flex-wrap items-center gap-3">
                        <div className="text-[11px] text-slate-500 min-w-0 flex-1">
                          {v.unmatched > 0 && (
                            <span className="text-amber-400/80 mr-2">
                              {v.unmatched} received item{v.unmatched !== 1 ? 's' : ''} no PO line explains — left alone.
                            </span>
                          )}
                          Posting writes value-only ledger entries; quantities never move. The correction spreads over
                          everything on hand, because a moving average keeps no lots.
                        </div>
                        <Link href={`/purchasing?tab=lookup&q=${encodeURIComponent(v.poNumber)}`}
                          className="text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-sky-300 hover:border-sky-500/40 font-semibold whitespace-nowrap transition-colors">
                          The deal ↗
                        </Link>
                        {canManage && (
                          revaluationRows(v).length === 0 ? (
                            // Every unit is gone: there is no inventory left for
                            // the correction to land on, and saying so beats a
                            // button that posts nothing.
                            <span className="text-[11px] text-slate-500 px-2 py-1.5 whitespace-nowrap" title="All of these units have been sold — the correction cannot reach stock value">
                              nothing on hand to revalue
                            </span>
                          ) : (
                            <button onClick={() => post(v)} disabled={busy === v.poId}
                              className="text-xs px-3.5 py-1.5 rounded-xl bg-amber-500/90 hover:bg-amber-400 text-slate-950 font-bold disabled:opacity-50 whitespace-nowrap transition-colors">
                              {busy === v.poId ? 'Posting…' : `Post true-up · ${fmtIdr(v.inventoryDelta)}`}
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[130] px-4 py-2.5 bg-slate-800 border border-slate-700 text-white text-xs font-semibold rounded-xl shadow-2xl max-w-[92vw] text-center">
          {toast}
        </div>
      )}
    </div>
  );
}

'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { useQuotesGate } from '@/hooks/useQuotesGate';
import { getComponentCost } from '@/lib/computeTUC';
import { fetchUsedEntries } from '@/lib/usedPrices';
import { roundNice } from '@/lib/rounding';
import MigrationBanner from '@/components/ui/MigrationBanner';
import { PROJECT_TYPES } from '@/lib/projectSpec';
import type { ProjectQuote } from '@/types/quotes';

const STATUS_STYLES: Record<string, string> = {
  draft:    'bg-slate-700/60 text-slate-300',
  sent:     'bg-blue-500/20 text-blue-300',
  accepted: 'bg-emerald-500/20 text-emerald-300',
  rejected: 'bg-red-500/20 text-red-400',
};

function fmtDate(d: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function QuotesListPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const gate = useQuotesGate();
  const { data: catalog, loading: catalogLoading } = useSupabaseData();
  const [quotes, setQuotes] = useState<ProjectQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Duplicate modal state
  const [dup, setDup] = useState<{ id: string; number: string } | null>(null);
  const [dupToday, setDupToday] = useState(true);
  const [dupRefresh, setDupRefresh] = useState(true);
  const [dupInternal, setDupInternal] = useState(true);
  const [dupBusy, setDupBusy] = useState(false);
  const [dupError, setDupError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('10.0_project_quotes')
      .select('*')
      .order('created_at', { ascending: false });
    setQuotes((data as ProjectQuote[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createNew() {
    setCreating(true);
    const today = new Date().toISOString().slice(0, 10);
    const num = `Q-${today.replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const { data, error } = await supabase
      .from('10.0_project_quotes')
      .insert({ quote_number: num, quote_date: today })
      .select('quote_id')
      .single();
    if (!error && data) router.push(`/quotes/${data.quote_id}`);
    else setCreating(false);
  }

  async function confirmDelete(id: string) {
    await supabase.from('10.0_project_quotes').delete().eq('quote_id', id);
    setDeleteId(null);
    load();
  }

  async function duplicateQuote() {
    if (!dup) return;
    setDupBusy(true);
    setDupError('');
    try {
      const [qRes, secRes, itemRes] = await Promise.all([
        supabase.from('10.0_project_quotes').select('*').eq('quote_id', dup.id).single(),
        supabase.from('10.1_quote_sections').select('*').eq('quote_id', dup.id).order('sort_order'),
        supabase.from('10.2_quote_items').select('*').eq('quote_id', dup.id).order('sort_order'),
      ]);
      const src = qRes.data;
      if (!src) throw new Error('Source quote not found');

      const usedMap = dupRefresh ? await fetchUsedEntries(supabase) : null;
      const today = new Date().toISOString().slice(0, 10);
      const newQuoteId = crypto.randomUUID();

      // 1. Quote header — always restarts as a draft. Optional columns are
      //    only written when the source row actually has them, so duplication
      //    keeps working on databases that haven't run the latest migration.
      const newQuote: Record<string, unknown> = {
        quote_id: newQuoteId,
        quote_number: `${src.quote_number || 'Q'}-REV`,
        quote_date: dupToday ? today : src.quote_date,
        customer_name: src.customer_name,
        customer_address: src.customer_address,
        project_description: src.project_description,
        ppn_pct: src.ppn_pct,
        status: 'draft',
        notes: src.notes,
      };
      if ('company_id' in src) newQuote.company_id = src.company_id ?? null;
      if ('group_margins' in src) newQuote.group_margins = src.group_margins ?? {};
      if ('project_type' in src) newQuote.project_type = src.project_type ?? 'custom';
      if ('system_specs' in src) newQuote.system_specs = src.system_specs ?? {};
      if ('location' in src) newQuote.location = src.location ?? '';
      const { error: qErr } = await supabase.from('10.0_project_quotes').insert(newQuote);
      if (qErr) throw qErr;

      // 2. Sections with fresh ids
      const secIdMap = new Map<string, string>();
      const newSecs = (secRes.data ?? []).map((s) => {
        const nid = crypto.randomUUID();
        secIdMap.set(s.section_id, nid);
        const row: Record<string, unknown> = {
          section_id: nid, quote_id: newQuoteId,
          title: s.title, lead_time: s.lead_time, sort_order: s.sort_order,
        };
        if ('group_key' in s) row.group_key = s.group_key ?? 'bos';
        return row;
      });
      if (newSecs.length) {
        const { error } = await supabase.from('10.1_quote_sections').insert(newSecs);
        if (error) throw error;
      }

      // 3. Items — parents before subs so the self-referencing FK is satisfied
      //    within the batch insert; optionally re-cost keeping each item's GM%.
      const srcItems = [...(itemRes.data ?? [])].sort((a, b) =>
        Number(!!a.parent_item_id) - Number(!!b.parent_item_id));
      const itemIdMap = new Map<string, string>();
      for (const it of srcItems) itemIdMap.set(it.item_id, crypto.randomUUID());
      const newItems = srcItems.map((it) => {
        let cost = it.cost_price, sell = it.sell_price;
        if (dupRefresh && it.component_id) {
          const cc = getComponentCost(it.component_id, catalog.pos, catalog.poItems, catalog.poCosts, catalog.quotes, catalog.quoteItems, usedMap?.get(it.component_id) ?? []);
          if (cc) {
            const newCost = Math.round(cc.cost);
            const oldCost = Number(it.cost_price), oldSell = Number(it.sell_price);
            if (oldCost > 0 && oldSell > 0) {
              const gmFrac = 1 - oldCost / oldSell;
              if (gmFrac < 1) sell = roundNice(newCost / (1 - gmFrac));
            }
            cost = newCost;
          }
        }
        const row: Record<string, unknown> = {
          item_id: itemIdMap.get(it.item_id)!,
          section_id: secIdMap.get(it.section_id)!,
          quote_id: newQuoteId,
          parent_item_id: it.parent_item_id ? (itemIdMap.get(it.parent_item_id) ?? null) : null,
          component_id: it.component_id,
          description: it.description, brand: it.brand,
          quantity: it.quantity, unit: it.unit,
          cost_price: cost, sell_price: sell,
          sort_order: it.sort_order,
        };
        if ('qty_formula' in it) row.qty_formula = dupInternal ? (it.qty_formula ?? '') : '';
        if ('eng_note' in it) row.eng_note = dupInternal ? (it.eng_note ?? '') : '';
        return row;
      });
      if (newItems.length) {
        const { error } = await supabase.from('10.2_quote_items').insert(newItems);
        if (error) throw error;
      }

      router.push(`/quotes/${newQuoteId}`);
    } catch (e) {
      // Supabase errors are plain objects, not Error instances — read .message either way
      const msg = (e as { message?: string })?.message;
      setDupError(msg || 'Duplication failed');
      setDupBusy(false);
    }
  }

  if (!gate.ready) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-slate-200 font-sans text-sm">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-[#0B1120]/90 backdrop-blur-xl border-b border-white/[0.07]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] text-slate-500 mb-1">
              <Link href="/" className="hover:text-slate-300 transition-colors">ICAPROC</Link>
              <span>/</span>
              <span className="text-slate-400">Project Quotes</span>
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight">Project Quotes</h1>
          </div>
          <div className="flex items-center gap-4">
            {gate.profile && (
              <div className="text-right hidden sm:block">
                <p className="text-[11px] text-slate-400 leading-tight">{gate.profile.email}</p>
                <button onClick={() => gate.signOut()} className="text-[10px] text-slate-600 hover:text-slate-300 underline transition-colors">
                  Sign out
                </button>
              </div>
            )}
          <button
            onClick={createNew}
            disabled={creating}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {creating ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
            )}
            New Quote
          </button>
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <MigrationBanner />
        {loading ? (
          <div className="flex items-center justify-center h-64 text-slate-500">Loading…</div>
        ) : quotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-4">
            <svg className="w-12 h-12 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            <p className="text-slate-400 font-medium">No quotes yet</p>
            <button onClick={createNew} className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors">
              Create your first quote
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {quotes.map((q) => (
              <div key={q.quote_id} className="group flex items-center gap-4 bg-slate-900/50 hover:bg-slate-900/80 border border-slate-800 hover:border-slate-700 rounded-2xl px-5 py-4 transition-all">
                <Link href={`/quotes/${q.quote_id}`} className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-semibold text-white truncate">{q.quote_number || '—'}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${STATUS_STYLES[q.status] ?? STATUS_STYLES.draft}`}>
                      {q.status}
                    </span>
                    {q.project_type && q.project_type !== 'custom' && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/15 text-sky-300">
                        {PROJECT_TYPES.find((t) => t.key === q.project_type)?.label ?? q.project_type}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-[11px] text-slate-500">
                    <span className="truncate">{q.customer_name || 'No customer'}</span>
                    {q.project_description && <span className="truncate text-slate-600 hidden sm:block">{q.project_description}</span>}
                    <span className="flex-shrink-0">{fmtDate(q.quote_date)}</span>
                  </div>
                </Link>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => { setDup({ id: q.quote_id, number: q.quote_number }); setDupToday(true); setDupRefresh(true); setDupInternal(true); setDupError(''); }}
                    className="p-2 rounded-lg hover:bg-white/10 text-slate-500 hover:text-white transition-colors"
                    title="Duplicate"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  </button>
                  <Link
                    href={`/quotes/${q.quote_id}/print`}
                    target="_blank"
                    className="p-2 rounded-lg hover:bg-white/10 text-slate-500 hover:text-white transition-colors"
                    title="Print / PDF"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                  </Link>
                  <button
                    onClick={() => setDeleteId(q.quote_id)}
                    className="p-2 rounded-lg hover:bg-red-500/10 text-slate-600 hover:text-red-400 transition-colors"
                    title="Delete"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Duplicate modal */}
      {dup && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full">
            <h3 className="font-semibold text-white mb-1">Duplicate quote</h3>
            <p className="text-slate-500 text-xs mb-5 truncate">{dup.number || 'Untitled quote'}</p>

            <label className="flex items-start gap-3 mb-4 cursor-pointer">
              <input type="checkbox" checked={dupToday} onChange={(e) => setDupToday(e.target.checked)}
                className="mt-0.5 accent-violet-600" />
              <span>
                <span className="block text-sm text-slate-200 font-medium">Set quote date to today</span>
                <span className="block text-[11px] text-slate-500">Unchecked keeps the original date</span>
              </span>
            </label>

            <label className="flex items-start gap-3 mb-5 cursor-pointer">
              <input type="checkbox" checked={dupRefresh} onChange={(e) => setDupRefresh(e.target.checked)}
                className="mt-0.5 accent-violet-600" />
              <span>
                <span className="block text-sm text-slate-200 font-medium">Update costs to latest, keep margins</span>
                <span className="block text-[11px] text-slate-500">
                  Each catalog item gets its newest cost (TUC → supplier quote → last used) and the sell price
                  is recomputed with the item&apos;s original GM%
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 mb-5 cursor-pointer">
              <input type="checkbox" checked={dupInternal} onChange={(e) => setDupInternal(e.target.checked)}
                className="mt-0.5 accent-violet-600" />
              <span>
                <span className="block text-sm text-slate-200 font-medium">Copy internal notes &amp; quantity formulas</span>
                <span className="block text-[11px] text-slate-500">
                  Engineering notes and =formulas behind quantities (internal only, never on the PDF).
                  Unchecked starts the copy clean
                </span>
              </span>
            </label>

            {dupRefresh && catalogLoading && (
              <p className="text-[11px] text-amber-400 mb-4">Loading price data… duplicate will be enabled once it&apos;s ready.</p>
            )}
            {dupError && <p className="text-[11px] text-red-400 mb-4">{dupError}</p>}

            <div className="flex gap-3 justify-end">
              <button onClick={() => setDup(null)} disabled={dupBusy}
                className="px-4 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 text-sm transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button onClick={duplicateQuote} disabled={dupBusy || (dupRefresh && catalogLoading)}
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                {dupBusy ? 'Duplicating…' : 'Duplicate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteId && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-sm w-full">
            <h3 className="font-semibold text-white mb-2">Delete quote?</h3>
            <p className="text-slate-400 text-sm mb-5">This will permanently delete the quote and all its sections and items.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteId(null)} className="px-4 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 text-sm transition-colors">Cancel</button>
              <button onClick={() => confirmDelete(deleteId)} className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

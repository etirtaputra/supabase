'use client';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { computeTUC } from '@/lib/computeTUC';
import type { ProjectQuote, QuoteSection, QuoteItem } from '@/types/quotes';
import type { Component } from '@/types/database';

// ── Types ──────────────────────────────────────────────────────────────────────

interface DraftItem {
  item_id: string;
  parent_item_id: string | null;
  component_id: string | null;
  description: string;
  brand: string;
  quantity: string;
  unit: string;
  cost_price: string;
  sell_price: string;
  sort_order: number;
  _deleted?: boolean;
}
interface DraftSection {
  section_id: string;
  title: string;
  lead_time: string;
  sort_order: number;
  items: DraftItem[];
  _deleted?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function uid() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function num(s: string) { const n = parseFloat(s); return isNaN(n) ? null : n; }

function fmtIdr(v: number | null | undefined) {
  if (v == null) return '—';
  if (v >= 1_000_000) return `Rp${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `Rp${(v / 1_000).toFixed(0)}k`;
  return `Rp${Math.round(v).toLocaleString()}`;
}

function gmFromPrices(cost: string, sell: string): string {
  const c = num(cost), s = num(sell);
  if (!c || !s || s <= 0) return '';
  return ((1 - c / s) * 100).toFixed(1);
}

function sellFromGm(cost: string, gm: string): string {
  const c = num(cost), g = num(gm);
  if (!c || g == null || g >= 100) return '';
  return Math.round(c / (1 - g / 100)).toString();
}

const LEAD_TIMES = ['Ready', '1 minggu', '2 minggu', '3 minggu', '1 bulan', '2 bulan', 'Custom'];
const UNITS = ['pcs', 'set', 'meter', 'Wp', 'kWh', 'ls', 'modules', 'eng days', 'man days', 'Month', 'kg', 'roll'];
const STATUS_OPTS = ['draft', 'sent', 'accepted', 'rejected'] as const;
const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-700/60 text-slate-300',
  sent: 'bg-blue-500/20 text-blue-300',
  accepted: 'bg-emerald-500/20 text-emerald-300',
  rejected: 'bg-red-500/20 text-red-400',
};

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function QuoteEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createSupabaseClient();
  const { data: catalog, loading: catalogLoading } = useSupabaseData();

  // ── Quote header state ─────────────────────────────────────────────────────
  const [quote, setQuote] = useState<ProjectQuote | null>(null);
  const [sections, setSections] = useState<DraftSection[]>([]);
  const [loadingQuote, setLoadingQuote] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // ── Autocomplete state ─────────────────────────────────────────────────────
  const [acState, setAcState] = useState<{ sectionId: string; itemId: string; query: string } | null>(null);
  const acRef = useRef<HTMLDivElement>(null);

  // ── Load quote from DB ─────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoadingQuote(true);
      const [qRes, secRes, itemRes] = await Promise.all([
        supabase.from('10.0_project_quotes').select('*').eq('quote_id', id).single(),
        supabase.from('10.1_quote_sections').select('*').eq('quote_id', id).order('sort_order'),
        supabase.from('10.2_quote_items').select('*').eq('quote_id', id).order('sort_order'),
      ]);
      if (!qRes.data) { router.push('/quotes'); return; }
      setQuote(qRes.data as ProjectQuote);

      const dbSections = (secRes.data ?? []) as QuoteSection[];
      const dbItems    = (itemRes.data ?? []) as QuoteItem[];

      setSections(dbSections.map((sec) => ({
        section_id: sec.section_id,
        title: sec.title,
        lead_time: sec.lead_time,
        sort_order: sec.sort_order,
        items: dbItems
          .filter((i) => i.section_id === sec.section_id)
          .map((i) => ({
            item_id: i.item_id,
            parent_item_id: i.parent_item_id,
            component_id: i.component_id,
            description: i.description,
            brand: i.brand,
            quantity: i.quantity != null ? String(i.quantity) : '',
            unit: i.unit,
            cost_price: i.cost_price != null ? String(i.cost_price) : '',
            sell_price: i.sell_price != null ? String(i.sell_price) : '',
            sort_order: i.sort_order,
          })),
      })));
      setLoadingQuote(false);
    }
    load();
  }, [id]);

  // ── Close autocomplete on outside click ────────────────────────────────────
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (acRef.current && !acRef.current.contains(e.target as Node)) setAcState(null);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Filtered autocomplete results ──────────────────────────────────────────
  const acResults = useMemo<Component[]>(() => {
    if (!acState || acState.query.length < 2) return [];
    const q = acState.query.toLowerCase();
    return catalog.components
      .filter((c) =>
        c.supplier_model?.toLowerCase().includes(q) ||
        c.brand?.toLowerCase().includes(q) ||
        c.category?.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [acState, catalog.components]);

  // ── Computed totals ────────────────────────────────────────────────────────
  const { subtotal, ppn, grandTotal } = useMemo(() => {
    let sub = 0;
    for (const sec of sections) {
      for (const item of sec.items) {
        if (item._deleted || item.parent_item_id) continue;
        const qty = num(item.quantity) ?? 0;
        const sell = num(item.sell_price) ?? 0;
        sub += qty * sell;
      }
    }
    const ppnPct = num(quote?.ppn_pct?.toString() ?? '') ?? 11;
    const tax = sub * ppnPct / 100;
    return { subtotal: sub, ppn: tax, grandTotal: sub + tax };
  }, [sections, quote?.ppn_pct]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  function markDirty() { setDirty(true); setSaveMsg(''); }

  function setQuoteField<K extends keyof ProjectQuote>(key: K, val: ProjectQuote[K]) {
    setQuote((q) => q ? { ...q, [key]: val } : q);
    markDirty();
  }

  function addSection() {
    setSections((prev) => [
      ...prev,
      { section_id: uid(), title: 'New section', lead_time: 'Ready', sort_order: prev.length, items: [] },
    ]);
    markDirty();
  }

  function updateSection(sid: string, patch: Partial<DraftSection>) {
    setSections((prev) => prev.map((s) => s.section_id === sid ? { ...s, ...patch } : s));
    markDirty();
  }

  function deleteSection(sid: string) {
    setSections((prev) => prev.map((s) => s.section_id === sid ? { ...s, _deleted: true } : s));
    markDirty();
  }

  function addItem(sid: string, parentId: string | null = null) {
    setSections((prev) => prev.map((s) => {
      if (s.section_id !== sid) return s;
      const order = s.items.length;
      return { ...s, items: [...s.items, {
        item_id: uid(), parent_item_id: parentId, component_id: null,
        description: '', brand: '', quantity: '', unit: '', cost_price: '', sell_price: '',
        sort_order: order,
      }] };
    }));
    markDirty();
  }

  function updateItem(sid: string, iid: string, patch: Partial<DraftItem>) {
    setSections((prev) => prev.map((s) => {
      if (s.section_id !== sid) return s;
      return { ...s, items: s.items.map((i) => i.item_id === iid ? { ...i, ...patch } : i) };
    }));
    markDirty();
  }

  function deleteItem(sid: string, iid: string) {
    setSections((prev) => prev.map((s) => {
      if (s.section_id !== sid) return s;
      return { ...s, items: s.items.map((i) => i.item_id === iid ? { ...i, _deleted: true } : i) };
    }));
    markDirty();
  }

  // ── Autocomplete selection ─────────────────────────────────────────────────
  function selectComponent(sid: string, iid: string, comp: Component) {
    const tuc = computeTUC(comp.component_id, catalog.pos, catalog.poItems, catalog.poCosts, catalog.quotes);
    const costStr = tuc ? Math.round(tuc.tuc).toString() : '';
    updateItem(sid, iid, {
      component_id: comp.component_id,
      description: comp.supplier_model ?? '',
      brand: comp.brand ?? '',
      unit: comp.category === 'pv_module' ? 'Wp' : 'pcs',
      cost_price: costStr,
    });
    setAcState(null);
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function save() {
    if (!quote) return;
    setSaving(true);
    try {
      // 1. Upsert quote header
      await supabase.from('10.0_project_quotes').upsert({
        quote_id: quote.quote_id,
        quote_number: quote.quote_number,
        quote_date: quote.quote_date,
        customer_name: quote.customer_name,
        customer_address: quote.customer_address,
        project_description: quote.project_description,
        ppn_pct: num(String(quote.ppn_pct)) ?? 11,
        status: quote.status,
        notes: quote.notes,
        updated_at: new Date().toISOString(),
      });

      // 2. Collect deletes
      const deletedSecIds = sections.filter((s) => s._deleted).map((s) => s.section_id);
      const deletedItemIds = sections.flatMap((s) => s.items.filter((i) => i._deleted).map((i) => i.item_id));
      if (deletedItemIds.length) await supabase.from('10.2_quote_items').delete().in('item_id', deletedItemIds);
      if (deletedSecIds.length)  await supabase.from('10.1_quote_sections').delete().in('section_id', deletedSecIds);

      // 3. Upsert live sections
      const liveSections = sections.filter((s) => !s._deleted);
      if (liveSections.length) {
        await supabase.from('10.1_quote_sections').upsert(
          liveSections.map((s, i) => ({
            section_id: s.section_id, quote_id: id,
            title: s.title, lead_time: s.lead_time, sort_order: i,
          }))
        );
      }

      // 4. Upsert live items
      const liveItems = liveSections.flatMap((s) =>
        s.items.filter((i) => !i._deleted).map((i, idx) => ({
          item_id: i.item_id, section_id: s.section_id, quote_id: id,
          parent_item_id: i.parent_item_id,
          component_id: i.component_id ?? null,
          description: i.description, brand: i.brand,
          quantity: num(i.quantity), unit: i.unit,
          cost_price: num(i.cost_price), sell_price: num(i.sell_price),
          sort_order: idx,
        }))
      );
      if (liveItems.length) await supabase.from('10.2_quote_items').upsert(liveItems);

      setDirty(false);
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(''), 2500);
    } catch {
      setSaveMsg('Error saving');
    }
    setSaving(false);
  }

  // ── Export to Excel (HTML table) ───────────────────────────────────────────
  function exportExcel() {
    if (!quote) return;
    const liveSections = sections.filter((s) => !s._deleted);
    const ppnPct = num(String(quote.ppn_pct)) ?? 11;

    let rows = '';
    for (const sec of liveSections) {
      const secTotal = sec.items.filter((i) => !i._deleted && !i.parent_item_id)
        .reduce((s, i) => s + (num(i.quantity) ?? 0) * (num(i.sell_price) ?? 0), 0);
      rows += `<tr style="background:#1e3a5f;color:#fff;font-weight:bold">
        <td colspan="6">${sec.title}</td>
        <td></td>
        <td style="text-align:right">${secTotal > 0 ? fmtIdr(secTotal) : ''}</td>
      </tr>`;
      for (const item of sec.items.filter((i) => !i._deleted)) {
        const total = (num(item.quantity) ?? 0) * (num(item.sell_price) ?? 0);
        const isChild = !!item.parent_item_id;
        rows += `<tr style="${isChild ? 'font-style:italic;color:#555' : ''}">
          <td style="padding-left:${isChild ? '24' : '8'}px">${item.description}</td>
          <td>${item.brand}</td>
          <td>${sec.lead_time}</td>
          <td style="text-align:right">${item.quantity}</td>
          <td>${item.unit}</td>
          <td style="text-align:right">${item.sell_price ? fmtIdr(num(item.sell_price)) : ''}</td>
          <td style="text-align:right">${total > 0 ? fmtIdr(total) : ''}</td>
          <td style="text-align:right">${!isChild && total > 0 ? fmtIdr(total) : ''}</td>
        </tr>`;
      }
    }

    const html = `<html><head><meta charset="utf-8"/>
    <style>table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:4px 8px;font-size:11px}th{background:#1e3a5f;color:#fff}</style>
    </head><body>
    <p><b>CUSTOMER:</b> ${quote.customer_name}</p>
    <p>${quote.customer_address}</p>
    <p>${quote.project_description}</p>
    <p style="text-align:right"><b>QUOTE ID:</b> ${quote.quote_number} &nbsp; ${quote.quote_date}</p>
    <table>
      <tr><th>ITEMS</th><th>BRAND</th><th>LEAD TIME</th><th>QTY</th><th>UNIT</th><th>QUOTE/UNIT</th><th>TOTAL</th><th>AMOUNT</th></tr>
      ${rows}
      <tr><td colspan="6" style="text-align:right;font-weight:bold">Total (excl. PPN${ppnPct}%)</td>
          <td style="text-align:right">${fmtIdr(subtotal)}</td><td style="text-align:right">${fmtIdr(subtotal)}</td></tr>
      <tr><td colspan="6" style="text-align:right">PPN${ppnPct}%</td>
          <td style="text-align:right">${fmtIdr(ppn)}</td><td style="text-align:right">${fmtIdr(ppn)}</td></tr>
      <tr><td colspan="6" style="text-align:right;font-weight:bold">TOTAL</td>
          <td style="text-align:right;font-weight:bold">${fmtIdr(grandTotal)}</td>
          <td style="text-align:right;font-weight:bold">${fmtIdr(grandTotal)}</td></tr>
    </table></body></html>`;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${quote.quote_number || 'quote'}.xls`;
    a.click();
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loadingQuote || !quote) {
    return <div className="min-h-screen bg-[#0B1120] flex items-center justify-center text-slate-500">Loading…</div>;
  }

  const liveSections = sections.filter((s) => !s._deleted);

  return (
    <div className="min-h-screen bg-[#0B1120] text-slate-200 font-sans text-sm">

      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-40 bg-[#0B1120]/95 backdrop-blur-xl border-b border-white/[0.07]">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/quotes" className="text-slate-500 hover:text-slate-300 transition-colors flex-shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
            </Link>
            <div className="min-w-0">
              <p className="text-[11px] text-slate-500 truncate">{quote.customer_name || 'No customer'}</p>
              <p className="font-semibold text-white truncate text-base leading-tight">{quote.quote_number}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Status selector */}
            <select
              value={quote.status}
              onChange={(e) => setQuoteField('status', e.target.value as ProjectQuote['status'])}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider border-0 outline-none cursor-pointer ${STATUS_COLORS[quote.status]}`}
            >
              {STATUS_OPTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {saveMsg && <span className={`text-[11px] ${saveMsg === 'Saved' ? 'text-emerald-400' : 'text-red-400'}`}>{saveMsg}</span>}
            {dirty && !saving && <span className="text-[11px] text-amber-400">Unsaved</span>}
            <Link href={`/quotes/${id}/print`} target="_blank"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-slate-400 hover:text-white hover:bg-white/10 border border-white/[0.06] transition-all">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
              PDF
            </Link>
            <button onClick={exportExcel}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-slate-400 hover:text-white hover:bg-white/10 border border-white/[0.06] transition-all">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              Excel
            </button>
            <button onClick={save} disabled={saving || !dirty}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[11px] font-semibold bg-violet-600 hover:bg-violet-500 text-white transition-all disabled:opacity-40">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">

        {/* ── Header form ── */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Customer</label>
            <input value={quote.customer_name} onChange={(e) => setQuoteField('customer_name', e.target.value)}
              placeholder="Customer name" className="w-full bg-transparent border-b border-slate-700 focus:border-violet-500 outline-none text-white py-1 text-sm placeholder:text-slate-600 transition-colors" />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Address</label>
            <input value={quote.customer_address} onChange={(e) => setQuoteField('customer_address', e.target.value)}
              placeholder="Customer address" className="w-full bg-transparent border-b border-slate-700 focus:border-violet-500 outline-none text-white py-1 text-sm placeholder:text-slate-600 transition-colors" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Project Description</label>
            <input value={quote.project_description} onChange={(e) => setQuoteField('project_description', e.target.value)}
              placeholder="e.g. EPC for solar On Grid 2.2 kWp DC / 2 kW AC, at Kota Tangerang" className="w-full bg-transparent border-b border-slate-700 focus:border-violet-500 outline-none text-white py-1 text-sm placeholder:text-slate-600 transition-colors" />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Quote Number</label>
            <input value={quote.quote_number} onChange={(e) => setQuoteField('quote_number', e.target.value)}
              placeholder="e.g. 082-0126_RUMAHIBUDIANA" className="w-full bg-transparent border-b border-slate-700 focus:border-violet-500 outline-none text-white py-1 text-sm placeholder:text-slate-600 transition-colors" />
          </div>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Date</label>
              <input type="date" value={quote.quote_date} onChange={(e) => setQuoteField('quote_date', e.target.value)}
                className="w-full bg-transparent border-b border-slate-700 focus:border-violet-500 outline-none text-white py-1 text-sm transition-colors" />
            </div>
            <div className="w-24">
              <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">PPN %</label>
              <input type="number" value={quote.ppn_pct} onChange={(e) => setQuoteField('ppn_pct', parseFloat(e.target.value) || 11)}
                className="w-full bg-transparent border-b border-slate-700 focus:border-violet-500 outline-none text-white py-1 text-sm transition-colors" />
            </div>
          </div>
        </div>

        {/* ── Sections ── */}
        <div className="space-y-4" ref={acRef}>
          {liveSections.map((sec, secIdx) => {
            const liveItems = sec.items.filter((i) => !i._deleted);
            const mainItems = liveItems.filter((i) => !i.parent_item_id);
            const secSubtotal = mainItems.reduce((s, i) => s + (num(i.quantity) ?? 0) * (num(i.sell_price) ?? 0), 0);

            return (
              <div key={sec.section_id} className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
                {/* Section header */}
                <div className="flex items-center gap-3 px-4 py-3 bg-slate-800/60 border-b border-slate-700/50">
                  <input
                    value={sec.title}
                    onChange={(e) => updateSection(sec.section_id, { title: e.target.value })}
                    className="flex-1 bg-transparent outline-none font-semibold text-white placeholder:text-slate-500"
                    placeholder="Section title"
                  />
                  <select
                    value={sec.lead_time}
                    onChange={(e) => updateSection(sec.section_id, { lead_time: e.target.value })}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-300 outline-none"
                  >
                    {LEAD_TIMES.map((l) => <option key={l}>{l}</option>)}
                    {!LEAD_TIMES.includes(sec.lead_time) && sec.lead_time && (
                      <option value={sec.lead_time}>{sec.lead_time}</option>
                    )}
                  </select>
                  {secSubtotal > 0 && (
                    <span className="text-[11px] text-slate-400 whitespace-nowrap">{fmtIdr(secSubtotal)}</span>
                  )}
                  <button onClick={() => deleteSection(sec.section_id)} className="text-slate-600 hover:text-red-400 transition-colors p-1">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>

                {/* Items table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500">
                        <th className="text-left px-4 py-2 min-w-[260px]">Description</th>
                        <th className="text-left px-2 py-2 w-28">Brand</th>
                        <th className="text-right px-2 py-2 w-20">Qty</th>
                        <th className="text-left px-2 py-2 w-24">Unit</th>
                        <th className="text-right px-2 py-2 w-32 text-slate-600">TUC / Cost</th>
                        <th className="text-right px-2 py-2 w-32">Sell / Unit</th>
                        <th className="text-right px-2 py-2 w-16">GM %</th>
                        <th className="text-right px-2 py-2 w-28">Total</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40">
                      {mainItems.map((item) => {
                        const subItems = liveItems.filter((i) => i.parent_item_id === item.item_id);
                        const total = (num(item.quantity) ?? 0) * (num(item.sell_price) ?? 0);
                        const gm = gmFromPrices(item.cost_price, item.sell_price);
                        const isAcOpen = acState?.itemId === item.item_id;

                        return (
                          <React.Fragment key={item.item_id}>
                            {/* Main item row */}
                            <tr className="hover:bg-white/[0.02]">
                              <td className="px-4 py-2 relative">
                                <input
                                  value={item.description}
                                  onChange={(e) => {
                                    updateItem(sec.section_id, item.item_id, { description: e.target.value });
                                    setAcState({ sectionId: sec.section_id, itemId: item.item_id, query: e.target.value });
                                  }}
                                  onFocus={() => item.description && setAcState({ sectionId: sec.section_id, itemId: item.item_id, query: item.description })}
                                  placeholder="Type to search catalog…"
                                  className="w-full bg-transparent outline-none text-slate-200 placeholder:text-slate-700"
                                />
                                {/* Autocomplete dropdown */}
                                {isAcOpen && acResults.length > 0 && (
                                  <div className="absolute left-0 top-full z-30 mt-1 w-[420px] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
                                    {acResults.map((comp) => {
                                      const tuc = catalogLoading ? null : computeTUC(comp.component_id, catalog.pos, catalog.poItems, catalog.poCosts, catalog.quotes);
                                      return (
                                        <button
                                          key={comp.component_id}
                                          onMouseDown={(e) => { e.preventDefault(); selectComponent(sec.section_id, item.item_id, comp); }}
                                          className="w-full text-left px-4 py-2.5 hover:bg-slate-800 transition-colors flex items-center justify-between gap-3"
                                        >
                                          <div className="min-w-0">
                                            <p className="text-slate-200 font-medium truncate">{comp.supplier_model}</p>
                                            <p className="text-[10px] text-slate-500">{[comp.brand, comp.category].filter(Boolean).join(' · ')}</p>
                                          </div>
                                          <div className="text-right flex-shrink-0">
                                            {tuc ? <p className="text-violet-400 font-semibold text-xs">{fmtIdr(tuc.tuc)}</p>
                                                 : <p className="text-slate-600 text-[10px]">no TUC</p>}
                                            {tuc && <p className="text-[10px] text-slate-600">{tuc.poCount} PO{tuc.poCount !== 1 ? 's' : ''}</p>}
                                          </div>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </td>
                              <td className="px-2 py-2">
                                <input value={item.brand} onChange={(e) => updateItem(sec.section_id, item.item_id, { brand: e.target.value })}
                                  placeholder="Brand" className="w-full bg-transparent outline-none text-slate-300 placeholder:text-slate-700" />
                              </td>
                              <td className="px-2 py-2">
                                <input type="number" value={item.quantity} onChange={(e) => updateItem(sec.section_id, item.item_id, { quantity: e.target.value })}
                                  placeholder="0" className="w-full bg-transparent outline-none text-right text-slate-200 placeholder:text-slate-700" />
                              </td>
                              <td className="px-2 py-2">
                                <input list={`units-${item.item_id}`} value={item.unit}
                                  onChange={(e) => updateItem(sec.section_id, item.item_id, { unit: e.target.value })}
                                  placeholder="unit" className="w-full bg-transparent outline-none text-slate-300 placeholder:text-slate-700" />
                                <datalist id={`units-${item.item_id}`}>{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
                              </td>
                              <td className="px-2 py-2">
                                <input type="number" value={item.cost_price}
                                  onChange={(e) => updateItem(sec.section_id, item.item_id, { cost_price: e.target.value })}
                                  placeholder="0" className="w-full bg-transparent outline-none text-right text-slate-600 placeholder:text-slate-800" />
                              </td>
                              <td className="px-2 py-2">
                                <input type="number" value={item.sell_price}
                                  onChange={(e) => updateItem(sec.section_id, item.item_id, { sell_price: e.target.value })}
                                  placeholder="0" className="w-full bg-transparent outline-none text-right text-slate-200 placeholder:text-slate-700" />
                              </td>
                              <td className="px-2 py-2 text-right">
                                {gm ? (
                                  <input type="number" value={gm}
                                    onChange={(e) => {
                                      const s = sellFromGm(item.cost_price, e.target.value);
                                      if (s) updateItem(sec.section_id, item.item_id, { sell_price: s });
                                    }}
                                    className="w-full bg-transparent outline-none text-right text-emerald-400 placeholder:text-slate-700"
                                  />
                                ) : <span className="text-slate-700">—</span>}
                              </td>
                              <td className="px-2 py-2 text-right text-slate-300 font-medium whitespace-nowrap">
                                {total > 0 ? fmtIdr(total) : '—'}
                              </td>
                              <td className="pr-3 py-2">
                                <button onClick={() => deleteItem(sec.section_id, item.item_id)} className="text-slate-700 hover:text-red-400 transition-colors">
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                              </td>
                            </tr>
                            {/* Sub-items */}
                            {subItems.map((sub) => (
                              <tr key={sub.item_id} className="bg-slate-900/20">
                                <td className="pl-10 pr-4 py-1.5 flex items-center gap-2">
                                  <span className="text-slate-600 flex-shrink-0">↳</span>
                                  <input value={sub.description} onChange={(e) => updateItem(sec.section_id, sub.item_id, { description: e.target.value })}
                                    placeholder="Sub-item description" className="flex-1 bg-transparent outline-none text-slate-400 italic placeholder:text-slate-700 text-[11px]" />
                                </td>
                                <td className="px-2 py-1.5">
                                  <input value={sub.brand} onChange={(e) => updateItem(sec.section_id, sub.item_id, { brand: e.target.value })}
                                    className="w-full bg-transparent outline-none text-slate-500 text-[11px]" />
                                </td>
                                <td className="px-2 py-1.5">
                                  <input type="number" value={sub.quantity} onChange={(e) => updateItem(sec.section_id, sub.item_id, { quantity: e.target.value })}
                                    placeholder="0" className="w-full bg-transparent outline-none text-right text-slate-400 text-[11px]" />
                                </td>
                                <td className="px-2 py-1.5">
                                  <input list={`units-${sub.item_id}`} value={sub.unit} onChange={(e) => updateItem(sec.section_id, sub.item_id, { unit: e.target.value })}
                                    className="w-full bg-transparent outline-none text-slate-500 text-[11px]" />
                                  <datalist id={`units-${sub.item_id}`}>{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
                                </td>
                                <td /><td /><td /><td />
                                <td className="pr-3 py-1.5">
                                  <button onClick={() => deleteItem(sec.section_id, sub.item_id)} className="text-slate-700 hover:text-red-400 transition-colors">
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Section footer: add item / add sub-item buttons */}
                <div className="px-4 py-2 border-t border-slate-800/50 flex items-center gap-3">
                  <button onClick={() => addItem(sec.section_id)}
                    className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-violet-400 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                    Add item
                  </button>
                  {mainItems.length > 0 && (
                    <button onClick={() => addItem(sec.section_id, mainItems[mainItems.length - 1].item_id)}
                      className="flex items-center gap-1.5 text-[11px] text-slate-600 hover:text-slate-400 transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                      Add sub-item to last
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* Add section */}
          <button onClick={addSection}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-dashed border-slate-700 hover:border-violet-500 text-slate-500 hover:text-violet-400 transition-all text-sm">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
            Add section
          </button>
        </div>

        {/* ── Totals ── */}
        {subtotal > 0 && (
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 ml-auto max-w-sm space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Subtotal (excl. PPN)</span>
              <span className="font-semibold text-white tabular-nums">{fmtIdr(subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">PPN {quote.ppn_pct}%</span>
              <span className="text-slate-300 tabular-nums">{fmtIdr(ppn)}</span>
            </div>
            <div className="flex justify-between text-base font-bold border-t border-slate-700 pt-2 mt-2">
              <span className="text-white">Grand Total</span>
              <span className="text-white tabular-nums">{fmtIdr(grandTotal)}</span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

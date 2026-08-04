'use client';
/**
 * ICAPROC — After Sales (Module 27)
 * The service history a WhatsApp thread can't give you: every warranty claim,
 * repair and replacement as a CASE — attached to the customer, the sales order
 * it came from, and the catalog items involved, so failure counts can roll up
 * per product and support cost per customer stops being a guess.
 *
 * A case is a lifecycle (open → in progress → waiting parts → resolved →
 * closed), a categorised cause (warranty / repair / replacement / …), the
 * parts touched (each with its own action: replaced / repaired / …), and a
 * dated log of updates. Parts link to `3.0_components` but keep their text
 * description, so history survives a catalog edit.
 *
 * Sell-side rules apply: items show internal descriptions only — never brand
 * or supplier model. Writes gate on `canEditSalesDocs`.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import BrandMenu from '@/components/ui/BrandMenu';
import RichDropdown from '@/components/ui/RichDropdown';
import LayoutToggle from '@/components/ui/LayoutToggle';
import DateRangeFilter from '@/components/ui/DateRangeFilter';
import { useListLayout } from '@/hooks/useListLayout';
import { useListDefaults } from '@/hooks/useListDefaults';
import { inRange, type DateRange } from '@/lib/dateRange';
import { fmtDay, fmtDayTime, fmtInt } from '@/lib/formatters';
import { SALES_STATUS } from '@/lib/salesStatus';

interface Case {
  case_id: string; case_number: string; customer_id: string | null; quote_id: string | null;
  category: string; status: string; subject: string; description: string; resolution: string;
  reported_at: string; resolved_at: string | null;
  created_at: string; updated_at: string; created_by_email: string; updated_by_email: string;
}
interface Part { part_id: string; case_id: string; component_id: string | null; description: string; action: string; quantity: number; notes: string }
interface Update { update_id: string; case_id: string; note: string; created_at: string; created_by_email: string }
interface Customer { customer_id: string; display_name: string; legal_name: string }
interface Order { quote_id: string; quote_number: string; order_number: string | null; status: string; customer_id: string | null; case_id?: string | null; grand_total?: number }
interface Comp { component_id: string; internal_description: string | null }

const CATEGORIES: Record<string, { label: string; cls: string }> = {
  warranty:    { label: 'Warranty',    cls: 'bg-violet-500/15 text-violet-300' },
  repair:      { label: 'Repair',      cls: 'bg-sky-500/15 text-sky-300' },
  replacement: { label: 'Replacement', cls: 'bg-amber-500/15 text-amber-300' },
  maintenance: { label: 'Maintenance', cls: 'bg-emerald-500/15 text-emerald-300' },
  complaint:   { label: 'Complaint',   cls: 'bg-rose-500/15 text-rose-300' },
  inspection:  { label: 'Inspection',  cls: 'bg-teal-500/15 text-teal-300' },
  other:       { label: 'Other',       cls: 'bg-slate-700/40 text-slate-300' },
};
const ACTIONS: Record<string, string> = {
  replaced: 'Replaced', repaired: 'Repaired', inspected: 'Inspected',
  returned: 'Returned', missing: 'Missing', other: 'Other',
};
// Open work first — the page exists to answer "what is still broken?"
const STATUS_SECTIONS: { key: string; label: string; accent: string; rule: string }[] = [
  { key: 'open',          label: 'Open',          accent: 'text-rose-300',    rule: 'bg-rose-500/20' },
  { key: 'in_progress',   label: 'In progress',   accent: 'text-sky-300',     rule: 'bg-sky-500/20' },
  { key: 'waiting_parts', label: 'Waiting parts', accent: 'text-amber-300',   rule: 'bg-amber-500/20' },
  { key: 'resolved',      label: 'Resolved',      accent: 'text-emerald-300', rule: 'bg-emerald-500/20' },
  { key: 'closed',        label: 'Closed',        accent: 'text-slate-500',   rule: 'bg-slate-700/40' },
];
const STATUS_BADGE: Record<string, string> = {
  open: 'bg-rose-500/15 text-rose-300', in_progress: 'bg-sky-500/15 text-sky-300',
  waiting_parts: 'bg-amber-500/15 text-amber-300', resolved: 'bg-emerald-500/15 text-emerald-300',
  closed: 'bg-slate-700/40 text-slate-400',
};
const statusLabel = (s: string) => STATUS_SECTIONS.find((x) => x.key === s)?.label ?? s;

interface DraftPart { part_id?: string; component_id: string | null; description: string; action: string; quantity: string; notes: string }
interface QuoteItem { quote_id: string; description: string; quantity: number; is_section: boolean }

export default function AfterSalesPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const perms = profile ? ROLE_PERMISSIONS[profile.role] : null;
  const canEdit = !!perms?.canEditSalesDocs;

  const [cases, setCases] = useState<Case[]>([]);
  const [partsByCase, setPartsByCase] = useState<Map<string, Part[]>>(new Map());
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [comps, setComps] = useState<Comp[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  // Settings › Lists decides the period this list opens on (reported date),
  // until someone widens it themselves.
  const listDefaults = useListDefaults('aftersales');
  const [range, setRange] = useState<DateRange>(listDefaults.range);
  const listTouched = useRef(false);
  useEffect(() => {
    if (!listTouched.current) setRange(listDefaults.range);
  }, [listDefaults.range.from, listDefaults.range.to]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [layout, setLayout] = useListLayout('aftersales');
  const compact = layout === 'compact';
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };

  // Editor state
  const [editing, setEditing] = useState<Case | 'new' | null>(null);
  const [draft, setDraft] = useState<Partial<Case>>({});
  const [draftParts, setDraftParts] = useState<DraftPart[]>([]);
  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>([]);
  const [updates, setUpdates] = useState<Update[]>([]);
  const [newNote, setNewNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => { document.title = 'After Sales — ICAPROC'; }, []);
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/aftersales')}`); return; }
    if (profile && !perms?.sellSide) router.replace('/unauthorized');
  }, [authLoading, user, profile, perms?.sellSide, router]);

  const load = useCallback(async () => {
    setLoading(true);
    const [cRes, pRes, custRes, oRes, compRes, qiRes] = await Promise.all([
      supabase.from('27.0_aftersales_cases').select('*').order('reported_at', { ascending: false }),
      supabase.from('27.1_aftersales_parts').select('*'),
      supabase.from('20.0_customers').select('customer_id, display_name, legal_name').order('display_name'),
      supabase.from('22.0_sales_quotes').select('quote_id, quote_number, order_number, status, customer_id, case_id, grand_total'),
      supabase.from('3.0_components').select('component_id, internal_description').order('internal_description'),
      supabase.from('22.1_sales_quote_items').select('quote_id, description, quantity, is_section').order('sort_order'),
    ]);
    setCases((cRes.data as Case[]) ?? []);
    const by = new Map<string, Part[]>();
    for (const p of (pRes.data as Part[]) ?? []) by.set(p.case_id, [...(by.get(p.case_id) ?? []), p]);
    setPartsByCase(by);
    setCustomers((custRes.data as Customer[]) ?? []);
    setOrders((oRes.data as Order[]) ?? []);
    setComps(((compRes.data as Comp[]) ?? []).filter((c) => c.internal_description?.trim()));
    setQuoteItems(((qiRes.error ? [] : qiRes.data as QuoteItem[]) ?? []).filter((l) => !l.is_section && (l.description ?? '').trim()));
    setLoading(false);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (user && perms?.sellSide) load(); }, [user, perms?.sellSide, load]);

  const custName = useMemo(() => new Map(customers.map((c) => [c.customer_id, c.display_name || c.legal_name])), [customers]);
  const orderById = useMemo(() => new Map(orders.map((o) => [o.quote_id, o])), [orders]);
  const compByDesc = useMemo(() => new Map(comps.map((c) => [(c.internal_description ?? '').trim().toLowerCase(), c])), [comps]);

  const orderLabel = (id: string | null) => {
    const o = id ? orderById.get(id) : null;
    return o ? (o.order_number || o.quote_number || '—') : '';
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cases.filter((c) => {
      if (catFilter && c.category !== catFilter) return false;
      if (!inRange((c.reported_at ?? '').slice(0, 10), range)) return false;
      if (!q) return true;
      const parts = (partsByCase.get(c.case_id) ?? []).map((p) => p.description).join(' ');
      return `${c.case_number} ${c.subject} ${c.description} ${custName.get(c.customer_id ?? '') ?? ''} ${orderLabel(c.quote_id)} ${parts}`
        .toLowerCase().includes(q);
    });
  }, [cases, search, catFilter, range, custName, partsByCase, orderById]);   // eslint-disable-line react-hooks/exhaustive-deps

  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cases) m.set(c.category, (m.get(c.category) ?? 0) + 1);
    return m;
  }, [cases]);
  const openCount = cases.filter((c) => !['resolved', 'closed'].includes(c.status)).length;

  // ── Editor ────────────────────────────────────────────────────────────────
  const openEditor = async (c: Case | 'new') => {
    setEditing(c);
    setNewNote('');
    if (c === 'new') {
      setDraft({ category: 'repair', status: 'open', reported_at: new Date().toISOString().slice(0, 10), subject: '', description: '', resolution: '', customer_id: null, quote_id: null });
      setDraftParts([]);
      setUpdates([]);
    } else {
      setDraft({ ...c });
      setDraftParts((partsByCase.get(c.case_id) ?? []).map((p) => ({
        part_id: p.part_id, component_id: p.component_id, description: p.description,
        action: p.action, quantity: String(p.quantity), notes: p.notes,
      })));
      const { data } = await supabase.from('27.2_aftersales_updates').select('*').eq('case_id', c.case_id).order('created_at', { ascending: false });
      setUpdates((data as Update[]) ?? []);
    }
  };

  const set = (k: keyof Case, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));

  async function save() {
    if (!canEdit || busy) return;
    if (!draft.subject?.trim() && !draft.description?.trim()) { flash('Give the case a subject.'); return; }
    setBusy(true);
    try {
      const row = {
        customer_id: draft.customer_id || null,
        quote_id: draft.quote_id || null,
        category: draft.category ?? 'repair',
        status: draft.status ?? 'open',
        subject: draft.subject?.trim() ?? '',
        description: draft.description ?? '',
        resolution: draft.resolution ?? '',
        reported_at: draft.reported_at || new Date().toISOString().slice(0, 10),
      };
      let caseId = editing !== 'new' && editing ? editing.case_id : null;
      if (caseId) {
        const { error } = await supabase.from('27.0_aftersales_cases').update(row).eq('case_id', caseId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('27.0_aftersales_cases').insert(row).select('case_id').single();
        if (error) throw error;
        caseId = (data as { case_id: string }).case_id;
      }
      // Parts are replaced wholesale — same rule as imported order lines, so an
      // edit can remove a line without a separate delete flow.
      await supabase.from('27.1_aftersales_parts').delete().eq('case_id', caseId);
      const rows = draftParts
        .filter((p) => p.description.trim())
        .map((p) => ({
          case_id: caseId, component_id: p.component_id,
          description: p.description.trim(), action: p.action,
          quantity: Number(p.quantity) || 1, notes: p.notes,
        }));
      if (rows.length) {
        const { error } = await supabase.from('27.1_aftersales_parts').insert(rows);
        if (error) throw error;
      }
      setEditing(null);
      flash('Case saved.');
      load();
    } catch (e) {
      flash(`Could not save — ${(e as Error).message}`);
    } finally { setBusy(false); }
  }

  async function addNote() {
    if (!canEdit || !newNote.trim() || editing === 'new' || !editing) return;
    const { error } = await supabase.from('27.2_aftersales_updates').insert({ case_id: editing.case_id, note: newNote.trim() });
    if (error) { flash(`Could not add the note — ${error.message}`); return; }
    setNewNote('');
    const { data } = await supabase.from('27.2_aftersales_updates').select('*').eq('case_id', editing.case_id).order('created_at', { ascending: false });
    setUpdates((data as Update[]) ?? []);
  }

  const customerOrders = useMemo(
    () => orders.filter((o) => !draft.customer_id || o.customer_id === draft.customer_id),
    [orders, draft.customer_id]);
  const customerOptions = useMemo(() => customers.map((c) => ({
    customer_id: c.customer_id,
    name: c.display_name || c.legal_name,
    sub: c.legal_name && c.legal_name !== (c.display_name || c.legal_name) ? c.legal_name : '',
  })), [customers]);
  const orderOptions = useMemo(() => customerOrders.map((o) => ({
    quote_id: o.quote_id,
    label: o.order_number || o.quote_number || '—',
    sub: [custName.get(o.customer_id ?? ''), o.status].filter(Boolean).join(' · '),
  })), [customerOrders, custName]);
  // The items ON the selected order — offered as one-click chips, because a
  // case about SO-x is almost always about something that was on SO-x.
  const soItems = useMemo(
    () => (draft.quote_id ? quoteItems.filter((l) => l.quote_id === draft.quote_id) : []),
    [quoteItems, draft.quote_id]);
  // Quotes raised FOR this case (repair / replacement offers)
  const caseQuotes = useMemo(
    () => (editing && editing !== 'new' ? orders.filter((o) => o.case_id === editing.case_id) : []),
    [orders, editing]);

  if (authLoading || !user) {
    return <div className="min-h-screen bg-chrome flex items-center justify-center"><div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" /></div>;
  }

  const inputCls = 'w-full h-9 px-3 rounded-lg bg-slate-900 border border-slate-700 focus:border-emerald-500/60 outline-none text-white text-sm placeholder:text-slate-600 transition-colors';

  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1400px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between sm:flex-wrap gap-2.5 sm:gap-4">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="After Sales · Service & warranty cases" />
          {canEdit && (
            <button onClick={() => openEditor('new')}
              className="self-start sm:self-auto px-3.5 py-2 rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 text-xs font-semibold whitespace-nowrap transition-colors">
              + New Case
            </button>
          )}
        </div>
      </div>

      <main className="max-w-[1400px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-6 space-y-5">
        {toast && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-200">{toast}</div>}

        {/* ── Filters ── */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search case, customer, order, item…"
              className="w-full pl-10 pr-4 h-10 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-white text-base sm:text-sm placeholder:text-[13px] sm:placeholder:text-sm placeholder:text-slate-500 transition-colors" />
          </div>
          {Object.entries(CATEGORIES).map(([k, c]) => (
            <button key={k} onClick={() => setCatFilter(catFilter === k ? '' : k)}
              className={`text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${catFilter === k ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 font-bold' : 'border-slate-700/80 text-slate-500 hover:text-slate-300'}`}>
              {c.label}{catCounts.get(k) ? ` ${catCounts.get(k)}` : ''}
            </button>
          ))}
          <DateRangeFilter value={range} onChange={(r) => { listTouched.current = true; setRange(r); }} label="Reported" />
          <LayoutToggle value={layout} onChange={setLayout} />
        </div>

        {loading ? (
          <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-slate-800/40 rounded-2xl animate-pulse" />)}</div>
        ) : cases.length === 0 ? (
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-10 text-center space-y-2">
            <p className="text-slate-300 font-semibold">No after-sales cases yet</p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              When a customer reports a fault, log it here — attached to their sales order and the items involved —
              and the service history builds itself.
            </p>
            {canEdit && (
              <button onClick={() => openEditor('new')} className="text-xs font-semibold text-emerald-300 hover:text-emerald-200 transition-colors">
                Log the first case →
              </button>
            )}
          </div>
        ) : visible.length === 0 ? (
          <p className="text-slate-500 text-xs italic py-10 text-center">No case matches.</p>
        ) : (
          <div className="space-y-7">
            {STATUS_SECTIONS.map(({ key, label, accent, rule }) => {
              const group = visible.filter((c) => c.status === key);
              if (!group.length) return null;
              return (
                <div key={key}>
                  <div className="flex items-center gap-3 mb-2.5 px-1">
                    <h2 className={`text-xs font-bold uppercase tracking-widest ${accent}`}>{label}</h2>
                    <span className="text-[11px] text-slate-600 tabular-nums">{group.length}</span>
                    <div className={`flex-1 h-px ${rule}`} />
                  </div>
                  <div className="space-y-2">
                    {group.map((c) => {
                      const parts = partsByCase.get(c.case_id) ?? [];
                      const cat = CATEGORIES[c.category] ?? CATEGORIES.other;
                      return (
                        <button key={c.case_id} onClick={() => openEditor(c)}
                          className={`w-full text-left bg-slate-900/50 hover:bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition-all ${compact ? 'rounded-lg px-3 py-2' : 'rounded-2xl px-4 sm:px-5 py-3.5'}`}>
                          {compact ? (
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-semibold text-slate-100 text-[13px] truncate flex-shrink-0 max-w-[30%]">{custName.get(c.customer_id ?? '') || 'No customer'}</span>
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold whitespace-nowrap flex-shrink-0 ${cat.cls}`}>{cat.label}</span>
                              <span className="text-[11px] text-slate-400 truncate">{c.subject || c.description || '—'}</span>
                              <span className="ml-auto flex items-center gap-3 flex-shrink-0 tabular-nums">
                                {parts.length > 0 && <span className="text-[10px] text-slate-500">{fmtInt(parts.length)} item{parts.length !== 1 ? 's' : ''}</span>}
                                <span className="font-mono text-[10px] text-slate-600 hidden sm:block">{c.case_number}</span>
                                <span className="w-[4.5rem] text-right text-[10px] text-slate-500">{fmtDay(c.reported_at)}</span>
                              </span>
                            </div>
                          ) : (
                            <>
                              <div className="flex flex-wrap items-center gap-2 mb-1">
                                <span className="font-semibold text-white truncate">{custName.get(c.customer_id ?? '') || 'No customer'}</span>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap flex-shrink-0 ${cat.cls}`}>{cat.label}</span>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap flex-shrink-0 ${STATUS_BADGE[c.status]}`}>{statusLabel(c.status)}</span>
                                {c.quote_id && <span className="font-mono text-[10px] text-slate-500">{orderLabel(c.quote_id)}</span>}
                              </div>
                              {(c.subject || c.description) && <p className="text-xs text-slate-400 truncate mb-1">{c.subject || c.description}</p>}
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                                <span className="font-mono">{c.case_number}</span>
                                <span>reported {fmtDay(c.reported_at)}</span>
                                {c.resolved_at && <span className="text-emerald-400/80">resolved {fmtDay(c.resolved_at)}</span>}
                                {parts.length > 0 && (
                                  <span className="truncate max-w-[24rem]">
                                    {parts.map((p) => `${ACTIONS[p.action] ?? p.action}: ${p.description}`).join(' · ')}
                                  </span>
                                )}
                              </div>
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-[10px] text-slate-600 max-w-3xl">
          {openCount > 0 ? `${fmtInt(openCount)} case${openCount !== 1 ? 's' : ''} still open. ` : ''}
          Parts logged here do not move stock — a warranty replacement that should leave the warehouse is issued from{' '}
          <Link href="/stock" className="text-emerald-500/80 hover:text-emerald-300">Stock</Link> as its own movement.
        </p>
      </main>

      {/* ── Case editor (portaled: headers use backdrop-blur, which WebKit
             treats as a containing block for fixed descendants) ── */}
      {editing && mounted && createPortal(
        <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => !busy && setEditing(null)} />
          <div className="relative bg-slate-900 border border-slate-700 sm:rounded-2xl rounded-t-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-white">{editing === 'new' ? 'New after-sales case' : (editing.case_number || 'Case')}</h3>
                {editing !== 'new' && (
                  <p className="text-[10px] text-slate-600 mt-0.5">
                    opened by {editing.created_by_email || '—'} · {fmtDayTime(editing.created_at)}
                  </p>
                )}
              </div>
              <button onClick={() => !busy && setEditing(null)} className="text-slate-500 hover:text-white p-1 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              {/* Searchable comboboxes (same component as the Payment pickers) —
                  489 customers do not fit a native select. */}
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Customer</span>
                <fieldset disabled={!canEdit} className={!canEdit ? 'opacity-60 pointer-events-none' : ''}>
                  <RichDropdown
                    options={customerOptions}
                    value={draft.customer_id ?? ''}
                    placeholder="Search customer…"
                    config={{ labelKey: 'name', valueKey: 'customer_id', subLabelKey: 'sub' }}
                    onChange={(v: any) => { set('customer_id', v || null); set('quote_id', null); }}
                  />
                </fieldset>
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Sales order / document</span>
                <fieldset disabled={!canEdit} className={!canEdit ? 'opacity-60 pointer-events-none' : ''}>
                  <RichDropdown
                    options={orderOptions}
                    value={draft.quote_id ?? ''}
                    placeholder="Search SO / SQ number…"
                    config={{ labelKey: 'label', valueKey: 'quote_id', subLabelKey: 'sub' }}
                    onChange={(v: any) => v && !draft.customer_id
                      ? (set('quote_id', v), set('customer_id', orderById.get(String(v))?.customer_id ?? null))
                      : set('quote_id', v || null)}
                  />
                </fieldset>
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Category</span>
                <select className={inputCls} value={draft.category ?? 'repair'} disabled={!canEdit} onChange={(e) => set('category', e.target.value)}>
                  {Object.entries(CATEGORIES).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Status</span>
                <select className={inputCls} value={draft.status ?? 'open'} disabled={!canEdit} onChange={(e) => set('status', e.target.value)}>
                  {STATUS_SECTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Reported</span>
                <input type="date" className={inputCls} value={draft.reported_at ?? ''} disabled={!canEdit} onChange={(e) => set('reported_at', e.target.value)} />
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Subject</span>
                <input className={inputCls} value={draft.subject ?? ''} disabled={!canEdit} placeholder="e.g. Inverter fault E-07"
                  onChange={(e) => set('subject', e.target.value)} />
              </label>
            </div>

            <label className="block">
              <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Description</span>
              <textarea rows={2} className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 focus:border-emerald-500/60 outline-none text-white text-sm placeholder:text-slate-600 resize-y transition-colors"
                value={draft.description ?? ''} disabled={!canEdit} placeholder="What the customer reported"
                onChange={(e) => set('description', e.target.value)} />
            </label>

            {/* ── Parts / items involved ── */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] uppercase tracking-widest text-slate-500">Items involved</span>
                {canEdit && (
                  <button onClick={() => setDraftParts((p) => [...p, { component_id: null, description: '', action: 'repaired', quantity: '1', notes: '' }])}
                    className="text-[11px] font-semibold text-emerald-300 hover:text-emerald-200 transition-colors">+ Add item</button>
                )}
              </div>
              {/* The selected SO's own lines, one click to log — items and case connected */}
              {canEdit && soItems.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                  <span className="text-[10px] text-slate-600 flex-shrink-0">On this order:</span>
                  {soItems.map((l, k) => {
                    const added = draftParts.some((p) => p.description.trim().toLowerCase() === l.description.trim().toLowerCase());
                    return (
                      <button key={k} type="button" disabled={added}
                        onClick={() => setDraftParts((p) => [...p, {
                          component_id: compByDesc.get(l.description.trim().toLowerCase())?.component_id ?? null,
                          description: l.description, action: 'repaired', quantity: '1', notes: '',
                        }])}
                        className={`px-2 py-0.5 rounded-md border text-[11px] max-w-[16rem] truncate transition-colors ${
                          added ? 'border-slate-800 text-slate-600 cursor-default'
                                : 'border-slate-700/70 text-slate-300 hover:border-emerald-500/40 hover:text-emerald-300'}`}
                        title={added ? 'Already listed' : `Add ${l.description}`}>
                        {added ? '✓' : '+'} {l.description}
                      </button>
                    );
                  })}
                </div>
              )}
              {draftParts.length === 0 ? (
                <p className="text-[11px] text-slate-600 italic">No items logged.</p>
              ) : (
                <div className="space-y-2">
                  {draftParts.map((p, i) => (
                    <div key={i} className="grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,1fr)_120px_64px_auto] gap-2 items-start">
                      <div className="col-span-2 sm:col-span-1">
                        <input list="aftersales-items" className={inputCls} value={p.description} disabled={!canEdit}
                          placeholder="Item — type to search the catalog"
                          onChange={(e) => {
                            const v = e.target.value;
                            const hit = compByDesc.get(v.trim().toLowerCase());
                            setDraftParts((arr) => arr.map((x, j) => j === i ? { ...x, description: v, component_id: hit?.component_id ?? null } : x));
                          }} />
                        {p.component_id && <p className="text-[9px] text-emerald-400/80 mt-0.5">linked to catalog</p>}
                      </div>
                      <select className={inputCls} value={p.action} disabled={!canEdit}
                        onChange={(e) => setDraftParts((arr) => arr.map((x, j) => j === i ? { ...x, action: e.target.value } : x))}>
                        {Object.entries(ACTIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                      <input type="number" min={1} className={inputCls} value={p.quantity} disabled={!canEdit} title="Quantity"
                        onChange={(e) => setDraftParts((arr) => arr.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} />
                      {canEdit && (
                        <button onClick={() => setDraftParts((arr) => arr.filter((_, j) => j !== i))}
                          className="h-9 px-2 text-slate-600 hover:text-red-400 transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <datalist id="aftersales-items">
                {comps.map((c) => <option key={c.component_id} value={c.internal_description ?? ''} />)}
              </datalist>
            </div>

            {/* ── Repair / replacement quotes — the case's own quote pipeline.
                One system: an after-sales quote IS a sales quote linked to
                this case, so it inherits the editor, library, print and the
                SO → invoice flow for billable work. ── */}
            {editing !== 'new' && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] uppercase tracking-widest text-slate-500">Repair / replacement quotes</span>
                  {canEdit && (
                    <a href={`/sales/new?case=${(editing as Case).case_id}${draft.customer_id ? `&customer=${draft.customer_id}` : ''}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-[11px] font-semibold text-emerald-300 hover:text-emerald-200 transition-colors">+ New quote</a>
                  )}
                </div>
                {caseQuotes.length === 0 ? (
                  <p className="text-[11px] text-slate-600 italic">No quote for this case yet — repairs and component replacements are quoted from here.</p>
                ) : (
                  <div className="rounded-lg border border-slate-800 divide-y divide-slate-800/60">
                    {caseQuotes.map((q) => (
                      <a key={q.quote_id} href={`/sales/${q.quote_id}`} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] hover:bg-slate-800/40 transition-colors">
                        <span className="font-mono text-slate-300">{q.order_number || q.quote_number}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${SALES_STATUS[q.status]?.cls ?? ''}`}>{SALES_STATUS[q.status]?.label ?? q.status}</span>
                        <span className="ml-auto tabular-nums text-slate-200 font-semibold">{fmtInt(Number(q.grand_total) || 0)}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            {(draft.status === 'resolved' || draft.status === 'closed' || (draft.resolution ?? '') !== '') && (
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Resolution</span>
                <textarea rows={2} className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 focus:border-emerald-500/60 outline-none text-white text-sm placeholder:text-slate-600 resize-y transition-colors"
                  value={draft.resolution ?? ''} disabled={!canEdit} placeholder="How it was fixed"
                  onChange={(e) => set('resolution', e.target.value)} />
              </label>
            )}

            {/* ── Update log (existing cases only) ── */}
            {editing !== 'new' && (
              <div>
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Log</span>
                {canEdit && (
                  <div className="flex gap-2 mb-2">
                    <input className={inputCls} value={newNote} placeholder="Add an update — parts ordered, technician visit, customer called…"
                      onChange={(e) => setNewNote(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') addNote(); }} />
                    <button onClick={addNote} disabled={!newNote.trim()}
                      className="h-9 px-3 rounded-lg bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition-colors disabled:opacity-40 whitespace-nowrap">
                      Add
                    </button>
                  </div>
                )}
                {updates.length === 0 ? (
                  <p className="text-[11px] text-slate-600 italic">No updates yet.</p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {updates.map((u) => (
                      <div key={u.update_id} className="rounded-lg bg-slate-950/50 border border-slate-800 px-3 py-2">
                        <p className="text-xs text-slate-300">{u.note}</p>
                        <p className="text-[10px] text-slate-600 mt-0.5">{u.created_by_email.split('@')[0] || '—'} · {fmtDayTime(u.created_at)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canEdit && (
              <div className="flex justify-end gap-3 pt-1">
                <button onClick={() => setEditing(null)} disabled={busy}
                  className="px-4 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 text-sm transition-colors disabled:opacity-50">Cancel</button>
                <button onClick={save} disabled={busy}
                  className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                  {busy ? 'Saving…' : 'Save case'}
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

'use client';
/**
 * ICAPROC — Surat Dukungan (Support Letters, Module 28)
 *
 * The register of every letter of support we have issued as principal, and
 * the machine that writes the next one in about a minute.
 *
 * Why it exists: admin used to wait for the fee, then open last month's
 * letter, duplicate it and overtype the names — no register, no way to answer
 * "which projects are we backing?". Here the clauses are pre-formatted, the
 * customer comes from CRM, the items and their warranties come from the item
 * master, and the fee is tracked on the letter itself.
 *
 * Everything on the list filters and sorts both ways, and the search box
 * suggests as you type (numbers, customers, projects, end users).
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import BrandMenu from '@/components/ui/BrandMenu';
import RichDropdown from '@/components/ui/RichDropdown';
import LayoutToggle from '@/components/ui/LayoutToggle';
import DateRangeFilter from '@/components/ui/DateRangeFilter';
import { useListLayout } from '@/hooks/useListLayout';
import { inRange, todayISO, type DateRange } from '@/lib/dateRange';
import { fmtDay, fmtInt, fmtRupiah } from '@/lib/formatters';
import { formatCategory as humanize } from '@/lib/formatCategory';
import {
  LETTER_STATUS, DEFAULT_LETTER_FEE, DEFAULT_STATEMENTS, DEFAULT_VALIDITY_NOTE,
  DEFAULT_CLOSING_NOTE, brandsOf, warrantyTextID, previewLetterNumber,
  type SupportLetter, type SupportLetterItem, type LetterStatus,
} from '@/lib/supportLetters';

interface Customer {
  customer_id: string; display_name: string; legal_name: string;
  billing_address: string | null; account_manager_id: string | null;
}
interface Contact { customer_id: string; name: string; title: string; is_primary: boolean }
interface Comp {
  component_id: string; supplier_model: string; internal_description: string | null;
  brand: string | null; category: string | null;
  warranty: string | null; warranty_value: number | null; warranty_unit: string | null;
}
interface Profile { id: string; email: string; display_name: string | null }
interface Company { company_id: string; legal_name: string }

/** A row of the "Material yang didukung" table while it is being edited. */
interface DraftItem {
  key: string; component_id: string | null;
  category_label: string; type_text: string; warranty_text: string;
}
let itemSeq = 0;
const blankItem = (): DraftItem => ({
  key: `sli-${itemSeq++}`, component_id: null, category_label: '', type_text: '', warranty_text: '',
});

type SortKey = 'number' | 'date' | 'customer' | 'project' | 'enduser' | 'rep' | 'author' | 'items' | 'fee' | 'status';
const DEFAULT_DIR: Record<SortKey, 1 | -1> = {
  number: -1, date: -1, customer: 1, project: 1, enduser: 1, rep: 1, author: 1, items: -1, fee: -1, status: 1,
};

export default function SupportLettersPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const settings = useSettings();
  const { user, profile, loading: authLoading } = useAuth();
  const perms = profile ? ROLE_PERMISSIONS[profile.role] : null;
  const canEdit = !!perms?.canEditSalesDocs;

  const [letters, setLetters] = useState<SupportLetter[]>([]);
  const [itemsByLetter, setItemsByLetter] = useState<Map<string, SupportLetterItem[]>>(new Map());
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [comps, setComps] = useState<Comp[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3200); };

  // Filters
  const [search, setSearch] = useState('');
  const [showSuggest, setShowSuggest] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'' | LetterStatus>('');
  const [custFilter, setCustFilter] = useState('');
  const [repFilter, setRepFilter] = useState('');
  const [payFilter, setPayFilter] = useState<'' | 'paid' | 'unpaid'>('');
  const [range, setRange] = useState<DateRange>({ from: '', to: '' });
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'date', dir: -1 });
  const [layout, setLayout] = useListLayout('support-letters');
  const compact = layout === 'compact';
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Editor
  const [editing, setEditing] = useState<SupportLetter | 'new' | null>(null);
  const [draft, setDraft] = useState<Partial<SupportLetter>>({});
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => { document.title = 'Support Letters — ICAPROC'; }, []);
  // ?q= deep link (the customer profile's "All →" arrives with the name).
  // Read straight off the URL so the page needs no Suspense boundary.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q');
    if (q) setSearch(q);
  }, []);
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/support-letters')}`); return; }
    if (profile && !perms?.sellSide) router.replace('/unauthorized');
  }, [authLoading, user, profile, perms?.sellSide, router]);

  const load = useCallback(async () => {
    setLoading(true);
    const [lRes, iRes, cRes, ctRes, compRes, pRes, coRes] = await Promise.all([
      supabase.from('28.0_support_letters').select('*').order('letter_date', { ascending: false }),
      supabase.from('28.1_support_letter_items').select('*').order('sort_order'),
      supabase.from('20.0_customers').select('customer_id, display_name, legal_name, billing_address, account_manager_id').order('display_name'),
      supabase.from('20.1_customer_contacts').select('customer_id, name, title, is_primary'),
      supabase.from('3.0_components').select('component_id, supplier_model, internal_description, brand, category, warranty, warranty_value, warranty_unit').order('internal_description').limit(5000),
      supabase.from('user_profiles').select('id, email, display_name').in('role', ['owner', 'sales', 'sell_admin']),
      supabase.from('1.0_companies').select('company_id, legal_name'),
    ]);
    setLetters((lRes.data as SupportLetter[]) ?? []);
    const by = new Map<string, SupportLetterItem[]>();
    for (const it of (iRes.data as SupportLetterItem[]) ?? []) by.set(it.letter_id, [...(by.get(it.letter_id) ?? []), it]);
    setItemsByLetter(by);
    setCustomers((cRes.data as Customer[]) ?? []);
    setContacts((ctRes.data as Contact[]) ?? []);
    setComps((compRes.data as Comp[]) ?? []);
    setProfiles((pRes.error ? [] : pRes.data as Profile[]) ?? []);
    setCompanies((coRes.error ? [] : coRes.data as Company[]) ?? []);
    setLoading(false);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (user && perms?.sellSide) load(); }, [user, perms?.sellSide, load]);

  const custById = useMemo(() => new Map(customers.map((c) => [c.customer_id, c])), [customers]);
  const compById = useMemo(() => new Map(comps.map((c) => [c.component_id, c])), [comps]);
  const repName = useCallback((id: string | null) => {
    const p = id ? profiles.find((x) => x.id === id) : null;
    return p ? (p.display_name || p.email.split('@')[0]) : '';
  }, [profiles]);
  const custName = useCallback((id: string | null, fallback = '') => {
    const c = id ? custById.get(id) : null;
    return c ? (c.display_name || c.legal_name) : fallback;
  }, [custById]);

  // ── Search suggestions: every letter number, customer, project and end user
  //    already on file. Typing filters instantly; picking one pins the term. ──
  const suggestions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const pool = new Map<string, string>();   // lowercase → display, deduped
    const add = (v: string, kind: string) => {
      const t = (v ?? '').trim();
      if (t && t.toLowerCase().includes(q)) pool.set(`${kind}:${t.toLowerCase()}`, `${t}||${kind}`);
    };
    for (const l of letters) {
      add(l.letter_number, 'Number');
      add(custName(l.customer_id, l.supported_company_name), 'Customer');
      add(l.project_name, 'Project');
      add(l.end_user_name, 'End user');
    }
    return [...pool.values()].slice(0, 8).map((v) => { const [text, kind] = v.split('||'); return { text, kind }; });
  }, [search, letters, custName]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = letters.filter((l) => {
      if (statusFilter && l.status !== statusFilter) return false;
      if (custFilter && l.customer_id !== custFilter) return false;
      if (repFilter && (repFilter === 'unassigned' ? !!l.sales_rep_id : l.sales_rep_id !== repFilter)) return false;
      if (payFilter === 'paid' && !l.fee_paid_at) return false;
      if (payFilter === 'unpaid' && l.fee_paid_at) return false;
      if (!inRange((l.letter_date ?? '').slice(0, 10), range)) return false;
      if (!q) return true;
      const its = (itemsByLetter.get(l.letter_id) ?? []).map((i) => `${i.category_label} ${i.type_text}`).join(' ');
      return `${l.letter_number} ${custName(l.customer_id, l.supported_company_name)} ${l.project_name} ${l.end_user_name} ${l.supported_person_name} ${repName(l.sales_rep_id)} ${l.created_by_email} ${its}`
        .toLowerCase().includes(q);
    });
    const { key, dir } = sort;
    const txt = (a: string, b: string) => (a || '').localeCompare(b || '');
    return [...list].sort((a, b) => {
      let d = 0;
      if (key === 'number') d = txt(a.letter_number, b.letter_number);
      else if (key === 'date') d = txt(a.letter_date, b.letter_date);
      else if (key === 'customer') d = txt(custName(a.customer_id, a.supported_company_name), custName(b.customer_id, b.supported_company_name));
      else if (key === 'project') d = txt(a.project_name, b.project_name);
      else if (key === 'enduser') d = txt(a.end_user_name, b.end_user_name);
      else if (key === 'rep') d = txt(repName(a.sales_rep_id), repName(b.sales_rep_id));
      else if (key === 'author') d = txt(a.created_by_email, b.created_by_email);
      else if (key === 'items') d = (itemsByLetter.get(a.letter_id)?.length ?? 0) - (itemsByLetter.get(b.letter_id)?.length ?? 0);
      else if (key === 'fee') d = (a.fee_paid_at ? 1 : 0) - (b.fee_paid_at ? 1 : 0) || (Number(a.fee_amount) || 0) - (Number(b.fee_amount) || 0);
      else if (key === 'status') d = txt(a.status, b.status);
      d *= dir;
      return d !== 0 ? d : txt(b.letter_date, a.letter_date) || txt(b.letter_number, a.letter_number);
    });
  }, [letters, itemsByLetter, search, statusFilter, custFilter, repFilter, payFilter, range, sort, custName, repName]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: DEFAULT_DIR[key] }));

  const unpaidCount = useMemo(() => letters.filter((l) => !l.fee_paid_at && l.status !== 'cancelled' && Number(l.fee_amount) > 0).length, [letters]);

  // ── Editor ────────────────────────────────────────────────────────────────
  /** New letter, or a copy of one — the duplicate path admin actually uses. */
  const openEditor = (l: SupportLetter | 'new', copyFrom?: SupportLetter) => {
    const src = copyFrom ?? (l !== 'new' ? l : null);
    if (l === 'new') {
      setDraft({
        letter_date: todayISO(),
        customer_id: src?.customer_id ?? null,
        supported_person_name: src?.supported_person_name ?? '',
        supported_person_title: src?.supported_person_title ?? 'Direktur',
        supported_company_name: src?.supported_company_name ?? '',
        supported_company_address: src?.supported_company_address ?? '',
        // A duplicate is taken for a DIFFERENT tender — the project and its
        // owner are exactly what must be retyped, so they start empty.
        project_name: '', end_user_name: src ? '' : '', end_user_address: '',
        company_id: src?.company_id ?? companies[0]?.company_id ?? null,
        company_code: src?.company_code ?? 'ISL',
        signatory_name: src?.signatory_name ?? '',
        signatory_title: src?.signatory_title ?? 'Direktur',
        brands: src?.brands ?? '',
        place_of_issue: src?.place_of_issue ?? 'Jakarta',
        sales_rep_id: src?.sales_rep_id ?? profile?.id ?? null,
        status: 'draft',
        statements: src?.statements || DEFAULT_STATEMENTS,
        validity_note: src?.validity_note || DEFAULT_VALIDITY_NOTE,
        closing_note: src?.closing_note || DEFAULT_CLOSING_NOTE,
        fee_amount: src ? Number(src.fee_amount) : DEFAULT_LETTER_FEE,
        fee_paid_at: null, notes: '',
      });
      setDraftItems(src
        ? [...(itemsByLetter.get(src.letter_id) ?? []).map((i) => ({
            key: `sli-${itemSeq++}`, component_id: i.component_id,
            category_label: i.category_label, type_text: i.type_text, warranty_text: i.warranty_text,
          })), blankItem()]
        : [blankItem()]);
      setEditing('new');
      return;
    }
    setDraft({ ...l });
    setDraftItems([...(itemsByLetter.get(l.letter_id) ?? []).map((i) => ({
      key: `sli-${itemSeq++}`, component_id: i.component_id,
      category_label: i.category_label, type_text: i.type_text, warranty_text: i.warranty_text,
    })), blankItem()]);
    setEditing(l);
  };

  const set = <K extends keyof SupportLetter>(k: K, v: SupportLetter[K]) => setDraft((d) => ({ ...d, [k]: v }));

  /** Picking the customer fills everything CRM already knows about them. */
  const pickCustomer = (id: string | null) => {
    setDraft((d) => {
      const c = id ? custById.get(id) : null;
      const primary = id ? (contacts.find((x) => x.customer_id === id && x.is_primary) ?? contacts.find((x) => x.customer_id === id)) : null;
      return {
        ...d,
        customer_id: id,
        supported_company_name: c ? (c.legal_name || c.display_name) : '',
        supported_company_address: c?.billing_address || '',
        supported_person_name: primary?.name || d.supported_person_name || '',
        supported_person_title: primary?.title || d.supported_person_title || 'Direktur',
        // Their account manager is the obvious owner of this letter
        sales_rep_id: c?.account_manager_id ?? d.sales_rep_id ?? null,
      };
    });
  };

  const setItem = (key: string, patch: Partial<DraftItem>) => {
    setDraftItems((prev) => {
      const next = prev.map((r) => (r.key === key ? { ...r, ...patch } : r));
      const last = next[next.length - 1];
      if (last && (last.component_id || last.category_label.trim() || last.type_text.trim())) next.push(blankItem());
      return next;
    });
  };

  /** Catalog pick → the letter's three columns, straight from the item master. */
  const pickComponent = (key: string, componentId: string | null) => {
    const c = componentId ? compById.get(componentId) : null;
    setItem(key, {
      component_id: componentId,
      ...(c ? {
        category_label: c.category ? humanize(c.category) : (c.internal_description ?? ''),
        type_text: [c.brand, c.supplier_model].filter(Boolean).join(' ') || (c.internal_description ?? ''),
        warranty_text: warrantyTextID(c),
      } : {}),
    });
  };

  // Brands line follows the items unless someone typed their own
  const derivedBrands = useMemo(
    () => brandsOf(draftItems.map((i) => (i.component_id ? compById.get(i.component_id)?.brand : null))),
    [draftItems, compById]);

  async function save() {
    if (!canEdit || busy) return;
    if (!draft.customer_id && !draft.supported_company_name?.trim()) { flash('Pick the customer this letter supports.'); return; }
    if (!draft.project_name?.trim()) { flash('Name the project (Pekerjaan) — it is what the letter is for.'); return; }
    setBusy(true);
    try {
      const row = {
        letter_date: draft.letter_date || todayISO(),
        customer_id: draft.customer_id || null,
        supported_person_name: draft.supported_person_name ?? '',
        supported_person_title: draft.supported_person_title ?? '',
        supported_company_name: draft.supported_company_name ?? '',
        supported_company_address: draft.supported_company_address ?? '',
        project_name: draft.project_name?.trim() ?? '',
        end_user_name: draft.end_user_name ?? '',
        end_user_address: draft.end_user_address ?? '',
        company_id: draft.company_id || null,
        company_code: draft.company_code || 'ISL',
        signatory_name: draft.signatory_name ?? '',
        signatory_title: draft.signatory_title ?? '',
        brands: (draft.brands ?? '').trim() || derivedBrands,
        place_of_issue: draft.place_of_issue || 'Jakarta',
        sales_rep_id: draft.sales_rep_id || null,
        status: draft.status ?? 'draft',
        notes: draft.notes ?? '',
        statements: draft.statements ?? DEFAULT_STATEMENTS,
        validity_note: draft.validity_note ?? DEFAULT_VALIDITY_NOTE,
        closing_note: draft.closing_note ?? DEFAULT_CLOSING_NOTE,
        fee_amount: Number(draft.fee_amount) || 0,
        fee_paid_at: draft.fee_paid_at || null,
      };
      let letterId = editing !== 'new' && editing ? editing.letter_id : null;
      if (letterId) {
        const { error } = await supabase.from('28.0_support_letters').update(row).eq('letter_id', letterId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('28.0_support_letters').insert(row).select('letter_id, letter_number').single();
        if (error) throw error;
        letterId = (data as { letter_id: string }).letter_id;
      }
      // Items are replaced wholesale — same rule as after-sales parts
      await supabase.from('28.1_support_letter_items').delete().eq('letter_id', letterId);
      const rows = draftItems
        .filter((i) => i.category_label.trim() || i.type_text.trim() || i.component_id)
        .map((i, k) => ({
          letter_id: letterId, component_id: i.component_id,
          category_label: i.category_label.trim(), type_text: i.type_text.trim(),
          warranty_text: i.warranty_text.trim(), sort_order: k,
        }));
      if (rows.length) {
        const { error } = await supabase.from('28.1_support_letter_items').insert(rows);
        if (error) throw error;
      }
      setEditing(null);
      flash(editing === 'new' ? 'Support letter created.' : 'Support letter saved.');
      load();
    } catch (e) {
      flash(`Could not save — ${(e as Error).message}`);
    } finally { setBusy(false); }
  }

  /** One click from the list: the fee landed, the letter can go out. */
  async function markPaid(l: SupportLetter) {
    if (!canEdit) return;
    const paid = l.fee_paid_at ? null : todayISO();
    const { error } = await supabase.from('28.0_support_letters')
      .update({ fee_paid_at: paid, ...(paid && l.status === 'draft' ? { status: 'issued' } : {}) })
      .eq('letter_id', l.letter_id);
    if (error) { flash(`Could not update — ${error.message}`); return; }
    flash(paid ? 'Fee marked received — the letter is ready to issue.' : 'Payment cleared.');
    load();
  }

  async function remove(l: SupportLetter) {
    if (!canEdit) return;
    const { error } = await supabase.from('28.0_support_letters').delete().eq('letter_id', l.letter_id);
    if (error) { flash(`Could not delete — ${error.message}`); return; }
    flash('Letter deleted.'); load();
  }

  if (authLoading || !user) {
    return <div className="min-h-screen bg-chrome flex items-center justify-center"><div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" /></div>;
  }

  const inputCls = 'w-full h-9 px-3 rounded-lg bg-slate-900 border border-slate-700 focus:border-emerald-500/60 outline-none text-white text-sm placeholder:text-slate-600 transition-colors';
  const areaCls = 'w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 focus:border-emerald-500/60 outline-none text-white text-sm placeholder:text-slate-600 resize-y transition-colors';
  const selCls = 'h-10 px-3 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-slate-300 text-xs';

  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1400px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between sm:flex-wrap gap-2.5 sm:gap-4">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Support Letters · Surat Dukungan" />
        </div>
      </div>

      <main className="max-w-[1400px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-6 space-y-5">
        {toast && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-200">{toast}</div>}

        {/* ── Toolbar ── */}
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <button onClick={() => openEditor('new')}
              className="flex items-center gap-1.5 px-3 h-10 rounded-xl border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 text-xs font-semibold whitespace-nowrap transition-colors flex-shrink-0">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
              New Letter
            </button>
          )}
          {/* Search — suggests as you type, from what is already on file */}
          <div className="relative flex-1 min-w-[200px]">
            <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
            <input value={search}
              onChange={(e) => { setSearch(e.target.value); setShowSuggest(true); }}
              onFocus={() => setShowSuggest(true)}
              onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setShowSuggest(false); (e.target as HTMLInputElement).blur(); } }}
              placeholder="Search number, customer, project, end user, item…"
              className="w-full pl-10 pr-8 h-10 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-white text-base sm:text-sm placeholder:text-[13px] sm:placeholder:text-sm placeholder:text-slate-500 transition-colors" />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-300 text-sm">×</button>
            )}
            {showSuggest && suggestions.length > 0 && (
              <div className="absolute z-40 mt-1 left-0 right-0 rounded-xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">
                {suggestions.map((s) => (
                  <button key={`${s.kind}:${s.text}`} onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setSearch(s.text); setShowSuggest(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-800 transition-colors">
                    <span className="text-[9px] uppercase tracking-widest text-slate-600 w-16 flex-shrink-0">{s.kind}</span>
                    <span className="text-xs text-slate-200 truncate">{s.text}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | LetterStatus)} className={selCls}>
            <option value="">All statuses</option>
            {(Object.keys(LETTER_STATUS) as LetterStatus[]).map((k) => <option key={k} value={k}>{LETTER_STATUS[k].label}</option>)}
          </select>
          <select value={custFilter} onChange={(e) => setCustFilter(e.target.value)} className={`${selCls} max-w-[190px]`}>
            <option value="">All customers</option>
            {customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.display_name || c.legal_name}</option>)}
          </select>
          <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)} className={selCls}>
            <option value="">All sales</option>
            <option value="unassigned">Unassigned</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name || p.email.split('@')[0]}</option>)}
          </select>
          <select value={payFilter} onChange={(e) => setPayFilter(e.target.value as '' | 'paid' | 'unpaid')} className={selCls}
            title="The administration fee: which letters are still waiting on payment">
            <option value="">Fee: any</option>
            <option value="unpaid">Fee unpaid</option>
            <option value="paid">Fee paid</option>
          </select>
          <DateRangeFilter value={range} onChange={setRange} label="Letter date" />
          <LayoutToggle value={layout} onChange={setLayout} />
        </div>

        {/* Register summary — what the module is FOR: knowing the book */}
        {!loading && letters.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
            <span><span className="text-slate-300 font-semibold tabular-nums">{fmtInt(rows.length)}</span> of {fmtInt(letters.length)} letters</span>
            <span><span className="text-slate-300 font-semibold tabular-nums">{fmtInt(new Set(letters.map((l) => l.project_name.trim().toLowerCase()).filter(Boolean)).size)}</span> projects backed</span>
            <span><span className="text-slate-300 font-semibold tabular-nums">{fmtInt(new Set(letters.map((l) => l.customer_id).filter(Boolean)).size)}</span> resellers</span>
            {unpaidCount > 0 && (
              <button onClick={() => setPayFilter('unpaid')} className="text-amber-300 hover:text-amber-200 transition-colors">
                {fmtInt(unpaidCount)} awaiting the fee →
              </button>
            )}
          </div>
        )}

        {/* ── Table (desktop) ── */}
        <div className="hidden md:block bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-x-auto">
          <table className={`w-full min-w-[1100px] ${compact ? 'dense-rows' : ''}`}>
            <thead>
              <tr className="border-b border-slate-800 text-[10px] uppercase tracking-widest text-slate-500">
                <Th label="Number" k="number" sort={sort} onSort={toggleSort} className="px-4" />
                <Th label="Date" k="date" sort={sort} onSort={toggleSort} />
                <Th label="Customer" k="customer" sort={sort} onSort={toggleSort} />
                <Th label="Project" k="project" sort={sort} onSort={toggleSort} />
                <Th label="End user" k="enduser" sort={sort} onSort={toggleSort} />
                <Th label="Items" k="items" sort={sort} onSort={toggleSort} right />
                <Th label="Sales" k="rep" sort={sort} onSort={toggleSort} />
                <Th label="Created by" k="author" sort={sort} onSort={toggleSort} />
                <Th label="Fee" k="fee" sort={sort} onSort={toggleSort} />
                <Th label="Status" k="status" sort={sort} onSort={toggleSort} />
                <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                [...Array(6)].map((_, i) => <tr key={i}><td colSpan={11} className="px-4 py-2"><div className="h-9 bg-slate-800/40 rounded-lg animate-pulse" /></td></tr>)
              ) : rows.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-slate-600 text-sm">
                  {letters.length === 0 ? 'No support letters yet — the first one takes about a minute.' : 'No letter matches.'}
                </td></tr>
              ) : rows.map((l) => {
                const its = itemsByLetter.get(l.letter_id) ?? [];
                const st = LETTER_STATUS[l.status] ?? LETTER_STATUS.draft;
                return (
                  <tr key={l.letter_id} onClick={() => setExpandedId(expandedId === l.letter_id ? null : l.letter_id)}
                    className={`cursor-pointer transition-colors ${expandedId === l.letter_id ? 'bg-raised' : 'hover:bg-white/[0.03]'}`}>
                    <td className="px-4 py-2 font-mono text-xs text-emerald-300 whitespace-nowrap">{l.letter_number || '—'}</td>
                    <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap">{fmtDay(l.letter_date)}</td>
                    <td className="px-3 py-2 text-xs">
                      {l.customer_id ? (
                        <Link href={`/customers?q=${encodeURIComponent(custName(l.customer_id))}`} onClick={(e) => e.stopPropagation()}
                          className="text-slate-100 hover:text-emerald-300 transition-colors truncate max-w-[180px] inline-block align-bottom">
                          {custName(l.customer_id, l.supported_company_name)}
                        </Link>
                      ) : <span className="text-slate-300">{l.supported_company_name || '—'}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-300 truncate max-w-[220px]" title={l.project_name}>{l.project_name || '—'}</td>
                    <td className="px-3 py-2 text-xs text-slate-400 truncate max-w-[180px]" title={l.end_user_name}>{l.end_user_name || '—'}</td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums text-slate-300">{its.length || <span className="text-slate-700">0</span>}</td>
                    <td className="px-3 py-2 text-xs text-slate-400 truncate max-w-[120px]">{repName(l.sales_rep_id) || <span className="text-slate-700">—</span>}</td>
                    <td className="px-3 py-2 text-[11px] text-slate-500 truncate max-w-[120px]">{l.created_by_email.split('@')[0] || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {Number(l.fee_amount) > 0 ? (
                        <button onClick={(e) => { e.stopPropagation(); markPaid(l); }} disabled={!canEdit}
                          title={l.fee_paid_at ? `Fee received ${fmtDay(l.fee_paid_at)} — click to clear` : 'Click when the fee lands — the letter flips to Issued'}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                            l.fee_paid_at ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25' : 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
                          } ${canEdit ? '' : 'cursor-default'}`}>
                          {l.fee_paid_at ? `Paid ${fmtDay(l.fee_paid_at)}` : `Unpaid · ${fmtRupiah(Number(l.fee_amount))}`}
                        </button>
                      ) : <span className="text-slate-700 text-[10px]">—</span>}
                    </td>
                    <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${st.cls}`}>{st.label}</span></td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <a href={`/support-letters/${l.letter_id}/print`} target="_blank" rel="noopener noreferrer"
                          title="Open the printable Surat Dukungan"
                          className="px-2 py-1 rounded-lg text-[10px] font-semibold border border-slate-700/70 text-slate-400 hover:text-emerald-300 hover:border-emerald-500/40 transition-colors">Print</a>
                        {canEdit && (
                          <button onClick={() => openEditor('new', l)} title="Start a new letter from this one — same customer and items, new project"
                            className="px-2 py-1 rounded-lg text-[10px] font-semibold border border-slate-700/70 text-slate-400 hover:text-sky-300 hover:border-sky-500/40 transition-colors">Duplicate</button>
                        )}
                        <button onClick={() => openEditor(l)}
                          className="px-2 py-1 rounded-lg text-[10px] font-semibold border border-slate-700/70 text-slate-400 hover:text-white transition-colors">{canEdit ? 'Edit' : 'View'}</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Cards (mobile) ── */}
        <div className="md:hidden space-y-2">
          {loading ? [...Array(4)].map((_, i) => <div key={i} className="h-20 bg-slate-800/40 rounded-2xl animate-pulse" />)
            : rows.length === 0 ? <p className="text-slate-500 text-xs italic py-10 text-center">No letter matches.</p>
            : rows.map((l) => {
              const its = itemsByLetter.get(l.letter_id) ?? [];
              const st = LETTER_STATUS[l.status] ?? LETTER_STATUS.draft;
              return (
                <div key={l.letter_id} className="bg-slate-900/50 border border-slate-800 rounded-2xl px-3.5 py-3 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[11px] text-emerald-300">{l.letter_number || 'draft'}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${st.cls}`}>{st.label}</span>
                    {Number(l.fee_amount) > 0 && (
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${l.fee_paid_at ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                        {l.fee_paid_at ? 'Fee paid' : 'Fee unpaid'}
                      </span>
                    )}
                    <span className="ml-auto text-[10px] text-slate-500">{fmtDay(l.letter_date)}</span>
                  </div>
                  <p className="text-sm font-semibold text-white truncate">{custName(l.customer_id, l.supported_company_name) || '—'}</p>
                  <p className="text-[11px] text-slate-400">{l.project_name || '—'}</p>
                  <p className="text-[10px] text-slate-500">
                    {l.end_user_name || 'no end user'} · {its.length} item{its.length !== 1 ? 's' : ''}
                    {repName(l.sales_rep_id) ? ` · ${repName(l.sales_rep_id)}` : ''}
                  </p>
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <a href={`/support-letters/${l.letter_id}/print`} target="_blank" rel="noopener noreferrer"
                      className="px-2 py-1 rounded-lg text-[10px] font-semibold border border-slate-700/70 text-slate-400">Print</a>
                    {canEdit && <button onClick={() => openEditor('new', l)} className="px-2 py-1 rounded-lg text-[10px] font-semibold border border-slate-700/70 text-slate-400">Duplicate</button>}
                    <button onClick={() => openEditor(l)} className="px-2 py-1 rounded-lg text-[10px] font-semibold border border-slate-700/70 text-slate-400">{canEdit ? 'Edit' : 'View'}</button>
                    {canEdit && Number(l.fee_amount) > 0 && !l.fee_paid_at && (
                      <button onClick={() => markPaid(l)} className="ml-auto px-2 py-1 rounded-lg text-[10px] font-semibold bg-amber-500/15 text-amber-300">Fee received</button>
                    )}
                  </div>
                </div>
              );
            })}
        </div>

        {/* Expanded row detail (desktop) */}
        {expandedId && (() => {
          const l = letters.find((x) => x.letter_id === expandedId);
          if (!l) return null;
          const its = itemsByLetter.get(l.letter_id) ?? [];
          return (
            <div className="hidden md:block bg-slate-950/40 border border-slate-800 rounded-2xl px-4 py-3 space-y-1.5 text-[11px]">
              <p className="flex gap-2"><span className="w-24 text-slate-600 uppercase tracking-widest text-[9px] pt-0.5">Supported</span>
                <span className="text-slate-300">{l.supported_person_name}{l.supported_person_title ? ` · ${l.supported_person_title}` : ''} — {l.supported_company_name}</span></p>
              <p className="flex gap-2"><span className="w-24 text-slate-600 uppercase tracking-widest text-[9px] pt-0.5">Addressed</span>
                <span className="text-slate-300">{l.end_user_name || '—'}{l.end_user_address ? ` · ${l.end_user_address}` : ''}</span></p>
              <p className="flex gap-2"><span className="w-24 text-slate-600 uppercase tracking-widest text-[9px] pt-0.5">Brands</span>
                <span className="text-slate-300">{l.brands || '—'}</span></p>
              <p className="flex gap-2"><span className="w-24 text-slate-600 uppercase tracking-widest text-[9px] pt-0.5">Materials</span>
                <span className="flex-1 space-y-0.5">
                  {its.length === 0 ? <span className="text-slate-600 italic">none listed</span> : its.map((i) => (
                    <span key={i.item_id} className="flex flex-wrap items-center gap-x-2">
                      <span className="text-slate-400">{i.category_label}</span>
                      {i.component_id ? (
                        <a href={`/items/${i.component_id}`} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300">{i.type_text} ↗</a>
                      ) : <span className="text-slate-300">{i.type_text}</span>}
                      <span className="text-emerald-300/80">{i.warranty_text}</span>
                    </span>
                  ))}
                </span></p>
            </div>
          );
        })()}

        <p className="text-[10px] text-slate-600 max-w-3xl">
          A Surat Dukungan states our backing as principal. The clauses are pre-formatted and the item warranties come
          from the item master — set them in <Link href="/products" className="text-emerald-500/80 hover:text-emerald-300">Products</Link> and every
          future letter quotes them correctly.
        </p>
      </main>

      {/* ── Editor ── */}
      {editing && mounted && createPortal(
        <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => !busy && setEditing(null)} />
          <div className="relative bg-slate-900 border border-slate-700 sm:rounded-2xl rounded-t-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-white">
                  {editing === 'new' ? 'New Surat Dukungan' : (editing.letter_number || 'Support letter')}
                </h3>
                <p className="text-[10px] text-slate-600 mt-0.5">
                  {editing === 'new'
                    ? `Number assigned on save — ${previewLetterNumber(draft.letter_date || todayISO(), draft.company_code || 'ISL')} style`
                    : `created by ${editing.created_by_email || '—'} · ${fmtDay(editing.created_at)}`}
                </p>
              </div>
              <button onClick={() => !busy && setEditing(null)} className="text-slate-500 hover:text-white p-1 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Who we support */}
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block sm:col-span-2">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Customer we support *</span>
                <fieldset disabled={!canEdit} className={!canEdit ? 'opacity-60 pointer-events-none' : ''}>
                  <RichDropdown
                    options={customers.map((c) => ({ customer_id: c.customer_id, name: c.display_name || c.legal_name, sub: c.legal_name }))}
                    value={draft.customer_id ?? ''}
                    placeholder="Search customer…"
                    config={{ labelKey: 'name', valueKey: 'customer_id', subLabelKey: 'sub' }}
                    onChange={(v: any) => pickCustomer(v ? String(v) : null)} />
                </fieldset>
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Their signatory (Nama)</span>
                <input className={inputCls} value={draft.supported_person_name ?? ''} disabled={!canEdit}
                  placeholder="e.g. Denny Yusni Arman" onChange={(e) => set('supported_person_name', e.target.value)} />
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Their title (Jabatan)</span>
                <input className={inputCls} value={draft.supported_person_title ?? ''} disabled={!canEdit}
                  placeholder="Direktur" onChange={(e) => set('supported_person_title', e.target.value)} />
              </label>
              <label className="block sm:col-span-2">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Their company + address (as printed)</span>
                <input className={`${inputCls} mb-2`} value={draft.supported_company_name ?? ''} disabled={!canEdit}
                  placeholder="PT …" onChange={(e) => set('supported_company_name', e.target.value)} />
                <textarea rows={2} className={areaCls} value={draft.supported_company_address ?? ''} disabled={!canEdit}
                  placeholder="Alamat" onChange={(e) => set('supported_company_address', e.target.value)} />
              </label>
            </div>

            {/* The tender */}
            <div className="grid sm:grid-cols-2 gap-3 border-t border-slate-800 pt-3">
              <label className="block sm:col-span-2">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Project / Pekerjaan *</span>
                <input className={inputCls} value={draft.project_name ?? ''} disabled={!canEdit}
                  placeholder="e.g. RTWS Package Fabrication and Installation Services Projects Zona 9 (II)"
                  onChange={(e) => set('project_name', e.target.value)} />
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Addressed to — end user</span>
                <input list="sl-endusers" className={inputCls} value={draft.end_user_name ?? ''} disabled={!canEdit}
                  placeholder="e.g. PT Pertamina Hulu Sanga Sanga" onChange={(e) => set('end_user_name', e.target.value)} />
                <datalist id="sl-endusers">
                  {[...new Set(letters.map((l) => l.end_user_name).filter(Boolean))].map((n) => <option key={n} value={n} />)}
                </datalist>
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">End-user address</span>
                <input className={inputCls} value={draft.end_user_address ?? ''} disabled={!canEdit}
                  placeholder="Alamat penerima" onChange={(e) => set('end_user_address', e.target.value)} />
              </label>
            </div>

            {/* Materials */}
            <div className="border-t border-slate-800 pt-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] uppercase tracking-widest text-slate-500">Material yang didukung</span>
                <span className="text-[10px] text-slate-600">type and warranty come from the item master</span>
              </div>
              <div className="hidden sm:grid grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,1.4fr)_110px_24px] gap-2 px-1 pb-1 text-[9px] font-bold uppercase tracking-wider text-slate-600">
                <span>Catalog item</span><span>Nama Barang</span><span>Tipe</span><span>Garansi</span><span />
              </div>
              <div className="space-y-1.5">
                {draftItems.map((it) => (
                  <div key={it.key} className="grid grid-cols-2 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,1.4fr)_110px_24px] gap-2 items-center bg-slate-950/40 sm:bg-transparent border sm:border-0 border-slate-800/60 rounded-xl px-2 py-2 sm:px-0 sm:py-0">
                    <div className="col-span-2 sm:col-span-1">
                      <fieldset disabled={!canEdit} className={!canEdit ? 'opacity-60 pointer-events-none' : ''}>
                        <RichDropdown options={comps} value={it.component_id}
                          config={{ labelKey: 'internal_description', valueKey: 'component_id', subLabelKey: 'supplier_model' }}
                          placeholder="Search catalog…"
                          onChange={(v: any) => pickComponent(it.key, v ? String(v) : null)} />
                      </fieldset>
                    </div>
                    <input className={`${inputCls} col-span-2 sm:col-span-1`} value={it.category_label} disabled={!canEdit}
                      placeholder="Solar Modules" onChange={(e) => setItem(it.key, { category_label: e.target.value })} />
                    <input className={`${inputCls} col-span-2 sm:col-span-1`} value={it.type_text} disabled={!canEdit}
                      placeholder="ICA Solar ICA200-72M 200Wp Mono" onChange={(e) => setItem(it.key, { type_text: e.target.value })} />
                    <input className={inputCls} value={it.warranty_text} disabled={!canEdit}
                      placeholder="2 Tahun" onChange={(e) => setItem(it.key, { warranty_text: e.target.value })} />
                    {canEdit && (
                      <button onClick={() => setDraftItems((a) => (a.length > 1 ? a.filter((x) => x.key !== it.key) : a))}
                        className="text-slate-600 hover:text-red-400 transition-colors text-base leading-none justify-self-end px-1"
                        title="Remove row">×</button>
                    )}
                  </div>
                ))}
              </div>
              <label className="block mt-2.5">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Brands (Merk) — printed in the opening line</span>
                <input className={inputCls} value={draft.brands ?? ''} disabled={!canEdit}
                  placeholder={derivedBrands || 'ICA SOLAR, ICAL, EPEVER'}
                  onChange={(e) => set('brands', e.target.value)} />
                {!((draft.brands ?? '').trim()) && derivedBrands && (
                  <span className="text-[10px] text-slate-600">Blank uses the items&apos; own brands: {derivedBrands}</span>
                )}
              </label>
            </div>

            {/* Ours + admin */}
            <div className="grid sm:grid-cols-2 gap-3 border-t border-slate-800 pt-3">
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Letter date</span>
                <input type="date" className={inputCls} value={(draft.letter_date ?? '').slice(0, 10)} disabled={!canEdit}
                  onChange={(e) => set('letter_date', e.target.value)} />
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Sales handling this</span>
                <select className={inputCls} value={draft.sales_rep_id ?? ''} disabled={!canEdit}
                  onChange={(e) => set('sales_rep_id', e.target.value || null)}>
                  <option value="">— unassigned —</option>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name || p.email}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Our signatory</span>
                <input className={inputCls} value={draft.signatory_name ?? ''} disabled={!canEdit}
                  placeholder="e.g. Wendy Yusson Abadi" onChange={(e) => set('signatory_name', e.target.value)} />
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Signatory title</span>
                <input className={inputCls} value={draft.signatory_title ?? ''} disabled={!canEdit}
                  placeholder="Direktur" onChange={(e) => set('signatory_title', e.target.value)} />
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Issuing company</span>
                <select className={inputCls} value={draft.company_id ?? ''} disabled={!canEdit}
                  onChange={(e) => set('company_id', e.target.value || null)}>
                  <option value="">{settings.companyName || '— none —'}</option>
                  {companies.map((c) => <option key={c.company_id} value={c.company_id}>{c.legal_name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Place · number code</span>
                <div className="flex gap-2">
                  <input className={inputCls} value={draft.place_of_issue ?? ''} disabled={!canEdit}
                    placeholder="Jakarta" onChange={(e) => set('place_of_issue', e.target.value)} />
                  <input className={`${inputCls} w-24`} value={draft.company_code ?? ''} disabled={!canEdit}
                    title="The letters inside the document number (013-ISL-SD-VII-2026)"
                    placeholder="ISL" onChange={(e) => set('company_code', e.target.value.toUpperCase())} />
                </div>
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Administration fee</span>
                <input className={inputCls} inputMode="numeric" value={String(draft.fee_amount ?? '')} disabled={!canEdit}
                  onChange={(e) => set('fee_amount', Number(e.target.value.replace(/[^\d]/g, '')) || 0)} />
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Fee received on</span>
                <input type="date" className={inputCls} value={(draft.fee_paid_at ?? '').slice(0, 10)} disabled={!canEdit}
                  onChange={(e) => set('fee_paid_at', e.target.value || null)} />
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Status</span>
                <select className={inputCls} value={draft.status ?? 'draft'} disabled={!canEdit}
                  onChange={(e) => set('status', e.target.value as LetterStatus)}>
                  {(Object.keys(LETTER_STATUS) as LetterStatus[]).map((k) => <option key={k} value={k}>{LETTER_STATUS[k].label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Internal note</span>
                <input className={inputCls} value={draft.notes ?? ''} disabled={!canEdit}
                  placeholder="Not printed" onChange={(e) => set('notes', e.target.value)} />
              </label>
            </div>

            {/* The pre-formatted body — editable per letter, never retyped */}
            <details className="border-t border-slate-800 pt-3">
              <summary className="text-[10px] uppercase tracking-widest text-slate-500 cursor-pointer hover:text-slate-300">
                Letter body — standard clauses (pre-filled)
              </summary>
              <div className="space-y-3 mt-2.5">
                <label className="block">
                  <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Undertakings — one per line, numbered when printed</span>
                  <textarea rows={4} className={areaCls} value={draft.statements ?? ''} disabled={!canEdit}
                    onChange={(e) => set('statements', e.target.value)} />
                </label>
                <label className="block">
                  <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Validity clause</span>
                  <textarea rows={2} className={areaCls} value={draft.validity_note ?? ''} disabled={!canEdit}
                    onChange={(e) => set('validity_note', e.target.value)} />
                </label>
                <label className="block">
                  <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Closing</span>
                  <textarea rows={2} className={areaCls} value={draft.closing_note ?? ''} disabled={!canEdit}
                    onChange={(e) => set('closing_note', e.target.value)} />
                </label>
              </div>
            </details>

            <div className="flex items-center justify-between gap-3 pt-1">
              {canEdit && editing !== 'new' ? (
                <button onClick={() => { if (confirm('Delete this support letter?')) { remove(editing); setEditing(null); } }}
                  className="text-[11px] text-slate-600 hover:text-red-400 transition-colors">Delete</button>
              ) : <span />}
              <div className="flex gap-3">
                {editing !== 'new' && (
                  <a href={`/support-letters/${editing.letter_id}/print`} target="_blank" rel="noopener noreferrer"
                    className="px-4 py-2 rounded-lg text-slate-300 border border-slate-700 hover:bg-slate-800 text-sm transition-colors">Print →</a>
                )}
                <button onClick={() => setEditing(null)} disabled={busy}
                  className="px-4 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 text-sm transition-colors disabled:opacity-50">Cancel</button>
                {canEdit && (
                  <button onClick={save} disabled={busy}
                    className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                    {busy ? 'Saving…' : editing === 'new' ? 'Create letter' : 'Save'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

/** Sortable header cell — click toggles ▲/▼, like every other list. */
function Th({ label, k, sort, onSort, right, className }: {
  label: string; k: SortKey; sort: { key: SortKey; dir: 1 | -1 }; onSort: (k: SortKey) => void;
  right?: boolean; className?: string;
}) {
  const active = sort.key === k;
  return (
    <th className={`font-semibold py-2.5 align-top ${right ? 'text-right' : 'text-left'} ${className ?? 'px-3'}`}>
      <button onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 uppercase tracking-widest leading-none transition-colors ${active ? 'text-emerald-400' : 'hover:text-slate-300'}`}>
        {label}<span className="text-[8px]">{active ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}

/**
 * ICAPROC — Module 1: CRM (Customers)
 * Searchable customer master with a create/edit drawer, contacts sub-list, and
 * Account Manager assignment. Gated to owners + sales (canManageCustomers).
 */
'use client';
import { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_PERMISSIONS, ROLE_LABELS, type UserRole } from '@/constants/roles';
import BrandMenu from '@/components/ui/BrandMenu';
import CrmMigrationBanner from '@/components/ui/CrmMigrationBanner';
import { SALES_STATUS } from '@/lib/salesStatus';
import { downloadCsv, parseCsv, readFileText } from '@/lib/csv';

// ── Types ─────────────────────────────────────────────────────────────────
interface Customer {
  customer_id: string;
  customer_code: string;
  legal_name: string;
  display_name: string;
  tier: string;
  account_manager_id: string | null;
  payment_terms: string;
  default_currency: string;
  tax_id: string;
  billing_address: string;
  shipping_address: string;
  notes: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
  created_by_email?: string;
  updated_by_email?: string;
}

interface Contact {
  contact_id: string;
  customer_id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  is_primary: boolean;
}

interface AmUser {
  id: string;
  email: string;
  display_name?: string | null;
  role: UserRole;
}

interface Tier {
  tier_code: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

interface SalesDoc {
  quote_id: string; quote_number: string; order_number?: string; invoice_number?: string; do_number?: string;
  status: string; grand_total: number; quote_date: string; updated_at?: string; revision?: number;
}
interface EpcQuote {
  quote_id: string; quote_number: string; quote_date: string; status: string;
  project_description: string; updated_at?: string;
}
interface ProfileData {
  docs: SalesDoc[];
  received: Record<string, number>;
  topItems: { desc: string; qty: number; value: number; unit: string; times: number }[];
  epcQuotes: EpcQuote[];
}

const CURRENCIES = ['IDR', 'USD', 'EUR', 'CNY', 'SGD'];

const blankCustomer = (): Customer => ({
  customer_id: '',
  customer_code: '',
  legal_name: '',
  display_name: '',
  tier: '',
  account_manager_id: null,
  payment_terms: '',
  default_currency: 'IDR',
  tax_id: '',
  billing_address: '',
  shipping_address: '',
  notes: '',
  is_active: true,
});

let tmpId = 0;
const newContact = (customer_id: string): Contact => ({
  contact_id: `tmp-${++tmpId}`,
  customer_id,
  name: '',
  title: '',
  email: '',
  phone: '',
  is_primary: false,
});

// ── Page (Suspense wrapper for useSearchParams) ─────────────────────────────
export default function CustomersPage() {
  return (
    <Suspense fallback={<CenterSpinner />}>
      <CustomersInner />
    </Suspense>
  );
}

function CenterSpinner() {
  return (
    <div className="min-h-screen bg-[#0f1012] flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
    </div>
  );
}

function CustomersInner() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, profile, loading: authLoading } = useAuth();

  const canManage = !!profile && ROLE_PERMISSIONS[profile.role].canManageCustomers;

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [contactsByCustomer, setContactsByCustomer] = useState<Record<string, Contact[]>>({});
  const [amUsers, setAmUsers] = useState<AmUser[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState(searchParams.get('q') ?? '');
  const [showInactive, setShowInactive] = useState(false);

  const [editing, setEditing] = useState<Customer | null>(null);
  const [draftContacts, setDraftContacts] = useState<Contact[]>([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Profile view (row click): the customer's documents, AR, and stats.
  // Editing only starts from the profile's Edit button.
  const [profileFor, setProfileFor] = useState<Customer | null>(null);
  const [profileData, setProfileData] = useState<ProfileData | null>(null);

  const openProfile = useCallback(async (c: Customer) => {
    // Clicking the already-open row collapses its preview
    if (profileFor?.customer_id === c.customer_id) { setProfileFor(null); setProfileData(null); return; }
    setProfileFor(c);
    setProfileData(null);
    const [{ data: docs }, { data: epc }] = await Promise.all([
      supabase.from('22.0_sales_quotes')
        .select('quote_id, quote_number, order_number, invoice_number, do_number, status, grand_total, quote_date, updated_at, revision')
        .eq('customer_id', c.customer_id)
        .order('updated_at', { ascending: false }),
      supabase.from('10.0_project_quotes')
        .select('quote_id, quote_number, quote_date, status, project_description, updated_at')
        .eq('customer_id', c.customer_id)
        .order('updated_at', { ascending: false }),
    ]);
    const list = (docs as SalesDoc[]) ?? [];
    const ids = list.map((d) => d.quote_id);
    const received: Record<string, number> = {};
    const agg = new Map<string, { desc: string; qty: number; value: number; unit: string; times: number }>();
    if (ids.length) {
      const [rRes, iRes] = await Promise.all([
        supabase.from('26.0_customer_receipts').select('quote_id, amount').in('quote_id', ids),
        supabase.from('22.1_sales_quote_items').select('quote_id, description, quantity, unit, line_total, is_section').in('quote_id', ids),
      ]);
      for (const r of (rRes.data as { quote_id: string; amount: number }[]) ?? []) {
        received[r.quote_id] = (received[r.quote_id] ?? 0) + (Number(r.amount) || 0);
      }
      // "Most ordered" counts confirmed business only (SO onward), not quotes
      const committed = new Set(list.filter((d) => ['ordered', 'invoiced', 'preparing', 'delivered'].includes(d.status)).map((d) => d.quote_id));
      for (const it of (iRes.data as { quote_id: string; description: string; quantity: number; unit: string; line_total: number; is_section: boolean }[]) ?? []) {
        if (it.is_section || !committed.has(it.quote_id)) continue;
        const desc = (it.description || '').trim();
        if (!desc) continue;
        const k = desc.toLowerCase();
        const a = agg.get(k) ?? { desc, qty: 0, value: 0, unit: it.unit || '', times: 0 };
        a.qty += Number(it.quantity) || 0;
        a.value += Number(it.line_total) || 0;
        a.times += 1;
        agg.set(k, a);
      }
    }
    const topItems = [...agg.values()].sort((a, b) => b.value - a.value).slice(0, 6);
    setProfileData({ docs: list, received, topItems, epcQuotes: (epc as EpcQuote[]) ?? [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, profileFor]);

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  useEffect(() => { document.title = 'Customers — ICAPROC'; }, []);

  // ── Auth gate ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/customers')}`); return; }
    if (profile && !ROLE_PERMISSIONS[profile.role].canManageCustomers) router.replace('/unauthorized');
  }, [authLoading, user, profile, router]);

  // ── Data ──────────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [custRes, contactRes, userRes, tierRes] = await Promise.all([
      supabase.from('20.0_customers').select('*').order('updated_at', { ascending: false }),
      supabase.from('20.1_customer_contacts').select('*').order('is_primary', { ascending: false }),
      supabase.from('user_profiles').select('id, email, display_name, role').in('role', ['owner', 'sales']),
      supabase.from('21.0_price_tiers').select('tier_code, name, sort_order, is_active').order('sort_order'),
    ]);
    setCustomers((custRes.data as Customer[]) ?? []);
    const grouped: Record<string, Contact[]> = {};
    for (const c of (contactRes.data as Contact[]) ?? []) {
      (grouped[c.customer_id] ??= []).push(c);
    }
    setContactsByCustomer(grouped);
    setAmUsers((userRes.data as AmUser[]) ?? []);
    // Pricing module may not be installed yet — tolerate its absence.
    setTiers(tierRes.error ? [] : ((tierRes.data as Tier[]) ?? []));
    setLoading(false);
  }, []);

  useEffect(() => { if (canManage) fetchAll(); }, [canManage, fetchAll]);

  const amById = useMemo(
    () => new Map(amUsers.map((u) => [u.id, u.display_name || u.email])),
    [amUsers]);
  const tierLabel = useMemo(
    () => new Map(tiers.map((t) => [t.tier_code, t.name])),
    [tiers]);

  // ── Deep link: ?open=<customer_id> opens the drawer once data has loaded ────
  useEffect(() => {
    const openId = searchParams.get('open');
    if (!openId || loading || editing) return;
    const c = customers.find((x) => x.customer_id === openId);
    if (c) openDrawer(c);
  }, [searchParams, loading, customers]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filtering ───────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter((c) => {
      if (!showInactive && !c.is_active) return false;
      if (!q) return true;
      const hay = [
        c.customer_code, c.legal_name, c.display_name, c.tier,
        amById.get(c.account_manager_id ?? '') ?? '',
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [customers, search, showInactive, amById]);

  // ── Drawer ──────────────────────────────────────────────────────────────────
  function openDrawer(c: Customer | null) {
    const target = c ?? blankCustomer();
    setEditing(target);
    setDraftContacts(target.customer_id ? (contactsByCustomer[target.customer_id] ?? []).map((x) => ({ ...x })) : []);
  }
  function closeDrawer() { setEditing(null); setDraftContacts([]); }

  const setField = <K extends keyof Customer>(k: K, v: Customer[K]) =>
    setEditing((e) => (e ? { ...e, [k]: v } : e));

  const setContactField = (id: string, k: keyof Contact, v: Contact[keyof Contact]) =>
    setDraftContacts((list) => list.map((c) => (c.contact_id === id ? { ...c, [k]: v } : c)));

  const setPrimary = (id: string) =>
    setDraftContacts((list) => list.map((c) => ({ ...c, is_primary: c.contact_id === id })));

  async function save() {
    if (!editing) return;
    if (!editing.legal_name.trim() && !editing.display_name.trim()) {
      flash('A legal name or display name is required');
      return;
    }
    setSaving(true);

    // Fall back display/legal names to each other so neither is blank.
    const legal = editing.legal_name.trim() || editing.display_name.trim();
    const display = editing.display_name.trim() || legal;

    const payload: Record<string, unknown> = {
      legal_name: legal,
      display_name: display,
      tier: editing.tier.trim(),
      account_manager_id: editing.account_manager_id || null,
      payment_terms: editing.payment_terms.trim(),
      default_currency: editing.default_currency || 'IDR',
      tax_id: editing.tax_id.trim(),
      billing_address: editing.billing_address.trim(),
      shipping_address: editing.shipping_address.trim(),
      notes: editing.notes.trim(),
      is_active: editing.is_active,
    };

    let customerId = editing.customer_id;
    if (customerId) {
      const { error } = await supabase.from('20.0_customers').update(payload).eq('customer_id', customerId);
      if (error) { flash(`Error: ${error.message}`); setSaving(false); return; }
    } else {
      const { data, error } = await supabase.from('20.0_customers').insert(payload).select('customer_id').single();
      if (error || !data) { flash(`Error: ${error?.message ?? 'insert failed'}`); setSaving(false); return; }
      customerId = data.customer_id as string;
    }

    // Reconcile contacts: replace the set for this customer with the current
    // draft (only rows with a name). Small per-customer counts make this cheap.
    const keep = draftContacts.filter((c) => c.name.trim() || c.email.trim() || c.phone.trim());
    await supabase.from('20.1_customer_contacts').delete().eq('customer_id', customerId);
    if (keep.length) {
      const rows = keep.map((c) => ({
        customer_id: customerId,
        name: c.name.trim(),
        title: c.title.trim(),
        email: c.email.trim(),
        phone: c.phone.trim(),
        is_primary: c.is_primary,
      }));
      const { error } = await supabase.from('20.1_customer_contacts').insert(rows);
      if (error) { flash(`Saved customer, but contacts failed: ${error.message}`); }
    }

    setSaving(false);
    flash('Customer saved');
    closeDrawer();
    // Clear the deep-link param so re-renders don't reopen the drawer.
    if (searchParams.get('open')) router.replace('/customers', { scroll: false });
    fetchAll();
  }

  // ── Import / Export ────────────────────────────────────────────────────────
  const canExport = !!profile && ROLE_PERMISSIONS[profile.role].canExportCsv;
  const [importBusy, setImportBusy] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    updates: { id: string; label: string; patch: Record<string, unknown>; changes: string[] }[];
    creates: Record<string, unknown>[];
    skipped: number;
  } | null>(null);

  function exportCsv() {
    const headers = ['customer_code', 'display_name', 'legal_name', 'tier', 'account_manager', 'payment_terms', 'default_currency', 'tax_id', 'billing_address', 'shipping_address', 'notes', 'active', 'primary_contact', 'contact_email', 'contact_phone'];
    const data = filtered.map((c) => {
      const contacts = contactsByCustomer[c.customer_id] ?? [];
      const primary = contacts.find((x) => x.is_primary) ?? contacts[0];
      return [
        c.customer_code, c.display_name, c.legal_name, c.tier,
        amById.get(c.account_manager_id ?? '') ?? '', c.payment_terms, c.default_currency,
        c.tax_id, c.billing_address, c.shipping_address, c.notes, c.is_active ? 'yes' : 'no',
        primary?.name ?? '', primary?.email ?? '', primary?.phone ?? '',
      ];
    });
    downloadCsv(`customers-${new Date().toISOString().slice(0, 10)}`, headers, data);
  }

  async function handleImportFile(file: File) {
    try {
      const { rows: recs } = parseCsv(await readFileText(file));
      if (!recs.length) { flash('No data rows found in the file'); return; }
      const byCode = new Map(customers.filter((c) => c.customer_code).map((c) => [c.customer_code.trim().toLowerCase(), c]));
      const byName = new Map<string, Customer>();
      for (const c of customers) {
        if (c.display_name) byName.set(c.display_name.trim().toLowerCase(), c);
        if (c.legal_name) byName.set(c.legal_name.trim().toLowerCase(), c);
      }
      const validTiers = new Set(tiers.map((t) => t.tier_code));

      const updates: { id: string; label: string; patch: Record<string, unknown>; changes: string[] }[] = [];
      const creates: Record<string, unknown>[] = [];
      let skipped = 0;
      for (const r of recs) {
        const code = (r.customercode || r.code || '').trim();
        const display = (r.displayname || r.name || '').trim();
        const legal = (r.legalname || '').trim();
        const match = (code && byCode.get(code.toLowerCase()))
          || (display && byName.get(display.toLowerCase()))
          || (legal && byName.get(legal.toLowerCase()))
          || null;
        // Only set columns the file actually provides
        const fields: [string, string | undefined, (v: string) => unknown][] = [
          ['display_name', r.displayname || r.name, (v) => v],
          ['legal_name', r.legalname, (v) => v],
          ['tier', r.tier, (v) => (validTiers.has(v) ? v : v)],
          ['payment_terms', r.paymentterms, (v) => v],
          ['default_currency', r.defaultcurrency || r.currency, (v) => v.toUpperCase()],
          ['tax_id', r.taxid || r.npwp, (v) => v],
          ['billing_address', r.billingaddress, (v) => v],
          ['shipping_address', r.shippingaddress, (v) => v],
          ['notes', r.notes, (v) => v],
          ['is_active', r.active, (v) => !/^(no|false|0|inactive)$/i.test(v)],
        ];
        if (match) {
          const patch: Record<string, unknown> = {};
          const changes: string[] = [];
          for (const [key, raw, map] of fields) {
            if (raw === undefined || raw === '') continue;
            const v = map(raw.trim());
            if (v !== (match as unknown as Record<string, unknown>)[key]) { patch[key] = v; changes.push(key.replace(/_/g, ' ')); }
          }
          if (Object.keys(patch).length) updates.push({ id: match.customer_id, label: match.display_name || match.legal_name, patch, changes });
        } else if (display || legal) {
          const row: Record<string, unknown> = { display_name: display || legal, legal_name: legal || display, is_active: true };
          for (const [key, raw, map] of fields) {
            if (raw === undefined || raw === '' || key === 'display_name' || key === 'legal_name') continue;
            row[key] = map(raw.trim());
          }
          creates.push(row);
        } else {
          skipped++;
        }
      }
      if (!updates.length && !creates.length) { flash('Nothing to import — no changes detected'); return; }
      setImportPreview({ updates, creates, skipped });
    } catch (e) {
      flash(`Import failed: ${e instanceof Error ? e.message : 'could not read file'}`);
    }
  }

  async function applyImport() {
    if (!importPreview) return;
    setImportBusy(true);
    let ok = 0, failed = 0;
    for (const u of importPreview.updates) {
      const { error } = await supabase.from('20.0_customers').update(u.patch).eq('customer_id', u.id);
      if (error) failed++; else ok++;
    }
    if (importPreview.creates.length) {
      const { error } = await supabase.from('20.0_customers').insert(importPreview.creates);
      if (error) failed += importPreview.creates.length; else ok += importPreview.creates.length;
    }
    setImportBusy(false);
    setImportPreview(null);
    flash(failed ? `${ok} applied, ${failed} failed` : `${ok} customer${ok !== 1 ? 's' : ''} imported`);
    fetchAll();
  }

  if (authLoading || !user || !profile) return <CenterSpinner />;
  if (!canManage) return <CenterSpinner />; // redirect in-flight

  return (
    <div className="min-h-screen bg-[#0f1012] text-slate-200 font-sans text-sm">
      {/* Header */}
      <div className="border-b border-slate-800/60 bg-[#0f1012]/80 backdrop-blur-md sticky top-0 z-30">
        {/* Phones: wordmark row then actions row — side-by-side squeezes the
            three buttons into the wordmark. sm+ keeps the single row. */}
        <div className="max-w-[1400px] 2xl:max-w-[1720px] mx-auto px-3 sm:px-4 md:px-8 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Customers · CRM" />
          <div className="flex items-center gap-2 flex-wrap">
            {canExport && (
              <button onClick={exportCsv}
                title="Download the filtered customer list as CSV (includes primary contact)"
                className="text-xs text-slate-400 hover:text-white px-3 py-1.5 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap">
                ↓ Export CSV
              </button>
            )}
            <label className="text-xs text-slate-400 hover:text-white px-3 py-1.5 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer"
              title="Import a CSV: matches by customer_code or name, updates provided columns, creates unmatched rows as new customers. Export first for the right column layout.">
              ↑ Import CSV
              <input type="file" accept=".csv,text/csv" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ''; }} />
            </label>
            <button
              onClick={() => openDrawer(null)}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 transition-colors whitespace-nowrap"
            >
              + New Customer
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-[1400px] 2xl:max-w-[1720px] mx-auto px-3 sm:px-4 md:px-8 py-8 space-y-6">
        <CrmMigrationBanner />

        {/* Search + filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code, name, tier, account manager…"
              className="w-full pl-10 pr-4 h-11 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-white text-base sm:text-sm placeholder:text-[13px] sm:placeholder:text-sm placeholder:text-slate-500 transition-colors"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)}
              className="accent-emerald-500 w-4 h-4" />
            Show inactive
          </label>
          <span className="text-xs text-slate-600 tabular-nums">{filtered.length} of {customers.length}</span>
        </div>

        {/* List */}
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden">
          <div className="hidden md:grid grid-cols-[130px_1fr_120px_180px_90px] gap-3 px-4 py-2.5 border-b border-slate-800 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            <span>Code</span><span>Name</span><span>Tier</span><span>Account Manager</span><span>Status</span>
          </div>
          {loading ? (
            <div className="p-4 space-y-1.5">{[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-12 text-center text-slate-600 text-sm">
              {customers.length === 0 ? 'No customers yet — create your first one.' : 'No customers match your search.'}
            </div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {filtered.map((c) => {
                const contacts = contactsByCustomer[c.customer_id] ?? [];
                const primary = contacts.find((x) => x.is_primary) ?? contacts[0];
                const open = profileFor?.customer_id === c.customer_id;
                return (
                  <div key={c.customer_id}>
                    <button
                      onClick={() => openProfile(c)}
                      aria-expanded={open}
                      className={`w-full text-left grid grid-cols-1 md:grid-cols-[130px_1fr_120px_180px_90px] gap-1 md:gap-3 px-4 py-3 transition-colors items-center ${open ? 'bg-slate-800/40' : 'hover:bg-slate-800/40'}`}
                    >
                      <span className="font-mono text-[11px] text-slate-400">{c.customer_code || '—'}</span>
                      <span className="min-w-0">
                        <span className="block text-sm text-slate-100 font-medium truncate">{c.display_name || c.legal_name || '(no name)'}</span>
                        {primary && <span className="block text-[11px] text-slate-500 truncate">{primary.name}{primary.email ? ` · ${primary.email}` : ''}</span>}
                      </span>
                      <span className="text-xs text-slate-400">{c.tier ? <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[11px]">{tierLabel.get(c.tier) ?? c.tier}</span> : <span className="text-slate-600">—</span>}</span>
                      <span className="text-xs text-slate-400 truncate">{c.account_manager_id ? (amById.get(c.account_manager_id) ?? '—') : <span className="text-slate-600">Unassigned</span>}</span>
                      <span className="flex items-center justify-between gap-2">
                        <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${c.is_active ? 'text-emerald-400' : 'text-slate-500'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${c.is_active ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                          {c.is_active ? 'Active' : 'Inactive'}
                        </span>
                        <svg className={`w-3.5 h-3.5 text-slate-600 transition-transform duration-150 ${open ? 'rotate-180 text-slate-400' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                      </span>
                    </button>
                    {/* Inline preview — expands under the row; editing opens the drawer */}
                    {open && !editing && (
                      <ProfilePanel
                        customer={c}
                        data={profileData}
                        contacts={contacts}
                        amName={c.account_manager_id ? (amById.get(c.account_manager_id) ?? '') : ''}
                        tierName={c.tier ? (tierLabel.get(c.tier) ?? c.tier) : ''}
                        onClose={() => { setProfileFor(null); setProfileData(null); }}
                        onEdit={() => openDrawer(c)}
                        onOpenDoc={(qid) => router.push(`/sales/${qid}`)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Drawer */}
      {editing && (
        <Drawer
          customer={editing}
          contacts={draftContacts}
          amUsers={amUsers}
          tiers={tiers}
          saving={saving}
          onField={setField}
          onClose={closeDrawer}
          onSave={save}
          onAddContact={() => setDraftContacts((l) => [...l, newContact(editing.customer_id)])}
          onRemoveContact={(id) => setDraftContacts((l) => l.filter((c) => c.contact_id !== id))}
          onContactField={setContactField}
          onSetPrimary={setPrimary}
        />
      )}

      {/* Import preview — nothing writes until confirmed */}
      {importPreview && (
        <div className="fixed inset-0 z-[105] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setImportPreview(null)} />
          <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl">
            <div className="px-5 pt-4 pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white">Import customers — preview</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {importPreview.updates.length} update{importPreview.updates.length !== 1 ? 's' : ''} · {importPreview.creates.length} new customer{importPreview.creates.length !== 1 ? 's' : ''}
                {importPreview.skipped ? ` · ${importPreview.skipped} skipped (no code/name)` : ''} — contacts are not imported, edit those per customer
              </p>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3 text-xs">
              {importPreview.updates.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Updates</p>
                  <div className="rounded-lg border border-slate-800 divide-y divide-slate-800/60">
                    {importPreview.updates.map((u) => (
                      <div key={u.id} className="px-3 py-1.5 flex items-center gap-3">
                        <span className="text-slate-300 truncate flex-1">{u.label}</span>
                        <span className="text-slate-500 truncate">{u.changes.join(' · ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {importPreview.creates.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">New customers</p>
                  <div className="rounded-lg border border-slate-800 divide-y divide-slate-800/60">
                    {importPreview.creates.map((c, i) => (
                      <div key={i} className="px-3 py-1.5 text-emerald-300/90 truncate">{String(c.display_name)}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-800 flex items-center justify-end gap-2">
              <button onClick={() => setImportPreview(null)} disabled={importBusy}
                className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/10 border border-white/[0.06] transition-all">Cancel</button>
              <button onClick={applyImport} disabled={importBusy}
                className="px-4 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50">
                {importBusy ? 'Importing…' : `Apply ${importPreview.updates.length + importPreview.creates.length} rows`}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-[110] px-4 py-2.5 bg-slate-800 border border-slate-700 text-white text-sm font-semibold rounded-xl shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

// ── Profile panel (row click): expands inline under the row — activity,
//    document links, and stats. Editing opens the slide-over drawer. ─────────
const fmtIdr = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtD = (d?: string | null) => d ? new Date(d.length <= 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '';

function ProfilePanel({ customer, data, contacts, amName, tierName, onClose, onEdit, onOpenDoc }: {
  customer: Customer;
  data: ProfileData | null;
  contacts: Contact[];
  amName: string;
  tierName: string;
  onClose: () => void;
  onEdit: () => void;
  onOpenDoc: (quoteId: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const docs = data?.docs ?? [];
  const received = data?.received ?? {};
  const committed = docs.filter((d) => ['ordered', 'invoiced', 'preparing', 'delivered'].includes(d.status));
  const invoiced = docs.filter((d) => ['invoiced', 'preparing', 'delivered'].includes(d.status));
  const totalSales = committed.reduce((s, d) => s + (Number(d.grand_total) || 0), 0);
  const totalReceived = docs.reduce((s, d) => s + (received[d.quote_id] ?? 0), 0);
  const outstandingAR = invoiced.reduce((s, d) => s + Math.max(0, (Number(d.grand_total) || 0) - (received[d.quote_id] ?? 0)), 0);
  const quoteCount = docs.filter((d) => !['cancelled', 'rejected'].includes(d.status)).length;
  const winRate = quoteCount > 0 ? (committed.length / quoteCount) * 100 : null;
  const paidState = (d: SalesDoc) => {
    const total = Number(d.grand_total) || 0;
    const rcv = received[d.quote_id] ?? 0;
    if (total > 0 && rcv >= total - 0.5) return 'paid';
    if (rcv > 0) return 'partial';
    return 'unpaid';
  };
  const primary = contacts.find((x) => x.is_primary) ?? contacts[0];

  return (
    <div className="border-t border-slate-800/60 bg-[#101214]">
      {/* Context strip: code · tier · AM · primary contact, plus actions.
          The row above already shows the name, so no repeated heading. */}
      <div className="px-4 py-2.5 flex items-center gap-3 border-b border-slate-800/60">
        <p className="text-[11px] text-slate-500 truncate flex-1">
          <span className="font-mono">{customer.customer_code}</span>
          {tierName ? ` · ${tierName}` : ''}
          {amName ? ` · AM: ${amName}` : ''}
          {primary ? ` · ${primary.name}${primary.phone ? ` (${primary.phone})` : ''}` : ''}
        </p>
        <button onClick={onEdit}
          className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 text-[11px] font-semibold transition-colors flex-shrink-0">
          ✎ Edit
        </button>
        <button onClick={onClose} title="Collapse" className="p-1.5 -m-1 text-slate-500 hover:text-white transition-colors flex-shrink-0">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
        </button>
      </div>

      {!data ? (
        <div className="flex items-center justify-center py-10">
          <div className="w-5 h-5 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="px-4 py-4 space-y-5">
            {/* KPI row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <Kpi label="Total sales (orders)" value={`Rp${fmtIdr(totalSales)}`} sub={`${committed.length} order${committed.length !== 1 ? 's' : ''}`} cls="text-emerald-300" />
              <Kpi label="Received" value={`Rp${fmtIdr(totalReceived)}`} sub="all payments" cls="text-slate-200" />
              <Kpi label="Outstanding AR" value={`Rp${fmtIdr(outstandingAR)}`} sub="on issued invoices" cls={outstandingAR > 0 ? 'text-amber-300' : 'text-emerald-400'} />
              <Kpi label="Quotes → orders" value={winRate != null ? `${winRate.toFixed(0)}%` : '—'} sub={`${committed.length} of ${quoteCount} quotes`} cls="text-slate-200" />
            </div>

            {/* Documents: every quote/order/invoice/DO, linked */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">Documents & activity</h3>
              {docs.length === 0 ? (
                <p className="text-xs text-slate-600 italic">No sales documents yet — quotes for this customer will appear here.</p>
              ) : (
                <div className="rounded-xl border border-slate-800 divide-y divide-slate-800/60">
                  {docs.map((d) => {
                    const pay = paidState(d);
                    return (
                      <button key={d.quote_id} onClick={() => onOpenDoc(d.quote_id)}
                        className="w-full text-left px-3 py-2.5 hover:bg-slate-800/40 transition-colors">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[11px] text-slate-300">{d.quote_number}</span>
                          {(d.revision ?? 0) > 0 && <span className="text-[9px] font-bold text-sky-400">R{d.revision}</span>}
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${SALES_STATUS[d.status]?.cls ?? ''}`}>{SALES_STATUS[d.status]?.label ?? d.status}</span>
                          {['invoiced', 'preparing', 'delivered'].includes(d.status) && (
                            pay === 'paid'
                              ? <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300">PAID</span>
                              : pay === 'partial'
                              ? <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-300">PARTIAL</span>
                              : <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/10 text-red-400/90">UNPAID</span>
                          )}
                          <span className="ml-auto tabular-nums text-xs text-slate-200 font-semibold">Rp{fmtIdr(Number(d.grand_total) || 0)}</span>
                          <span className="text-[10px] text-slate-600 tabular-nums">{fmtD(d.updated_at || d.quote_date)}</span>
                        </div>
                        {(d.order_number || d.invoice_number || d.do_number) && (
                          <p className="mt-1 text-[10px] text-slate-500 font-mono flex flex-wrap gap-x-3">
                            {d.order_number && <span>SO {d.order_number}</span>}
                            {d.invoice_number && <span>INV {d.invoice_number}</span>}
                            {d.do_number && <span>DO {d.do_number}</span>}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Accounts receivable — unpaid / partial invoices */}
            {invoiced.some((d) => paidState(d) !== 'paid') && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">Accounts receivable</h3>
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] divide-y divide-slate-800/60">
                  {invoiced.filter((d) => paidState(d) !== 'paid').map((d) => {
                    const total = Number(d.grand_total) || 0;
                    const out = Math.max(0, total - (received[d.quote_id] ?? 0));
                    return (
                      <button key={d.quote_id} onClick={() => onOpenDoc(d.quote_id)}
                        className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-slate-800/30 transition-colors text-xs">
                        <span className="font-mono text-[11px] text-slate-300">{d.invoice_number || d.quote_number}</span>
                        <span className="text-slate-500">{fmtD(d.updated_at || d.quote_date)}</span>
                        <span className="ml-auto tabular-nums text-amber-300 font-semibold">Rp{fmtIdr(out)} outstanding</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Most ordered items */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">Most ordered items</h3>
              {data.topItems.length === 0 ? (
                <p className="text-xs text-slate-600 italic">No confirmed orders yet.</p>
              ) : (
                <div className="rounded-xl border border-slate-800 divide-y divide-slate-800/60">
                  {data.topItems.map((it) => (
                    <div key={it.desc} className="flex items-center gap-3 px-3 py-2 text-xs">
                      <span className="text-slate-300 truncate flex-1">{it.desc}</span>
                      <span className="text-slate-500 tabular-nums flex-shrink-0">{it.qty.toLocaleString('en-US')} {it.unit}</span>
                      <span className="text-slate-200 tabular-nums font-semibold flex-shrink-0 w-28 text-right">Rp{fmtIdr(it.value)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* EPC project quotes (10.x) linked to this customer via customer_id */}
            {data.epcQuotes.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">EPC proposals</h3>
                <div className="rounded-xl border border-violet-500/25 bg-violet-500/[0.04] divide-y divide-slate-800/60">
                  {data.epcQuotes.map((q) => (
                    <a key={q.quote_id} href={`/proposals/${q.quote_id}`}
                      className="block px-3 py-2.5 hover:bg-slate-800/40 transition-colors">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-[11px] text-violet-300">{q.quote_number}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          q.status === 'accepted' ? 'bg-emerald-500/20 text-emerald-300'
                          : q.status === 'sent' ? 'bg-sky-500/15 text-sky-300'
                          : q.status === 'rejected' ? 'bg-red-500/10 text-red-400/90'
                          : 'bg-slate-700/50 text-slate-300'
                        }`}>{q.status}</span>
                        <span className="ml-auto text-[10px] text-slate-600 tabular-nums">{fmtD(q.updated_at || q.quote_date)}</span>
                      </div>
                      {q.project_description && (
                        <p className="mt-1 text-[10px] text-slate-500 truncate">{q.project_description}</p>
                      )}
                    </a>
                  ))}
                </div>
              </section>
            )}

            {/* After-sales services — module not built yet, reserved here */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">After-sales services</h3>
              <p className="text-xs text-slate-600 italic">No after-sales module yet — service records, warranty claims, and maintenance visits will appear here once that module is built.</p>
            </section>
          </div>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, cls }: { label: string; value: string; sub: string; cls: string }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl px-3 py-2.5">
      <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">{label}</p>
      <p className={`text-sm font-bold tabular-nums mt-0.5 ${cls}`}>{value}</p>
      <p className="text-[9px] text-slate-600">{sub}</p>
    </div>
  );
}

// ── Drawer (slide-over) ──────────────────────────────────────────────────────
function Drawer({
  customer, contacts, amUsers, tiers, saving,
  onField, onClose, onSave, onAddContact, onRemoveContact, onContactField, onSetPrimary,
}: {
  customer: Customer;
  contacts: Contact[];
  amUsers: AmUser[];
  tiers: Tier[];
  saving: boolean;
  onField: <K extends keyof Customer>(k: K, v: Customer[K]) => void;
  onClose: () => void;
  onSave: () => void;
  onAddContact: () => void;
  onRemoveContact: (id: string) => void;
  onContactField: (id: string, k: keyof Contact, v: Contact[keyof Contact]) => void;
  onSetPrimary: (id: string) => void;
}) {
  const isNew = !customer.customer_id;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-xl h-full bg-[#141518] border-l border-slate-800 shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-[#141518]/95 backdrop-blur border-b border-slate-800 px-6 py-4 flex items-center justify-between gap-3 z-10">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white truncate">{isNew ? 'New Customer' : (customer.display_name || customer.legal_name || 'Edit Customer')}</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {isNew ? 'A CUST-code is assigned automatically on save' : <span className="font-mono">{customer.customer_code}</span>}
              {!isNew && customer.updated_by_email ? <span> · last edited by {customer.updated_by_email}</span> : null}
            </p>
          </div>
          <button onClick={onClose} className="p-2 -m-2 text-slate-500 hover:text-white transition-colors flex-shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Identity */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Display name" full>
              <input value={customer.display_name} onChange={(e) => onField('display_name', e.target.value)} placeholder="e.g. Acme Solar" className={inputCls} />
            </Field>
            <Field label="Legal name" full>
              <input value={customer.legal_name} onChange={(e) => onField('legal_name', e.target.value)} placeholder="PT Acme Solar Nusantara" className={inputCls} />
            </Field>
            <Field label="Tier">
              {tiers.length > 0 ? (
                <select value={customer.tier} onChange={(e) => onField('tier', e.target.value)} className={inputCls}>
                  <option value="">— None —</option>
                  {tiers.filter((t) => t.is_active || t.tier_code === customer.tier).map((t) => (
                    <option key={t.tier_code} value={t.tier_code}>{t.name}</option>
                  ))}
                  {customer.tier && !tiers.some((t) => t.tier_code === customer.tier) && (
                    <option value={customer.tier}>{customer.tier} (legacy)</option>
                  )}
                </select>
              ) : (
                <input value={customer.tier} onChange={(e) => onField('tier', e.target.value)} placeholder="e.g. Gold" className={inputCls} />
              )}
            </Field>
            <Field label="Tax ID (NPWP)">
              <input value={customer.tax_id} onChange={(e) => onField('tax_id', e.target.value)} className={inputCls} />
            </Field>
          </div>

          {/* Commercial */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Account manager" full>
              <select
                value={customer.account_manager_id ?? ''}
                onChange={(e) => onField('account_manager_id', e.target.value || null)}
                className={inputCls}
              >
                <option value="">Unassigned</option>
                {amUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {(u.display_name || u.email)} — {ROLE_LABELS[u.role]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Payment terms">
              <input value={customer.payment_terms} onChange={(e) => onField('payment_terms', e.target.value)} placeholder="e.g. Net 30" className={inputCls} />
            </Field>
            <Field label="Default currency">
              <select value={customer.default_currency} onChange={(e) => onField('default_currency', e.target.value)} className={inputCls}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>

          {/* Addresses */}
          <div className="grid grid-cols-1 gap-3">
            <Field label="Billing address">
              <textarea value={customer.billing_address} onChange={(e) => onField('billing_address', e.target.value)} rows={2} className={inputCls} />
            </Field>
            <Field label="Shipping address">
              <textarea value={customer.shipping_address} onChange={(e) => onField('shipping_address', e.target.value)} rows={2} className={inputCls} />
            </Field>
            <Field label="Notes">
              <textarea value={customer.notes} onChange={(e) => onField('notes', e.target.value)} rows={2} className={inputCls} />
            </Field>
          </div>

          {/* Active toggle */}
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input type="checkbox" checked={customer.is_active} onChange={(e) => onField('is_active', e.target.checked)} className="accent-emerald-500 w-4 h-4" />
            <span className="text-sm text-slate-300">Active customer</span>
          </label>

          {/* Contacts */}
          <div className="pt-2 border-t border-slate-800">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400">Contacts</h3>
              <button onClick={onAddContact} className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold transition-colors">+ Add contact</button>
            </div>
            {contacts.length === 0 ? (
              <p className="text-xs text-slate-600 italic py-2">No contacts yet.</p>
            ) : (
              <div className="space-y-3">
                {contacts.map((ct) => (
                  <div key={ct.contact_id} className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input value={ct.name} onChange={(e) => onContactField(ct.contact_id, 'name', e.target.value)} placeholder="Name" className={inputSm} />
                      <input value={ct.title} onChange={(e) => onContactField(ct.contact_id, 'title', e.target.value)} placeholder="Title / role" className={inputSm} />
                      <input value={ct.email} onChange={(e) => onContactField(ct.contact_id, 'email', e.target.value)} placeholder="Email" className={inputSm} />
                      <input value={ct.phone} onChange={(e) => onContactField(ct.contact_id, 'phone', e.target.value)} placeholder="Phone" className={inputSm} />
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-[11px] text-slate-400 cursor-pointer select-none">
                        <input type="radio" name="primary-contact" checked={ct.is_primary} onChange={() => onSetPrimary(ct.contact_id)} className="accent-emerald-500" />
                        Primary contact
                      </label>
                      <button onClick={() => onRemoveContact(ct.contact_id)} className="text-[11px] text-red-400/70 hover:text-red-400 transition-colors">Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-[#141518]/95 backdrop-blur border-t border-slate-800 px-6 py-4 flex items-center justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-sm transition-colors">Cancel</button>
          <button
            onClick={onSave}
            disabled={saving}
            className="px-5 py-2 rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {saving && <span className="w-3.5 h-3.5 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin" />}
            {isNew ? 'Create customer' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 focus:border-emerald-500/60 outline-none text-white text-sm placeholder:text-slate-600 transition-colors';
const inputSm = 'w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 focus:border-emerald-500/50 outline-none text-white text-xs placeholder:text-slate-600 transition-colors';

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <label className="block text-[11px] font-medium text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

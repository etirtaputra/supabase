/**
 * ICAPROC — Module 1: CRM (Customers)
 * Searchable customer master with a create/edit drawer, contacts sub-list, and
 * Account Manager assignment. Gated to owners + sales (canManageCustomers).
 */
'use client';
import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_PERMISSIONS, ROLE_LABELS, type UserRole } from '@/constants/roles';
import BrandMenu from '@/components/ui/BrandMenu';
import CrmMigrationBanner from '@/components/ui/CrmMigrationBanner';
import { SALES_STATUS, displayDocNumber } from '@/lib/salesStatus';
import { downloadCsv, parseCsv, readFileText } from '@/lib/csv';
import { fmtDay, fmtDayTime, fmtInt, fmtRupiah } from '@/lib/formatters';
import { useSettings } from '@/hooks/useSettings';
import LayoutToggle from '@/components/ui/LayoutToggle';
import { useListLayout } from '@/hooks/useListLayout';
import { useListDefaults } from '@/hooks/useListDefaults';
import { listSpec } from '@/constants/listDefaults';

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
  referred_by: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
  created_by_email?: string;
  updated_by_email?: string;
}

/** A related company (same group, subsidiary…). Stored one row per pair;
 *  read in BOTH directions so either side sees and can edit the link. */
interface CustomerLink {
  link_id: string;
  customer_id: string;
  linked_customer_id: string;
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
interface InvLite { invoice_id: string; quote_id: string; invoice_number: string; grand_total: number }
interface DoLite { do_id: string; quote_id: string; do_number: string; status: string }
interface ProfileData {
  docs: SalesDoc[];
  received: Record<string, number>;
  topItems: { desc: string; qty: number; value: number; unit: string; times: number }[];
  epcQuotes: EpcQuote[];
  invoicesByQuote: Record<string, InvLite[]>;
  dosByQuote: Record<string, DoLite[]>;
  paidByInvoice: Record<string, number>;
}

const CURRENCIES = ['IDR', 'USD', 'EUR', 'CNY', 'SGD'];

const blankCustomer = (tier = ''): Customer => ({
  customer_id: '',
  customer_code: '',
  legal_name: '',
  display_name: '',
  tier,
  account_manager_id: null,
  payment_terms: '',
  default_currency: 'IDR',
  tax_id: '',
  billing_address: '',
  shipping_address: '',
  notes: '',
  referred_by: '',
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
    <div className="min-h-screen bg-chrome flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
    </div>
  );
}

function CustomersInner() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, profile, loading: authLoading } = useAuth();
  // A new customer starts on the house tier (Settings › Pricing; blank = none)
  const { defaultCustomerTier } = useSettings();
  const [layout, setLayout] = useListLayout('customers');
  const compact = layout === 'compact';
  // Opening order comes from Settings › Lists; still changeable here.
  const listDefaults = useListDefaults('customers');
  const [sort, setSort] = useState(listDefaults.sort);
  const sortTouched = useRef(false);
  useEffect(() => { if (!sortTouched.current) setSort(listDefaults.sort); }, [listDefaults.sort]);

  const canManage = !!profile && ROLE_PERMISSIONS[profile.role].canManageCustomers;
  const canSeeEpc = !!profile && ROLE_PERMISSIONS[profile.role].projects; // EPC module hidden from roles without access

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [contactsByCustomer, setContactsByCustomer] = useState<Record<string, Contact[]>>({});
  const [amUsers, setAmUsers] = useState<AmUser[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [links, setLinks] = useState<CustomerLink[]>([]);
  const [txnByCustomer, setTxnByCustomer] = useState<Record<string, { n: number; value: number }>>({});
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState(searchParams.get('q') ?? '');
  // Toolbar filters (owner's ask): who manages it, which tier, active or not.
  const [filterAm, setFilterAm] = useState('');       // '' all · 'unassigned' · user id
  const [filterTier, setFilterTier] = useState('');   // '' all · 'none' · tier_code
  const [filterStatus, setFilterStatus] = useState<'active' | 'inactive' | 'all'>('active');

  const [editing, setEditing] = useState<Customer | null>(null);
  const [draftContacts, setDraftContacts] = useState<Contact[]>([]);
  const [draftLinks, setDraftLinks] = useState<string[]>([]); // linked customer ids
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
    const paidByInvoice: Record<string, number> = {};
    const invoicesByQuote: Record<string, InvLite[]> = {};
    const dosByQuote: Record<string, DoLite[]> = {};
    const agg = new Map<string, { desc: string; qty: number; value: number; unit: string; times: number }>();
    if (ids.length) {
      const [rRes, iRes, invRes, doRes] = await Promise.all([
        supabase.from('26.0_customer_receipts').select('quote_id, invoice_id, amount').in('quote_id', ids),
        supabase.from('22.1_sales_quote_items').select('quote_id, description, quantity, unit, line_total, is_section').in('quote_id', ids),
        supabase.from('25.0_sales_invoices').select('invoice_id, quote_id, invoice_number, grand_total').in('quote_id', ids).order('created_at'),
        supabase.from('24.0_delivery_orders').select('do_id, quote_id, do_number, status').in('quote_id', ids).order('created_at'),
      ]);
      for (const r of (rRes.data as { quote_id: string; invoice_id?: string | null; amount: number }[]) ?? []) {
        received[r.quote_id] = (received[r.quote_id] ?? 0) + (Number(r.amount) || 0);
        if (r.invoice_id) paidByInvoice[r.invoice_id] = (paidByInvoice[r.invoice_id] ?? 0) + (Number(r.amount) || 0);
      }
      for (const i of ((invRes.error ? [] : invRes.data as InvLite[]) ?? [])) (invoicesByQuote[i.quote_id] ??= []).push(i);
      for (const d of ((doRes.error ? [] : doRes.data as DoLite[]) ?? [])) (dosByQuote[d.quote_id] ??= []).push(d);
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
    setProfileData({ docs: list, received, topItems, epcQuotes: (epc as EpcQuote[]) ?? [], invoicesByQuote, dosByQuote, paidByInvoice });
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
    const [custRes, contactRes, userRes, tierRes, linkRes, txnRes] = await Promise.all([
      supabase.from('20.0_customers').select('*').order('updated_at', { ascending: false }),
      supabase.from('20.1_customer_contacts').select('*').order('is_primary', { ascending: false }),
      supabase.from('user_profiles').select('id, email, display_name, role').in('role', ['owner', 'sales']),
      supabase.from('21.0_price_tiers').select('tier_code, name, sort_order, is_active').order('sort_order'),
      supabase.from('20.2_customer_links').select('link_id, customer_id, linked_customer_id'),
      supabase.from('22.0_sales_quotes').select('customer_id, status, grand_total'),
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
    setLinks(linkRes.error ? [] : ((linkRes.data as CustomerLink[]) ?? []));
    // Transactions = confirmed business (SO onward), same rule as the profile
    // KPIs; value breaks ties on the "Most transactions" sort.
    const txn: Record<string, { n: number; value: number }> = {};
    for (const q of ((txnRes.error ? [] : txnRes.data as { customer_id: string | null; status: string; grand_total: number }[]) ?? [])) {
      if (!q.customer_id || !['ordered', 'invoiced', 'preparing', 'delivered'].includes(q.status)) continue;
      const t = (txn[q.customer_id] ??= { n: 0, value: 0 });
      t.n += 1;
      t.value += Number(q.grand_total) || 0;
    }
    setTxnByCustomer(txn);
    setLoading(false);
  }, []);

  useEffect(() => { if (canManage) fetchAll(); }, [canManage, fetchAll]);

  const amById = useMemo(
    () => new Map(amUsers.map((u) => [u.id, u.display_name || u.email])),
    [amUsers]);
  const tierLabel = useMemo(
    () => new Map(tiers.map((t) => [t.tier_code, t.name])),
    [tiers]);
  const customerName = useMemo(
    () => new Map(customers.map((c) => [c.customer_id, c.display_name || c.legal_name || c.customer_code])),
    [customers]);
  // Related companies of a customer — the link rows are one-per-pair, so read
  // both directions.
  const linkedIdsOf = useCallback((id: string) => {
    const out = new Set<string>();
    for (const l of links) {
      if (l.customer_id === id) out.add(l.linked_customer_id);
      else if (l.linked_customer_id === id) out.add(l.customer_id);
    }
    return [...out];
  }, [links]);

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
      if (filterStatus !== 'all' && c.is_active !== (filterStatus === 'active')) return false;
      if (filterAm === 'unassigned' ? c.account_manager_id : (filterAm && c.account_manager_id !== filterAm)) return false;
      if (filterTier === 'none' ? c.tier : (filterTier && c.tier !== filterTier)) return false;
      if (!q) return true;
      const hay = [
        c.customer_code, c.legal_name, c.display_name, c.tier,
        amById.get(c.account_manager_id ?? '') ?? '',
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [customers, search, filterStatus, filterAm, filterTier, amById]);

  // ── Possible duplicates (post-import cleanup) ─────────────────────────────
  // Two customers are "possibly the same" when their names normalize to the
  // same string (case/punctuation/legal-prefix insensitive) OR they share a
  // contact email / phone. Union-find stitches the signals into groups.
  const [dupMode, setDupMode] = useState(false);
  const dupGroups = useMemo(() => {
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      const p = parent.get(x) ?? x;
      if (p === x) return x;
      const r = find(p);
      parent.set(x, r);
      return r;
    };
    const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
    const norm = (s: string) =>
      s.toLowerCase().replace(/^(pt|cv|ud|tb|pd|toko)\b\.?\s*/i, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const byKey = new Map<string, string>();
    for (const c of customers) {
      const keys = new Set<string>();
      const n1 = norm(c.display_name || ''); if (n1) keys.add('n:' + n1);
      const n2 = norm(c.legal_name || '');   if (n2) keys.add('n:' + n2);
      for (const ct of contactsByCustomer[c.customer_id] ?? []) {
        const e = ct.email.trim().toLowerCase(); if (e) keys.add('e:' + e);
        const p = ct.phone.replace(/\D/g, '');   if (p.length >= 8) keys.add('p:' + p.replace(/^62/, '0'));
      }
      for (const k of keys) {
        const first = byKey.get(k);
        if (first) union(c.customer_id, first); else byKey.set(k, c.customer_id);
      }
    }
    const groups = new Map<string, Customer[]>();
    for (const c of customers) {
      const r = find(c.customer_id);
      const arr = groups.get(r) ?? [];
      arr.push(c);
      groups.set(r, arr);
    }
    return [...groups.values()].filter((g) => g.length > 1)
      .sort((a, b) => (a[0].display_name || '').localeCompare(b[0].display_name || ''));
  }, [customers, contactsByCustomer]);

  // Merge: fill the survivor's blank fields from the duplicates, repoint
  // everything that references them (contacts, sales docs, after-sales,
  // project quotes, links), then delete the duplicates. Documents are
  // repointed FIRST — their FKs are ON DELETE SET NULL, so deleting before
  // repointing would silently orphan sales history.
  const [mergeBusy, setMergeBusy] = useState(false);
  async function mergeGroup(group: Customer[], survivorId: string) {
    const survivor = group.find((c) => c.customer_id === survivorId);
    if (!survivor || mergeBusy) return;
    const victims = group.filter((c) => c.customer_id !== survivorId);
    const vIds = victims.map((v) => v.customer_id);
    setMergeBusy(true);

    const patch: Record<string, unknown> = {};
    const FILL: (keyof Customer)[] = ['legal_name', 'display_name', 'tier', 'payment_terms', 'tax_id', 'billing_address', 'shipping_address', 'referred_by'];
    for (const k of FILL) {
      if (!(survivor[k] as string || '').trim()) {
        const v = victims.map((x) => (x[k] as string) || '').find((x) => x.trim());
        if (v) patch[k] = v.trim();
      }
    }
    if (!survivor.account_manager_id) {
      const v = victims.find((x) => x.account_manager_id);
      if (v) patch.account_manager_id = v.account_manager_id;
    }
    const extraNotes = victims.map((v) => (v.notes || '').trim()).filter((n) => n && n !== (survivor.notes || '').trim());
    if (extraNotes.length) patch.notes = [(survivor.notes || '').trim(), ...extraNotes].filter(Boolean).join('\n');
    if (Object.keys(patch).length) {
      const { error } = await supabase.from('20.0_customers').update(patch).eq('customer_id', survivorId);
      if (error) { flash(`Merge stopped: ${error.message}`); setMergeBusy(false); return; }
    }

    // Repoint referencing rows. Bail BEFORE deleting on any real failure —
    // a missing optional table (project quotes / after-sales not installed)
    // is the only tolerated error.
    for (const table of ['20.1_customer_contacts', '22.0_sales_quotes', '27.0_aftersales_cases', '10.0_project_quotes']) {
      const { error } = await supabase.from(table).update({ customer_id: survivorId }).in('customer_id', vIds);
      if (error && !/does not exist|relation/i.test(error.message)) {
        flash(`Merge stopped (nothing deleted): ${table}: ${error.message}`);
        setMergeBusy(false);
        return;
      }
    }

    // Links: rewrite the victims' pairs onto the survivor, skipping
    // self-links; the unique constraint absorbs pairs that already exist.
    const orExpr = vIds.map((id) => `customer_id.eq.${id},linked_customer_id.eq.${id}`).join(',');
    const { data: vLinks } = await supabase.from('20.2_customer_links').select('customer_id, linked_customer_id').or(orExpr);
    await supabase.from('20.2_customer_links').delete().or(orExpr);
    const remap = (id: string) => (vIds.includes(id) ? survivorId : id);
    const pairs = new Map<string, { customer_id: string; linked_customer_id: string }>();
    for (const l of (vLinks as CustomerLink[] | null) ?? []) {
      const a = remap(l.customer_id), b = remap(l.linked_customer_id);
      if (a !== b) pairs.set([a, b].sort().join('|'), { customer_id: a, linked_customer_id: b });
    }
    if (pairs.size) await supabase.from('20.2_customer_links').upsert([...pairs.values()], { onConflict: 'customer_id,linked_customer_id', ignoreDuplicates: true });

    const { error: delError } = await supabase.from('20.0_customers').delete().in('customer_id', vIds);
    if (delError) flash(`Merged data, but deleting duplicates failed: ${delError.message}`);
    else flash(`Merged ${victims.length} duplicate${victims.length > 1 ? 's' : ''} into ${survivor.display_name || survivor.legal_name}`);
    setMergeBusy(false);
    setProfileFor(null); setProfileData(null);
    fetchAll();
  }

  // Column-header sort: click a title to sort by it ascending, click again to
  // flip. Overrides the dropdown order until the dropdown is touched again.
  type ColKey = 'code' | 'name' | 'tier' | 'am' | 'status' | 'updated';
  const [colSort, setColSort] = useState<{ key: ColKey; dir: 'asc' | 'desc' } | null>(null);
  const clickCol = (key: ColKey) =>
    setColSort((s) => (s?.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      // Text columns read naturally A→Z; a DATE column reads naturally
      // newest-first — so Updated starts descending, the rest ascending.
      : { key, dir: key === 'updated' ? 'desc' : 'asc' }));

  const ordered = useMemo(() => {
    const list = [...filtered];
    if (colSort) {
      const { key, dir } = colSort;
      const val = (c: Customer): string => {
        switch (key) {
          case 'code':   return c.customer_code || '';
          case 'name':   return (c.display_name || c.legal_name || '').toLowerCase();
          case 'tier':   return c.tier ? (tierLabel.get(c.tier) ?? c.tier).toLowerCase() : '';
          case 'am':     return c.account_manager_id ? (amById.get(c.account_manager_id) ?? '').toLowerCase() : '';
          case 'status': return c.is_active ? 'a' : 'b'; // active first when ascending
          case 'updated': return c.updated_at || '';    // ISO strings sort lexicographically
        }
      };
      list.sort((a, b) => {
        const va = val(a), vb = val(b);
        if (!va !== !vb) return va ? -1 : 1; // blanks sink to the bottom either way
        const cmp = va.localeCompare(vb, undefined, { numeric: true });
        return dir === 'asc' ? cmp : -cmp;
      });
      return list;
    }
    if (sort === 'name') list.sort((a, b) => (a.display_name || a.legal_name || '').localeCompare(b.display_name || b.legal_name || ''));
    else if (sort === 'updated') list.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    else if (sort === 'transactions') list.sort((a, b) => {
      const ta = txnByCustomer[a.customer_id], tb = txnByCustomer[b.customer_id];
      return ((tb?.n ?? 0) - (ta?.n ?? 0)) || ((tb?.value ?? 0) - (ta?.value ?? 0))
        || (a.display_name || a.legal_name || '').localeCompare(b.display_name || b.legal_name || '');
    });
    else list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));   // 'created'
    return list;
  }, [filtered, sort, colSort, tierLabel, amById, txnByCustomer]);

  // ── Drawer ──────────────────────────────────────────────────────────────────
  function openDrawer(c: Customer | null) {
    const target = c ?? blankCustomer(defaultCustomerTier);
    setEditing(target);
    setDraftContacts(target.customer_id ? (contactsByCustomer[target.customer_id] ?? []).map((x) => ({ ...x })) : []);
    setDraftLinks(target.customer_id ? linkedIdsOf(target.customer_id) : []);
  }
  function closeDrawer() { setEditing(null); setDraftContacts([]); setDraftLinks([]); }

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
      referred_by: editing.referred_by.trim(),
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

    // Reconcile links the same way: rewrite every row touching this customer
    // (both directions), so whichever side edits a pair fully controls it.
    await supabase.from('20.2_customer_links').delete()
      .or(`customer_id.eq.${customerId},linked_customer_id.eq.${customerId}`);
    const linkRows = [...new Set(draftLinks)].filter((id) => id && id !== customerId)
      .map((id) => ({ customer_id: customerId, linked_customer_id: id }));
    if (linkRows.length) {
      const { error } = await supabase.from('20.2_customer_links').insert(linkRows);
      if (error) { flash(`Saved customer, but links failed: ${error.message}`); }
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
    const headers = ['customer_code', 'display_name', 'legal_name', 'tier', 'account_manager', 'payment_terms', 'default_currency', 'tax_id', 'billing_address', 'shipping_address', 'notes', 'referred_by', 'active', 'primary_contact', 'contact_email', 'contact_phone'];
    const data = filtered.map((c) => {
      const contacts = contactsByCustomer[c.customer_id] ?? [];
      const primary = contacts.find((x) => x.is_primary) ?? contacts[0];
      return [
        c.customer_code, c.display_name, c.legal_name, c.tier,
        amById.get(c.account_manager_id ?? '') ?? '', c.payment_terms, c.default_currency,
        c.tax_id, c.billing_address, c.shipping_address, c.notes, c.referred_by, c.is_active ? 'yes' : 'no',
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
          ['referred_by', r.referredby, (v) => v],
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
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      {/* Header */}
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        {/* Phones: wordmark row then actions row — side-by-side squeezes the
            three buttons into the wordmark. sm+ keeps the single row. */}
        <div className="max-w-[1600px] 2xl:max-w-[2120px] mx-auto px-3 sm:px-4 md:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between sm:flex-wrap gap-2.5 sm:gap-4">
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

      <main className="max-w-[1600px] 2xl:max-w-[2120px] mx-auto px-3 sm:px-4 md:px-6 py-8 space-y-6">
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
          <select value={filterAm} onChange={(e) => setFilterAm(e.target.value)} title="Filter by account manager"
            className="text-xs bg-slate-900/80 border border-slate-700 text-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:border-emerald-500/60 max-w-[160px]">
            <option value="">All managers</option>
            <option value="unassigned">Unassigned</option>
            {amUsers.map((u) => <option key={u.id} value={u.id}>{u.display_name || u.email}</option>)}
          </select>
          <select value={filterTier} onChange={(e) => setFilterTier(e.target.value)} title="Filter by tier"
            className="text-xs bg-slate-900/80 border border-slate-700 text-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:border-emerald-500/60 max-w-[140px]">
            <option value="">All tiers</option>
            <option value="none">No tier</option>
            {tiers.filter((t) => t.is_active !== false).map((t) => <option key={t.tier_code} value={t.tier_code}>{t.name}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as 'active' | 'inactive' | 'all')} title="Filter by status"
            className="text-xs bg-slate-900/80 border border-slate-700 text-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:border-emerald-500/60">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All statuses</option>
          </select>
          <button onClick={() => setDupMode((v) => !v)}
            title="Show possible duplicates (similar name or shared contact) with a merge tool"
            className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
              dupMode
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                : dupGroups.length
                  ? 'bg-slate-900/80 border-slate-700 text-amber-400/90 hover:border-amber-500/40'
                  : 'bg-slate-900/80 border-slate-700 text-slate-500 hover:text-slate-300'
            }`}>
            Duplicates{dupGroups.length ? ` (${dupGroups.length})` : ''}
          </button>
          <span className="text-xs text-slate-600 tabular-nums">{filtered.length} of {customers.length}</span>
          <select value={sort} onChange={(e) => { sortTouched.current = true; setSort(e.target.value); setColSort(null); }}
            title="Order — the default lives in Settings › Lists"
            className="text-xs bg-slate-900/80 border border-slate-700 text-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:border-emerald-500/60">
            {listSpec('customers').sorts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <LayoutToggle value={layout} onChange={setLayout} />
        </div>

        {/* Possible-duplicate groups with the merge tool */}
        {dupMode && (
          <div className="space-y-3">
            {dupGroups.length === 0 ? (
              <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl px-4 py-10 text-center text-sm text-slate-500">
                No possible duplicates found — names and contacts all look distinct.
              </div>
            ) : (
              <>
                <p className="text-[11px] text-slate-500 leading-snug">
                  Grouped by similar name or shared contact email / phone. Pick the record to KEEP — merging fills its blank
                  fields from the others, moves their contacts, sales documents and links across, then deletes them.
                </p>
                {dupGroups.map((g) => (
                  <DupGroupCard key={g.map((c) => c.customer_id).join('|')} group={g}
                    tierLabel={tierLabel} amById={amById} contactsByCustomer={contactsByCustomer}
                    busy={mergeBusy} onMerge={mergeGroup} />
                ))}
              </>
            )}
          </div>
        )}

        {/* List */}
        {!dupMode && (
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden">
          {/* Sortable titles: click sorts ascending, click again flips.
              Overrides the order dropdown until it is touched again. */}
          <div className={`hidden md:grid grid-cols-[130px_1fr_110px_170px_90px_135px] gap-3 border-b border-slate-800 text-[10px] font-semibold uppercase tracking-widest text-slate-500 ${compact ? 'px-3 py-1.5' : 'px-4 py-2.5'}`}>
            {([['code', 'Code'], ['name', 'Name'], ['tier', 'Tier'], ['am', 'Account Manager'], ['status', 'Status'], ['updated', 'Updated']] as [ColKey, string][]).map(([k, label]) => (
              <button key={k} onClick={() => clickCol(k)} title={`Sort by ${label.toLowerCase()}`}
                className={`flex items-center gap-1 text-left uppercase tracking-widest transition-colors ${
                  colSort?.key === k ? 'text-slate-200' : 'hover:text-slate-300'
                }`}>
                {label}
                <span className={`text-[8px] ${colSort?.key === k ? 'text-emerald-400' : 'text-transparent'}`}>
                  {colSort?.key === k && colSort.dir === 'desc' ? '▼' : '▲'}
                </span>
              </button>
            ))}
          </div>
          {loading ? (
            <div className="p-4 space-y-1.5">{[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>
          ) : ordered.length === 0 ? (
            <div className="px-4 py-12 text-center text-slate-600 text-sm">
              {customers.length === 0 ? 'No customers yet — create your first one.' : 'No customers match your search.'}
            </div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {ordered.map((c) => {
                const contacts = contactsByCustomer[c.customer_id] ?? [];
                const primary = contacts.find((x) => x.is_primary) ?? contacts[0];
                const open = profileFor?.customer_id === c.customer_id;
                return (
                  <div key={c.customer_id}>
                    {/* Compact on a PHONE = one line per customer (name · tier ·
                        status dot); the stacked card belongs to the card layout.
                        On md+ both layouts are the table grid — compact only
                        tightens it. */}
                    <button
                      onClick={() => openProfile(c)}
                      aria-expanded={open}
                      className={`w-full text-left transition-colors items-center md:grid md:grid-cols-[130px_1fr_110px_170px_90px_135px] md:gap-3 ${
                        compact ? 'flex gap-2 px-3 py-1.5' : 'grid grid-cols-1 gap-1 px-4 py-3'
                      } ${open ? 'bg-slate-800/40' : 'hover:bg-slate-800/40'}`}
                    >
                      <span className={`font-mono text-[11px] text-slate-400 ${compact ? 'hidden md:block' : ''}`}>{c.customer_code || '—'}</span>
                      <span className={`min-w-0 ${compact ? 'flex-1' : ''}`}>
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="text-sm text-slate-100 font-medium truncate">{c.display_name || c.legal_name || '(no name)'}</span>
                          {/* Ranked by transactions → show the number being ranked on */}
                          {sort === 'transactions' && !colSort && (
                            <span className="flex-shrink-0 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 text-[10px] font-semibold tabular-nums"
                              title={txnByCustomer[c.customer_id] ? fmtRupiah(txnByCustomer[c.customer_id].value) : undefined}>
                              {txnByCustomer[c.customer_id]?.n ?? 0} order{(txnByCustomer[c.customer_id]?.n ?? 0) !== 1 ? 's' : ''}
                            </span>
                          )}
                        </span>
                        {primary && !compact && <span className="block text-[11px] text-slate-500 truncate">{primary.name}{primary.email ? ` · ${primary.email}` : ''}</span>}
                      </span>
                      <span className={`text-xs text-slate-400 ${compact ? 'flex-shrink-0' : ''}`}>{c.tier ? <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[11px]">{tierLabel.get(c.tier) ?? c.tier}</span> : <span className="text-slate-600">—</span>}</span>
                      <span className={`text-xs text-slate-400 truncate ${compact ? 'hidden md:block' : ''}`}>{c.account_manager_id ? (amById.get(c.account_manager_id) ?? '—') : <span className="text-slate-600">Unassigned</span>}</span>
                      <span className={`flex items-center gap-2 ${compact ? 'flex-shrink-0 md:justify-between' : 'justify-between'}`}>
                        <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${c.is_active ? 'text-emerald-400' : 'text-slate-500'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${c.is_active ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                          <span className={compact ? 'hidden md:inline' : ''}>{c.is_active ? 'Active' : 'Inactive'}</span>
                        </span>
                        <svg className={`w-3.5 h-3.5 text-slate-600 transition-transform duration-150 md:hidden ${open ? 'rotate-180 text-slate-400' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                      </span>
                      {/* Last modified — the audit trigger stamps every save */}
                      <span className={`text-[11px] text-slate-500 tabular-nums items-center justify-between gap-2 hidden md:flex`}>
                        <span title={c.updated_by_email ? `by ${c.updated_by_email}` : undefined}>{c.updated_at ? fmtDayTime(c.updated_at) : '—'}</span>
                        <svg className={`w-3.5 h-3.5 text-slate-600 transition-transform duration-150 flex-shrink-0 ${open ? 'rotate-180 text-slate-400' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                      </span>
                    </button>
                    {/* Inline preview — expands under the row; editing opens the drawer */}
                    {open && !editing && (
                      <ProfilePanel
                        showEpc={canSeeEpc}
                        customer={c}
                        data={profileData}
                        contacts={contacts}
                        amName={c.account_manager_id ? (amById.get(c.account_manager_id) ?? '') : ''}
                        tierName={c.tier ? (tierLabel.get(c.tier) ?? c.tier) : ''}
                        linked={linkedIdsOf(c.customer_id).map((id) => ({ id, name: customerName.get(id) ?? '(deleted)' }))}
                        onOpenCustomer={(id) => { const t = customers.find((x) => x.customer_id === id); if (t) openProfile(t); }}
                        onClose={() => { setProfileFor(null); setProfileData(null); }}
                        onEdit={() => openDrawer(c)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}
      </main>

      {/* Drawer */}
      {editing && (
        <Drawer
          customer={editing}
          contacts={draftContacts}
          amUsers={amUsers}
          tiers={tiers}
          saving={saving}
          allCustomers={customers}
          draftLinks={draftLinks}
          onField={setField}
          onClose={closeDrawer}
          onSave={save}
          onAddContact={() => setDraftContacts((l) => [...l, newContact(editing.customer_id)])}
          onRemoveContact={(id) => setDraftContacts((l) => l.filter((c) => c.contact_id !== id))}
          onContactField={setContactField}
          onSetPrimary={setPrimary}
          onLinks={setDraftLinks}
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


function ProfilePanel({ customer, data, contacts, amName, tierName, linked, onOpenCustomer, onClose, onEdit, showEpc }: {
  customer: Customer;
  data: ProfileData | null;
  contacts: Contact[];
  amName: string;
  tierName: string;
  linked: { id: string; name: string }[];
  onOpenCustomer: (customerId: string) => void;
  showEpc: boolean;
  onClose: () => void;
  onEdit: () => void;
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
    <div className="border-t border-slate-800/60 bg-sunken">
      {/* Context strip: code · tier · AM · primary contact, plus actions.
          The row above already shows the name, so no repeated heading. */}
      <div className="px-4 py-2.5 flex items-center gap-3 border-b border-slate-800/60">
        <p className="text-[11px] text-slate-500 truncate min-w-0">
          <span className="font-mono">{customer.customer_code}</span>
          {tierName ? ` · ${tierName}` : ''}
          {amName ? ` · AM: ${amName}` : ''}
          {primary ? ` · ${primary.name}${primary.phone ? ` (${primary.phone})` : ''}` : ''}
          {customer.referred_by ? ` · Referred by ${customer.referred_by}` : ''}
          {customer.updated_at ? ` · Edited ${fmtDayTime(customer.updated_at)}${customer.updated_by_email ? ` by ${customer.updated_by_email}` : ''}` : ''}
        </p>
        {/* Ghost button, right beside the context it edits — not exiled to the far edge */}
        <button onClick={onEdit}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-700/70 text-[11px] font-medium text-slate-400 hover:text-emerald-300 hover:border-emerald-500/40 transition-colors flex-shrink-0">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
          Edit
        </button>
        <span className="flex-1" />
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
              <Kpi label="Total sales (orders)" value={fmtRupiah(totalSales)} sub={`${committed.length} order${committed.length !== 1 ? 's' : ''}`} cls="text-emerald-300" />
              <Kpi label="Received" value={fmtRupiah(totalReceived)} sub="all payments" cls="text-slate-200" />
              <Kpi label="Outstanding AR" value={fmtRupiah(outstandingAR)} sub="on issued invoices" cls={outstandingAR > 0 ? 'text-amber-300' : 'text-emerald-400'} />
              <Kpi label="Quotes → orders" value={winRate != null ? `${winRate.toFixed(0)}%` : '—'} sub={`${committed.length} of ${quoteCount} quotes`} cls="text-slate-200" />
            </div>

            {/* Related companies — same group / subsidiaries, click to jump */}
            {linked.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">Linked customers</h3>
                <div className="flex flex-wrap gap-1.5">
                  {linked.map((l) => (
                    <button key={l.id} onClick={() => onOpenCustomer(l.id)}
                      className="px-2.5 py-1 rounded-lg bg-slate-800/70 border border-slate-700/60 text-[11px] text-slate-300 hover:text-emerald-300 hover:border-emerald-500/40 transition-colors">
                      {l.name} →
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Documents: every quote/order/invoice/DO, linked */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">Documents & activity</h3>
              {docs.length === 0 ? (
                <p className="text-xs text-slate-600 italic">No sales documents yet — quotes for this customer will appear here.</p>
              ) : (
                <div className="rounded-xl border border-slate-800 divide-y divide-slate-800/60">
                  {docs.map((d) => {
                    const pay = paidState(d);
                    // Real per-quote invoices/DOs (split billing & shipments);
                    // fall back to the legacy quote-level numbers for old docs.
                    const invs = data.invoicesByQuote[d.quote_id] ?? [];
                    const qdos = data.dosByQuote[d.quote_id] ?? [];
                    // Same vocabulary + colours as the Sales page digest chips
                    const payChip = (st: 'Paid' | 'Partial' | 'Unpaid') =>
                      st === 'Paid' ? 'bg-emerald-500/10 text-emerald-300' : st === 'Partial' ? 'bg-amber-500/10 text-amber-300' : 'bg-slate-800 text-slate-400';
                    const quotePay: 'Paid' | 'Partial' | 'Unpaid' = pay === 'paid' ? 'Paid' : pay === 'partial' ? 'Partial' : 'Unpaid';
                    const docLink = 'inline-flex items-center gap-1 text-slate-500 hover:text-emerald-300 transition-colors';
                    return (
                      <div key={d.quote_id} role="link" tabIndex={0}
                        onClick={() => window.open(`/sales/${d.quote_id}`, '_blank', 'noopener')}
                        onKeyDown={(e) => { if (e.key === 'Enter') window.open(`/sales/${d.quote_id}`, '_blank', 'noopener'); }}
                        className="w-full text-left px-3 py-2.5 hover:bg-slate-800/40 transition-colors cursor-pointer">
                        <div className="flex items-center gap-2 flex-wrap">
                          <a href={`/sales/${d.quote_id}`} target="_blank" rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="font-mono text-[11px] text-slate-300 hover:text-emerald-300 transition-colors">{displayDocNumber(d)}</a>
                          {(d.revision ?? 0) > 0 && <span className="text-[9px] font-bold text-sky-400">R{d.revision}</span>}
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${SALES_STATUS[d.status]?.cls ?? ''}`}>{SALES_STATUS[d.status]?.label ?? d.status}</span>
                          {['invoiced', 'preparing', 'delivered'].includes(d.status) && (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${payChip(quotePay)}`}>{quotePay}</span>
                          )}
                          <span className="ml-auto tabular-nums text-xs text-slate-200 font-semibold">{fmtRupiah(Number(d.grand_total) || 0)}</span>
                          <span className="text-[10px] text-slate-600 tabular-nums">{fmtDay(d.updated_at || d.quote_date)}</span>
                        </div>
                        {(d.order_number || invs.length > 0 || d.invoice_number || qdos.length > 0 || d.do_number) && (
                          /* Child documents: quiet uniform links — the number
                             IS the label (SO-/INV-/DO- prefix), a coloured dot
                             carries the state, the tooltip carries the words.
                             The badges above already shout the headline. */
                          <p className="mt-1 text-[10px] font-mono flex flex-wrap items-center gap-x-3 gap-y-1">
                            {d.order_number && (
                              <a href={`/sales/${d.quote_id}`} target="_blank" rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className={docLink}>{d.order_number}</a>
                            )}
                            {invs.length > 0 ? invs.map((i) => {
                              const it = Number(i.grand_total) || 0;
                              const ip = data.paidByInvoice[i.invoice_id] ?? 0;
                              const st = it > 0 && ip >= it - 0.5 ? 'Paid' : ip > 0 ? 'Partial' : 'Unpaid';
                              return (
                                <a key={i.invoice_id} href={`/sales/${d.quote_id}/print?inv=${i.invoice_id}`} target="_blank" rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()} title={`${st} — Rp ${fmtInt(ip)} received of Rp ${fmtInt(it)}`}
                                  className={docLink}>{i.invoice_number}<Dot cls={st === 'Paid' ? 'bg-emerald-400' : st === 'Partial' ? 'bg-amber-400' : 'bg-slate-600'} /></a>
                              );
                            }) : d.invoice_number && (
                              <a href={`/sales/${d.quote_id}/print`} target="_blank" rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()} title={quotePay}
                                className={docLink}>{d.invoice_number}<Dot cls={quotePay === 'Paid' ? 'bg-emerald-400' : quotePay === 'Partial' ? 'bg-amber-400' : 'bg-slate-600'} /></a>
                            )}
                            {qdos.length > 0 ? qdos.map((dd) => (
                              <a key={dd.do_id} href={`/sales/${d.quote_id}/do?do=${dd.do_id}`} target="_blank" rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()} title={dd.status === 'delivered' ? 'Delivered' : 'Preparing'}
                                className={docLink}>{dd.do_number}<Dot cls={dd.status === 'delivered' ? 'bg-emerald-400' : 'bg-orange-400'} /></a>
                            )) : d.do_number && (
                              <a href={`/sales/${d.quote_id}/do`} target="_blank" rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()} title={d.status === 'delivered' ? 'Delivered' : 'Preparing'}
                                className={docLink}>{d.do_number}<Dot cls={d.status === 'delivered' ? 'bg-emerald-400' : 'bg-orange-400'} /></a>
                            )}
                          </p>
                        )}
                      </div>
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
                      <a key={d.quote_id} href={`/sales/${d.quote_id}`} target="_blank" rel="noopener noreferrer"
                        className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-slate-800/30 transition-colors text-xs">
                        <span className="font-mono text-[11px] text-slate-300">{d.invoice_number || d.quote_number}</span>
                        <span className="text-slate-500">{fmtDay(d.updated_at || d.quote_date)}</span>
                        <span className="ml-auto tabular-nums text-amber-300 font-semibold">{fmtRupiah(out)} outstanding</span>
                      </a>
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
                      <span className="text-slate-500 tabular-nums flex-shrink-0">{fmtInt(it.qty)} {it.unit}</span>
                      <span className="text-slate-200 tabular-nums font-semibold flex-shrink-0 w-28 text-right">{fmtRupiah(it.value)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* EPC project quotes (10.x) linked to this customer via customer_id */}
            {showEpc && data.epcQuotes.length > 0 && (
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
                        <span className="ml-auto text-[10px] text-slate-600 tabular-nums">{fmtDay(q.updated_at || q.quote_date)}</span>
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

/** Tiny state dot on a document link — colour says paid/delivered, tooltip says the word. */
function Dot({ cls }: { cls: string }) {
  return <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cls}`} />;
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

// ── Possible-duplicate group card ────────────────────────────────────────────
// One card per group: pick the survivor, two-step Merge button (no confirm()
// dialog — browsers can suppress those silently, the Back-button lesson).
function DupGroupCard({ group, tierLabel, amById, contactsByCustomer, busy, onMerge }: {
  group: Customer[];
  tierLabel: Map<string, string>;
  amById: Map<string, string>;
  contactsByCustomer: Record<string, Contact[]>;
  busy: boolean;
  onMerge: (group: Customer[], survivorId: string) => void;
}) {
  // Default survivor = the row carrying the most data (then the oldest).
  const richness = (c: Customer) =>
    ['tier', 'payment_terms', 'tax_id', 'billing_address', 'shipping_address', 'notes', 'referred_by'].filter((k) => ((c as unknown as Record<string, string>)[k] || '').trim()).length
    + (c.account_manager_id ? 2 : 0) + (contactsByCustomer[c.customer_id]?.length ?? 0);
  const [survivor, setSurvivor] = useState(() =>
    [...group].sort((a, b) => richness(b) - richness(a) || (a.created_at || '').localeCompare(b.created_at || ''))[0].customer_id);
  const [armed, setArmed] = useState(false);
  const survivorRow = group.find((c) => c.customer_id === survivor);

  return (
    <div className="bg-slate-900/40 border border-amber-500/20 rounded-2xl overflow-hidden">
      <div className="divide-y divide-slate-800/60">
        {group.map((c) => {
          const contacts = contactsByCustomer[c.customer_id] ?? [];
          const keep = c.customer_id === survivor;
          return (
            <label key={c.customer_id} className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${keep ? 'bg-emerald-500/[0.06]' : 'hover:bg-slate-800/40'}`}>
              <input type="radio" checked={keep} onChange={() => { setSurvivor(c.customer_id); setArmed(false); }} className="accent-emerald-500 flex-shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-slate-100 font-medium truncate">
                  {c.display_name || c.legal_name}
                  {keep && <span className="ml-2 text-[10px] font-bold text-emerald-400">KEEP</span>}
                </span>
                <span className="block text-[11px] text-slate-500 truncate">
                  <span className="font-mono">{c.customer_code || '—'}</span>
                  {c.tier ? ` · ${tierLabel.get(c.tier) ?? c.tier}` : ''}
                  {c.account_manager_id ? ` · ${amById.get(c.account_manager_id) ?? ''}` : ''}
                  {` · ${contacts.length} contact${contacts.length !== 1 ? 's' : ''}`}
                  {contacts[0]?.email ? ` · ${contacts[0].email}` : contacts[0]?.phone ? ` · ${contacts[0].phone}` : ''}
                </span>
              </span>
              <span className="text-[10px] text-slate-600 tabular-nums flex-shrink-0 hidden sm:block">{c.updated_at ? fmtDayTime(c.updated_at) : ''}</span>
            </label>
          );
        })}
      </div>
      <div className="px-4 py-2.5 border-t border-slate-800/60 flex items-center justify-between gap-3 bg-slate-950/30">
        <p className="text-[10px] text-slate-600 leading-snug">
          {armed
            ? `Contacts, documents and links move to “${survivorRow?.display_name || survivorRow?.legal_name}”; the other ${group.length - 1} record${group.length > 2 ? 's are' : ' is'} deleted.`
            : 'Not duplicates? Just leave the group as it is.'}
        </p>
        <button
          disabled={busy}
          onClick={() => { if (!armed) { setArmed(true); return; } onMerge(group, survivor); setArmed(false); }}
          className={`text-[11px] font-bold px-3 py-1.5 rounded-lg transition-colors flex-shrink-0 disabled:opacity-50 ${
            armed ? 'bg-amber-500 text-slate-950 hover:bg-amber-400' : 'bg-slate-800 text-amber-300 hover:bg-slate-700'
          }`}>
          {busy ? 'Merging…' : armed ? `Confirm — merge ${group.length - 1} into KEEP` : 'Merge…'}
        </button>
      </div>
    </div>
  );
}

// ── Drawer (slide-over) ──────────────────────────────────────────────────────
function Drawer({
  customer, contacts, amUsers, tiers, saving, allCustomers, draftLinks,
  onField, onClose, onSave, onAddContact, onRemoveContact, onContactField, onSetPrimary, onLinks,
}: {
  customer: Customer;
  contacts: Contact[];
  amUsers: AmUser[];
  tiers: Tier[];
  saving: boolean;
  allCustomers: Customer[];
  draftLinks: string[];
  onField: <K extends keyof Customer>(k: K, v: Customer[K]) => void;
  onClose: () => void;
  onSave: () => void;
  onAddContact: () => void;
  onRemoveContact: (id: string) => void;
  onContactField: (id: string, k: keyof Contact, v: Contact[keyof Contact]) => void;
  onSetPrimary: (id: string) => void;
  onLinks: (ids: string[]) => void;
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
      <div className="relative w-full max-w-xl h-full bg-canvas border-l border-slate-800 shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-canvas/95 backdrop-blur border-b border-slate-800 px-6 py-4 flex items-center justify-between gap-3 z-10">
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
            <Field label="Referred by">
              {/* Free text: a referrer can be a customer, a person, or a channel.
                  The datalist offers existing customer names for quick pick. */}
              <input value={customer.referred_by} onChange={(e) => onField('referred_by', e.target.value)}
                placeholder="Customer, person, or channel — e.g. AYANA, Pak Budi, Instagram" list="referrer-options" className={inputCls} />
              <datalist id="referrer-options">
                {allCustomers.filter((c) => c.customer_id !== customer.customer_id)
                  .map((c) => <option key={c.customer_id} value={c.display_name || c.legal_name} />)}
              </datalist>
            </Field>
          </div>

          {/* Linked customers — same group / subsidiaries; symmetric, so the
              link shows (and can be removed) from either company's page. */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Linked customers</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {draftLinks.map((id) => {
                const c = allCustomers.find((x) => x.customer_id === id);
                return (
                  <span key={id} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800/70 border border-slate-700/60 text-[11px] text-slate-300">
                    {c ? (c.display_name || c.legal_name) : '(deleted)'}
                    <button onClick={() => onLinks(draftLinks.filter((x) => x !== id))}
                      className="text-slate-500 hover:text-rose-300 transition-colors" title="Remove link">✕</button>
                  </span>
                );
              })}
              <select value="" onChange={(e) => { if (e.target.value) onLinks([...draftLinks, e.target.value]); }}
                className="text-[11px] bg-slate-900/80 border border-slate-700 text-slate-400 rounded-lg px-2 py-1 focus:outline-none focus:border-emerald-500/60 max-w-[200px]">
                <option value="">+ Link a customer…</option>
                {allCustomers
                  .filter((c) => c.customer_id && c.customer_id !== customer.customer_id && !draftLinks.includes(c.customer_id))
                  .map((c) => <option key={c.customer_id} value={c.customer_id}>{c.display_name || c.legal_name}</option>)}
              </select>
            </div>
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
        <div className="sticky bottom-0 bg-canvas/95 backdrop-blur border-t border-slate-800 px-6 py-4 flex items-center justify-end gap-3">
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

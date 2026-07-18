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
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState(searchParams.get('q') ?? '');
  const [showInactive, setShowInactive] = useState(false);

  const [editing, setEditing] = useState<Customer | null>(null);
  const [draftContacts, setDraftContacts] = useState<Contact[]>([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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
    const [custRes, contactRes, userRes] = await Promise.all([
      supabase.from('20.0_customers').select('*').order('updated_at', { ascending: false }),
      supabase.from('20.1_customer_contacts').select('*').order('is_primary', { ascending: false }),
      supabase.from('user_profiles').select('id, email, display_name, role').in('role', ['owner', 'sales']),
    ]);
    setCustomers((custRes.data as Customer[]) ?? []);
    const grouped: Record<string, Contact[]> = {};
    for (const c of (contactRes.data as Contact[]) ?? []) {
      (grouped[c.customer_id] ??= []).push(c);
    }
    setContactsByCustomer(grouped);
    setAmUsers((userRes.data as AmUser[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { if (canManage) fetchAll(); }, [canManage, fetchAll]);

  const amById = useMemo(
    () => new Map(amUsers.map((u) => [u.id, u.display_name || u.email])),
    [amUsers]);

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

  if (authLoading || !user || !profile) return <CenterSpinner />;
  if (!canManage) return <CenterSpinner />; // redirect in-flight

  return (
    <div className="min-h-screen bg-[#0f1012] text-slate-200 font-sans text-sm">
      {/* Header */}
      <div className="border-b border-slate-800/60 bg-[#0f1012]/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-4 flex items-center justify-between gap-4">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Customers · CRM" />
          <button
            onClick={() => openDrawer(null)}
            className="px-4 py-2 rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 text-sm font-semibold transition-colors"
          >
            + New Customer
          </button>
        </div>
      </div>

      <main className="max-w-[1400px] mx-auto px-4 md:px-8 py-8 space-y-6">
        <CrmMigrationBanner />

        {/* Search + filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code, name, tier, account manager…"
              className="w-full pl-10 pr-4 h-11 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-white text-base sm:text-sm placeholder:text-slate-500 transition-colors"
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
                return (
                  <button
                    key={c.customer_id}
                    onClick={() => openDrawer(c)}
                    className="w-full text-left grid grid-cols-1 md:grid-cols-[130px_1fr_120px_180px_90px] gap-1 md:gap-3 px-4 py-3 hover:bg-slate-800/40 transition-colors items-center"
                  >
                    <span className="font-mono text-[11px] text-slate-400">{c.customer_code || '—'}</span>
                    <span className="min-w-0">
                      <span className="block text-sm text-slate-100 font-medium truncate">{c.display_name || c.legal_name || '(no name)'}</span>
                      {primary && <span className="block text-[11px] text-slate-500 truncate">{primary.name}{primary.email ? ` · ${primary.email}` : ''}</span>}
                    </span>
                    <span className="text-xs text-slate-400">{c.tier ? <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[11px]">{c.tier}</span> : <span className="text-slate-600">—</span>}</span>
                    <span className="text-xs text-slate-400 truncate">{c.account_manager_id ? (amById.get(c.account_manager_id) ?? '—') : <span className="text-slate-600">Unassigned</span>}</span>
                    <span>
                      <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${c.is_active ? 'text-emerald-400' : 'text-slate-500'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${c.is_active ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                        {c.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </span>
                  </button>
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

      {toast && (
        <div className="fixed bottom-6 right-6 z-[110] px-4 py-2.5 bg-slate-800 border border-slate-700 text-white text-sm font-semibold rounded-xl shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

// ── Drawer (slide-over) ──────────────────────────────────────────────────────
function Drawer({
  customer, contacts, amUsers, saving,
  onField, onClose, onSave, onAddContact, onRemoveContact, onContactField, onSetPrimary,
}: {
  customer: Customer;
  contacts: Contact[];
  amUsers: AmUser[];
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
              <input value={customer.tier} onChange={(e) => onField('tier', e.target.value)} placeholder="e.g. Gold" className={inputCls} />
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

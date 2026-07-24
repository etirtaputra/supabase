/**
 * ICAPROC — Sell-side: a single Sales Quote at its own URL (/sales/[id], or
 * /sales/new). One document with a status lifecycle. Owner + sales.
 *  - Advancing status stays on this page (the quote's own link).
 *  - Confirm Customer Order reserves Live Stock; cancel/revert releases it;
 *    deliver writes stock-out movements.
 */
'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useRouter, useParams } from 'next/navigation';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import BrandMenu from '@/components/ui/BrandMenu';
import SalesMilestones from '@/components/ui/SalesMilestones';
import FulfillmentPanel, { type SoLine, type Invoice, type InvItem, type DeliveryOrder, type DoItem } from '@/components/ui/FulfillmentPanel';
import { SALES_STATUS as STATUS, COMMITTED_STATUSES as COMMITTED } from '@/lib/salesStatus';
import { tierPriceFor } from '@/lib/tierPricing';

interface Quote {
  quote_id: string; quote_number: string; order_number?: string; invoice_number?: string; do_number?: string;
  customer_id: string | null; company_id: string | null; quote_date: string; status: string;
  ppn_pct: number; subtotal: number; ppn_amount: number; grand_total: number; notes: string;
  revision?: number;
  validated_at?: string | null; sent_at?: string | null; accepted_at?: string | null;
  ordered_at?: string | null; invoiced_at?: string | null; preparing_at?: string | null; delivered_at?: string | null;
  delivery_date?: string | null; delivery_time?: string; delivery_method?: string; delivery_via?: string;
  delivery_address?: string; delivery_map_url?: string; delivery_contact?: string;
  updated_at?: string; updated_by_email?: string;
}
interface CustContact { customer_id: string; name: string; title: string; phone: string; }
interface DbLine { item_id: string; component_id: string | null; is_section: boolean; description: string; brand: string; note: string; lead_time: string; unit: string; quantity: number; unit_price: number; sort_order: number; }
interface EditLine { key: string; component_id: string | null; is_section: boolean; description: string; brand: string; note: string; lead_time: string; unit: string; quantity: string; unit_price: string; showNote: boolean; }
interface Customer { customer_id: string; display_name: string; legal_name: string; tier: string; shipping_address?: string; billing_address?: string; }
interface Company { company_id: string; legal_name: string; }
interface Tier { tier_id: string; tier_code: string; default_discount_pct: number; sort_order: number; is_active: boolean; }
interface Override { component_id: string; tier_id: string; override_price_idr: number | null; override_discount_pct: number | null; }
// Brand is deliberately NOT fetched here — it's buy-side vendor info; the
// customer-facing description already carries the brand when it should.
interface Comp { component_id: string; supplier_model: string; internal_description: string | null; unit: string | null; selling_price_idr: number | null; }
// Customer-facing product name: our internal description, never the supplier MODEL/SKU.
const compName = (c?: Comp | null) => (c?.internal_description?.trim() || c?.supplier_model || '');
interface LibEntry { entry_id: string; description: string; unit: string; default_price: number | null; }
// Non-catalog suggestions: custom lines from past sales quotes (PREV) and
// owner-curated library entries (LIB)
interface Extra { kind: 'prev' | 'lib'; description: string; unit: string; price: number | null; count: number }
interface DeliveryDetails { date: string; time: string; method: string; via: string; address: string; mapUrl: string; contact: string; }
interface Receipt {
  receipt_id: string; quote_id: string; receipt_number: string; category: string;
  amount: number; payment_method: string; payment_date: string; bank_ref: string; notes: string; created_by_email?: string;
}

const METHOD_LABELS: Record<string, string> = {
  bank_transfer: 'Bank Transfer', cash: 'Cash', cheque: 'Cheque', giro: 'Giro', other: 'Other',
};
const RECEIPT_CATS: { value: string; label: string }[] = [
  { value: 'down_payment', label: 'Down Payment (DP)' },
  { value: 'balance_payment', label: 'Balance Payment' },
];

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const num = (v: unknown): number => {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/[, ]/g, ''));
  return isNaN(n) ? 0 : n;
};

// Tier prices follow the markup chain (lib/tierPricing): the item's entered
// price is the Tier-1 NET; higher tiers mark up from the previous tier.

const blankLine = (): EditLine => ({ key: `new-${Date.now()}-${Math.random()}`, component_id: null, is_section: false, description: '', brand: '', note: '', lead_time: '', unit: '', quantity: '', unit_price: '', showNote: false });
const blankQuote = (companyId: string | null): Quote => ({
  quote_id: '', quote_number: '', customer_id: null, company_id: companyId,
  quote_date: new Date().toISOString().slice(0, 10), status: 'draft', ppn_pct: 11,
  subtotal: 0, ppn_amount: 0, grand_total: 0, notes: '',
});
const mapLine = (it: DbLine): EditLine => ({
  key: `db-${it.item_id}`, component_id: it.component_id, is_section: !!it.is_section,
  description: it.description, brand: it.brand ?? '', note: it.note ?? '', lead_time: it.lead_time ?? '', unit: it.unit,
  quantity: String(it.quantity ?? ''), unit_price: String(it.unit_price ?? ''), showNote: !!(it.note ?? ''),
});

export default function SalesQuotePage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const { user, profile, loading: authLoading } = useAuth();
  const canEdit = !!profile && ROLE_PERMISSIONS[profile.role].canEditSalesDocs;

  const [editing, setEditing] = useState<Quote | null>(null);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [comps, setComps] = useState<Comp[]>([]);
  const [extras, setExtras] = useState<Extra[]>([]);
  const [custContacts, setCustContacts] = useState<CustContact[]>([]);
  const [physical, setPhysical] = useState<Record<string, number>>({});
  const [reserved, setReserved] = useState<Record<string, number>>({});
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  // Split fulfillment: this order's child invoices + delivery orders
  const [savedLines, setSavedLines] = useState<SoLine[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invItems, setInvItems] = useState<InvItem[]>([]);
  const [dos, setDos] = useState<DeliveryOrder[]>([]);
  const [doItems, setDoItems] = useState<DoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2400); };

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent(`/sales/${id}`)}`); return; }
    if (profile && !ROLE_PERMISSIONS[profile.role].canEditSalesDocs) router.replace('/unauthorized');
  }, [authLoading, user, profile, id, router]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const [custRes, coRes, tierRes, ovRes, compRes, balRes, allQRes, allIRes, libRes, contactRes] = await Promise.all([
      supabase.from('20.0_customers').select('customer_id, display_name, legal_name, tier, shipping_address, billing_address').order('display_name'),
      supabase.from('1.0_companies').select('company_id, legal_name').order('legal_name'),
      supabase.from('21.0_price_tiers').select('tier_id, tier_code, default_discount_pct, sort_order, is_active'),
      supabase.from('21.1_item_tier_prices').select('component_id, tier_id, override_price_idr, override_discount_pct'),
      supabase.from('3.0_components').select('component_id, supplier_model, internal_description, unit, selling_price_idr').order('supplier_model').limit(2000),
      supabase.from('30.1_stock_balances').select('component_id, qty_on_hand'),
      supabase.from('22.0_sales_quotes').select('quote_id, status'),
      supabase.from('22.1_sales_quote_items').select('quote_id, component_id, quantity, is_section, description, unit, unit_price, created_at'),
      supabase.from('22.2_sales_description_library').select('entry_id, description, unit, default_price'),
      supabase.from('20.1_customer_contacts').select('customer_id, name, title, phone'),
    ]);
    const coList = (coRes.data as Company[]) ?? [];
    setCustomers((custRes.data as Customer[]) ?? []);
    setCompanies(coList);
    setTiers((tierRes.data as Tier[]) ?? []);
    setOverrides((ovRes.data as Override[]) ?? []);
    setComps((compRes.data as Comp[]) ?? []);
    setCustContacts(contactRes.error ? [] : ((contactRes.data as CustContact[]) ?? []));
    const phys: Record<string, number> = {};
    for (const b of (balRes.data as { component_id: string; qty_on_hand: number }[]) ?? []) phys[b.component_id] = Number(b.qty_on_hand) || 0;
    setPhysical(phys);

    // Reserved = qty on committed orders MINUS what their delivered DOs
    // already shipped (partial shipments release their share of the reserve).
    const [allDoRes, allDoItemRes] = await Promise.all([
      supabase.from('24.0_delivery_orders').select('do_id, quote_id, status'),
      supabase.from('24.1_delivery_order_items').select('do_id, component_id, qty'),
    ]);
    const committed = new Set(((allQRes.data as { quote_id: string; status: string }[]) ?? []).filter((q) => COMMITTED.has(q.status)).map((q) => q.quote_id));
    const orderedByQC = new Map<string, number>();
    for (const it of (allIRes.data as { quote_id: string; component_id: string | null; quantity: number; is_section: boolean }[]) ?? []) {
      if (it.component_id && !it.is_section && committed.has(it.quote_id)) {
        const k = `${it.quote_id}·${it.component_id}`;
        orderedByQC.set(k, (orderedByQC.get(k) ?? 0) + (Number(it.quantity) || 0));
      }
    }
    if (!allDoRes.error && !allDoItemRes.error) {
      const doQuote = new Map(((allDoRes.data ?? []) as { do_id: string; quote_id: string; status: string }[])
        .filter((d) => d.status === 'delivered').map((d) => [d.do_id, d.quote_id]));
      for (const it of ((allDoItemRes.data ?? []) as { do_id: string; component_id: string | null; qty: number }[])) {
        const qid = doQuote.get(it.do_id);
        if (!qid || !it.component_id || !committed.has(qid)) continue;
        const k = `${qid}·${it.component_id}`;
        if (orderedByQC.has(k)) orderedByQC.set(k, (orderedByQC.get(k) ?? 0) - (Number(it.qty) || 0));
      }
    }
    const rsv: Record<string, number> = {};
    for (const [k, q] of orderedByQC) {
      if (q <= 0) continue;
      const cid = k.split('·')[1];
      rsv[cid] = (rsv[cid] ?? 0) + q;
    }
    setReserved(rsv);

    // Custom (non-catalog) lines from other sales quotes → PREV suggestions
    type PastLine = { quote_id: string; component_id: string | null; is_section: boolean; description: string; unit: string; unit_price: number; created_at: string };
    const past = new Map<string, Extra & { at: string }>();
    for (const it of ((allIRes.data as unknown as PastLine[]) ?? [])) {
      if (it.is_section || it.component_id || it.quote_id === id) continue;
      const desc = (it.description ?? '').trim();
      if (desc.length < 3) continue;
      const k = desc.toLowerCase();
      const existing = past.get(k);
      if (existing) {
        existing.count += 1;
        if ((it.created_at ?? '') > existing.at) {
          Object.assign(existing, { description: desc, unit: it.unit ?? '', price: Number(it.unit_price) || null, at: it.created_at ?? '' });
        }
      } else {
        past.set(k, { kind: 'prev', description: desc, unit: it.unit ?? '', price: Number(it.unit_price) || null, count: 1, at: it.created_at ?? '' });
      }
    }
    // Owner-curated library entries join in where no past usage carries the text
    for (const e of ((libRes.error ? [] : libRes.data) as LibEntry[] ?? [])) {
      const desc = (e.description ?? '').trim();
      if (desc.length < 3 || past.has(desc.toLowerCase())) continue;
      past.set(desc.toLowerCase(), { kind: 'lib', description: desc, unit: e.unit ?? '', price: e.default_price != null ? Number(e.default_price) : null, count: 0, at: '' });
    }
    setExtras([...past.values()].sort((a, b) => (b.at || '').localeCompare(a.at || '')).map(({ at: _at, ...x }) => x));

    if (isNew) {
      setEditing((prev) => prev ?? blankQuote(coList[0]?.company_id ?? null));
      setLines((prev) => (prev.length ? prev : [blankLine()]));
    } else {
      const [qRes, iRes, rRes, invRes, invIRes, doRes, doIRes] = await Promise.all([
        supabase.from('22.0_sales_quotes').select('*').eq('quote_id', id).single(),
        supabase.from('22.1_sales_quote_items').select('*').eq('quote_id', id).order('sort_order'),
        supabase.from('26.0_customer_receipts').select('*').eq('quote_id', id).order('payment_date', { ascending: false }),
        supabase.from('25.0_sales_invoices').select('*').eq('quote_id', id).order('created_at'),
        supabase.from('25.1_sales_invoice_items').select('*'),
        supabase.from('24.0_delivery_orders').select('*').eq('quote_id', id).order('created_at'),
        supabase.from('24.1_delivery_order_items').select('*').order('sort_order'),
      ]);
      if (!qRes.data) { setNotFound(true); setLoading(false); return; }
      setEditing(qRes.data as Quote);
      setLines([...((iRes.data as DbLine[]) ?? []).map(mapLine), blankLine()]);
      setReceipts(rRes.error ? [] : ((rRes.data as Receipt[]) ?? []));
      setSavedLines(((iRes.data as DbLine[]) ?? []).map((l) => ({
        item_id: l.item_id, component_id: l.component_id, is_section: !!l.is_section,
        description: l.description, unit: l.unit, quantity: Number(l.quantity) || 0, unit_price: Number(l.unit_price) || 0,
      })));
      const invList = invRes.error ? [] : ((invRes.data as Invoice[]) ?? []);
      setInvoices(invList);
      const invIds = new Set(invList.map((i) => i.invoice_id));
      setInvItems(invIRes.error ? [] : (((invIRes.data as InvItem[]) ?? []).filter((x) => invIds.has(x.invoice_id))));
      const doList = doRes.error ? [] : ((doRes.data as DeliveryOrder[]) ?? []);
      setDos(doList);
      const doIds = new Set(doList.map((d) => d.do_id));
      setDoItems(doIRes.error ? [] : (((doIRes.data as DoItem[]) ?? []).filter((x) => doIds.has(x.do_id))));
    }
    setLoading(false);
  }, [id, isNew]);

  useEffect(() => { if (canEdit) load(); }, [canEdit, load]);

  const custById = useMemo(() => new Map(customers.map((c) => [c.customer_id, c])), [customers]);
  const compById = useMemo(() => new Map(comps.map((c) => [c.component_id, c])), [comps]);
  const tierByCode = useMemo(() => new Map(tiers.map((t) => [t.tier_code, t])), [tiers]);
  const activeTiers = useMemo(() => [...tiers].filter((t) => t.is_active !== false).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)), [tiers]);
  const ovByKey = useMemo(() => { const m = new Map<string, Override>(); for (const o of overrides) m.set(`${o.component_id}:${o.tier_id}`, o); return m; }, [overrides]);

  const availableOf = (componentId: string | null) =>
    componentId ? (physical[componentId] ?? 0) - (reserved[componentId] ?? 0) : null;

  function priceFor(componentId: string): number | null {
    const comp = compById.get(componentId);
    const cust = editing?.customer_id ? custById.get(editing.customer_id) : undefined;
    const tier = cust?.tier ? tierByCode.get(cust.tier) : undefined;
    if (!tier) return comp?.selling_price_idr ?? null; // no tier → the net price
    return tierPriceFor(comp?.selling_price_idr ?? null, activeTiers, tier.tier_id,
      (tid) => ovByKey.get(`${componentId}:${tid}`)?.override_price_idr);
  }

  const setHeader = <K extends keyof Quote>(k: K, v: Quote[K]) => setEditing((e) => (e ? { ...e, [k]: v } : e));
  const setLine = (key: string, patch: Partial<EditLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));
  const addItem = () => setLines((ls) => [...ls, blankLine()]);
  const addSection = () => setLines((ls) => [...ls, { ...blankLine(), is_section: true }]);

  // ── Drag & drop reordering ─────────────────────────────────────────────────
  // Native HTML5 DnD. Dropping on a line inserts before it; a section drags as
  // a block (header + its items, up to the next section). Order persists via
  // sort_order on save.
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null); // line key or '__end__'

  function blockOf(ls: EditLine[], key: string): [number, number] {
    const i = ls.findIndex((l) => l.key === key);
    if (i < 0) return [-1, -1];
    if (!ls[i].is_section) return [i, i + 1];
    let j = i + 1;
    while (j < ls.length && !ls[j].is_section) j++;
    return [i, j];
  }

  function moveLines(fromKey: string, toKey: string) {
    setLines((ls) => {
      const [s, e] = blockOf(ls, fromKey);
      if (s < 0) return ls;
      const block = ls.slice(s, e);
      const rest = [...ls.slice(0, s), ...ls.slice(e)];
      const insert = toKey === '__end__' ? rest.length : rest.findIndex((l) => l.key === toKey);
      if (insert < 0) return ls; // target was inside the dragged block
      return [...rest.slice(0, insert), ...block, ...rest.slice(insert)];
    });
  }

  const endDrag = () => { setDragKey(null); setDropKey(null); };

  function pickComponent(key: string, comp: Comp) {
    const price = priceFor(comp.component_id);
    setLines((ls) => ls.map((l) => (l.key === key ? {
      ...l, component_id: comp.component_id, description: compName(comp) || l.description,
      unit: comp.unit || l.unit,
      unit_price: price != null ? String(Math.round(price)) : l.unit_price, quantity: l.quantity || '1',
    } : l)));
  }

  function pickExtra(key: string, x: Extra) {
    setLines((ls) => ls.map((l) => (l.key === key ? {
      ...l, component_id: null, description: x.description,
      unit: x.unit || l.unit,
      unit_price: x.price != null ? String(Math.round(x.price)) : l.unit_price,
      quantity: l.quantity || '1',
    } : l)));
  }

  const totals = useMemo(() => {
    const subtotal = lines.reduce((s, l) => s + (l.is_section ? 0 : num(l.quantity) * num(l.unit_price)), 0);
    const ppn = subtotal * (num(editing?.ppn_pct ?? 11) / 100);
    return { subtotal, ppn, grand: subtotal + ppn };
  }, [lines, editing?.ppn_pct]);

  async function persist(status?: string, extra?: Record<string, unknown>): Promise<string | null> {
    if (!editing) return null;
    const kept = lines.filter((l) => l.is_section ? l.description.trim() : ((l.component_id || l.description.trim()) && num(l.quantity) > 0));
    const header = {
      customer_id: editing.customer_id, company_id: editing.company_id, quote_date: editing.quote_date,
      status: status ?? editing.status, ppn_pct: num(editing.ppn_pct),
      subtotal: totals.subtotal, ppn_amount: totals.ppn, grand_total: totals.grand, notes: editing.notes,
      ...(extra ?? {}),
    };
    let qid = editing.quote_id;
    if (qid) {
      const { error } = await supabase.from('22.0_sales_quotes').update(header).eq('quote_id', qid);
      if (error) { flash(`Error: ${error.message}`); return null; }
    } else {
      const { data, error } = await supabase.from('22.0_sales_quotes').insert(header).select('quote_id').single();
      if (error || !data) { flash(`Error: ${error?.message ?? 'insert failed'}`); return null; }
      qid = data.quote_id as string;
    }
    await supabase.from('22.1_sales_quote_items').delete().eq('quote_id', qid);
    if (kept.length) {
      const rows = kept.map((l, i) => ({
        quote_id: qid, component_id: l.is_section ? null : l.component_id, is_section: l.is_section,
        description: l.description.trim(), brand: l.brand.trim(), note: l.note.trim(), lead_time: l.lead_time.trim(), unit: l.unit.trim(),
        quantity: l.is_section ? 0 : num(l.quantity), unit_price: l.is_section ? 0 : num(l.unit_price),
        line_total: l.is_section ? 0 : num(l.quantity) * num(l.unit_price), sort_order: i,
      }));
      const { error } = await supabase.from('22.1_sales_quote_items').insert(rows);
      if (error) flash(`Lines failed: ${error.message}`);
    }
    return qid;
  }

  async function save() {
    setBusy(true);
    const wasNew = !editing?.quote_id;
    const qid = await persist();
    setBusy(false);
    if (!qid) return;
    flash('Saved');
    if (wasNew) router.replace(`/sales/${qid}`); else load(true);
  }

  async function printPdf() {
    setBusy(true);
    const qid = await persist();
    setBusy(false);
    if (qid) { if (!editing?.quote_id) router.replace(`/sales/${qid}`); window.open(`/sales/${qid}/print`, '_blank', 'noopener'); }
  }

  // Advance / revert status — stays on this page. Delivery writes stock-out movements.
  async function transition(next: string) {
    if (!editing) return;
    setBusy(true);
    const wasNew = !editing.quote_id;
    const qid = await persist(next);
    if (!qid) { setBusy(false); return; }
    // Stock-outs are written PER DELIVERY ORDER (FulfillmentPanel), not on the
    // order-level status — partial shipments each move their own quantities.
    setBusy(false);
    flash(`Marked ${STATUS[next]?.label ?? next}`);
    if (wasNew) router.replace(`/sales/${qid}`); else load(true); // refresh status + stamped numbers in place
  }

  // Create Delivery Order: capture delivery instructions for the warehouse,
  // then move to 'preparing' (DO number stamps in the DB trigger). Editing
  // the details later (while still preparing) saves without a transition.
  const [showDoModal, setShowDoModal] = useState(false);
  async function submitDeliveryOrder(d: DeliveryDetails) {
    if (!editing) return;
    setBusy(true);
    const fields = {
      delivery_date: d.date || null, delivery_time: d.time, delivery_method: d.method,
      delivery_via: d.method === 'pickup' ? '' : d.via,
      delivery_address: d.method === 'pickup' ? '' : d.address,
      delivery_map_url: d.method === 'pickup' ? '' : d.mapUrl,
      delivery_contact: d.contact,
    };
    const qid = await persist(editing.status === 'preparing' ? undefined : 'preparing', fields);
    setBusy(false);
    if (!qid) return;
    setShowDoModal(false);
    flash(editing.status === 'preparing' ? 'Delivery details updated' : 'Delivery Order created — warehouse can start preparing');
    load(true);
  }

  // Revise: back to draft with the revision counter bumped (trigger stamps
  // revised_at and clears the downstream quote milestones for the new round).
  async function revise() {
    if (!editing?.quote_id) return;
    setBusy(true);
    const qid = await persist('draft', { revision: (editing.revision ?? 0) + 1 });
    setBusy(false);
    if (!qid) return;
    flash(`Revision ${(editing.revision ?? 0) + 1} — back to draft`);
    load(true);
  }

  if (authLoading || !profile || (loading && !editing)) return <CenterSpinner />;
  if (!canEdit) return <CenterSpinner />;
  if (notFound) return (
    <div className="min-h-screen bg-[#0f1012] flex flex-col items-center justify-center gap-3 text-slate-400">
      <p>Sales quote not found.</p>
      <button onClick={() => router.push('/sales')} className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 hover:bg-slate-700 text-sm">← Back to Sales</button>
    </div>
  );
  if (!editing) return <CenterSpinner />;

  const cust = editing.customer_id ? custById.get(editing.customer_id) : undefined;
  const newDoc = !editing.quote_id;
  const st = editing.status;
  const canRecord = ROLE_PERMISSIONS[profile.role].canRecordReceipts;
  const received = receipts.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const billTotal = Number(editing.grand_total) || totals.grand;
  const fullyPaid = billTotal > 0 && received >= billTotal - 0.5;
  const showPayments = !newDoc && ['ordered', 'invoiced', 'preparing', 'delivered'].includes(st);
  const actions: { label: string; to: string; primary?: boolean; danger?: boolean }[] = [];
  if (st === 'draft') { actions.push({ label: 'Mark Validated', to: 'validated', primary: true }); actions.push({ label: 'Mark Sent', to: 'sent' }); }
  if (st === 'validated') actions.push({ label: 'Mark Sent', to: 'sent', primary: true });
  if (st === 'sent') actions.push({ label: 'Mark Accepted', to: 'accepted' });
  if (['validated', 'sent', 'accepted'].includes(st)) actions.push({ label: 'Confirm Customer Order', to: 'ordered', primary: st !== 'validated' });
  // Invoices and DOs are created from the Fulfillment panel below; every stage
  // stays revertible — including a delivered order.
  if (st === 'ordered') actions.push({ label: 'Revert to Quote', to: 'accepted' });
  if (st === 'invoiced') actions.push({ label: 'Revert to Order', to: 'ordered' });
  if (st === 'preparing') actions.push({ label: 'Revert to Invoice', to: 'invoiced' });
  if (st === 'delivered') actions.push({ label: 'Reopen Order', to: 'preparing' });
  if (['cancelled', 'rejected'].includes(st)) actions.push({ label: 'Reopen', to: 'draft' });
  if (['draft', 'validated', 'sent'].includes(st)) actions.push({ label: 'Reject', to: 'rejected', danger: true });
  if (['accepted', 'ordered', 'invoiced', 'preparing'].includes(st)) actions.push({ label: 'Cancel Order', to: 'cancelled', danger: true });
  // Revising re-opens the quote for edits with a bumped revision counter
  const canRevise = !!editing.quote_id && ['validated', 'sent', 'accepted'].includes(st);

  return (
    <div className="min-h-screen bg-[#0f1012] text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-[#0f1012]/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-4 flex items-center justify-between gap-4">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Sales · Quote" mobileNav={false} />
          <button onClick={() => router.push('/sales')} className="text-xs text-slate-400 hover:text-white px-3 py-1.5 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors">← Back to list</button>
        </div>
      </div>
      <main className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-6 space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-bold text-white">{newDoc ? 'New Sales Quote' : editing.quote_number}</h1>
          {(editing.revision ?? 0) > 0 && (
            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-sky-500/15 text-sky-300">Rev {editing.revision}</span>
          )}
          <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${STATUS[st]?.cls ?? ''}`}>{STATUS[st]?.label ?? st}</span>
          {showPayments && fullyPaid && (
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40">PAID</span>
          )}
          {showPayments && !fullyPaid && received > 0 && (
            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/15 text-amber-300">PARTIAL</span>
          )}
          <div className="flex flex-wrap gap-2 ml-auto">
            {editing.order_number && <DocTag label="SO" value={editing.order_number} />}
            {editing.invoice_number && <DocTag label="INV" value={editing.invoice_number} />}
            {editing.do_number && <DocTag label="DO" value={editing.do_number} />}
          </div>
        </div>

        {/* Milestone timeline — the defined progression with each stage's doc code */}
        {!newDoc && <SalesMilestones q={editing} received={received} billTotal={billTotal} />}

        {/* Fulfillment: this order's invoices + delivery orders (split-capable) */}
        {!newDoc && ['ordered', 'invoiced', 'preparing', 'delivered'].includes(st) && (
          <FulfillmentPanel
            quote={editing}
            soLines={savedLines}
            invoices={invoices}
            invItems={invItems}
            dos={dos}
            doItems={doItems}
            paidByInvoice={receipts.reduce((m, r) => {
              const iid = (r as Receipt & { invoice_id?: string | null }).invoice_id;
              if (iid) m[iid] = (m[iid] ?? 0) + (Number(r.amount) || 0);
              return m;
            }, {} as Record<string, number>)}
            contacts={custContacts.filter((c) => c.customer_id === editing.customer_id)}
            shippingAddress={editing.customer_id ? (custById.get(editing.customer_id)?.shipping_address || custById.get(editing.customer_id)?.billing_address || '') : ''}
            canEdit={canEdit}
            onChanged={() => load(true)}
            flash={flash}
          />
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4">
          <FieldBox label="Customer" full>
            <select value={editing.customer_id ?? ''} onChange={(e) => setHeader('customer_id', e.target.value || null)} className={inp}>
              <option value="">— Select customer —</option>
              {customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.display_name || c.legal_name}{c.tier ? ` (${c.tier})` : ''}</option>)}
            </select>
          </FieldBox>
          <FieldBox label="Selling company" full>
            <select value={editing.company_id ?? ''} onChange={(e) => setHeader('company_id', e.target.value || null)} className={inp}>
              <option value="">— Select company —</option>
              {companies.map((c) => <option key={c.company_id} value={c.company_id}>{c.legal_name}</option>)}
            </select>
          </FieldBox>
          <FieldBox label="Quote date">
            <input type="date" value={editing.quote_date} onChange={(e) => setHeader('quote_date', e.target.value)} className={inp} />
          </FieldBox>
          <FieldBox label="PPN %">
            <input value={String(editing.ppn_pct)} onChange={(e) => setHeader('ppn_pct', num(e.target.value) as any)} className={`${inp} text-right tabular-nums`} />
          </FieldBox>
        </div>

        <div className="space-y-2">
          {lines.map((l) => (
            <div
              key={l.key}
              onDragOver={(e) => { if (dragKey && dragKey !== l.key) { e.preventDefault(); setDropKey(l.key); } }}
              onDragLeave={() => setDropKey((k) => (k === l.key ? null : k))}
              onDrop={(e) => { e.preventDefault(); if (dragKey) moveLines(dragKey, l.key); endDrag(); }}
              className={`rounded-xl transition-shadow ${dropKey === l.key ? 'ring-1 ring-violet-500/70' : ''} ${dragKey === l.key ? 'opacity-50' : ''}`}
            >
              <LineCard line={l} comps={comps} extras={extras} available={availableOf(l.component_id)}
                linkedName={l.component_id ? compName(compById.get(l.component_id)) : ''}
                onPick={(c) => pickComponent(l.key, c)} onPickExtra={(x) => pickExtra(l.key, x)}
                onField={(patch) => setLine(l.key, patch)} onRemove={() => removeLine(l.key)}
                onDragStart={() => setDragKey(l.key)} onDragEnd={endDrag} />
            </div>
          ))}
          {dragKey && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDropKey('__end__'); }}
              onDragLeave={() => setDropKey((k) => (k === '__end__' ? null : k))}
              onDrop={(e) => { e.preventDefault(); if (dragKey) moveLines(dragKey, '__end__'); endDrag(); }}
              className={`h-9 rounded-xl border border-dashed flex items-center justify-center text-[10px] transition-colors ${dropKey === '__end__' ? 'border-violet-500 bg-violet-500/10 text-violet-300' : 'border-slate-800 text-slate-600'}`}
            >
              Drop here to move to the end
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <button onClick={addItem} className="px-3.5 py-2 rounded-xl bg-slate-800 text-slate-200 hover:bg-slate-700 text-xs font-semibold transition-colors">+ Add item</button>
            <button onClick={addSection} className="px-3.5 py-2 rounded-xl bg-slate-800/60 text-slate-300 hover:bg-slate-700 text-xs font-semibold transition-colors">+ Add section</button>
            <span className="text-[11px] text-slate-600 self-center">Pick a catalog product to autofill price, or just type a custom item.</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Notes / terms</label>
            <textarea value={editing.notes} onChange={(e) => setHeader('notes', e.target.value)} rows={4} className={inp} />
          </div>
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 space-y-2 text-sm">
            <Row label="Subtotal" value={fmtInt(totals.subtotal)} />
            <Row label={`PPN (${num(editing.ppn_pct)}%)`} value={fmtInt(totals.ppn)} />
            <div className="border-t border-slate-800 pt-2 flex justify-between items-baseline">
              <span className="text-slate-300 font-semibold">Grand Total</span>
              <span className="text-xl font-extrabold text-emerald-300 tabular-nums">IDR {fmtInt(totals.grand)}</span>
            </div>
            {cust?.tier && <p className="text-[10px] text-slate-600">Prices auto-filled at the customer’s <span className="text-slate-400">{cust.tier}</span> tier.</p>}
          </div>
        </div>

        {showPayments && (
          <PaymentsPanel
            receipts={receipts} billTotal={billTotal} received={received} canRecord={canRecord}
            quoteId={editing.quote_id} invoiceNumber={editing.invoice_number || editing.order_number || editing.quote_number}
            onChanged={() => load(true)} flash={flash}
          />
        )}

        <div className="flex flex-wrap items-center gap-2 sm:gap-3 sticky bottom-0 bg-[#0f1012]/95 backdrop-blur border-t border-slate-800 py-2.5 sm:py-3">
          <button onClick={save} disabled={busy} className="px-4 sm:px-5 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-xs sm:text-sm font-semibold transition-colors disabled:opacity-50">Save</button>
          <button onClick={printPdf} disabled={busy} className="px-3 sm:px-4 py-2 rounded-xl bg-slate-800 text-slate-200 hover:bg-slate-700 text-xs sm:text-sm font-semibold transition-colors disabled:opacity-50 inline-flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6v-8z" /></svg>
            Print / PDF
          </button>
          {actions.map((a) => (
            <button key={a.to} onClick={() => transition(a.to)} disabled={busy}
              className={`px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors disabled:opacity-50 ${a.danger ? 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30 hover:bg-red-500/25' : a.primary ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
              {a.label}
            </button>
          ))}
          {canRevise && (
            <button onClick={revise} disabled={busy}
              title="Re-open for edits as a new revision (Rev n) — the quote goes back to Draft and re-runs validation"
              className="px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/25 hover:bg-sky-500/20 transition-colors disabled:opacity-50">
              Revise Quote
            </button>
          )}
          {busy && <span className="w-4 h-4 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin" />}
          {['draft', 'sent', 'accepted'].includes(st) && (
            <span className="text-[11px] text-slate-600 w-full sm:w-auto sm:ml-1">Confirming reserves these quantities from Live Stock.</span>
          )}
        </div>
      </main>
      {toast && <Toast msg={toast} />}
    </div>
  );
}

// ── Styles + small building blocks ──────────────────────────────────────────
const inp = 'w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 focus:border-emerald-500/60 outline-none text-white text-sm placeholder:text-slate-600 transition-colors';
const inpSm = 'w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 focus:border-emerald-500/50 outline-none text-white text-xs placeholder:text-slate-600 transition-colors';

function CenterSpinner() {
  return <div className="min-h-screen bg-[#0f1012] flex items-center justify-center"><div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" /></div>;
}
function FieldBox({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return <div className={full ? 'col-span-2' : ''}><label className="block text-[11px] font-medium text-slate-500 mb-1">{label}</label>{children}</div>;
}
function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-slate-400"><span>{label}</span><span className="tabular-nums text-slate-200">{value}</span></div>;
}
function DocTag({ label, value }: { label: string; value: string }) {
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 text-[11px]"><span className="text-slate-500 font-semibold">{label}</span><span className="font-mono text-slate-300">{value}</span></span>;
}
function Toast({ msg }: { msg: string }) {
  return <div className="fixed bottom-6 right-6 z-[110] px-4 py-2.5 bg-slate-800 border border-slate-700 text-white text-sm font-semibold rounded-xl shadow-lg">{msg}</div>;
}

const GRIP = (
  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" /><circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" /></svg>
);

function LineCard({ line, comps, extras, available, linkedName, onPick, onPickExtra, onField, onRemove, onDragStart, onDragEnd }: {
  line: EditLine; comps: Comp[]; extras: Extra[]; available: number | null; linkedName: string;
  onPick: (c: Comp) => void; onPickExtra: (x: Extra) => void; onField: (patch: Partial<EditLine>) => void; onRemove: () => void;
  onDragStart: () => void; onDragEnd: () => void;
}) {
  const grip = (title: string) => (
    <span
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragEnd={onDragEnd}
      title={title}
      className="cursor-grab active:cursor-grabbing text-slate-600 hover:text-slate-300 flex-shrink-0 select-none -ml-1"
    >
      {GRIP}
    </span>
  );
  if (line.is_section) {
    return (
      <div className="flex flex-wrap items-center gap-2 bg-emerald-500/[0.06] border border-emerald-500/20 border-l-2 border-l-emerald-500/50 rounded-xl px-3 py-2.5 mt-3">
        {grip('Drag to move this section together with its items')}
        <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-500/70 flex-shrink-0">Section</span>
        <input value={line.description} onChange={(e) => onField({ description: e.target.value })} placeholder="Section title (e.g. Solar Panels)"
          className="flex-1 min-w-[140px] bg-transparent outline-none text-sm font-bold text-slate-100 placeholder:text-slate-600" />
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-500 whitespace-nowrap">Lead time</span>
          <input value={line.lead_time} onChange={(e) => onField({ lead_time: e.target.value })} placeholder="e.g. 4–6 weeks"
            className="w-28 px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 focus:border-emerald-500/50 outline-none text-xs text-white placeholder:text-slate-600" />
        </div>
        <button onClick={onRemove} className="text-slate-600 hover:text-red-400 transition-colors flex-shrink-0" title="Remove">×</button>
      </div>
    );
  }
  const qty = num(line.quantity);
  const short = available != null && qty > available;
  return (
    <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl px-3 py-2.5">
      {/* One aligned row on desktop: product grows, numbers in fixed columns */}
      <div className="flex flex-col lg:flex-row lg:items-end gap-2">
        <div className="hidden lg:flex items-center self-center">{grip('Drag to reorder')}</div>
        <div className="flex-1 min-w-0">
          <LabeledField label="Product / description">
            <ProductAutocomplete comps={comps} extras={extras} value={line.description} onText={(t) => onField({ description: t })} onPick={onPick} onPickExtra={onPickExtra} />
          </LabeledField>
        </div>
        <div className="grid grid-cols-4 gap-2 lg:w-[400px] flex-shrink-0">
          <LabeledField label={`Qty${short ? ' ⚠' : ''}`} labelCls={short ? 'text-red-400' : ''}>
            <input value={line.quantity} inputMode="decimal" onChange={(e) => onField({ quantity: e.target.value })} placeholder="0" className={`${inpSm} text-right tabular-nums`} />
          </LabeledField>
          <LabeledField label="Unit">
            <input value={line.unit} onChange={(e) => onField({ unit: e.target.value })} placeholder="pcs" className={inpSm} />
          </LabeledField>
          <LabeledField label="Unit price">
            <input value={line.unit_price} inputMode="decimal" onChange={(e) => onField({ unit_price: e.target.value })} placeholder="0" className={`${inpSm} text-right tabular-nums`} />
          </LabeledField>
          <LabeledField label="Line total">
            <div className="px-2 py-1.5 text-right tabular-nums text-sm font-semibold text-slate-200">{fmtInt(qty * num(line.unit_price))}</div>
          </LabeledField>
        </div>
        <button onClick={onRemove} className="text-slate-600 hover:text-red-400 transition-colors text-lg leading-none px-1 self-start lg:self-end lg:pb-1.5 flex-shrink-0" title="Remove line">×</button>
      </div>
      {/* Meta row: catalog link, live stock, comment toggle */}
      <div className="flex items-center gap-3 flex-wrap mt-1.5">
          {line.component_id ? (
            <span className="inline-flex items-center gap-1.5 text-[10px] text-slate-500 bg-slate-800/60 border border-slate-700/60 rounded-md px-1.5 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
              <span className="truncate max-w-[200px]">{linkedName || 'Catalog item'}</span>
              <span className={`tabular-nums ${short ? 'text-red-400' : 'text-slate-500'}`}>· live {available != null ? fmtInt(available) : '—'}{short ? ' — short' : ''}</span>
              <button onClick={() => onField({ component_id: null })} className="text-slate-600 hover:text-red-400 transition-colors" title="Unlink from catalog (keep as custom entry)">×</button>
            </span>
          ) : (
            <span className="text-[10px] text-slate-600 italic">Custom entry</span>
          )}
          <button onClick={() => onField({ showNote: !line.showNote })} className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors ml-auto">
            {line.showNote || line.note ? 'Comment' : '+ Comment'}
          </button>
        </div>
      {(line.showNote || line.note) && (
        <input value={line.note} onChange={(e) => onField({ note: e.target.value })} placeholder="Comment / extra description (toggle in PDF)" className={`${inpSm} mt-1.5`} />
      )}
    </div>
  );
}

function LabeledField({ label, labelCls, children }: { label: string; labelCls?: string; children: React.ReactNode }) {
  return <div><label className={`block text-[10px] font-medium text-slate-500 mb-0.5 ${labelCls ?? ''}`}>{label}</label>{children}</div>;
}

// ── Payments (AR) — mirrors the buy-side PO payment pattern ─────────────────
function PaymentsPanel({ receipts, billTotal, received, canRecord, quoteId, invoiceNumber, onChanged, flash }: {
  receipts: Receipt[]; billTotal: number; received: number; canRecord: boolean;
  quoteId: string; invoiceNumber: string; onChanged: () => void; flash: (m: string) => void;
}) {
  const supabase = createSupabaseClient();
  const [showModal, setShowModal] = useState(false);
  const outstanding = Math.max(0, billTotal - received);
  const pct = billTotal > 0 ? Math.min(100, (received / billTotal) * 100) : 0;
  const fmtD = (d?: string | null) => d ? new Date(d.length <= 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '';

  async function removeReceipt(r: Receipt) {
    const { error } = await supabase.from('26.0_customer_receipts').delete().eq('receipt_id', r.receipt_id);
    if (error) { flash(`Failed: ${error.message}`); return; }
    flash('Payment removed');
    onChanged();
  }

  return (
    <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400">Payments · {invoiceNumber}</h3>
        <div className="flex items-center gap-2 ml-auto">
          <div className="w-28 h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-amber-400' : 'bg-slate-600'}`} style={{ width: `${pct}%` }} />
          </div>
          <span className={`text-[11px] font-semibold tabular-nums ${pct >= 100 ? 'text-emerald-400' : pct > 0 ? 'text-amber-300' : 'text-slate-600'}`}>{pct.toFixed(0)}%</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <MiniStat label="Invoice total" value={fmtInt(billTotal)} cls="text-slate-200" />
        <MiniStat label="Received" value={fmtInt(received)} cls={received > 0 ? 'text-emerald-300' : 'text-slate-500'} />
        <MiniStat label="Outstanding" value={fmtInt(outstanding)} cls={outstanding > 0 ? 'text-amber-300' : 'text-emerald-400'} />
      </div>

      {receipts.length > 0 && (
        <div className="rounded-xl border border-slate-800 divide-y divide-slate-800/60">
          {receipts.map((r) => (
            <div key={r.receipt_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
              <span className="font-mono text-[10px] text-slate-500">{r.receipt_number}</span>
              <span className="text-slate-400">{RECEIPT_CATS.find((c) => c.value === r.category)?.label ?? r.category}</span>
              <span className="text-slate-500">{METHOD_LABELS[r.payment_method] ?? r.payment_method}{r.bank_ref ? ` · ${r.bank_ref}` : ''}</span>
              <span className="ml-auto tabular-nums text-emerald-200 font-semibold">{fmtInt(Number(r.amount))}</span>
              <span className="text-slate-600 tabular-nums">{fmtD(r.payment_date)}</span>
              {canRecord && (
                <button onClick={() => removeReceipt(r)} className="text-slate-600 hover:text-red-400 transition-colors" title="Remove payment">×</button>
              )}
            </div>
          ))}
        </div>
      )}

      {canRecord ? (
        <button onClick={() => setShowModal(true)}
          className="px-4 py-2 rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 text-xs font-semibold transition-colors">
          + Record Payment
        </button>
      ) : (
        <p className="text-[10px] text-slate-600">Payments are recorded by Finance / Owner.</p>
      )}

      {showModal && (
        <RecordPaymentModal quoteId={quoteId} outstanding={outstanding} received={received}
          onClose={() => setShowModal(false)} onDone={() => { setShowModal(false); onChanged(); }} flash={flash} />
      )}
    </div>
  );
}

function MiniStat({ label, value, cls }: { label: string; value: string; cls: string }) {
  return (
    <div className="bg-slate-950/50 border border-slate-800 rounded-xl py-2 px-1">
      <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600 mb-0.5">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${cls}`}>{value}</p>
    </div>
  );
}

function RecordPaymentModal({ quoteId, outstanding, received, onClose, onDone, flash }: {
  quoteId: string; outstanding: number; received: number;
  onClose: () => void; onDone: () => void; flash: (m: string) => void;
}) {
  const supabase = createSupabaseClient();
  // First payment defaults to DP; later ones to balance — mirroring PO practice.
  const [category, setCategory] = useState(received > 0 ? 'balance_payment' : 'down_payment');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('bank_transfer');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [bankRef, setBankRef] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const amt = num(amount);
    if (amt <= 0) { flash('Enter an amount'); return; }
    setBusy(true);
    const { error } = await supabase.from('26.0_customer_receipts').insert({
      quote_id: quoteId, category, amount: amt, payment_method: method,
      payment_date: date, bank_ref: bankRef.trim(), notes: notes.trim(),
    });
    setBusy(false);
    if (error) { flash(`Failed: ${error.message}`); return; }
    flash('Payment recorded');
    onDone();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-md bg-[#141518] border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-white">Record customer payment</h3>

        <div className="grid grid-cols-2 gap-3">
          <FieldBox label="Type" full>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={inp}>
              {RECEIPT_CATS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </FieldBox>
          <FieldBox label="Amount (IDR)" full>
            <div className="flex gap-2">
              <input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} placeholder="0" className={`${inp} text-right tabular-nums`} />
              {outstanding > 0 && (
                <button onClick={() => setAmount(String(Math.round(outstanding)))}
                  className="px-3 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-[11px] font-semibold whitespace-nowrap transition-colors">
                  Fill remaining
                </button>
              )}
            </div>
          </FieldBox>
          <FieldBox label="Method">
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={inp}>
              {Object.entries(METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </FieldBox>
          <FieldBox label="Payment date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} />
          </FieldBox>
          <FieldBox label="Bank ref / cheque no." full>
            <input value={bankRef} onChange={(e) => setBankRef(e.target.value)} placeholder="Optional reference" className={inp} />
          </FieldBox>
          <FieldBox label="Notes" full>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" className={inp} />
          </FieldBox>
        </div>

        <div className="flex justify-end gap-3 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-sm transition-colors">Cancel</button>
          <button onClick={submit} disabled={busy}
            className="px-5 py-2 rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-2">
            {busy && <span className="w-3.5 h-3.5 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin" />}
            Record payment
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create Delivery Order — the warehouse instruction form ──────────────────
const TIME_OF_DAY = ['Pagi (08–11)', 'Siang (11–14)', 'Sore (14–17)'];
const VIA_SUGGESTIONS = ['Armada sendiri', 'Kurir instan (GoSend/Grab)', 'Ekspedisi / cargo', 'JNE/J&T', 'Truk sewa'];

function DeliveryOrderModal({ initial, contacts, isEdit, busy, onClose, onSubmit }: {
  initial: DeliveryDetails; contacts: CustContact[]; isEdit: boolean; busy: boolean;
  onClose: () => void; onSubmit: (d: DeliveryDetails) => void;
}) {
  const [d, setD] = useState<DeliveryDetails>(initial);
  const set = <K extends keyof DeliveryDetails>(k: K, v: DeliveryDetails[K]) => setD((x) => ({ ...x, [k]: v }));
  const isPickup = d.method === 'pickup';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-[#141518] border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="text-base font-bold text-white">{isEdit ? 'Edit delivery details' : 'Create Delivery Order'}</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {isEdit ? 'Update the warehouse instructions for this DO.' : 'This issues the DO number and moves the order to “Preparing Items” — the warehouse team\'s instruction to pick and pack.'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FieldBox label="Target delivery date">
            <input type="date" value={d.date} onChange={(e) => set('date', e.target.value)} className={inp} />
          </FieldBox>
          <FieldBox label="Time of day">
            <select value={d.time} onChange={(e) => set('time', e.target.value)} className={inp}>
              <option value="">— Anytime —</option>
              {TIME_OF_DAY.map((t) => <option key={t} value={t}>{t}</option>)}
              {d.time && !TIME_OF_DAY.includes(d.time) && <option value={d.time}>{d.time}</option>}
            </select>
          </FieldBox>
          <FieldBox label="Method" full>
            <div className="flex gap-2">
              {[{ v: 'delivery', l: 'Delivery (we send)' }, { v: 'pickup', l: 'Customer pick-up' }].map((m) => (
                <button key={m.v} onClick={() => set('method', m.v)}
                  className={`flex-1 px-3 py-2 rounded-xl text-sm font-semibold border transition-colors ${d.method === m.v ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'bg-slate-900 text-slate-400 border-slate-700 hover:border-slate-500'}`}>
                  {m.l}
                </button>
              ))}
            </div>
          </FieldBox>
          {!isPickup && (
            <FieldBox label="Through / carrier" full>
              <input list="via-suggestions" value={d.via} onChange={(e) => set('via', e.target.value)}
                placeholder="e.g. Armada sendiri, ekspedisi…" className={inp} />
              <datalist id="via-suggestions">
                {VIA_SUGGESTIONS.map((v) => <option key={v} value={v} />)}
              </datalist>
            </FieldBox>
          )}
          {!isPickup && (
            <FieldBox label="Delivery address" full>
              <textarea value={d.address} onChange={(e) => set('address', e.target.value)} rows={3}
                placeholder="Street address for the driver" className={inp} />
            </FieldBox>
          )}
          {!isPickup && (
            <FieldBox label="Google Maps link" full>
              <input value={d.mapUrl} onChange={(e) => set('mapUrl', e.target.value)}
                placeholder="https://maps.app.goo.gl/…" className={inp} />
            </FieldBox>
          )}
          <FieldBox label="Contact person (on site)" full>
            <input list="do-contacts" value={d.contact} onChange={(e) => set('contact', e.target.value)}
              placeholder={contacts.length ? 'Pick a customer contact or type one…' : 'Name · phone'} className={inp} />
            <datalist id="do-contacts">
              {contacts.map((c) => (
                <option key={`${c.name}-${c.phone}`} value={`${c.name}${c.phone ? ` · ${c.phone}` : ''}`}>{c.title}</option>
              ))}
            </datalist>
          </FieldBox>
        </div>

        <div className="flex justify-end gap-3 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-sm transition-colors">Cancel</button>
          <button onClick={() => onSubmit(d)} disabled={busy}
            className="px-5 py-2 rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-2">
            {busy && <span className="w-3.5 h-3.5 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin" />}
            {isEdit ? 'Save details' : 'Create Delivery Order'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProductAutocomplete({ comps, extras, value, onText, onPick, onPickExtra }: {
  comps: Comp[]; extras: Extra[]; value: string;
  onText: (t: string) => void; onPick: (c: Comp) => void; onPickExtra: (x: Extra) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const results = useMemo(() => {
    const s = value.trim().toLowerCase();
    const list = s ? comps.filter((c) => `${c.internal_description ?? ''} ${c.supplier_model}`.toLowerCase().includes(s)) : comps;
    return list.slice(0, 20);
  }, [comps, value]);
  // PREV / LIB suggestions, excluding texts that duplicate a shown catalog item
  const extraResults = useMemo(() => {
    const s = value.trim().toLowerCase();
    const shown = new Set(results.map((c) => compName(c).trim().toLowerCase()));
    const list = extras.filter((x) => !shown.has(x.description.toLowerCase()) && (!s || x.description.toLowerCase().includes(s)));
    return list.slice(0, 6);
  }, [extras, results, value]);
  const total = results.length + extraResults.length;
  useEffect(() => { setActive(-1); }, [value]);

  const choose = (i: number) => {
    if (i < results.length) onPick(results[i]);
    else onPickExtra(extraResults[i - results.length]);
    setOpen(false);
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || total === 0) { if (e.key === 'ArrowDown') setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, total - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, -1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') setOpen(false);
  };
  return (
    <div className="relative">
      <input value={value} onChange={(e) => { onText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={onKey}
        placeholder="Type a product or custom item…" autoComplete="off" className={inpSm} />
      {open && total > 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-slate-900 border border-emerald-500/40 rounded-lg shadow-2xl">
          {results.map((c, i) => (
            <button key={c.component_id} onMouseDown={(e) => { e.preventDefault(); choose(i); }}
              className={`w-full text-left px-3 py-1.5 text-xs border-b border-slate-800/50 last:border-0 ${i === active ? 'bg-emerald-600/30 text-white' : 'hover:bg-slate-800 text-slate-300'}`}>
              <span className="block truncate">{compName(c)}</span>
              <span className="block text-[10px] text-slate-500 truncate">{[c.unit, c.selling_price_idr ? `Rp${fmtInt(c.selling_price_idr)}` : ''].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
          {extraResults.length > 0 && (
            <p className="px-3 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wider text-slate-600 border-t border-slate-800">Previous &amp; library entries</p>
          )}
          {extraResults.map((x, xi) => {
            const i = results.length + xi;
            return (
              <button key={`${x.kind}-${x.description}`} onMouseDown={(e) => { e.preventDefault(); choose(i); }}
                className={`w-full text-left px-3 py-1.5 text-xs border-b border-slate-800/50 last:border-0 ${i === active ? 'bg-emerald-600/30 text-white' : 'hover:bg-slate-800 text-slate-300'}`}>
                <span className="block truncate">
                  <span className={`mr-1.5 px-1 py-0.5 rounded text-[9px] font-bold align-middle ${x.kind === 'prev' ? 'bg-amber-500/20 text-amber-300' : 'bg-violet-500/20 text-violet-300'}`}>{x.kind === 'prev' ? 'PREV' : 'LIB'}</span>
                  {x.description}
                </span>
                <span className="block text-[10px] text-slate-500 truncate">
                  {[x.unit, x.price != null ? `Rp${fmtInt(x.price)}` : '', x.kind === 'prev' && x.count > 1 ? `used ${x.count}×` : ''].filter(Boolean).join(' · ')}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

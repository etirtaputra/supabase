/**
 * ICAPROC — Sell-side: Sales Quotes → Orders → Invoice → Delivery
 * One document with a status lifecycle. Owner + sales.
 *  - Create/edit a quote: customer, company, line items (tier-priced), PPN, totals.
 *  - Advance status: Send → Accept → Convert to Order → Invoice → Deliver.
 *  - Ordering reserves stock (Live = Physical − Reserved); cancelling releases it;
 *    delivering writes stock-out movements (Physical drops).
 */
'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import BrandMenu from '@/components/ui/BrandMenu';
import SalesMigrationBanner from '@/components/ui/SalesMigrationBanner';

// ── Types ───────────────────────────────────────────────────────────────────
interface Quote {
  quote_id: string; quote_number: string; order_number?: string; invoice_number?: string; do_number?: string;
  customer_id: string | null; company_id: string | null; quote_date: string; status: string;
  ppn_pct: number; subtotal: number; ppn_amount: number; grand_total: number; notes: string;
  updated_at?: string; updated_by_email?: string;
}
interface DbLine { item_id: string; quote_id: string; component_id: string | null; description: string; unit: string; quantity: number; unit_price: number; line_total: number; sort_order: number; }
interface EditLine { key: string; component_id: string | null; description: string; unit: string; quantity: string; unit_price: string; }
interface Customer { customer_id: string; display_name: string; legal_name: string; tier: string; }
interface Company { company_id: string; legal_name: string; }
interface Tier { tier_id: string; tier_code: string; default_discount_pct: number; }
interface Override { component_id: string; tier_id: string; override_price_idr: number | null; override_discount_pct: number | null; }
interface Comp { component_id: string; supplier_model: string; brand: string | null; unit: string | null; selling_price_idr: number | null; }

const COMMITTED = new Set(['ordered', 'invoiced']); // reserve stock in these statuses

const STATUS: Record<string, { label: string; cls: string }> = {
  draft:     { label: 'Draft',     cls: 'bg-slate-700/40 text-slate-300' },
  sent:      { label: 'Sent',      cls: 'bg-blue-500/15 text-blue-300' },
  accepted:  { label: 'Accepted',  cls: 'bg-teal-500/15 text-teal-300' },
  ordered:   { label: 'Confirmed Order', cls: 'bg-violet-500/15 text-violet-300' },
  invoiced:  { label: 'Invoiced',  cls: 'bg-amber-500/15 text-amber-300' },
  delivered: { label: 'Delivered', cls: 'bg-emerald-500/15 text-emerald-300' },
  cancelled: { label: 'Cancelled', cls: 'bg-red-500/15 text-red-300' },
  rejected:  { label: 'Rejected',  cls: 'bg-red-500/10 text-red-400/80' },
};

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const num = (v: unknown): number => {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/[, ]/g, ''));
  return isNaN(n) ? 0 : n;
};
const fmtDate = (d?: string | null) => d ? new Date(d.length <= 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '';

function effectivePrice(list: number | null, tier: Tier | undefined, ov: Override | undefined): number | null {
  if (ov?.override_price_idr != null) return ov.override_price_idr;
  if (list == null || list <= 0) return null;
  const disc = ov?.override_discount_pct ?? tier?.default_discount_pct ?? 0;
  return list * (1 - disc / 100);
}

export default function SalesPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const canEdit = !!profile && ROLE_PERMISSIONS[profile.role].canEditSalesDocs;

  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [itemsByQuote, setItemsByQuote] = useState<Record<string, DbLine[]>>({});
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [comps, setComps] = useState<Comp[]>([]);
  const [physical, setPhysical] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2400); };

  const [editing, setEditing] = useState<Quote | null>(null);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { document.title = 'Sales — ICAPROC'; }, []);
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/sales')}`); return; }
    if (profile && !ROLE_PERMISSIONS[profile.role].canEditSalesDocs) router.replace('/unauthorized');
  }, [authLoading, user, profile, router]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [qRes, iRes, custRes, coRes, tierRes, ovRes, compRes, balRes] = await Promise.all([
      supabase.from('22.0_sales_quotes').select('*').order('updated_at', { ascending: false }),
      supabase.from('22.1_sales_quote_items').select('*').order('sort_order'),
      supabase.from('20.0_customers').select('customer_id, display_name, legal_name, tier').order('display_name'),
      supabase.from('1.0_companies').select('company_id, legal_name').order('legal_name'),
      supabase.from('21.0_price_tiers').select('tier_id, tier_code, default_discount_pct'),
      supabase.from('21.1_item_tier_prices').select('component_id, tier_id, override_price_idr, override_discount_pct'),
      supabase.from('3.0_components').select('component_id, supplier_model, brand, unit, selling_price_idr').order('supplier_model').limit(2000),
      supabase.from('30.1_stock_balances').select('component_id, qty_on_hand'),
    ]);
    setQuotes((qRes.data as Quote[]) ?? []);
    const grouped: Record<string, DbLine[]> = {};
    for (const it of (iRes.data as DbLine[]) ?? []) (grouped[it.quote_id] ??= []).push(it);
    setItemsByQuote(grouped);
    setCustomers((custRes.data as Customer[]) ?? []);
    setCompanies((coRes.data as Company[]) ?? []);
    setTiers((tierRes.data as Tier[]) ?? []);
    setOverrides((ovRes.data as Override[]) ?? []);
    setComps((compRes.data as Comp[]) ?? []);
    const phys: Record<string, number> = {};
    for (const b of (balRes.data as { component_id: string; qty_on_hand: number }[]) ?? []) phys[b.component_id] = Number(b.qty_on_hand) || 0;
    setPhysical(phys);
    setLoading(false);
  }, []);

  useEffect(() => { if (canEdit) fetchAll(); }, [canEdit, fetchAll]);

  const custById = useMemo(() => new Map(customers.map((c) => [c.customer_id, c])), [customers]);
  const compById = useMemo(() => new Map(comps.map((c) => [c.component_id, c])), [comps]);
  const tierByCode = useMemo(() => new Map(tiers.map((t) => [t.tier_code, t])), [tiers]);
  const ovByKey = useMemo(() => { const m = new Map<string, Override>(); for (const o of overrides) m.set(`${o.component_id}:${o.tier_id}`, o); return m; }, [overrides]);

  // Reserved = qty on quotes in committed statuses (available live stock excludes these).
  const reservedByComp = useMemo(() => {
    const r: Record<string, number> = {};
    for (const q of quotes) {
      if (!COMMITTED.has(q.status)) continue;
      for (const it of itemsByQuote[q.quote_id] ?? []) {
        if (it.component_id) r[it.component_id] = (r[it.component_id] ?? 0) + (Number(it.quantity) || 0);
      }
    }
    return r;
  }, [quotes, itemsByQuote]);

  const availableOf = (componentId: string | null) =>
    componentId ? (physical[componentId] ?? 0) - (reservedByComp[componentId] ?? 0) : null;

  // Price a component for the currently-edited quote's customer tier.
  function priceFor(componentId: string): number | null {
    const comp = compById.get(componentId);
    const list = comp?.selling_price_idr ?? null;
    const cust = editing?.customer_id ? custById.get(editing.customer_id) : undefined;
    const tier = cust?.tier ? tierByCode.get(cust.tier) : undefined;
    const ov = tier ? ovByKey.get(`${componentId}:${tier.tier_id}`) : undefined;
    return effectivePrice(list, tier, ov);
  }

  // ── Editor open/close ───────────────────────────────────────────────────────
  function openEditor(q: Quote | null) {
    if (q) {
      setEditing({ ...q });
      setLines((itemsByQuote[q.quote_id] ?? []).map((it, i) => ({
        key: `db-${it.item_id}`, component_id: it.component_id, description: it.description,
        unit: it.unit, quantity: String(it.quantity ?? ''), unit_price: String(it.unit_price ?? ''),
      })).concat([{ key: `new-${Date.now()}`, component_id: null, description: '', unit: '', quantity: '', unit_price: '' }]));
    } else {
      setEditing({
        quote_id: '', quote_number: '', customer_id: null, company_id: companies[0]?.company_id ?? null,
        quote_date: new Date().toISOString().slice(0, 10), status: 'draft', ppn_pct: 11,
        subtotal: 0, ppn_amount: 0, grand_total: 0, notes: '',
      });
      setLines([{ key: `new-${Date.now()}`, component_id: null, description: '', unit: '', quantity: '', unit_price: '' }]);
    }
  }
  const closeEditor = () => { setEditing(null); setLines([]); };

  const setHeader = <K extends keyof Quote>(k: K, v: Quote[K]) => setEditing((e) => (e ? { ...e, [k]: v } : e));

  // Ensure there's always a trailing blank line to type into.
  function normalizeLines(next: EditLine[]): EditLine[] {
    const nonEmpty = next.filter((l) => l.component_id || l.description.trim() || l.quantity || l.unit_price);
    return [...nonEmpty, { key: `new-${Date.now()}-${Math.random()}`, component_id: null, description: '', unit: '', quantity: '', unit_price: '' }];
  }
  const setLine = (key: string, patch: Partial<EditLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((ls) => normalizeLines(ls.filter((l) => l.key !== key)));

  function pickComponent(key: string, comp: Comp) {
    const price = priceFor(comp.component_id);
    setLines((ls) => normalizeLines(ls.map((l) => (l.key === key ? {
      ...l, component_id: comp.component_id, description: comp.supplier_model || l.description,
      unit: comp.unit || l.unit, unit_price: price != null ? String(Math.round(price)) : l.unit_price,
      quantity: l.quantity || '1',
    } : l))));
  }

  const totals = useMemo(() => {
    const subtotal = lines.reduce((s, l) => s + num(l.quantity) * num(l.unit_price), 0);
    const ppn = subtotal * (num(editing?.ppn_pct ?? 11) / 100);
    return { subtotal, ppn, grand: subtotal + ppn };
  }, [lines, editing?.ppn_pct]);

  async function persist(status?: string): Promise<string | null> {
    if (!editing) return null;
    const kept = lines.filter((l) => (l.component_id || l.description.trim()) && num(l.quantity) > 0);
    const header = {
      customer_id: editing.customer_id, company_id: editing.company_id, quote_date: editing.quote_date,
      status: status ?? editing.status, ppn_pct: num(editing.ppn_pct),
      subtotal: totals.subtotal, ppn_amount: totals.ppn, grand_total: totals.grand, notes: editing.notes,
    };
    let id = editing.quote_id;
    if (id) {
      const { error } = await supabase.from('22.0_sales_quotes').update(header).eq('quote_id', id);
      if (error) { flash(`Error: ${error.message}`); return null; }
    } else {
      const { data, error } = await supabase.from('22.0_sales_quotes').insert(header).select('quote_id').single();
      if (error || !data) { flash(`Error: ${error?.message ?? 'insert failed'}`); return null; }
      id = data.quote_id as string;
    }
    await supabase.from('22.1_sales_quote_items').delete().eq('quote_id', id);
    if (kept.length) {
      const rows = kept.map((l, i) => ({
        quote_id: id, component_id: l.component_id, description: l.description.trim(), unit: l.unit.trim(),
        quantity: num(l.quantity), unit_price: num(l.unit_price), line_total: num(l.quantity) * num(l.unit_price), sort_order: i,
      }));
      const { error } = await supabase.from('22.1_sales_quote_items').insert(rows);
      if (error) { flash(`Lines failed: ${error.message}`); }
    }
    return id;
  }

  async function save() {
    setBusy(true);
    const id = await persist();
    setBusy(false);
    if (id) { flash('Saved'); closeEditor(); fetchAll(); }
  }

  // Persist latest edits, then open the client-facing PDF (reads from the DB).
  async function printPdf() {
    setBusy(true);
    const id = await persist();
    setBusy(false);
    if (id) window.open(`/sales/${id}/print`, '_blank', 'noopener');
  }

  // Advance the document; delivery writes stock-out movements.
  async function transition(next: string) {
    if (!editing) return;
    setBusy(true);
    const id = await persist(next);
    if (!id) { setBusy(false); return; }
    if (next === 'delivered') {
      const kept = lines.filter((l) => l.component_id && num(l.quantity) > 0);
      const moves = kept.map((l) => {
        const bal = compById.get(l.component_id!);
        void bal;
        return {
          component_id: l.component_id, location: 'MAIN', direction: 'out', quantity: num(l.quantity),
          unit_cost_idr: 0, source_type: 'delivery', source_id: id, notes: `DO for ${editing.quote_number || id}`,
        };
      });
      if (moves.length) {
        const { error } = await supabase.from('30.0_stock_movements').insert(moves);
        if (error) flash(`Delivered, but stock-out failed: ${error.message}`);
      }
    }
    setBusy(false);
    flash(`Marked ${STATUS[next]?.label ?? next}`);
    closeEditor();
    fetchAll();
  }

  if (authLoading || !profile) return <CenterSpinner />;
  if (!canEdit) return <CenterSpinner />;

  // ── Editor view ─────────────────────────────────────────────────────────────
  if (editing) {
    const cust = editing.customer_id ? custById.get(editing.customer_id) : undefined;
    const isNew = !editing.quote_id;
    const st = editing.status;
    const actions: { label: string; to: string; primary?: boolean; danger?: boolean }[] = [];
    // Secondary quote steps (optional); the primary CTA jumps straight to a
    // Confirmed Customer Order, which reserves Live Stock.
    if (st === 'draft') actions.push({ label: 'Mark Sent', to: 'sent' });
    if (st === 'sent') actions.push({ label: 'Mark Accepted', to: 'accepted' });
    if (['draft', 'sent', 'accepted'].includes(st)) actions.push({ label: 'Confirm Customer Order', to: 'ordered', primary: true });
    if (st === 'ordered') actions.push({ label: 'Mark Invoiced', to: 'invoiced', primary: true });
    if (st === 'invoiced') actions.push({ label: 'Mark Delivered', to: 'delivered', primary: true });
    if (['draft', 'sent'].includes(st)) actions.push({ label: 'Reject', to: 'rejected', danger: true });
    if (['accepted', 'ordered', 'invoiced'].includes(st)) actions.push({ label: 'Cancel Order', to: 'cancelled', danger: true });

    return (
      <div className="min-h-screen bg-[#0f1012] text-slate-200 font-sans text-sm">
        <Header subtitle="Sales · Quote editor">
          <button onClick={closeEditor} className="text-xs text-slate-400 hover:text-white px-3 py-1.5 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors">← Back to list</button>
        </Header>
        <main className="max-w-[1200px] mx-auto px-4 md:px-8 py-6 space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-lg font-bold text-white">{isNew ? 'New Sales Quote' : editing.quote_number}</h1>
            <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${STATUS[st]?.cls ?? ''}`}>{STATUS[st]?.label ?? st}</span>
            <div className="flex flex-wrap gap-2 ml-auto">
              {editing.order_number && <DocTag label="SO" value={editing.order_number} />}
              {editing.invoice_number && <DocTag label="INV" value={editing.invoice_number} />}
              {editing.do_number && <DocTag label="DO" value={editing.do_number} />}
            </div>
          </div>

          {/* Header fields */}
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

          {/* Line items */}
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] uppercase tracking-widest text-slate-500">
                  <th className="text-left font-semibold px-3 py-2.5">Product</th>
                  <th className="text-left font-semibold px-3 py-2.5">Description</th>
                  <th className="text-right font-semibold px-3 py-2.5">Live</th>
                  <th className="text-right font-semibold px-3 py-2.5 w-20">Qty</th>
                  <th className="text-right font-semibold px-3 py-2.5 w-32">Unit price</th>
                  <th className="text-right font-semibold px-3 py-2.5 w-32">Line total</th>
                  <th className="px-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {lines.map((l) => {
                  const avail = availableOf(l.component_id);
                  const qty = num(l.quantity);
                  const short = avail != null && qty > avail;
                  return (
                    <tr key={l.key} className="align-top">
                      <td className="px-3 py-2 w-56">
                        <ComponentPicker comps={comps} value={l.component_id} onPick={(c) => pickComponent(l.key, c)}
                          label={l.component_id ? (compById.get(l.component_id)?.supplier_model ?? '') : ''} />
                      </td>
                      <td className="px-3 py-2">
                        <input value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} placeholder="Item description" className={inpSm} />
                        {l.unit && <span className="text-[10px] text-slate-600">per {l.unit}</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-[11px]">
                        {avail == null ? <span className="text-slate-700">—</span> : <span className={short ? 'text-red-400' : 'text-slate-400'}>{fmtInt(avail)}{short ? ' ⚠' : ''}</span>}
                      </td>
                      <td className="px-3 py-2"><input value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} placeholder="0" className={`${inpSm} text-right tabular-nums`} /></td>
                      <td className="px-3 py-2"><input value={l.unit_price} onChange={(e) => setLine(l.key, { unit_price: e.target.value })} placeholder="0" className={`${inpSm} text-right tabular-nums`} /></td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-200">{fmtInt(qty * num(l.unit_price))}</td>
                      <td className="px-2 py-2 text-right">
                        {(l.component_id || l.description) && <button onClick={() => removeLine(l.key)} className="text-slate-600 hover:text-red-400 transition-colors" title="Remove">×</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Totals + notes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Notes</label>
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

          {/* Action bar */}
          <div className="flex flex-wrap items-center gap-3 sticky bottom-0 bg-[#0f1012]/95 backdrop-blur border-t border-slate-800 py-3">
            <button onClick={save} disabled={busy} className="px-5 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold transition-colors disabled:opacity-50">Save</button>
            <button onClick={printPdf} disabled={busy} className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 hover:bg-slate-700 text-sm font-semibold transition-colors disabled:opacity-50 inline-flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6v-8z" /></svg>
              Print / PDF
            </button>
            {actions.map((a) => (
              <button key={a.to} onClick={() => transition(a.to)} disabled={busy}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 ${a.danger ? 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30 hover:bg-red-500/25' : a.primary ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
                {a.label}
              </button>
            ))}
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

  // ── List view ───────────────────────────────────────────────────────────────
  const filtered = quotes.filter((q) => {
    const s = search.trim().toLowerCase();
    if (!s) return true;
    const c = q.customer_id ? custById.get(q.customer_id) : undefined;
    return [q.quote_number, q.order_number, q.invoice_number, q.do_number, c?.display_name, c?.legal_name, STATUS[q.status]?.label]
      .filter(Boolean).join(' ').toLowerCase().includes(s);
  });

  return (
    <div className="min-h-screen bg-[#0f1012] text-slate-200 font-sans text-sm">
      <Header subtitle="Sales · Quotes & orders">
        <button onClick={() => openEditor(null)} className="px-4 py-2 rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 text-sm font-semibold transition-colors">+ New Quote</button>
      </Header>
      <main className="max-w-[1200px] mx-auto px-4 md:px-8 py-6 space-y-5">
        <SalesMigrationBanner />
        <div className="relative">
          <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by number, customer, status…"
            className="w-full pl-10 pr-4 h-11 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-white text-base sm:text-sm placeholder:text-slate-500 transition-colors" />
        </div>

        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden">
          <div className="hidden md:grid grid-cols-[150px_1fr_120px_140px_110px] gap-3 px-4 py-2.5 border-b border-slate-800 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            <span>Number</span><span>Customer</span><span>Status</span><span className="text-right">Grand Total</span><span className="text-right">Updated</span>
          </div>
          {loading ? (
            <div className="p-4 space-y-1.5">{[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-12 text-center text-slate-600 text-sm">{quotes.length === 0 ? 'No sales quotes yet — create your first one.' : 'No matches.'}</div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {filtered.map((q) => {
                const c = q.customer_id ? custById.get(q.customer_id) : undefined;
                return (
                  <button key={q.quote_id} onClick={() => openEditor(q)} className="w-full text-left grid grid-cols-1 md:grid-cols-[150px_1fr_120px_140px_110px] gap-1 md:gap-3 px-4 py-3 hover:bg-slate-800/40 transition-colors items-center">
                    <span className="font-mono text-[11px] text-slate-300">{q.quote_number}</span>
                    <span className="text-sm text-slate-100 truncate">{c?.display_name || c?.legal_name || <span className="text-slate-600">No customer</span>}</span>
                    <span><span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${STATUS[q.status]?.cls ?? ''}`}>{STATUS[q.status]?.label ?? q.status}</span></span>
                    <span className="text-right tabular-nums text-slate-200">{fmtInt(Number(q.grand_total) || 0)}</span>
                    <span className="text-right text-[11px] text-slate-500 tabular-nums">{fmtDate(q.updated_at)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </main>
      {toast && <Toast msg={toast} />}
    </div>
  );
}

// ── Small building blocks ───────────────────────────────────────────────────
const inp = 'w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 focus:border-emerald-500/60 outline-none text-white text-sm placeholder:text-slate-600 transition-colors';
const inpSm = 'w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 focus:border-emerald-500/50 outline-none text-white text-xs placeholder:text-slate-600 transition-colors';

function Header({ subtitle, children }: { subtitle: string; children?: React.ReactNode }) {
  return (
    <div className="border-b border-slate-800/60 bg-[#0f1012]/80 backdrop-blur-md sticky top-0 z-30">
      <div className="max-w-[1200px] mx-auto px-4 md:px-8 py-4 flex items-center justify-between gap-4">
        <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle={subtitle} />
        {children}
      </div>
    </div>
  );
}
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

// Searchable product picker.
function ComponentPicker({ comps, value, label, onPick }: { comps: Comp[]; value: string | null; label: string; onPick: (c: Comp) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? comps.filter((c) => `${c.supplier_model} ${c.brand ?? ''}`.toLowerCase().includes(s)) : comps;
    return list.slice(0, 40);
  }, [comps, q]);
  return (
    <div className="relative">
      <input
        value={open ? q : label}
        onFocus={() => { setOpen(true); setQ(''); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setQ(e.target.value)}
        placeholder={value ? label : 'Pick product…'}
        className={inpSm}
      />
      {open && results.length > 0 && (
        <div className="absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-y-auto bg-slate-900 border border-slate-700 rounded-lg shadow-2xl">
          {results.map((c) => (
            <button key={c.component_id} onMouseDown={(e) => { e.preventDefault(); onPick(c); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-xs">
              <span className="block text-slate-200 truncate">{c.supplier_model}</span>
              <span className="block text-[10px] text-slate-500 truncate">{[c.brand, c.unit].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

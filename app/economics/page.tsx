/**
 * ICAPROC — Item Economics (Module 6)
 * The "is cash turning into more cash, per item?" dashboard, for
 * canManagePricing roles (owner + sell_admin). Everything here is INTERNAL —
 * margins and costs never reach customers.
 *
 * Basis (locked decisions):
 *  - Revenue = delivered DO lines × their Sales Order unit price (excl. PPN).
 *  - COGS = the stock ledger's `out` cost (moving-average landed cost stamped
 *    at delivery — migrations/stamp_out_movement_cogs.sql). Legacy deliveries
 *    with no ledger rows fall back to the item's current avg cost (marked ~).
 *  - CCC = DIO + DSO − DPO. DIO = stock value ÷ daily COGS; DSO = per-invoice
 *    issued→paid (weighted by nominal); DPO = supplier payment date − PO
 *    received date (weighted, IDR-normalized) — negative DPO means we pay
 *    suppliers BEFORE goods arrive (import prepayment), which lengthens CCC.
 */
'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import BrandMenu from '@/components/ui/BrandMenu';
import { formatCategory as humanize } from '@/lib/formatCategory';

interface Comp {
  component_id: string; supplier_model: string; internal_description: string | null;
  category: string | null; unit: string | null; selling_price_idr: number | null;
}
interface Move { component_id: string; direction: string; quantity: number; unit_cost_idr: number | null; source_type: string | null; source_id: string | null; moved_at: string | null; }
interface Do { do_id: string; quote_id: string; do_number: string; status: string; delivered_at: string | null; }
interface DoItem { do_id: string; so_item_id: string | null; component_id: string | null; qty: number; }
interface Order { quote_id: string; customer_id: string | null; sales_rep_id: string | null; order_number: string | null; quote_number: string; }
interface SoItem { item_id: string; quote_id: string; component_id: string | null; unit_price: number; is_section: boolean; }
interface Customer { customer_id: string; display_name: string; legal_name: string; account_manager_id: string | null; }
interface Invoice { invoice_id: string; quote_id: string; grand_total: number; issued_at: string | null; }
interface Receipt { invoice_id: string | null; amount: number; payment_date: string | null; }

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtRp = (n: number) => `Rp ${fmtInt(n)}`;
// Compact rupiah for KPI tiles: 12.4M / 1.2B instead of 11 digits
const fmtRpShort = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `Rp ${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `Rp ${(n / 1e6).toFixed(1)}M`;
  return fmtRp(n);
};
const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '';
const descOf = (c: Comp) => (c.internal_description && c.internal_description.trim()) || c.supplier_model || '(no description)';
const daysBetween = (a: string, b: string) => (new Date(a).getTime() - new Date(b).getTime()) / 86400000;

type Period = '90' | '365' | 'all';
const SLOW_DAYS = 60;

interface ItemRow {
  c: Comp;
  soldQty: number; revenue: number; cogs: number; gp: number; margin: number | null;
  cogsEstimated: boolean;
  onHand: number; avgCost: number; stockValue: number;
  dio: number | null; turns: number | null;
  lastSold: string | null;
  inProfit: boolean; slow: boolean;
  gpAllTime: number;
}
interface PartyRow { id: string; name: string; sub: string; revenue: number; gp: number; margin: number | null; orders: Set<string>; }

type Chip = 'all' | 'sold' | 'inprofit' | 'slow' | 'negative';
type SortKey = 'gp' | 'revenue' | 'margin' | 'stockValue' | 'dio' | 'soldQty';

export default function EconomicsPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const canView = !!profile && ROLE_PERMISSIONS[profile.role].canManagePricing;

  const [comps, setComps] = useState<Comp[]>([]);
  const [bals, setBals] = useState<Map<string, { qty: number; avg: number }>>(new Map());
  const [moves, setMoves] = useState<Move[]>([]);
  const [dos, setDos] = useState<Do[]>([]);
  const [doItems, setDoItems] = useState<DoItem[]>([]);
  const [orders, setOrders] = useState<Map<string, Order>>(new Map());
  const [soItems, setSoItems] = useState<Map<string, SoItem>>(new Map());
  const [customers, setCustomers] = useState<Map<string, Customer>>(new Map());
  const [users, setUsers] = useState<Map<string, { name: string; email: string }>>(new Map());
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [poReceived, setPoReceived] = useState<Map<string, string>>(new Map());
  const [poPayments, setPoPayments] = useState<{ po_id: string; amount_idr: number; payment_date: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const [period, setPeriod] = useState<Period>('365');
  const [chip, setChip] = useState<Chip>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'gp', dir: -1 });

  useEffect(() => { document.title = 'Economics — ICAPROC'; }, []);
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/economics')}`); return; }
    if (profile && !ROLE_PERMISSIONS[profile.role].canManagePricing) router.replace('/unauthorized');
  }, [authLoading, user, profile, router]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const fetchAllComponents = async () => {
      const PAGE = 1000;
      let all: Comp[] = [];
      let from = 0;
      for (;;) {
        const { data: page } = await supabase.from('3.0_components')
          .select('component_id, supplier_model, internal_description, category, unit, selling_price_idr')
          .order('supplier_model').range(from, from + PAGE - 1);
        if (!page || page.length === 0) break;
        all = all.concat(page as unknown as Comp[]);
        if (page.length < PAGE) break;
        from += PAGE;
      }
      return all;
    };
    const [allComps, balRes, movRes, doRes, doiRes, ordRes, soiRes, custRes, userRes, invRes, rcptRes, poRes, costRes] = await Promise.all([
      fetchAllComponents(),
      supabase.from('30.1_stock_balances').select('component_id, qty_on_hand, avg_cost_idr'),
      supabase.from('30.0_stock_movements').select('component_id, direction, quantity, unit_cost_idr, source_type, source_id, moved_at').limit(20000),
      supabase.from('24.0_delivery_orders').select('do_id, quote_id, do_number, status, delivered_at'),
      supabase.from('24.1_delivery_order_items').select('do_id, so_item_id, component_id, qty'),
      supabase.from('22.0_sales_quotes').select('quote_id, customer_id, sales_rep_id, order_number, quote_number'),
      supabase.from('22.1_sales_quote_items').select('item_id, quote_id, component_id, unit_price, is_section'),
      supabase.from('20.0_customers').select('customer_id, display_name, legal_name, account_manager_id'),
      supabase.from('user_profiles').select('id, display_name, email'),
      supabase.from('25.0_sales_invoices').select('invoice_id, quote_id, grand_total, issued_at'),
      supabase.from('26.0_customer_receipts').select('invoice_id, amount, payment_date'),
      supabase.from('5.0_purchases').select('po_id, actual_received_date'),
      supabase.from('6.0_po_costs').select('po_id, amount, payment_date, exchange_rate, currency'),
    ]);
    setComps(allComps);
    const bm = new Map<string, { qty: number; avg: number }>();
    for (const b of (balRes.data as { component_id: string; qty_on_hand: number; avg_cost_idr: number | null }[]) ?? []) {
      const prev = bm.get(b.component_id) ?? { qty: 0, avg: 0 };
      const q = Number(b.qty_on_hand) || 0;
      bm.set(b.component_id, { qty: prev.qty + q, avg: (Number(b.avg_cost_idr) || 0) > 0 ? Number(b.avg_cost_idr) : prev.avg });
    }
    setBals(bm);
    setMoves((movRes.data as Move[]) ?? []);
    setDos((doRes.data as Do[]) ?? []);
    setDoItems((doiRes.data as DoItem[]) ?? []);
    setOrders(new Map((((ordRes.data as Order[]) ?? []).map((o) => [o.quote_id, o]))));
    setSoItems(new Map((((soiRes.data as SoItem[]) ?? []).map((i) => [i.item_id, i]))));
    setCustomers(new Map((((custRes.data as Customer[]) ?? []).map((c) => [c.customer_id, c]))));
    setUsers(new Map((((userRes.data as { id: string; display_name: string | null; email: string }[]) ?? []).map((u) => [u.id, { name: u.display_name || u.email.split('@')[0], email: u.email }]))));
    setInvoices((invRes.data as Invoice[]) ?? []);
    setReceipts((rcptRes.data as Receipt[]) ?? []);
    const pr = new Map<string, string>();
    for (const p of (poRes.data as { po_id: unknown; actual_received_date: string | null }[]) ?? []) {
      if (p.actual_received_date) pr.set(String(p.po_id), p.actual_received_date); // po_id is UUID live — always String()
    }
    setPoReceived(pr);
    setPoPayments((((costRes.data as { po_id: unknown; amount: number | null; payment_date: string | null; exchange_rate: number | null; currency: string | null }[]) ?? [])
      .filter((c) => c.payment_date && (Number(c.amount) || 0) > 0)
      .map((c) => ({
        po_id: String(c.po_id),
        amount_idr: (Number(c.amount) || 0) * ((c.currency ?? 'IDR') === 'IDR' ? 1 : (Number(c.exchange_rate) || 1)),
        payment_date: c.payment_date!,
      }))));
    setLoading(false);
  }, []);

  useEffect(() => { if (canView) fetchAll(); }, [canView, fetchAll]);

  // ── Sales facts: one row per delivered DO × component ────────────────────
  const facts = useMemo(() => {
    const soById = soItems;
    // Net ledger COGS per delivered DO+component: outs − reversal ins
    const ledger = new Map<string, { qty: number; cost: number }>();
    for (const m of moves) {
      if (m.source_type !== 'delivery' || !m.source_id || !m.component_id) continue;
      const k = `${m.source_id}·${m.component_id}`;
      const e = ledger.get(k) ?? { qty: 0, cost: 0 };
      const sign = m.direction === 'out' ? 1 : -1;
      e.qty += sign * (Number(m.quantity) || 0);
      e.cost += sign * (Number(m.quantity) || 0) * (Number(m.unit_cost_idr) || 0);
      ledger.set(k, e);
    }
    const out: {
      component_id: string; do_id: string; date: string;
      qty: number; revenue: number; cogs: number; cogsEstimated: boolean;
      customer_id: string | null; rep_id: string | null; quote_id: string;
    }[] = [];
    for (const d of dos) {
      if (d.status !== 'delivered') continue;
      const date = d.delivered_at ?? '';
      const order = orders.get(d.quote_id);
      const cust = order?.customer_id ? customers.get(order.customer_id) : undefined;
      const rep = order?.sales_rep_id ?? cust?.account_manager_id ?? null;
      // group this DO's lines by component (COGS in the ledger is per component)
      const byComp = new Map<string, { qty: number; revenue: number }>();
      for (const li of doItems) {
        if (li.do_id !== d.do_id || !li.component_id) continue;
        const so = li.so_item_id ? soById.get(li.so_item_id) : undefined;
        const price = Number(so?.unit_price) || 0;
        const e = byComp.get(li.component_id) ?? { qty: 0, revenue: 0 };
        e.qty += Number(li.qty) || 0;
        e.revenue += (Number(li.qty) || 0) * price;
        byComp.set(li.component_id, e);
      }
      for (const [cid, e] of byComp) {
        const led = ledger.get(`${d.do_id}·${cid}`);
        let cogs: number; let est = false;
        if (led && led.qty > 0 && led.cost > 0) {
          cogs = led.cost * (e.qty / led.qty); // ledger qty should equal line qty; scale defensively
        } else {
          // Legacy delivery with no ledger rows — estimate at today's avg cost
          cogs = e.qty * (bals.get(cid)?.avg ?? 0);
          est = true;
        }
        out.push({ component_id: cid, do_id: d.do_id, date, qty: e.qty, revenue: e.revenue, cogs, cogsEstimated: est, customer_id: order?.customer_id ?? null, rep_id: rep, quote_id: d.quote_id });
      }
    }
    return out;
  }, [dos, doItems, soItems, moves, orders, customers, bals]);

  const nowIso = useMemo(() => new Date().toISOString(), []);
  const cutoff = useMemo(() => {
    if (period === 'all') return '';
    const d = new Date(); d.setDate(d.getDate() - Number(period));
    return d.toISOString();
  }, [period]);
  const periodFacts = useMemo(() => facts.filter((f) => !cutoff || (f.date && f.date >= cutoff)), [facts, cutoff]);
  // Days the period actually covers (for daily-COGS annualization)
  const periodDays = useMemo(() => {
    if (period !== 'all') return Number(period);
    const dates = facts.map((f) => f.date).filter(Boolean).sort();
    return dates.length ? Math.max(30, Math.ceil(daysBetween(nowIso, dates[0]))) : 365;
  }, [period, facts, nowIso]);

  // ── Item rollup ────────────────────────────────────────────────────────────
  const itemRows: ItemRow[] = useMemo(() => {
    const acc = new Map<string, { qty: number; rev: number; cogs: number; est: boolean; last: string | null }>();
    for (const f of periodFacts) {
      const e = acc.get(f.component_id) ?? { qty: 0, rev: 0, cogs: 0, est: false, last: null };
      e.qty += f.qty; e.rev += f.revenue; e.cogs += f.cogs; e.est = e.est || f.cogsEstimated;
      if (f.date && (!e.last || f.date > e.last)) e.last = f.date;
      acc.set(f.component_id, e);
    }
    const gpAll = new Map<string, number>();
    const lastAll = new Map<string, string>();
    for (const f of facts) {
      gpAll.set(f.component_id, (gpAll.get(f.component_id) ?? 0) + (f.revenue - f.cogs));
      if (f.date && f.date > (lastAll.get(f.component_id) ?? '')) lastAll.set(f.component_id, f.date);
    }
    const rows: ItemRow[] = [];
    for (const c of comps) {
      const b = bals.get(c.component_id);
      const onHand = Math.max(0, b?.qty ?? 0);
      const avgCost = b?.avg ?? 0;
      const stockValue = onHand * avgCost;
      const a = acc.get(c.component_id);
      if (!a && stockValue <= 0) continue; // nothing sold, nothing held — not an economics row
      const revenue = a?.rev ?? 0, cogs = a?.cogs ?? 0, soldQty = a?.qty ?? 0;
      const gp = revenue - cogs;
      const dailyCogs = cogs / periodDays;
      const lastSold = lastAll.get(c.component_id) ?? null;
      rows.push({
        c, soldQty, revenue, cogs, gp,
        margin: revenue > 0 ? (gp / revenue) * 100 : null,
        cogsEstimated: a?.est ?? false,
        onHand, avgCost, stockValue,
        dio: stockValue > 0 && dailyCogs > 0 ? stockValue / dailyCogs : null,
        turns: stockValue > 0 && cogs > 0 ? (cogs / periodDays * 365) / stockValue : null,
        lastSold,
        gpAllTime: gpAll.get(c.component_id) ?? 0,
        inProfit: stockValue > 0 && (gpAll.get(c.component_id) ?? 0) >= stockValue,
        slow: onHand > 0 && (!lastSold || daysBetween(nowIso, lastSold) > SLOW_DAYS),
      });
    }
    return rows;
  }, [comps, bals, periodFacts, facts, periodDays, nowIso]);

  // ── Customer / rep rollup ──────────────────────────────────────────────────
  const custRows: PartyRow[] = useMemo(() => rollupParty(periodFacts, (f) => f.customer_id, (id) => {
    const c = customers.get(id);
    return { name: c?.display_name || c?.legal_name || 'Unknown customer', sub: '' };
  }), [periodFacts, customers]);
  const repRows: PartyRow[] = useMemo(() => rollupParty(periodFacts, (f) => f.rep_id, (id) => {
    const u = users.get(id);
    return { name: u?.name ?? 'Unknown', sub: u?.email ?? '' };
  }), [periodFacts, users]);

  // ── Company cash conversion cycle ──────────────────────────────────────────
  const ccc = useMemo(() => {
    const stockValue = itemRows.reduce((s, r) => s + r.stockValue, 0);
    const cogsPeriod = periodFacts.reduce((s, f) => s + f.cogs, 0);
    const dio = cogsPeriod > 0 ? stockValue / (cogsPeriod / periodDays) : null;

    // DSO: paid invoices (Σ receipts ≥ total), issued→last payment, value-weighted
    const paidByInv = new Map<string, { paid: number; last: string }>();
    for (const r of receipts) {
      if (!r.invoice_id || !r.payment_date) continue;
      const e = paidByInv.get(r.invoice_id) ?? { paid: 0, last: '' };
      e.paid += Number(r.amount) || 0;
      if (r.payment_date > e.last) e.last = r.payment_date;
      paidByInv.set(r.invoice_id, e);
    }
    let dsoW = 0, dsoSum = 0, arOutstanding = 0;
    for (const inv of invoices) {
      if (!inv.issued_at) continue;
      if (cutoff && inv.issued_at < cutoff.slice(0, 10)) continue;
      const p = paidByInv.get(inv.invoice_id);
      const total = Number(inv.grand_total) || 0;
      if (p && p.paid >= total - 1 && p.last) {
        dsoW += total; dsoSum += total * daysBetween(p.last, inv.issued_at);
      } else {
        arOutstanding += total - (p?.paid ?? 0);
      }
    }
    const dso = dsoW > 0 ? dsoSum / dsoW : null;

    // DPO: supplier payment date − PO received date (negative = prepaid imports)
    let dpoW = 0, dpoSum = 0;
    for (const pay of poPayments) {
      const rec = poReceived.get(pay.po_id);
      if (!rec) continue;
      if (cutoff && pay.payment_date < cutoff.slice(0, 10)) continue;
      dpoW += pay.amount_idr; dpoSum += pay.amount_idr * daysBetween(pay.payment_date, rec);
    }
    const dpo = dpoW > 0 ? dpoSum / dpoW : null;
    const cccDays = dio != null ? dio + (dso ?? 0) - (dpo ?? 0) : null;
    return { dio, dso, dpo, ccc: cccDays, stockValue, cogsPeriod, arOutstanding };
  }, [itemRows, periodFacts, periodDays, invoices, receipts, poPayments, poReceived, cutoff]);

  const kpi = useMemo(() => {
    const revenue = periodFacts.reduce((s, f) => s + f.revenue, 0);
    const gp = periodFacts.reduce((s, f) => s + (f.revenue - f.cogs), 0);
    return {
      revenue, gp,
      margin: revenue > 0 ? (gp / revenue) * 100 : null,
      inProfitCount: itemRows.filter((r) => r.inProfit).length,
      inProfitValue: itemRows.filter((r) => r.inProfit).reduce((s, r) => s + r.stockValue, 0),
      slowCount: itemRows.filter((r) => r.slow).length,
      slowValue: itemRows.filter((r) => r.slow).reduce((s, r) => s + r.stockValue, 0),
    };
  }, [periodFacts, itemRows]);

  // ── Table filter/sort ──────────────────────────────────────────────────────
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = itemRows;
    if (chip === 'sold') rows = rows.filter((r) => r.soldQty > 0);
    else if (chip === 'inprofit') rows = rows.filter((r) => r.inProfit);
    else if (chip === 'slow') rows = rows.filter((r) => r.slow);
    else if (chip === 'negative') rows = rows.filter((r) => r.revenue > 0 && r.gp < 0);
    if (q) rows = rows.filter((r) => [descOf(r.c), r.c.category].filter(Boolean).join(' ').toLowerCase().includes(q));
    const { key, dir } = sort;
    return [...rows].sort((a, b) => {
      const va = a[key] ?? (key === 'dio' ? Infinity : -Infinity);
      const vb = b[key] ?? (key === 'dio' ? Infinity : -Infinity);
      const d = (Number(va) - Number(vb)) * dir;
      return d !== 0 ? d : b.stockValue - a.stockValue;
    });
  }, [itemRows, chip, search, sort]);

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: -1 }));

  if (authLoading || !profile || !canView) {
    return <div className="min-h-screen bg-[#0f1012] flex items-center justify-center"><div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" /></div>;
  }

  const periodLabel = period === 'all' ? 'all time' : `last ${period} days`;

  return (
    <div className="min-h-screen bg-[#0f1012] text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-[#0f1012]/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1600px] 2xl:max-w-[2120px] mx-auto px-3 sm:px-4 md:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Economics · Item profitability & cash cycle" />
          <div className="flex items-center gap-1.5">
            {(['90', '365', 'all'] as Period[]).map((p) => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${period === p ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 font-bold' : 'border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800'}`}>
                {p === 'all' ? 'All time' : `${p}d`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-[1600px] 2xl:max-w-[2120px] mx-auto px-3 sm:px-4 md:px-6 py-6 space-y-5">
        {loading ? (
          <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-slate-800/40 rounded-2xl animate-pulse" />)}</div>
        ) : (
          <>
            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              <Kpi label={`Delivered revenue · ${periodLabel}`} value={fmtRpShort(kpi.revenue)} sub={`${periodFacts.length ? `${fmtInt(periodFacts.reduce((s, f) => s + f.qty, 0))} units shipped` : 'no deliveries in period'}`} />
              <Kpi label={`Realized GP · ${periodLabel}`} value={fmtRpShort(kpi.gp)} tone={kpi.gp < 0 ? 'red' : 'green'}
                sub={kpi.margin != null ? `${kpi.margin.toFixed(1)}% margin` : '—'} />
              <Kpi label="Stock value (now)" value={fmtRpShort(ccc.stockValue)} sub={`${fmtRpShort(kpi.inProfitValue)} already in profit · ${kpi.inProfitCount} item${kpi.inProfitCount !== 1 ? 's' : ''}`} />
              <Kpi label="Slow-moving stock" value={fmtRpShort(kpi.slowValue)} tone={kpi.slowValue > 0 ? 'amber' : 'green'}
                sub={`${kpi.slowCount} item${kpi.slowCount !== 1 ? 's' : ''} idle > ${SLOW_DAYS}d`} />
            </div>

            {/* CCC — the runway */}
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl px-4 sm:px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Cash Conversion Cycle · {periodLabel}</h2>
                <span className="text-[10px] text-slate-600">CCC = DIO + DSO − DPO · days of cash locked per cycle — shorter is more runway</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                <CccPart label="DIO · inventory" days={ccc.dio} hint="Stock value ÷ daily COGS — days an item sits before it ships" />
                <CccPart label="DSO · receivables" days={ccc.dso} hint="Invoice issued → paid, value-weighted (paid invoices)"
                  extra={ccc.arOutstanding > 0 ? `${fmtRpShort(ccc.arOutstanding)} AR still open` : undefined} />
                <CccPart label="DPO · payables" days={ccc.dpo} negate hint="Supplier payment vs goods received — NEGATIVE days mean we prepay imports before arrival, which lengthens the cycle" />
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] px-3.5 py-3">
                  <p className="text-[10px] uppercase tracking-wider text-emerald-500/80">CCC · the runway</p>
                  <p className={`text-xl font-bold tabular-nums mt-0.5 ${ccc.ccc == null ? 'text-slate-600' : 'text-emerald-300'}`}>
                    {ccc.ccc == null ? '—' : `${Math.round(ccc.ccc)}d`}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{ccc.ccc == null ? 'needs delivered COGS in period' : 'cash out → cash back, per rupiah cycled'}</p>
                </div>
              </div>
            </div>

            {/* Item table */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[180px]">
                  <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item or category…"
                    className="w-full pl-10 pr-4 h-10 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-white text-base sm:text-sm placeholder:text-[13px] sm:placeholder:text-sm placeholder:text-slate-500 transition-colors" />
                </div>
                {([['all', `All (${itemRows.length})`], ['sold', 'Sold in period'], ['inprofit', `In profit (${kpi.inProfitCount})`], ['slow', `Slow movers (${kpi.slowCount})`], ['negative', 'Negative GP']] as [Chip, string][]).map(([k, label]) => (
                  <button key={k} onClick={() => setChip(k)}
                    className={`text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${chip === k ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 font-bold' : 'border-slate-700/80 text-slate-500 hover:text-slate-300'}`}>
                    {label}
                  </button>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-x-auto">
                <table className="w-full min-w-[1050px]">
                  <thead>
                    <tr className="border-b border-slate-800 text-[10px] uppercase tracking-widest text-slate-500">
                      <th className="text-left font-semibold px-4 py-2.5">Item</th>
                      <SortTh label="Sold" k="soldQty" sort={sort} onClick={toggleSort} />
                      <SortTh label="Revenue" k="revenue" sort={sort} onClick={toggleSort} />
                      <SortTh label="GP" k="gp" sort={sort} onClick={toggleSort} />
                      <SortTh label="GP %" k="margin" sort={sort} onClick={toggleSort} />
                      <th className="text-right font-semibold px-3 py-2.5">On hand</th>
                      <SortTh label="Stock value" k="stockValue" sort={sort} onClick={toggleSort} />
                      <SortTh label="DIO" k="dio" sort={sort} onClick={toggleSort} hint="days" />
                      <th className="text-right font-semibold px-3 py-2.5">Last sold</th>
                      <th className="text-left font-semibold px-3 py-2.5">Flags</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {visibleRows.length === 0 ? (
                      <tr><td colSpan={10} className="px-4 py-12 text-center text-slate-600">No items match — deliveries feed this table (mark DOs delivered to see GP).</td></tr>
                    ) : visibleRows.map((r) => (
                      <tr key={r.c.component_id} className="hover:bg-slate-800/20 transition-colors">
                        <td className="px-4 py-2">
                          <p className="text-sm text-slate-100 truncate max-w-[300px]">{descOf(r.c)}</p>
                          <p className="text-[10px] text-slate-600">{r.c.category ? humanize(r.c.category) : '—'}</p>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-300">{r.soldQty ? `${fmtInt(r.soldQty)}${r.c.unit ? ` ${r.c.unit}` : ''}` : <span className="text-slate-700">—</span>}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-300 whitespace-nowrap">{r.revenue ? fmtRp(r.revenue) : <span className="text-slate-700">—</span>}</td>
                        <td className={`px-3 py-2 text-right tabular-nums text-sm font-semibold whitespace-nowrap ${r.revenue === 0 ? 'text-slate-700' : r.gp < 0 ? 'text-red-400' : 'text-emerald-300'}`}>
                          {r.revenue ? `${fmtRp(r.gp)}${r.cogsEstimated ? ' ~' : ''}` : '—'}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums text-xs ${r.margin == null ? 'text-slate-700' : r.margin < 0 ? 'text-red-400' : 'text-slate-300'}`}>{r.margin != null ? `${r.margin.toFixed(1)}%` : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-300">{r.onHand ? `${fmtInt(r.onHand)}${r.c.unit ? ` ${r.c.unit}` : ''}` : <span className="text-slate-700">0</span>}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-300 whitespace-nowrap">{r.stockValue ? fmtRp(r.stockValue) : <span className="text-slate-700">—</span>}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-400">{r.dio != null ? `${Math.round(r.dio)}d` : <span className="text-slate-700">—</span>}</td>
                        <td className="px-3 py-2 text-right text-[11px] text-slate-500 tabular-nums whitespace-nowrap">{r.lastSold ? fmtDate(r.lastSold) : <span className="text-slate-700">never</span>}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="inline-flex gap-1">
                            {r.inProfit && <Badge tone="emerald" title={`All-time GP ${fmtRp(r.gpAllTime)} ≥ stock value — the remaining stock is already paid for`}>✓ in profit</Badge>}
                            {r.slow && <Badge tone="amber" title={`No delivery in ${SLOW_DAYS}+ days with stock on hand`}>slow</Badge>}
                            {r.cogsEstimated && <Badge tone="slate" title="Some deliveries predate the ledger — COGS estimated at current avg cost">~ est. COGS</Badge>}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden space-y-2">
                {visibleRows.length === 0 ? (
                  <p className="px-4 py-10 text-center text-slate-600 text-sm">No items match.</p>
                ) : visibleRows.slice(0, 60).map((r) => (
                  <div key={r.c.component_id} className="bg-slate-900/40 border border-slate-800/80 rounded-xl px-3.5 py-3">
                    <p className="text-sm text-slate-100 font-medium truncate">{descOf(r.c)}</p>
                    <div className="flex flex-wrap gap-1.5 mt-1.5 text-[11px]">
                      {r.revenue > 0 && (
                        <span className={`px-2 py-1 rounded-lg bg-slate-800/80 tabular-nums font-semibold ${r.gp < 0 ? 'text-red-300' : 'text-emerald-300'}`}>GP {fmtRpShort(r.gp)}{r.margin != null ? ` · ${r.margin.toFixed(0)}%` : ''}</span>
                      )}
                      {r.stockValue > 0 && <span className="px-2 py-1 rounded-lg bg-slate-800/60 text-slate-300 tabular-nums">stock {fmtRpShort(r.stockValue)}</span>}
                      {r.dio != null && <span className="px-2 py-1 rounded-lg bg-slate-800/60 text-slate-400 tabular-nums">DIO {Math.round(r.dio)}d</span>}
                      {r.inProfit && <span className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-300">✓ in profit</span>}
                      {r.slow && <span className="px-2 py-1 rounded-lg bg-amber-500/10 text-amber-300">slow</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* GP by customer / rep */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <PartyPanel title={`GP by customer · ${periodLabel}`} rows={custRows} emptyNote="Deliver orders to see per-customer GP." linkBase="/customers" />
              <PartyPanel title={`GP by sales rep · ${periodLabel}`} rows={repRows} emptyNote="Assign account managers / reps to see per-rep GP." />
            </div>

            <p className="text-[10px] text-slate-600 max-w-4xl">
              Basis: revenue = delivered DO lines at their Sales Order price (excl. PPN); COGS = the stock ledger&apos;s moving-average landed cost stamped at delivery
              (~ = legacy delivery estimated at current avg). GP is realized on delivery, not on invoice. DIO uses the period&apos;s daily COGS; items never delivered show no DIO.
              Internal only. Pricing floors live in <Link href="/pricing" className="text-emerald-500/80 hover:text-emerald-300">Pricing</Link>; per-item ledger in <Link href="/stock" className="text-emerald-500/80 hover:text-emerald-300">Stock</Link>.
            </p>
          </>
        )}
      </main>
    </div>
  );
}

// ── Rollup helper ────────────────────────────────────────────────────────────
function rollupParty(
  facts: { revenue: number; cogs: number; quote_id: string }[] & { customer_id?: string | null }[] | { component_id: string; revenue: number; cogs: number; quote_id: string; customer_id: string | null; rep_id: string | null }[],
  keyOf: (f: { customer_id: string | null; rep_id: string | null }) => string | null,
  nameOf: (id: string) => { name: string; sub: string },
): PartyRow[] {
  const m = new Map<string, PartyRow>();
  for (const f of facts as { revenue: number; cogs: number; quote_id: string; customer_id: string | null; rep_id: string | null }[]) {
    const id = keyOf(f) ?? '·unassigned';
    let e = m.get(id);
    if (!e) {
      const meta = id === '·unassigned' ? { name: 'Unassigned', sub: '' } : nameOf(id);
      e = { id, name: meta.name, sub: meta.sub, revenue: 0, gp: 0, margin: null, orders: new Set() };
      m.set(id, e);
    }
    e.revenue += f.revenue;
    e.gp += f.revenue - f.cogs;
    e.orders.add(f.quote_id);
  }
  return [...m.values()]
    .map((r) => ({ ...r, margin: r.revenue > 0 ? (r.gp / r.revenue) * 100 : null }))
    .sort((a, b) => b.gp - a.gp);
}

// ── Pieces ───────────────────────────────────────────────────────────────────
function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'red' | 'green' | 'amber' }) {
  const cls = tone === 'red' ? 'text-red-300' : tone === 'amber' ? 'text-amber-300' : tone === 'green' ? 'text-emerald-300' : 'text-slate-100';
  return (
    <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-slate-600 truncate" title={label}>{label}</p>
      <p className={`text-xl font-bold tabular-nums mt-0.5 ${cls}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5 truncate" title={sub}>{sub}</p>}
    </div>
  );
}

function CccPart({ label, days, hint, negate, extra }: { label: string; days: number | null; hint: string; negate?: boolean; extra?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3.5 py-3" title={hint}>
      <p className="text-[10px] uppercase tracking-wider text-slate-600">{negate ? '− ' : '+ '}{label}</p>
      <p className={`text-xl font-bold tabular-nums mt-0.5 ${days == null ? 'text-slate-600' : 'text-slate-100'}`}>
        {days == null ? '—' : `${Math.round(days)}d`}
      </p>
      <p className="text-[10px] text-slate-600 mt-0.5 truncate">{extra ?? hint}</p>
    </div>
  );
}

function SortTh({ label, k, sort, onClick, hint }: { label: string; k: SortKey; sort: { key: SortKey; dir: 1 | -1 }; onClick: (k: SortKey) => void; hint?: string }) {
  const active = sort.key === k;
  return (
    <th className="text-right font-semibold px-3 py-2.5">
      <button onClick={() => onClick(k)} className={`inline-flex items-center gap-1 uppercase tracking-widest transition-colors ${active ? 'text-emerald-400' : 'hover:text-slate-300'}`} title={hint}>
        {label}<span className="text-[8px]">{active ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}

function Badge({ tone, title, children }: { tone: 'emerald' | 'amber' | 'slate'; title?: string; children: React.ReactNode }) {
  const cls = tone === 'emerald' ? 'bg-emerald-500/10 text-emerald-300' : tone === 'amber' ? 'bg-amber-500/10 text-amber-300' : 'bg-slate-800 text-slate-500';
  return <span title={title} className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${cls}`}>{children}</span>;
}

function PartyPanel({ title, rows, emptyNote, linkBase }: { title: string; rows: PartyRow[]; emptyNote: string; linkBase?: string }) {
  return (
    <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl px-4 py-3.5">
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-2">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-[11px] text-slate-600 italic py-4 text-center">{emptyNote}</p>
      ) : (
        <div className="divide-y divide-slate-800/60">
          {rows.slice(0, 10).map((r) => (
            <div key={r.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                {linkBase && r.id !== '·unassigned' ? (
                  <Link href={linkBase} className="text-xs text-slate-200 font-medium truncate block hover:text-emerald-300 transition-colors">{r.name}</Link>
                ) : (
                  <p className="text-xs text-slate-200 font-medium truncate">{r.name}</p>
                )}
                <p className="text-[10px] text-slate-600 truncate">{r.orders.size} order{r.orders.size !== 1 ? 's' : ''}{r.sub ? ` · ${r.sub}` : ''}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className={`text-xs font-bold tabular-nums ${r.gp < 0 ? 'text-red-400' : 'text-emerald-300'}`}>{fmtRpShort(r.gp)}</p>
                <p className="text-[10px] text-slate-600 tabular-nums">{fmtRpShort(r.revenue)}{r.margin != null ? ` · ${r.margin.toFixed(0)}%` : ''}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

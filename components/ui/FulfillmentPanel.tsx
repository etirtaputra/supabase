'use client';
import { useMemo, useState } from 'react';
import { createSupabaseClient } from '@/lib/supabase';

/**
 * Fulfillment panel for a Sales Order (22.0): its child Invoices (25.x) and
 * Delivery Orders (24.x), with remaining-to-invoice / remaining-to-deliver
 * meters and the create/deliver/reopen actions.
 *  - "+ New Invoice" prefills 100% of the remaining uninvoiced qty per line
 *    (edit quantities to split, or switch to "% of order" for DP/progress
 *    billing) — the simple 1:1 case stays one click.
 *  - "+ New Delivery Order" prefills all undelivered qty per line — trim to
 *    split shipments. Each DO writes its OWN stock-outs when marked
 *    delivered, and "Reopen" reverses them (movements are append-only, so
 *    reversal is compensating `in` rows) — an order is always revertible.
 *  - First child's number mirrors into the order's legacy INV/DO columns so
 *    prints, milestones, and old links keep working.
 */

export interface SoLine { item_id: string; component_id: string | null; is_section: boolean; description: string; unit: string; quantity: number; unit_price: number; }
export interface Invoice { invoice_id: string; quote_id: string; invoice_number: string; kind: string; pct: number | null; do_id: string | null; subtotal: number; ppn_pct: number; ppn_amount: number; grand_total: number; issued_at: string | null; notes: string; }
export interface InvItem { inv_item_id: string; invoice_id: string; so_item_id: string | null; description: string; unit: string; qty: number; unit_price: number; line_total: number; }
export interface DeliveryOrder { do_id: string; quote_id: string; do_number: string; status: string; delivery_date: string | null; delivery_time: string; delivery_method: string; delivery_via: string; delivery_address: string; delivery_map_url: string; delivery_contact: string; delivered_at: string | null; notes: string; }
export interface DoItem { do_item_id: string; do_id: string; so_item_id: string | null; component_id: string | null; description: string; unit: string; qty: number; }
interface OrderLite { quote_id: string; quote_number: string; order_number?: string; invoice_number?: string; do_number?: string; status: string; ppn_pct: number; grand_total: number; }
interface Contact { name: string; title: string; phone: string; }

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtD = (d?: string | null) => d ? new Date(d.length <= 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '';
const num = (v: unknown): number => { if (v === '' || v == null) return 0; const n = Number(String(v).replace(/[, ]/g, '')); return isNaN(n) ? 0 : n; };
const today = () => new Date().toISOString().slice(0, 10);

const TIME_OF_DAY = ['Pagi (08–11)', 'Siang (11–14)', 'Sore (14–17)'];
const VIA_SUGGESTIONS = ['Armada sendiri', 'Kurir instan (GoSend/Grab)', 'Ekspedisi / cargo', 'JNE/J&T', 'Truk sewa'];
const inp = 'w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 focus:border-emerald-500/60 outline-none text-white text-sm placeholder:text-slate-600 transition-colors';
const inpSm = 'w-24 px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 focus:border-emerald-500/50 outline-none text-white text-xs text-right tabular-nums';

export default function FulfillmentPanel({ quote, soLines, invoices, invItems, dos, doItems, paidByInvoice, contacts, shippingAddress, canEdit, onChanged, flash }: {
  quote: OrderLite;
  soLines: SoLine[];
  invoices: Invoice[];
  invItems: InvItem[];
  dos: DeliveryOrder[];
  doItems: DoItem[];
  paidByInvoice: Record<string, number>;
  contacts: Contact[];
  shippingAddress: string;
  canEdit: boolean;
  onChanged: () => void;
  flash: (m: string) => void;
}) {
  const supabase = createSupabaseClient();
  const [busy, setBusy] = useState(false);
  const [showInv, setShowInv] = useState(false);
  const [showDo, setShowDo] = useState(false);

  const items = useMemo(() => soLines.filter((l) => !l.is_section && (l.quantity > 0)), [soLines]);
  const orderTotal = Number(quote.grand_total) || 0;

  // Invoiced qty per SO line (items invoices) + nominal totals
  const invoicedQtyByLine = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of invItems) if (it.so_item_id) m[it.so_item_id] = (m[it.so_item_id] ?? 0) + (Number(it.qty) || 0);
    return m;
  }, [invItems]);
  const invoicedTotal = invoices.reduce((s, i) => s + (Number(i.grand_total) || 0), 0);
  const invoicedPct = orderTotal > 0 ? (invoicedTotal / orderTotal) * 100 : 0;

  // Shipped (any non-cancelled DO) and delivered qty per SO line
  const doById = useMemo(() => new Map(dos.map((d) => [d.do_id, d])), [dos]);
  const shippedQtyByLine = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of doItems) {
      const d = doById.get(it.do_id);
      if (!d || d.status === 'cancelled' || !it.so_item_id) continue;
      m[it.so_item_id] = (m[it.so_item_id] ?? 0) + (Number(it.qty) || 0);
    }
    return m;
  }, [doItems, doById]);
  const deliveredQtyByLine = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of doItems) {
      const d = doById.get(it.do_id);
      if (!d || d.status !== 'delivered' || !it.so_item_id) continue;
      m[it.so_item_id] = (m[it.so_item_id] ?? 0) + (Number(it.qty) || 0);
    }
    return m;
  }, [doItems, doById]);

  const orderedQty = items.reduce((s, l) => s + l.quantity, 0);
  const shippedQty = items.reduce((s, l) => s + Math.min(l.quantity, shippedQtyByLine[l.item_id] ?? 0), 0);
  const deliveredQty = items.reduce((s, l) => s + Math.min(l.quantity, deliveredQtyByLine[l.item_id] ?? 0), 0);
  const fullyDelivered = items.length > 0 && items.every((l) => (deliveredQtyByLine[l.item_id] ?? 0) >= l.quantity - 1e-9);

  // ── Order rollup helpers (mirror first numbers into legacy columns) ────────
  async function patchOrder(patch: Record<string, unknown>) {
    if (Object.keys(patch).length === 0) return;
    const { error } = await supabase.from('22.0_sales_quotes').update(patch).eq('quote_id', quote.quote_id);
    if (error) flash(`Order update failed: ${error.message}`);
  }

  async function createInvoice(payload: { kind: 'items' | 'progress'; pct: number; lines: { so_item_id: string; description: string; unit: string; qty: number; unit_price: number }[]; issuedAt: string; notes: string }) {
    setBusy(true);
    const ppn = Number(quote.ppn_pct) || 0;
    let subtotal = 0;
    let invLines: { so_item_id: string | null; description: string; unit: string; qty: number; unit_price: number; line_total: number; sort_order: number }[] = [];
    if (payload.kind === 'items') {
      invLines = payload.lines.filter((l) => l.qty > 0).map((l, i) => ({
        so_item_id: l.so_item_id, description: l.description, unit: l.unit,
        qty: l.qty, unit_price: l.unit_price, line_total: l.qty * l.unit_price, sort_order: i,
      }));
      subtotal = invLines.reduce((s, l) => s + l.line_total, 0);
      if (invLines.length === 0) { setBusy(false); flash('Nothing to invoice — enter a quantity'); return; }
    } else {
      subtotal = (orderTotal * payload.pct / 100) / (1 + ppn / 100);
      invLines = [{ so_item_id: null, description: `Progress billing ${payload.pct}% — ${quote.order_number || quote.quote_number}`, unit: '', qty: 1, unit_price: subtotal, line_total: subtotal, sort_order: 0 }];
      if (payload.pct <= 0) { setBusy(false); flash('Enter a percentage'); return; }
    }
    const ppnAmt = subtotal * ppn / 100;
    const { data: inv, error } = await supabase.from('25.0_sales_invoices').insert({
      quote_id: quote.quote_id, kind: payload.kind, pct: payload.kind === 'progress' ? payload.pct : null,
      subtotal, ppn_pct: ppn, ppn_amount: ppnAmt, grand_total: subtotal + ppnAmt,
      issued_at: payload.issuedAt, notes: payload.notes,
    }).select('invoice_id, invoice_number').single();
    if (error || !inv) { setBusy(false); flash(`Invoice failed: ${error?.message ?? 'unknown'}`); return; }
    const { error: liErr } = await supabase.from('25.1_sales_invoice_items').insert(invLines.map((l) => ({ ...l, invoice_id: inv.invoice_id })));
    if (liErr) flash(`Invoice lines failed: ${liErr.message}`);
    // Rollup: first invoice advances the order + mirrors the number
    const patch: Record<string, unknown> = {};
    if (quote.status === 'ordered') patch.status = 'invoiced';
    if (!quote.invoice_number) patch.invoice_number = inv.invoice_number;
    await patchOrder(patch);
    setBusy(false);
    setShowInv(false);
    flash(`${inv.invoice_number} created`);
    onChanged();
  }

  async function deleteInvoice(inv: Invoice) {
    if ((paidByInvoice[inv.invoice_id] ?? 0) > 0) { flash('Payments are recorded against this invoice — remove them first.'); return; }
    if (!window.confirm(`Delete ${inv.invoice_number}? The INV number will not be reused.`)) return;
    setBusy(true);
    const { error } = await supabase.from('25.0_sales_invoices').delete().eq('invoice_id', inv.invoice_id);
    if (error) { setBusy(false); flash(`Failed: ${error.message}`); return; }
    const rest = invoices.filter((i) => i.invoice_id !== inv.invoice_id);
    const patch: Record<string, unknown> = {};
    if (quote.invoice_number === inv.invoice_number) patch.invoice_number = rest[0]?.invoice_number ?? '';
    if (rest.length === 0 && quote.status === 'invoiced') patch.status = 'ordered';
    await patchOrder(patch);
    setBusy(false);
    flash('Invoice deleted');
    onChanged();
  }

  async function createDo(payload: { details: { date: string; time: string; method: string; via: string; address: string; mapUrl: string; contact: string }; lines: { so_item_id: string; component_id: string | null; description: string; unit: string; qty: number }[] }) {
    const kept = payload.lines.filter((l) => l.qty > 0);
    if (kept.length === 0) { flash('Nothing to ship — enter a quantity'); return; }
    setBusy(true);
    const d = payload.details;
    const { data: doRow, error } = await supabase.from('24.0_delivery_orders').insert({
      quote_id: quote.quote_id, status: 'preparing',
      delivery_date: d.date || null, delivery_time: d.time, delivery_method: d.method,
      delivery_via: d.method === 'pickup' ? '' : d.via,
      delivery_address: d.method === 'pickup' ? '' : d.address,
      delivery_map_url: d.method === 'pickup' ? '' : d.mapUrl,
      delivery_contact: d.contact,
    }).select('do_id, do_number').single();
    if (error || !doRow) { setBusy(false); flash(`DO failed: ${error?.message ?? 'unknown'}`); return; }
    const { error: liErr } = await supabase.from('24.1_delivery_order_items').insert(kept.map((l, i) => ({
      do_id: doRow.do_id, so_item_id: l.so_item_id, component_id: l.component_id,
      description: l.description, unit: l.unit, qty: l.qty, sort_order: i,
    })));
    if (liErr) flash(`DO lines failed: ${liErr.message}`);
    // Rollup: first DO advances the order + mirrors number + legacy delivery fields
    const patch: Record<string, unknown> = {
      delivery_date: d.date || null, delivery_time: d.time, delivery_method: d.method,
      delivery_via: d.via, delivery_address: d.address, delivery_map_url: d.mapUrl, delivery_contact: d.contact,
    };
    if (['ordered', 'invoiced'].includes(quote.status)) patch.status = 'preparing';
    if (!quote.do_number) patch.do_number = doRow.do_number;
    await patchOrder(patch);
    setBusy(false);
    setShowDo(false);
    flash(`${doRow.do_number} created — warehouse can start preparing`);
    onChanged();
  }

  // Net stock already written for a DO (outs − reversal ins), per component
  async function netOutsForDo(doId: string): Promise<Record<string, { qty: number; cost: number }>> {
    const { data } = await supabase.from('30.0_stock_movements')
      .select('component_id, direction, quantity, unit_cost_idr')
      .eq('source_type', 'delivery').eq('source_id', doId);
    const net: Record<string, { qty: number; cost: number }> = {};
    for (const m of (data ?? []) as { component_id: string; direction: string; quantity: number; unit_cost_idr: number }[]) {
      const e = (net[m.component_id] ??= { qty: 0, cost: 0 });
      e.qty += (m.direction === 'out' ? 1 : -1) * (Number(m.quantity) || 0);
      if (m.direction === 'out') e.cost = Number(m.unit_cost_idr) || e.cost;
    }
    return net;
  }

  async function markDelivered(d: DeliveryOrder) {
    setBusy(true);
    const lines = doItems.filter((it) => it.do_id === d.do_id && it.component_id && it.qty > 0);
    const already = await netOutsForDo(d.do_id);
    const moves = lines
      .map((l) => ({ component_id: l.component_id!, qty: (Number(l.qty) || 0) - (already[l.component_id!]?.qty ?? 0) }))
      .filter((m) => m.qty > 0)
      .map((m) => ({
        component_id: m.component_id, location: 'MAIN', direction: 'out', quantity: m.qty,
        unit_cost_idr: 0, source_type: 'delivery', source_id: d.do_id,
        notes: `${d.do_number} · ${quote.order_number || quote.quote_number}`, allow_negative: true,
      }));
    if (moves.length) {
      const { error } = await supabase.from('30.0_stock_movements').insert(moves);
      if (error) { setBusy(false); flash(`Stock-out failed: ${error.message}`); return; }
    }
    const { error: doErr } = await supabase.from('24.0_delivery_orders').update({ status: 'delivered' }).eq('do_id', d.do_id);
    if (doErr) { setBusy(false); flash(`Failed: ${doErr.message}`); return; }
    // Full delivery across all lines → order is delivered
    const delivered = { ...deliveredQtyByLine };
    for (const l of lines) if (l.so_item_id) delivered[l.so_item_id] = (delivered[l.so_item_id] ?? 0) + (Number(l.qty) || 0);
    const allDone = items.every((l) => (delivered[l.item_id] ?? 0) >= l.quantity - 1e-9);
    if (allDone) await patchOrder({ status: 'delivered' });
    setBusy(false);
    flash(`${d.do_number} delivered — stock updated`);
    onChanged();
  }

  // Always revertible: reopening a delivered DO writes compensating `in`
  // movements (the ledger is append-only) and steps the order back.
  async function reopenDo(d: DeliveryOrder) {
    if (!window.confirm(`Reopen ${d.do_number}? Its stock-out will be reversed (goods back on hand).`)) return;
    setBusy(true);
    const net = await netOutsForDo(d.do_id);
    const backIn = Object.entries(net)
      .filter(([, e]) => e.qty > 0)
      .map(([cid, e]) => ({
        component_id: cid, location: 'MAIN', direction: 'in', quantity: e.qty,
        unit_cost_idr: Math.round(e.cost), source_type: 'delivery', source_id: d.do_id,
        notes: `Reversal — ${d.do_number} reopened`,
      }));
    if (backIn.length) {
      const { error } = await supabase.from('30.0_stock_movements').insert(backIn);
      if (error) { setBusy(false); flash(`Reversal failed: ${error.message}`); return; }
    }
    const { error: doErr } = await supabase.from('24.0_delivery_orders').update({ status: 'preparing', delivered_at: null }).eq('do_id', d.do_id);
    if (doErr) { setBusy(false); flash(`Failed: ${doErr.message}`); return; }
    if (quote.status === 'delivered') await patchOrder({ status: 'preparing' });
    setBusy(false);
    flash(`${d.do_number} reopened — stock restored`);
    onChanged();
  }

  async function deleteDo(d: DeliveryOrder) {
    if (d.status === 'delivered') { flash('Reopen the DO first — a delivered DO cannot be deleted directly.'); return; }
    if (!window.confirm(`Delete ${d.do_number}?`)) return;
    setBusy(true);
    const { error } = await supabase.from('24.0_delivery_orders').delete().eq('do_id', d.do_id);
    if (error) { setBusy(false); flash(`Failed: ${error.message}`); return; }
    const rest = dos.filter((x) => x.do_id !== d.do_id);
    const patch: Record<string, unknown> = {};
    if (quote.do_number === d.do_number) patch.do_number = rest[0]?.do_number ?? '';
    if (rest.length === 0 && quote.status === 'preparing') patch.status = invoices.length ? 'invoiced' : 'ordered';
    await patchOrder(patch);
    setBusy(false);
    flash('Delivery order deleted');
    onChanged();
  }

  const meter = (pct: number, cls: string) => (
    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${cls}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );

  return (
    <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400">Fulfillment</h3>
        <span className="text-[11px] text-slate-500">
          {invoices.length} invoice{invoices.length !== 1 ? 's' : ''} · {dos.length} delivery order{dos.length !== 1 ? 's' : ''}
        </span>
        {invoicedPct > 100.5 && <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/15 text-red-300">Invoiced {invoicedPct.toFixed(0)}% — over 100%</span>}
      </div>

      {/* Meters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <div className="flex justify-between text-[11px] mb-1">
            <span className="text-slate-500">Invoiced</span>
            <span className="tabular-nums text-slate-300">Rp {fmtInt(invoicedTotal)} · {invoicedPct.toFixed(0)}%</span>
          </div>
          {meter(invoicedPct, invoicedPct >= 99.5 ? 'bg-emerald-500' : 'bg-amber-400')}
          {orderTotal - invoicedTotal > 0.5 && <p className="text-[10px] text-slate-600 mt-1">Rp {fmtInt(orderTotal - invoicedTotal)} left to invoice</p>}
        </div>
        <div>
          <div className="flex justify-between text-[11px] mb-1">
            <span className="text-slate-500">Delivered</span>
            <span className="tabular-nums text-slate-300">{fmtInt(deliveredQty)} of {fmtInt(orderedQty)} units{shippedQty > deliveredQty ? ` · ${fmtInt(shippedQty - deliveredQty)} preparing` : ''}</span>
          </div>
          {meter(orderedQty > 0 ? (deliveredQty / orderedQty) * 100 : 0, fullyDelivered ? 'bg-emerald-500' : 'bg-orange-400')}
          {orderedQty - shippedQty > 0.001 && <p className="text-[10px] text-slate-600 mt-1">{fmtInt(orderedQty - shippedQty)} units not yet on a DO</p>}
        </div>
      </div>

      {/* Invoices */}
      {invoices.length > 0 && (
        <div className="rounded-xl border border-slate-800 divide-y divide-slate-800/60">
          {invoices.map((i) => {
            const paid = paidByInvoice[i.invoice_id] ?? 0;
            const total = Number(i.grand_total) || 0;
            const state = total > 0 && paid >= total - 0.5 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
            return (
              <div key={i.invoice_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-lime-500/15 text-lime-300">INV</span>
                <span className="font-mono text-slate-200">{i.invoice_number}</span>
                {i.kind === 'progress' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 font-semibold">{Number(i.pct ?? 0)}% progress</span>}
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${state === 'paid' ? 'bg-emerald-500/20 text-emerald-300' : state === 'partial' ? 'bg-amber-500/15 text-amber-300' : 'bg-red-500/10 text-red-400/90'}`}>
                  {state.toUpperCase()}
                </span>
                <span className="ml-auto tabular-nums text-slate-200 font-semibold">Rp {fmtInt(total)}</span>
                <span className="text-[10px] text-slate-600">{orderTotal > 0 ? `${((total / orderTotal) * 100).toFixed(0)}% of order` : ''}</span>
                <span className="text-slate-600 tabular-nums">{fmtD(i.issued_at)}</span>
                <a href={`/sales/${quote.quote_id}/print?inv=${i.invoice_id}`} target="_blank" rel="noopener noreferrer"
                  className="px-2 py-1 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-[10px] font-semibold transition-colors">Print</a>
                {canEdit && (
                  <button onClick={() => deleteInvoice(i)} disabled={busy} className="text-slate-600 hover:text-red-400 transition-colors" title="Delete invoice">×</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Delivery orders */}
      {dos.length > 0 && (
        <div className="rounded-xl border border-slate-800 divide-y divide-slate-800/60">
          {dos.map((d) => {
            const lines = doItems.filter((it) => it.do_id === d.do_id);
            const qty = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
            return (
              <div key={d.do_id} className="px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-500/15 text-orange-300">DO</span>
                  <span className="font-mono text-slate-200">{d.do_number}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${d.status === 'delivered' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-orange-500/15 text-orange-300'}`}>
                    {d.status === 'delivered' ? 'DELIVERED' : 'PREPARING'}
                  </span>
                  <span className="text-slate-500 truncate">{lines.length} line{lines.length !== 1 ? 's' : ''} · {fmtInt(qty)} units{d.delivery_date ? ` · ${fmtD(d.delivery_date)}` : ''}{d.delivery_method === 'pickup' ? ' · pick-up' : d.delivery_via ? ` · ${d.delivery_via}` : ''}</span>
                  <span className="ml-auto flex items-center gap-1.5">
                    <a href={`/sales/${quote.quote_id}/do?do=${d.do_id}`} target="_blank" rel="noopener noreferrer"
                      className="px-2 py-1 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-[10px] font-semibold transition-colors">Surat Jalan</a>
                    {canEdit && d.status === 'preparing' && (
                      <>
                        <button onClick={() => markDelivered(d)} disabled={busy}
                          className="px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 text-[10px] font-bold transition-colors">
                          Mark Delivered
                        </button>
                        <button onClick={() => deleteDo(d)} disabled={busy} className="text-slate-600 hover:text-red-400 transition-colors" title="Delete DO">×</button>
                      </>
                    )}
                    {canEdit && d.status === 'delivered' && (
                      <button onClick={() => reopenDo(d)} disabled={busy}
                        title="Reverse this DO's stock-out and put it back in Preparing"
                        className="px-2 py-1 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-[10px] font-semibold transition-colors">
                        Reopen
                      </button>
                    )}
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-slate-600 truncate">
                  {lines.map((l) => `${fmtInt(Number(l.qty))}× ${l.description}`).join(' · ')}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowInv(true)} disabled={busy || invoicedPct >= 100}
            title={invoicedPct >= 100 ? 'The order is fully invoiced' : 'Bill all or part of this order'}
            className="px-4 py-2 rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 text-xs font-semibold transition-colors disabled:opacity-40">
            + New Invoice
          </button>
          <button onClick={() => setShowDo(true)} disabled={busy || orderedQty - shippedQty <= 0.001}
            title={orderedQty - shippedQty <= 0.001 ? 'Everything is already on a DO' : 'Ship all or part of this order'}
            className="px-4 py-2 rounded-xl bg-orange-500/15 text-orange-300 ring-1 ring-orange-500/30 hover:bg-orange-500/25 text-xs font-semibold transition-colors disabled:opacity-40">
            + New Delivery Order
          </button>
        </div>
      )}

      {showInv && (
        <InvoiceModal
          items={items} invoicedQtyByLine={invoicedQtyByLine} orderTotal={orderTotal} invoicedTotal={invoicedTotal}
          ppnPct={Number(quote.ppn_pct) || 0} busy={busy}
          onClose={() => setShowInv(false)} onSubmit={createInvoice}
        />
      )}
      {showDo && (
        <DoModal
          items={items} shippedQtyByLine={shippedQtyByLine} contacts={contacts} shippingAddress={shippingAddress} busy={busy}
          onClose={() => setShowDo(false)} onSubmit={createDo}
        />
      )}
    </div>
  );
}

// ── New Invoice: items (qty per line, remaining prefilled) or % progress ─────
function InvoiceModal({ items, invoicedQtyByLine, orderTotal, invoicedTotal, ppnPct, busy, onClose, onSubmit }: {
  items: SoLine[]; invoicedQtyByLine: Record<string, number>; orderTotal: number; invoicedTotal: number; ppnPct: number; busy: boolean;
  onClose: () => void;
  onSubmit: (p: { kind: 'items' | 'progress'; pct: number; lines: { so_item_id: string; description: string; unit: string; qty: number; unit_price: number }[]; issuedAt: string; notes: string }) => void;
}) {
  const [kind, setKind] = useState<'items' | 'progress'>('items');
  const [qtys, setQtys] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const l of items) m[l.item_id] = String(Math.max(0, l.quantity - (invoicedQtyByLine[l.item_id] ?? 0)));
    return m;
  });
  const [pct, setPct] = useState(() => {
    const remaining = orderTotal > 0 ? Math.max(0, 100 - (invoicedTotal / orderTotal) * 100) : 100;
    return String(Math.round(remaining * 100) / 100);
  });
  const [issuedAt, setIssuedAt] = useState(today());
  const [notes, setNotes] = useState('');

  const subtotal = kind === 'items'
    ? items.reduce((s, l) => s + num(qtys[l.item_id]) * l.unit_price, 0)
    : (orderTotal * num(pct) / 100) / (1 + ppnPct / 100);
  const grand = subtotal * (1 + ppnPct / 100);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#141518] border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="text-base font-bold text-white">New Invoice</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">Prefilled with everything still uninvoiced — post as-is for the full bill, or trim quantities / switch to a % of the order to split.</p>
        </div>

        <div className="flex gap-2">
          {[{ v: 'items' as const, l: 'By items & qty' }, { v: 'progress' as const, l: '% of order (DP / progress)' }].map((m) => (
            <button key={m.v} onClick={() => setKind(m.v)}
              className={`flex-1 px-3 py-2 rounded-xl text-sm font-semibold border transition-colors ${kind === m.v ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'bg-slate-900 text-slate-400 border-slate-700 hover:border-slate-500'}`}>
              {m.l}
            </button>
          ))}
        </div>

        {kind === 'items' ? (
          <div className="rounded-xl border border-slate-800 divide-y divide-slate-800/60">
            {items.map((l) => {
              const done = invoicedQtyByLine[l.item_id] ?? 0;
              const left = Math.max(0, l.quantity - done);
              return (
                <div key={l.item_id} className="flex items-center gap-3 px-3 py-2 text-xs">
                  <span className="text-slate-200 truncate flex-1">{l.description}</span>
                  <span className="text-slate-600 tabular-nums whitespace-nowrap">{fmtInt(done)} / {fmtInt(l.quantity)} billed</span>
                  <input value={qtys[l.item_id] ?? ''} inputMode="decimal"
                    onChange={(e) => setQtys((m) => ({ ...m, [l.item_id]: e.target.value }))}
                    className={`${inpSm} ${num(qtys[l.item_id]) > left ? 'border-amber-500/60' : ''}`} title={`Remaining: ${fmtInt(left)}`} />
                  <span className="text-slate-500 tabular-nums w-24 text-right">@ {fmtInt(l.unit_price)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-end gap-3">
            <div className="w-32">
              <label className="block text-[11px] font-medium text-slate-500 mb-1">% of order total</label>
              <input value={pct} inputMode="decimal" onChange={(e) => setPct(e.target.value)} className={`${inp} text-right tabular-nums`} />
            </div>
            <div className="flex gap-1.5 pb-0.5">
              {[30, 50, 70].map((p) => (
                <button key={p} onClick={() => setPct(String(p))} className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-[11px] font-semibold transition-colors">{p}%</button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Invoice date</label>
            <input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} className={inp} />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Notes</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" className={inp} />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-slate-400">
            Subtotal <span className="tabular-nums text-slate-200">{fmtInt(subtotal)}</span> · incl. PPN{' '}
            <span className="tabular-nums font-bold text-emerald-300">Rp {fmtInt(grand)}</span>
          </p>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-sm transition-colors">Cancel</button>
            <button disabled={busy}
              onClick={() => onSubmit({
                kind, pct: num(pct), issuedAt, notes,
                lines: items.map((l) => ({ so_item_id: l.item_id, description: l.description, unit: l.unit, qty: num(qtys[l.item_id]), unit_price: l.unit_price })),
              })}
              className="px-5 py-2 rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 text-sm font-semibold transition-colors disabled:opacity-50">
              Create Invoice
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── New Delivery Order: warehouse brief + qty per line (remaining prefilled) ──
function DoModal({ items, shippedQtyByLine, contacts, shippingAddress, busy, onClose, onSubmit }: {
  items: SoLine[]; shippedQtyByLine: Record<string, number>; contacts: Contact[]; shippingAddress: string; busy: boolean;
  onClose: () => void;
  onSubmit: (p: { details: { date: string; time: string; method: string; via: string; address: string; mapUrl: string; contact: string }; lines: { so_item_id: string; component_id: string | null; description: string; unit: string; qty: number }[] }) => void;
}) {
  const [qtys, setQtys] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const l of items) m[l.item_id] = String(Math.max(0, l.quantity - (shippedQtyByLine[l.item_id] ?? 0)));
    return m;
  });
  const [d, setD] = useState({ date: today(), time: '', method: 'delivery', via: '', address: shippingAddress, mapUrl: '', contact: '' });
  const set = (k: keyof typeof d, v: string) => setD((x) => ({ ...x, [k]: v }));
  const isPickup = d.method === 'pickup';
  const totalQty = items.reduce((s, l) => s + num(qtys[l.item_id]), 0);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#141518] border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="text-base font-bold text-white">New Delivery Order</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">Prefilled with everything not yet on a DO — trim quantities to split the shipment. Stock moves when this DO is marked delivered.</p>
        </div>

        <div className="rounded-xl border border-slate-800 divide-y divide-slate-800/60">
          {items.map((l) => {
            const shipped = shippedQtyByLine[l.item_id] ?? 0;
            const left = Math.max(0, l.quantity - shipped);
            return (
              <div key={l.item_id} className="flex items-center gap-3 px-3 py-2 text-xs">
                <span className="text-slate-200 truncate flex-1">{l.description}</span>
                <span className="text-slate-600 tabular-nums whitespace-nowrap">{fmtInt(shipped)} / {fmtInt(l.quantity)} on DOs</span>
                <input value={qtys[l.item_id] ?? ''} inputMode="decimal"
                  onChange={(e) => setQtys((m) => ({ ...m, [l.item_id]: e.target.value }))}
                  className={`${inpSm} ${num(qtys[l.item_id]) > left ? 'border-amber-500/60' : ''}`} title={`Remaining: ${fmtInt(left)}`} />
                <span className="text-slate-600 w-10">{l.unit}</span>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Target delivery date</label>
            <input type="date" value={d.date} onChange={(e) => set('date', e.target.value)} className={inp} />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Time of day</label>
            <select value={d.time} onChange={(e) => set('time', e.target.value)} className={inp}>
              <option value="">— Anytime —</option>
              {TIME_OF_DAY.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="col-span-2 flex gap-2">
            {[{ v: 'delivery', l: 'Delivery (we send)' }, { v: 'pickup', l: 'Customer pick-up' }].map((m) => (
              <button key={m.v} onClick={() => set('method', m.v)}
                className={`flex-1 px-3 py-2 rounded-xl text-sm font-semibold border transition-colors ${d.method === m.v ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'bg-slate-900 text-slate-400 border-slate-700 hover:border-slate-500'}`}>
                {m.l}
              </button>
            ))}
          </div>
          {!isPickup && (
            <div className="col-span-2">
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Through / carrier</label>
              <input list="do-via" value={d.via} onChange={(e) => set('via', e.target.value)} placeholder="e.g. Armada sendiri, ekspedisi…" className={inp} />
              <datalist id="do-via">{VIA_SUGGESTIONS.map((v) => <option key={v} value={v} />)}</datalist>
            </div>
          )}
          {!isPickup && (
            <div className="col-span-2">
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Delivery address</label>
              <textarea value={d.address} onChange={(e) => set('address', e.target.value)} rows={2} className={inp} />
            </div>
          )}
          {!isPickup && (
            <div className="col-span-2">
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Google Maps link</label>
              <input value={d.mapUrl} onChange={(e) => set('mapUrl', e.target.value)} placeholder="https://maps.app.goo.gl/…" className={inp} />
            </div>
          )}
          <div className="col-span-2">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Contact person (on site)</label>
            <input list="do-contact" value={d.contact} onChange={(e) => set('contact', e.target.value)}
              placeholder={contacts.length ? 'Pick a customer contact or type one…' : 'Name · phone'} className={inp} />
            <datalist id="do-contact">
              {contacts.map((c) => <option key={`${c.name}-${c.phone}`} value={`${c.name}${c.phone ? ` · ${c.phone}` : ''}`}>{c.title}</option>)}
            </datalist>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-slate-400">Shipping <span className="tabular-nums font-bold text-orange-300">{fmtInt(totalQty)}</span> units on this DO</p>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-sm transition-colors">Cancel</button>
            <button disabled={busy}
              onClick={() => onSubmit({
                details: d,
                lines: items.map((l) => ({ so_item_id: l.item_id, component_id: l.component_id, description: l.description, unit: l.unit, qty: num(qtys[l.item_id]) })),
              })}
              className="px-5 py-2 rounded-xl bg-orange-500/15 text-orange-300 ring-1 ring-orange-500/30 hover:bg-orange-500/25 text-sm font-semibold transition-colors disabled:opacity-50">
              Create Delivery Order
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

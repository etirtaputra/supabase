'use client';
/**
 * ItemCostForensics — the audit trail of one item's cost, extracted from
 * Spend & Cash › Cost Lookup so the Item hub can carry the SAME forensic
 * layer (owner's call, 2026-07-30): the summary strip (Last Price / TUC /
 * Activity), the Linked/Comparable items, and the full breakdown — supplier
 * quote lines, per-PO TUC allocations with the principal/fees/landed split,
 * and the payment & cost records behind each PO.
 *
 * One implementation, rendered wherever the forensics appear (the /items
 * master list's expanded rows and the hub's Buy tab), so the numbers cannot
 * drift between screens. Cost Lookup itself is deliberately left untouched
 * until the owner is comfortable retiring it.
 *
 * TUC semantics are computeTUCMap's; the per-PO allocation shown here is the
 * same arithmetic unrolled so every percentage can be traced by eye.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import type {
  PriceQuote, PriceQuoteLineItem, PurchaseOrder, PurchaseLineItem, POCost, ComponentLink,
} from '@/types/database';
import { PRINCIPAL_CATS, BANK_FEE_CATS, TAX_CATS, BALANCE_CATS } from '@/constants/costCategories';
import { computeTUCMap, fxRateOf, fxAgeDays, FX_STALE_DAYS, type FxRate, type TUCResult } from '@/lib/computeTUC';
import { fmtCcy, fmtDay, fmtIdr, fmtInt } from '@/lib/formatters';
import DealLink from './DealLink';

const COST_LABELS: Record<string, string> = {
  down_payment: 'Down Payment', balance_payment: 'Balance Payment',
  additional_balance_payment: 'Additional Balance', overpayment_credit: 'Overpayment Credit',
  full_amount_bank_fee: 'Bank Fee (Full Amount)', telex_bank_fee: 'Bank Fee (Telex)',
  value_today_bank_fee: 'Bank Fee (Value Today)', admin_bank_fee: 'Bank Fee (Admin)',
  inter_bank_transfer_fee: 'Inter-bank Transfer Fee', local_import_duty: 'Import Duty',
  local_vat: 'Local VAT / PPN', local_income_tax: 'Income Tax (PPh)',
  local_delivery: 'Local Delivery', demurrage_fee: 'Demurrage', penalty_fee: 'Penalty',
  dhl_advance_payment_fee: 'DHL Advance Fee', local_import_tax: 'Import Tax',
};

export interface CompLite {
  component_id: string; supplier_model: string; internal_description: string | null;
  brand?: string | null; category?: string | null;
}

interface Props {
  componentId: string;
  /** Enough of the catalog to name linked items — the full list where available. */
  components: CompLite[];
  quotes: PriceQuote[];
  quoteItems: PriceQuoteLineItem[];
  pos: PurchaseOrder[];
  poItems: PurchaseLineItem[];
  poCosts: POCost[];
  suppliers: { supplier_id: string; supplier_name: string }[];
  componentLinks: ComponentLink[];
  /** Precomputed TUC map (compute once per page); computed here if absent. */
  tucMap?: Map<string, TUCResult>;
  /** FX evidence map — adds the ≈ IDR column (with provenance) to quote lines. */
  fx?: Record<string, FxRate>;
  /** The Last Price / TUC / Activity strip (off where KPIs already say it). */
  showSummary?: boolean;
  /** Start with the full breakdown open instead of behind the toggle. */
  defaultOpen?: boolean;
  /** Show the measured PO→receipt lead-time column on allocations. */
  showLead?: boolean;
}

export default function ItemCostForensics({
  componentId, components, quotes, quoteItems, pos, poItems, poCosts, suppliers, componentLinks,
  tucMap: tucMapIn, fx = {}, showSummary = true, defaultOpen = false, showLead = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  const tucMap = useMemo(
    () => tucMapIn ?? computeTUCMap(pos, poItems, poCosts),
    [tucMapIn, pos, poItems, poCosts]);
  const quoteById = useMemo(() => new Map(quotes.map((q) => [q.quote_id, q])), [quotes]);
  const poById = useMemo(() => new Map(pos.map((p) => [String(p.po_id), p])), [pos]);
  const compById = useMemo(() => new Map(components.map((c) => [c.component_id, c])), [components]);
  const supName = (id?: string | number | null) =>
    suppliers.find((s) => String(s.supplier_id) === String(id))?.supplier_name ?? '—';

  // ── Last quote / last PO price per component (for this item + linked tags) ──
  const lastQuoteByComp = useMemo(() => {
    const m = new Map<string, { price: number; currency: string; date: string }>();
    for (const li of quoteItems) {
      if (!li.component_id || !(Number(li.unit_price) > 0)) continue;
      const q = quoteById.get(li.quote_id);
      if (!q) continue;
      const prev = m.get(li.component_id);
      if (!prev || (q.quote_date ?? '') > prev.date) {
        m.set(li.component_id, { price: Number(li.unit_price), currency: li.currency || q.currency, date: q.quote_date ?? '' });
      }
    }
    return m;
  }, [quoteItems, quoteById]);
  const lastPoByComp = useMemo(() => {
    const m = new Map<string, { price: number; currency: string; date: string }>();
    for (const li of poItems) {
      if (!li.component_id) continue;
      const po = poById.get(String(li.po_id));
      if (!po) continue;
      const prev = m.get(li.component_id);
      if (!prev || (po.po_date ?? '') > prev.date) {
        m.set(li.component_id, { price: Number(li.unit_cost), currency: li.currency || po.currency, date: po.po_date ?? '' });
      }
    }
    return m;
  }, [poItems, poById]);

  const tuc = tucMap.get(componentId);
  const lq = lastQuoteByComp.get(componentId);
  const lpo = lastPoByComp.get(componentId);
  const showLq = lq && (!lpo || lq.date >= lpo.date);

  // Quote-over-quote movement: last vs second-to-last DISTINCT quote (one
  // price per quote, first non-zero line seen — Cost Lookup's dedupe, so a
  // multi-line quote can't fake a delta against itself).
  const quoteDelta = useMemo(() => {
    const seen = new Set<number>();
    const entries: { price: number; date: string; quoteId: number }[] = [];
    for (const li of quoteItems) {
      if (li.component_id !== componentId || !(Number(li.unit_price) > 0) || seen.has(li.quote_id)) continue;
      seen.add(li.quote_id);
      const q = quoteById.get(li.quote_id);
      if (q) entries.push({ price: Number(li.unit_price), date: q.quote_date ?? '', quoteId: li.quote_id });
    }
    entries.sort((a, b) => a.date.localeCompare(b.date) || a.quoteId - b.quoteId);
    const last = entries[entries.length - 1], prev = entries[entries.length - 2];
    return last && prev && prev.price > 0 ? ((last.price - prev.price) / prev.price) * 100 : null;
  }, [quoteItems, quoteById, componentId]);

  // ── This item's rows ───────────────────────────────────────────────────────
  const myQItems = useMemo(
    () => quoteItems.filter((qi) => qi.component_id === componentId)
      .sort((a, b) => (quoteById.get(b.quote_id)?.quote_date ?? '').localeCompare(quoteById.get(a.quote_id)?.quote_date ?? '')),
    [quoteItems, quoteById, componentId]);
  const myPItems = useMemo(() => poItems.filter((pi) => pi.component_id === componentId), [poItems, componentId]);

  // Per-PO allocation — computeTUCMap's arithmetic, unrolled per line so every
  // percentage is visible: line share × (principal + fees + landed) ÷ qty.
  const allocs = useMemo(() => myPItems.map((item) => {
    const po = poById.get(String(item.po_id));
    if (!po) return null;
    const siblings = poItems.filter((i) => String(i.po_id) === String(item.po_id) && i.quantity > 0);
    const totalForeign = siblings.reduce((s, i) => s + i.unit_cost * i.quantity, 0);
    const lineShare = totalForeign > 0 ? (item.unit_cost * item.quantity) / totalForeign : 0;
    const costs = poCosts.filter((c) => String(c.po_id) === String(item.po_id));
    const hasBalance = costs.some((c) => BALANCE_CATS.has(c.cost_category));
    const toIdr = (c: POCost) => c.currency === 'IDR'
      ? Number(c.amount)
      : Number(c.amount) * (Number(c.exchange_rate) || Number(po.exchange_rate) || 1);
    const principal = costs.filter((c) => PRINCIPAL_CATS.has(c.cost_category)).reduce((s, c) => s + toIdr(c), 0);
    const bankFees = costs.filter((c) => BANK_FEE_CATS.has(c.cost_category)).reduce((s, c) => s + toIdr(c), 0);
    const landed = costs.filter((c) => !PRINCIPAL_CATS.has(c.cost_category) && !BANK_FEE_CATS.has(c.cost_category) && !TAX_CATS.has(c.cost_category)).reduce((s, c) => s + toIdr(c), 0);
    const allocP = lineShare * principal, allocB = lineShare * bankFees, allocL = lineShare * landed;
    const total = allocP + allocB + allocL;
    const lead = po.actual_received_date && po.po_date
      ? Math.round((new Date(po.actual_received_date).getTime() - new Date(po.po_date).getTime()) / 86_400_000)
      : null;
    return {
      item, po, lineShare, allocP, allocB, allocL, total, hasBalance, lead,
      tuc: item.quantity > 0 ? total / item.quantity : 0,
    };
  }).filter((a): a is NonNullable<typeof a> => !!a)
    .sort((a, b) => (b.po.po_date ?? '').localeCompare(a.po.po_date ?? '')),
  [myPItems, poItems, poCosts, poById]);

  // Payment & cost records, grouped per PO this item sits on
  const poGroups = useMemo(() => {
    const ids = [...new Set(myPItems.map((i) => String(i.po_id)))]
      .sort((a, b) => (poById.get(b)?.po_date ?? '').localeCompare(poById.get(a)?.po_date ?? ''));
    return ids.flatMap((poId) => {
      const po = poById.get(poId);
      if (!po) return [];
      const costs = poCosts.filter((c) => String(c.po_id) === poId);
      if (!costs.length) return [];
      const hasBalance = costs.some((c) => BALANCE_CATS.has(c.cost_category));
      const toIdr = (c: POCost) => c.currency === 'IDR'
        ? Number(c.amount)
        : Number(c.amount) * (Number(c.exchange_rate) || Number(po.exchange_rate) || 1);
      const sub: Record<string, number> = {};
      costs.filter((c) => !TAX_CATS.has(c.cost_category)).forEach((c) => { sub[c.currency] = (sub[c.currency] || 0) + Number(c.amount); });
      return [{
        po, costs, hasBalance, sub,
        principalIdr: costs.filter((c) => PRINCIPAL_CATS.has(c.cost_category)).reduce((s, c) => s + toIdr(c), 0),
        bankFeesIdr: costs.filter((c) => BANK_FEE_CATS.has(c.cost_category)).reduce((s, c) => s + toIdr(c), 0),
        landedIdr: costs.filter((c) => !PRINCIPAL_CATS.has(c.cost_category) && !BANK_FEE_CATS.has(c.cost_category) && !TAX_CATS.has(c.cost_category)).reduce((s, c) => s + toIdr(c), 0),
      }];
    });
  }, [myPItems, poCosts, poById]);

  // ── Linked / comparable items (8.0) — both directions ─────────────────────
  const linked = useMemo(() => {
    const out: { comp: CompLite; linkType: string; normUnit?: string | null; normSelf?: number | null; normOther?: number | null }[] = [];
    for (const link of componentLinks) {
      const addLink = (selfId: string, otherId: string, isA: boolean) => {
        if (selfId !== componentId) return;
        const other = compById.get(otherId);
        if (!other) return;
        out.push({
          comp: other, linkType: link.link_type, normUnit: link.normalization_unit,
          normSelf: isA ? link.norm_value_a : link.norm_value_b,
          normOther: isA ? link.norm_value_b : link.norm_value_a,
        });
      };
      addLink(link.component_id_a, link.component_id_b, true);
      addLink(link.component_id_b, link.component_id_a, false);
    }
    return out;
  }, [componentLinks, compById, componentId]);

  const usage = useMemo(() => ({
    quotes: new Set(myQItems.map((i) => i.quote_id)).size,
    pos: new Set(myPItems.map((i) => String(i.po_id))).size,
  }), [myQItems, myPItems]);

  const nothing = usage.quotes === 0 && usage.pos === 0 && linked.length === 0;

  return (
    <div className="space-y-3">
      {/* ── Summary strip: Last Price · TUC · Activity ── */}
      {showSummary && (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">Last Price</p>
            {tuc ? (
              <div>
                <p className="text-sm font-semibold text-slate-200 tabular-nums">{fmtIdr(tuc.tuc)}</p>
                <p className="text-[10px] text-slate-600 mt-0.5">{fmtDay(tuc.latestPoDate)} <span className="text-amber-600/70 font-medium">TUC</span></p>
              </div>
            ) : showLq ? (
              <div>
                <p className="text-sm font-semibold text-slate-200 tabular-nums">{fmtCcy(lq!.price, lq!.currency)}</p>
                <p className="text-[10px] text-slate-600 mt-0.5">
                  {fmtDay(lq!.date)} <span className="text-emerald-600/70 font-medium">Quote</span>
                  {quoteDelta != null && (
                    <span className={`ml-1.5 font-semibold tabular-nums ${quoteDelta > 0 ? 'text-rose-400' : 'text-emerald-400'}`}
                      title="vs the previous supplier quote">
                      {quoteDelta > 0 ? '▲' : '▼'} {Math.abs(quoteDelta).toFixed(1)}%
                    </span>
                  )}
                </p>
              </div>
            ) : lpo ? (
              <div>
                <p className="text-sm font-semibold text-slate-200 tabular-nums">{fmtCcy(lpo.price, lpo.currency)}</p>
                <p className="text-[10px] text-slate-600 mt-0.5">{fmtDay(lpo.date)} <span className="text-sky-600/70 font-medium">PO</span></p>
              </div>
            ) : <p className="text-sm text-slate-700">—</p>}
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">TUC</p>
            {tuc ? (
              <div>
                <p className="text-sm font-semibold text-amber-400 tabular-nums">{fmtIdr(tuc.tuc)}</p>
                {tuc.latestXr ? <p className="text-[10px] text-slate-600 mt-0.5 tabular-nums">≈ {fmtCcy(tuc.tuc / tuc.latestXr, 'USD')}</p> : null}
              </div>
            ) : <p className="text-sm text-slate-700">—</p>}
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">Activity</p>
            <div className="flex flex-wrap gap-1.5 mt-0.5">
              {usage.quotes > 0 && <span className="text-[11px] text-emerald-400/80 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded font-medium">{usage.quotes}Q</span>}
              {usage.pos > 0 && <span className="text-[11px] text-sky-400/80 bg-sky-500/10 border border-sky-500/20 px-1.5 py-0.5 rounded font-medium">{usage.pos}PO</span>}
              {!usage.quotes && !usage.pos && <span className="text-sm text-slate-700">—</span>}
            </div>
          </div>
        </div>
      )}

      {nothing && <p className="text-[11px] text-slate-600 italic">No supplier quotes, purchase orders or linked items yet.</p>}

      {/* ── Linked / Comparable ── */}
      {linked.length > 0 && (
        <div className={showSummary ? 'pt-3 border-t border-slate-800/60' : ''}>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">Linked / Comparable ({linked.length})</p>
          <div className="flex flex-wrap gap-2">
            {linked.map(({ comp: lComp, linkType, normUnit, normSelf, normOther }) => {
              const lTuc = tucMap.get(lComp.component_id);
              const lLq = lastQuoteByComp.get(lComp.component_id);
              const lLpo = lastPoByComp.get(lComp.component_id);
              const lPrice = lTuc
                ? { txt: fmtIdr(lTuc.tuc), tag: 'TUC', cls: 'text-amber-500/70' }
                : lLq ? { txt: fmtCcy(lLq.price, lLq.currency), tag: 'Q', cls: 'text-emerald-500/70' }
                : lLpo ? { txt: fmtCcy(lLpo.price, lLpo.currency), tag: 'PO', cls: 'text-sky-500/70' }
                : null;
              return (
                <Link key={lComp.component_id} href={`/items/${lComp.component_id}`}
                  className="flex items-start gap-2 text-left bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-slate-600 rounded-xl px-3 py-2 transition-colors group min-w-0 max-w-[260px]">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-slate-300 group-hover:text-white font-medium truncate leading-tight">
                      {lComp.internal_description || lComp.supplier_model}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {lPrice && (
                        <span className="text-[11px] tabular-nums text-slate-400 font-semibold whitespace-nowrap">
                          {lPrice.txt}
                          <span className={`ml-1 text-[9px] font-bold ${lPrice.cls}`}>{lPrice.tag}</span>
                        </span>
                      )}
                      {normUnit && normSelf != null && normOther != null && (
                        <span className="text-[10px] text-slate-600 whitespace-nowrap">{normSelf}{normUnit} → {normOther}{normUnit}</span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-600 capitalize">{linkType.replace(/_/g, ' ')}</span>
                  </div>
                  <svg className="w-3 h-3 text-slate-600 group-hover:text-slate-400 flex-shrink-0 mt-0.5 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Toggle for the deep tables ── */}
      {(usage.quotes > 0 || usage.pos > 0) && !defaultOpen && (
        <button onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center justify-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 py-1.5 border border-slate-800 hover:border-slate-700 rounded-lg transition-colors">
          <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
          {open ? 'Hide' : 'Show'} full cost breakdown
        </button>
      )}

      {open && (
        <div className="space-y-5">
          {/* Quote lines */}
          {myQItems.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400/70 mb-2">Quote Lines ({myQItems.length})</p>
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full text-xs min-w-[560px]">
                  <thead className="bg-slate-900 text-slate-500 text-[10px] uppercase tracking-widest">
                    <tr>
                      <th className="px-3 py-2 text-left">Quote / PI</th>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Supplier</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Unit Price</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2 text-right" title="Converted at the newest FX evidence — a rate committed on a live PO beats an older settled one">≈ IDR</th>
                      <th className="px-3 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {myQItems.map((qi) => {
                      const qt = quoteById.get(qi.quote_id);
                      const cur = qi.currency || qt?.currency || 'IDR';
                      const rate = cur === 'IDR' ? 1 : fxRateOf(fx, cur);
                      const obs = fx[cur];
                      const stale = cur !== 'IDR' && (obs ? fxAgeDays(fx, cur) > FX_STALE_DAYS : true);
                      return (
                        <tr key={qi.quote_line_id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="px-3 py-2 text-emerald-400/90 font-mono">{qt?.pi_number ? <DealLink number={qt.pi_number} className="hover:text-emerald-300" /> : `#${qi.quote_id}`}</td>
                          <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{fmtDay(qt?.quote_date)}</td>
                          <td className="px-3 py-2 text-slate-300 truncate max-w-[160px]">{supName(qt?.supplier_id)}</td>
                          <td className="px-3 py-2 text-right text-white font-semibold tabular-nums">{fmtInt(qi.quantity)}</td>
                          <td className="px-3 py-2 text-right text-slate-200 tabular-nums whitespace-nowrap">{fmtCcy(qi.unit_price, cur)}</td>
                          <td className="px-3 py-2 text-right text-emerald-400 font-semibold tabular-nums whitespace-nowrap">{fmtCcy(qi.quantity * qi.unit_price, cur)}</td>
                          <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap"
                            title={cur === 'IDR' ? undefined
                              : `@ ${fmtInt(rate)} — ${obs ? `${obs.source === 'settled' ? 'settled payment' : obs.label} · ${obs.date}` : 'no purchase history — fallback rate'}`}>
                            <span className={stale ? 'text-amber-300' : 'text-slate-300'}>{fmtIdr(qi.unit_price * rate)}</span>
                            {stale && <span className="block text-[9px] text-amber-500/80">stale FX</span>}
                          </td>
                          <td className="px-3 py-2">
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                              qt?.status === 'Accepted' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : qt?.status === 'Rejected' || qt?.status === 'Expired' ? 'bg-red-500/10 text-red-400 border-red-500/20'
                              : 'bg-slate-700 text-slate-400 border-slate-600'}`}>
                              {qt?.status ?? '—'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* PO allocations */}
          {allocs.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400/70 mb-2">PO Lines · True Unit Cost ({allocs.length})</p>
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full text-xs min-w-[680px]">
                  <thead className="bg-slate-900 text-slate-500 text-[10px] uppercase tracking-widest">
                    <tr>
                      <th className="px-3 py-2 text-left">PO #</th>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Unit Cost</th>
                      <th className="px-3 py-2 text-right">Line Share</th>
                      <th className="px-3 py-2 text-right text-amber-400/70">True Unit Cost</th>
                      {showLead && <th className="px-3 py-2 text-right" title="PO date → actual goods receipt">Lead</th>}
                      <th className="px-3 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {allocs.map((a) => (
                      <tr key={a.item.po_line_item_id} className={`hover:bg-slate-800/30 transition-colors ${!a.hasBalance ? 'opacity-60' : ''}`}>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {a.po.po_number ? <DealLink number={a.po.po_number} className="text-sky-400 hover:text-sky-300 font-mono" /> : <span className="text-sky-400 font-mono">{`PO ${a.po.po_id}`}</span>}
                        </td>
                        <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{fmtDay(a.po.po_date)}</td>
                        <td className="px-3 py-2 text-right text-white font-semibold tabular-nums">{fmtInt(a.item.quantity)}</td>
                        <td className="px-3 py-2 text-right text-slate-200 tabular-nums whitespace-nowrap">{fmtCcy(a.item.unit_cost, a.item.currency || a.po.currency)}</td>
                        <td className="px-3 py-2 text-right text-slate-400 tabular-nums">{(a.lineShare * 100).toFixed(1)}%</td>
                        {a.hasBalance && a.tuc > 0 ? (
                          <td className="px-3 py-2 text-right bg-amber-500/5">
                            <p className="text-amber-400 font-bold tabular-nums whitespace-nowrap">{fmtIdr(a.tuc)}</p>
                            {a.total > 0 && (a.allocB > 0 || a.allocL > 0) && (
                              <p className="text-[9px] tabular-nums mt-0.5 whitespace-nowrap">
                                <span className="text-sky-400">{((a.allocP / a.total) * 100).toFixed(0)}%</span>
                                <span className="text-slate-600"> base</span>
                                {a.allocB > 0 && <><span className="text-slate-600"> · </span><span className="text-purple-400">+{((a.allocB / a.total) * 100).toFixed(0)}%</span><span className="text-slate-600"> fees</span></>}
                                {a.allocL > 0 && <><span className="text-slate-600"> · </span><span className="text-orange-400">+{((a.allocL / a.total) * 100).toFixed(0)}%</span><span className="text-slate-600"> landed</span></>}
                              </p>
                            )}
                          </td>
                        ) : (
                          <td className="px-3 py-2 text-right text-slate-700 italic text-[10px]">balance unpaid</td>
                        )}
                        {showLead && <td className="px-3 py-2 text-right text-slate-400 tabular-nums">{a.lead != null ? `${a.lead}d` : <span className="text-slate-700">—</span>}</td>}
                        <td className="px-3 py-2">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border whitespace-nowrap ${
                            a.po.status === 'Fully Received' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : a.po.status === 'Partially Received' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                            : 'bg-slate-700 text-slate-400 border-slate-600'}`}>
                            {a.po.status ?? '—'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Payment & cost records per PO */}
          {poGroups.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-rose-400/70 mb-2">
                Payment &amp; Cost Records ({poGroups.reduce((s, g) => s + g.costs.length, 0)})
              </p>
              <div className="space-y-3">
                {poGroups.map((g) => (
                  <div key={String(g.po.po_id)} className="rounded-xl border border-slate-800 overflow-hidden">
                    <div className="bg-slate-900 px-4 py-2.5 flex items-center gap-3 flex-wrap">
                      <span className="text-sky-400 font-mono text-xs font-semibold"><DealLink number={g.po.po_number} className="hover:text-sky-300" /></span>
                      {g.po.pi_number && <span className="text-violet-400 font-mono text-[10px]">PI: <DealLink number={g.po.pi_number} className="hover:text-violet-300" /></span>}
                      <span className="text-slate-500 text-[11px]">{fmtDay(g.po.po_date)}</span>
                      <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full border ${g.hasBalance ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>
                        {g.hasBalance ? 'Balance Paid' : 'Balance Unpaid'}
                      </span>
                    </div>
                    {(() => {
                      const total = g.principalIdr + g.bankFeesIdr + g.landedIdr;
                      if (total <= 0 || (!g.bankFeesIdr && !g.landedIdr)) return null;
                      const pctFees = (g.bankFeesIdr / total) * 100;
                      const pctLanded = (g.landedIdr / total) * 100;
                      const pctBase = 100 - pctFees - pctLanded;
                      return (
                        <div className="px-4 py-2.5 border-b border-slate-800/40 bg-slate-950/30 space-y-1.5">
                          <div className="h-1.5 rounded-full overflow-hidden flex">
                            <div className="h-full bg-sky-500/60" style={{ width: `${pctBase}%` }} />
                            {pctFees > 0 && <div className="h-full bg-purple-500/60" style={{ width: `${pctFees}%` }} />}
                            {pctLanded > 0 && <div className="h-full bg-orange-500/60" style={{ width: `${pctLanded}%` }} />}
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                            <span><span className="text-sky-400">●</span> <span className="text-slate-500">Principal</span> <span className="tabular-nums text-slate-300 font-semibold">{fmtIdr(g.principalIdr)}</span> <span className="text-sky-400 font-semibold">({pctBase.toFixed(1)}%)</span></span>
                            {g.bankFeesIdr > 0 && <span><span className="text-purple-400">●</span> <span className="text-slate-500">Bank fees</span> <span className="tabular-nums text-slate-300 font-semibold">{fmtIdr(g.bankFeesIdr)}</span> <span className="text-purple-400 font-semibold">(+{pctFees.toFixed(1)}%)</span></span>}
                            {g.landedIdr > 0 && <span><span className="text-orange-400">●</span> <span className="text-slate-500">Landed</span> <span className="tabular-nums text-slate-300 font-semibold">{fmtIdr(g.landedIdr)}</span> <span className="text-orange-400 font-semibold">(+{pctLanded.toFixed(1)}%)</span></span>}
                          </div>
                        </div>
                      );
                    })()}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs min-w-[420px]">
                        <tbody className="divide-y divide-slate-800/40">
                          {g.costs.map((cost) => {
                            const isTax = TAX_CATS.has(cost.cost_category);
                            const isPayment = PRINCIPAL_CATS.has(cost.cost_category);
                            const isFee = BANK_FEE_CATS.has(cost.cost_category);
                            return (
                              <tr key={cost.cost_id} className={`hover:bg-slate-800/30 ${isTax ? 'opacity-40' : ''}`}>
                                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fmtDay(cost.payment_date)}</td>
                                <td className="px-3 py-2 text-slate-300">{COST_LABELS[cost.cost_category] ?? cost.cost_category}</td>
                                <td className="px-3 py-2">
                                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                                    isPayment ? 'bg-sky-500/10 text-sky-400 border-sky-500/20'
                                    : isFee ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                                    : isTax ? 'bg-slate-800 text-slate-600 border-slate-700'
                                    : 'bg-orange-500/10 text-orange-400 border-orange-500/20'}`}>
                                    {isPayment ? 'Payment' : isFee ? 'Fee' : isTax ? 'Tax' : 'Landed'}
                                  </span>
                                </td>
                                <td className={`px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap ${isTax ? 'text-slate-600' : 'text-rose-400'}`}>
                                  {fmtCcy(Number(cost.amount), cost.currency)}
                                </td>
                                <td className="px-3 py-2 text-slate-600 truncate max-w-[160px]">{cost.notes || ''}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        {Object.keys(g.sub).length > 0 && (
                          <tfoot>
                            <tr className="bg-slate-900 border-t border-slate-700">
                              <td colSpan={2} className="px-3 py-2 text-[10px] uppercase tracking-widest text-slate-500 font-bold">Subtotal (excl. tax)</td>
                              <td />
                              <td className="px-3 py-2 text-right text-rose-300 font-bold tabular-nums whitespace-nowrap">
                                {Object.entries(g.sub).map(([cur, amt]) => fmtCcy(amt, cur)).join(' · ')}
                              </td>
                              <td />
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

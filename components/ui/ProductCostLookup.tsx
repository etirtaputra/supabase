'use client';
import { useState, useMemo, useCallback } from 'react';
import type {
  Component, PriceQuote, PriceQuoteLineItem,
  PurchaseOrder, PurchaseLineItem, POCost, Supplier, ComponentLink,
} from '@/types/database';
import { PRINCIPAL_CATS, BANK_FEE_CATS, TAX_CATS, BALANCE_CATS } from '@/constants/costCategories';
import { fmtIdr, fmtNum } from '@/lib/formatters';

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

const fmtAmt = (n: number, cur: string) =>
  `${cur} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d?: string) => d
  ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
  : '';

function hl(text: string | null | undefined, q: string): React.ReactNode {
  if (!text) return '—';
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  return <>{text.slice(0, idx)}<mark className="bg-sky-500/30 text-sky-200 rounded-sm not-italic">{text.slice(idx, idx + q.length)}</mark>{text.slice(idx + q.length)}</>;
}

interface Props {
  components: Component[];
  quotes: PriceQuote[];
  quoteItems: PriceQuoteLineItem[];
  pos: PurchaseOrder[];
  poItems: PurchaseLineItem[];
  poCosts: POCost[];
  suppliers: Supplier[];
  componentLinks: ComponentLink[];
  isLoading: boolean;
}

export default function ProductCostLookup({
  components, quotes, quoteItems, pos, poItems, poCosts, suppliers, componentLinks, isLoading,
}: Props) {
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ── Bulk: last quote price per component ────────────────────────────────────────────────────────────────────────
  const lastQuoteByComp = useMemo(() => {
    const qMap = new Map(quotes.map((q) => [q.quote_id, q]));
    // Deduplicate: one price per (component, quote_id), first non-zero price seen.
    // Prevents same-day / multi-line-item quotes from producing false deltas.
    const byComp = new Map<string, { price: number; currency: string; date: string; quoteId: number }[]>();
    const seen = new Map<string, Set<number>>();
    quoteItems.forEach((item) => {
      if (!item.component_id || item.unit_price <= 0) return;
      const q = qMap.get(item.quote_id);
      if (!q) return;
      const cid = item.component_id;
      if (!seen.has(cid)) seen.set(cid, new Set());
      if (seen.get(cid)!.has(item.quote_id)) return;
      seen.get(cid)!.add(item.quote_id);
      if (!byComp.has(cid)) byComp.set(cid, []);
      byComp.get(cid)!.push({ price: item.unit_price, currency: item.currency, date: q.quote_date, quoteId: item.quote_id });
    });
    // Sort by (date, quote_id) ascending; prevPrice = second-to-last unique quote.
    const map = new Map<string, { price: number; currency: string; date: string; prevPrice?: number }>();
    byComp.forEach((entries, cid) => {
      const sorted = entries.sort((a, b) => {
        const d = a.date.localeCompare(b.date);
        return d !== 0 ? d : a.quoteId - b.quoteId;
      });
      const last = sorted[sorted.length - 1];
      const prev = sorted.length >= 2 ? sorted[sorted.length - 2] : null;
      map.set(cid, { price: last.price, currency: last.currency, date: last.date, prevPrice: prev?.price });
    });
    return map;
  }, [quoteItems, quotes]);

  // ── Bulk: last PO unit cost per component ────────────────────────────────────────────────────────────────────────
  const lastPoByComp = useMemo(() => {
    const poMap = new Map(pos.map((p) => [p.po_id, p]));
    const map = new Map<string, { price: number; currency: string; date: string }>();
    poItems.forEach((item) => {
      if (!item.component_id) return;
      const po = poMap.get(item.po_id);
      if (!po) return;
      const ex = map.get(item.component_id);
      if (!ex || po.po_date > ex.date) {
        map.set(item.component_id, { price: item.unit_cost, currency: item.currency, date: po.po_date });
      }
    });
    return map;
  }, [poItems, pos]);

  // ── Bulk TUC per component ───────────────────────────────────────────────────────────────────────────────────────
  const tucByComp = useMemo(() => {
    const poMap = new Map(pos.map((p) => [String(p.po_id), p]));
    const itemsByPo = new Map<string, PurchaseLineItem[]>();
    poItems.forEach((i) => {
      const k = String(i.po_id);
      if (!itemsByPo.has(k)) itemsByPo.set(k, []);
      itemsByPo.get(k)!.push(i);
    });
    const costsByPo = new Map<string, POCost[]>();
    poCosts.forEach((c) => {
      const k = String(c.po_id);
      if (!costsByPo.has(k)) costsByPo.set(k, []);
      costsByPo.get(k)!.push(c);
    });
    // per-component accumulators
    type Acc = { wSum: number; wQty: number; latestDate: string; latestTuc: number; latestXr: number | null };
    const acc = new Map<string, Acc>();
    poItems.forEach((item) => {
      if (!item.component_id || item.quantity <= 0) return;
      const k = String(item.po_id);
      const po = poMap.get(k);
      if (!po) return;
      const costs = costsByPo.get(k) ?? [];
      const hasBalance = costs.some((c) => BALANCE_CATS.has(c.cost_category));
      if (!hasBalance) return;
      const siblings = itemsByPo.get(k) ?? [];
      const totalForeign = siblings.reduce((s, i) => s + i.unit_cost * i.quantity, 0);
      if (totalForeign <= 0) return;
      const share = (item.unit_cost * item.quantity) / totalForeign;
      const toIdr = (c: POCost) => c.currency === 'IDR'
        ? Number(c.amount)
        : Number(c.amount) * (Number(c.exchange_rate) || Number(po.exchange_rate) || 1);
      const principal = costs.filter((c) => PRINCIPAL_CATS.has(c.cost_category)).reduce((s, c) => s + toIdr(c), 0);
      const bankFees  = costs.filter((c) => BANK_FEE_CATS.has(c.cost_category)).reduce((s, c) => s + toIdr(c), 0);
      const landed    = costs.filter((c) => !PRINCIPAL_CATS.has(c.cost_category) && !BANK_FEE_CATS.has(c.cost_category) && !TAX_CATS.has(c.cost_category)).reduce((s, c) => s + toIdr(c), 0);
      const tuc = (share * (principal + bankFees + landed)) / item.quantity;
      if (tuc <= 0) return;
      const xr = Number(po.exchange_rate) || null;
      const cid = item.component_id;
      if (!acc.has(cid)) acc.set(cid, { wSum: 0, wQty: 0, latestDate: '', latestTuc: 0, latestXr: null });
      const a = acc.get(cid)!;
      a.wSum += tuc * item.quantity; a.wQty += item.quantity;
      if (po.po_date > a.latestDate) { a.latestDate = po.po_date; a.latestTuc = tuc; a.latestXr = xr; }
    });
    const result = new Map<string, { actualTucIdr: number; latestPoDate: string; tucXr: number | null }>();
    acc.forEach((a, cid) => {
      if (a.wQty <= 0) return;
      result.set(cid, { actualTucIdr: Math.max(a.latestTuc, a.wSum / a.wQty), latestPoDate: a.latestDate, tucXr: a.latestXr });
    });
    return result;
  }, [poItems, pos, poCosts]);

  // ── Usage counts per component ───────────────────────────────────────────────────────────────────────────────────
  const usageByComp = useMemo(() => {
    const map = new Map<string, { quotes: number; pos: number }>();
    quoteItems.forEach((i) => {
      if (!i.component_id) return;
      if (!map.has(i.component_id)) map.set(i.component_id, { quotes: 0, pos: 0 });
      map.get(i.component_id)!.quotes++;
    });
    poItems.forEach((i) => {
      if (!i.component_id) return;
      if (!map.has(i.component_id)) map.set(i.component_id, { quotes: 0, pos: 0 });
      map.get(i.component_id)!.pos++;
    });
    return map;
  }, [quoteItems, poItems]);

  // ── Linked components map ───────────────────────────────────────────────────────────────────────────────────────
  const linkedByComp = useMemo(() => {
    const compMap = new Map(components.map((c) => [c.component_id, c]));
    const map = new Map<string, { comp: Component; linkType: string; normUnit?: string | null; normSelf?: number | null; normOther?: number | null }[]>();
    componentLinks.forEach((link) => {
      const addLink = (selfId: string, otherId: string, isA: boolean) => {
        const other = compMap.get(otherId);
        if (!other) return;
        if (!map.has(selfId)) map.set(selfId, []);
        map.get(selfId)!.push({
          comp: other,
          linkType: link.link_type,
          normUnit: link.normalization_unit,
          normSelf:  isA ? link.norm_value_a : link.norm_value_b,
          normOther: isA ? link.norm_value_b : link.norm_value_a,
        });
      };
      addLink(link.component_id_a, link.component_id_b, true);
      addLink(link.component_id_b, link.component_id_a, false);
    });
    return map;
  }, [componentLinks, components]);

  // ── Search results ───────────────────────────────────────────────────────────────────────────────────────────
  const results = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return components
      .filter((c) =>
        c.supplier_model?.toLowerCase().includes(q) ||
        c.internal_description?.toLowerCase().includes(q) ||
        c.brand?.toLowerCase().includes(q) ||
        c.category?.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        const score = (c: Component) => {
          const m = c.supplier_model?.toLowerCase() ?? '';
          const d = c.internal_description?.toLowerCase() ?? '';
          if (m.startsWith(q) || d.startsWith(q)) return 0;
          if (m.includes(q) || d.includes(q)) return 1;
          return 2;
        };
        return score(a) - score(b);
      })
      .slice(0, 20);
  }, [query, components]);

  // ── Detailed allocations for expanded component ──────────────────────────────────────────────────────────────────────────
  const expandedDetail = useMemo(() => {
    if (!expandedId) return null;
    const myQItems = [...quoteItems.filter((qi) => qi.component_id === expandedId)]
      .sort((a, b) => {
        const da = quotes.find((q) => q.quote_id === a.quote_id)?.quote_date ?? '';
        const db = quotes.find((q) => q.quote_id === b.quote_id)?.quote_date ?? '';
        return db.localeCompare(da);
      });
    const myPItems = poItems.filter((pi) => pi.component_id === expandedId);
    const qMap = new Map(quotes.map((q) => [q.quote_id, q]));
    const allocs = myPItems.map((item) => {
      const po = pos.find((p) => p.po_id === item.po_id);
      if (!po) return null;
      const siblings = poItems.filter((i) => i.po_id === item.po_id && i.quantity > 0);
      const totalForeign = siblings.reduce((s, i) => s + i.unit_cost * i.quantity, 0);
      const lineShare = totalForeign > 0 ? (item.unit_cost * item.quantity) / totalForeign : 0;
      const costs = poCosts.filter((c) => c.po_id === item.po_id);
      const hasBalance = costs.some((c) => BALANCE_CATS.has(c.cost_category));
      const toIdr = (c: POCost) => c.currency === 'IDR'
        ? Number(c.amount)
        : Number(c.amount) * (Number(c.exchange_rate) || Number(po.exchange_rate) || 1);
      const principal = costs.filter((c) => PRINCIPAL_CATS.has(c.cost_category)).reduce((s, c) => s + toIdr(c), 0);
      const bankFees  = costs.filter((c) => BANK_FEE_CATS.has(c.cost_category)).reduce((s, c) => s + toIdr(c), 0);
      const landed    = costs.filter((c) => !PRINCIPAL_CATS.has(c.cost_category) && !BANK_FEE_CATS.has(c.cost_category) && !TAX_CATS.has(c.cost_category)).reduce((s, c) => s + toIdr(c), 0);
      const allocP = lineShare * principal, allocB = lineShare * bankFees, allocL = lineShare * landed;
      const tuc = item.quantity > 0 ? (allocP + allocB + allocL) / item.quantity : 0;
      return { item, po, lineShare, allocPrincipal: allocP, allocBankFees: allocB, allocLanded: allocL,
               totalAllocated: allocP + allocB + allocL, trueUnitCostIdr: tuc, hasBalance, principal, bankFees, landed };
    }).filter(Boolean).sort((a, b) => b!.po.po_date.localeCompare(a!.po.po_date)) as NonNullable<ReturnType<typeof Array.prototype.map>[0]>[];

    // PO cost groups
    const poIdSet = new Set(myPItems.map((i) => i.po_id));
    const poGroups = [...poIdSet].sort((a, b) => {
      const da = pos.find((p) => p.po_id === a)?.po_date ?? '';
      const db = pos.find((p) => p.po_id === b)?.po_date ?? '';
      return db.localeCompare(da);
    }).flatMap((poId) => {
      const po = pos.find((p) => p.po_id === poId);
      if (!po) return [];
      const costs = poCosts.filter((c) => c.po_id === poId);
      const hasBalance = costs.some((c) => BALANCE_CATS.has(c.cost_category));
      const toIdrG = (c: POCost) => c.currency === 'IDR'
        ? Number(c.amount)
        : Number(c.amount) * (Number(c.exchange_rate) || Number(po.exchange_rate) || 1);
      const sub: Record<string, number> = {};
      costs.filter((c) => !TAX_CATS.has(c.cost_category)).forEach((c) => { sub[c.currency] = (sub[c.currency] || 0) + Number(c.amount); });
      return [{ po, costs, hasBalance, sub,
        principalIdr: costs.filter((c) => PRINCIPAL_CATS.has(c.cost_category)).reduce((s, c) => s + toIdrG(c), 0),
        bankFeesIdr:  costs.filter((c) => BANK_FEE_CATS.has(c.cost_category)).reduce((s, c) => s + toIdrG(c), 0),
        landedIdr:    costs.filter((c) => !PRINCIPAL_CATS.has(c.cost_category) && !BANK_FEE_CATS.has(c.cost_category) && !TAX_CATS.has(c.cost_category)).reduce((s, c) => s + toIdrG(c), 0),
      }];
    });

    return { myQItems, allocs, poGroups, qMap };
  }, [expandedId, quoteItems, quotes, poItems, pos, poCosts]);

  const getSupplier = useCallback((id?: string | number) =>
    suppliers.find((s) => String(s.supplier_id) === String(id))?.supplier_name ?? '—',
  [suppliers]);

  const toggleExpand = (id: string) => setExpandedId((prev) => prev === id ? null : id);
  const jumpTo = (c: Component) => { setQuery(c.internal_description || c.supplier_model); setExpandedId(null); };

  if (isLoading) return (
    <div className="flex items-center justify-center py-20 text-slate-500 text-sm gap-2">
      <div className="w-4 h-4 border-2 border-slate-600 border-t-slate-400 rounded-full animate-spin" />
      Loading…
    </div>
  );

  return (
    <div className="space-y-4 max-w-5xl">

      {/* ── Search bar ── */}
      <div className="relative">
        <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setExpandedId(null); }}
          placeholder="Search components by name, model, brand or category…"
          className="w-full bg-slate-900/80 border border-slate-700 rounded-2xl px-4 py-3.5 pl-12 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all text-sm"
          autoFocus
        />
        {query && (
          <button onClick={() => { setQuery(''); setExpandedId(null); }}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors text-lg leading-none">
            ×
          </button>
        )}
      </div>

      {/* ── Empty state ── */}
      {!query && (
        <div className="text-center py-16 text-slate-600">
          <svg className="w-10 h-10 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p className="text-sm">Type to search across {components.length.toLocaleString()} components</p>
        </div>
      )}

      {/* ── No results ── */}
      {query && results.length === 0 && (
        <div className="text-center py-12 text-slate-600 text-sm">No components match "{query}"</div>
      )}

      {/* ── Result count ── */}
      {results.length > 0 && (
        <p className="text-[11px] text-slate-600 px-1">
          {results.length} result{results.length !== 1 ? 's' : ''}{results.length === 20 ? ' (showing top 20)' : ''}
        </p>
      )}

      {/* ── Result cards ── */}
      <div className="space-y-3">
        {results.map((c) => {
          const tuc     = tucByComp.get(c.component_id);
          const lq      = lastQuoteByComp.get(c.component_id);
          const lpo     = lastPoByComp.get(c.component_id);
          const usage   = usageByComp.get(c.component_id);
          const linked  = linkedByComp.get(c.component_id) ?? [];
          const isOpen  = expandedId === c.component_id;
          const q       = query.trim();

          // Pick best last price: TUC > most recent of quote/PO
          const showLq  = lq && (!lpo || lq.date >= lpo.date);
          const priceDelta = lq?.prevPrice != null && lq.prevPrice > 0
            ? ((lq.price - lq.prevPrice) / lq.prevPrice) * 100
            : null;

          return (
            <div key={c.component_id} className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden ring-1 ring-white/5">

              {/* ── Card header ── */}
              <div className="p-4 md:p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <p className="text-white font-semibold text-sm leading-snug">{hl(c.internal_description, q)}</p>
                    <p className="text-sky-400/80 font-mono text-xs mt-0.5">{hl(c.supplier_model, q)}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {c.brand && <span className="text-slate-500 text-[11px]">{hl(c.brand, q)}</span>}
                      {c.brand && c.category && <span className="text-slate-700 text-[11px]">·</span>}
                      {c.category && <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-400">{c.category}</span>}
                    </div>
                  </div>
                  {c.datasheet_url && (
                    <a href={c.datasheet_url} target="_blank" rel="noopener noreferrer"
                      className="flex-shrink-0 text-sky-500 hover:text-sky-300 transition-colors" title="Datasheet">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                    </a>
                  )}
                </div>

                {/* ── Price + TUC row ── */}
                <div className="grid grid-cols-3 gap-3 mb-3">
                  {/* Last price */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">Last Price</p>
                    {tuc ? (
                      <div>
                        <p className="text-sm font-semibold text-slate-200 tabular-nums">{fmtAmt(tuc.actualTucIdr, 'IDR')}</p>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-[10px] text-slate-600 whitespace-nowrap">{fmtDate(tuc.latestPoDate)}</span>
                          <span className="text-[10px] text-amber-600/70 font-medium">TUC</span>
                        </div>
                      </div>
                    ) : showLq ? (
                      <div>
                        <p className="text-sm font-semibold text-slate-200 tabular-nums">{fmtAmt(lq!.price, lq!.currency)}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[10px] text-slate-600 whitespace-nowrap">{fmtDate(lq!.date)}</span>
                          {priceDelta != null && (
                            <span className={`text-[10px] font-semibold tabular-nums ${priceDelta > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                              {priceDelta > 0 ? '▲' : '▼'} {Math.abs(priceDelta).toFixed(1)}%
                            </span>
                          )}
                        </div>
                      </div>
                    ) : lpo ? (
                      <div>
                        <p className="text-sm font-semibold text-slate-200 tabular-nums">{fmtAmt(lpo.price, lpo.currency)}</p>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-[10px] text-slate-600 whitespace-nowrap">{fmtDate(lpo.date)}</span>
                          <span className="text-[10px] text-sky-600/70 font-medium">PO</span>
                        </div>
                      </div>
                    ) : <p className="text-sm text-slate-700">—</p>}
                  </div>

                  {/* TUC */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">TUC</p>
                    {tuc ? (
                      <div>
                        <p className="text-sm font-semibold text-amber-400 tabular-nums">{fmtAmt(tuc.actualTucIdr, 'IDR')}</p>
                        {tuc.tucXr && <p className="text-[10px] text-slate-600 mt-0.5 tabular-nums whitespace-nowrap">≈ {fmtAmt(tuc.actualTucIdr / tuc.tucXr, 'USD')}</p>}
                      </div>
                    ) : <p className="text-sm text-slate-700">—</p>}
                  </div>

                  {/* Activity */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">Activity</p>
                    <div className="flex flex-wrap gap-1.5 mt-0.5">
                      {(usage?.quotes ?? 0) > 0 && (
                        <span className="text-[11px] text-emerald-400/80 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded font-medium">
                          {usage!.quotes}Q
                        </span>
                      )}
                      {(usage?.pos ?? 0) > 0 && (
                        <span className="text-[11px] text-sky-400/80 bg-sky-500/10 border border-sky-500/20 px-1.5 py-0.5 rounded font-medium">
                          {usage!.pos}PO
                        </span>
                      )}
                      {!usage?.quotes && !usage?.pos && <span className="text-sm text-slate-700">—</span>}
                    </div>
                  </div>
                </div>

                {/* ── Linked items ── */}
                {linked.length > 0 && (
                  <div className="mt-1 pt-3 border-t border-slate-800/60">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">
                      Linked / Comparable ({linked.length})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {linked.map(({ comp: lComp, linkType, normUnit, normSelf, normOther }) => {
                        const lTuc  = tucByComp.get(lComp.component_id);
                        const lLq   = lastQuoteByComp.get(lComp.component_id);
                        const lLpo  = lastPoByComp.get(lComp.component_id);
                        const lPrice = lTuc
                          ? { val: lTuc.actualTucIdr, cur: 'IDR', tag: 'TUC' }
                          : lLq ? { val: lLq.price, cur: lLq.currency, tag: 'Q' }
                          : lLpo ? { val: lLpo.price, cur: lLpo.currency, tag: 'PO' }
                          : null;
                        return (
                          <button
                            key={lComp.component_id}
                            onClick={() => jumpTo(lComp)}
                            className="flex items-start gap-2 text-left bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-slate-600 rounded-xl px-3 py-2 transition-colors group min-w-0 max-w-[260px]"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-slate-300 group-hover:text-white font-medium truncate leading-tight">
                                {lComp.internal_description || lComp.supplier_model}
                              </p>
                              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                {lPrice && (
                                  <span className="text-[11px] tabular-nums text-slate-400 font-semibold whitespace-nowrap">
                                    {fmtAmt(lPrice.val, lPrice.cur)}
                                    <span className={`ml-1 text-[9px] font-bold ${lPrice.tag === 'TUC' ? 'text-amber-500/70' : lPrice.tag === 'Q' ? 'text-emerald-500/70' : 'text-sky-500/70'}`}>{lPrice.tag}</span>
                                  </span>
                                )}
                                {normUnit && normSelf != null && normOther != null && (
                                  <span className="text-[10px] text-slate-600 whitespace-nowrap">
                                    {normSelf}{normUnit} → {normOther}{normUnit}
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-slate-600 capitalize">{linkType.replace('_', ' ')}</span>
                            </div>
                            <svg className="w-3 h-3 text-slate-600 group-hover:text-slate-400 flex-shrink-0 mt-0.5 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── Expand toggle ── */}
                {((usage?.quotes ?? 0) > 0 || (usage?.pos ?? 0) > 0) && (
                  <button
                    onClick={() => toggleExpand(c.component_id)}
                    className="mt-3 w-full flex items-center justify-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 py-1.5 border border-slate-800 hover:border-slate-700 rounded-lg transition-colors"
                  >
                    <svg className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                    {isOpen ? 'Hide' : 'Show'} full cost breakdown
                  </button>
                )}
              </div>

              {/* ── Expanded detail ── */}
              {isOpen && expandedDetail && (
                <div className="border-t border-slate-800 bg-slate-950/40 p-4 md:p-5 space-y-6">

                  {/* Quote lines */}
                  {expandedDetail.myQItems.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400/70 mb-3">
                        Quote Lines ({expandedDetail.myQItems.length})
                      </p>
                      <div className="overflow-x-auto rounded-xl border border-slate-800">
                        <table className="w-full text-xs min-w-[520px]">
                          <thead className="bg-slate-900 text-slate-500 text-[10px] uppercase tracking-widest">
                            <tr>
                              <th className="px-3 py-2 text-left">Quote / PI</th>
                              <th className="px-3 py-2 text-left">Date</th>
                              <th className="px-3 py-2 text-left">Supplier</th>
                              <th className="px-3 py-2 text-right">Qty</th>
                              <th className="px-3 py-2 text-right">Unit Price</th>
                              <th className="px-3 py-2 text-right">Total</th>
                              <th className="px-3 py-2 text-left">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60">
                            {expandedDetail.myQItems.map((qi) => {
                              const qt = expandedDetail.qMap.get(qi.quote_id);
                              return (
                                <tr key={qi.quote_line_id} className="hover:bg-slate-800/30 transition-colors">
                                  <td className="px-3 py-2 text-sky-400 font-mono">{qt?.pi_number ?? `#${qi.quote_id}`}</td>
                                  <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{fmtDate(qt?.quote_date)}</td>
                                  <td className="px-3 py-2 text-slate-300">{getSupplier(qt?.supplier_id)}</td>
                                  <td className="px-3 py-2 text-right text-white font-semibold">{qi.quantity.toLocaleString()}</td>
                                  <td className="px-3 py-2 text-right text-slate-200 tabular-nums whitespace-nowrap">{fmtAmt(qi.unit_price, qi.currency)}</td>
                                  <td className="px-3 py-2 text-right text-emerald-400 font-semibold tabular-nums whitespace-nowrap">{fmtAmt(qi.quantity * qi.unit_price, qi.currency)}</td>
                                  <td className="px-3 py-2">
                                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                                      qt?.status === 'Accepted' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                      qt?.status === 'Rejected' || qt?.status === 'Expired' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                                      'bg-slate-700 text-slate-400 border-slate-600'}`}>
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
                  {expandedDetail.allocs.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400/70 mb-3">
                        PO Lines · True Unit Cost ({expandedDetail.allocs.length})
                      </p>
                      <div className="overflow-x-auto rounded-xl border border-slate-800">
                        <table className="w-full text-xs min-w-[640px]">
                          <thead className="bg-slate-900 text-slate-500 text-[10px] uppercase tracking-widest">
                            <tr>
                              <th className="px-3 py-2 text-left">PO #</th>
                              <th className="px-3 py-2 text-left">Date</th>
                              <th className="px-3 py-2 text-right">Qty</th>
                              <th className="px-3 py-2 text-right">Unit Cost</th>
                              <th className="px-3 py-2 text-right">Line Share</th>
                              <th className="px-3 py-2 text-right text-amber-400/70">True Unit Cost</th>
                              <th className="px-3 py-2 text-left">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60">
                            {expandedDetail.allocs.map((a: any) => (
                              <tr key={a.item.po_line_item_id} className={`hover:bg-slate-800/30 transition-colors ${!a.hasBalance ? 'opacity-60' : ''}`}>
                                <td className="px-3 py-2 text-sky-400 font-mono whitespace-nowrap">{a.po.po_number}</td>
                                <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{fmtDate(a.po.po_date)}</td>
                                <td className="px-3 py-2 text-right text-white font-semibold">{a.item.quantity.toLocaleString()}</td>
                                <td className="px-3 py-2 text-right text-slate-200 tabular-nums whitespace-nowrap">{fmtAmt(a.item.unit_cost, a.item.currency)}</td>
                                <td className="px-3 py-2 text-right text-slate-400">{(a.lineShare * 100).toFixed(1)}%</td>
                                {a.hasBalance && a.trueUnitCostIdr > 0 ? (
                                  <td className="px-3 py-2 text-right bg-amber-500/5">
                                    <p className="text-amber-400 font-bold tabular-nums whitespace-nowrap">{fmtAmt(a.trueUnitCostIdr, 'IDR')}</p>
                                    {a.totalAllocated > 0 && (a.allocBankFees > 0 || a.allocLanded > 0) && (
                                      <p className="text-[9px] tabular-nums mt-0.5 whitespace-nowrap">
                                        <span className="text-sky-400">{((a.allocPrincipal / a.totalAllocated) * 100).toFixed(0)}%</span>
                                        <span className="text-slate-600"> base</span>
                                        {a.allocBankFees > 0 && <><span className="text-slate-600"> · </span><span className="text-purple-400">+{((a.allocBankFees / a.totalAllocated) * 100).toFixed(0)}%</span><span className="text-slate-600"> fees</span></>}
                                        {a.allocLanded > 0 && <><span className="text-slate-600"> · </span><span className="text-orange-400">+{((a.allocLanded / a.totalAllocated) * 100).toFixed(0)}%</span><span className="text-slate-600"> landed</span></>}
                                      </p>
                                    )}
                                  </td>
                                ) : (
                                  <td className="px-3 py-2 text-right text-slate-700 italic text-[10px]">balance unpaid</td>
                                )}
                                <td className="px-3 py-2">
                                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                                    a.po.status === 'Fully Received' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                    a.po.status === 'Partially Received' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                                    'bg-slate-700 text-slate-400 border-slate-600'}`}>
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

                  {/* PO cost groups */}
                  {expandedDetail.poGroups.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-rose-400/70 mb-3">
                        Payment & Cost Records ({expandedDetail.poGroups.reduce((s: number, g: any) => s + g.costs.length, 0)})
                      </p>
                      <div className="space-y-3">
                        {expandedDetail.poGroups.map((g: any) => (
                          <div key={g.po.po_id} className="rounded-xl border border-slate-800 overflow-hidden">
                            <div className="bg-slate-900 px-4 py-2.5 flex items-center gap-3 flex-wrap">
                              <span className="text-sky-400 font-mono text-xs font-semibold">{g.po.po_number}</span>
                              {g.po.pi_number && <span className="text-violet-400 font-mono text-[10px]">PI: {g.po.pi_number}</span>}
                              <span className="text-slate-500 text-[11px]">{fmtDate(g.po.po_date)}</span>
                              <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full border ${g.hasBalance ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>
                                {g.hasBalance ? 'Balance Paid' : 'Balance Unpaid'}
                              </span>
                            </div>
                            {/* TUC cost breakdown bar */}
                            {(() => {
                              const total = g.principalIdr + g.bankFeesIdr + g.landedIdr;
                              if (total <= 0 || (!g.bankFeesIdr && !g.landedIdr)) return null;
                              const pctFees   = (g.bankFeesIdr   / total) * 100;
                              const pctLanded = (g.landedIdr     / total) * 100;
                              const pctBase   = 100 - pctFees - pctLanded;
                              return (
                                <div className="px-4 py-2.5 border-b border-slate-800/40 bg-slate-950/30 space-y-1.5">
                                  <div className="h-1.5 rounded-full overflow-hidden flex">
                                    <div className="h-full bg-sky-500/60" style={{ width: `${pctBase}%` }} />
                                    {pctFees   > 0 && <div className="h-full bg-purple-500/60" style={{ width: `${pctFees}%` }} />}
                                    {pctLanded > 0 && <div className="h-full bg-orange-500/60" style={{ width: `${pctLanded}%` }} />}
                                  </div>
                                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                                    <span><span className="text-sky-400">●</span> <span className="text-slate-500">Principal</span> <span className="tabular-nums text-slate-300 font-semibold">{fmtAmt(g.principalIdr, 'IDR')}</span> <span className="text-sky-400 font-semibold">({pctBase.toFixed(1)}%)</span></span>
                                    {g.bankFeesIdr > 0 && <span><span className="text-purple-400">●</span> <span className="text-slate-500">Bank fees</span> <span className="tabular-nums text-slate-300 font-semibold">{fmtAmt(g.bankFeesIdr, 'IDR')}</span> <span className="text-purple-400 font-semibold">(+{pctFees.toFixed(1)}%)</span></span>}
                                    {g.landedIdr   > 0 && <span><span className="text-orange-400">●</span> <span className="text-slate-500">Landed</span> <span className="tabular-nums text-slate-300 font-semibold">{fmtAmt(g.landedIdr, 'IDR')}</span> <span className="text-orange-400 font-semibold">(+{pctLanded.toFixed(1)}%)</span></span>}
                                  </div>
                                </div>
                              );
                            })()}
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs min-w-[400px]">
                                <tbody className="divide-y divide-slate-800/40">
                                  {g.costs.map((cost: any) => {
                                    const isTax = TAX_CATS.has(cost.cost_category);
                                    const isPayment = PRINCIPAL_CATS.has(cost.cost_category);
                                    const isFee = BANK_FEE_CATS.has(cost.cost_category);
                                    return (
                                      <tr key={cost.cost_id} className={`hover:bg-slate-800/30 ${isTax ? 'opacity-40' : ''}`}>
                                        <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fmtDate(cost.payment_date)}</td>
                                        <td className="px-3 py-2 text-slate-300">{COST_LABELS[cost.cost_category] ?? cost.cost_category}</td>
                                        <td className="px-3 py-2">
                                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                                            isPayment ? 'bg-sky-500/10 text-sky-400 border-sky-500/20' :
                                            isFee ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' :
                                            isTax ? 'bg-slate-800 text-slate-600 border-slate-700' :
                                            'bg-orange-500/10 text-orange-400 border-orange-500/20'}`}>
                                            {isPayment ? 'Payment' : isFee ? 'Fee' : isTax ? 'Tax' : 'Landed'}
                                          </span>
                                        </td>
                                        <td className={`px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap ${isTax ? 'text-slate-600' : 'text-rose-400'}`}>
                                          {fmtAmt(cost.amount, cost.currency)}
                                        </td>
                                        {cost.notes && <td className="px-3 py-2 text-slate-600 truncate max-w-[160px]">{cost.notes}</td>}
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
                                        {Object.entries(g.sub).map(([cur, amt]: any) => fmtAmt(amt, cur)).join(' · ')}
                                      </td>
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
        })}
      </div>
    </div>
  );
}

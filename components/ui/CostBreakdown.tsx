/**
 * Cost Breakdown
 * Aggregated split of supplier cost / bank fees / landed costs / taxes
 * at four levels: Overall · By Category · By Vendor · By Product
 */
'use client';

import React, { useState, useMemo } from 'react';
import type {
  Component, PurchaseOrder, PurchaseLineItem, POCost, Supplier, PriceQuote,
} from '../../types/database';
import { CATEGORY_LABELS } from '../../constants/categoryUnits';
import { PRINCIPAL_CATS, BANK_FEE_CATS } from '../../constants/costCategories';

interface Props {
  components: Component[];
  pos: PurchaseOrder[];
  poItems: PurchaseLineItem[];
  poCosts: POCost[];
  suppliers: Supplier[];
  quotes: PriceQuote[];
  isLoading?: boolean;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface Split {
  product: number;  // principal payments to supplier (IDR)
  bank: number;     // bank wire fees (IDR)
  landed: number;   // import duty, delivery, demurrage, DHL, penalty (IDR)
  tax: number;      // VAT, income tax, import tax — excluded from TUC (IDR)
}

interface Row {
  id: string;
  label: string;
  sublabel: string;
  split: Split;
  poCount: number;
  compCount: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const FX: Record<string, number> = { USD: 16000, RMB: 2200, IDR: 1 };
const TAX_SET = new Set(['local_vat', 'local_income_tax', 'local_import_tax']);
const ZERO: Split = { product: 0, bank: 0, landed: 0, tax: 0 };

function addSplit(a: Split, b: Split): Split {
  return { product: a.product + b.product, bank: a.bank + b.bank, landed: a.landed + b.landed, tax: a.tax + b.tax };
}
function scaleSplit(s: Split, factor: number): Split {
  return { product: s.product * factor, bank: s.bank * factor, landed: s.landed * factor, tax: s.tax * factor };
}
function splitTotal(s: Split) { return s.product + s.bank + s.landed + s.tax; }
function pct(part: number, tot: number) { return tot > 0 ? (part / tot * 100) : 0; }

function fmtIdr(v: number) {
  if (v >= 1_000_000_000) return `Rp ${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `Rp ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `Rp ${(v / 1_000).toFixed(0)}k`;
  return `Rp ${Math.round(v).toLocaleString('en-US')}`;
}

function fmtPct(v: number) { return v < 0.05 ? '<0.1%' : `${v.toFixed(1)}%`; }

// ── Bar component ─────────────────────────────────────────────────────────────

function SplitBar({ split, height = 'h-2.5' }: { split: Split; height?: string }) {
  const tot = splitTotal(split);
  if (tot === 0) return <div className={`${height} rounded-full bg-slate-800 w-full`} />;
  return (
    <div className={`flex ${height} rounded-full overflow-hidden w-full gap-px`}>
      <div style={{ width: `${pct(split.product, tot)}%` }} className="bg-sky-500 flex-shrink-0" />
      <div style={{ width: `${pct(split.bank, tot)}%` }} className="bg-amber-500 flex-shrink-0" />
      <div style={{ width: `${pct(split.landed, tot)}%` }} className="bg-violet-500 flex-shrink-0" />
      <div style={{ width: `${pct(split.tax, tot)}%` }} className="bg-slate-600 flex-shrink-0" />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type ViewId = 'category' | 'vendor' | 'product';

export default function CostBreakdown({
  components, pos, poItems, poCosts, suppliers, quotes, isLoading,
}: Props) {
  const [view, setView] = useState<ViewId>('category');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'total' | 'product' | 'bank' | 'landed' | 'tax'>('total');

  // ── Core computation ────────────────────────────────────────────────────────
  const { overall, byCat, byVendor, byProduct } = useMemo(() => {
    const compMap = new Map(components.map((c) => [c.component_id, c]));
    const supplierMap = new Map(suppliers.map((s) => [s.supplier_id, s]));

    // Resolve supplier for each PO (direct or via quote)
    const poSupplier = new Map<number, string>();
    for (const po of pos) {
      if (po.supplier_id) {
        poSupplier.set(po.po_id, po.supplier_id);
      } else if (po.quote_id) {
        const q = quotes.find((q) => q.quote_id === po.quote_id);
        if (q) poSupplier.set(po.po_id, q.supplier_id);
      }
    }

    // Index costs and items by PO
    const costsByPo = new Map<number, POCost[]>();
    for (const c of poCosts) {
      const arr = costsByPo.get(c.po_id) ?? [];
      arr.push(c);
      costsByPo.set(c.po_id, arr);
    }
    const itemsByPo = new Map<number, PurchaseLineItem[]>();
    for (const i of poItems) {
      const arr = itemsByPo.get(i.po_id) ?? [];
      arr.push(i);
      itemsByPo.set(i.po_id, arr);
    }

    // Accumulators
    let overall: Split = { ...ZERO };

    // category → { split, pos: Set<number>, comps: Set<string> }
    const catAcc = new Map<string, { split: Split; pos: Set<number>; comps: Set<string> }>();
    // supplier_id → { label, split, pos: Set<number>, comps: Set<string> }
    const vendorAcc = new Map<string, { label: string; split: Split; pos: Set<number>; comps: Set<string> }>();
    // component_id → { label, sublabel, split, pos: Set<number> }
    const productAcc = new Map<string, { label: string; sublabel: string; split: Split; pos: Set<number> }>();

    function ensureCat(cat: string) {
      if (!catAcc.has(cat)) catAcc.set(cat, { split: { ...ZERO }, pos: new Set(), comps: new Set() });
      return catAcc.get(cat)!;
    }
    function ensureVendor(sid: string) {
      if (!vendorAcc.has(sid)) {
        const sup = supplierMap.get(sid);
        vendorAcc.set(sid, {
          label: sup?.supplier_name ?? sid,
          split: { ...ZERO },
          pos: new Set(),
          comps: new Set(),
        });
      }
      return vendorAcc.get(sid)!;
    }
    function ensureProduct(cid: string) {
      if (!productAcc.has(cid)) {
        const comp = compMap.get(cid);
        productAcc.set(cid, {
          label: comp?.supplier_model ?? cid,
          sublabel: [comp?.brand, comp?.category ? (CATEGORY_LABELS[comp.category] ?? comp.category) : ''].filter(Boolean).join(' · '),
          split: { ...ZERO },
          pos: new Set(),
        });
      }
      return productAcc.get(cid)!;
    }

    for (const po of pos) {
      const costs = costsByPo.get(po.po_id) ?? [];
      const items = itemsByPo.get(po.po_id) ?? [];
      if (!costs.length || !items.length) continue;

      const exRate = po.exchange_rate ?? FX[po.currency] ?? 16000;

      // Compute PO-level cost split in IDR
      const poSplit: Split = { ...ZERO };
      for (const cost of costs) {
        const rate = cost.exchange_rate ?? (cost.currency === 'IDR' ? 1 : exRate);
        const amtIdr = cost.amount * rate;
        if (PRINCIPAL_CATS.has(cost.cost_category)) poSplit.product += amtIdr;
        else if (BANK_FEE_CATS.has(cost.cost_category)) poSplit.bank += amtIdr;
        else if (TAX_SET.has(cost.cost_category)) poSplit.tax += amtIdr;
        else poSplit.landed += amtIdr;
      }

      // PO total value (in PO's currency) for line share
      const poValueFx = items.reduce((s, i) => s + i.unit_cost * i.quantity, 0);
      if (poValueFx === 0) continue;

      const supplierId = poSupplier.get(po.po_id);

      for (const item of items) {
        const share = (item.unit_cost * item.quantity) / poValueFx;
        const lineSplit = scaleSplit(poSplit, share);

        // Overall
        overall = addSplit(overall, lineSplit);

        // By category
        const comp = compMap.get(item.component_id);
        const cat = comp?.category ?? 'unknown';
        const catRow = ensureCat(cat);
        catRow.split = addSplit(catRow.split, lineSplit);
        catRow.pos.add(po.po_id);
        catRow.comps.add(item.component_id);

        // By vendor
        if (supplierId) {
          const vRow = ensureVendor(supplierId);
          vRow.split = addSplit(vRow.split, lineSplit);
          vRow.pos.add(po.po_id);
          vRow.comps.add(item.component_id);
        }

        // By product
        const pRow = ensureProduct(item.component_id);
        pRow.split = addSplit(pRow.split, lineSplit);
        pRow.pos.add(po.po_id);
      }
    }

    // Convert to sorted Row arrays
    function toRows(
      entries: [string, { label: string; sublabel?: string; split: Split; pos: Set<number>; comps?: Set<string> }][]
    ): Row[] {
      return entries.map(([id, v]) => ({
        id,
        label: v.label,
        sublabel: v.sublabel ?? '',
        split: v.split,
        poCount: v.pos.size,
        compCount: v.comps?.size ?? 1,
      }));
    }

    const byCat = toRows([...catAcc.entries()].map(([k, v]) => [k, { ...v, label: CATEGORY_LABELS[k] ?? k, sublabel: '' }]));
    const byVendor = toRows([...vendorAcc.entries()]);
    const byProduct = toRows([...productAcc.entries()].map(([k, v]) => [k, { ...v, comps: new Set([k]) }]));

    return { overall, byCat, byVendor, byProduct };
  }, [components, pos, poItems, poCosts, suppliers, quotes]);

  // ── Sorted + filtered rows ───────────────────────────────────────────────────
  const activeRows = useMemo(() => {
    const source = view === 'category' ? byCat : view === 'vendor' ? byVendor : byProduct;
    const q = search.toLowerCase();
    const filtered = q
      ? source.filter((r) => r.label.toLowerCase().includes(q) || r.sublabel.toLowerCase().includes(q))
      : source;
    return [...filtered].sort((a, b) => {
      if (sortBy === 'total') return splitTotal(b.split) - splitTotal(a.split);
      return b.split[sortBy] - a.split[sortBy];
    });
  }, [view, byCat, byVendor, byProduct, search, sortBy]);

  const overallTotal = splitTotal(overall);

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-slate-500 text-sm">Loading…</div>;
  }

  if (overallTotal === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500 text-sm gap-2">
        <p className="font-medium text-slate-400">No cost records found</p>
        <p className="text-[11px] text-slate-600">Log payments and costs against POs to see the breakdown.</p>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  const BUCKETS: { key: keyof Split; label: string; color: string; text: string; desc: string; muted: boolean }[] = [
    { key: 'product', label: 'Supplier Cost',  color: 'bg-sky-500',    text: 'text-sky-400',    desc: 'Principal payments to supplier',       muted: false },
    { key: 'bank',    label: 'Bank Fees',      color: 'bg-amber-500',  text: 'text-amber-400',  desc: 'Wire transfer charges',                muted: false },
    { key: 'landed',  label: 'Landed Costs',   color: 'bg-violet-500', text: 'text-violet-400', desc: 'Import duty, delivery, demurrage, DHL', muted: false },
    { key: 'tax',     label: 'Taxes',          color: 'bg-slate-600',  text: 'text-slate-400',  desc: 'VAT, income tax — excluded from TUC',  muted: true  },
  ];

  return (
    <div className="space-y-6">

      {/* ── Overall summary cards ── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {/* Total */}
        <div className="col-span-2 xl:col-span-1 bg-slate-900/60 border border-slate-800 rounded-2xl p-4 xl:p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">Total Procurement Spend</p>
          <p className="text-2xl xl:text-3xl font-extrabold text-white tabular-nums">{fmtIdr(overallTotal)}</p>
          <div className="mt-3">
            <SplitBar split={overall} height="h-3" />
          </div>
        </div>
        {/* Per bucket */}
        {BUCKETS.map((b) => (
          <div key={b.key} className={`bg-slate-900/60 border border-slate-800 rounded-2xl p-4 xl:p-5 ${b.muted ? 'opacity-70' : ''}`}>
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`w-2 h-2 rounded-full ${b.color} flex-shrink-0`} />
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{b.label}</p>
            </div>
            <p className={`text-xl xl:text-2xl font-extrabold tabular-nums ${b.text}`}>{fmtIdr(overall[b.key])}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{fmtPct(pct(overall[b.key], overallTotal))} of total</p>
            <p className="text-[10px] text-slate-600 mt-1">{b.desc}</p>
          </div>
        ))}
      </div>

      {/* ── Legend ── */}
      <div className="flex flex-wrap gap-4 text-[11px] text-slate-500">
        {BUCKETS.map((b) => (
          <div key={b.key} className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-sm ${b.color}`} />
            <span className={b.muted ? 'text-slate-600' : ''}>{b.label}</span>
          </div>
        ))}
      </div>

      {/* ── View selector + search ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5">
          {([
            { id: 'category', label: 'By Category' },
            { id: 'vendor',   label: 'By Vendor'   },
            { id: 'product',  label: 'By Product'  },
          ] as const).map((v) => (
            <button
              key={v.id}
              onClick={() => { setView(v.id); setSearch(''); }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                view === v.id ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        {view === 'product' && (
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search model / brand…"
            className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-violet-500 w-56"
          />
        )}
      </div>

      {/* ── Table ── */}
      <div className="overflow-x-auto rounded-2xl border border-slate-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/40">
              <th className="text-left px-4 py-3 text-slate-500 font-semibold uppercase tracking-wider text-[10px] w-64">
                {view === 'category' ? 'Category' : view === 'vendor' ? 'Vendor' : 'Product'}
              </th>
              <th
                className="text-right px-4 py-3 text-slate-500 font-semibold uppercase tracking-wider text-[10px] cursor-pointer hover:text-white transition-colors"
                onClick={() => setSortBy('total')}
              >
                Total {sortBy === 'total' && <span className="text-violet-400">▼</span>}
              </th>
              <th className="px-4 py-3 text-slate-500 font-semibold uppercase tracking-wider text-[10px] min-w-[200px]">
                Cost Split
              </th>
              {BUCKETS.map((b) => (
                <th
                  key={b.key}
                  className="text-right px-3 py-3 font-semibold uppercase tracking-wider text-[10px] cursor-pointer hover:text-white transition-colors whitespace-nowrap"
                  style={{ color: b.muted ? 'rgba(100,116,139,0.7)' : undefined }}
                  onClick={() => setSortBy(b.key)}
                >
                  <span className={b.text}>{b.label.split(' ')[0]}</span>
                  {sortBy === b.key && <span className="text-violet-400 ml-0.5">▼</span>}
                </th>
              ))}
              <th className="text-right px-4 py-3 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                {view === 'product' ? 'POs' : 'Items'}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {activeRows.map((row) => {
              const tot = splitTotal(row.split);
              return (
                <tr key={row.id} className="hover:bg-white/[0.02] transition-colors">
                  {/* Label */}
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-200 leading-tight truncate max-w-[240px]">{row.label}</p>
                    {row.sublabel && <p className="text-[10px] text-slate-600 mt-0.5 truncate max-w-[240px]">{row.sublabel}</p>}
                  </td>
                  {/* Total */}
                  <td className="px-4 py-3 text-right tabular-nums text-slate-200 font-semibold whitespace-nowrap">
                    {fmtIdr(tot)}
                  </td>
                  {/* Bar */}
                  <td className="px-4 py-3">
                    <SplitBar split={row.split} />
                  </td>
                  {/* Per-bucket % */}
                  {BUCKETS.map((b) => (
                    <td key={b.key} className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
                      <span className={row.split[b.key] > 0 ? b.text : 'text-slate-700'}>
                        {row.split[b.key] > 0 ? fmtPct(pct(row.split[b.key], tot)) : '—'}
                      </span>
                    </td>
                  ))}
                  {/* Count */}
                  <td className="px-4 py-3 text-right text-slate-600">
                    {view === 'product'
                      ? `${row.poCount} PO${row.poCount !== 1 ? 's' : ''}`
                      : `${row.compCount} item${row.compCount !== 1 ? 's' : ''}`}
                  </td>
                </tr>
              );
            })}
            {activeRows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-600 text-xs">
                  {search ? `No results for "${search}"` : 'No data'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {activeRows.length > 0 && (
        <p className="text-[11px] text-slate-600">
          {activeRows.length} {view === 'category' ? 'categories' : view === 'vendor' ? 'vendors' : 'products'} · Only POs with both line items and payment records included.
          Taxes (VAT, income tax) shown separately — not included in TUC.
        </p>
      )}
    </div>
  );
}

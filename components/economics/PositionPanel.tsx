'use client';
/**
 * TRADE HISTORY ANALYSIS — the open-position screen.
 *
 * Layout follows Opsi #2: one vertical stack per item (buy block → sell block →
 * position block), because it is the only one of the two that survives a phone
 * and it matches what Dolibarr already shows, so nobody learns two layouts.
 *
 * The mark block is the addition: an entry price alone tells you what you owe
 * the trade, not whether you are up. Position Value − Position Cost is the
 * whole P&L of the item — realized profit is already inside Position Cost, so
 * the two do not need to be added together.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { fmtInt, fmtRupiah, fmtIdrShort, fmtDay } from '@/lib/formatters';
import { fetchTradePositions, type PositionRow, type PositionTotals } from '@/lib/tradePosition';

type Chip = 'all' | 'open' | 'recovered' | 'up' | 'down' | 'unmarked';

const pctOf = (n: number | null) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`);
const toneOf = (n: number | null | undefined) =>
  n == null ? 'text-slate-600' : n > 0 ? 'text-emerald-300' : n < 0 ? 'text-red-400' : 'text-slate-300';

export default function PositionPanel() {
  const supabase = createSupabaseClient();
  const [rows, setRows] = useState<PositionRow[]>([]);
  const [totals, setTotals] = useState<PositionTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [chip, setChip] = useState<Chip>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchTradePositions(supabase)
      .then(({ rows, totals }) => { if (live) { setRows(rows); setTotals(totals); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const counts = useMemo(() => ({
    all: rows.length,
    open: rows.filter((r) => r.posQty > 0).length,
    recovered: rows.filter((r) => r.recovered).length,
    up: rows.filter((r) => (r.pnl ?? 0) > 0).length,
    down: rows.filter((r) => r.pnl != null && r.pnl < 0).length,
    unmarked: rows.filter((r) => r.posQty > 0 && r.mark == null).length,
  }), [rows]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (chip === 'open' && r.posQty <= 0) return false;
      if (chip === 'recovered' && !r.recovered) return false;
      if (chip === 'up' && !((r.pnl ?? 0) > 0)) return false;
      if (chip === 'down' && !(r.pnl != null && r.pnl < 0)) return false;
      if (chip === 'unmarked' && !(r.posQty > 0 && r.mark == null)) return false;
      if (!q) return true;
      return `${r.label} ${r.brand ?? ''} ${r.category ?? ''}`.toLowerCase().includes(q);
    });
  }, [rows, search, chip]);

  if (loading) {
    return <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-slate-800/40 rounded-2xl animate-pulse" />)}</div>;
  }

  return (
    <div className="space-y-5">
      {/* ── Portfolio strip ── */}
      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
          <Tile label="Total purchased" value={fmtIdrShort(totals.poValue)} sub="received, at landed cost" />
          <Tile label="Total invoiced" value={fmtIdrShort(totals.invValue)} sub="net of PPN" />
          <Tile label="Open position cost" value={fmtIdrShort(totals.posCost)} sub={`${totals.openCount} item${totals.openCount !== 1 ? 's' : ''} still held`} accent />
          <Tile label="Position value at mark" value={fmtIdrShort(totals.posValue)} sub={totals.unmarked > 0 ? `${totals.unmarked} item${totals.unmarked !== 1 ? 's' : ''} unpriced — excluded` : 'at net sell price'} />
          <Tile label="Total P&L" value={fmtIdrShort(totals.pnl)} sub={`${pctOf(totals.roiPct)} on capital deployed`} tone={totals.pnl} />
          <Tile label="In transit" value={fmtIdrShort(totals.inTransitValue)} sub="ordered, not yet received" />
        </div>
      )}

      <p className="text-[10px] text-slate-600 leading-relaxed">
        Position Cost = Σ purchases − Σ invoiced, all time. It is a <span className="text-slate-400">recovery threshold</span>, not a cost:
        inventory is still valued at moving-average landed cost. Purchases are landed (creditable PPN and PPh excluded); sales are net of PPN.
      </p>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item, brand or category…"
            className="w-full pl-10 pr-4 h-10 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-white text-base sm:text-sm placeholder:text-[13px] sm:placeholder:text-sm placeholder:text-slate-500 transition-colors" />
        </div>
        {([
          ['all', `All (${counts.all})`],
          ['open', `Open (${counts.open})`],
          ['recovered', `Recovered (${counts.recovered})`],
          ['up', `In profit (${counts.up})`],
          ['down', `Underwater (${counts.down})`],
          ['unmarked', `No sell price (${counts.unmarked})`],
        ] as [Chip, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setChip(k)}
            className={`text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${chip === k ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 font-bold' : 'border-slate-700/80 text-slate-500 hover:text-slate-300'}`}>
            {label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-slate-600 text-xs italic py-10 text-center">No item matches.</p>
      ) : (
        <>
          {/* ── Desktop: compact rows, click to expand ── */}
          <div className="hidden md:block bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-x-auto">
            <table className="w-full min-w-[1120px]">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] uppercase tracking-widest text-slate-500">
                  <th className="text-left px-3 py-2.5 font-semibold">Item</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Bought</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Avg PO</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Sold</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Avg INV</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Position</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-amber-400/80" title="Break-even: below this the trade never recovers">Avg Position Cost</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Mark</th>
                  <th className="text-right px-3 py-2.5 font-semibold">P&amp;L</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {shown.map((r) => {
                  const open = openId === r.component_id;
                  return (
                    <Fragment key={r.component_id}>
                      <tr onClick={() => setOpenId(open ? null : r.component_id)}
                        className="cursor-pointer hover:bg-slate-800/40 transition-colors">
                        <td className="px-3 py-2 max-w-[280px]">
                          <p className="text-xs font-semibold text-slate-100 truncate">{r.label}</p>
                          <p className="text-[10px] text-slate-600 truncate">{[r.brand, r.category].filter(Boolean).join(' · ') || '—'}</p>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-400">{fmtInt(r.poQty)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-400">{r.avgPoPrice != null ? fmtIdrShort(r.avgPoPrice) : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-400">{r.invQty > 0 ? fmtInt(r.invQty) : <span className="text-slate-700">—</span>}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-400">{r.avgInvPrice != null ? fmtIdrShort(r.avgInvPrice) : <span className="text-slate-700">—</span>}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-200 font-semibold">{fmtInt(r.posQty)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs font-bold">
                          {r.recovered
                            ? <span className="text-emerald-300">Recovered</span>
                            : r.avgPosCost != null
                              ? <span className="text-amber-300">{fmtIdrShort(r.avgPosCost)}</span>
                              : <span className="text-slate-700">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-400">{r.mark != null ? fmtIdrShort(r.mark) : <span className="text-slate-700">—</span>}</td>
                        <td className={`px-3 py-2 text-right tabular-nums text-xs font-bold ${toneOf(r.pnl)}`}>
                          {r.pnl != null ? fmtIdrShort(r.pnl) : '—'}
                          {r.roiPct != null && <span className="block text-[10px] font-normal opacity-70">{pctOf(r.roiPct)}</span>}
                        </td>
                        <td className="pr-3 text-slate-600">
                          <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={10} className="px-3 pb-4 pt-1 bg-slate-950/40"><Detail r={r} /></td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Mobile: compact cards, tap to expand ── */}
          <div className="md:hidden space-y-2">
            {shown.map((r) => {
              const open = openId === r.component_id;
              return (
                <div key={r.component_id} className="bg-slate-900/40 border border-slate-800/80 rounded-xl overflow-hidden">
                  <button onClick={() => setOpenId(open ? null : r.component_id)} className="w-full text-left px-3.5 py-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-slate-100 truncate">{r.label}</p>
                        <p className="text-[10px] text-slate-600 truncate">{[r.brand, r.category].filter(Boolean).join(' · ') || '—'}</p>
                      </div>
                      <svg className={`w-3.5 h-3.5 mt-0.5 text-slate-600 transition-transform flex-shrink-0 ${open ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2 text-[10px]">
                      <span className="px-2 py-1 rounded-lg bg-slate-800/60 text-slate-400 tabular-nums">{fmtInt(r.posQty)} held</span>
                      {r.recovered
                        ? <span className="px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 font-bold">Recovered</span>
                        : r.avgPosCost != null && <span className="px-2 py-1 rounded-lg bg-amber-500/15 text-amber-300 font-bold tabular-nums">B/E {fmtIdrShort(r.avgPosCost)}</span>}
                      {r.pnl != null && <span className={`px-2 py-1 rounded-lg bg-slate-800/60 tabular-nums font-bold ${toneOf(r.pnl)}`}>{fmtIdrShort(r.pnl)} {r.roiPct != null && `· ${pctOf(r.roiPct)}`}</span>}
                    </div>
                  </button>
                  {open && <div className="px-3.5 pb-3.5"><Detail r={r} /></div>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** Opsi #2 — the vertical breakdown, plus the mark block and the reconciliation. */
function Detail({ r }: { r: PositionRow }) {
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 text-[11px]">
      <Block title="Purchases · received" accent="sky" rows={[
        ['Sum PO Qty', `${fmtInt(r.poQty)}${r.unit ? ` ${r.unit}` : ''}`],
        ['Sum PO Value', fmtRupiah(r.poValue)],
        ['Avg PO Price', r.avgPoPrice != null ? `${fmtRupiah(r.avgPoPrice)}/unit` : '—'],
      ]} foot={r.firstBuy ? `first ${fmtDay(r.firstBuy)}${r.lastBuy && r.lastBuy !== r.firstBuy ? ` · last ${fmtDay(r.lastBuy)}` : ''}` : undefined} />

      <Block title="Sales · invoiced" accent="emerald" rows={[
        ['Sum INV Qty', r.invQty > 0 ? `${fmtInt(r.invQty)}${r.unit ? ` ${r.unit}` : ''}` : '—'],
        ['Sum INV Value', r.invQty > 0 ? fmtRupiah(r.invValue) : '—'],
        ['Avg INV Price', r.avgInvPrice != null ? `${fmtRupiah(r.avgInvPrice)}/unit` : '—'],
      ]} foot={r.lastSale ? `last invoiced ${fmtDay(r.lastSale)}` : 'nothing invoiced yet'} />

      <Block title="Position" accent={r.recovered ? 'emerald' : 'amber'} rows={[
        ['Position Qty', `${fmtInt(r.posQty)}${r.unit ? ` ${r.unit}` : ''}`],
        ['Position Cost', r.recovered ? '—' : fmtRupiah(r.posCost)],
        ['Avg Position Cost', r.recovered ? '—' : r.avgPosCost != null ? `${fmtRupiah(r.avgPosCost)}/unit` : '—'],
      ]} foot={r.recovered
        ? `Free carry — the whole purchase is repaid and ${fmtRupiah(r.surplus)} is already banked on top.`
        : r.avgPosCost != null
          ? `Break-even: sell the remaining ${fmtInt(r.posQty)} above ${fmtRupiah(r.avgPosCost)} and the trade is whole.`
          : undefined}
        footTone={r.recovered ? 'emerald' : 'amber'} />

      <Block title="Mark to market" accent={(r.pnl ?? 0) >= 0 ? 'emerald' : 'red'} rows={[
        ['Sell price (net)', r.mark != null ? `${fmtRupiah(r.mark)}/unit` : 'not set'],
        ['Position Value', r.posValue != null ? fmtRupiah(r.posValue) : '—'],
        ['Total P&L', r.pnl != null ? `${fmtRupiah(r.pnl)}${r.roiPct != null ? ` · ${pctOf(r.roiPct)}` : ''}` : '—'],
      ]} foot={r.mark == null
        ? 'Set a sell price on the item to mark this position.'
        : 'Position Value − Position Cost. Realized profit is already inside Position Cost, so this is the whole trade.'} />

      {(r.inTransitQty > 0 || r.billingGap !== 0 || Math.abs(r.onHand - r.posQty) > 0.001) && (
        <div className="sm:col-span-2 xl:col-span-4 rounded-xl border border-slate-800 bg-slate-950/40 px-3.5 py-2.5 space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-slate-600">Reconciliation</p>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-400 tabular-nums">
            <span>On hand <span className="text-slate-200">{fmtInt(r.onHand)}</span></span>
            <span>Delivered <span className="text-slate-200">{fmtInt(r.deliveredQty)}</span></span>
            <span>Invoiced <span className="text-slate-200">{fmtInt(r.invQty)}</span></span>
            {r.inTransitQty > 0 && <span className="text-sky-300">In transit {fmtInt(r.inTransitQty)} · {fmtRupiah(r.inTransitValue)}</span>}
          </div>
          {r.billingGap !== 0 && (
            <p className="text-[10px] text-amber-400/90">
              {r.billingGap > 0
                ? `${fmtInt(r.billingGap)} invoiced ahead of shipment — position qty reads lower than the warehouse.`
                : `${fmtInt(-r.billingGap)} shipped but not yet invoiced — position qty reads higher than the warehouse.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const ACCENT: Record<string, string> = {
  sky: 'text-sky-300', emerald: 'text-emerald-300', amber: 'text-amber-300', red: 'text-red-400',
};

function Block({ title, accent, rows, foot, footTone }: {
  title: string; accent: string; rows: [string, string][]; foot?: string; footTone?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3.5 py-3">
      <p className={`text-[10px] font-bold uppercase tracking-wider ${ACCENT[accent]} mb-2`}>{title}</p>
      <div className="space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3">
            <span className="text-slate-500">{k}</span>
            <span className="text-slate-200 font-semibold tabular-nums text-right">{v}</span>
          </div>
        ))}
      </div>
      {foot && <p className={`text-[10px] mt-2 leading-relaxed ${footTone ? ACCENT[footTone] : 'text-slate-600'}`}>{foot}</p>}
    </div>
  );
}

function Tile({ label, value, sub, tone, accent }: {
  label: string; value: string; sub?: string; tone?: number; accent?: boolean;
}) {
  const color = tone != null ? toneOf(tone) : accent ? 'text-amber-300' : 'text-slate-100';
  return (
    <div className={`rounded-xl border px-3.5 py-3 ${accent ? 'border-amber-500/30 bg-amber-500/[0.06]' : 'border-slate-800 bg-slate-900/40'}`}>
      <p className="text-[10px] uppercase tracking-wider text-slate-600 truncate" title={label}>{label}</p>
      <p className={`text-lg font-bold tabular-nums mt-0.5 ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5 truncate" title={sub}>{sub}</p>}
    </div>
  );
}

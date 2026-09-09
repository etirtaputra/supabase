'use client';
/**
 * THE PRODUCT P&L — revenue, COGS and gross profit by period, category and item.
 *
 * Owner's ask, 2026-09-09. It is a TAB on /profitability rather than a page of
 * its own because the numbers are the same numbers: this screen already owns
 * "what shipped and what it earned" (Profitability) and "what is still held"
 * (Position). A statement is the third question about one set of facts — what
 * it added up to, period by period — and a separate menu entry would have made
 * two doors onto one room, then invited a second implementation behind one of
 * them.
 *
 * Facts come from the page, which built them with `buildSalesFacts`. This
 * component computes nothing about a sale; `lib/plStatement.ts` only buckets
 * and groups. Gross profit only — there is no opex in ICAPROC, and the panel
 * says so rather than letting a reader assume the bottom line is net.
 */
import { Fragment, useMemo, useState } from 'react';
import { fmtInt } from '@/lib/formatters';
import { downloadCsv } from '@/lib/csv';
import { formatCategory } from '@/lib/formatCategory';
import { buildPL, toCsvRows, GRAIN_LABEL, type Grain, type Money } from '@/lib/plStatement';
import type { SalesFact } from '@/lib/salesFacts';

/** Which number fills the period columns. The rest stay on the right edge. */
type Measure = 'grossProfit' | 'revenue' | 'marginPct';
const MEASURE_LABEL: Record<Measure, string> = {
  grossProfit: 'Gross profit',
  revenue: 'Revenue',
  marginPct: 'Margin %',
};

const toneOf = (n: number | null | undefined) =>
  n == null ? 'text-slate-600' : n > 0 ? 'text-emerald-300' : n < 0 ? 'text-red-400' : 'text-slate-400';

/** A cell's value for the chosen measure — blank when there is nothing to say. */
function cellText(m: Money | undefined, measure: Measure): { text: string; tone: string } {
  if (!m) return { text: '·', tone: 'text-slate-700' };
  if (measure === 'revenue') return { text: fmtInt(m.revenue), tone: 'text-slate-300' };
  if (!m.costKnown) return { text: '—', tone: 'text-slate-600' };
  if (measure === 'marginPct') {
    return m.marginPct == null
      ? { text: '—', tone: 'text-slate-600' }
      : { text: `${m.marginPct.toFixed(1)}%`, tone: toneOf(m.marginPct) };
  }
  return { text: fmtInt(m.grossProfit), tone: toneOf(m.grossProfit) };
}

export default function PLStatementPanel({ facts, nameOf, categoryOf }: {
  facts: SalesFact[];
  nameOf: (componentId: string) => string;
  categoryOf: (componentId: string) => string;
}) {
  const [grain, setGrain] = useState<Grain>('month');
  const [measure, setMeasure] = useState<Measure>('grossProfit');
  const [open, setOpen] = useState<Set<string>>(new Set());

  const pl = useMemo(() => buildPL(facts, grain, { nameOf, categoryOf }), [facts, grain, nameOf, categoryOf]);
  const toggle = (c: string) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(c)) n.delete(c); else n.add(c);
    return n;
  });

  const t = pl.total;
  const money = (n: number) => `Rp ${fmtInt(n)}`;

  if (pl.periods.length === 0) {
    return (
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-8 text-center space-y-2">
        <p className="text-sm text-slate-300 font-semibold">No delivered sales to report on yet.</p>
        <p className="text-[11px] text-slate-500 max-w-lg mx-auto">
          A sale enters this statement when its delivery order is marked <span className="text-slate-300">delivered</span> —
          that is the day the goods left and the day the margin is real. Confirmed orders that have not
          shipped are a promise, and a promise has no cost of goods yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-white/[0.06] overflow-hidden divide-x divide-white/[0.06]">
          {(['month', 'quarter', 'year'] as Grain[]).map((g) => (
            <button key={g} onClick={() => setGrain(g)}
              className={`px-3 py-1.5 text-xs transition-all ${grain === g
                ? 'bg-emerald-500/15 text-emerald-300 font-bold'
                : 'text-slate-400 hover:text-white hover:bg-white/10 font-medium'}`}>
              {GRAIN_LABEL[g]}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-lg border border-white/[0.06] overflow-hidden divide-x divide-white/[0.06]">
          {(['grossProfit', 'revenue', 'marginPct'] as Measure[]).map((m) => (
            <button key={m} onClick={() => setMeasure(m)}
              className={`px-3 py-1.5 text-xs transition-all ${measure === m
                ? 'bg-sky-500/15 text-sky-300 font-bold'
                : 'text-slate-400 hover:text-white hover:bg-white/10 font-medium'}`}>
              {MEASURE_LABEL[m]}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-slate-600 hidden lg:inline">columns show {MEASURE_LABEL[measure].toLowerCase()}</span>
        <button
          onClick={() => {
            const rows = toCsvRows(pl, formatCategory);
            downloadCsv(`icaproc-product-pl-${grain}.csv`, rows[0], rows.slice(1));
          }}
          className="ml-auto px-3 py-1.5 rounded-lg border border-white/[0.06] text-xs font-medium text-slate-400 hover:text-white hover:bg-white/10 transition-all">
          Export CSV
        </button>
      </div>

      {/* ── The four numbers, for the whole span ─────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { l: 'Revenue', v: money(t.revenue), cls: 'text-slate-100' },
          { l: 'Cost of goods sold', v: t.costKnown ? money(t.cogs) : '—', cls: 'text-slate-300' },
          { l: 'Gross profit', v: t.costKnown ? money(t.grossProfit) : '—', cls: toneOf(t.costKnown ? t.grossProfit : null) },
          { l: 'Gross margin', v: t.marginPct == null ? '—' : `${t.marginPct.toFixed(1)}%`, cls: toneOf(t.marginPct) },
        ].map((s) => (
          <div key={s.l} className="bg-slate-900/40 border border-slate-800/80 rounded-2xl px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 mb-1">{s.l}</p>
            <p className={`text-lg font-extrabold tabular-nums ${s.cls}`}>{s.v}</p>
          </div>
        ))}
      </div>

      {/* The caveat rides ABOVE the table, not in a footnote: a margin computed
          from today's average is a different number from the one the ledger
          would have given, and the owner is about to make a decision on it. */}
      {t.estimated && (
        <p className="text-[11px] text-amber-400/90 bg-amber-500/[0.06] border border-amber-500/20 rounded-xl px-3 py-2">
          <span className="font-semibold">{Math.round(pl.estimatedCogsShare * 100)}% of the cost of goods here is estimated.</span>{' '}
          Those deliveries carry no cost in the stock ledger, so today&rsquo;s moving-average landed cost stood in —
          it is not what the goods cost on the day they shipped. Rows marked <span className="font-mono">~</span> are the ones affected.
        </p>
      )}

      {/* ── The statement ───────────────────────────────────────────────── */}
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-x-auto">
        <table className="w-full text-[12.5px] min-w-[900px]">
          <thead>
            <tr className="bg-slate-800/60 text-[10px] uppercase tracking-wide text-slate-400">
              <th className="px-4 py-2.5 text-left font-semibold sticky left-0 bg-slate-800/60 z-10">Category · Item</th>
              {pl.periods.map((p) => (
                <th key={p.key} className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">{p.label}</th>
              ))}
              <th className="px-3 py-2.5 text-right font-semibold border-l border-slate-700/60">Revenue</th>
              <th className="px-3 py-2.5 text-right font-semibold">COGS</th>
              <th className="px-3 py-2.5 text-right font-semibold">Gross profit</th>
              <th className="px-4 py-2.5 text-right font-semibold">Margin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {pl.categories.map((c) => {
              const expanded = open.has(c.category);
              return (
                <Fragment key={c.category}>
                  <tr onClick={() => toggle(c.category)}
                    className="cursor-pointer hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-2 sticky left-0 bg-slate-900/95 z-10">
                      <span className="flex items-center gap-1.5">
                        <span className={`text-slate-600 text-[9px] transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
                        <span className="font-semibold text-slate-100">{formatCategory(c.category)}</span>
                        <span className="text-[10px] text-slate-600">{c.items.length} item{c.items.length !== 1 ? 's' : ''}</span>
                        {c.estimated && <span className="text-amber-400/80 font-mono text-[11px]" title="Part of this cost is estimated">~</span>}
                      </span>
                    </td>
                    {pl.periods.map((p) => {
                      const { text, tone } = cellText(pl.cellsByCategory.get(c.category)?.get(p.key), measure);
                      return <td key={p.key} className={`px-3 py-2 text-right tabular-nums font-semibold ${tone}`}>{text}</td>;
                    })}
                    <td className="px-3 py-2 text-right tabular-nums text-slate-200 border-l border-slate-800">{fmtInt(c.revenue)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-400">{c.costKnown ? fmtInt(c.cogs) : '—'}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-bold ${toneOf(c.costKnown ? c.grossProfit : null)}`}>
                      {c.costKnown ? fmtInt(c.grossProfit) : '—'}
                    </td>
                    <td className={`px-4 py-2 text-right tabular-nums font-semibold ${toneOf(c.marginPct)}`}>
                      {c.marginPct == null ? '—' : `${c.marginPct.toFixed(1)}%`}
                    </td>
                  </tr>

                  {expanded && c.items.map((it) => (
                    <tr key={it.componentId} className="bg-slate-950/30 text-[12px]">
                      <td className="px-4 py-1.5 pl-10 sticky left-0 bg-slate-950/95 z-10">
                        <span className="flex items-center gap-1.5">
                          <span className="text-slate-300 truncate max-w-[280px] inline-block align-bottom" title={it.name}>{it.name}</span>
                          <span className="text-[10px] text-slate-600 tabular-nums">×{fmtInt(it.qty)}</span>
                          {it.estimated && <span className="text-amber-400/80 font-mono text-[11px]" title="Cost estimated, not from the ledger">~</span>}
                        </span>
                      </td>
                      {pl.periods.map((p) => {
                        const { text, tone } = cellText(pl.cellsByItem.get(it.componentId)?.get(p.key), measure);
                        return <td key={p.key} className={`px-3 py-1.5 text-right tabular-nums ${tone}`}>{text}</td>;
                      })}
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-400 border-l border-slate-800">{fmtInt(it.revenue)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{it.costKnown ? fmtInt(it.cogs) : '—'}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${toneOf(it.costKnown ? it.grossProfit : null)}`}>
                        {it.costKnown ? fmtInt(it.grossProfit) : '—'}
                      </td>
                      <td className={`px-4 py-1.5 text-right tabular-nums ${toneOf(it.marginPct)}`}>
                        {it.marginPct == null ? '—' : `${it.marginPct.toFixed(1)}%`}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-800/50 border-t-2 border-slate-700 font-bold">
              <td className="px-4 py-2.5 sticky left-0 bg-slate-800/95 z-10 text-slate-100">Gross profit on goods</td>
              {pl.periods.map((p) => {
                const { text, tone } = cellText(p, measure);
                return <td key={p.key} className={`px-3 py-2.5 text-right tabular-nums ${tone}`}>{text}</td>;
              })}
              <td className="px-3 py-2.5 text-right tabular-nums text-slate-100 border-l border-slate-700">{fmtInt(t.revenue)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">{t.costKnown ? fmtInt(t.cogs) : '—'}</td>
              <td className={`px-3 py-2.5 text-right tabular-nums ${toneOf(t.costKnown ? t.grossProfit : null)}`}>
                {t.costKnown ? fmtInt(t.grossProfit) : '—'}
              </td>
              <td className={`px-4 py-2.5 text-right tabular-nums ${toneOf(t.marginPct)}`}>
                {t.marginPct == null ? '—' : `${t.marginPct.toFixed(1)}%`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-[10px] text-slate-600 max-w-3xl">
        <span className="text-slate-500 font-semibold">Gross profit on goods only.</span> Revenue is the delivered quantity at
        its sales-order unit price, excluding PPN; cost is the moving-average landed cost the stock ledger stamped when the
        goods went out. Salaries, rent, freight-out, bank charges and tax are not in ICAPROC, so nothing below the gross line
        can be shown here — this is the trading margin, not the company&rsquo;s net result.
      </p>
    </div>
  );
}

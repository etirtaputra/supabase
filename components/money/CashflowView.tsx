'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useMoney } from '@/context/MoneyContext';

// ── Constants ─────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const INCOME_TYPES  = new Set(['Inc', 'IncBal']);
const EXPENSE_TYPES = new Set(['Exp', 'ExpBal']);

const OVERRIDES_KEY  = 'money_cashflow_overrides';
const CUSTOM_CATS_KEY = 'money_cashflow_custom_cats';

// ── Types ──────────────────────────────────────────────────────

// { [year]: { [`Inc|Salary`]: { [`3`]: 5000 } } }
type AllOverrides    = Record<string, Record<string, Record<string, number>>>;
// { [year]: { inc: string[]; exp: string[] } }
type CustomCategories = Record<string, { inc: string[]; exp: string[] }>;

// ── Local-storage helpers ──────────────────────────────────────

function loadJSON<T>(key: string, fallback: T): T {
  try {
    if (typeof window === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}
function saveJSON(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

// ── Number formatter ──────────────────────────────────────────

function fmt(n: number, showZero = false): string {
  if (n === 0) return showZero ? '0' : '—';
  const abs = Math.abs(n);
  let s: string;
  if      (abs >= 1_000_000_000) s = `${(abs / 1_000_000_000).toFixed(1)}B`;
  else if (abs >= 1_000_000)     s = `${(abs / 1_000_000).toFixed(1)}M`;
  else if (abs >= 1_000)         s = `${(abs / 1_000).toFixed(1)}K`;
  else                           s = abs.toFixed(0);
  return n < 0 ? `(${s})` : s;
}

// ── Main component ────────────────────────────────────────────

export default function CashflowView() {
  const { allTransactions } = useMoney();

  const [year,       setYear]       = useState(() => new Date().getFullYear());
  const [overrides,  setOverrides]  = useState<AllOverrides>({});
  const [customCats, setCustomCats] = useState<CustomCategories>({});

  // Inline-edit state
  const [editCell, setEditCell] = useState<{ key: string; mi: number } | null>(null);
  const [editVal,  setEditVal]  = useState('');

  // Add-category state
  const [addingCat,   setAddingCat]   = useState<'inc' | 'exp' | null>(null);
  const [newCatName,  setNewCatName]  = useState('');

  // Load persisted data on mount
  useEffect(() => {
    setOverrides(loadJSON<AllOverrides>(OVERRIDES_KEY, {}));
    setCustomCats(loadJSON<CustomCategories>(CUSTOM_CATS_KEY, {}));
  }, []);

  // ── Date helpers ──────────────────────────────────────────
  const today   = new Date();
  const cy      = today.getFullYear();
  const cm      = today.getMonth(); // 0-indexed

  const isFuture  = (mi: number) => year > cy || (year === cy && mi > cm);
  const isCurrent = (mi: number) => year === cy && mi === cm;

  const yearStr  = String(year);
  const yearStart = `${yearStr}-01-01`;
  const yearEnd   = `${yearStr}-12-31`;

  // ── Derived data ──────────────────────────────────────────

  const yearTxns = useMemo(
    () => allTransactions.filter(t => t.date >= yearStart && t.date <= yearEnd),
    [allTransactions, yearStart, yearEnd]
  );

  const beforeTxns = useMemo(
    () => allTransactions.filter(t => t.date < yearStart),
    [allTransactions, yearStart]
  );

  // Opening balance = net of ALL transactions before Jan 1 of selected year
  const openingBalance = useMemo(() => {
    let b = 0;
    for (const t of beforeTxns) {
      if (INCOME_TYPES.has(t.type))  b += t.amount;
      else if (EXPENSE_TYPES.has(t.type)) b -= t.amount;
    }
    return b;
  }, [beforeTxns]);

  // Actual amounts per (type, category, month)
  const actualMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of yearTxns) {
      const mi = parseInt(t.date.slice(5, 7), 10) - 1;
      const tp = INCOME_TYPES.has(t.type) ? 'Inc'
               : EXPENSE_TYPES.has(t.type) ? 'Exp' : null;
      if (!tp || !t.category) continue;
      const key = `${tp}|${t.category}|${mi}`;
      m.set(key, (m.get(key) ?? 0) + t.amount);
    }
    return m;
  }, [yearTxns]);

  // All unique income/expense categories (actual + custom + from overrides)
  const incomeCategories = useMemo(() => {
    const s = new Set<string>();
    for (const t of allTransactions)
      if (INCOME_TYPES.has(t.type) && t.category) s.add(t.category);
    for (const k of Object.keys(overrides[yearStr] ?? {})) {
      const [tp, cat] = k.split('|');
      if (tp === 'Inc' && cat) s.add(cat);
    }
    for (const c of customCats[yearStr]?.inc ?? []) s.add(c);
    return [...s].sort();
  }, [allTransactions, overrides, customCats, yearStr]);

  const expenseCategories = useMemo(() => {
    const s = new Set<string>();
    for (const t of allTransactions)
      if (EXPENSE_TYPES.has(t.type) && t.category) s.add(t.category);
    for (const k of Object.keys(overrides[yearStr] ?? {})) {
      const [tp, cat] = k.split('|');
      if (tp === 'Exp' && cat) s.add(cat);
    }
    for (const c of customCats[yearStr]?.exp ?? []) s.add(c);
    return [...s].sort();
  }, [allTransactions, overrides, customCats, yearStr]);

  // ── Cell value lookup ─────────────────────────────────────

  const getVal = useCallback((tp: string, cat: string, mi: number): number => {
    const actual = actualMap.get(`${tp}|${cat}|${mi}`) ?? 0;
    // Past/current: always show actual
    if (!isFuture(mi)) return actual;
    // Future: use override if set, else actual (e.g. already-entered future txn)
    const ovr = overrides[yearStr]?.[`${tp}|${cat}`]?.[String(mi)];
    return ovr !== undefined ? ovr : actual;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actualMap, overrides, yearStr, year, cy, cm]);

  const hasOvr = (tp: string, cat: string, mi: number): boolean =>
    overrides[yearStr]?.[`${tp}|${cat}`]?.[String(mi)] !== undefined;

  // ── Monthly totals and cumulative balances ─────────────────

  const monthly = useMemo(() => MONTHS.map((_, mi) => {
    const inc = incomeCategories.reduce((s, c) => s + getVal('Inc', c, mi), 0);
    const exp = expenseCategories.reduce((s, c) => s + getVal('Exp', c, mi), 0);
    return { inc, exp, net: inc - exp };
  }), [incomeCategories, expenseCategories, getVal]);

  const balances = useMemo(() => {
    let run = openingBalance;
    return MONTHS.map((_, mi) => {
      const open = run;
      run += monthly[mi].net;
      return { open, close: run };
    });
  }, [openingBalance, monthly]);

  const annInc = monthly.reduce((s, m) => s + m.inc, 0);
  const annExp = monthly.reduce((s, m) => s + m.exp, 0);
  const annNet = annInc - annExp;

  // ── Edit handlers ─────────────────────────────────────────

  const startEdit = (tp: string, cat: string, mi: number) => {
    if (!isFuture(mi)) return;
    const cur = getVal(tp, cat, mi);
    setEditCell({ key: `${tp}|${cat}`, mi });
    setEditVal(cur === 0 ? '' : String(cur));
  };

  const commitEdit = useCallback(() => {
    if (!editCell) return;
    const n = parseFloat(editVal);
    const { key, mi } = editCell;

    setOverrides(prev => {
      const catData = { ...((prev[yearStr] ?? {})[key] ?? {}) };
      if (isNaN(n) || n === 0) {
        delete catData[String(mi)];
      } else {
        catData[String(mi)] = n;
      }
      const yearData = { ...(prev[yearStr] ?? {}), [key]: catData };
      if (Object.keys(catData).length === 0) delete yearData[key];
      const next = { ...prev, [yearStr]: yearData };
      saveJSON(OVERRIDES_KEY, next);
      return next;
    });
    setEditCell(null);
  }, [editCell, editVal, yearStr]);

  const clearOvr = (tp: string, cat: string, mi: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const key = `${tp}|${cat}`;
    setOverrides(prev => {
      const catData = { ...((prev[yearStr] ?? {})[key] ?? {}) };
      delete catData[String(mi)];
      const yearData = { ...(prev[yearStr] ?? {}), [key]: catData };
      if (Object.keys(catData).length === 0) delete yearData[key];
      const next = { ...prev, [yearStr]: yearData };
      saveJSON(OVERRIDES_KEY, next);
      return next;
    });
  };

  const addCategory = (type: 'inc' | 'exp') => {
    const name = newCatName.trim();
    if (!name) return;
    setCustomCats(prev => {
      const yd = prev[yearStr] ?? { inc: [], exp: [] };
      const list = type === 'inc' ? yd.inc : yd.exp;
      if (list.includes(name)) return prev;
      const next = {
        ...prev,
        [yearStr]: { ...yd, [type]: [...list, name] },
      };
      saveJSON(CUSTOM_CATS_KEY, next);
      return next;
    });
    setNewCatName('');
    setAddingCat(null);
  };

  // ── Cell renderer (plain function, not a React component) ──
  // Returning JSX directly avoids unmount/remount of <input> during edits.

  const renderCell = (tp: string, cat: string, mi: number) => {
    const val     = getVal(tp, cat, mi);
    const future  = isFuture(mi);
    const current = isCurrent(mi);
    const ovr     = hasOvr(tp, cat, mi);
    const isEdit  = editCell?.key === `${tp}|${cat}` && editCell?.mi === mi;

    const bg = current
      ? 'bg-violet-900/20'
      : future
        ? 'bg-slate-800/20'
        : '';

    if (isEdit) {
      return (
        <td key={mi} className={`px-1 py-1 ${bg}`}>
          <input
            autoFocus
            type="number"
            value={editVal}
            onChange={e => setEditVal(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => {
              if (e.key === 'Enter')  commitEdit();
              if (e.key === 'Escape') setEditCell(null);
            }}
            className="w-14 bg-violet-900/80 border border-violet-400 rounded px-1 py-0.5 text-white text-xs text-right focus:outline-none focus:ring-1 focus:ring-violet-400"
          />
        </td>
      );
    }

    const color = tp === 'Inc' ? 'text-emerald-400' : 'text-rose-400';

    return (
      <td
        key={mi}
        onClick={() => future && startEdit(tp, cat, mi)}
        title={future ? 'Click to set projection' : undefined}
        className={[
          'px-2 py-1.5 text-right text-xs tabular-nums group',
          color, bg,
          val === 0 ? 'opacity-30' : '',
          future ? 'cursor-pointer hover:bg-violet-900/30' : '',
        ].join(' ')}
      >
        <span className={ovr ? 'border-b border-dotted border-current' : ''}>
          {fmt(val)}
        </span>
        {ovr && future && (
          <button
            onClick={e => clearOvr(tp, cat, mi, e)}
            className="ml-0.5 text-[10px] text-slate-500 hover:text-rose-400 opacity-0 group-hover:opacity-100"
            title="Clear projection"
          >×</button>
        )}
      </td>
    );
  };

  // Summary cell (read-only)
  const SumCell = ({ val, mi, color }: { val: number; mi: number; color: string }) => {
    const bg = isCurrent(mi) ? 'bg-violet-900/20' : isFuture(mi) ? 'bg-slate-800/20' : '';
    return (
      <td className={`px-2 py-2 text-right text-xs font-bold tabular-nums ${color} ${bg}`}>
        {fmt(val, true)}
      </td>
    );
  };

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-slate-950">

      {/* ── Year selector + legend ── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700/50 shrink-0 bg-slate-900/60">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setYear(y => y - 1)}
            className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors text-lg leading-none"
          >‹</button>
          <span className="text-white font-bold text-base w-14 text-center">{year}</span>
          <button
            onClick={() => setYear(y => y + 1)}
            className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors text-lg leading-none"
          >›</button>
        </div>

        <div className="flex items-center gap-3 text-[11px]">
          <span className="hidden sm:flex items-center gap-1.5 text-slate-400">
            <span className="w-2 h-2 rounded-full bg-slate-600 inline-block" />
            Actual
          </span>
          <span className="flex items-center gap-1.5 text-violet-400">
            <span className="w-2 h-2 rounded-full bg-violet-600 inline-block" />
            <span className="hidden sm:inline">Tap to project</span>
            <span className="sm:hidden">Tap future cells</span>
          </span>
          <span className="hidden sm:flex items-center gap-1.5 text-slate-400">
            <span className="w-2 h-2 rounded-full bg-violet-800 border border-violet-400 inline-block" />
            Projected
          </span>
        </div>
      </div>

      {/* ── Scrollable table ── */}
      <div className="flex-1 overflow-auto">
        <table className="border-collapse text-sm" style={{ minWidth: '860px', width: '100%' }}>

          {/* ── Header ── */}
          <thead className="sticky top-0 z-20 bg-slate-900">
            <tr>
              <th className="sticky left-0 z-30 bg-slate-900 text-left pl-4 pr-3 py-2.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-r border-slate-700/50 min-w-[140px] max-w-[180px]">
                Category
              </th>
              {MONTHS.map((name, mi) => (
                <th
                  key={mi}
                  className={[
                    'px-2 py-2.5 text-right text-[11px] font-semibold tracking-wide border-b border-slate-700/50 min-w-[58px]',
                    isCurrent(mi) ? 'text-violet-400 bg-violet-900/20' : isFuture(mi) ? 'text-slate-500' : 'text-slate-300',
                  ].join(' ')}
                >
                  {name}
                </th>
              ))}
              <th className="px-3 py-2.5 text-right text-[11px] font-semibold text-slate-300 uppercase tracking-wide border-b border-l border-slate-700/50 min-w-[72px]">
                Full Yr
              </th>
            </tr>
          </thead>

          <tbody>

            {/* ════════════ INCOME ════════════ */}
            <tr>
              <td colSpan={14} className="sticky left-0 pl-4 py-1.5 text-[11px] font-bold text-emerald-500 uppercase tracking-widest bg-emerald-950/50 border-y border-emerald-900/40">
                ▸ Income
              </td>
            </tr>

            {incomeCategories.length === 0 && (
              <tr>
                <td colSpan={14} className="pl-6 py-3 text-xs text-slate-500 italic">
                  No income transactions yet — add transactions or click &quot;+ Add category&quot; below to plan projections.
                </td>
              </tr>
            )}

            {incomeCategories.map(cat => (
              <tr key={`inc-${cat}`} className="group/row hover:bg-slate-800/20 border-b border-slate-700/10">
                <td className="sticky left-0 bg-slate-950 group-hover/row:bg-slate-800/40 pl-6 pr-3 py-1.5 text-xs text-slate-300 border-r border-slate-700/30 truncate max-w-[180px]">
                  {cat}
                </td>
                {MONTHS.map((_, mi) => renderCell('Inc', cat, mi))}
                <td className="px-3 py-1.5 text-right text-xs font-semibold tabular-nums text-emerald-400 border-l border-slate-700/30">
                  {fmt(MONTHS.reduce((s, _, mi) => s + getVal('Inc', cat, mi), 0))}
                </td>
              </tr>
            ))}

            {/* Add income category row */}
            <tr className="border-b border-slate-700/10">
              <td colSpan={14} className="pl-6 py-1.5">
                {addingCat === 'inc' ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={newCatName}
                      onChange={e => setNewCatName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter')  addCategory('inc');
                        if (e.key === 'Escape') { setAddingCat(null); setNewCatName(''); }
                      }}
                      placeholder="Category name…"
                      className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-violet-500 w-44"
                    />
                    <button onClick={() => addCategory('inc')}
                      className="text-xs text-emerald-400 hover:text-emerald-300 px-2 py-1 bg-emerald-900/30 rounded transition-colors">
                      Add
                    </button>
                    <button onClick={() => { setAddingCat(null); setNewCatName(''); }}
                      className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setAddingCat('inc')}
                    className="flex items-center gap-1 text-xs text-slate-600 hover:text-emerald-400 py-0.5 transition-colors">
                    <span className="text-sm leading-none">+</span>
                    Add income category
                  </button>
                )}
              </td>
            </tr>

            {/* Total Income */}
            <tr className="bg-emerald-950/30 border-t border-emerald-900/40">
              <td className="sticky left-0 bg-emerald-950/50 pl-4 pr-3 py-2 text-xs font-bold text-emerald-200 uppercase tracking-wide border-r border-slate-700/30">
                Total Income
              </td>
              {MONTHS.map((_, mi) => (
                <SumCell key={mi} val={monthly[mi].inc} mi={mi} color="text-emerald-300" />
              ))}
              <td className="px-3 py-2 text-right text-xs font-bold tabular-nums text-emerald-200 border-l border-slate-700/30">
                {fmt(annInc, true)}
              </td>
            </tr>

            {/* Spacer */}
            <tr><td colSpan={14} className="h-3 bg-slate-950" /></tr>

            {/* ════════════ EXPENSES ════════════ */}
            <tr>
              <td colSpan={14} className="sticky left-0 pl-4 py-1.5 text-[11px] font-bold text-rose-500 uppercase tracking-widest bg-rose-950/50 border-y border-rose-900/40">
                ▸ Expenses
              </td>
            </tr>

            {expenseCategories.length === 0 && (
              <tr>
                <td colSpan={14} className="pl-6 py-3 text-xs text-slate-500 italic">
                  No expense transactions yet — add transactions or click &quot;+ Add category&quot; below to plan projections.
                </td>
              </tr>
            )}

            {expenseCategories.map(cat => (
              <tr key={`exp-${cat}`} className="group/row hover:bg-slate-800/20 border-b border-slate-700/10">
                <td className="sticky left-0 bg-slate-950 group-hover/row:bg-slate-800/40 pl-6 pr-3 py-1.5 text-xs text-slate-300 border-r border-slate-700/30 truncate max-w-[180px]">
                  {cat}
                </td>
                {MONTHS.map((_, mi) => renderCell('Exp', cat, mi))}
                <td className="px-3 py-1.5 text-right text-xs font-semibold tabular-nums text-rose-400 border-l border-slate-700/30">
                  {fmt(MONTHS.reduce((s, _, mi) => s + getVal('Exp', cat, mi), 0))}
                </td>
              </tr>
            ))}

            {/* Add expense category row */}
            <tr className="border-b border-slate-700/10">
              <td colSpan={14} className="pl-6 py-1.5">
                {addingCat === 'exp' ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={newCatName}
                      onChange={e => setNewCatName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter')  addCategory('exp');
                        if (e.key === 'Escape') { setAddingCat(null); setNewCatName(''); }
                      }}
                      placeholder="Category name…"
                      className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-violet-500 w-44"
                    />
                    <button onClick={() => addCategory('exp')}
                      className="text-xs text-rose-400 hover:text-rose-300 px-2 py-1 bg-rose-900/30 rounded transition-colors">
                      Add
                    </button>
                    <button onClick={() => { setAddingCat(null); setNewCatName(''); }}
                      className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setAddingCat('exp')}
                    className="flex items-center gap-1 text-xs text-slate-600 hover:text-rose-400 py-0.5 transition-colors">
                    <span className="text-sm leading-none">+</span>
                    Add expense category
                  </button>
                )}
              </td>
            </tr>

            {/* Total Expenses */}
            <tr className="bg-rose-950/30 border-t border-rose-900/40">
              <td className="sticky left-0 bg-rose-950/50 pl-4 pr-3 py-2 text-xs font-bold text-rose-200 uppercase tracking-wide border-r border-slate-700/30">
                Total Expenses
              </td>
              {MONTHS.map((_, mi) => (
                <SumCell key={mi} val={monthly[mi].exp} mi={mi} color="text-rose-300" />
              ))}
              <td className="px-3 py-2 text-right text-xs font-bold tabular-nums text-rose-200 border-l border-slate-700/30">
                {fmt(annExp, true)}
              </td>
            </tr>

            {/* Spacer */}
            <tr><td colSpan={14} className="h-3 bg-slate-950" /></tr>

            {/* ════════════ NET / BALANCES ════════════ */}

            {/* Net Cashflow */}
            <tr className="border-t-2 border-slate-600/60 bg-slate-900/50">
              <td className="sticky left-0 bg-slate-900 pl-4 pr-3 py-2.5 text-xs font-bold text-white uppercase tracking-wide border-r border-slate-700/30">
                Net Cashflow
              </td>
              {MONTHS.map((_, mi) => {
                const v = monthly[mi].net;
                const c = v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-slate-500';
                return <SumCell key={mi} val={v} mi={mi} color={c} />;
              })}
              <td className={`px-3 py-2.5 text-right text-xs font-bold tabular-nums border-l border-slate-700/30 ${annNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {fmt(annNet, true)}
              </td>
            </tr>

            {/* Opening Balance */}
            <tr className="bg-slate-900/30">
              <td className="sticky left-0 bg-slate-900/50 pl-4 pr-3 py-2 text-xs text-slate-400 border-r border-slate-700/30">
                Opening Balance
              </td>
              {MONTHS.map((_, mi) => {
                const v = balances[mi].open;
                const c = v > 0 ? 'text-sky-400' : v < 0 ? 'text-rose-400' : 'text-slate-500';
                return <SumCell key={mi} val={v} mi={mi} color={c} />;
              })}
              <td className="px-3 border-l border-slate-700/30" />
            </tr>

            {/* Closing Balance */}
            <tr className="bg-slate-900/60 border-t border-slate-700/40">
              <td className="sticky left-0 bg-slate-900 pl-4 pr-3 py-3 text-xs font-bold text-sky-200 border-r border-slate-700/30">
                Closing Balance
              </td>
              {MONTHS.map((_, mi) => {
                const v = balances[mi].close;
                const c = v > 0 ? 'text-sky-300' : v < 0 ? 'text-rose-300' : 'text-slate-500';
                return <SumCell key={mi} val={v} mi={mi} color={c} />;
              })}
              <td className={`px-3 py-3 text-right text-xs font-bold tabular-nums border-l border-slate-700/30 ${balances[11].close >= 0 ? 'text-sky-300' : 'text-rose-300'}`}>
                {fmt(balances[11].close, true)}
              </td>
            </tr>

            {/* Bottom padding for mobile nav */}
            <tr><td colSpan={14} className="h-20 lg:h-4 bg-slate-950" /></tr>

          </tbody>
        </table>
      </div>
    </div>
  );
}

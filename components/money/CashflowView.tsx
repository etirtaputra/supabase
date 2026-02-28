'use client';

import { Fragment, useState, useMemo, useCallback, useEffect } from 'react';
import { useMoney } from '@/context/MoneyContext';

// ── Constants ──────────────────────────────────────────────────────────────

const MONTHS        = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const INCOME_TYPES  = new Set(['Inc', 'IncBal']);
const EXPENSE_TYPES = new Set(['Exp', 'ExpBal']);

const LS_OVERRIDES = 'money_cf3_overrides';  // { [year][Inc|Exp][cat][sub][mi]: number }
const LS_CUSTOM    = 'money_cf3_custom';     // { [year].inc/exp: [{cat,sub}] }
const LS_COLLAPSED = 'money_cf3_collapsed';  // { [`${year}-${tp}-${cat}`]: true }

// ── Types ──────────────────────────────────────────────────────────────────

type Overrides  = Record<string, Record<string, Record<string, Record<string, Record<string, number>>>>>;
type CustomRows = Record<string, { inc: Array<{cat:string;sub:string}>; exp: Array<{cat:string;sub:string}> }>;
type Collapsed  = Record<string, boolean>;

// ── Storage helpers ────────────────────────────────────────────────────────

function lsGet<T>(key: string, fb: T): T {
  try {
    if (typeof window === 'undefined') return fb;
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) as T : fb;
  } catch { return fb; }
}
function lsSet(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
}

// ── Number formatter ───────────────────────────────────────────────────────

function fmt(n: number, forceShow = false): string {
  if (n === 0) return forceShow ? '0' : '—';
  const abs = Math.abs(n);
  let s: string;
  if      (abs >= 1e9) s = `${(abs / 1e9).toFixed(1)}B`;
  else if (abs >= 1e6) s = `${(abs / 1e6).toFixed(1)}M`;
  else if (abs >= 1e3) s = `${(abs / 1e3).toFixed(1)}K`;
  else                 s = abs.toFixed(0);
  return n < 0 ? `(${s})` : s;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function CashflowView() {
  const { allTransactions } = useMoney();

  const [year,       setYear]       = useState(() => new Date().getFullYear());
  const [overrides,  setOverrides]  = useState<Overrides>({});
  const [customRows, setCustomRows] = useState<CustomRows>({});
  const [collapsed,  setCollapsed]  = useState<Collapsed>({});

  // Inline-edit state
  const [editCell, setEditCell] = useState<{tp:string;cat:string;sub:string;mi:number}|null>(null);
  const [editVal,  setEditVal]  = useState('');

  // Add line-item state
  const [addingRowTo, setAddingRowTo] = useState<{tp:string;cat:string}|null>(null);
  const [newRowName,  setNewRowName]  = useState('');

  // Add category state
  const [addingCat,  setAddingCat]  = useState<string|null>(null); // 'Inc'|'Exp'
  const [newCatName, setNewCatName] = useState('');

  useEffect(() => {
    setOverrides (lsGet<Overrides> (LS_OVERRIDES, {}));
    setCustomRows(lsGet<CustomRows>(LS_CUSTOM,    {}));
    setCollapsed (lsGet<Collapsed> (LS_COLLAPSED, {}));
  }, []);

  // ── Date helpers ───────────────────────────────────────────────────────

  const today = new Date();
  const cy = today.getFullYear(), cm = today.getMonth();

  const isFuture  = (mi: number) => year > cy || (year === cy && mi > cm);
  const isCurrent = (mi: number) => year === cy && mi === cm;

  const yearStr   = String(year);
  const yearStart = `${yearStr}-01-01`;
  const yearEnd   = `${yearStr}-12-31`;

  // ── Transaction data ───────────────────────────────────────────────────

  const yearTxns = useMemo(
    () => allTransactions.filter(t => t.date >= yearStart && t.date <= yearEnd),
    [allTransactions, yearStart, yearEnd]
  );
  const beforeTxns = useMemo(
    () => allTransactions.filter(t => t.date < yearStart),
    [allTransactions, yearStart]
  );

  const openingBalance = useMemo(() => {
    let b = 0;
    for (const t of beforeTxns) {
      if      (INCOME_TYPES.has(t.type))  b += t.amount;
      else if (EXPENSE_TYPES.has(t.type)) b -= t.amount;
    }
    return b;
  }, [beforeTxns]);

  // Actual amounts: key = `${tp}|${cat}|${sub}|${mi}`
  const actualMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of yearTxns) {
      const mi  = parseInt(t.date.slice(5, 7), 10) - 1;
      const tp  = INCOME_TYPES.has(t.type) ? 'Inc' : EXPENSE_TYPES.has(t.type) ? 'Exp' : null;
      if (!tp) continue;
      const cat = t.category    || 'Other';
      const sub = t.subcategory || '';
      const k   = `${tp}|${cat}|${sub}|${mi}`;
      m.set(k, (m.get(k) ?? 0) + t.amount);
    }
    return m;
  }, [yearTxns]);

  // Category → subcategory maps
  const { incMap, expMap } = useMemo(() => {
    const inc = new Map<string, Set<string>>();
    const exp = new Map<string, Set<string>>();
    const add = (m: Map<string, Set<string>>, cat: string, sub: string) => {
      if (!m.has(cat)) m.set(cat, new Set());
      m.get(cat)!.add(sub);
    };
    // From all-time transactions (keeps categories visible across years)
    for (const t of allTransactions) {
      const cat = t.category || 'Other', sub = t.subcategory || '';
      if      (INCOME_TYPES.has(t.type))  add(inc, cat, sub);
      else if (EXPENSE_TYPES.has(t.type)) add(exp, cat, sub);
    }
    // From overrides (this year)
    for (const [cat, sm] of Object.entries(overrides[yearStr]?.Inc ?? {}))
      for (const sub of Object.keys(sm)) add(inc, cat, sub);
    for (const [cat, sm] of Object.entries(overrides[yearStr]?.Exp ?? {}))
      for (const sub of Object.keys(sm)) add(exp, cat, sub);
    // From custom rows
    for (const { cat, sub } of customRows[yearStr]?.inc ?? []) add(inc, cat, sub);
    for (const { cat, sub } of customRows[yearStr]?.exp ?? []) add(exp, cat, sub);
    return { incMap: inc, expMap: exp };
  }, [allTransactions, overrides, customRows, yearStr]);

  const incCats = useMemo(() => [...incMap.keys()].sort(), [incMap]);
  const expCats = useMemo(() => [...expMap.keys()].sort(), [expMap]);

  // ── Value getters ──────────────────────────────────────────────────────

  const getVal = useCallback((tp: string, cat: string, sub: string, mi: number): number => {
    const actual = actualMap.get(`${tp}|${cat}|${sub}|${mi}`) ?? 0;
    if (!isFuture(mi)) return actual;
    const ovr = overrides[yearStr]?.[tp]?.[cat]?.[sub]?.[String(mi)];
    return ovr !== undefined ? ovr : actual;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actualMap, overrides, yearStr, year, cy, cm]);

  const hasOvr = (tp: string, cat: string, sub: string, mi: number) =>
    overrides[yearStr]?.[tp]?.[cat]?.[sub]?.[String(mi)] !== undefined;

  const catMonthSum = useCallback((tp: string, cat: string, mi: number): number => {
    const subs = (tp === 'Inc' ? incMap : expMap).get(cat) ?? new Set<string>();
    return [...subs].reduce((s, sub) => s + getVal(tp, cat, sub, mi), 0);
  }, [incMap, expMap, getVal]);

  const subAnnual = (tp: string, cat: string, sub: string) =>
    MONTHS.reduce((s, _, mi) => s + getVal(tp, cat, sub, mi), 0);

  const catAnnual = (tp: string, cat: string) =>
    MONTHS.reduce((s, _, mi) => s + catMonthSum(tp, cat, mi), 0);

  // Monthly grand totals + cascading balances
  const monthly = useMemo(() => MONTHS.map((_, mi) => {
    const inc = incCats.reduce((s, cat) => s + catMonthSum('Inc', cat, mi), 0);
    const exp = expCats.reduce((s, cat) => s + catMonthSum('Exp', cat, mi), 0);
    return { inc, exp, net: inc - exp };
  }), [incCats, expCats, catMonthSum]);

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

  // ── Collapse toggle ────────────────────────────────────────────────────

  const ck = (tp: string, cat: string) => `${yearStr}-${tp}-${cat}`;
  const isCollapsed  = (tp: string, cat: string) => collapsed[ck(tp, cat)] ?? false;
  const toggleCollapse = (tp: string, cat: string) =>
    setCollapsed(prev => {
      const next = { ...prev, [ck(tp, cat)]: !prev[ck(tp, cat)] };
      lsSet(LS_COLLAPSED, next);
      return next;
    });

  // ── Edit handlers ──────────────────────────────────────────────────────

  const startEdit = (tp: string, cat: string, sub: string, mi: number) => {
    if (!isFuture(mi)) return;
    setEditCell({ tp, cat, sub, mi });
    const cur = getVal(tp, cat, sub, mi);
    setEditVal(cur === 0 ? '' : String(cur));
  };

  const commitEdit = useCallback(() => {
    if (!editCell) return;
    const { tp, cat, sub, mi } = editCell;
    const n = parseFloat(editVal);
    setOverrides(prev => {
      const yd = prev[yearStr] ?? {};
      const td = yd[tp] ?? {};
      const cd = td[cat] ?? {};
      const sd = { ...(cd[sub] ?? {}) };
      if (isNaN(n) || n === 0) delete sd[String(mi)]; else sd[String(mi)] = n;
      const next: Overrides = {
        ...prev,
        [yearStr]: { ...yd, [tp]: { ...td, [cat]: { ...cd, [sub]: sd } } },
      };
      lsSet(LS_OVERRIDES, next);
      return next;
    });
    setEditCell(null);
  }, [editCell, editVal, yearStr]);

  const clearOvr = (tp: string, cat: string, sub: string, mi: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setOverrides(prev => {
      const yd = { ...prev[yearStr] };
      const td = { ...yd[tp] };
      const cd = { ...td[cat] };
      const sd = { ...cd[sub] };
      delete sd[String(mi)];
      cd[sub] = sd; td[cat] = cd; yd[tp] = td;
      const next = { ...prev, [yearStr]: yd };
      lsSet(LS_OVERRIDES, next);
      return next;
    });
  };

  // ── Add rows / categories ──────────────────────────────────────────────

  const addRow = (tpLower: 'inc'|'exp', cat: string) => {
    const name = newRowName.trim();
    if (!name) return;
    setCustomRows(prev => {
      const yd = prev[yearStr] ?? { inc: [], exp: [] };
      const list = yd[tpLower];
      if (list.some(r => r.cat === cat && r.sub === name)) return prev;
      const next = { ...prev, [yearStr]: { ...yd, [tpLower]: [...list, { cat, sub: name }] } };
      lsSet(LS_CUSTOM, next);
      return next;
    });
    setNewRowName(''); setAddingRowTo(null);
  };

  const addCat = (tp: 'Inc'|'Exp') => {
    const cat = newCatName.trim();
    if (!cat) return;
    const tpl = tp === 'Inc' ? 'inc' : 'exp';
    setCustomRows(prev => {
      const yd   = prev[yearStr] ?? { inc: [], exp: [] };
      const list = yd[tpl as 'inc'|'exp'];
      const next = { ...prev, [yearStr]: { ...yd, [tpl]: [...list, { cat, sub: '' }] } };
      lsSet(LS_CUSTOM, next);
      return next;
    });
    setNewCatName(''); setAddingCat(null);
  };

  // ── Cell renderers (plain functions — not React components → no remount) ─

  const renderDataCell = (tp: string, cat: string, sub: string, mi: number) => {
    const val    = getVal(tp, cat, sub, mi);
    const future = isFuture(mi);
    const curr   = isCurrent(mi);
    const ovr    = hasOvr(tp, cat, sub, mi);
    const isEdit = editCell?.tp === tp && editCell.cat === cat
                && editCell.sub === sub && editCell.mi === mi;
    const bg     = curr ? 'bg-violet-900/15' : future ? 'bg-slate-800/10' : '';

    if (isEdit) return (
      <td key={mi} className={`px-1 py-0.5 ${bg}`}>
        <input
          autoFocus type="number"
          value={editVal}
          onChange={e => setEditVal(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditCell(null); }}
          className="w-14 bg-violet-900/90 border border-violet-400 rounded px-1 py-0.5 text-white text-[11px] text-right focus:outline-none"
        />
      </td>
    );

    const color = val === 0
      ? 'text-slate-700'
      : tp === 'Inc' ? 'text-emerald-400' : 'text-rose-400';

    return (
      <td
        key={mi}
        onClick={() => future && startEdit(tp, cat, sub, mi)}
        title={future ? 'Click to set projection' : undefined}
        className={`px-2 py-1 text-right text-[11px] tabular-nums group ${color} ${bg}
          ${future ? 'cursor-pointer hover:bg-violet-900/20' : ''}`}
      >
        <span className={ovr ? 'border-b border-dotted border-current' : ''}>{fmt(val)}</span>
        {ovr && future && (
          <button
            onClick={e => clearOvr(tp, cat, sub, mi, e)}
            className="ml-0.5 text-[9px] text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100"
          >×</button>
        )}
      </td>
    );
  };

  // Category subtotal cell (sum of all subs for that month)
  const renderSubtotalCell = (tp: string, cat: string, mi: number) => {
    const val = catMonthSum(tp, cat, mi);
    const bg  = isCurrent(mi) ? 'bg-violet-900/15' : isFuture(mi) ? 'bg-slate-800/10' : '';
    const col = tp === 'Inc' ? 'text-emerald-300' : 'text-rose-300';
    return (
      <td key={mi} className={`px-2 py-1.5 text-right text-[11px] font-semibold tabular-nums ${col} ${bg}`}>
        {fmt(val, true)}
      </td>
    );
  };

  // Grand-total / balance cell
  const renderSummaryCell = (val: number, mi: number, color: string) => {
    const bg = isCurrent(mi) ? 'bg-violet-900/20' : isFuture(mi) ? 'bg-slate-800/15' : '';
    return (
      <td key={mi} className={`px-2 py-2 text-right text-[11px] font-bold tabular-nums ${color} ${bg}`}>
        {fmt(val, true)}
      </td>
    );
  };

  // ── Section renderer ───────────────────────────────────────────────────

  const renderSection = (tp: 'Inc'|'Exp', cats: string[], catMap: Map<string, Set<string>>) => {
    const isInc   = tp === 'Inc';
    const tpLower = isInc ? 'inc' : 'exp' as 'inc'|'exp';

    // Style tokens
    const sectionBg   = isInc ? 'bg-emerald-950/60 border-emerald-900/30 text-emerald-300'
                               : 'bg-rose-950/60 border-rose-900/30 text-rose-300';
    const catBg       = isInc ? 'bg-emerald-950/35' : 'bg-rose-950/35';
    const catText     = isInc ? 'text-emerald-200'  : 'text-rose-200';
    const catAnnCol   = isInc ? 'text-emerald-300'  : 'text-rose-300';
    const subAnnCol   = isInc ? 'text-emerald-500'  : 'text-rose-500';
    const addHover    = isInc ? 'hover:text-emerald-400' : 'hover:text-rose-400';
    const addBtnCls   = isInc ? 'text-emerald-400 bg-emerald-900/30' : 'text-rose-400 bg-rose-900/30';
    const label       = isInc ? 'INCOME' : 'EXPENSES';

    return (
      <>
        {/* Section header */}
        <tr>
          <td colSpan={14}
            className={`pl-4 py-1.5 text-[11px] font-bold tracking-widest uppercase border-y ${sectionBg}`}>
            ▸ {label}
          </td>
        </tr>

        {cats.length === 0 && (
          <tr>
            <td colSpan={14} className="pl-6 py-3 text-xs text-slate-500 italic">
              No {isInc ? 'income' : 'expense'} data yet — add transactions or click below to plan projections.
            </td>
          </tr>
        )}

        {/* Category blocks */}
        {cats.map(cat => {
          const subsSet   = catMap.get(cat) ?? new Set<string>();
          const subs      = [...subsSet].sort();
          const namedSubs = subs.filter(s => s !== '');
          // Expandable = has named subcategories → header shows subtotals, rows shown beneath
          const expandable  = namedSubs.length > 0;
          const catCollapsed = isCollapsed(tp, cat);
          const cAnn        = catAnnual(tp, cat);

          return (
            <Fragment key={`${tp}-${cat}`}>
              {/* Category header row */}
              <tr
                onClick={() => expandable && toggleCollapse(tp, cat)}
                className={`${catBg} border-t border-slate-700/30 ${expandable ? 'cursor-pointer select-none' : ''}`}
              >
                <td className={`sticky left-0 ${catBg} pl-3 pr-3 py-1.5 text-[11px] font-semibold ${catText} border-r border-slate-700/30`}>
                  <span className="flex items-center gap-1.5">
                    {expandable && (
                      <span className="text-[10px] opacity-50 w-3 shrink-0">
                        {catCollapsed ? '▸' : '▾'}
                      </span>
                    )}
                    {cat}
                  </span>
                </td>
                {MONTHS.map((_, mi) =>
                  expandable
                    ? renderSubtotalCell(tp, cat, mi)
                    : renderDataCell(tp, cat, subs[0] ?? '', mi)
                )}
                <td className={`px-3 py-1.5 text-right text-[11px] font-semibold tabular-nums ${catAnnCol} border-l border-slate-700/30`}>
                  {fmt(cAnn)}
                </td>
              </tr>

              {/* Named subcategory line-item rows */}
              {!catCollapsed && namedSubs.map(sub => (
                <tr key={`${tp}-${cat}-${sub}`} className="group/row hover:bg-slate-800/15 border-b border-slate-700/10">
                  <td className="sticky left-0 bg-slate-950 group-hover/row:bg-slate-800/30 pl-8 pr-3 py-1 text-[11px] text-slate-400 border-r border-slate-700/20">
                    {sub}
                  </td>
                  {MONTHS.map((_, mi) => renderDataCell(tp, cat, sub, mi))}
                  <td className={`px-3 py-1 text-right text-[11px] tabular-nums ${subAnnCol} border-l border-slate-700/20`}>
                    {fmt(subAnnual(tp, cat, sub))}
                  </td>
                </tr>
              ))}

              {/* "General" row: empty-sub transactions when named subs also exist */}
              {!catCollapsed && expandable && subsSet.has('') && (
                <tr className="group/row hover:bg-slate-800/15 border-b border-slate-700/10">
                  <td className="sticky left-0 bg-slate-950 group-hover/row:bg-slate-800/30 pl-8 pr-3 py-1 text-[11px] text-slate-500 italic border-r border-slate-700/20">
                    General
                  </td>
                  {MONTHS.map((_, mi) => renderDataCell(tp, cat, '', mi))}
                  <td className={`px-3 py-1 text-right text-[11px] tabular-nums ${subAnnCol} border-l border-slate-700/20`}>
                    {fmt(subAnnual(tp, cat, ''))}
                  </td>
                </tr>
              )}

              {/* Add line-item button */}
              {!catCollapsed && (
                <tr>
                  <td colSpan={14} className="pl-8 py-0.5 bg-slate-950">
                    {addingRowTo?.tp === tp && addingRowTo.cat === cat ? (
                      <div className="flex items-center gap-2 py-0.5">
                        <input
                          autoFocus
                          value={newRowName}
                          onChange={e => setNewRowName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter')  addRow(tpLower, cat);
                            if (e.key === 'Escape') { setAddingRowTo(null); setNewRowName(''); }
                          }}
                          placeholder="Line item name…"
                          className="bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-[11px] text-white focus:outline-none focus:border-violet-500 w-44"
                        />
                        <button onClick={() => addRow(tpLower, cat)} className={`text-[11px] px-2 py-0.5 rounded ${addBtnCls}`}>Add</button>
                        <button onClick={() => { setAddingRowTo(null); setNewRowName(''); }} className="text-[11px] text-slate-500 hover:text-slate-300">Cancel</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setAddingRowTo({ tp, cat })}
                        className={`text-[11px] py-0.5 text-slate-600 ${addHover} transition-colors`}>
                        + add line item
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}

        {/* Add new category */}
        <tr>
          <td colSpan={14} className="pl-4 py-1.5 bg-slate-950/40">
            {addingCat === tp ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={newCatName}
                  onChange={e => setNewCatName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter')  addCat(tp);
                    if (e.key === 'Escape') { setAddingCat(null); setNewCatName(''); }
                  }}
                  placeholder={`${isInc ? 'Income' : 'Expense'} category name…`}
                  className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-violet-500 w-52"
                />
                <button onClick={() => addCat(tp)} className={`text-[11px] px-2 py-1 rounded ${addBtnCls}`}>Add</button>
                <button onClick={() => { setAddingCat(null); setNewCatName(''); }} className="text-[11px] text-slate-500 hover:text-slate-300">Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => setAddingCat(tp)}
                className={`text-[11px] text-slate-600 ${addHover} transition-colors`}>
                + add {isInc ? 'income' : 'expense'} category
              </button>
            )}
          </td>
        </tr>
      </>
    );
  };

  // ── Main render ────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-slate-950">

      {/* Top bar: year nav + year summary */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-slate-700/50 shrink-0 bg-slate-900/60">
        {/* Year navigation */}
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setYear(y => y - 1)}
            className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors text-lg leading-none">‹</button>
          <span className="text-white font-bold text-base w-14 text-center">{year}</span>
          <button onClick={() => setYear(y => y + 1)}
            className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors text-lg leading-none">›</button>
        </div>

        {/* Year summary pills */}
        <div className="flex items-center gap-3 text-[11px] overflow-x-auto min-w-0">
          <span className="text-emerald-400 font-semibold shrink-0">↑ {fmt(annInc)}</span>
          <span className="text-slate-600 shrink-0">–</span>
          <span className="text-rose-400 font-semibold shrink-0">↓ {fmt(annExp)}</span>
          <span className="text-slate-600 shrink-0">=</span>
          <span className={`font-bold shrink-0 ${annNet >= 0 ? 'text-sky-400' : 'text-rose-400'}`}>
            {fmt(annNet, true)}
          </span>
          <span className="text-slate-600 shrink-0 hidden sm:inline">|</span>
          <span className="text-slate-400 shrink-0 hidden sm:inline">Dec bal:</span>
          <span className={`font-semibold shrink-0 hidden sm:inline ${balances[11].close >= 0 ? 'text-sky-300' : 'text-rose-300'}`}>
            {fmt(balances[11].close, true)}
          </span>
        </div>

        <span className="text-[11px] text-violet-400 hidden lg:block shrink-0 ml-auto">
          Tap future cells to project
        </span>
      </div>

      {/* Scrollable table */}
      <div className="flex-1 overflow-auto">
        <table className="border-collapse" style={{ minWidth: '900px', width: '100%' }}>

          {/* Sticky column headers */}
          <thead className="sticky top-0 z-20 bg-slate-900">
            <tr>
              <th className="sticky left-0 z-30 bg-slate-900 text-left pl-4 pr-3 py-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-r border-slate-700/50 min-w-[160px] max-w-[200px]">
                Line Item
              </th>
              {MONTHS.map((name, mi) => (
                <th key={mi} className={[
                  'px-2 py-2 text-center text-[11px] font-semibold border-b border-slate-700/50 min-w-[60px]',
                  isCurrent(mi) ? 'text-violet-300 bg-violet-900/25'
                                : isFuture(mi) ? 'text-slate-500' : 'text-slate-300',
                ].join(' ')}>
                  <div>{name}</div>
                  <div className="text-[9px] mt-0.5 opacity-50">
                    {isCurrent(mi) ? '●' : isFuture(mi) ? '○' : '✓'}
                  </div>
                </th>
              ))}
              <th className="px-3 py-2 text-right text-[11px] font-semibold text-slate-400 uppercase border-b border-l border-slate-700/50 min-w-[68px]">
                Full Yr
              </th>
            </tr>
          </thead>

          <tbody>

            {/* ════════════ INCOME ════════════ */}
            {renderSection('Inc', incCats, incMap)}

            {/* Total Income */}
            <tr className="bg-emerald-950/60 border-t-2 border-emerald-800/60">
              <td className="sticky left-0 bg-emerald-950/70 pl-4 pr-3 py-2 text-[11px] font-bold text-emerald-100 uppercase tracking-wide border-r border-slate-700/30">
                Total Income
              </td>
              {MONTHS.map((_, mi) => renderSummaryCell(monthly[mi].inc, mi, 'text-emerald-200'))}
              <td className="px-3 py-2 text-right text-[11px] font-bold tabular-nums text-emerald-100 border-l border-slate-700/30">
                {fmt(annInc, true)}
              </td>
            </tr>

            <tr><td colSpan={14} className="h-2 bg-slate-950" /></tr>

            {/* ════════════ EXPENSES ════════════ */}
            {renderSection('Exp', expCats, expMap)}

            {/* Total Expenses */}
            <tr className="bg-rose-950/60 border-t-2 border-rose-800/60">
              <td className="sticky left-0 bg-rose-950/70 pl-4 pr-3 py-2 text-[11px] font-bold text-rose-100 uppercase tracking-wide border-r border-slate-700/30">
                Total Expenses
              </td>
              {MONTHS.map((_, mi) => renderSummaryCell(monthly[mi].exp, mi, 'text-rose-200'))}
              <td className="px-3 py-2 text-right text-[11px] font-bold tabular-nums text-rose-100 border-l border-slate-700/30">
                {fmt(annExp, true)}
              </td>
            </tr>

            <tr><td colSpan={14} className="h-2 bg-slate-950" /></tr>

            {/* ════════════ NET / BALANCES ════════════ */}

            {/* Net Cash Flow */}
            <tr className="border-t-2 border-slate-600/70 bg-slate-800/50">
              <td className="sticky left-0 bg-slate-800/70 pl-4 pr-3 py-2.5 text-[11px] font-bold text-white uppercase tracking-wide border-r border-slate-700/30">
                Net Cash Flow
              </td>
              {MONTHS.map((_, mi) => {
                const v = monthly[mi].net;
                return renderSummaryCell(v, mi, v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-slate-500');
              })}
              <td className={`px-3 py-2.5 text-right text-[11px] font-bold tabular-nums border-l border-slate-700/30 ${annNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {fmt(annNet, true)}
              </td>
            </tr>

            {/* Opening Balance */}
            <tr className="bg-slate-900/50">
              <td className="sticky left-0 bg-slate-900/70 pl-4 pr-3 py-1.5 text-[11px] text-slate-400 border-r border-slate-700/30">
                Opening Balance
              </td>
              {MONTHS.map((_, mi) => {
                const v = balances[mi].open;
                return renderSummaryCell(v, mi, v >= 0 ? 'text-sky-400' : 'text-rose-400');
              })}
              <td className="px-3 border-l border-slate-700/30" />
            </tr>

            {/* Closing Balance */}
            <tr className="bg-slate-900/70 border-t border-slate-700/40">
              <td className="sticky left-0 bg-slate-900 pl-4 pr-3 py-3 text-[11px] font-bold text-sky-200 border-r border-slate-700/30">
                Closing Balance
              </td>
              {MONTHS.map((_, mi) => {
                const v = balances[mi].close;
                return renderSummaryCell(v, mi, v >= 0 ? 'text-sky-300' : 'text-rose-300');
              })}
              <td className={`px-3 py-3 text-right text-[11px] font-bold tabular-nums border-l border-slate-700/30 ${balances[11].close >= 0 ? 'text-sky-300' : 'text-rose-300'}`}>
                {fmt(balances[11].close, true)}
              </td>
            </tr>

            {/* Bottom padding for mobile nav bar */}
            <tr><td colSpan={14} className="h-20 lg:h-4 bg-slate-950" /></tr>

          </tbody>
        </table>
      </div>
    </div>
  );
}

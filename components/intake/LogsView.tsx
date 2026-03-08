'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useIntake } from '@/context/IntakeContext';
import { CATEGORY_META, COMMON_UNITS, SERVING_LABELS, ITEM_COLORS } from '@/types/intake';
import type { IntakeItem, IntakeLog } from '@/types/intake';

// ── Helpers ───────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function currentTimeStr(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

function formatDayHeader(dateStr: string): string {
  const today = toDateStr(new Date());
  const yesterday = toDateStr(new Date(Date.now() - 86400000));
  if (dateStr === today) return 'Today';
  if (dateStr === yesterday) return 'Yesterday';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
  });
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function getCalendarDays(year: number, month: number): (string | null)[] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(toDateStr(new Date(year, month, d)));
  return cells;
}

// ── Log Sheet ─────────────────────────────────────────────────

interface PrefillData { itemId: string; amount: number; unit: string; time: string; notes: string; }
interface LogSheetProps { date: string; prefill?: PrefillData; onClose: () => void; }

function LogSheet({ date, prefill, onClose }: LogSheetProps) {
  const { items, handleAddItem, handleAddLog } = useIntake();

  const [query,        setQuery]        = useState('');
  const [selectedItem, setSelected]     = useState<IntakeItem | null>(null);
  const [amount,       setAmount]       = useState('');
  const [servings,     setServings]     = useState('');
  const [unit,         setUnit]         = useState('');
  const [logTime,      setLogTime]      = useState(currentTimeStr());
  const [notes,        setNotes]        = useState('');
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState('');
  const [showDrop,     setShowDrop]     = useState(false);

  const [creatingNew,  setCreatingNew]  = useState(false);
  const [newCat,       setNewCat]       = useState<keyof typeof CATEGORY_META>('supplement');
  const [newUnit,      setNewUnit]      = useState('mg');
  const [newAmt,       setNewAmt]       = useState('1');
  const [newServLabel, setNewServLabel] = useState('');
  const [newServCount, setNewServCount] = useState('1');
  const [newColor,     setNewColor]     = useState('#8b5cf6');
  const [newSaving,    setNewSaving]    = useState(false);

  const queryRef = useRef<HTMLInputElement>(null);

  const selectItem = (item: IntakeItem, amt?: number, u?: string, time?: string, n?: string) => {
    setSelected(item);
    setQuery(item.name);
    setUnit(u ?? item.default_unit);
    if (item.serving_label) {
      const a = amt ?? item.default_amount;
      setServings(String(parseFloat(((a / item.default_amount) * item.serving_count).toFixed(3))));
      setAmount('');
    } else {
      setAmount(String(amt ?? item.default_amount));
      setServings('');
    }
    if (time !== undefined) setLogTime(time);
    if (n    !== undefined) setNotes(n);
    setShowDrop(false);
    setCreatingNew(false);
  };

  useEffect(() => {
    if (prefill) {
      const item = items.find(i => i.id === prefill.itemId);
      if (item) selectItem(item, prefill.amount, prefill.unit, prefill.time, prefill.notes);
    } else {
      queryRef.current?.focus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!creatingNew && query && !selectedItem) {
      const found = items.find(i => i.name.toLowerCase() === query.toLowerCase());
      if (found) selectItem(found);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const filtered   = query.trim() ? items.filter(i => i.name.toLowerCase().includes(query.toLowerCase())) : items;
  const exactMatch = items.some(i => i.name.toLowerCase() === query.toLowerCase().trim());

  const computedAmount = selectedItem?.serving_label
    ? (parseFloat(servings || '0') / selectedItem.serving_count) * selectedItem.default_amount
    : null;

  const handleCreateNew = async () => {
    const name = query.trim();
    if (!name) return;
    setNewSaving(true);
    try {
      await handleAddItem({
        name, category: newCat, default_unit: newUnit,
        default_amount: parseFloat(newAmt) || 1,
        serving_count: parseFloat(newServCount) || 1,
        serving_label: newServLabel,
        color: newColor,
      });
      setUnit(newUnit);
      setAmount(newAmt);
      setCreatingNew(false);
      setQuery(name);
      setShowDrop(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create item');
    } finally { setNewSaving(false); }
  };

  const handleSave = async () => {
    if (!selectedItem) { setError('Please select an item.'); return; }
    let finalAmount: number;
    if (selectedItem.serving_label) {
      const s = parseFloat(servings);
      if (isNaN(s) || s <= 0) { setError('Enter a valid number of servings.'); return; }
      finalAmount = (s / selectedItem.serving_count) * selectedItem.default_amount;
    } else {
      finalAmount = parseFloat(amount);
      if (isNaN(finalAmount) || finalAmount <= 0) { setError('Enter a valid amount.'); return; }
    }
    setSaving(true); setError('');
    try {
      await handleAddLog({ item_id: selectedItem.id, date, amount: finalAmount, unit: unit || selectedItem.default_unit, notes, time_of_day: logTime });
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-h-[92dvh] bg-slate-900 rounded-t-2xl border-t border-slate-700/50 flex flex-col">
        <div className="flex-shrink-0 flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-slate-600 rounded-full" />
        </div>
        <div className="px-4 pb-2 flex items-center justify-between flex-shrink-0">
          <h2 className="text-white font-bold text-base">Log · {formatDayHeader(date)}</h2>
          <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-4 space-y-4 pb-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">What did you take?</label>
            <input ref={queryRef} type="text" value={query}
              onChange={e => { setQuery(e.target.value); setShowDrop(true); setSelected(null); }}
              onFocus={() => setShowDrop(true)}
              placeholder="Search supplements, meds, caffeine…"
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
          </div>

          {showDrop && !selectedItem && (
            <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
              {filtered.length === 0 && !query && <p className="px-4 py-3 text-sm text-slate-500">Start typing to search…</p>}
              {filtered.map(item => {
                const meta = CATEGORY_META[item.category];
                return (
                  <button key={item.id} onClick={() => selectItem(item)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-700 active:bg-slate-600 transition-colors text-left border-b border-slate-700/50 last:border-0">
                    <span className="text-xl shrink-0">{meta.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium truncate">{item.name}</p>
                      <p className="text-[11px] text-slate-400">{meta.label} · {item.default_amount} {item.default_unit}{item.serving_label ? ` · ${item.serving_count} ${item.serving_label}` : ''}</p>
                    </div>
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: item.color }} />
                  </button>
                );
              })}
              {query.trim() && !exactMatch && (
                <button onClick={() => { setCreatingNew(true); setShowDrop(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-violet-900/30 active:bg-violet-900/50 border-t border-slate-700/50 transition-colors text-left">
                  <span className="text-xl">➕</span>
                  <p className="text-sm text-violet-400">Add &ldquo;{query.trim()}&rdquo; as new item</p>
                </button>
              )}
            </div>
          )}

          {creatingNew && (
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold text-violet-400">New item: &ldquo;{query.trim()}&rdquo;</p>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Category</label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(CATEGORY_META) as Array<keyof typeof CATEGORY_META>).map(cat => {
                    const m = CATEGORY_META[cat];
                    return (
                      <button key={cat} onClick={() => setNewCat(cat)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-colors ${newCat === cat ? `${m.bg} ${m.color} ${m.border}` : 'border-slate-700 text-slate-400 hover:text-white'}`}>
                        <span>{m.icon}</span>{m.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Default amount</label>
                  <input type="number" value={newAmt} onChange={e => setNewAmt(e.target.value)} min="0"
                    className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Unit</label>
                  <select value={newUnit} onChange={e => setNewUnit(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                    {COMMON_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Serving type</label>
                  <select value={newServLabel} onChange={e => setNewServLabel(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                    <option value="">None</option>
                    {SERVING_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                {newServLabel && (
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">{newServLabel}s per dose</label>
                    <input type="number" value={newServCount} onChange={e => setNewServCount(e.target.value)} min="1"
                      className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
                  </div>
                )}
              </div>
              {newServLabel && (
                <p className="text-[11px] text-slate-500 bg-slate-900/50 rounded-lg px-3 py-1.5">
                  1 {newServLabel} = {newAmt && newServCount ? (parseFloat(newAmt) / (parseFloat(newServCount) || 1)).toFixed(2) : '?'} {newUnit}
                </p>
              )}
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Color</label>
                <div className="flex gap-2 flex-wrap">
                  {ITEM_COLORS.map(c => (
                    <button key={c} onClick={() => setNewColor(c)}
                      className={`w-7 h-7 rounded-full transition-transform ${newColor === c ? 'ring-2 ring-white scale-110' : ''}`}
                      style={{ background: c }} />
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setCreatingNew(false)} className="flex-1 py-2 border border-slate-600 text-slate-400 rounded-xl text-sm hover:text-white">Cancel</button>
                <button onClick={handleCreateNew} disabled={newSaving} className="flex-1 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold">
                  {newSaving ? 'Creating…' : 'Create & Select'}
                </button>
              </div>
            </div>
          )}

          {selectedItem && (
            <div className="flex items-center gap-3 bg-slate-800/50 rounded-xl px-3 py-2.5">
              <span className="text-xl">{CATEGORY_META[selectedItem.category].icon}</span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-white">{selectedItem.name}</p>
                <p className="text-[11px] text-slate-400">
                  {CATEGORY_META[selectedItem.category].label}
                  {selectedItem.serving_label ? ` · ${selectedItem.serving_count} ${selectedItem.serving_label} = ${selectedItem.default_amount} ${selectedItem.default_unit}` : ''}
                </p>
              </div>
              <button onClick={() => { setSelected(null); setQuery(''); setShowDrop(true); }} className="text-slate-500 hover:text-white p-1">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          )}

          {selectedItem && !creatingNew && (
            selectedItem.serving_label ? (
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">How many {selectedItem.serving_label}s?</label>
                <input type="number" value={servings} onChange={e => setServings(e.target.value)} min="0" step="any"
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" placeholder="0" />
                {computedAmount !== null && computedAmount > 0 && (
                  <p className="text-[11px] text-violet-400 mt-1.5 ml-1">= {parseFloat(computedAmount.toFixed(2))} {selectedItem.default_unit}</p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-5 gap-3">
                <div className="col-span-3">
                  <label className="block text-xs text-slate-400 mb-1.5">Amount</label>
                  <input type="number" value={amount} onChange={e => setAmount(e.target.value)} min="0" step="any"
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" placeholder="0" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-slate-400 mb-1.5">Unit</label>
                  <select value={unit} onChange={e => setUnit(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                    {COMMON_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    {unit && !COMMON_UNITS.includes(unit) && <option value={unit}>{unit}</option>}
                  </select>
                </div>
              </div>
            )
          )}

          {selectedItem && !creatingNew && (
            <>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Time</label>
                <input type="time" value={logTime} onChange={e => setLogTime(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Notes <span className="text-slate-600">(optional)</span></label>
                <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="e.g. with food, before workout…"
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 text-sm placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
              </div>
              {error && <p className="text-rose-400 text-xs bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">{error}</p>}
            </>
          )}
        </div>

        {selectedItem && !creatingNew && (
          <div className="flex-shrink-0 px-4 py-3 border-t border-slate-800 bg-slate-900">
            <button onClick={handleSave} disabled={saving}
              className="w-full py-4 bg-violet-600 hover:bg-violet-500 active:bg-violet-700 disabled:opacity-50 text-white rounded-xl font-bold text-base transition-colors">
              {saving ? 'Saving…' : 'Log Intake'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Log Entry Row (with streak badge) ─────────────────────────

interface LogRowProps {
  log: IntakeLog;
  copyingId: string | null;
  deletingId: string | null;
  onCopy: (log: IntakeLog) => void;
  onDelete: (id: string) => void;
}

function LogRow({ log, copyingId, deletingId, onCopy, onDelete }: LogRowProps) {
  const { items, getStreak } = useIntake();
  const item   = log.item ?? items.find(i => i.id === log.item_id);
  const cat    = item?.category ?? 'other';
  const meta   = CATEGORY_META[cat];
  const streak = getStreak(log.item_id).current;

  // Format the date label for the left column
  const logDate = new Date(log.date + 'T12:00:00');
  const dayAbbr = logDate.toLocaleDateString('en-US', { weekday: 'short' });
  const dateNum = logDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div className="bg-slate-800/70 rounded-xl px-3 py-2 flex items-center gap-2.5">
      {/* Left: time + day/date */}
      <div className="shrink-0 text-right w-11">
        <p className="text-xs font-mono font-semibold text-white leading-tight">
          {log.time_of_day || '—'}
        </p>
        <p className="text-[9px] text-slate-600 leading-tight">{dayAbbr}</p>
        <p className="text-[9px] text-slate-600 leading-tight">{dateNum}</p>
      </div>

      {/* Thin divider */}
      <div className="w-px self-stretch bg-slate-700/60 shrink-0" />

      {/* Icon */}
      <div className="w-7 h-7 rounded-lg flex items-center justify-center text-base shrink-0"
        style={{ background: (item?.color ?? '#6366f1') + '25' }}>
        {meta.icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-sm font-semibold text-white leading-tight">{item?.name ?? 'Unknown'}</p>
          {streak > 0 && (
            <span className="text-[10px] font-bold text-amber-400 shrink-0">🔥{streak}d</span>
          )}
        </div>
        <p className="text-[11px] text-slate-400 leading-tight">
          {log.amount} {log.unit}{log.notes ? ` · ${log.notes}` : ''}
        </p>
      </div>

      {/* Actions */}
      <button onClick={() => onCopy(log)} disabled={!!copyingId} title="Copy to now"
        className="p-1.5 text-slate-600 hover:text-violet-400 disabled:opacity-30 transition-colors shrink-0">
        {copyingId === log.id
          ? <div className="w-4 h-4 rounded-full border border-violet-500 border-t-transparent animate-spin" />
          : <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>}
      </button>
      <button onClick={() => onDelete(log.id)} disabled={deletingId === log.id}
        className="p-1.5 text-slate-600 hover:text-rose-400 disabled:opacity-30 transition-colors shrink-0">
        {deletingId === log.id
          ? <div className="w-4 h-4 rounded-full border border-slate-500 border-t-transparent animate-spin" />
          : <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>}
      </button>
    </div>
  );
}

// ── Main LogsView ─────────────────────────────────────────────

export default function LogsView() {
  const { logs, items, handleDeleteLog, handleAddLog } = useIntake();

  const today = useMemo(() => new Date(), []);
  const todayStr = toDateStr(today);

  const [anchor,     setAnchor]     = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected,   setSelected]   = useState<string>(todayStr);
  const [showSheet,  setShowSheet]  = useState(false);
  const [prefill,    setPrefill]    = useState<PrefillData | undefined>(undefined);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copyingId,  setCopyingId]  = useState<string | null>(null);
  const [toast,      setToast]      = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  const year  = anchor.getFullYear();
  const month = anchor.getMonth();
  const cells = useMemo(() => getCalendarDays(year, month), [year, month]);

  const logsByDate = useMemo(() => {
    const m = new Map<string, IntakeLog[]>();
    for (const log of logs) {
      if (!m.has(log.date)) m.set(log.date, []);
      m.get(log.date)!.push(log);
    }
    return m;
  }, [logs]);

  const selectedLogs = logsByDate.get(selected) ?? [];

  // Summary bar: unique category counts for selected day
  const catCounts = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const log of selectedLogs) {
      const cat = (log.item ?? items.find(i => i.id === log.item_id))?.category ?? 'other';
      acc[cat] = (acc[cat] ?? 0) + 1;
    }
    return acc;
  }, [selectedLogs, items]);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try { await handleDeleteLog(id); }
    finally { setDeletingId(null); }
  };

  const handleCopyToNow = async (log: IntakeLog) => {
    setCopyingId(log.id);
    try {
      await handleAddLog({ item_id: log.item_id, date: todayStr, amount: log.amount, unit: log.unit, notes: log.notes, time_of_day: currentTimeStr() });
      const item = log.item ?? items.find(i => i.id === log.item_id);
      setToast(`Copied ${item?.name ?? 'entry'} to today`);
    } finally { setCopyingId(null); }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-slate-700 text-white text-xs font-semibold px-4 py-2 rounded-full shadow-lg pointer-events-none">
          ✓ {toast}
        </div>
      )}

      <div className="overflow-y-auto flex-1 pb-24">
        {/* Month navigator */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700/50 bg-slate-900/60 shrink-0">
          <button onClick={() => setAnchor(a => addMonths(a, -1))}
            className="p-2 rounded-xl hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <p className="font-bold text-white text-sm">
            {anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </p>
          <button onClick={() => setAnchor(a => addMonths(a, 1))}
            disabled={anchor >= new Date(today.getFullYear(), today.getMonth(), 1)}
            className="p-2 rounded-xl hover:bg-slate-700 text-slate-400 hover:text-white disabled:opacity-30 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>

        {/* Compact calendar */}
        <div className="px-3 pt-2 pb-1">
          <div className="grid grid-cols-7 mb-0.5">
            {WEEKDAYS.map(d => (
              <div key={d} className="text-center text-[10px] font-semibold text-slate-600 py-0.5">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((dateStr, i) => {
              if (!dateStr) return <div key={`e-${i}`} />;
              const dayLogs  = logsByDate.get(dateStr) ?? [];
              const hasSome  = dayLogs.length > 0;
              const isToday  = dateStr === todayStr;
              const isSel    = dateStr === selected;
              const isFuture = dateStr > todayStr;
              const cats = [...new Set(dayLogs.map(l => {
                return (l.item ?? items.find(i => i.id === l.item_id))?.color ?? '#64748b';
              }))].slice(0, 3);
              return (
                <button key={dateStr} onClick={() => !isFuture && setSelected(dateStr)} disabled={isFuture}
                  className={`flex flex-col items-center py-1 rounded-lg transition-colors
                    ${isSel ? 'bg-violet-600' : isToday ? 'bg-slate-700/60' : hasSome ? 'hover:bg-slate-800' : 'hover:bg-slate-800/40'}
                    ${isFuture ? 'opacity-20 cursor-default' : 'cursor-pointer'}`}>
                  <span className={`text-xs font-medium leading-none ${isSel ? 'text-white' : isToday ? 'text-violet-400' : hasSome ? 'text-white' : 'text-slate-600'}`}>
                    {parseInt(dateStr.slice(8), 10)}
                  </span>
                  <div className="flex gap-0.5 mt-0.5 h-1">
                    {hasSome ? cats.map((color, ci) => (
                      <div key={ci} className="w-1 h-1 rounded-full" style={{ background: color }} />
                    )) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected day log list */}
        <div className="px-4 mt-3">
          {/* Day header + category summary */}
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider shrink-0">
              {formatDayHeader(selected)}
            </h3>
            {Object.entries(catCounts).map(([cat, count]) => {
              const meta = CATEGORY_META[cat as keyof typeof CATEGORY_META];
              return (
                <span key={cat} className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${meta.bg} ${meta.color} border ${meta.border}`}>
                  {meta.icon} {count}
                </span>
              );
            })}
          </div>

          {selectedLogs.length === 0 ? (
            <div className="bg-slate-800/40 rounded-xl px-4 py-5 text-center">
              <p className="text-slate-500 text-sm">Nothing logged</p>
              <button onClick={() => { setPrefill(undefined); setShowSheet(true); }}
                className="mt-2 text-violet-400 text-xs font-semibold hover:text-violet-300">
                + Add entry
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              {selectedLogs.map(log => (
                <LogRow key={log.id} log={log}
                  copyingId={copyingId} deletingId={deletingId}
                  onCopy={handleCopyToNow} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* FAB */}
      <button onClick={() => { setPrefill(undefined); setShowSheet(true); }}
        className="fixed right-5 bottom-20 lg:bottom-8 z-30 w-14 h-14 bg-violet-600 hover:bg-violet-500 text-white rounded-full shadow-lg shadow-violet-900/40 flex items-center justify-center transition-all active:scale-95">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>

      {showSheet && (
        <LogSheet date={selected} prefill={prefill} onClose={() => { setShowSheet(false); setPrefill(undefined); }} />
      )}
    </div>
  );
}

'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
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

// ── Log Sheet (MacroFactor-inspired) ──────────────────────────

interface PrefillData { itemId: string; amount: number; unit: string; time: string; notes: string; }
interface LogSheetProps { date: string; prefill?: PrefillData; onClose: () => void; }

interface QueueEntry { uid: string; item: IntakeItem; qty: number; }

let _uid = 0;
function uid() { return String(++_uid); }

// Default qty = one dose in serving units (or default_amount for direct items)
function defaultQty(item: IntakeItem): number {
  return item.serving_label ? item.serving_count : item.default_amount;
}
// Step = 1 serving unit for serving items, one default_amount for direct
function qtyStep(item: IntakeItem): number {
  return item.serving_label ? 1 : item.default_amount;
}
// Human-readable label for a qty value
function qtyLabel(item: IntakeItem, qty: number): string {
  if (item.serving_label) {
    const n = Math.round(qty * 100) / 100;
    return `${n} ${item.serving_label}${n !== 1 ? 's' : ''}`;
  }
  return `${qty} ${item.default_unit}`;
}
// Resolve qty → the actual amount to save
function resolveAmount(item: IntakeItem, qty: number): number {
  if (item.serving_label) return (qty / item.serving_count) * item.default_amount;
  return qty;
}

function LogSheet({ date, prefill, onClose }: LogSheetProps) {
  const { items, handleAddItem, handleAddLog } = useIntake();

  const [queue,       setQueue]       = useState<QueueEntry[]>([]);
  const [logTime,     setLogTime]     = useState(currentTimeStr());
  const [filter,      setFilter]      = useState('');
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  // Raw string per entry uid — lets user type freely without snapping
  const [qtyRaw,      setQtyRaw]      = useState<Record<string, string>>({});

  // New-item sub-form state
  const [newCat,       setNewCat]       = useState<keyof typeof CATEGORY_META>('supplement');
  const [newUnit,      setNewUnit]      = useState('mg');
  const [newAmt,       setNewAmt]       = useState('1');
  const [newServLabel, setNewServLabel] = useState('');
  const [newServCount, setNewServCount] = useState('1');
  const [newColor,     setNewColor]     = useState('#8b5cf6');
  const [newSaving,    setNewSaving]    = useState(false);

  const filterRef = useRef<HTMLInputElement>(null);

  // Prefill: seed queue on open
  useEffect(() => {
    if (prefill) {
      const item = items.find(i => i.id === prefill.itemId);
      if (item) {
        const newUid = uid();
        const dqty = defaultQty(item);
        setQueue([{ uid: newUid, item, qty: dqty }]);
        setQtyRaw({ [newUid]: String(dqty) });
        if (prefill.time) setLogTime(prefill.time);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-add after new item is created
  useEffect(() => {
    if (!showNewForm && filter) {
      const found = items.find(i => i.name.toLowerCase() === filter.toLowerCase());
      if (found && queue.every(e => e.item.id !== found.id)) {
        const newUid = uid();
        const dqty = defaultQty(found);
        setQueue(q => [...q, { uid: newUid, item: found, qty: dqty }]);
        setQtyRaw(r => ({ ...r, [newUid]: String(dqty) }));
        setFilter('');
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const inQueue = useCallback((itemId: string) => queue.findIndex(e => e.item.id === itemId), [queue]);

  const addItem = (item: IntakeItem) => {
    const idx = inQueue(item.id);
    if (idx >= 0) {
      // Already in queue — bump qty by one step
      const entry = queue[idx];
      const newQty = entry.qty + qtyStep(item);
      setQueue(q => q.map((e, i) => i === idx ? { ...e, qty: newQty } : e));
      setQtyRaw(r => ({ ...r, [entry.uid]: String(newQty) }));
    } else {
      const newUid = uid();
      const dqty = defaultQty(item);
      setQueue(q => [...q, { uid: newUid, item, qty: dqty }]);
      setQtyRaw(r => ({ ...r, [newUid]: String(dqty) }));
    }
  };

  const setQty = (entryUid: string, qty: number) => {
    const clamped = Math.max(0, qty);
    setQueue(q => q.map(e => e.uid === entryUid ? { ...e, qty: clamped } : e));
    setQtyRaw(r => ({ ...r, [entryUid]: String(clamped) }));
  };

  const removeEntry = (entryUid: string) => {
    setQueue(q => q.filter(e => e.uid !== entryUid));
    setQtyRaw(r => { const next = { ...r }; delete next[entryUid]; return next; });
  };

  const filteredItems = filter.trim()
    ? items.filter(i => i.name.toLowerCase().includes(filter.toLowerCase()))
    : items;

  const exactMatch = items.some(i => i.name.toLowerCase() === filter.toLowerCase().trim());

  const handleCreateNew = async () => {
    const name = filter.trim();
    if (!name) return;
    setNewSaving(true);
    try {
      await handleAddItem({
        name, category: newCat, default_unit: newUnit,
        default_amount: parseFloat(newAmt) || 1,
        serving_count: parseFloat(newServCount) || 1,
        serving_label: newServLabel, color: newColor,
      });
      setShowNewForm(false);
      // useEffect above auto-adds once items refresh
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create');
    } finally { setNewSaving(false); }
  };

  const handleSaveAll = async () => {
    const valid = queue.filter(e => e.qty > 0);
    if (valid.length === 0) { setError('Add at least one item.'); return; }
    setSaving(true); setError('');
    try {
      await Promise.all(valid.map(e => handleAddLog({
        item_id: e.item.id, date,
        amount: resolveAmount(e.item, e.qty),
        unit: e.item.default_unit,
        notes: '', time_of_day: logTime,
      })));
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full h-[88dvh] bg-[#1a1a1a] rounded-t-2xl flex flex-col overflow-hidden">

        {/* Drag handle */}
        <div className="flex-shrink-0 flex justify-center pt-2.5 pb-1">
          <div className="w-9 h-1 bg-slate-600 rounded-full" />
        </div>

        {/* Header: × | time pill | title */}
        <div className="flex-shrink-0 flex items-center gap-3 px-4 pb-3">
          <button onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white transition-colors shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <input type="time" value={logTime} onChange={e => setLogTime(e.target.value)}
            className="bg-slate-800 text-white font-semibold text-sm rounded-full px-3 py-1.5 border-0 focus:outline-none focus:ring-1 focus:ring-violet-500 shrink-0" />
          <p className="text-white font-bold text-base flex-1">{formatDayHeader(date)}</p>
        </div>

        {/* Scrollable middle */}
        <div className="flex-1 overflow-y-auto">

          {/* YOUR PLATE */}
          {queue.length > 0 && (
            <div className="mb-1">
              <p className="px-4 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Your plate</p>
              {queue.map(entry => {
                const meta = CATEGORY_META[entry.item.category];
                const step = qtyStep(entry.item);
                const unit = entry.item.serving_label
                  ? `${entry.item.serving_label}${entry.qty !== 1 ? 's' : ''}`
                  : entry.item.default_unit;
                const computed = entry.item.serving_label && entry.qty > 0
                  ? parseFloat(resolveAmount(entry.item, entry.qty).toFixed(2))
                  : null;
                const rawVal = qtyRaw[entry.uid] ?? String(entry.qty);
                return (
                  <div key={entry.uid} className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0"
                      style={{ background: entry.item.color + '22' }}>
                      {meta.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white leading-snug">{entry.item.name}</p>
                      {computed !== null && (
                        <p className="text-[10px] text-slate-500 leading-tight">= {computed} {entry.item.default_unit}</p>
                      )}
                    </div>
                    {/* Stepper with always-editable qty */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => entry.qty <= step ? removeEntry(entry.uid) : setQty(entry.uid, entry.qty - step)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-300 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 transition-colors text-lg font-light shrink-0">
                        {entry.qty <= step ? '×' : '−'}
                      </button>
                      <div className="flex items-center bg-slate-800 rounded-lg px-2 py-1 gap-1">
                        <input
                          type="number" inputMode="decimal"
                          value={rawVal}
                          onChange={e => {
                            setQtyRaw(r => ({ ...r, [entry.uid]: e.target.value }));
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v) && v > 0) setQueue(q => q.map(en => en.uid === entry.uid ? { ...en, qty: v } : en));
                          }}
                          onBlur={e => {
                            const v = parseFloat(e.target.value);
                            const final = (!isNaN(v) && v > 0) ? v : entry.qty;
                            setQty(entry.uid, final);
                          }}
                          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          className="w-14 bg-transparent text-sm font-semibold text-white text-right focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        />
                        <span className="text-[10px] text-slate-400 whitespace-nowrap">{unit}</span>
                      </div>
                      <button onClick={() => setQty(entry.uid, entry.qty + step)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-300 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 transition-colors text-lg font-light shrink-0">
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ADD ITEMS list */}
          <div>
            <p className="px-4 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              {queue.length > 0 ? 'Add more' : 'Select items'}
            </p>
            {filteredItems.map(item => {
              const meta  = CATEGORY_META[item.category];
              const idx   = inQueue(item.id);
              const entry = idx >= 0 ? queue[idx] : null;
              const step  = qtyStep(item);
              return (
                <div key={item.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0"
                    style={{ background: item.color + '22' }}>
                    {meta.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white leading-snug">{item.name}</p>
                    <p className="text-[10px] text-slate-500 leading-tight">
                      {item.serving_label
                        ? `${item.serving_count} ${item.serving_label} · ${item.default_amount} ${item.default_unit}`
                        : `${item.default_amount} ${item.default_unit}`}
                    </p>
                  </div>
                  {entry ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => entry.qty <= step ? removeEntry(entry.uid) : setQty(entry.uid, entry.qty - step)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 bg-slate-800 hover:bg-slate-700 transition-colors shrink-0">
                        {entry.qty <= step ? '×' : '−'}
                      </button>
                      <div className="flex items-center bg-slate-800 rounded-lg px-2 py-0.5 gap-1">
                        <input
                          type="number" inputMode="decimal"
                          value={qtyRaw[entry.uid] ?? String(entry.qty)}
                          onChange={e => {
                            setQtyRaw(r => ({ ...r, [entry.uid]: e.target.value }));
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v) && v > 0) setQueue(q => q.map(en => en.uid === entry.uid ? { ...en, qty: v } : en));
                          }}
                          onBlur={e => {
                            const v = parseFloat(e.target.value);
                            const final = (!isNaN(v) && v > 0) ? v : entry.qty;
                            setQty(entry.uid, final);
                          }}
                          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          className="w-12 bg-transparent text-xs font-semibold text-violet-300 text-right focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        />
                        <span className="text-[10px] text-slate-500 whitespace-nowrap">
                          {item.serving_label
                            ? `${item.serving_label}${entry.qty !== 1 ? 's' : ''}`
                            : item.default_unit}
                        </span>
                      </div>
                      <button onClick={() => setQty(entry.uid, entry.qty + step)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 bg-slate-800 hover:bg-slate-700 transition-colors shrink-0">
                        +
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => addItem(item)}
                      className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 active:bg-slate-600 flex items-center justify-center text-slate-300 transition-colors shrink-0">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    </button>
                  )}
                </div>
              );
            })}
            {filter.trim() && !exactMatch && !showNewForm && (
              <button onClick={() => setShowNewForm(true)}
                className="flex items-center gap-3 px-4 py-3 w-full border-b border-white/5 hover:bg-slate-800/60 transition-colors">
                <div className="w-8 h-8 rounded-full bg-violet-600/20 flex items-center justify-center text-violet-400 shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </div>
                <p className="text-sm text-violet-400">Create &ldquo;{filter.trim()}&rdquo;</p>
              </button>
            )}
          </div>

          {/* New item form */}
          {showNewForm && (
            <div className="mx-4 my-3 bg-slate-800/60 border border-slate-700/50 rounded-2xl p-4 space-y-3">
              <p className="text-xs font-semibold text-violet-400">New item: &ldquo;{filter.trim()}&rdquo;</p>
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Default amount</label>
                  <input type="number" value={newAmt} onChange={e => setNewAmt(e.target.value)} min="0"
                    className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-violet-500" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Unit</label>
                  <select value={newUnit} onChange={e => setNewUnit(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-violet-500">
                    {COMMON_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Serving type</label>
                  <select value={newServLabel} onChange={e => setNewServLabel(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-violet-500">
                    <option value="">None</option>
                    {SERVING_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                {newServLabel && (
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">{newServLabel}s per dose</label>
                    <input type="number" value={newServCount} onChange={e => setNewServCount(e.target.value)} min="1"
                      className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-violet-500" />
                  </div>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                {ITEM_COLORS.map(c => (
                  <button key={c} onClick={() => setNewColor(c)}
                    className={`w-6 h-6 rounded-full transition-transform ${newColor === c ? 'ring-2 ring-white scale-110' : ''}`}
                    style={{ background: c }} />
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowNewForm(false)} className="flex-1 py-2 border border-slate-600 text-slate-400 rounded-xl text-sm hover:text-white">Cancel</button>
                <button onClick={handleCreateNew} disabled={newSaving} className="flex-1 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold">
                  {newSaving ? 'Creating…' : 'Create & Add'}
                </button>
              </div>
            </div>
          )}

          {error && <p className="mx-4 mt-2 text-rose-400 text-xs bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">{error}</p>}
          <div className="h-20" /> {/* bottom padding so list clears the fixed bar */}
        </div>

        {/* Bottom bar: filter + Log button */}
        <div className="flex-shrink-0 flex items-center gap-2 px-3 py-3 border-t border-white/5 bg-[#1a1a1a]">
          <div className="flex-1 flex items-center gap-2 bg-slate-800 rounded-full px-3 py-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-slate-500 shrink-0">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input ref={filterRef} type="text" value={filter}
              onChange={e => { setFilter(e.target.value); setShowNewForm(false); }}
              placeholder="Filter items…"
              className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none" />
            {filter && (
              <button onClick={() => setFilter('')} className="text-slate-500 hover:text-white">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>
          <button onClick={handleSaveAll} disabled={saving || queue.filter(e => e.qty > 0).length === 0}
            className="bg-white text-black font-bold text-sm rounded-full px-5 py-2.5 shrink-0 hover:bg-slate-100 active:bg-slate-200 disabled:opacity-30 transition-colors">
            {saving ? 'Saving…' : queue.filter(e => e.qty > 0).length > 0
              ? `Log ${queue.filter(e => e.qty > 0).length}`
              : 'Log'}
          </button>
        </div>
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

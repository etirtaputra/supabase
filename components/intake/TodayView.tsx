'use client';

import { useState, useRef, useEffect } from 'react';
import { useIntake } from '@/context/IntakeContext';
import { CATEGORY_META, COMMON_UNITS, TIME_OF_DAY_OPTIONS } from '@/types/intake';
import type { IntakeItem } from '@/types/intake';

// ── Date helpers ──────────────────────────────────────────────

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDisplayDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const today = toDateStr(new Date());
  const yesterday = toDateStr(new Date(Date.now() - 86400000));
  if (dateStr === today)     return 'Today';
  if (dateStr === yesterday) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

// ── Log sheet (bottom sheet for adding a log) ─────────────────

interface LogSheetProps {
  date: string;
  onClose: () => void;
}

function LogSheet({ date, onClose }: LogSheetProps) {
  const { items, handleAddItem, handleAddLog } = useIntake();

  const [query,       setQuery]       = useState('');
  const [selectedItem, setSelected]  = useState<IntakeItem | null>(null);
  const [amount,      setAmount]      = useState('');
  const [unit,        setUnit]        = useState('');
  const [timeOfDay,   setTimeOfDay]   = useState('');
  const [notes,       setNotes]       = useState('');
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');
  const [showDrop,    setShowDrop]    = useState(false);

  // New item creation inline
  const [creatingNew, setCreatingNew] = useState(false);
  const [newCat,      setNewCat]      = useState<keyof typeof CATEGORY_META>('supplement');
  const [newUnit,     setNewUnit]     = useState('mg');
  const [newAmt,      setNewAmt]      = useState('1');
  const [newColor,    setNewColor]    = useState('#8b5cf6');
  const [newSaving,   setNewSaving]   = useState(false);

  const queryRef = useRef<HTMLInputElement>(null);

  useEffect(() => { queryRef.current?.focus(); }, []);

  const filtered = query.trim()
    ? items.filter(i => i.name.toLowerCase().includes(query.toLowerCase()))
    : items;

  const exactMatch = items.some(i => i.name.toLowerCase() === query.toLowerCase().trim());

  const selectItem = (item: IntakeItem) => {
    setSelected(item);
    setQuery(item.name);
    setUnit(item.default_unit);
    setAmount(String(item.default_amount));
    setShowDrop(false);
    setCreatingNew(false);
  };

  const handleCreateNew = async () => {
    const name = query.trim();
    if (!name) return;
    setNewSaving(true);
    try {
      const newItem = await handleAddItem({ // handleAddItem now returns void; need refetch or use local
        name, category: newCat, default_unit: newUnit,
        default_amount: parseFloat(newAmt) || 1, color: newColor,
      });
      // handleAddItem returns void and updates items state — find newly added item
      // We optimistically pick unit/amount from form
      setUnit(newUnit);
      setAmount(newAmt);
      setCreatingNew(false);
      // The item will appear in items after state update; select it by name
      setQuery(name);
      setShowDrop(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create item');
    } finally { setNewSaving(false); }
  };

  // After items updates (after creating new), auto-select if name matches
  useEffect(() => {
    if (!creatingNew && query) {
      const found = items.find(i => i.name.toLowerCase() === query.toLowerCase());
      if (found && !selectedItem) selectItem(found);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const handleSave = async () => {
    const n = parseFloat(amount);
    if (!selectedItem) { setError('Please select an item.'); return; }
    if (isNaN(n) || n <= 0) { setError('Enter a valid amount.'); return; }
    setSaving(true); setError('');
    try {
      await handleAddLog({
        item_id: selectedItem.id,
        date, amount: n, unit: unit || selectedItem.default_unit,
        notes, time_of_day: timeOfDay,
      });
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-h-[92dvh] bg-slate-900 rounded-t-2xl border-t border-slate-700/50 flex flex-col overflow-hidden">
        {/* Handle */}
        <div className="flex-shrink-0 flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-slate-600 rounded-full" />
        </div>

        <div className="px-4 pb-2 flex items-center justify-between flex-shrink-0">
          <h2 className="text-white font-bold text-base">Log Intake · {formatDisplayDate(date)}</h2>
          <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-4 pb-6 space-y-4">

          {/* Item search */}
          <div className="relative">
            <label className="block text-xs text-slate-400 mb-1.5">What did you take?</label>
            <input
              ref={queryRef}
              type="text"
              value={query}
              onChange={e => { setQuery(e.target.value); setShowDrop(true); setSelected(null); }}
              onFocus={() => setShowDrop(true)}
              placeholder="Search supplements, meds, caffeine…"
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            />

            {/* Dropdown */}
            {showDrop && !selectedItem && (
              <div className="absolute z-10 top-full mt-1 w-full bg-slate-800 border border-slate-700 rounded-xl shadow-lg overflow-hidden max-h-52 overflow-y-auto">
                {filtered.length === 0 && !query && (
                  <p className="px-4 py-3 text-sm text-slate-500">Start typing to search…</p>
                )}
                {filtered.map(item => {
                  const meta = CATEGORY_META[item.category];
                  return (
                    <button key={item.id} onClick={() => selectItem(item)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-700 transition-colors text-left">
                      <span className="text-lg">{meta.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white font-medium truncate">{item.name}</p>
                        <p className="text-[11px] text-slate-400">{meta.label} · {item.default_amount} {item.default_unit}</p>
                      </div>
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: item.color }} />
                    </button>
                  );
                })}
                {/* Create new option */}
                {query.trim() && !exactMatch && (
                  <button onClick={() => { setCreatingNew(true); setShowDrop(false); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-violet-900/30 border-t border-slate-700/50 transition-colors text-left">
                    <span className="text-lg">➕</span>
                    <p className="text-sm text-violet-400">Add &ldquo;{query.trim()}&rdquo; as new item</p>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Inline new item form */}
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
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-colors
                          ${newCat === cat ? `${m.bg} ${m.color} ${m.border}` : 'border-slate-700 text-slate-400 hover:text-white'}`}>
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

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Color</label>
                <div className="flex gap-2 flex-wrap">
                  {['#8b5cf6','#3b82f6','#f59e0b','#10b981','#f43f5e','#0ea5e9','#f97316','#14b8a6'].map(c => (
                    <button key={c} onClick={() => setNewColor(c)}
                      className={`w-7 h-7 rounded-full transition-transform ${newColor === c ? 'ring-2 ring-white scale-110' : ''}`}
                      style={{ background: c }} />
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <button onClick={() => setCreatingNew(false)}
                  className="flex-1 py-2 border border-slate-600 text-slate-400 rounded-xl text-sm hover:text-white">Cancel</button>
                <button onClick={handleCreateNew} disabled={newSaving}
                  className="flex-1 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold">
                  {newSaving ? 'Creating…' : 'Create & Select'}
                </button>
              </div>
            </div>
          )}

          {/* Selected item badge */}
          {selectedItem && (
            <div className="flex items-center gap-3 bg-slate-800/50 rounded-xl px-3 py-2.5">
              <span className="text-xl">{CATEGORY_META[selectedItem.category].icon}</span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-white">{selectedItem.name}</p>
                <p className="text-[11px] text-slate-400">{CATEGORY_META[selectedItem.category].label}</p>
              </div>
              <button onClick={() => { setSelected(null); setQuery(''); setShowDrop(true); }}
                className="text-slate-500 hover:text-white p-1">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          )}

          {/* Amount + Unit */}
          {(selectedItem || creatingNew) && !creatingNew && (
            <div className="grid grid-cols-5 gap-3">
              <div className="col-span-3">
                <label className="block text-xs text-slate-400 mb-1.5">Amount</label>
                <input type="number" value={amount} onChange={e => setAmount(e.target.value)} min="0" step="any"
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                  placeholder="0" />
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
          )}

          {selectedItem && !creatingNew && (
            <>
              {/* Time of day */}
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Time of day</label>
                <div className="flex gap-2 flex-wrap">
                  {TIME_OF_DAY_OPTIONS.map(({ value, label }) => (
                    <button key={value} onClick={() => setTimeOfDay(value)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors
                        ${timeOfDay === value ? 'bg-violet-600 border-violet-500 text-white' : 'border-slate-700 text-slate-400 hover:text-white hover:border-slate-500'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Notes <span className="text-slate-600">(optional)</span></label>
                <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="e.g. with food, before workout…"
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 text-sm placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
              </div>

              {error && <p className="text-rose-400 text-xs bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">{error}</p>}

              <button onClick={handleSave} disabled={saving}
                className="w-full py-3.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl font-bold text-sm transition-colors">
                {saving ? 'Saving…' : 'Log Intake'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main TodayView ────────────────────────────────────────────

export default function TodayView() {
  const { getLogsForDate, handleDeleteLog, items } = useIntake();

  const [date,       setDate]       = useState(toDateStr(new Date()));
  const [showSheet,  setShowSheet]  = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const logs = getLogsForDate(date);
  const today = toDateStr(new Date());

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try { await handleDeleteLog(id); }
    finally { setDeletingId(null); }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Date navigator */}
      <div className="flex items-center gap-2 px-4 py-3 bg-slate-900/60 border-b border-slate-700/50 shrink-0">
        <button onClick={() => setDate(d => addDays(d, -1))}
          className="p-2 rounded-xl hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <button onClick={() => setDate(today)} className="flex-1 text-center">
          <p className={`font-bold text-sm ${date === today ? 'text-violet-400' : 'text-white'}`}>
            {formatDisplayDate(date)}
          </p>
          {date !== today && (
            <p className="text-[11px] text-slate-500 mt-0.5">{new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
          )}
        </button>
        <button onClick={() => setDate(d => addDays(d, 1))} disabled={date >= today}
          className="p-2 rounded-xl hover:bg-slate-700 text-slate-400 hover:text-white disabled:opacity-30 transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>

      {/* Logs list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-24 space-y-2">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <div className="text-5xl mb-4">💊</div>
            <p className="text-white font-semibold text-base">Nothing logged {date === today ? 'today' : 'this day'}</p>
            <p className="text-slate-500 text-sm mt-1">Tap the + button to log your intake</p>
          </div>
        ) : (
          <>
            {/* Summary bar */}
            <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
              {Object.entries(
                logs.reduce<Record<string, number>>((acc, l) => {
                  const cat = (l.item ?? items.find(i => i.id === l.item_id))?.category ?? 'other';
                  acc[cat] = (acc[cat] ?? 0) + 1;
                  return acc;
                }, {})
              ).map(([cat, count]) => {
                const meta = CATEGORY_META[cat as keyof typeof CATEGORY_META];
                return (
                  <div key={cat} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl ${meta.bg} ${meta.border} border shrink-0`}>
                    <span className="text-sm">{meta.icon}</span>
                    <span className={`text-xs font-semibold ${meta.color}`}>{count} {meta.label}</span>
                  </div>
                );
              })}
            </div>

            {logs.map(log => {
              const item = log.item ?? items.find(i => i.id === log.item_id);
              const cat  = item?.category ?? 'other';
              const meta = CATEGORY_META[cat];
              return (
                <div key={log.id} className="bg-slate-800/70 rounded-2xl px-4 py-3 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center text-lg shrink-0 mt-0.5"
                    style={{ background: (item?.color ?? '#6366f1') + '33' }}>
                    {meta.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-white">{item?.name ?? 'Unknown'}</p>
                      <p className="text-sm text-slate-300">{log.amount} {log.unit}</p>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className={`text-[11px] ${meta.color}`}>{meta.label}</span>
                      {log.time_of_day && (
                        <span className="text-[11px] text-slate-500">· {log.time_of_day}</span>
                      )}
                      {log.notes && (
                        <span className="text-[11px] text-slate-500">· {log.notes}</span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => handleDelete(log.id)} disabled={deletingId === log.id}
                    className="p-1.5 text-slate-600 hover:text-rose-400 disabled:opacity-30 transition-colors shrink-0">
                    {deletingId === log.id
                      ? <div className="w-4 h-4 rounded-full border border-slate-500 border-t-transparent animate-spin" />
                      : (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                          <path d="M10 11v6"/><path d="M14 11v6"/>
                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>
                      )}
                  </button>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* FAB */}
      <button
        onClick={() => setShowSheet(true)}
        className="fixed right-5 bottom-20 lg:bottom-8 z-30 w-14 h-14 bg-violet-600 hover:bg-violet-500 text-white rounded-full shadow-lg shadow-violet-900/40 flex items-center justify-center transition-all active:scale-95">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>

      {showSheet && <LogSheet date={date} onClose={() => setShowSheet(false)} />}
    </div>
  );
}

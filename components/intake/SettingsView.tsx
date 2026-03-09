'use client';

import { useState } from 'react';
import { useIntake } from '@/context/IntakeContext';
import { CATEGORY_META, COMMON_UNITS, ITEM_COLORS, SERVING_LABELS } from '@/types/intake';
import type { IntakeItem, Category } from '@/types/intake';
import { signOut } from '@/lib/intake-supabase';

// ── Item form (add or edit) ───────────────────────────────────

interface ItemFormProps {
  initial?: IntakeItem;
  onSave: (data: {
    name: string; category: Category;
    default_unit: string; default_amount: number;
    serving_count: number; serving_label: string;
    serving_ml: number; color: string;
  }) => Promise<void>;
  onCancel: () => void;
  existingNames: string[];
}

function ItemForm({ initial, onSave, onCancel, existingNames }: ItemFormProps) {
  const [name,      setName]      = useState(initial?.name           ?? '');
  const [category,  setCategory]  = useState<Category>(initial?.category ?? 'supplement');
  const [unit,      setUnit]      = useState(initial?.default_unit   ?? 'mg');
  const [amount,    setAmount]    = useState(String(initial?.default_amount ?? 1));
  const [servLabel, setServLabel] = useState(initial?.serving_label  ?? '');
  const [servCount, setServCount] = useState(String(initial?.serving_count ?? 1));
  const [servMl,    setServMl]    = useState(String(initial?.serving_ml ?? 0));
  const [color,     setColor]     = useState(initial?.color          ?? '#8b5cf6');
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');

  const handleSave = async () => {
    const n = name.trim();
    if (!n) { setError('Name is required.'); return; }
    if (!initial && existingNames.some(e => e.toLowerCase() === n.toLowerCase())) {
      setError('An item with this name already exists.'); return;
    }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { setError('Enter a valid default amount.'); return; }
    const sc = servLabel ? (parseFloat(servCount) || 1) : 1;
    const ml = parseFloat(servMl) || 0;
    setSaving(true); setError('');
    try {
      await onSave({ name: n, category, default_unit: unit, default_amount: amt, serving_count: sc, serving_label: servLabel, serving_ml: ml, color });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally { setSaving(false); }
  };

  return (
    <div className="bg-slate-800 rounded-2xl p-4 space-y-4">
      <p className="font-semibold text-white text-sm">{initial ? 'Edit Item' : 'New Item'}</p>

      <div>
        <label className="block text-xs text-slate-400 mb-1.5">Name</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)} autoFocus
          onKeyDown={e => e.key === 'Enter' && handleSave()}
          placeholder="e.g. Vitamin C, Melatonin, Coffee"
          className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-4 py-2.5 text-sm placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-1.5">Category</label>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(CATEGORY_META) as Category[]).map(cat => {
            const m = CATEGORY_META[cat];
            return (
              <button key={cat} onClick={() => setCategory(cat)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-medium transition-colors
                  ${category === cat ? `${m.bg} ${m.color} ${m.border}` : 'border-slate-700 text-slate-400 hover:text-white hover:border-slate-600'}`}>
                <span className="text-base">{m.icon}</span>
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Default amount</label>
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)} min="0" step="any"
            className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Unit</label>
          <select value={unit} onChange={e => setUnit(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
            {COMMON_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            {unit && !COMMON_UNITS.includes(unit) && <option value={unit}>{unit}</option>}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-1.5">Serving size <span className="text-slate-600">(optional)</span></label>
        <div className="grid grid-cols-2 gap-3">
          <select value={servLabel} onChange={e => setServLabel(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
            <option value="">No serving size</option>
            {SERVING_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          {servLabel && (
            <div className="flex items-center gap-2">
              <input type="number" value={servCount} onChange={e => setServCount(e.target.value)} min="1" step="any"
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                placeholder="count" />
              <span className="text-xs text-slate-500 shrink-0">{servLabel}s</span>
            </div>
          )}
        </div>
        {servLabel && amount && (
          <p className="text-[11px] text-slate-500 mt-1.5 bg-slate-900/50 rounded-lg px-3 py-1.5">
            1 {servLabel} = {parseFloat(amount) && parseFloat(servCount) ? (parseFloat(amount) / (parseFloat(servCount) || 1)).toFixed(2) : '?'} {unit}
          </p>
        )}
      </div>

      {category === 'caffeine' && (
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">
            Volume per serving (ml) <span className="text-slate-600">(optional)</span>
          </label>
          <input type="number" value={servMl} onChange={e => setServMl(e.target.value)} min="0" step="any"
            placeholder="e.g. 40 for a 40ml espresso shot"
            className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2.5 text-sm placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500" />
          {servMl && parseFloat(servMl) > 0 && amount && (
            <p className="text-[11px] text-amber-400/70 mt-1.5 bg-amber-500/10 rounded-lg px-3 py-1.5">
              {servMl}ml → {amount} {unit} caffeine per serving
            </p>
          )}
        </div>
      )}

      <div>
        <label className="block text-xs text-slate-400 mb-1.5">Color</label>
        <div className="flex gap-2 flex-wrap">
          {ITEM_COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)}
              style={{ background: c }}
              className={`w-8 h-8 rounded-full transition-all ${color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-800 scale-110' : 'hover:scale-105'}`} />
          ))}
        </div>
      </div>

      {error && <p className="text-rose-400 text-xs bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button onClick={onCancel}
          className="flex-1 py-2.5 border border-slate-600 hover:border-slate-500 text-slate-300 rounded-xl text-sm font-semibold transition-colors">
          Cancel
        </button>
        <button onClick={handleSave} disabled={saving}
          className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
          {saving ? 'Saving…' : initial ? 'Save Changes' : 'Add Item'}
        </button>
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────

export default function SettingsView() {
  const { items, logs, handleAddItem, handleUpdateItem, handleDeleteItem } = useIntake();

  const [addingItem,  setAddingItem]  = useState(false);
  const [editingItem, setEditingItem] = useState<IntakeItem | null>(null);
  const [signingOut,  setSigningOut]  = useState(false);

  const handleDelete = (item: IntakeItem) => {
    const count = logs.filter(l => l.item_id === item.id).length;
    const msg = count > 0
      ? `Delete "${item.name}"? This will also delete ${count} log entr${count === 1 ? 'y' : 'ies'}.`
      : `Delete "${item.name}"?`;
    if (!confirm(msg)) return;
    handleDeleteItem(item.id).catch(() => {});
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try { await signOut(); } finally { setSigningOut(false); }
  };

  const existingNames = items.map(i => i.name);

  return (
    <div className="overflow-y-auto h-full pb-24">
      <div className="px-4 py-4 space-y-6">

        {/* Items section */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-white font-bold text-base">My Items</h2>
            <button onClick={() => { setAddingItem(true); setEditingItem(null); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-xs font-semibold transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Add Item
            </button>
          </div>

          {addingItem && !editingItem && (
            <div className="mb-4">
              <ItemForm
                onSave={async (data) => { await handleAddItem(data); setAddingItem(false); }}
                onCancel={() => setAddingItem(false)}
                existingNames={existingNames}
              />
            </div>
          )}

          {items.length === 0 && !addingItem ? (
            <div className="bg-slate-800/50 rounded-2xl p-6 text-center">
              <div className="text-4xl mb-2">💊</div>
              <p className="text-slate-400 text-sm mb-1">No items yet</p>
              <p className="text-slate-600 text-xs">Add your supplements, medicines, and caffeine sources</p>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map(item => {
                const meta = CATEGORY_META[item.category];
                const logCount = logs.filter(l => l.item_id === item.id).length;
                const isEditing = editingItem?.id === item.id;

                return (
                  <div key={item.id}>
                    {isEditing ? (
                      <ItemForm
                        initial={item}
                        onSave={async (data) => { await handleUpdateItem(item.id, data); setEditingItem(null); }}
                        onCancel={() => setEditingItem(null)}
                        existingNames={existingNames.filter(n => n !== item.name)}
                      />
                    ) : (
                      <div className="bg-slate-800 rounded-2xl flex items-center gap-3 px-4 py-3">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xl shrink-0"
                          style={{ background: item.color + '33' }}>
                          {meta.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-white text-sm truncate">{item.name}</p>
                          <p className="text-[11px] text-slate-400">
                            <span className={meta.color}>{meta.label}</span>
                            {' · '}{item.default_amount} {item.default_unit}
                            {item.serving_label ? ` · ${item.serving_count} ${item.serving_label}` : ''}
                            {logCount > 0 && ` · ${logCount} log${logCount !== 1 ? 's' : ''}`}
                          </p>
                        </div>
                        <button onClick={() => { setEditingItem(item); setAddingItem(false); }}
                          className="p-1.5 text-slate-500 hover:text-white transition-colors">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </button>
                        <button onClick={() => handleDelete(item)}
                          className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                            <path d="M10 11v6"/><path d="M14 11v6"/>
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Category reference */}
        <section>
          <h2 className="text-white font-bold text-base mb-3">Categories</h2>
          <div className="space-y-2">
            {(Object.entries(CATEGORY_META) as [Category, typeof CATEGORY_META[Category]][]).map(([cat, meta]) => (
              <div key={cat} className={`flex items-center gap-3 rounded-xl px-4 py-3 ${meta.bg} border ${meta.border}`}>
                <span className="text-xl">{meta.icon}</span>
                <div>
                  <p className={`text-sm font-semibold ${meta.color}`}>{meta.label}</p>
                  <p className="text-[11px] text-slate-400">
                    {cat === 'supplement' && 'Vitamins, minerals, protein, pre-workout…'}
                    {cat === 'medicine'   && 'Prescription or OTC medications…'}
                    {cat === 'caffeine'   && 'Coffee, tea, energy drinks, pre-workout…'}
                    {cat === 'other'      && 'Anything else you want to track…'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Sign out */}
        <section>
          <h2 className="text-slate-400 font-bold text-base mb-3">Account</h2>
          <button onClick={handleSignOut} disabled={signingOut}
            className="w-full py-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-slate-700 text-slate-300 hover:text-white rounded-2xl text-sm font-semibold transition-colors">
            {signingOut ? 'Signing out…' : 'Sign Out'}
          </button>
        </section>

      </div>
    </div>
  );
}

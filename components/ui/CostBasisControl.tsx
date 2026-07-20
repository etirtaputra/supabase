'use client';
import { useState, useEffect } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

/**
 * Owner-only control on the Inspect panel's "Actual TUC" card: what does the
 * Project Quote BOM builder show as this item's cost?
 *   TUC      → the raw landed cost
 *   Std Cost → TUC + safety buffer % (global default, per-item override);
 *              stored as mode 'buffered'
 *   Hidden   → treated as not a PV-quote product: the item is kept out of the
 *              Project Quote item autocomplete entirely (so unrelated / sensitive
 *              lines like UPS or Stabilizer never surface there), and on any
 *              existing quote its cost is hidden (falls back to supplier-quote /
 *              last-used).
 * The global buffer lives in app_settings.quote_cost_buffer_pct and is
 * editable inline here. Catalog/Insights always show raw TUC regardless.
 * Non-owners see a quiet note only when the item is not on raw TUC.
 */

export type QuoteCostMode = 'tuc' | 'buffered' | 'hidden';

const MODES: { value: QuoteCostMode; label: string }[] = [
  { value: 'tuc', label: 'TUC' },
  { value: 'buffered', label: 'Std Cost' },
  { value: 'hidden', label: 'Hidden' },
];

export default function CostBasisControl({ componentId, mode, bufferPct, tuc, onChanged }: {
  componentId: string;
  mode: QuoteCostMode;                 // current quote_cost_mode
  bufferPct: number | null;            // per-item override; null = global
  tuc: number | null;                  // raw TUC (IDR) for the live preview
  onChanged?: (patch: { quote_cost_mode?: QuoteCostMode; quote_cost_buffer_pct?: number | null }) => void;
}) {
  const supabase = createSupabaseClient();
  const { profile } = useAuth();
  const isOwner = profile?.role === 'owner';

  const [m, setM] = useState<QuoteCostMode>(mode);
  const [override, setOverride] = useState(bufferPct != null ? String(bufferPct) : '');
  const [globalPct, setGlobalPct] = useState<number>(5);
  const [editingGlobal, setEditingGlobal] = useState(false);
  const [globalDraft, setGlobalDraft] = useState('5');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setM(mode); setOverride(bufferPct != null ? String(bufferPct) : ''); setErr(null); }, [componentId, mode, bufferPct]);

  useEffect(() => {
    supabase.from('app_settings').select('value').eq('key', 'quote_cost_buffer_pct').maybeSingle()
      .then(({ data }) => { const v = Number(data?.value); if (!isNaN(v)) { setGlobalPct(v); setGlobalDraft(String(v)); } });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const effPct = override.trim() !== '' && !isNaN(Number(override)) ? Number(override) : globalPct;
  const basisPreview = tuc != null ? tuc * (1 + Math.max(0, effPct) / 100) : null;

  if (!isOwner) {
    if (m === 'tuc') return null;
    return (
      <p className="mt-2 pt-2 border-t border-sky-500/10 text-[10px] text-slate-500">
        {m === 'hidden'
          ? 'This item is kept out of Project Quotes (owner setting).'
          : 'Project Quotes use this item’s Standard Cost (landed cost + safety buffer, owner setting).'}
      </p>
    );
  }

  async function setModeDb(next: QuoteCostMode) {
    if (next === m) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from('3.0_components').update({ quote_cost_mode: next }).eq('component_id', componentId);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setM(next);
    onChanged?.({ quote_cost_mode: next });
  }

  async function saveOverride() {
    const raw = override.trim();
    const v = raw === '' ? null : Number(raw);
    if (v !== null && (isNaN(v) || v < 0)) { setErr('Buffer must be a non-negative number'); return; }
    if (v === bufferPct || (v === null && bufferPct === null)) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from('3.0_components').update({ quote_cost_buffer_pct: v }).eq('component_id', componentId);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onChanged?.({ quote_cost_buffer_pct: v });
  }

  async function saveGlobal() {
    const v = Number(globalDraft);
    if (isNaN(v) || v < 0) { setErr('Global buffer must be a non-negative number'); return; }
    setBusy(true); setErr(null);
    const { error } = await supabase.from('app_settings')
      .upsert({ key: 'quote_cost_buffer_pct', value: String(v), updated_at: new Date().toISOString(), updated_by_email: profile?.email ?? '' });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setGlobalPct(v);
    setEditingGlobal(false);
  }

  return (
    <div className="mt-2 pt-2 border-t border-sky-500/10 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-600">In Project Quotes</span>
        {/* Quiet text toggle — no boxes, dot separators; active mode carries the color */}
        <span className="flex items-center gap-1.5">
          {MODES.map(({ value, label }, i) => (
            <span key={value} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-slate-700 text-[10px]">·</span>}
              <button onClick={() => setModeDb(value)} disabled={busy}
                title={
                  value === 'tuc' ? 'Show raw TUC (landed cost) in Project Quotes'
                  : value === 'buffered' ? 'Show Std Cost (TUC + safety buffer) in Project Quotes'
                  : 'Keep this item out of Project Quotes (hidden from the item picker; cost hidden on existing quotes)'
                }
                className={`text-[10px] font-semibold transition-colors disabled:opacity-60 ${
                  m === value
                    ? value === 'hidden' ? 'text-amber-300' : 'text-emerald-300'
                    : 'text-slate-600 hover:text-slate-300'
                }`}>
                {label}
              </button>
            </span>
          ))}
        </span>
        {busy && <span className="w-3 h-3 border border-slate-600 border-t-slate-300 rounded-full animate-spin" />}
      </div>

      {m === 'buffered' && (
        <div className="flex items-center gap-2 flex-wrap text-[10px]">
          <span className="text-slate-500">Buffer</span>
          <input
            value={override}
            inputMode="decimal"
            onChange={(e) => setOverride(e.target.value)}
            onBlur={saveOverride}
            placeholder={String(globalPct)}
            title={`Per-item override — blank uses the global ${globalPct}%`}
            className="w-14 px-1.5 py-0.5 rounded-md bg-slate-950 border border-slate-700 focus:border-emerald-500/50 outline-none text-white text-[10px] text-right tabular-nums transition-colors"
          />
          <span className="text-slate-600">%</span>
          {editingGlobal ? (
            <span className="flex items-center gap-1">
              <span className="text-slate-500">global</span>
              <input value={globalDraft} inputMode="decimal" onChange={(e) => setGlobalDraft(e.target.value)} autoFocus
                className="w-12 px-1.5 py-0.5 rounded-md bg-slate-950 border border-slate-700 focus:border-emerald-500/50 outline-none text-white text-[10px] text-right tabular-nums" />
              <button onClick={saveGlobal} className="text-emerald-400 hover:text-emerald-300 font-semibold">save</button>
              <button onClick={() => { setEditingGlobal(false); setGlobalDraft(String(globalPct)); }} className="text-slate-600 hover:text-slate-400">cancel</button>
            </span>
          ) : (
            <button onClick={() => setEditingGlobal(true)} className="text-slate-600 hover:text-slate-400 underline decoration-dotted" title="Edit the global buffer (applies to every item without an override)">
              global {globalPct}%
            </button>
          )}
          {basisPreview != null && (
            <span className="text-slate-400 tabular-nums ml-auto">
              → Std Cost <span className="text-slate-200 font-semibold">{Math.round(basisPreview).toLocaleString('en-US')}</span>
            </span>
          )}
        </div>
      )}

      {err && <p className="text-[10px] text-red-400">Failed: {err}</p>}
    </div>
  );
}

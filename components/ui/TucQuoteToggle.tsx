'use client';
import { useState, useEffect } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

/**
 * Owner-only switch on the Inspect panel's "Actual TUC" card:
 * should this product's TUC auto-show in the Project Quote BOM builder?
 * (3.0_components.show_tuc_in_quotes — default true. Catalog/Insights always
 * show TUC; this only governs what leaks into Project Quotes.)
 * Non-owners just see a quiet "hidden" note when it's off.
 */
export default function TucQuoteToggle({ componentId, value, onChanged }: {
  componentId: string;
  value: boolean; // current show_tuc_in_quotes (undefined→true handled by caller)
  onChanged?: (v: boolean) => void;
}) {
  const supabase = createSupabaseClient();
  const { profile } = useAuth();
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setV(value); setErr(null); }, [componentId, value]);

  if (profile?.role !== 'owner') {
    return v ? null : (
      <p className="mt-2 pt-2 border-t border-sky-500/10 text-[10px] text-slate-500">
        TUC is hidden in Project Quotes for this item (owner setting).
      </p>
    );
  }

  async function toggle() {
    const next = !v;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.from('3.0_components').update({ show_tuc_in_quotes: next }).eq('component_id', componentId);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setV(next);
    onChanged?.(next);
  }

  return (
    <div className="mt-2 pt-2 border-t border-sky-500/10">
      <button onClick={toggle} disabled={busy} className="flex items-center gap-2 group disabled:opacity-60" title="Owner setting — governs only the Project Quote BOM builder; Catalog & Insights always show TUC">
        <span className={`relative inline-flex h-4 w-7 flex-shrink-0 rounded-full transition-colors ${v ? 'bg-emerald-500/70' : 'bg-slate-700'}`}>
          <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${v ? 'left-3.5' : 'left-0.5'}`} />
        </span>
        <span className={`text-[10px] font-medium ${v ? 'text-slate-400' : 'text-amber-300'}`}>
          {v ? 'Shows in Project Quotes' : 'Hidden in Project Quotes'}
        </span>
        {busy && <span className="w-3 h-3 border border-slate-600 border-t-slate-300 rounded-full animate-spin" />}
      </button>
      {err && <p className="text-[10px] text-red-400 mt-1">Failed: {err}</p>}
    </div>
  );
}

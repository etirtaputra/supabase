'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import type { FxBenchmark } from '@/lib/fxBenchmark';

/**
 * The company exchange rates as their log (`9.1_fx_benchmark_rates`, owner
 * 2026-10-23). RLS answers empty for a role off the buy side, so a screen
 * that cannot use them simply gets none. `reload` after a new rate is set.
 */
export function useFxBenchmarks(enabled = true): { rows: FxBenchmark[]; loaded: boolean; reload: () => void } {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [rows, setRows] = useState<FxBenchmark[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    supabase.from('9.1_fx_benchmark_rates').select('benchmark_id, currency, rate, note, set_at, set_by_email, source, edited_at, edited_by_email')
      .then(({ data }) => { if (live) { setRows((data ?? []) as FxBenchmark[]); setLoaded(true); } }, () => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [supabase, enabled, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { rows, loaded, reload };
}

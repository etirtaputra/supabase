'use client';
import { useMemo } from 'react';
import { useSettings } from './useSettings';
import { listSpec, type ListKey } from '@/constants/listDefaults';
import { rangeForPreset, type DateRange, type RangePreset } from '@/lib/dateRange';

/**
 * How this list should open — the sort and the period from Settings › Lists,
 * falling back to the list's shipped default.
 *
 * `range` is resolved fresh on every render from the preset, not stored: a
 * saved "month to date" has to mean THIS month whenever the page is opened,
 * not the month it was configured in.
 */
export function useListDefaults(key: ListKey): { sort: string; period: RangePreset; range: DateRange } {
  const stored = useSettings().listDefaults[key];
  const spec = listSpec(key);
  const sort = stored?.sort ?? spec.defaults.sort;
  const period = (stored?.period ?? spec.defaults.period) as RangePreset;
  // Recomputed per render so a long-lived tab rolls into the new month with it
  const range = useMemo(() => rangeForPreset(period), [period]);
  return { sort, period, range };
}

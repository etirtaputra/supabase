'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSettings } from './useSettings';
import type { ListLayout } from '@/lib/settings';

/**
 * How this list should render: the house default from Settings › Layout,
 * unless the person looking at THIS list flipped it.
 *
 * A per-screen flip is stored on this device as {v, base} — the choice AND the
 * house default it diverged from. It holds only while `base` is still the
 * house default: when the owner changes Settings › Layout, every stale flip
 * dissolves and the new default flows through. (The first version stored a
 * bare 'compact'/'card' forever, so a toggle once clicked pinned that list for
 * good and the Settings change appeared to do nothing — the 2026-08-13 bug.)
 * Legacy bare-string entries are dropped on sight; picking the value that
 * matches the house default simply clears the flip.
 */
export function useListLayout(pageKey: string): [ListLayout, (v: ListLayout | null) => void] {
  const fallback = useSettings().listLayout;
  const storeKey = `icaproc.layout.${pageKey}`;
  const [override, setOverride] = useState<ListLayout | null>(null);

  // Re-evaluated when the house default lands/changes (settings load async):
  // a flip whose base no longer matches is ignored — not deleted, so a
  // transient wrong default (cold cache) can't destroy a valid flip.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storeKey);
      if (!raw) { setOverride(null); return; }
      if (raw === 'compact' || raw === 'card') {
        // Legacy permanent pin — retire it; the house default takes over.
        window.localStorage.removeItem(storeKey);
        setOverride(null);
        return;
      }
      const parsed = JSON.parse(raw) as { v?: unknown; base?: unknown };
      const valid = (parsed.v === 'compact' || parsed.v === 'card') && parsed.base === fallback;
      setOverride(valid ? (parsed.v as ListLayout) : null);
    } catch { setOverride(null); }
  }, [storeKey, fallback]);

  const set = useCallback((v: ListLayout | null) => {
    const effective = v === fallback ? null : v;   // choosing the default = follow it
    setOverride(effective);
    try {
      if (effective) window.localStorage.setItem(storeKey, JSON.stringify({ v: effective, base: fallback }));
      else window.localStorage.removeItem(storeKey);
    } catch { /* private mode */ }
  }, [storeKey, fallback]);

  return [override ?? fallback, set];
}

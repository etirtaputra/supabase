'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSettings } from './useSettings';
import type { ListLayout } from '@/lib/settings';

/**
 * How this list should render: the house default from Settings › Layout,
 * unless the person looking at THIS list flipped it.
 *
 * The per-screen choice is remembered in localStorage under the page's key —
 * flipping Sales to card view is not a statement about Invoices, and it never
 * rewrites the house default (that is an owner decision in Settings).
 * Returning to the default is `setLayout(null)`.
 */
export function useListLayout(pageKey: string): [ListLayout, (v: ListLayout | null) => void] {
  const fallback = useSettings().listLayout;
  const storeKey = `icaproc.layout.${pageKey}`;
  const [override, setOverride] = useState<ListLayout | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storeKey);
      if (raw === 'compact' || raw === 'card') setOverride(raw);
    } catch { /* private mode */ }
  }, [storeKey]);

  const set = useCallback((v: ListLayout | null) => {
    setOverride(v);
    try {
      if (v) window.localStorage.setItem(storeKey, v);
      else window.localStorage.removeItem(storeKey);
    } catch { /* private mode */ }
  }, [storeKey]);

  return [override ?? fallback, set];
}

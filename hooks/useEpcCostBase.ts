'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { costBase, epcCostOpts, EMPTY_COST_BASE, type CostBase, type FxRate, type TUCResult } from '@/lib/computeTUC';
import { ROLE_PERMISSIONS, type UserRole } from '@/constants/roles';
import type { PriceQuote, PriceQuoteLineItem } from '@/types/database';

/**
 * The buy-side half of an item's EPC cost (`costBase`), for whoever is looking.
 *
 * - A role that reads the buy side (owner) computes it here from the catalogue
 *   it already loaded — exactly as before.
 * - A role that prices EPC work but may NOT read the buy side (the Project
 *   Engineer) gets it from /api/epc/costs: the same formula run on the server,
 *   redacted to the cost, its date and PO/Quote (owner's decision 2026-11-02,
 *   "Std Cost only"). Before this, every item the engineer had not used in an
 *   earlier proposal read "no price data" — 444 of 521.
 *
 * Each screen then finishes with `pickCost(baseFor(id), lastUsedEntries)`, so
 * the rule that picks TUC / quote / last used lives in one place.
 */
export function useEpcCostBase(args: {
  role: string | null | undefined;
  components: { component_id: string; quote_cost_mode?: string | null; show_tuc_in_quotes?: boolean | null; quote_cost_buffer_pct?: number | null }[];
  tucMap: Map<string, TUCResult>;
  quotes: PriceQuote[];
  quoteItems: PriceQuoteLineItem[];
  fx: Record<string, FxRate>;
  globalBufferPct: number;
}) {
  const { role, components, tucMap, quotes, quoteItems, fx, globalBufferPct } = args;
  const perms = role ? ROLE_PERMISSIONS[role as UserRole] : null;
  const fromServer = !!perms && !perms.buySide && perms.canEditQuotes;

  const [server, setServer] = useState<Record<string, CostBase> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fromServer) return;
    let live = true;
    (async () => {
      try {
        const { data: { session } } = await createSupabaseClient().auth.getSession();
        const res = await fetch('/api/epc/costs', {
          headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
          cache: 'no-store',
        });
        const body = await res.json().catch(() => ({}));
        if (!live) return;
        if (res.ok) setServer((body as { costs?: Record<string, CostBase> }).costs ?? {});
        else setError((body as { error?: string }).error ?? `HTTP ${res.status}`);
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    })();
    return () => { live = false; };
  }, [fromServer]);

  const compById = useMemo(() => new Map(components.map((c) => [String(c.component_id), c])), [components]);

  const baseFor = useCallback((componentId: string): CostBase => {
    if (fromServer) return server?.[componentId] ?? EMPTY_COST_BASE;
    return costBase(componentId, tucMap, quotes, quoteItems, epcCostOpts(compById.get(componentId), globalBufferPct), fx);
  }, [fromServer, server, tucMap, quotes, quoteItems, compById, globalBufferPct, fx]);

  return {
    baseFor,
    /** True while an engineer's costs are still on their way. */
    loading: fromServer && server == null && error == null,
    /** The server refused or failed — say so rather than show "no price data". */
    error,
  };
}

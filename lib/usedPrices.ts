import type { SupabaseClient } from '@supabase/supabase-js';
import type { CostEntry } from './computeTUC';
import { composeDescription, type ProjectType, type SystemSpecs } from './projectSpec';

/**
 * What system that price was quoted FOR, e.g. "PV On-Grid 234 kWp DC /
 * 200 kW AC" — the proposal title's own engine, with the location dropped
 * and the "EPC for" prefix trimmed, because the price-history row is tight
 * and the customer is already on it. Custom projects compose to '' by
 * design; the caller falls back to the typed description.
 */
const systemSummary = (type: unknown, specs: unknown): string => {
  const t = (typeof type === 'string' ? type : 'custom') as ProjectType;
  const s = (specs && typeof specs === 'object' ? specs : {}) as SystemSpecs;
  return composeDescription(t, s, '').replace(/^EPC for /, '');
};

/** The proposal columns needed to describe the deal behind a price. */
export interface QuoteContextRow {
  customer_name?: string | null;
  project_type?: string | null;
  system_specs?: unknown;
  project_description?: string | null;
}
/** Columns to SELECT when a query feeds `quoteContext`. */
export const QUOTE_CONTEXT_COLS = 'customer_name, project_type, system_specs, project_description';

/**
 * Who a price was quoted for, and what system — THE one implementation, so
 * every price-history source describes a deal the same way. Catalog-linked
 * lines reach it through fetchUsedEntries; free-text lines through the
 * editor's own description-keyed history (which is why some rows showed no
 * context at all until both were routed here — field report 2026-07-31).
 */
export function quoteContext(q: QuoteContextRow | null | undefined): { customer: string; system: string } {
  if (!q) return { customer: '', system: '' };
  const composed = systemSummary(q.project_type, q.system_specs);
  return {
    customer: String(q.customer_name ?? '').trim(),
    // Custom-type projects compose to '' by design — their typed description
    // IS the project name, so it stands in.
    system: composed || String(q.project_description ?? '').trim(),
  };
}

/**
 * Prices previously used in project quotes, per component — the 'used' cost
 * source. Newest first per component.
 *
 * Each entry carries the DEAL it came from (customer + system size), not just
 * the quote number: a cost is only reusable if you can see whether it was
 * quoted for a comparable job (owner's ask, 2026-07-31).
 */
export async function fetchUsedEntries(
  supabase: SupabaseClient,
  excludeQuoteId?: string,
): Promise<Map<string, CostEntry[]>> {
  let itemsQuery = supabase
    .from('10.2_quote_items')
    .select('component_id, cost_price, quote_id, created_at')
    .not('component_id', 'is', null);
  if (excludeQuoteId) itemsQuery = itemsQuery.neq('quote_id', excludeQuoteId);

  const [itemsRes, quotesRes] = await Promise.all([
    itemsQuery,
    supabase.from('10.0_project_quotes')
      .select(`quote_id, quote_number, quote_date, ${QUOTE_CONTEXT_COLS}`),
  ]);

  const qMap = new Map((quotesRes.data ?? []).map((q) => [q.quote_id as string, q]));
  const map = new Map<string, CostEntry[]>();
  for (const it of itemsRes.data ?? []) {
    const cost = Number(it.cost_price);
    if (!it.component_id || !(cost > 0)) continue;
    const q = qMap.get(it.quote_id as string);
    const arr = map.get(it.component_id as string) ?? [];
    const ctx = quoteContext(q as QuoteContextRow | undefined);
    arr.push({
      kind: 'used',
      label: (q?.quote_number as string) || 'Project quote',
      date: (q?.quote_date as string) || String(it.created_at ?? '').slice(0, 10),
      unitCost: cost,
      ...ctx,
    });
    map.set(it.component_id as string, arr);
  }
  for (const arr of map.values()) arr.sort((a, b) => b.date.localeCompare(a.date));
  return map;
}

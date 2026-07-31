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
      .select('quote_id, quote_number, quote_date, customer_name, project_type, system_specs, project_description'),
  ]);

  const qMap = new Map((quotesRes.data ?? []).map((q) => [q.quote_id as string, q]));
  const map = new Map<string, CostEntry[]>();
  for (const it of itemsRes.data ?? []) {
    const cost = Number(it.cost_price);
    if (!it.component_id || !(cost > 0)) continue;
    const q = qMap.get(it.quote_id as string);
    const arr = map.get(it.component_id as string) ?? [];
    const system = systemSummary(q?.project_type, q?.system_specs)
      || String(q?.project_description ?? '').trim();
    arr.push({
      kind: 'used',
      label: (q?.quote_number as string) || 'Project quote',
      date: (q?.quote_date as string) || String(it.created_at ?? '').slice(0, 10),
      unitCost: cost,
      customer: (q?.customer_name as string) || '',
      system,
    });
    map.set(it.component_id as string, arr);
  }
  for (const arr of map.values()) arr.sort((a, b) => b.date.localeCompare(a.date));
  return map;
}

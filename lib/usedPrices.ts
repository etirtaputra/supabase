import type { SupabaseClient } from '@supabase/supabase-js';
import type { CostEntry } from './computeTUC';

/**
 * Prices previously used in project quotes, per component — the 'used' cost
 * source. Newest first per component.
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
    supabase.from('10.0_project_quotes').select('quote_id, quote_number, quote_date'),
  ]);

  const qMap = new Map((quotesRes.data ?? []).map((q) => [q.quote_id as string, q]));
  const map = new Map<string, CostEntry[]>();
  for (const it of itemsRes.data ?? []) {
    const cost = Number(it.cost_price);
    if (!it.component_id || !(cost > 0)) continue;
    const q = qMap.get(it.quote_id as string);
    const arr = map.get(it.component_id as string) ?? [];
    arr.push({
      kind: 'used',
      label: (q?.quote_number as string) || 'Project quote',
      date: (q?.quote_date as string) || String(it.created_at ?? '').slice(0, 10),
      unitCost: cost,
    });
    map.set(it.component_id as string, arr);
  }
  for (const arr of map.values()) arr.sort((a, b) => b.date.localeCompare(a.date));
  return map;
}

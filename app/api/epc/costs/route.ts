/**
 * GET /api/epc/costs — the Std Cost of every catalogue item, for a role that
 * prices EPC proposals but may not read the buy side.
 *
 * Since 2026-09-16 the supplier tables (4.x quotes, 5.x POs, 6.0 costs) are
 * closed to everyone off the buy side. The Project Engineer kept the EPC
 * editor, the proposals list and the BOM Calculator, but every cost they used
 * came from those tables — so 444 of the 521 priced items read "no price
 * data" for an engineer (measured 2026-11-02; the SUNKEAN aluminium PV cable
 * quoted that morning was how the owner found it).
 *
 * Owner's decision, 2026-11-02 — "Std Cost only": the engineer sees the
 * recommended cost, its date, and PO or Quote. Never the supplier, the raw
 * supplier price, a PO/PI number or an exchange rate. So this route:
 *   - reads the buy side with the service role, because the caller cannot;
 *   - answers only roles with `canEditQuotes` (the ones that price EPC work);
 *   - computes with the SAME `costBase` the owner's screen runs, so the two
 *     numbers cannot drift apart;
 *   - sends each item through `redactCostBase`, which keeps only the cost,
 *     the date, the kind and the Std Cost flag. `lib/epcCosts.test.ts` pins it.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { callerFromRequest, AgentAuthError } from '@/lib/agentApi';
import { fetchAllRows, fetchAllComponents } from '@/lib/fetchAllRows';
import { computeTUCMap, costBase, redactCostBase, epcCostOpts, fxFromHistory, type CostBase } from '@/lib/computeTUC';
import { deriveExchangeRates } from '@/lib/exchangeRates';
import { loadSettings } from '@/lib/settings';
import { ROLE_PERMISSIONS, type UserRole } from '@/constants/roles';
import { TABLE_NAMES } from '@/constants/tableNames';
import type { PriceQuote, PriceQuoteLineItem, PurchaseOrder, PurchaseLineItem, POCost } from '@/types/database';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  let role: string;
  try {
    ({ role } = await callerFromRequest(request));
  } catch (e) {
    const status = e instanceof AgentAuthError ? e.status : 401;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
  // The gate comes before the first buy-side read.
  if (!ROLE_PERMISSIONS[role as UserRole]?.canEditQuotes) {
    return NextResponse.json({ error: 'EPC costs are for roles that price EPC proposals' }, { status: 403 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Server is not configured to read costs' }, { status: 500 });
  const db = createClient(url, key, { auth: { persistSession: false } });

  const all = async <T,>(table: string, order: string): Promise<T[]> => {
    const r = await fetchAllRows<T>((f, t) => db.from(table).select('*').order(order, { ascending: true }).range(f, t));
    if (r.error || r.truncated) throw new Error(`${table}: ${r.error ?? 'too many rows'}`);
    return r.rows;
  };

  try {
    const [components, quotes, quoteItems, pos, poItems, poCosts, fxRes, settings] = await Promise.all([
      fetchAllComponents<{ component_id: string; quote_cost_mode: string | null; show_tuc_in_quotes: boolean | null; quote_cost_buffer_pct: number | null }>(
        db, 'component_id, quote_cost_mode, show_tuc_in_quotes, quote_cost_buffer_pct'),
      all<PriceQuote>(TABLE_NAMES.PRICE_QUOTES, 'quote_id'),
      all<PriceQuoteLineItem>(TABLE_NAMES.PRICE_QUOTE_LINE_ITEMS, 'quote_line_id'),
      all<PurchaseOrder>(TABLE_NAMES.PURCHASES, 'po_id'),
      all<PurchaseLineItem>(TABLE_NAMES.PURCHASE_LINE_ITEMS, 'po_line_item_id'),
      all<POCost>(TABLE_NAMES.PO_COSTS, 'cost_id'),
      db.from('9.1_fx_benchmark_rates').select('benchmark_id, currency, rate, note, set_at, set_by_email'),
      loadSettings(db),
    ]);

    const tucMap = computeTUCMap(pos, poItems, poCosts);
    const fx = fxFromHistory(pos, deriveExchangeRates(pos, poItems, poCosts, quotes), fxRes.data ?? []);
    const costs: Record<string, CostBase> = {};
    for (const c of components) {
      const base = costBase(c.component_id, tucMap, quotes, quoteItems, epcCostOpts(c, settings.epcCostBufferPct), fx);
      if (base.tuc || base.entries.length) costs[c.component_id] = redactCostBase(base);
    }
    return NextResponse.json({ costs }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    // A failed read must not look like "no price data".
    return NextResponse.json({ error: `Could not read costs: ${(e as Error).message}` }, { status: 502 });
  }
}

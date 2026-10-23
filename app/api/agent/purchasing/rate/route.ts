import { NextRequest, NextResponse } from 'next/server';
import { callerFromRequest, AgentAuthError } from '@/lib/agentApi';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { deriveExchangeRates } from '@/lib/exchangeRates';
import { estimatePoRate } from '@/lib/poRate';
import { fetchLiveFx } from '@/lib/liveFx';
import { selectAll } from '@/lib/fetchAllRows';
import type { PurchaseOrder, POCost, PriceQuote } from '@/types/database';

/**
 * GET /api/agent/purchasing/rate — the exchange rate to save a new PO with.
 *
 * WHY THIS EXISTS (owner, 2026-10-23): *"whenever MIRA helps to enter the PO
 * in ICAPROC, she always misses the exchange or currency rate."* The New Deal
 * screen estimates an empty Exch Rate from payment history in the browser; an
 * agent writing `5.0_purchases` never ran that code, so three KSTAR CNY POs
 * were saved with no rate and read as CNY 1 = IDR 1. This route runs the
 * screen's own rule (`lib/poRate.ts`) and hands back the number.
 *
 * Query:
 *   ?supplier_id=…&currency=CNY      the supplier and currency of the new PO
 *   ?po_number=…                     an existing PO — its own supplier and currency
 *
 * Read-only. Buy-side roles only, as the caller (RLS applies).
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { client, email, role } = await callerFromRequest(request);
    const perms = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS];
    if (!perms?.buySide) {
      return NextResponse.json({
        error: 'Your role may not read purchasing.', actor: { email, role },
      }, { status: 403 });
    }

    const url = new URL(request.url);
    const poNumber = (url.searchParams.get('po_number') ?? '').trim();
    let supplierId = (url.searchParams.get('supplier_id') ?? '').trim() || null;
    let currency = (url.searchParams.get('currency') ?? '').trim().toUpperCase() || null;
    let stated: number | null = null;

    if (poNumber) {
      const { data, error } = await client.from('5.0_purchases')
        .select('po_number, supplier_id, currency, exchange_rate')
        .ilike('po_number', poNumber.replace(/[\\%_]/g, (c) => `\\${c}`)).limit(1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const po = data?.[0];
      if (!po) return NextResponse.json({ error: `No PO numbered ${poNumber}.` }, { status: 404 });
      supplierId = po.supplier_id ? String(po.supplier_id) : null;
      currency = po.currency ?? null;
      stated = Number(po.exchange_rate) || null;
    }
    if (!currency) {
      return NextResponse.json({ error: 'Give ?supplier_id=…&currency=… or ?po_number=….' }, { status: 400 });
    }
    if (currency === 'IDR') {
      return NextResponse.json({
        supplier_id: supplierId, currency, rate: null, stated_rate: stated,
        how_to_use: 'An IDR PO carries no exchange_rate. Save it as null.',
      });
    }

    const [posRes, costsRes, quotesRes] = await Promise.all([
      selectAll<PurchaseOrder>((f, t) => client.from('5.0_purchases')
        .select('po_id, po_number, quote_id, supplier_id, currency, total_value, exchange_rate')
        .neq('currency', 'IDR').range(f, t)),
      selectAll<POCost>((f, t) => client.from('6.0_po_costs')
        .select('po_id, cost_category, amount, currency, exchange_rate, payment_date').range(f, t)),
      selectAll<PriceQuote>((f, t) => client.from('4.0_price_quotes')
        .select('quote_id, supplier_id').range(f, t)),
    ]);
    const err = posRes.error ?? costsRes.error ?? quotesRes.error;
    if (err) return NextResponse.json({ error: err.message }, { status: 500 });

    const history = deriveExchangeRates(posRes.data, [], costsRes.data, quotesRes.data);
    const own = estimatePoRate(history, supplierId, currency, null);
    const live = own ? null : await fetchLiveFx();
    const est = own ?? estimatePoRate(history, supplierId, currency, live?.rates ?? null);
    const fromPo = est?.po_id ? posRes.data.find((p) => String(p.po_id) === est.po_id) : null;

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      actor: { email, role },
      supplier_id: supplierId,
      currency,
      rate: est?.rate ?? null,
      source: est?.source ?? null,
      from_po_number: fromPo?.po_number ?? null,
      from_payment_date: est?.date ?? null,
      stated_rate: stated,
      how_to_use: est
        ? 'Save rate as 5.0_purchases.exchange_rate on the PO insert. It is an ESTIMATE — the same one the '
          + 'New Deal screen saves when Exch Rate is left empty (lib/poRate.ts): this supplier\'s latest rate '
          + 'in this currency, else any supplier\'s, else today\'s market rate. If the PI or the bank states a '
          + 'rate, that wins — save that instead. The database refuses a non-IDR PO without a rate.'
        : 'No rate on record in this currency and the market rate could not be fetched. Ask a person for the '
          + 'rate; do not save the PO without one, and never save 1.',
    });
  } catch (e) {
    if (e instanceof AgentAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

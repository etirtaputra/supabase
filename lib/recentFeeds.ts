/**
 * The three "what happened lately" feeds: money, shipments, service.
 *
 * The dashboard already has ONE activity stream, deliberately mixed, so a
 * sales document cannot hide behind a wall of purchase orders. These are the
 * opposite: a single kind of event, deep enough to be a working list rather
 * than a sample. Someone who reconciles the bank every morning wants the last
 * five payments without reading around five quotations to find them.
 *
 * PAYMENTS ARE TWO DIFFERENT THINGS and this is the one place that must not
 * blur them: money IN is a customer receipt, money OUT is a payment against a
 * purchase order — the buy price read backwards, and buy-side only since
 * 2026-08-19. So the caller states which directions it may read, and a
 * direction not asked for is never queried. A feed that quietly returned only
 * half would look like a complete list of payments and be a lie by omission,
 * which is why the result says which halves it contains.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** One event, in the shape every feed card renders. */
export interface FeedRow {
  key: string;
  /** The headline — a document number, a customer, a subject. */
  title: string;
  /** The second line: who, or what state it is in. */
  sub: string;
  /** ISO date the event happened. Sorted on this, newest first. */
  at: string;
  /** Money involved, where the event has an amount. */
  amount?: number;
  /** 'in' money arriving · 'out' money leaving · 'neutral' no direction. */
  direction: 'in' | 'out' | 'neutral';
  /** Where to go to see the whole thing. */
  href: string;
  /** A short state badge — 'delivered', 'open', 'preparing'. */
  badge?: string;
}

export interface Feed {
  rows: FeedRow[];
  /**
   * What this feed is allowed to contain. A payments feed missing one
   * direction must SAY so rather than present half the truth as all of it.
   */
  includes: string[];
}

const num = (v: unknown): number => Number(v) || 0;
const iso = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Newest first, capped. Pure so the merge of two sources — which is the only
 * real logic in a feed — can be proved without a database.
 */
export function mergeRecent(rows: FeedRow[], limit: number): FeedRow[] {
  return [...rows]
    // An event with no date cannot claim a place among dated ones; it sorts
    // last rather than to the top, which is where an empty string would put it.
    .sort((a, b) => (b.at || '').localeCompare(a.at || '') || a.key.localeCompare(b.key))
    .slice(0, limit);
}

/**
 * The last payments this role may see, both directions where permitted.
 *
 * `names` are resolved by the caller (invoice/PO numbers, customer names) so
 * this stays one round trip per source.
 */
export async function fetchRecentPayments(
  supabase: SupabaseClient,
  opts: { moneyIn: boolean; moneyOut: boolean },
  limit = 5,
): Promise<Feed> {
  const includes: string[] = [];
  if (opts.moneyIn) includes.push('in');
  if (opts.moneyOut) includes.push('out');

  const [inRes, outRes, orderRes, custRes, poRes] = await Promise.all([
    opts.moneyIn
      ? supabase.from('26.0_customer_receipts')
          .select('receipt_id, receipt_number, quote_id, amount, payment_date, payment_method')
          .not('payment_date', 'is', null)
          .order('payment_date', { ascending: false }).limit(limit * 2)
      : Promise.resolve({ data: null, error: null }),
    opts.moneyOut
      ? supabase.from('6.0_po_costs')
          .select('cost_id, po_id, amount, currency, exchange_rate, payment_date, cost_category')
          .not('payment_date', 'is', null)
          .order('payment_date', { ascending: false }).limit(limit * 2)
      : Promise.resolve({ data: null, error: null }),
    opts.moneyIn
      ? supabase.from('22.0_sales_quotes').select('quote_id, customer_id, order_number, quote_number')
      : Promise.resolve({ data: null, error: null }),
    opts.moneyIn
      ? supabase.from('20.0_customers').select('customer_id, display_name, legal_name')
      : Promise.resolve({ data: null, error: null }),
    opts.moneyOut
      ? supabase.from('5.0_purchases').select('po_id, po_number, pi_number')
      : Promise.resolve({ data: null, error: null }),
  ]);

  const custOf = new Map<string, string>();
  for (const c of (custRes.data ?? []) as { customer_id: string; display_name: string | null; legal_name: string | null }[]) {
    custOf.set(c.customer_id, (c.display_name || '').trim() || (c.legal_name || '').trim() || 'Unnamed customer');
  }
  const orderOf = new Map<string, { customer_id: string | null; label: string }>();
  for (const o of (orderRes.data ?? []) as { quote_id: string; customer_id: string | null; order_number: string | null; quote_number: string | null }[]) {
    orderOf.set(String(o.quote_id), { customer_id: o.customer_id, label: o.order_number || o.quote_number || '' });
  }
  const poOf = new Map<string, string>();
  for (const p of (poRes.data ?? []) as { po_id: string | number; po_number: string | null; pi_number: string | null }[]) {
    poOf.set(String(p.po_id), p.po_number || p.pi_number || '');
  }

  const rows: FeedRow[] = [];
  for (const r of (inRes.data ?? []) as { receipt_id: string; receipt_number: string | null; quote_id: string | null; amount: number; payment_date: string | null; payment_method: string | null }[]) {
    const order = r.quote_id ? orderOf.get(String(r.quote_id)) : undefined;
    const who = order?.customer_id ? custOf.get(order.customer_id) : undefined;
    rows.push({
      key: `in-${r.receipt_id}`,
      title: who || r.receipt_number || 'Receipt',
      sub: [order?.label, r.payment_method].filter(Boolean).join(' · ') || 'customer payment',
      at: iso(r.payment_date), amount: num(r.amount), direction: 'in',
      href: '/invoices',
    });
  }
  for (const c of (outRes.data ?? []) as { cost_id: string; po_id: string | number; amount: number; currency: string; exchange_rate: number | null; payment_date: string | null; cost_category: string }[]) {
    // Shown in the currency it was PAID in — converting a supplier payment to
    // rupiah here would invent a rate the payment never carried.
    const idr = c.currency === 'IDR' ? num(c.amount) : num(c.amount) * num(c.exchange_rate);
    rows.push({
      key: `out-${c.cost_id}`,
      title: poOf.get(String(c.po_id)) || 'Purchase order',
      sub: String(c.cost_category || '').replace(/_/g, ' '),
      at: iso(c.payment_date),
      amount: idr > 0 ? idr : undefined,
      direction: 'out',
      href: '/purchasing?tab=financials',
    });
  }
  return { rows: mergeRecent(rows, limit), includes };
}

/** The last delivery orders — what left the warehouse, and whether it landed. */
export async function fetchRecentDeliveries(supabase: SupabaseClient, limit = 5): Promise<Feed> {
  const [doRes, orderRes, custRes] = await Promise.all([
    supabase.from('24.0_delivery_orders')
      .select('do_id, quote_id, do_number, status, delivery_date, delivered_at, created_at')
      .order('created_at', { ascending: false }).limit(limit * 3),
    supabase.from('22.0_sales_quotes').select('quote_id, customer_id, order_number, quote_number'),
    supabase.from('20.0_customers').select('customer_id, display_name, legal_name'),
  ]);
  const custOf = new Map<string, string>();
  for (const c of (custRes.data ?? []) as { customer_id: string; display_name: string | null; legal_name: string | null }[]) {
    custOf.set(c.customer_id, (c.display_name || '').trim() || (c.legal_name || '').trim() || 'Unnamed customer');
  }
  const orderOf = new Map<string, { customer_id: string | null; label: string }>();
  for (const o of (orderRes.data ?? []) as { quote_id: string; customer_id: string | null; order_number: string | null; quote_number: string | null }[]) {
    orderOf.set(String(o.quote_id), { customer_id: o.customer_id, label: o.order_number || o.quote_number || '' });
  }

  const rows: FeedRow[] = ((doRes.data ?? []) as { do_id: string; quote_id: string; do_number: string | null; status: string | null; delivery_date: string | null; delivered_at: string | null; created_at: string | null }[])
    .map((d) => {
      const order = orderOf.get(String(d.quote_id));
      const who = order?.customer_id ? custOf.get(order.customer_id) : undefined;
      return {
        key: `do-${d.do_id}`,
        title: who || d.do_number || 'Delivery',
        // The DO's own number stays visible: it is what the driver carries.
        sub: [d.do_number, order?.label].filter(Boolean).join(' · ') || 'delivery order',
        // Dated by when it ACTUALLY landed where that is known, so a feed of
        // recent deliveries is not led by one that was merely raised today.
        at: iso(d.delivered_at) || iso(d.delivery_date) || iso(d.created_at),
        direction: 'neutral' as const,
        href: `/sales/${d.quote_id}`,
        badge: d.status ?? undefined,
      };
    });
  return { rows: mergeRecent(rows, limit), includes: ['deliveries'] };
}

/** The last service tickets — what came back, and whether it is still open. */
export async function fetchRecentCases(supabase: SupabaseClient, limit = 5): Promise<Feed> {
  const [caseRes, custRes] = await Promise.all([
    supabase.from('27.0_aftersales_cases')
      .select('case_id, case_number, customer_id, subject, status, category, reported_at, created_at, serial_text, is_external')
      .order('reported_at', { ascending: false }).limit(limit * 3),
    supabase.from('20.0_customers').select('customer_id, display_name, legal_name'),
  ]);
  const custOf = new Map<string, string>();
  for (const c of (custRes.data ?? []) as { customer_id: string; display_name: string | null; legal_name: string | null }[]) {
    custOf.set(c.customer_id, (c.display_name || '').trim() || (c.legal_name || '').trim() || 'Unnamed customer');
  }
  const rows: FeedRow[] = ((caseRes.data ?? []) as { case_id: string; case_number: string | null; customer_id: string | null; subject: string | null; status: string | null; category: string | null; reported_at: string | null; created_at: string | null; serial_text: string | null; is_external: boolean | null }[])
    .map((c) => ({
      key: `case-${c.case_id}`,
      title: (c.subject || '').trim() || c.case_number || 'Service ticket',
      sub: [
        c.customer_id ? custOf.get(c.customer_id) : null,
        c.serial_text,
        c.is_external ? 'not ours' : null,
      ].filter(Boolean).join(' · ') || (c.category ?? 'service'),
      at: iso(c.reported_at) || iso(c.created_at),
      direction: 'neutral' as const,
      href: '/aftersales',
      badge: c.status ?? undefined,
    }));
  return { rows: mergeRecent(rows, limit), includes: ['cases'] };
}

/**
 * What the dashboard actually asks: "what needs me, and what has moved?"
 *
 * Every signal below is money already sitting in the system — an order that
 * cannot ship, an invoice nobody chased, a quote nobody answered. The queue
 * ranks them by AMOUNT AT STAKE rather than recency, because a five-day-old
 * Rp 300M blockage matters more than this morning's Rp 2M one.
 *
 * Nothing here is a new source of truth: each signal re-derives from the same
 * tables the owning module uses (stock balances, receipts, PO costs), so a fix
 * made on that module clears the row here on the next load.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RolePermissions } from '@/constants/roles';
import { COMMITTED_STATUSES } from './salesStatus';
import { fetchDeliveredByQuoteComp } from './reservedStock';
import { PRINCIPAL_CATS } from '@/constants/costCategories';
import { todayISO } from './dateRange';
import { fetchLandedVariances } from './landedCost';
import { fetchReorderAlerts } from './reorder';
import { computeInTransit, type OpenPo, type ReceivedPo, type PoCost } from './inTransit';

export type ActionDomain = 'sell' | 'buy' | 'cash';

export interface ActionItem {
  key: string;
  domain: ActionDomain;
  /** What is wrong, in the fewest words that still name the thing. */
  title: string;
  /** The consequence — what it costs to leave it. */
  detail: string;
  /** Money at stake, used to rank; 0 for signals that are counts only. */
  amount: number;
  count: number;
  href: string;
  /** 'urgent' colours the row; 'watch' is informational. */
  tone: 'urgent' | 'watch';
}

export interface ActivityRow {
  key: string;
  domain: ActionDomain | 'epc';
  kind: string;             // short badge — "PO", "Payment", "Invoice"
  title: string;
  sub: string;
  at: string;               // ISO-ish, for ordering
  href: string;
}

const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (iso: string): number => {
  const then = new Date(`${iso.slice(0, 10)}T00:00:00`).getTime();
  return Math.max(0, Math.round((Date.now() - then) / 86400000));
};

export interface QueueOptions {
  /** An issued invoice older than this with money outstanding is overdue. */
  arOverdueDays: number;
  /** A quote sent this long ago with no answer needs a nudge. */
  quoteFollowUpDays: number;
}

/**
 * Build the action queue for what this role can act on. Each block is
 * independent — one failing (RLS, a missing table) costs its own row, not the
 * whole queue.
 */
export async function fetchActionQueue(
  supabase: SupabaseClient,
  perms: RolePermissions,
  opts: QueueOptions,
): Promise<ActionItem[]> {
  const items: ActionItem[] = [];

  // ── Sell side ─────────────────────────────────────────────────────────────
  if (perms.sellSide) {
    const [qRes, iRes, invRes, rcpRes, balRes] = await Promise.all([
      supabase.from('22.0_sales_quotes').select('quote_id, quote_number, order_number, status, grand_total, quote_date, valid_until, updated_at, customer_id'),
      supabase.from('22.1_sales_quote_items').select('quote_id, component_id, quantity, is_section'),
      supabase.from('25.0_sales_invoices').select('invoice_id, quote_id, invoice_number, grand_total, issued_at'),
      supabase.from('26.0_customer_receipts').select('invoice_id, quote_id, amount'),
      supabase.from('30.1_stock_balances').select('component_id, qty_on_hand'),
    ]);

    const quotes = (qRes.data ?? []) as { quote_id: string; quote_number: string; order_number: string | null; status: string; grand_total: number; quote_date: string; valid_until: string | null; updated_at: string; customer_id: string | null }[];

    // ── Orders that cannot ship ────────────────────────────────────────────
    // Committed demand per component, less what already left on a delivered DO,
    // against on-hand across every warehouse. Same rule as /stock's Shortages.
    if (!qRes.error && !iRes.error && !balRes.error) {
      const committed = new Set(quotes.filter((q) => COMMITTED_STATUSES.has(q.status)).map((q) => q.quote_id));
      const delivered = await fetchDeliveredByQuoteComp(supabase);
      const need = new Map<string, number>();
      const blockedQuotes = new Map<string, number>();   // quote → its value
      for (const it of (iRes.data ?? []) as { quote_id: string; component_id: string | null; quantity: number; is_section: boolean }[]) {
        if (!it.component_id || it.is_section || !committed.has(it.quote_id)) continue;
        const shipped = delivered.get(`${it.quote_id}·${it.component_id}`) ?? 0;
        const open = Math.max(0, (Number(it.quantity) || 0) - shipped);
        if (open > 0) need.set(it.component_id, (need.get(it.component_id) ?? 0) + open);
      }
      const onHand = new Map<string, number>();
      for (const b of (balRes.data ?? []) as { component_id: string; qty_on_hand: number }[]) {
        onHand.set(b.component_id, (onHand.get(b.component_id) ?? 0) + (Number(b.qty_on_hand) || 0));
      }
      const short = new Set<string>();
      for (const [cid, want] of need) if (want > (onHand.get(cid) ?? 0)) short.add(cid);
      if (short.size) {
        // Which orders are waiting on a short item, and what they are worth
        for (const it of (iRes.data ?? []) as { quote_id: string; component_id: string | null; is_section: boolean }[]) {
          if (!it.component_id || it.is_section || !committed.has(it.quote_id)) continue;
          if (!short.has(it.component_id)) continue;
          const q = quotes.find((x) => x.quote_id === it.quote_id);
          if (q) blockedQuotes.set(q.quote_id, Number(q.grand_total) || 0);
        }
        const value = [...blockedQuotes.values()].reduce((s, v) => s + v, 0);
        items.push({
          key: 'shortage', domain: 'sell', tone: 'urgent',
          title: `${blockedQuotes.size} order${blockedQuotes.size !== 1 ? 's' : ''} cannot ship`,
          detail: `${short.size} item${short.size !== 1 ? 's' : ''} short of confirmed demand`,
          amount: value, count: blockedQuotes.size, href: '/stock',
        });
      }
    }

    // ── Invoices past due ──────────────────────────────────────────────────
    if (!invRes.error && !rcpRes.error) {
      const paidByInvoice = new Map<string, number>();
      for (const r of (rcpRes.data ?? []) as { invoice_id: string | null; amount: number }[]) {
        if (r.invoice_id) paidByInvoice.set(r.invoice_id, (paidByInvoice.get(r.invoice_id) ?? 0) + (Number(r.amount) || 0));
      }
      const cutoff = daysAgo(opts.arOverdueDays);
      let owed = 0, n = 0, oldest = 0;
      for (const inv of (invRes.data ?? []) as { invoice_id: string; grand_total: number; issued_at: string | null }[]) {
        if (!inv.issued_at || inv.issued_at.slice(0, 10) > cutoff) continue;
        const out = (Number(inv.grand_total) || 0) - (paidByInvoice.get(inv.invoice_id) ?? 0);
        if (out <= 0.5) continue;
        owed += out; n += 1;
        oldest = Math.max(oldest, daysBetween(inv.issued_at));
      }
      if (n > 0) {
        items.push({
          key: 'ar-overdue', domain: 'cash', tone: 'urgent',
          title: `${n} invoice${n !== 1 ? 's' : ''} past ${opts.arOverdueDays} days`,
          detail: `oldest ${oldest} days — cash already earned, not collected`,
          amount: owed, count: n, href: '/invoices',
        });
      }
    }

    // ── Quotes sent, no answer ─────────────────────────────────────────────
    // A sent quote needs a nudge when it has gone quiet past the follow-up
    // threshold OR its own valid_until has passed — an expired offer is stale
    // by definition, however recently it went out.
    if (!qRes.error) {
      const cutoff = daysAgo(opts.quoteFollowUpDays);
      const today = todayISO();
      const lapsed = (q: { valid_until: string | null }) => !!q.valid_until && q.valid_until < today;
      const stale = quotes.filter((q) => q.status === 'sent'
        && ((q.updated_at ?? q.quote_date ?? '').slice(0, 10) <= cutoff || lapsed(q)));
      if (stale.length) {
        const value = stale.reduce((s, q) => s + (Number(q.grand_total) || 0), 0);
        const oldest = Math.max(...stale.map((q) => daysBetween(q.updated_at ?? q.quote_date ?? '')));
        const expired = stale.filter(lapsed).length;
        items.push({
          key: 'quote-followup', domain: 'sell', tone: 'watch',
          title: `${stale.length} quotation${stale.length !== 1 ? 's' : ''} awaiting an answer`,
          detail: `sent over ${opts.quoteFollowUpDays} days ago — oldest ${oldest} days${expired ? ` · ${expired} past validity` : ''}`,
          amount: value, count: stale.length, href: '/sales',
        });
      }
    }
  }

  // ── Buy side: received but unpaid ────────────────────────────────────────
  if (perms.buySide) {
    const [poRes, costRes] = await Promise.all([
      supabase.from('5.0_purchases').select('po_id, po_number, status, total_value, currency, exchange_rate, po_date, estimated_delivery_date, supplier_id, actual_received_date'),
      supabase.from('6.0_po_costs').select('po_id, cost_category, amount, currency, exchange_rate'),
    ]);
    if (!poRes.error && !costRes.error) {
      const paid = new Map<string, number>();
      for (const c of (costRes.data ?? []) as { po_id: string; cost_category: string; amount: number; currency: string; exchange_rate: number | null }[]) {
        if (!PRINCIPAL_CATS.has(c.cost_category)) continue;
        const idr = c.currency === 'IDR' ? Number(c.amount) : Number(c.amount) * (Number(c.exchange_rate) || 0);
        paid.set(String(c.po_id), (paid.get(String(c.po_id)) ?? 0) + (idr || 0));
      }
      let owed = 0, n = 0;
      for (const po of (poRes.data ?? []) as { po_id: string; status: string; total_value: number; currency: string; exchange_rate: number | null }[]) {
        if (!['Fully Received', 'Partially Received'].includes(po.status ?? '')) continue;
        const rate = po.currency === 'IDR' ? 1 : (Number(po.exchange_rate) || 0);
        const totalIdr = (Number(po.total_value) || 0) * rate;
        const out = totalIdr - (paid.get(String(po.po_id)) ?? 0);
        // Ignore rounding dust and any PO whose rate was never recorded
        if (totalIdr <= 0 || out <= 1000) continue;
        owed += out; n += 1;
      }
      if (n > 0) {
        items.push({
          key: 'po-unpaid', domain: 'buy', tone: 'watch',
          title: `${n} received PO${n !== 1 ? 's' : ''} still unpaid`,
          detail: 'goods are in the warehouse; the supplier is waiting',
          amount: owed, count: n, href: '/purchasing?tab=lookup',
        });
      }

      // ── POs overdue: ordered (often prepaid), past their expected arrival ───
      // Expected = the stamped ETA, else PO date + this supplier's measured lead
      // time. Money already out the door and late is money to chase — ranked by
      // the paid capital at stake, or the PO value when nothing is paid yet.
      const it = computeInTransit(
        (poRes.data ?? []) as OpenPo[],
        (costRes.data ?? []) as PoCost[],
        (poRes.data ?? []) as ReceivedPo[],
        todayISO(),
      );
      if (it.overdueCount > 0) {
        items.push({
          key: 'po-overdue', domain: 'buy', tone: 'urgent',
          title: `${it.overdueCount} PO${it.overdueCount !== 1 ? 's' : ''} overdue`,
          detail: `${it.overduePaidIdr > 0 ? 'paid for, ' : ''}past expected arrival — oldest ${it.maxDaysLate} day${it.maxDaysLate !== 1 ? 's' : ''} late; chase the supplier`,
          amount: it.overduePaidIdr || it.overdueValueIdr, count: it.overdueCount, href: '/purchasing?tab=lookup',
        });
      }
    }

    // ── Landed cost not yet trued up ───────────────────────────────────────
    // The freight invoice, the duty and the final payment arrive after the
    // goods are already booked in. Until the correction is posted, stock sits
    // below what it cost and every margin off that cost reads too well.
    try {
      const landed = await fetchLandedVariances(supabase);
      if (landed.ready.length > 0) {
        items.push({
          key: 'landed-variance', domain: 'buy', tone: 'watch',
          title: `${landed.ready.length} PO${landed.ready.length !== 1 ? 's' : ''} costing more than stock says`,
          detail: landed.readyInventoryDelta !== 0
            ? 'bills landed after the goods did — post the correction and stock value catches up'
            : 'bills landed after the goods were sold — the margin on them was overstated',
          amount: landed.readyDelta, count: landed.ready.length, href: '/stock/reconcile',
        });
      }
    } catch { /* additive — never cost the rest of the queue */ }

    // ── Items at their reorder point ───────────────────────────────────────
    // Demand rate × measured lead time says the next PO is due NOW — the
    // shortage that hasn't happened yet. Full math + per-item detail on /stock.
    try {
      const alerts = await fetchReorderAlerts(supabase);
      if (alerts.length) {
        const urgent = alerts.filter((a) => a.urgent).length;
        items.push({
          key: 'reorder', domain: 'buy', tone: urgent ? 'urgent' : 'watch',
          title: `${alerts.length} item${alerts.length !== 1 ? 's' : ''} at reorder point`,
          detail: urgent
            ? `${urgent} projected to stock out before a PO raised today could arrive`
            : 'live + incoming at or below demand over lead time + safety buffer',
          amount: 0, count: alerts.length, href: '/stock',
        });
      }
    } catch { /* alerts are additive — never cost the rest of the queue */ }
  }

  // ── Cash: movements nobody assigned to an account ────────────────────────
  if (perms.canViewBanks) {
    const [rcpRes, costRes] = await Promise.all([
      supabase.from('26.0_customer_receipts').select('receipt_id', { count: 'exact', head: true }).is('bank_account_id', null),
      supabase.from('6.0_po_costs').select('cost_id', { count: 'exact', head: true }).is('bank_account_id', null).not('payment_date', 'is', null),
    ]);
    const n = (rcpRes.count ?? 0) + (costRes.count ?? 0);
    if (n > 0) {
      items.push({
        key: 'bank-untagged', domain: 'cash', tone: 'watch',
        title: `${n} movement${n !== 1 ? 's' : ''} not on a bank account`,
        detail: 'until they are tagged, no statement reconciles',
        amount: 0, count: n, href: '/banks',
      });
    }
  }

  // Money at stake first; count-only signals fall to the bottom
  return items.sort((a, b) => (b.amount - a.amount) || (b.count - a.count));
}

/**
 * One activity stream instead of five parallel feeds — same information, a
 * fifth of the space, and a sales document no longer hides behind a wall of
 * purchase orders.
 */
export async function fetchActivity(supabase: SupabaseClient, perms: RolePermissions, limit = 14): Promise<ActivityRow[]> {
  const rows: ActivityRow[] = [];

  if (perms.sellSide) {
    const [qRes, rcpRes] = await Promise.all([
      supabase.from('22.0_sales_quotes')
        .select('quote_id, quote_number, order_number, invoice_number, status, grand_total, updated_at')
        .order('updated_at', { ascending: false }).limit(limit),
      supabase.from('26.0_customer_receipts')
        .select('receipt_id, quote_id, receipt_number, amount, payment_date')
        .order('payment_date', { ascending: false }).limit(limit),
    ]);
    for (const q of (qRes.data ?? []) as { quote_id: string; quote_number: string; order_number: string | null; invoice_number: string | null; status: string; grand_total: number; updated_at: string }[]) {
      rows.push({
        key: `sq-${q.quote_id}`, domain: 'sell', kind: q.invoice_number ? 'Invoice' : q.order_number ? 'Order' : 'Quote',
        title: q.invoice_number || q.order_number || q.quote_number || '(no number)',
        sub: q.status, at: q.updated_at ?? '', href: `/sales/${q.quote_id}`,
      });
    }
    for (const r of (rcpRes.data ?? []) as { receipt_id: string; quote_id: string; receipt_number: string; amount: number; payment_date: string }[]) {
      rows.push({
        key: `rcpt-${r.receipt_id}`, domain: 'cash', kind: 'Received',
        title: r.receipt_number || 'Payment', sub: 'customer payment',
        at: r.payment_date ?? '', href: `/sales/${r.quote_id}`,
      });
    }
  }

  if (perms.buySide) {
    const [poRes, costRes] = await Promise.all([
      supabase.from('5.0_purchases').select('po_id, po_number, pi_number, status, updated_at, po_date')
        .order('updated_at', { ascending: false }).limit(limit),
      supabase.from('6.0_po_costs').select('cost_id, po_id, amount, currency, payment_date, cost_category')
        .not('payment_date', 'is', null).order('payment_date', { ascending: false }).limit(limit),
    ]);
    for (const p of (poRes.data ?? []) as { po_id: string; po_number: string; pi_number: string | null; status: string; updated_at: string; po_date: string }[]) {
      rows.push({
        key: `po-${p.po_id}`, domain: 'buy', kind: 'PO',
        title: p.po_number || p.pi_number || `PO ${p.po_id}`, sub: p.status ?? '',
        at: p.updated_at ?? p.po_date ?? '',
        href: `/purchasing?tab=lookup&q=${encodeURIComponent(p.po_number || p.pi_number || '')}`,
      });
    }
    for (const c of (costRes.data ?? []) as { cost_id: string; po_id: string; amount: number; currency: string; payment_date: string; cost_category: string }[]) {
      rows.push({
        key: `cost-${c.cost_id}`, domain: 'buy', kind: 'Paid',
        title: `${c.currency} ${Math.round(Number(c.amount) || 0).toLocaleString('en-US')}`,
        sub: (c.cost_category ?? '').replace(/_/g, ' '),
        at: c.payment_date ?? '', href: '/purchasing?tab=financials',
      });
    }
  }

  if (perms.projects) {
    const { data } = await supabase.from('10.0_project_quotes')
      .select('quote_id, quote_number, customer_name, status, updated_at')
      .order('updated_at', { ascending: false }).limit(limit);
    for (const q of (data ?? []) as { quote_id: string; quote_number: string; customer_name: string; status: string; updated_at: string }[]) {
      rows.push({
        key: `epc-${q.quote_id}`, domain: 'epc', kind: 'EPC',
        title: q.quote_number || '(no number)', sub: q.customer_name || q.status,
        at: q.updated_at ?? '', href: `/proposals/${q.quote_id}`,
      });
    }
  }

  return rows.sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, limit);
}

/**
 * What we actually sold, and what it actually cost us — one definition.
 *
 * REVENUE IS RECOGNISED ON DELIVERY, not on the order. A confirmed sales order
 * is a promise; a delivered line is a sale. So a fact here is one delivered
 * delivery-order line, priced at the unit price on its SALES ORDER (excl.
 * PPN), and costed from the stock ledger's own movements for that delivery.
 *
 * This used to live inside `/profitability` as a `useMemo`. It now lives here
 * because the dashboard's leaderboards ask the same question, and the house
 * rule is that a screen is a window onto a number, never a second copy of it:
 * two rollups written twice are two rollups that disagree by next quarter.
 *
 * COGS IS THE LEDGER'S, NOT AN ESTIMATE — where the ledger has it. A delivery
 * booked before the stock ledger existed has no movements, so its cost falls
 * back to today's moving average and the row is FLAGGED `cogsEstimated`.
 * Anything built on these facts must carry that flag to the surface: a gross
 * profit computed partly from today's cost and partly from the cost of the
 * day is not wrong enough to hide and not right enough to state silently.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

// ── Row shapes (only the columns the maths reads) ────────────────────────────
export interface MoveRow {
  component_id: string | null; direction: string; quantity: number;
  unit_cost_idr: number | null; source_type: string | null; source_id: string | null;
}
export interface DoRow { do_id: string; quote_id: string; status: string; delivered_at: string | null }
export interface DoItemRow { do_id: string; so_item_id: string | null; component_id: string | null; qty: number }
export interface SoItemRow { item_id: string; unit_price: number }
export interface OrderRow { quote_id: string; customer_id: string | null; sales_rep_id: string | null }
export interface BalanceAvg { component_id: string; avg: number }

/** One delivered line: what left, what it earned, what it cost. */
export interface SalesFact {
  component_id: string;
  do_id: string;
  quote_id: string;
  customer_id: string | null;
  /** Who owns the sale: the order's rep, else the customer's account manager. */
  rep_id: string | null;
  /** The day it was delivered — the day the sale happened. */
  date: string;
  qty: number;
  revenue: number;
  cogs: number;
  /** True when the ledger had no cost and today's average stood in for it. */
  cogsEstimated: boolean;
  /**
   * Whether cost was READABLE at all. A sell-side role may not see what we pay
   * for goods, so its fetch never asks for `unit_cost_idr` — and then `cogs` is
   * zero because it is UNKNOWN, not because the goods were free. Carried on the
   * fact so no rollup downstream can mistake one for the other.
   */
  costKnown: boolean;
}

const num = (v: unknown): number => Number(v) || 0;

/**
 * Build the delivered-sales facts.
 *
 * Kept pure so it can be tested without a database and shared by any screen
 * that needs to know what sold.
 */
export function buildSalesFacts(input: {
  dos: DoRow[];
  doItems: DoItemRow[];
  soItems: Map<string, SoItemRow>;      // so_item_id → its priced line
  orders: Map<string, OrderRow>;        // quote_id → the sales order
  moves: MoveRow[];
  avgCost: Map<string, number>;         // component_id → moving-average cost
  /** customer_id → account manager, the fallback owner of a sale. */
  accountManagerOf?: Map<string, string | null>;
  /** False for a role that may not read cost: cogs is then unknown, not zero. */
  costKnown?: boolean;
}): SalesFact[] {
  const costKnown = input.costKnown !== false;
  // Net ledger cost per delivery × component: goods out, minus anything that
  // came back in against the same delivery (a reversed or corrected shipment).
  const ledger = new Map<string, { qty: number; cost: number }>();
  for (const m of input.moves) {
    if (m.source_type !== 'delivery' || !m.source_id || !m.component_id) continue;
    const k = `${m.source_id}·${m.component_id}`;
    const e = ledger.get(k) ?? { qty: 0, cost: 0 };
    const sign = m.direction === 'out' ? 1 : -1;
    e.qty += sign * num(m.quantity);
    e.cost += sign * num(m.quantity) * num(m.unit_cost_idr);
    ledger.set(k, e);
  }

  const out: SalesFact[] = [];
  for (const d of input.dos) {
    if (d.status !== 'delivered') continue;          // a promise is not a sale
    const order = input.orders.get(d.quote_id);
    // The ledger holds cost per component, so the lines roll up the same way.
    const byComp = new Map<string, { qty: number; revenue: number }>();
    for (const li of input.doItems) {
      if (li.do_id !== d.do_id || !li.component_id) continue;
      const price = li.so_item_id ? num(input.soItems.get(li.so_item_id)?.unit_price) : 0;
      const e = byComp.get(li.component_id) ?? { qty: 0, revenue: 0 };
      e.qty += num(li.qty);
      e.revenue += num(li.qty) * price;
      byComp.set(li.component_id, e);
    }
    for (const [cid, e] of byComp) {
      const led = ledger.get(`${d.do_id}·${cid}`);
      let cogs = 0;
      let estimated = false;
      if (!costKnown) {
        // Nothing to compute from, and nothing downstream may pretend otherwise.
      } else if (led && led.qty > 0 && led.cost > 0) {
        // Ledger qty should equal the line qty; scale rather than assume it.
        cogs = led.cost * (e.qty / led.qty);
      } else {
        cogs = e.qty * (input.avgCost.get(cid) ?? 0);
        estimated = true;
      }
      out.push({
        component_id: cid, do_id: d.do_id, quote_id: d.quote_id,
        customer_id: order?.customer_id ?? null,
        rep_id: order?.sales_rep_id
          ?? (order?.customer_id ? input.accountManagerOf?.get(order.customer_id) ?? null : null),
        date: d.delivered_at ?? '', qty: e.qty, revenue: e.revenue, cogs,
        cogsEstimated: estimated, costKnown,
      });
    }
  }
  return out;
}

/** Keep the facts inside a period. `'all'` keeps everything. */
export function factsInPeriod(facts: SalesFact[], period: string, nowIso: string): SalesFact[] {
  if (period === 'all') return facts;
  const days = Number(period);
  if (!Number.isFinite(days) || days <= 0) return facts;
  const cutoff = new Date(Date.parse(nowIso) - days * 86_400_000).toISOString();
  return facts.filter((f) => f.date && f.date >= cutoff);
}

// ── Leaderboards ─────────────────────────────────────────────────────────────

export type RankBy = 'revenue' | 'profit';

export interface LeaderRow {
  key: string;
  name: string;
  /** Secondary line — units sold for an item, orders for a customer. */
  sub: string;
  revenue: number;
  profit: number;
  /** Gross margin %, or null when there is no revenue to divide by. */
  margin: number | null;
  /** This row's share of the whole board's total, 0–1, on the ranked measure. */
  share: number;
  /** Any part of this row's cost was estimated rather than taken from the ledger. */
  estimated: boolean;
}

export interface Leaderboard {
  rows: LeaderRow[];
  /** How many names had any delivered sale at all — the honest denominator. */
  ranked: number;
  /** Total across every name, not only the ones shown. */
  total: number;
  /** True when any row's profit leans on an estimated cost. */
  anyEstimated: boolean;
  /**
   * Whether a profit figure may be shown at all. False when the reader cannot
   * see cost — in which case every `profit` here equals `revenue` and means
   * nothing. The honesty doctrine in a boolean: no figure beats a wrong one.
   */
  profitKnown: boolean;
}

/**
 * Rank by revenue or by gross profit.
 *
 * `share` is deliberately part of the answer. A "top 10" of four names tells
 * you almost nothing on its own; the same four with "62% of everything
 * delivered" tells you whether the business rests on one customer.
 *
 * A negative-profit row is NOT dropped from a profit ranking — it sorts to the
 * bottom, where losing money belongs, rather than vanishing into a list that
 * only ever shows winners.
 */
export function rank(
  facts: SalesFact[],
  by: RankBy,
  keyOf: (f: SalesFact) => string | null,
  nameOf: (key: string) => { name: string; sub: (agg: { qty: number; orders: number }) => string },
  limit = 10,
): Leaderboard {
  const acc = new Map<string, { revenue: number; cogs: number; qty: number; orders: Set<string>; est: boolean }>();
  for (const f of facts) {
    const k = keyOf(f);
    if (!k) continue;
    const e = acc.get(k) ?? { revenue: 0, cogs: 0, qty: 0, orders: new Set<string>(), est: false };
    e.revenue += f.revenue;
    e.cogs += f.cogs;
    e.qty += f.qty;
    e.orders.add(f.quote_id);
    e.est = e.est || f.cogsEstimated;
    acc.set(k, e);
  }

  const all = [...acc.entries()].map(([key, e]) => {
    const meta = nameOf(key);
    const profit = e.revenue - e.cogs;
    return {
      key, name: meta.name, sub: meta.sub({ qty: e.qty, orders: e.orders.size }),
      revenue: e.revenue, profit,
      margin: e.revenue > 0 ? (profit / e.revenue) * 100 : null,
      share: 0, estimated: e.est,
    } as LeaderRow;
  });

  const measure = (r: LeaderRow) => (by === 'revenue' ? r.revenue : r.profit);
  // The denominator is every name's POSITIVE contribution: a loss-making row
  // must not inflate everyone else's share by shrinking the total.
  const total = all.reduce((s, r) => s + Math.max(0, measure(r)), 0);
  const rows = all
    .sort((a, b) => measure(b) - measure(a) || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((r) => ({ ...r, share: total > 0 ? Math.max(0, measure(r)) / total : 0 }));

  return {
    rows, ranked: all.length, total,
    anyEstimated: rows.some((r) => r.estimated),
    profitKnown: facts.every((f) => f.costKnown),
  };
}

// ── Fetcher ──────────────────────────────────────────────────────────────────

/**
 * Everything the leaderboards need, and nothing they do not.
 *
 * `unit_cost_idr` is a buy-side number, so this is only ever called for a role
 * allowed to see item economics — the widget gate, not this function, is where
 * that is decided, and `lib/dashboardWidgets.test.ts` holds it there.
 */
export async function fetchSalesFacts(
  supabase: SupabaseClient, opts: { withCost: boolean },
): Promise<SalesFact[]> {
  // The /products network-tab rule: a column a role may not see is never
  // FETCHED, not merely not rendered. Revenue needs no cost at all, so a
  // sell-side reader's request never carries one.
  const moveCols = 'component_id, direction, quantity, source_type, source_id'
    + (opts.withCost ? ', unit_cost_idr' : '');
  const [doRes, doItemRes, soItemRes, orderRes, moveRes, balRes] = await Promise.all([
    supabase.from('24.0_delivery_orders').select('do_id, quote_id, status, delivered_at'),
    supabase.from('24.1_delivery_order_items').select('do_id, so_item_id, component_id, qty'),
    supabase.from('22.1_sales_quote_items').select('item_id, unit_price'),
    supabase.from('22.0_sales_quotes').select('quote_id, customer_id, sales_rep_id'),
    supabase.from('30.0_stock_movements').select(moveCols as string),
    opts.withCost
      ? supabase.from('30.1_stock_balances').select('component_id, avg_cost_idr')
      : Promise.resolve({ data: null, error: null }),
  ]);

  const avgCost = new Map<string, number>();
  for (const b of (balRes.data ?? []) as { component_id: string; avg_cost_idr: number | null }[]) {
    const v = num(b.avg_cost_idr);
    if (v > 0 && !avgCost.has(b.component_id)) avgCost.set(b.component_id, v);
  }
  return buildSalesFacts({
    dos: (doRes.data ?? []) as unknown as DoRow[],
    doItems: (doItemRes.data ?? []) as unknown as DoItemRow[],
    soItems: new Map(((soItemRes.data ?? []) as unknown as SoItemRow[]).map((s) => [String(s.item_id), s])),
    orders: new Map(((orderRes.data ?? []) as unknown as OrderRow[]).map((o) => [String(o.quote_id), o])),
    moves: (moveRes.data ?? []) as unknown as MoveRow[],
    avgCost,
    costKnown: opts.withCost,
  });
}

/**
 * The names behind the ids, for both boards.
 *
 * Deliberately not folded into `fetchSalesFacts`: the facts are arithmetic and
 * the names are presentation, and a screen that wants only a total should not
 * pay for a customer list.
 */
export async function fetchLeaderNames(supabase: SupabaseClient): Promise<{
  products: Map<string, string>;
  customers: Map<string, string>;
}> {
  const [compRes, custRes] = await Promise.all([
    supabase.from('3.0_components').select('component_id, internal_description, supplier_model'),
    supabase.from('20.0_customers').select('customer_id, display_name, legal_name'),
  ]);
  const products = new Map<string, string>();
  for (const c of (compRes.data ?? []) as { component_id: string; internal_description: string | null; supplier_model: string | null }[]) {
    products.set(c.component_id, (c.internal_description || '').trim() || (c.supplier_model || '').trim() || 'Unnamed item');
  }
  const customers = new Map<string, string>();
  for (const c of (custRes.data ?? []) as { customer_id: string; display_name: string | null; legal_name: string | null }[]) {
    customers.set(c.customer_id, (c.display_name || '').trim() || (c.legal_name || '').trim() || 'Unnamed customer');
  }
  return { products, customers };
}

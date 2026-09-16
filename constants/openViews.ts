/**
 * The buy-side tables a SELL-SIDE screen is allowed to look through.
 *
 * `2.0_suppliers`, `4.0_price_quotes`, `4.1_price_quote_line_items`,
 * `5.0_purchases` and `5.1_purchase_line_items` are closed to everyone except
 * the buy-side roles and `viewer` (`can_read_buy_side()` — see
 * `migrations/buy_side_read_gate.sql`). Supplier identities and unit costs are
 * the company's negotiating position; they were readable by every signed-in
 * account until 2026-09-16, enforced only in React.
 *
 * But the sell side genuinely needs SOME of what those tables hold — the
 * Incoming column on Products, arrival ETAs, reorder alerts — and the audit
 * showed it only ever reads ids, quantities and dates. These four views carry
 * exactly that and nothing else, and are readable by any signed-in role.
 *
 * TWO RULES, and the second is the one that decays quietly:
 *
 *   1. A screen that may see costs reads the TABLE. A screen that may not reads
 *      the VIEW. Never reach for a view to dodge a permission you do have —
 *      `po_number` and every money column are missing from these on purpose.
 *   2. **Never add a column to one of these views.** A column added here is
 *      granted to every signed-in account at once, silently, with no code
 *      review of the consequence. If a sell-side screen needs something new
 *      from the buy side, that is a conversation, not a widening.
 *
 * `lib/openViews.test.ts` fails the build if a view name is used with a column
 * these views do not carry.
 */

/** When a PO is expected and whether it arrived. No `po_number`, no money. */
export const V_PO_SCHEDULE = 'v_po_schedule_open';
/** What is on order and how many. No `unit_cost`. */
export const V_PO_LINE_QTY = 'v_po_line_qty_open';
/** Lead time only. No supplier, no total. */
export const V_QUOTE_LEAD_TIME = 'v_quote_lead_time_open';
/** Which items a supplier quote mentions. No `unit_price`. */
export const V_QUOTE_LINE_LINK = 'v_quote_line_link_open';

/** Every column each view actually has — the guard test reads this. */
export const OPEN_VIEW_COLUMNS: Record<string, string[]> = {
  [V_PO_SCHEDULE]: ['po_id', 'quote_id', 'supplier_id', 'status', 'po_date',
    'estimated_delivery_date', 'actual_received_date'],
  [V_PO_LINE_QTY]: ['po_id', 'component_id', 'quantity'],
  [V_QUOTE_LEAD_TIME]: ['quote_id', 'estimated_lead_time_days'],
  [V_QUOTE_LINE_LINK]: ['quote_id', 'component_id'],
};

/** The tables these views stand in front of, closed by `can_read_buy_side()`. */
export const BUY_SIDE_TABLES = [
  '2.0_suppliers', '4.0_price_quotes', '4.1_price_quote_line_items',
  '5.0_purchases', '5.1_purchase_line_items',
] as const;

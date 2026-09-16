-- ICAPROC — close the buy-side READ gap
--
-- Owner, 2026-09-16, after the audit: writes to the buy side have been gated in
-- the database since 2026-09-06 (`can_write_buy_side()`), but reads never were.
-- Five tables carried `authenticated read USING (true)`:
--
--   2.0_suppliers · 4.0_price_quotes · 4.1_price_quote_line_items
--   5.0_purchases · 5.1_purchase_line_items
--
-- So ANY signed-in account — `sales`, `sell_admin`, `engineer`, `warehouse`,
-- `aftersales` — could read every supplier identity and every purchase and
-- quote UNIT COST. The buy/sell separation was enforced on writes and only in
-- React on reads. Today that is staff; the moment the Shop can mint customer
-- logins, "signed in" stops meaning "staff".
--
-- ── TWO THINGS THE AUDIT FOUND, AND BOTH SHAPE THIS FILE ──────────────────────
--
-- 1. THE READ PREDICATE IS NOT THE WRITE PREDICATE. `viewer` is documented as
--    "Read-only access to deal lookup" and has `tabs.lookup` and `tabs.progress`
--    — but `buySide: false`. Gate reads on `can_write_buy_side()` and a viewer
--    opens an empty Deal Lookup, which is the whole of that role's job. Hence a
--    separate `can_read_buy_side()` that adds `viewer` and nothing else.
--
-- 2. THE SELL SIDE NEEDS THESE TABLES, BUT NEVER THE MONEY. Products, the sales
--    document, item scores, catalogue signals and reorder alerts all read
--    `5.1`/`4.1` — and every one of them selects only ids, quantities and dates.
--    Not one reads `unit_cost`, `unit_price` or `total_value`. That traffic is
--    what powers the Incoming column, the arrival ETAs and the reorder alerts.
--    A table-level lockout would blank all three for every salesperson.
--
-- So the gate is COLUMN-shaped, not table-shaped: the base tables close, and
-- four views expose exactly the columns the sell side was already reading.
--
-- ── WHY THESE VIEWS ARE DELIBERATELY *NOT* `security_invoker` ────────────────
--
-- Everywhere else in ICAPROC a view is `security_invoker = true` so it answers
-- as the caller. These four are the deliberate exception and must stay that way:
-- an invoker view would re-apply the base table's RLS and hand a salesperson an
-- empty Incoming column, which is the breakage this file exists to avoid.
--
-- THE VIEW'S COLUMN LIST IS THE SECURITY BOUNDARY. Nothing here is row-sensitive
-- — every PO is the company's own — so restricting columns is the entire job.
-- **Never add a cost, price, total or `po_number` to one of these views.** A
-- column added here is granted to every signed-in account at once, silently.
-- (`po_number` is excluded on purpose: the app has treated it as a buy-side
-- document reference since the brand/cost network-tab rule.)
--
-- Supabase's linter flags a non-invoker view as "security definer view". That
-- warning is expected here and is the point, not an oversight.

-- ── 1. Who may read the buy side ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_read_buy_side()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
AS $function$
  -- can_write_buy_side() plus `viewer`, whose entire purpose is reading deals.
  SELECT EXISTS (SELECT 1 FROM user_profiles
    WHERE id = auth.uid()
      AND role IN ('owner','buy_admin','data_entry','finance','viewer'));
$function$;

COMMENT ON FUNCTION public.can_read_buy_side() IS
  'Read gate for the buy side. Deliberately WIDER than can_write_buy_side(): adds `viewer`, which is read-only Deal Lookup access and would otherwise open an empty page.';

-- ── 2. The sell-side windows ─────────────────────────────────────────────────
-- Named `_open` because that is what they are: the open subset of a closed
-- table. Each carries only what the audit proved is already being read.

CREATE OR REPLACE VIEW public.v_po_schedule_open
WITH (security_invoker = false) AS
  SELECT po_id, quote_id, supplier_id, status, po_date,
         estimated_delivery_date, actual_received_date
  FROM public."5.0_purchases";

CREATE OR REPLACE VIEW public.v_po_line_qty_open
WITH (security_invoker = false) AS
  SELECT po_id, component_id, quantity
  FROM public."5.1_purchase_line_items";

CREATE OR REPLACE VIEW public.v_quote_lead_time_open
WITH (security_invoker = false) AS
  SELECT quote_id, estimated_lead_time_days
  FROM public."4.0_price_quotes";

CREATE OR REPLACE VIEW public.v_quote_line_link_open
WITH (security_invoker = false) AS
  SELECT quote_id, component_id
  FROM public."4.1_price_quote_line_items";

COMMENT ON VIEW public.v_po_schedule_open   IS 'WHEN a PO is expected/arrived. No po_number, no money. Readable by every signed-in role — never add a cost column.';
COMMENT ON VIEW public.v_po_line_qty_open   IS 'WHAT is on order and how many. No unit_cost. Readable by every signed-in role — never add a cost column.';
COMMENT ON VIEW public.v_quote_lead_time_open IS 'Lead time only. No supplier, no total. Readable by every signed-in role.';
COMMENT ON VIEW public.v_quote_line_link_open IS 'Which items a supplier quote mentions. No unit_price. Readable by every signed-in role.';

REVOKE ALL ON public.v_po_schedule_open, public.v_po_line_qty_open,
               public.v_quote_lead_time_open, public.v_quote_line_link_open FROM PUBLIC, anon;
GRANT SELECT ON public.v_po_schedule_open, public.v_po_line_qty_open,
                public.v_quote_lead_time_open, public.v_quote_line_link_open TO authenticated;

-- ── 3. Close the base tables ─────────────────────────────────────────────────
-- STAGE 2, and the ordering matters: the views above and the application code
-- that reads them must both be live BEFORE this runs. Until then a sell-side
-- session still reads the base tables and nothing breaks; run this and any
-- still-deployed old code loses its Incoming column until the deploy lands.

DROP POLICY IF EXISTS "authenticated read" ON public."2.0_suppliers";
CREATE POLICY "buy side read" ON public."2.0_suppliers"
  FOR SELECT TO authenticated USING (public.can_read_buy_side());

DROP POLICY IF EXISTS "authenticated read" ON public."4.0_price_quotes";
CREATE POLICY "buy side read" ON public."4.0_price_quotes"
  FOR SELECT TO authenticated USING (public.can_read_buy_side());

DROP POLICY IF EXISTS "authenticated read" ON public."4.1_price_quote_line_items";
CREATE POLICY "buy side read" ON public."4.1_price_quote_line_items"
  FOR SELECT TO authenticated USING (public.can_read_buy_side());

DROP POLICY IF EXISTS "authenticated read" ON public."5.0_purchases";
CREATE POLICY "buy side read" ON public."5.0_purchases"
  FOR SELECT TO authenticated USING (public.can_read_buy_side());

DROP POLICY IF EXISTS "authenticated read" ON public."5.1_purchase_line_items";
CREATE POLICY "buy side read" ON public."5.1_purchase_line_items"
  FOR SELECT TO authenticated USING (public.can_read_buy_side());

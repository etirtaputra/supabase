-- The attention layer: "what should I pay attention to today", as data.
--
-- Owner's ask, 2026-09-06: agents that read the Dashboard, Insights, pending
-- POs and Deal Lookup and report what needs attention. This is that, built
-- READ-ONLY so an agent can be useful before it can write anything.
--
-- Every row is one thing worth looking at, with a severity, a subject, a
-- number and a reference so an agent can link to it. `agent_attention_summary`
-- is the cheap digest — counts and totals per signal — for a daily message.
--
-- TWO RULES THIS FOLLOWS, both learned the hard way this week:
--
-- 1. NO ENGINE IS DUPLICATED IN SQL. The tier-price chain (`lib/tierPricing.ts`)
--    and `specReadiness` (`lib/specSchema.ts`) are TypeScript with tests. A SQL
--    re-implementation would drift from them silently, which is exactly the
--    failure the design pack warns about. So the money signal here is the one
--    that needs no engine — selling BELOW moving-average landed cost, which is
--    a loss on any tier — and the spec signal is "no specs at all" rather than
--    a re-derived readiness check. The full floor audit already lives on
--    /pricing, where the real engine runs.
--
-- 2. THE VIEWS ARE security_invoker. RLS applies as the CALLER, not as the view
--    owner, so an agent cannot read through a view what its login forbids. On
--    top of that, each sensitive signal is filtered by role in its own WHERE
--    clause: cost and AR figures simply do not appear for a role that may not
--    see them, rather than appearing and being filtered later.

-- Roles allowed to see money: AR balances, costs, margins.
-- Mirrors the app's canViewSellingPrice/canViewBankFees intent for the
-- signals that carry an amount.
CREATE OR REPLACE FUNCTION public.can_see_money() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid()
      AND role IN ('owner','finance','buy_admin','sell_admin','data_entry')
  );
$$;

DROP VIEW IF EXISTS public.agent_attention_summary;
DROP VIEW IF EXISTS public.agent_attention;

CREATE VIEW public.agent_attention WITH (security_invoker = true) AS

-- ── 1. Invoices past due and still owed ─────────────────────────────────────
WITH invoice_paid AS (
  SELECT i.invoice_id,
         i.grand_total - COALESCE((
           SELECT SUM(r.amount) FROM "26.0_customer_receipts" r
            WHERE r.invoice_id = i.invoice_id), 0) AS outstanding
    FROM "25.0_sales_invoices" i
)
SELECT
  'ar_overdue'::text                                     AS kind,
  CASE WHEN (CURRENT_DATE - i.due_date) > 30 THEN 'high'
       ELSE 'medium' END                                 AS severity,
  COALESCE(c.display_name, c.legal_name, 'Unknown customer') AS subject,
  format('Invoice %s is %s days past due', i.invoice_number,
         CURRENT_DATE - i.due_date)                      AS detail,
  p.outstanding                                          AS amount_idr,
  (CURRENT_DATE - i.due_date)::int                       AS age_days,
  '25.0_sales_invoices'::text                            AS ref_table,
  i.invoice_id::text                                     AS ref_id
FROM "25.0_sales_invoices" i
JOIN invoice_paid p ON p.invoice_id = i.invoice_id
LEFT JOIN "22.0_sales_quotes" q ON q.quote_id = i.quote_id
LEFT JOIN "20.0_customers" c ON c.customer_id = q.customer_id
WHERE can_see_money()
  AND i.due_date IS NOT NULL
  AND i.due_date < CURRENT_DATE
  AND p.outstanding > 0

UNION ALL

-- ── 2. Purchase orders past their ETA and not received ──────────────────────
-- A PO's supplier is usually NULL on the PO itself and lives on the price
-- quote it came from — 11 of the 12 late POs, checked 2026-09-06. Joining only
-- `5.0_purchases.supplier_id` reported every one of them as "Unknown supplier",
-- which is the kind of confidently useless line that makes an agent's report
-- worth nothing.
SELECT
  'po_late',
  CASE WHEN (CURRENT_DATE - po.estimated_delivery_date) > 14 THEN 'high' ELSE 'medium' END,
  COALESCE(s.supplier_name, 'Supplier not recorded'),
  format('PO %s was due %s and has no received date',
         po.po_number, po.estimated_delivery_date),
  NULL::numeric,
  (CURRENT_DATE - po.estimated_delivery_date)::int,
  '5.0_purchases',
  po.po_id::text
FROM "5.0_purchases" po
LEFT JOIN "4.0_price_quotes" pq ON pq.quote_id = po.quote_id
LEFT JOIN "2.0_suppliers" s ON s.supplier_id = COALESCE(po.supplier_id, pq.supplier_id)
WHERE can_write_buy_side()
  AND po.estimated_delivery_date IS NOT NULL
  AND po.estimated_delivery_date < CURRENT_DATE
  AND po.actual_received_date IS NULL
  AND COALESCE(po.status::text, '') NOT IN ('Cancelled','cancelled')

UNION ALL

-- ── 3. Quotations sent and gone quiet ───────────────────────────────────────
-- 14 days is the threshold. It is a judgement, not a rule from anywhere; move
-- it when the sales team says what "quiet" actually means to them.
SELECT
  'quote_quiet',
  CASE WHEN (CURRENT_DATE - q.sent_at::date) > 30 THEN 'high' ELSE 'medium' END,
  COALESCE(c.display_name, c.legal_name, 'Unknown customer'),
  format('%s sent %s days ago, still not accepted',
         q.quote_number, CURRENT_DATE - q.sent_at::date),
  CASE WHEN can_see_money() THEN q.grand_total END,
  (CURRENT_DATE - q.sent_at::date)::int,
  '22.0_sales_quotes',
  q.quote_id::text
FROM "22.0_sales_quotes" q
LEFT JOIN "20.0_customers" c ON c.customer_id = q.customer_id
WHERE q.status = 'sent'
  AND q.sent_at IS NOT NULL
  AND q.sent_at::date < CURRENT_DATE - 14

UNION ALL

-- ── 4. Items selling below what they cost us ────────────────────────────────
-- Moving-average landed cost, quantity-weighted across warehouses — never "the
-- last row" (lib/warehouses.ts). Below cost is a loss on ANY tier, so this
-- needs no tier maths and cannot drift from the pricing engine.
SELECT
  'below_cost',
  'high',
  COALESCE(NULLIF(BTRIM(c.internal_description), ''), c.supplier_model),
  format('Sells at %s but landed cost is %s',
         ROUND(c.selling_price_idr), ROUND(b.wavg_cost)),
  ROUND((b.wavg_cost - c.selling_price_idr) * b.qty),
  NULL::int,
  '3.0_components',
  c.component_id::text
FROM "3.0_components" c
JOIN (
  SELECT component_id,
         SUM(qty_on_hand) AS qty,
         SUM(qty_on_hand * avg_cost_idr) / NULLIF(SUM(qty_on_hand), 0) AS wavg_cost
    FROM "30.1_stock_balances"
   WHERE qty_on_hand > 0
   GROUP BY component_id
) b ON b.component_id = c.component_id
WHERE can_see_money()
  AND c.archived_at IS NULL
  AND c.selling_price_idr > 0
  AND b.wavg_cost > c.selling_price_idr

UNION ALL

-- ── 5. Committed orders that stock cannot cover ─────────────────────────────
SELECT
  'stock_short',
  'high',
  COALESCE(NULLIF(BTRIM(c.internal_description), ''), c.supplier_model),
  format('%s committed on live orders, %s on hand',
         d.committed, COALESCE(b.qty, 0)),
  NULL::numeric,
  NULL::int,
  '3.0_components',
  c.component_id::text
FROM (
  SELECT i.component_id, SUM(i.quantity) AS committed
    FROM "22.1_sales_quote_items" i
    JOIN "22.0_sales_quotes" q ON q.quote_id = i.quote_id
   WHERE i.component_id IS NOT NULL
     AND COALESCE(i.is_section, false) = false
     AND q.status IN ('accepted','ordered','invoiced','preparing')
   GROUP BY i.component_id
) d
JOIN "3.0_components" c ON c.component_id = d.component_id
LEFT JOIN (
  SELECT component_id, SUM(qty_on_hand) AS qty
    FROM "30.1_stock_balances" GROUP BY component_id
) b ON b.component_id = d.component_id
WHERE d.committed > COALESCE(b.qty, 0)

UNION ALL

-- ── 6. Items that move but carry no price ───────────────────────────────────
-- Deliberately NOT every unpriced item (there are ~258, which is a backlog,
-- not an alert). Only ones that hold stock or have been quoted — those are
-- costing a decision now.
SELECT
  'unpriced',
  'medium',
  COALESCE(NULLIF(BTRIM(c.internal_description), ''), c.supplier_model),
  'Has stock or has been quoted, but carries no selling price',
  NULL::numeric,
  NULL::int,
  '3.0_components',
  c.component_id::text
FROM "3.0_components" c
WHERE c.archived_at IS NULL
  AND COALESCE(c.selling_price_idr, 0) <= 0
  AND (
    EXISTS (SELECT 1 FROM "30.1_stock_balances" b
             WHERE b.component_id = c.component_id AND b.qty_on_hand > 0)
    OR EXISTS (SELECT 1 FROM "22.1_sales_quote_items" i
                WHERE i.component_id = c.component_id)
  )

UNION ALL

-- ── 7. Items a designer cannot size ─────────────────────────────────────────
-- "No specs at all" rather than a re-derived readiness check (see the header).
-- Restricted to the categories the design engines actually consume.
SELECT
  'no_specs',
  'low',
  COALESCE(NULLIF(BTRIM(c.internal_description), ''), c.supplier_model),
  format('%s carries no specifications, so no design can size it', c.category),
  NULL::numeric,
  NULL::int,
  '3.0_components',
  c.component_id::text
FROM "3.0_components" c
WHERE c.archived_at IS NULL
  AND (c.specifications IS NULL OR c.specifications = '{}'::jsonb)
  AND c.category::text IN ('pv_module','on_grid_inverter','inverter_charger',
                           'batteries','solar_charge_controller','mounting')
  AND EXISTS (SELECT 1 FROM "30.1_stock_balances" b
               WHERE b.component_id = c.component_id AND b.qty_on_hand > 0);


-- The digest an agent can read in one query for a daily message.
CREATE VIEW public.agent_attention_summary WITH (security_invoker = true) AS
SELECT kind,
       COUNT(*)                                          AS items,
       COUNT(*) FILTER (WHERE severity = 'high')          AS high,
       SUM(COALESCE(amount_idr, 0))                       AS total_idr,
       MAX(age_days)                                      AS oldest_days
  FROM public.agent_attention
 GROUP BY kind;

GRANT SELECT ON public.agent_attention          TO authenticated;
GRANT SELECT ON public.agent_attention_summary  TO authenticated;

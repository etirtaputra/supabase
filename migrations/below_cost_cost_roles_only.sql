-- below_cost: only roles that may see cost (owner, 2026-11-02).
--
-- "Ade shouldn't see costs, she will only make quotes and select the unit
-- price using which tier." The below_cost signal's detail reads "Sells at X
-- but landed cost is Y", and it was gated on can_see_money() — which includes
-- sell_admin (money = AR, not cost). It now uses can_read_buy_side(): owner,
-- buy_admin, finance, data_entry (and viewer, who already reads Deal Lookup).
--
-- Built from the LIVE pg_get_viewdef of 2026-11-02 with that one predicate
-- changed; every other branch is byte-for-byte what production ran. The view
-- stays security_invoker, so the base tables' RLS still applies underneath.

CREATE OR REPLACE VIEW public.agent_attention WITH (security_invoker = true) AS
WITH invoice_paid AS (
         SELECT i.invoice_id,
            i.grand_total - COALESCE(( SELECT sum(r.amount) AS sum
                   FROM "26.0_customer_receipts" r
                  WHERE r.invoice_id = i.invoice_id), 0::numeric) AS outstanding
           FROM "25.0_sales_invoices" i
        )
 SELECT 'ar_overdue'::text AS kind,
        CASE
            WHEN (CURRENT_DATE - i.due_date) > 30 THEN 'high'::text
            ELSE 'medium'::text
        END AS severity,
    COALESCE(c.display_name, c.legal_name, 'Unknown customer'::text) AS subject,
    format('Invoice %s is %s days past due'::text, i.invoice_number, CURRENT_DATE - i.due_date) AS detail,
    p.outstanding AS amount_idr,
    CURRENT_DATE - i.due_date AS age_days,
    '25.0_sales_invoices'::text AS ref_table,
    i.invoice_id::text AS ref_id
   FROM "25.0_sales_invoices" i
     JOIN invoice_paid p ON p.invoice_id = i.invoice_id
     LEFT JOIN "22.0_sales_quotes" q ON q.quote_id = i.quote_id
     LEFT JOIN "20.0_customers" c ON c.customer_id = q.customer_id
  WHERE can_see_money() AND i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE AND p.outstanding > 0::numeric
UNION ALL
 SELECT 'po_late'::text AS kind,
        CASE
            WHEN (CURRENT_DATE - po.estimated_delivery_date) > 14 THEN 'high'::text
            ELSE 'medium'::text
        END AS severity,
    COALESCE(s.supplier_name, 'Supplier not recorded'::text) AS subject,
    format('PO %s was due %s and has no received date'::text, po.po_number, po.estimated_delivery_date) AS detail,
    NULL::numeric AS amount_idr,
    CURRENT_DATE - po.estimated_delivery_date AS age_days,
    '5.0_purchases'::text AS ref_table,
    po.po_id::text AS ref_id
   FROM "5.0_purchases" po
     LEFT JOIN "4.0_price_quotes" pq ON pq.quote_id = po.quote_id
     LEFT JOIN "2.0_suppliers" s ON s.supplier_id = COALESCE(po.supplier_id, pq.supplier_id)
  WHERE can_write_buy_side() AND po.estimated_delivery_date IS NOT NULL AND po.estimated_delivery_date < CURRENT_DATE AND po.actual_received_date IS NULL AND (COALESCE(po.status::text, ''::text) <> ALL (ARRAY['Cancelled'::text, 'cancelled'::text]))
UNION ALL
 SELECT 'quote_quiet'::text AS kind,
        CASE
            WHEN (CURRENT_DATE - q.sent_at::date) > 30 THEN 'high'::text
            ELSE 'medium'::text
        END AS severity,
    COALESCE(c.display_name, c.legal_name, 'Unknown customer'::text) AS subject,
    format('%s sent %s days ago, still not accepted'::text, q.quote_number, CURRENT_DATE - q.sent_at::date) AS detail,
        CASE
            WHEN can_see_money() THEN q.grand_total
            ELSE NULL::numeric
        END AS amount_idr,
    CURRENT_DATE - q.sent_at::date AS age_days,
    '22.0_sales_quotes'::text AS ref_table,
    q.quote_id::text AS ref_id
   FROM "22.0_sales_quotes" q
     LEFT JOIN "20.0_customers" c ON c.customer_id = q.customer_id
  WHERE q.status = 'sent'::text AND q.sent_at IS NOT NULL AND q.sent_at::date < (CURRENT_DATE - 14)
UNION ALL
 SELECT 'below_cost'::text AS kind,
    'high'::text AS severity,
    COALESCE(NULLIF(btrim(c.internal_description), ''::text), c.supplier_model) AS subject,
    format('Sells at %s but landed cost is %s'::text, round(c.selling_price_idr), round(b.wavg_cost)) AS detail,
    round((b.wavg_cost - c.selling_price_idr) * b.qty) AS amount_idr,
    NULL::integer AS age_days,
    '3.0_components'::text AS ref_table,
    c.component_id::text AS ref_id
   FROM "3.0_components" c
     JOIN ( SELECT "30.1_stock_balances".component_id,
            sum("30.1_stock_balances".qty_on_hand) AS qty,
            sum("30.1_stock_balances".qty_on_hand * "30.1_stock_balances".avg_cost_idr) / NULLIF(sum("30.1_stock_balances".qty_on_hand), 0::numeric) AS wavg_cost
           FROM "30.1_stock_balances"
          WHERE "30.1_stock_balances".qty_on_hand > 0::numeric
          GROUP BY "30.1_stock_balances".component_id) b ON b.component_id = c.component_id
  WHERE can_read_buy_side() AND c.archived_at IS NULL AND c.selling_price_idr > 0::numeric AND b.wavg_cost > c.selling_price_idr
UNION ALL
 SELECT 'stock_short'::text AS kind,
    'high'::text AS severity,
    COALESCE(NULLIF(btrim(c.internal_description), ''::text), c.supplier_model) AS subject,
    format('%s committed on live orders, %s on hand'::text, d.committed, COALESCE(b.qty, 0::numeric)) AS detail,
    NULL::numeric AS amount_idr,
    NULL::integer AS age_days,
    '3.0_components'::text AS ref_table,
    c.component_id::text AS ref_id
   FROM ( SELECT i.component_id,
            sum(i.quantity) AS committed
           FROM "22.1_sales_quote_items" i
             JOIN "22.0_sales_quotes" q ON q.quote_id = i.quote_id
          WHERE i.component_id IS NOT NULL AND COALESCE(i.is_section, false) = false AND (q.status = ANY (ARRAY['accepted'::text, 'ordered'::text, 'invoiced'::text, 'preparing'::text]))
          GROUP BY i.component_id) d
     JOIN "3.0_components" c ON c.component_id = d.component_id
     LEFT JOIN ( SELECT "30.1_stock_balances".component_id,
            sum("30.1_stock_balances".qty_on_hand) AS qty
           FROM "30.1_stock_balances"
          GROUP BY "30.1_stock_balances".component_id) b ON b.component_id = d.component_id
  WHERE d.committed > COALESCE(b.qty, 0::numeric)
UNION ALL
 SELECT 'unpriced'::text AS kind,
    'medium'::text AS severity,
    COALESCE(NULLIF(btrim(c.internal_description), ''::text), c.supplier_model) AS subject,
    'Has stock or has been quoted, but carries no selling price'::text AS detail,
    NULL::numeric AS amount_idr,
    NULL::integer AS age_days,
    '3.0_components'::text AS ref_table,
    c.component_id::text AS ref_id
   FROM "3.0_components" c
  WHERE c.archived_at IS NULL AND COALESCE(c.selling_price_idr, 0::numeric) <= 0::numeric AND ((EXISTS ( SELECT 1
           FROM "30.1_stock_balances" b
          WHERE b.component_id = c.component_id AND b.qty_on_hand > 0::numeric)) OR (EXISTS ( SELECT 1
           FROM "22.1_sales_quote_items" i
          WHERE i.component_id = c.component_id)))
UNION ALL
 SELECT 'no_specs'::text AS kind,
    'low'::text AS severity,
    COALESCE(NULLIF(btrim(c.internal_description), ''::text), c.supplier_model) AS subject,
    format('%s carries no specifications, so no design can size it'::text, c.category) AS detail,
    NULL::numeric AS amount_idr,
    NULL::integer AS age_days,
    '3.0_components'::text AS ref_table,
    c.component_id::text AS ref_id
   FROM "3.0_components" c
  WHERE c.archived_at IS NULL AND (c.specifications IS NULL OR c.specifications = '{}'::jsonb) AND (c.category::text = ANY (ARRAY['pv_module'::text, 'on_grid_inverter'::text, 'inverter_charger'::text, 'batteries'::text, 'solar_charge_controller'::text, 'mounting'::text])) AND (EXISTS ( SELECT 1
           FROM "30.1_stock_balances" b
          WHERE b.component_id = c.component_id AND b.qty_on_hand > 0::numeric))
UNION ALL
 SELECT 'landed_cost_open'::text AS kind,
        CASE
            WHEN COALESCE(po.actual_received_date, po.po_date) < (CURRENT_DATE - 30) THEN 'high'::text
            ELSE 'medium'::text
        END AS severity,
    COALESCE(s.supplier_name, 'Supplier not recorded'::text) AS subject,
    format('%s received %s with no PIB / OPS recorded — landed cost is understated'::text, po.po_number, COALESCE(po.actual_received_date::text, 'date not set'::text)) AS detail,
    NULL::numeric AS amount_idr,
    CURRENT_DATE - COALESCE(po.actual_received_date, po.po_date) AS age_days,
    '5.0_purchases'::text AS ref_table,
    po.po_id::text AS ref_id
   FROM "5.0_purchases" po
     LEFT JOIN "4.0_price_quotes" pq ON pq.quote_id = po.quote_id
     LEFT JOIN "2.0_suppliers" s ON s.supplier_id = COALESCE(po.supplier_id, pq.supplier_id)
  WHERE can_write_buy_side() AND (po.status::text = 'Fully Received'::text OR po.actual_received_date IS NOT NULL) AND COALESCE(po.currency, 'IDR'::currency) <> 'IDR'::currency AND (COALESCE(po.status::text, ''::text) <> ALL (ARRAY['Cancelled'::text, 'cancelled'::text])) AND NOT (EXISTS ( SELECT 1
           FROM "6.0_po_costs" c
          WHERE c.po_id = po.po_id AND (c.cost_category = ANY (ARRAY['local_import_duty'::text, 'local_vat'::text, 'local_income_tax'::text, 'local_import_tax'::text]))));

GRANT SELECT ON public.agent_attention TO authenticated;
GRANT SELECT ON public.agent_attention TO service_role;

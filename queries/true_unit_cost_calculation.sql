-- ============================================================================
-- TRUE UNIT COST CALCULATION - UPDATED FOR NEW SCHEMA
-- ============================================================================
-- Purpose: Calculate the true landed cost per unit for purchased components
-- Methodology: Allocates actual payments, bank fees, and landed costs
--              proportionally across line items, excluding freight to prevent
--              double-counting in FOB/EXW terms
--
-- Schema Updates:
-- - Uses unified 6.0_po_costs table (replaces 7.0_payment_details + 7.1_landed_costs)
-- - Updated component fields: supplier_model (was model_sku), internal_description (was description)
-- - Uses po_cost_category enum for cost classification
--
-- Recommended indexes for performance:
-- CREATE INDEX IF NOT EXISTS idx_po_costs_po_id ON "6.0_po_costs"(po_id);
-- CREATE INDEX IF NOT EXISTS idx_po_costs_category ON "6.0_po_costs"(cost_category);
-- CREATE INDEX IF NOT EXISTS idx_po_line_items_po_id ON "5.1_purchase_line_items"(po_id);
-- CREATE INDEX IF NOT EXISTS idx_po_line_items_component ON "5.1_purchase_line_items"(component_id);
-- CREATE INDEX IF NOT EXISTS idx_purchases_replaces ON "5.0_purchases"(replaces_po_id) WHERE replaces_po_id IS NOT NULL;
-- ============================================================================

WITH cost_breakdown AS (
  -- Aggregate costs by type for each PO from unified po_costs table
  SELECT
    po_id,
    -- Principal payments (actual component costs)
    SUM(CASE
      WHEN cost_category IN ('down_payment', 'balance_payment', 'additional_balance_payment', 'overpayment_credit')
      THEN amount
      ELSE 0
    END) AS principal_payments_idr,

    -- Bank fees and transfer costs
    SUM(CASE
      WHEN cost_category IN ('full_amount_bank_fee', 'telex_bank_fee', 'value_today_bank_fee',
                            'admin_bank_fee', 'inter_bank_transfer_fee')
      THEN amount
      ELSE 0
    END) AS bank_fee_costs_idr,

    -- Landed costs (excluding taxes for accurate cost allocation)
    SUM(CASE
      WHEN cost_category IN ('local_import_duty', 'local_delivery', 'demurrage_fee',
                            'penalty_fee', 'dhl_advance_payment_fee', 'local_import_tax')
      THEN amount
      ELSE 0
    END) AS landed_costs_excl_tax_idr,

    -- Tax components (tracked separately for reporting)
    SUM(CASE
      WHEN cost_category IN ('local_vat', 'local_income_tax')
      THEN amount
      ELSE 0
    END) AS tax_costs_idr,

    COUNT(*) AS cost_record_count
  FROM "6.0_po_costs"
  GROUP BY po_id
),
po_totals AS (
  -- Calculate total PO value in foreign currency
  SELECT
    po_id,
    SUM(unit_cost * quantity) AS total_po_value_foreign,
    COUNT(*) AS line_item_count,
    SUM(quantity) AS total_quantity
  FROM "5.1_purchase_line_items"
  WHERE quantity > 0  -- Exclude invalid quantities
  GROUP BY po_id
),
line_calculations AS (
  -- Pre-calculate line-level values to avoid repetition
  SELECT
    pli.po_line_item_id,
    pli.po_id,
    pli.component_id,
    pli.quantity,
    pli.unit_cost,
    (pli.unit_cost * pli.quantity) AS line_value_foreign,
    pt.total_po_value_foreign,

    -- Line's proportional share of the total PO
    CASE
      WHEN pt.total_po_value_foreign > 0 THEN
        (pli.unit_cost * pli.quantity) / pt.total_po_value_foreign
      ELSE 0
    END AS line_share_of_po

  FROM "5.1_purchase_line_items" pli
  INNER JOIN po_totals pt ON pli.po_id = pt.po_id
  WHERE pli.quantity > 0  -- Only valid line items
)

-- ============================================================================
-- MAIN QUERY
-- ============================================================================
SELECT
  -- ===== PO HEADER INFORMATION =====
  p.po_number,
  p.po_date,
  p.incoterms,
  p.method_of_shipment,
  p.currency,
  p.exchange_rate,

  -- ===== COMPONENT INFORMATION (UPDATED FIELD NAMES) =====
  c.supplier_model,                    -- Updated from model_sku
  c.internal_description AS component_name,  -- Updated from description

  -- ===== LINE ITEM DETAILS =====
  lc.quantity,
  lc.unit_cost AS unit_cost_foreign,
  lc.line_value_foreign,
  ROUND(lc.line_share_of_po * 100, 2) AS line_share_pct,

  -- ===== COST BREAKDOWN (IDR) =====
  COALESCE(cb.principal_payments_idr, 0) AS principal_payments_idr,
  COALESCE(cb.bank_fee_costs_idr, 0) AS bank_fee_costs_idr,
  COALESCE(cb.landed_costs_excl_tax_idr, 0) AS landed_costs_excl_tax_idr,
  COALESCE(cb.tax_costs_idr, 0) AS tax_costs_idr,

  -- Total extra costs allocated to this line
  ROUND(
    lc.line_share_of_po * (
      COALESCE(cb.bank_fee_costs_idr, 0) +
      COALESCE(cb.landed_costs_excl_tax_idr, 0)
    ), 2
  ) AS allocated_extra_costs_idr,

  -- ===== REFERENCE INFORMATION (NOT USED IN CALCULATION) =====
  COALESCE(p.freight_charges_intl, 0) * COALESCE(p.exchange_rate, 1) AS freight_cost_idr_reference,

  -- ===== TRUE UNIT COST CALCULATION =====
  -- Base cost from actual payments (already includes freight implicitly)
  ROUND(
    CASE
      WHEN lc.quantity > 0 AND lc.line_share_of_po > 0 THEN
        (lc.line_share_of_po * COALESCE(cb.principal_payments_idr, 0)) / lc.quantity
      ELSE 0
    END, 2
  ) AS base_unit_cost_idr,

  -- Additional costs per unit (bank fees + landed costs)
  ROUND(
    CASE
      WHEN lc.quantity > 0 AND lc.line_share_of_po > 0 THEN
        (lc.line_share_of_po * (
          COALESCE(cb.bank_fee_costs_idr, 0) +
          COALESCE(cb.landed_costs_excl_tax_idr, 0)
        )) / lc.quantity
      ELSE 0
    END, 2
  ) AS additional_unit_cost_idr,

  -- FINAL TRUE UNIT COST (excluding taxes)
  ROUND(
    CASE
      WHEN lc.quantity > 0 AND lc.line_share_of_po > 0 THEN
        (lc.line_share_of_po * (
          COALESCE(cb.principal_payments_idr, 0) +
          COALESCE(cb.bank_fee_costs_idr, 0) +
          COALESCE(cb.landed_costs_excl_tax_idr, 0)
        )) / lc.quantity
      ELSE 0
    END, 2
  ) AS true_unit_cost_idr,

  -- Tax cost per unit (for reference)
  ROUND(
    CASE
      WHEN lc.quantity > 0 AND lc.line_share_of_po > 0 THEN
        (lc.line_share_of_po * COALESCE(cb.tax_costs_idr, 0)) / lc.quantity
      ELSE 0
    END, 2
  ) AS tax_unit_cost_idr,

  -- Total line cost (for validation)
  ROUND(
    lc.line_share_of_po * (
      COALESCE(cb.principal_payments_idr, 0) +
      COALESCE(cb.bank_fee_costs_idr, 0) +
      COALESCE(cb.landed_costs_excl_tax_idr, 0)
    ), 2
  ) AS total_line_cost_idr,

  -- ===== PO-LEVEL TOTALS (FOR VALIDATION) =====
  ROUND(lc.total_po_value_foreign * COALESCE(p.exchange_rate, 1), 2) AS po_value_at_exchange_rate_idr,
  COALESCE(cb.principal_payments_idr, 0) +
    COALESCE(cb.bank_fee_costs_idr, 0) +
    COALESCE(cb.landed_costs_excl_tax_idr, 0) AS total_po_cost_idr,

  -- Variance between PO value and actual payments (helps identify discrepancies)
  CASE
    WHEN lc.total_po_value_foreign > 0 AND p.exchange_rate > 0 THEN
      ROUND(
        ((COALESCE(cb.principal_payments_idr, 0) /
          (lc.total_po_value_foreign * p.exchange_rate)) - 1) * 100,
        2
      )
    ELSE NULL
  END AS payment_variance_pct,

  -- ===== DATA QUALITY WARNINGS =====
  CASE
    WHEN cb.principal_payments_idr IS NULL OR cb.principal_payments_idr = 0
      THEN '⚠️ No payments recorded'
    WHEN p.exchange_rate IS NULL AND p.currency != 'IDR'
      THEN '⚠️ Missing exchange rate'
    WHEN lc.total_po_value_foreign IS NULL OR lc.total_po_value_foreign = 0
      THEN '⚠️ Invalid PO total'
    WHEN ABS(
      (COALESCE(cb.principal_payments_idr, 0) /
       NULLIF(lc.total_po_value_foreign * COALESCE(p.exchange_rate, 1), 0)) - 1
    ) > 0.1  -- More than 10% variance
      THEN '⚠️ Payment variance > 10%'
  END AS data_quality_warning,

  CASE
    WHEN p.freight_charges_intl > 0 AND p.incoterms ILIKE ANY (ARRAY['%FOB%', '%EXW%'])
      THEN '⚠️ Freight entered for FOB/EXW - may double-count'
  END AS freight_warning,

  -- ===== METADATA FOR DEBUGGING =====
  cb.cost_record_count,
  pt.line_item_count AS po_line_item_count,
  pt.total_quantity AS po_total_quantity

FROM "5.0_purchases" p
INNER JOIN line_calculations lc ON p.po_id = lc.po_id
INNER JOIN "3.0_components" c ON c.component_id = lc.component_id
LEFT JOIN cost_breakdown cb ON p.po_id = cb.po_id
LEFT JOIN po_totals pt ON p.po_id = pt.po_id
LEFT JOIN "5.0_purchases" replacement ON replacement.replaces_po_id = p.po_id

WHERE
  -- Exclude replaced POs (using LEFT JOIN for better performance)
  replacement.po_id IS NULL

  -- Only include POs with valid exchange rates (or IDR currency)
  AND (p.currency = 'IDR' OR p.exchange_rate IS NOT NULL)

  -- Only include POs with valid totals
  AND lc.total_po_value_foreign > 0

ORDER BY
  p.po_date DESC,
  p.po_number,
  lc.po_line_item_id;

-- ============================================================================
-- QUERY EXPLANATION
-- ============================================================================
-- This query calculates the true landed cost per unit by:
--
-- 1. Aggregating all costs from the unified 6.0_po_costs table:
--    - Principal payments (what you paid for components)
--    - Bank fees (transfer costs, admin fees, etc.)
--    - Landed costs (duties, delivery, demurrage, etc.)
--    - Taxes (tracked separately for reporting)
--
-- 2. Allocating costs proportionally to each line item based on its
--    percentage of the total PO value
--
-- 3. Dividing by quantity to get the true unit cost
--
-- The query excludes:
-- - Replaced/superseded POs
-- - Invalid line items (zero quantity)
-- - POs with missing exchange rates (unless IDR)
--
-- Data quality warnings help identify:
-- - Missing payments
-- - Payment/PO value discrepancies
-- - Potential freight double-counting
-- ============================================================================

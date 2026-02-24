-- ============================================================================
-- RECREATE COST VIEWS TO USE UNIFIED PO_COSTS TABLE
-- ============================================================================
-- This migration recreates the v_payment_tracking and v_landed_cost_summary
-- views that were dropped during the costs merge migration.
-- These views now use the unified 6.0_po_costs table instead of separate tables.
-- ============================================================================

-- Drop views if they exist (cleanup from previous migration)
DROP VIEW IF EXISTS v_payment_tracking CASCADE;
DROP VIEW IF EXISTS v_landed_cost_summary CASCADE;

-- ============================================================================
-- VIEW 1: Payment Tracking
-- Shows payment status for each PO (down payments, balance payments, bank fees)
-- ============================================================================
CREATE OR REPLACE VIEW v_payment_tracking AS
SELECT
  p.po_id,
  p.po_number,
  p.po_date,
  q.supplier_id,
  s.supplier_name,
  p.total_value,
  p.currency,
  p.status AS po_status,

  -- Sum all payment-related costs (excluding landed costs)
  COALESCE(SUM(
    CASE
      WHEN c.cost_category IN (
        'down_payment',
        'balance_payment',
        'additional_balance_payment',
        'overpayment_credit',
        'full_amount_bank_fee',
        'telex_bank_fee',
        'value_today_bank_fee',
        'admin_bank_fee',
        'inter_bank_transfer_fee'
      ) THEN c.amount
      ELSE 0
    END
  ), 0) AS total_paid,

  -- Calculate outstanding balance
  p.total_value - COALESCE(SUM(
    CASE
      WHEN c.cost_category IN (
        'down_payment',
        'balance_payment',
        'additional_balance_payment'
      ) THEN c.amount
      ELSE 0
    END
  ), 0) AS outstanding_balance,

  -- Payment status based on payments vs total value
  CASE
    WHEN COALESCE(SUM(
      CASE
        WHEN c.cost_category IN ('down_payment', 'balance_payment', 'additional_balance_payment')
        THEN c.amount
        ELSE 0
      END
    ), 0) = 0 THEN 'Not Paid'
    WHEN COALESCE(SUM(
      CASE
        WHEN c.cost_category IN ('down_payment', 'balance_payment', 'additional_balance_payment')
        THEN c.amount
        ELSE 0
      END
    ), 0) < p.total_value THEN 'Partially Paid'
    ELSE 'Fully Paid'
  END AS payment_status

FROM "5.0_purchases" p
LEFT JOIN "4.0_price_quotes" q ON p.quote_id = q.quote_id
LEFT JOIN "2.0_suppliers" s ON q.supplier_id = s.supplier_id
LEFT JOIN "6.0_po_costs" c ON p.po_id = c.po_id
GROUP BY
  p.po_id,
  p.po_number,
  p.po_date,
  q.supplier_id,
  s.supplier_name,
  p.total_value,
  p.currency,
  p.status;

COMMENT ON VIEW v_payment_tracking IS 'Payment status tracking for purchase orders using unified po_costs table';

-- ============================================================================
-- VIEW 2: Landed Cost Summary
-- Shows total landed costs (duties, taxes, delivery) for each PO
-- ============================================================================
CREATE OR REPLACE VIEW v_landed_cost_summary AS
SELECT
  p.po_id,
  p.po_number,
  p.po_date,
  q.supplier_id,
  s.supplier_name,
  p.total_value AS po_value,
  p.currency,

  -- Sum all landed cost categories
  COALESCE(SUM(
    CASE
      WHEN c.cost_category = 'local_import_duty' THEN c.amount
      ELSE 0
    END
  ), 0) AS import_duty,

  COALESCE(SUM(
    CASE
      WHEN c.cost_category = 'local_vat' THEN c.amount
      ELSE 0
    END
  ), 0) AS vat,

  COALESCE(SUM(
    CASE
      WHEN c.cost_category = 'local_income_tax' THEN c.amount
      ELSE 0
    END
  ), 0) AS income_tax,

  COALESCE(SUM(
    CASE
      WHEN c.cost_category = 'local_delivery' THEN c.amount
      ELSE 0
    END
  ), 0) AS delivery_cost,

  COALESCE(SUM(
    CASE
      WHEN c.cost_category IN (
        'demurrage_fee',
        'penalty_fee',
        'dhl_advance_payment_fee',
        'local_import_tax'
      ) THEN c.amount
      ELSE 0
    END
  ), 0) AS other_fees,

  -- Total landed costs (all landed cost categories)
  COALESCE(SUM(
    CASE
      WHEN c.cost_category IN (
        'local_import_duty',
        'local_vat',
        'local_income_tax',
        'local_delivery',
        'demurrage_fee',
        'penalty_fee',
        'dhl_advance_payment_fee',
        'local_import_tax'
      ) THEN c.amount
      ELSE 0
    END
  ), 0) AS total_landed_costs,

  -- True total cost (PO value + all landed costs)
  p.total_value + COALESCE(SUM(
    CASE
      WHEN c.cost_category IN (
        'local_import_duty',
        'local_vat',
        'local_income_tax',
        'local_delivery',
        'demurrage_fee',
        'penalty_fee',
        'dhl_advance_payment_fee',
        'local_import_tax'
      ) THEN c.amount
      ELSE 0
    END
  ), 0) AS true_total_cost

FROM "5.0_purchases" p
LEFT JOIN "4.0_price_quotes" q ON p.quote_id = q.quote_id
LEFT JOIN "2.0_suppliers" s ON q.supplier_id = s.supplier_id
LEFT JOIN "6.0_po_costs" c ON p.po_id = c.po_id
GROUP BY
  p.po_id,
  p.po_number,
  p.po_date,
  q.supplier_id,
  s.supplier_name,
  p.total_value,
  p.currency;

COMMENT ON VIEW v_landed_cost_summary IS 'Landed cost analysis for purchase orders using unified po_costs table';

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================
GRANT SELECT ON v_payment_tracking TO anon, authenticated;
GRANT SELECT ON v_landed_cost_summary TO anon, authenticated;

-- ============================================================================
-- PART 2: MERGE PAYMENT DETAILS + LANDED COSTS INTO PO_COSTS (SAFE VERSION)
-- ============================================================================
-- Run this AFTER Part 1 is complete and verified
-- ============================================================================

-- Check current record counts before migration
SELECT '7.0_payment_details' as table_name, COUNT(*) as record_count FROM "7.0_payment_details"
UNION ALL
SELECT '7.1_landed_costs' as table_name, COUNT(*) as record_count FROM "7.1_landed_costs";

-- Step 1: Create unified po_costs table with TEXT category (more flexible than enum)
CREATE TABLE IF NOT EXISTS po_costs (
  cost_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID NOT NULL,
  cost_category TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  currency public.currency NOT NULL,
  payment_date DATE,
  notes TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT (now() AT TIME ZONE 'utc'::text),

  CONSTRAINT po_costs_po_id_fkey
    FOREIGN KEY (po_id) REFERENCES "6.0_purchases"(po_id)
    ON UPDATE CASCADE ON DELETE CASCADE,

  -- Constraint to ensure valid categories (all 17 possible values)
  CONSTRAINT po_costs_category_check
    CHECK (cost_category IN (
      -- Payment categories (9 values from currency_payment_category)
      'down_payment',
      'balance_payment',
      'additional_balance_payment',
      'overpayment_credit',
      'full_amount_bank_fee',
      'telex_bank_fee',
      'value_today_bank_fee',
      'admin_bank_fee',
      'inter_bank_transfer_fee',

      -- Landed cost categories (8 values from landed_costs_type)
      'local_import_duty',
      'local_vat',
      'local_income_tax',
      'local_delivery',
      'demurrage_fee',
      'penalty_fee',
      'dhl_advance_payment_fee',
      'local_import_tax'
    ))
);

-- Step 2: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_po_costs_po_id ON po_costs(po_id);
CREATE INDEX IF NOT EXISTS idx_po_costs_category ON po_costs(cost_category);
CREATE INDEX IF NOT EXISTS idx_po_costs_po_category ON po_costs(po_id, cost_category);
CREATE INDEX IF NOT EXISTS idx_po_costs_payment_date ON po_costs(payment_date) WHERE payment_date IS NOT NULL;

-- Step 3: Migrate payment_details → po_costs
-- IMPORTANT: Preserves exact enum values as TEXT
INSERT INTO po_costs (cost_id, po_id, cost_category, amount, currency, payment_date, notes, updated_at)
SELECT
  payment_id,
  po_id,
  category::text as cost_category,  -- Cast enum to text (preserves exact value)
  amount,
  currency,
  payment_date,
  notes,
  updated_at
FROM "7.0_payment_details"
WHERE po_id IS NOT NULL;

-- Verify payment_details migration
SELECT
  '✅ Payment details migrated' as status,
  COUNT(*) as migrated_count,
  (SELECT COUNT(*) FROM "7.0_payment_details" WHERE po_id IS NOT NULL) as original_count
FROM po_costs
WHERE cost_category IN (
  'down_payment', 'balance_payment', 'additional_balance_payment',
  'overpayment_credit', 'full_amount_bank_fee', 'telex_bank_fee',
  'value_today_bank_fee', 'admin_bank_fee', 'inter_bank_transfer_fee'
);

-- Step 4: Migrate landed_costs → po_costs
-- IMPORTANT: Preserves exact enum values as TEXT
INSERT INTO po_costs (cost_id, po_id, cost_category, amount, currency, payment_date, notes, updated_at)
SELECT
  landed_cost_id,
  po_id,
  cost_type::text as cost_category,  -- Cast enum to text (preserves exact value)
  amount,
  currency,
  payment_date,
  notes,
  updated_at
FROM "7.1_landed_costs"
WHERE po_id IS NOT NULL;

-- Verify landed_costs migration
SELECT
  '✅ Landed costs migrated' as status,
  COUNT(*) as migrated_count,
  (SELECT COUNT(*) FROM "7.1_landed_costs" WHERE po_id IS NOT NULL) as original_count
FROM po_costs
WHERE cost_category IN (
  'local_import_duty', 'local_vat', 'local_income_tax', 'local_delivery',
  'demurrage_fee', 'penalty_fee', 'dhl_advance_payment_fee', 'local_import_tax'
);

-- Step 5: Create trigger for analytics refresh (same as old tables)
CREATE OR REPLACE TRIGGER refresh_on_po_cost_change
  AFTER INSERT OR UPDATE OR DELETE ON po_costs
  FOR EACH STATEMENT
  EXECUTE FUNCTION refresh_analytics_view();

-- ============================================================================
-- VERIFICATION BEFORE DROPPING OLD TABLES
-- ============================================================================

-- Critical verification: Check total counts match
SELECT
  'VERIFICATION CHECK' as check_type,
  (SELECT COUNT(*) FROM "7.0_payment_details") as payment_details_count,
  (SELECT COUNT(*) FROM "7.1_landed_costs") as landed_costs_count,
  (SELECT COUNT(*) FROM po_costs) as po_costs_count,
  (SELECT COUNT(*) FROM "7.0_payment_details") + (SELECT COUNT(*) FROM "7.1_landed_costs") as expected_total,
  CASE
    WHEN (SELECT COUNT(*) FROM po_costs) =
         (SELECT COUNT(*) FROM "7.0_payment_details") + (SELECT COUNT(*) FROM "7.1_landed_costs")
    THEN '✅ COUNTS MATCH - SAFE TO DROP OLD TABLES'
    ELSE '❌ COUNTS DO NOT MATCH - DO NOT PROCEED'
  END as verification_status;

-- Detailed breakdown by category
SELECT
  'Category Breakdown' as report_type,
  cost_category,
  COUNT(*) as count,
  SUM(amount) as total_amount,
  currency
FROM po_costs
GROUP BY cost_category, currency
ORDER BY cost_category;

-- ============================================================================
-- ONLY RUN THE SECTION BELOW AFTER VERIFYING COUNTS MATCH!
-- ============================================================================

/*
-- Step 6: Drop old tables (UNCOMMENT ONLY AFTER VERIFICATION)
DROP TABLE IF EXISTS "7.0_payment_details" CASCADE;
DROP TABLE IF EXISTS "7.1_landed_costs" CASCADE;

-- Step 7: Create analytics view for unified costs
CREATE OR REPLACE VIEW v_po_costs_summary AS
SELECT
  po_id,
  -- Payment totals
  SUM(CASE
    WHEN cost_category IN (
      'down_payment', 'balance_payment', 'additional_balance_payment', 'overpayment_credit'
    ) THEN amount ELSE 0
  END) as total_payments,

  -- Bank fee totals
  SUM(CASE
    WHEN cost_category IN (
      'full_amount_bank_fee', 'telex_bank_fee', 'value_today_bank_fee',
      'admin_bank_fee', 'inter_bank_transfer_fee'
    ) THEN amount ELSE 0
  END) as total_bank_fees,

  -- Landed cost totals
  SUM(CASE
    WHEN cost_category IN (
      'local_import_duty', 'local_vat', 'local_income_tax', 'local_delivery',
      'demurrage_fee', 'penalty_fee', 'dhl_advance_payment_fee', 'local_import_tax'
    ) THEN amount ELSE 0
  END) as total_landed_costs,

  -- Grand total
  SUM(amount) as total_all_costs,
  currency,
  COUNT(*) as cost_entry_count,
  MIN(payment_date) as first_payment_date,
  MAX(payment_date) as last_payment_date
FROM po_costs
GROUP BY po_id, currency;

-- Verify view works
SELECT * FROM v_po_costs_summary LIMIT 5;

-- Success message
SELECT
  '🎉 MIGRATION COMPLETE' as status,
  'Old tables dropped, unified po_costs table created' as message,
  (SELECT COUNT(*) FROM po_costs) as total_cost_records,
  (SELECT COUNT(DISTINCT po_id) FROM po_costs) as pos_with_costs;
*/

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- Tables to be dropped: 7.0_payment_details, 7.1_landed_costs
-- New table: po_costs (unified payment + landed cost tracking)
--
-- Payment categories preserved (9):
--   down_payment, balance_payment, additional_balance_payment, overpayment_credit,
--   full_amount_bank_fee, telex_bank_fee, value_today_bank_fee,
--   admin_bank_fee, inter_bank_transfer_fee
--
-- Landed cost categories preserved (8):
--   local_import_duty, local_vat, local_income_tax, local_delivery,
--   demurrage_fee, penalty_fee, dhl_advance_payment_fee, local_import_tax
-- ============================================================================

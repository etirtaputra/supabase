-- ============================================================================
-- CREATE UNIFIED PO_COST_CATEGORY ENUM
-- ============================================================================
-- This migration creates a new enum type that combines:
-- - currency_payment_category (9 values)
-- - landed_costs_type (8 values)
-- Into a single po_cost_category enum (17 values)
--
-- Note: The 6.0_po_costs table uses TEXT with CHECK constraint, not enum.
-- This enum is for future use if you want to convert the table to use enum type.
-- ============================================================================

-- Step 1: Create unified po_cost_category enum
CREATE TYPE po_cost_category AS ENUM (
  -- Payment categories (from currency_payment_category)
  'down_payment',
  'balance_payment',
  'additional_balance_payment',
  'overpayment_credit',

  -- Bank fee categories (from currency_payment_category)
  'full_amount_bank_fee',
  'telex_bank_fee',
  'value_today_bank_fee',
  'admin_bank_fee',
  'inter_bank_transfer_fee',

  -- Landed cost categories (from landed_costs_type)
  'local_import_duty',
  'local_vat',
  'local_income_tax',
  'local_delivery',
  'demurrage_fee',
  'penalty_fee',
  'dhl_advance_payment_fee',
  'local_import_tax'
);

-- Step 2: Verify enum was created successfully
SELECT
  '✅ Enum created successfully' as status,
  enumtypid::regtype as enum_name,
  array_agg(enumlabel ORDER BY enumsortorder) as values
FROM pg_enum
WHERE enumtypid = 'po_cost_category'::regtype
GROUP BY enumtypid;

-- ============================================================================
-- OPTIONAL: Drop old enum types (ONLY if not used elsewhere)
-- ============================================================================
-- Before dropping, check what tables are using these enums:

-- Check usage of currency_payment_category
SELECT
  'currency_payment_category' as enum_name,
  n.nspname as schema,
  c.relname as table_name,
  a.attname as column_name
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
JOIN pg_attribute a ON a.atttypid = t.oid
JOIN pg_class c ON a.attrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE t.typname = 'currency_payment_category'
AND c.relkind = 'r';

-- Check usage of landed_costs_type
SELECT
  'landed_costs_type' as enum_name,
  n.nspname as schema,
  c.relname as table_name,
  a.attname as column_name
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
JOIN pg_attribute a ON a.atttypid = t.oid
JOIN pg_class c ON a.attrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE t.typname = 'landed_costs_type'
AND c.relkind = 'r';

/*
-- ONLY UNCOMMENT AFTER VERIFYING NO TABLES USE THESE ENUMS
-- If the above queries return no rows, it's safe to drop:

DROP TYPE IF EXISTS currency_payment_category;
DROP TYPE IF EXISTS landed_costs_type;

SELECT '✅ Old enum types dropped successfully' as status;
*/

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- ✅ Created: po_cost_category enum with 17 values
-- ⚠️  Old enums NOT dropped (commented out for safety)
-- 📋 Next steps:
--    1. Verify no tables use old enums with queries above
--    2. If safe, uncomment DROP TYPE statements
--    3. Optionally convert 6.0_po_costs.cost_category from TEXT to po_cost_category enum
-- ============================================================================

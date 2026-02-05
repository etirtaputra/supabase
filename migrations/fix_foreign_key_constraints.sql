-- ============================================================================
-- FIX FOREIGN KEY CONSTRAINTS AFTER TABLE RENAME
-- ============================================================================
-- After renaming:
--   6.0_purchases → 5.0_purchases
--   6.1_purchase_line_items → 5.1_purchase_line_items
--
-- Foreign key constraints in po_costs and purchase_line_items tables
-- still reference the old table names and need to be updated.
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Fix po_costs table foreign key
-- ============================================================================

-- Drop the old foreign key constraint
ALTER TABLE "6.0_po_costs"
DROP CONSTRAINT IF EXISTS po_costs_po_id_fkey;

-- Add the new foreign key constraint pointing to renamed table
ALTER TABLE "6.0_po_costs"
ADD CONSTRAINT po_costs_po_id_fkey
  FOREIGN KEY (po_id)
  REFERENCES "5.0_purchases"(po_id)
  ON UPDATE CASCADE
  ON DELETE CASCADE;

COMMENT ON CONSTRAINT po_costs_po_id_fkey ON "6.0_po_costs"
IS 'Links PO costs to purchase orders (updated after table rename)';

-- ============================================================================
-- STEP 2: Fix purchase_line_items table foreign key
-- ============================================================================

-- Drop the old foreign key constraint
ALTER TABLE "5.1_purchase_line_items"
DROP CONSTRAINT IF EXISTS purchase_line_items_po_id_fkey;

ALTER TABLE "5.1_purchase_line_items"
DROP CONSTRAINT IF EXISTS "6.1_purchase_line_items_po_id_fkey";

-- Add the new foreign key constraint pointing to renamed table
ALTER TABLE "5.1_purchase_line_items"
ADD CONSTRAINT purchase_line_items_po_id_fkey
  FOREIGN KEY (po_id)
  REFERENCES "5.0_purchases"(po_id)
  ON UPDATE CASCADE
  ON DELETE CASCADE;

COMMENT ON CONSTRAINT purchase_line_items_po_id_fkey ON "5.1_purchase_line_items"
IS 'Links purchase line items to purchase orders (updated after table rename)';

-- ============================================================================
-- STEP 3: Verify all foreign keys are correct
-- ============================================================================

-- Check all foreign keys referencing purchases table
DO $$
DECLARE
  fk_record RECORD;
  wrong_fk_found BOOLEAN := FALSE;
BEGIN
  FOR fk_record IN
    SELECT
      conname AS constraint_name,
      conrelid::regclass AS table_name,
      confrelid::regclass AS referenced_table
    FROM pg_constraint
    WHERE confrelid::regclass::text LIKE '%purchase%'
    AND contype = 'f'
  LOOP
    -- Check if any constraint still references old table name
    IF fk_record.referenced_table::text = '6.0_purchases' OR
       fk_record.referenced_table::text = '6.1_purchase_line_items' THEN
      RAISE WARNING 'Found foreign key still referencing old table: % on % references %',
        fk_record.constraint_name,
        fk_record.table_name,
        fk_record.referenced_table;
      wrong_fk_found := TRUE;
    END IF;
  END LOOP;

  IF NOT wrong_fk_found THEN
    RAISE NOTICE 'All foreign key constraints are correctly referencing renamed tables';
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- MANUAL VERIFICATION
-- ============================================================================
-- Run this query to see all foreign keys related to purchases:
--
-- SELECT
--   conname AS constraint_name,
--   conrelid::regclass AS table_name,
--   confrelid::regclass AS referenced_table,
--   pg_get_constraintdef(oid) AS definition
-- FROM pg_constraint
-- WHERE confrelid::regclass::text IN ('5.0_purchases', '5.1_purchase_line_items', '6.0_po_costs')
-- AND contype = 'f'
-- ORDER BY table_name, constraint_name;

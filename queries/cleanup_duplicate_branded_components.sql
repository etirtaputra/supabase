-- ============================================================================
-- CLEANUP: Remove JEMBO and SUPREME branded components
-- ============================================================================
-- Purpose: Delete the incorrectly duplicated components so we can start fresh
-- ============================================================================

-- ============================================================================
-- STEP 1: PREVIEW - See what will be deleted
-- ============================================================================

SELECT
  component_id,
  supplier_model,
  internal_description,
  brand,
  category,
  updated_at
FROM "3.0_components"
WHERE brand IN ('JEMBO', 'SUPREME')
ORDER BY brand, supplier_model;

-- Check count
SELECT
  brand,
  COUNT(*) AS components_to_delete,
  COUNT(DISTINCT supplier_model) AS unique_supplier_models
FROM "3.0_components"
WHERE brand IN ('JEMBO', 'SUPREME')
GROUP BY brand;


-- ============================================================================
-- STEP 2: CHECK - Are any of these components used in quotes or POs?
-- ============================================================================
-- (They shouldn't be if we haven't run the update script yet)

SELECT
  c.brand,
  COUNT(DISTINCT qli.quote_id) AS used_in_quotes,
  COUNT(DISTINCT pli.po_id) AS used_in_pos
FROM "3.0_components" c
LEFT JOIN "4.1_price_quote_line_items" qli ON c.component_id = qli.component_id
LEFT JOIN "5.1_purchase_line_items" pli ON c.component_id = pli.component_id
WHERE c.brand IN ('JEMBO', 'SUPREME')
GROUP BY c.brand;

-- If this shows any usage, review before deleting!


-- ============================================================================
-- STEP 3: DELETE - Remove the components (Run in transaction!)
-- ============================================================================

BEGIN;

-- Show count before
SELECT 'Before deletion:' AS status, COUNT(*) AS count
FROM "3.0_components"
WHERE brand IN ('JEMBO', 'SUPREME');

-- Delete the components
DELETE FROM "3.0_components"
WHERE brand IN ('JEMBO', 'SUPREME');

-- Show count after
SELECT 'After deletion:' AS status, COUNT(*) AS count
FROM "3.0_components"
WHERE brand IN ('JEMBO', 'SUPREME');

-- If everything looks good:
COMMIT;

-- If something looks wrong:
-- ROLLBACK;


-- ============================================================================
-- STEP 4: VERIFY - Confirm deletion
-- ============================================================================

-- This should return 0 rows
SELECT *
FROM "3.0_components"
WHERE brand IN ('JEMBO', 'SUPREME');

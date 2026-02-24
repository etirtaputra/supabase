-- ============================================================================
-- DUPLICATE COMPONENTS BY SUPPLIER (FIXED - UNIQUE ONLY)
-- ============================================================================
-- Purpose: Find components associated with specific suppliers and duplicate them
--          with new brand names while keeping the same supplier_model
--          ENSURES ONLY ONE COMPONENT PER UNIQUE SUPPLIER_MODEL
-- ============================================================================

-- Supplier IDs:
-- c09289fe-7601-4b5d-84d2-be64f1c9f9f2 → Brand "JEMBO"
-- b0c03580-f471-4637-bc33-d094781c98d5 → Brand "SUPREME"

-- ============================================================================
-- STEP 1: PREVIEW - See UNIQUE components that will be duplicated
-- ============================================================================

WITH unique_components AS (
  SELECT DISTINCT
    c.component_id,
    c.supplier_model,
    c.internal_description,
    c.brand AS current_brand,
    c.category,
    q.supplier_id,
    s.supplier_name
  FROM "3.0_components" c
  INNER JOIN "4.1_price_quote_line_items" qli
    ON c.component_id = qli.component_id
  INNER JOIN "4.0_price_quotes" q
    ON qli.quote_id = q.quote_id
  LEFT JOIN "2.0_suppliers" s
    ON q.supplier_id = s.supplier_id
  WHERE q.supplier_id IN (
    'c09289fe-7601-4b5d-84d2-be64f1c9f9f2',  -- JEMBO
    'b0c03580-f471-4637-bc33-d094781c98d5'   -- SUPREME
  )
)
SELECT
  supplier_id,
  supplier_name,
  CASE
    WHEN supplier_id = 'c09289fe-7601-4b5d-84d2-be64f1c9f9f2' THEN 'JEMBO'
    WHEN supplier_id = 'b0c03580-f471-4637-bc33-d094781c98d5' THEN 'SUPREME'
  END AS new_brand,
  supplier_model,
  current_brand,
  internal_description,
  category
FROM unique_components
ORDER BY supplier_id, supplier_model;

-- Count by supplier
WITH unique_components AS (
  SELECT DISTINCT
    c.supplier_model,
    q.supplier_id
  FROM "3.0_components" c
  INNER JOIN "4.1_price_quote_line_items" qli
    ON c.component_id = qli.component_id
  INNER JOIN "4.0_price_quotes" q
    ON qli.quote_id = q.quote_id
  WHERE q.supplier_id IN (
    'c09289fe-7601-4b5d-84d2-be64f1c9f9f2',
    'b0c03580-f471-4637-bc33-d094781c98d5'
  )
)
SELECT
  supplier_id,
  CASE
    WHEN supplier_id = 'c09289fe-7601-4b5d-84d2-be64f1c9f9f2' THEN 'JEMBO'
    WHEN supplier_id = 'b0c03580-f471-4637-bc33-d094781c98d5' THEN 'SUPREME'
  END AS new_brand,
  COUNT(DISTINCT supplier_model) AS unique_components_to_create
FROM unique_components
GROUP BY supplier_id;


-- ============================================================================
-- STEP 2: CREATE UNIQUE DUPLICATES (Run this in a transaction)
-- ============================================================================

BEGIN;

-- Insert duplicates for JEMBO supplier (UNIQUE only)
INSERT INTO "3.0_components" (
  component_id,
  supplier_model,
  internal_description,
  brand,
  category,
  updated_at
)
SELECT DISTINCT ON (c.supplier_model)  -- CRITICAL: Only one per supplier_model
  gen_random_uuid() AS component_id,
  c.supplier_model,
  c.internal_description,
  'JEMBO' AS brand,
  c.category,
  NOW() AS updated_at
FROM "3.0_components" c
INNER JOIN "4.1_price_quote_line_items" qli
  ON c.component_id = qli.component_id
INNER JOIN "4.0_price_quotes" q
  ON qli.quote_id = q.quote_id
WHERE q.supplier_id = 'c09289fe-7601-4b5d-84d2-be64f1c9f9f2'
  -- Avoid creating duplicates if already exists
  AND NOT EXISTS (
    SELECT 1
    FROM "3.0_components" existing
    WHERE existing.supplier_model = c.supplier_model
      AND existing.brand = 'JEMBO'
  )
ORDER BY c.supplier_model, c.component_id;  -- Consistent ordering


-- Insert duplicates for SUPREME supplier (UNIQUE only)
INSERT INTO "3.0_components" (
  component_id,
  supplier_model,
  internal_description,
  brand,
  category,
  updated_at
)
SELECT DISTINCT ON (c.supplier_model)  -- CRITICAL: Only one per supplier_model
  gen_random_uuid() AS component_id,
  c.supplier_model,
  c.internal_description,
  'SUPREME' AS brand,
  c.category,
  NOW() AS updated_at
FROM "3.0_components" c
INNER JOIN "4.1_price_quote_line_items" qli
  ON c.component_id = qli.component_id
INNER JOIN "4.0_price_quotes" q
  ON qli.quote_id = q.quote_id
WHERE q.supplier_id = 'b0c03580-f471-4637-bc33-d094781c98d5'
  -- Avoid creating duplicates if already exists
  AND NOT EXISTS (
    SELECT 1
    FROM "3.0_components" existing
    WHERE existing.supplier_model = c.supplier_model
      AND existing.brand = 'SUPREME'
  )
ORDER BY c.supplier_model, c.component_id;  -- Consistent ordering


-- Show what was created
SELECT
  'Components created' AS action,
  COUNT(*) AS count,
  brand
FROM "3.0_components"
WHERE updated_at > NOW() - INTERVAL '1 minute'
  AND brand IN ('JEMBO', 'SUPREME')
GROUP BY brand;

-- If everything looks good:
COMMIT;

-- If something looks wrong:
-- ROLLBACK;


-- ============================================================================
-- STEP 3: VERIFY - Check the newly created components
-- ============================================================================

SELECT
  brand,
  COUNT(*) AS total_components,
  COUNT(DISTINCT supplier_model) AS unique_supplier_models
FROM "3.0_components"
WHERE brand IN ('JEMBO', 'SUPREME')
GROUP BY brand;

-- Detailed view
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


-- ============================================================================
-- STEP 4: VALIDATION - Ensure no duplicate supplier_models within same brand
-- ============================================================================

-- This should return 0 rows if everything is correct
SELECT
  supplier_model,
  brand,
  COUNT(*) AS duplicate_count,
  array_agg(component_id) AS component_ids
FROM "3.0_components"
WHERE brand IN ('JEMBO', 'SUPREME')
GROUP BY supplier_model, brand
HAVING COUNT(*) > 1;

-- If this returns any rows, there are unwanted duplicates!

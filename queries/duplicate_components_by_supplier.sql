-- ============================================================================
-- DUPLICATE COMPONENTS BY SUPPLIER
-- ============================================================================
-- Purpose: Find components associated with specific suppliers and duplicate them
--          with new brand names while keeping the same supplier_model
-- ============================================================================

-- Supplier IDs:
-- c09289fe-7601-4b5d-84d2-be64f1c9f9f2 → Brand "JEMBO"
-- b0c03580-f471-4637-bc33-d094781c98d5 → Brand "SUPREME"

-- ============================================================================
-- STEP 1: PREVIEW - See which components will be duplicated
-- ============================================================================

SELECT DISTINCT
  c.component_id,
  c.supplier_model,
  c.internal_description,
  c.brand AS current_brand,
  c.category,
  q.supplier_id,
  s.supplier_name,

  -- What the new brand will be
  CASE
    WHEN q.supplier_id = 'c09289fe-7601-4b5d-84d2-be64f1c9f9f2' THEN 'JEMBO'
    WHEN q.supplier_id = 'b0c03580-f471-4637-bc33-d094781c98d5' THEN 'SUPREME'
  END AS new_brand,

  -- Usage stats
  COUNT(DISTINCT qli.quote_id) AS times_quoted_with_this_supplier

FROM "3.0_components" c

-- Join to quote line items to find components used in quotes
INNER JOIN "4.1_price_quote_line_items" qli
  ON c.component_id = qli.component_id

-- Join to quotes to get supplier_id
INNER JOIN "4.0_price_quotes" q
  ON qli.quote_id = q.quote_id

-- Join to suppliers to get supplier name (for reference)
LEFT JOIN "2.0_suppliers" s
  ON q.supplier_id = s.supplier_id

WHERE q.supplier_id IN (
  'c09289fe-7601-4b5d-84d2-be64f1c9f9f2',  -- JEMBO
  'b0c03580-f471-4637-bc33-d094781c98d5'   -- SUPREME
)

GROUP BY
  c.component_id,
  c.supplier_model,
  c.internal_description,
  c.brand,
  c.category,
  q.supplier_id,
  s.supplier_name

ORDER BY q.supplier_id, c.supplier_model;

-- Review the above results before proceeding!


-- ============================================================================
-- STEP 2: CREATE DUPLICATES (Run this in a transaction)
-- ============================================================================

BEGIN;

-- Insert duplicates for JEMBO supplier (c09289fe-7601-4b5d-84d2-be64f1c9f9f2)
INSERT INTO "3.0_components" (
  component_id,
  supplier_model,
  internal_description,
  brand,
  category,
  updated_at
)
SELECT DISTINCT
  gen_random_uuid() AS component_id,  -- Generate new UUID
  c.supplier_model,                   -- Keep same supplier_model
  c.internal_description,             -- Keep same description
  'JEMBO' AS brand,                   -- Set new brand
  c.category,                         -- Keep same category
  NOW() AS updated_at                 -- Set current timestamp

FROM "3.0_components" c

INNER JOIN "4.1_price_quote_line_items" qli
  ON c.component_id = qli.component_id

INNER JOIN "4.0_price_quotes" q
  ON qli.quote_id = q.quote_id

WHERE q.supplier_id = 'c09289fe-7601-4b5d-84d2-be64f1c9f9f2'

-- Avoid creating duplicates if a component with same supplier_model and brand already exists
AND NOT EXISTS (
  SELECT 1
  FROM "3.0_components" existing
  WHERE existing.supplier_model = c.supplier_model
    AND existing.brand = 'JEMBO'
);


-- Insert duplicates for SUPREME supplier (b0c03580-f471-4637-bc33-d094781c98d5)
INSERT INTO "3.0_components" (
  component_id,
  supplier_model,
  internal_description,
  brand,
  category,
  updated_at
)
SELECT DISTINCT
  gen_random_uuid() AS component_id,  -- Generate new UUID
  c.supplier_model,                   -- Keep same supplier_model
  c.internal_description,             -- Keep same description
  'SUPREME' AS brand,                 -- Set new brand
  c.category,                         -- Keep same category
  NOW() AS updated_at                 -- Set current timestamp

FROM "3.0_components" c

INNER JOIN "4.1_price_quote_line_items" qli
  ON c.component_id = qli.component_id

INNER JOIN "4.0_price_quotes" q
  ON qli.quote_id = q.quote_id

WHERE q.supplier_id = 'b0c03580-f471-4637-bc33-d094781c98d5'

-- Avoid creating duplicates if a component with same supplier_model and brand already exists
AND NOT EXISTS (
  SELECT 1
  FROM "3.0_components" existing
  WHERE existing.supplier_model = c.supplier_model
    AND existing.brand = 'SUPREME'
);


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
  component_id,
  supplier_model,
  internal_description,
  brand,
  category,
  updated_at
FROM "3.0_components"
WHERE brand IN ('JEMBO', 'SUPREME')
ORDER BY brand, supplier_model;

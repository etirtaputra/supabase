-- ============================================================================
-- UPDATE QUOTE LINE ITEMS TO USE NEW BRANDED COMPONENTS
-- ============================================================================
-- Purpose: Update component_id in quote line items to use newly created
--          JEMBO and SUPREME branded components based on supplier_id and supplier_model
-- ============================================================================

-- Mapping:
-- Quotes with supplier_id = 'c09289fe-7601-4b5d-84d2-be64f1c9f9f2' → Use JEMBO components
-- Quotes with supplier_id = 'b0c03580-f471-4637-bc33-d094781c98d5' → Use SUPREME components

-- ============================================================================
-- STEP 1: PREVIEW - See which line items will be updated
-- ============================================================================

SELECT
  q.quote_id,
  q.pi_number,
  q.supplier_id,
  s.supplier_name,

  qli.line_item_id,
  qli.component_id AS old_component_id,

  old_comp.supplier_model,
  old_comp.brand AS old_brand,

  -- Find the new component with matching supplier_model and appropriate brand
  new_comp.component_id AS new_component_id,
  new_comp.brand AS new_brand,

  qli.quantity,
  qli.unit_price

FROM "4.0_price_quotes" q

INNER JOIN "4.1_price_quote_line_items" qli
  ON q.quote_id = qli.quote_id

-- Join to get old component details
INNER JOIN "3.0_components" old_comp
  ON qli.component_id = old_comp.component_id

-- Join to get new component with matching supplier_model and correct brand
INNER JOIN "3.0_components" new_comp
  ON old_comp.supplier_model = new_comp.supplier_model
  AND new_comp.brand = CASE
    WHEN q.supplier_id = 'c09289fe-7601-4b5d-84d2-be64f1c9f9f2' THEN 'JEMBO'
    WHEN q.supplier_id = 'b0c03580-f471-4637-bc33-d094781c98d5' THEN 'SUPREME'
  END

-- Join to suppliers for reference
LEFT JOIN "2.0_suppliers" s
  ON q.supplier_id = s.supplier_id

WHERE q.supplier_id IN (
  'c09289fe-7601-4b5d-84d2-be64f1c9f9f2',  -- JEMBO
  'b0c03580-f471-4637-bc33-d094781c98d5'   -- SUPREME
)

ORDER BY q.supplier_id, q.pi_number, qli.line_item_id;

-- Review the above! Make sure:
-- 1. old_component_id and new_component_id are different
-- 2. supplier_model matches between old and new
-- 3. new_brand is correct (JEMBO or SUPREME)


-- ============================================================================
-- STEP 2: COUNT - How many line items will be updated
-- ============================================================================

SELECT
  q.supplier_id,
  s.supplier_name,
  CASE
    WHEN q.supplier_id = 'c09289fe-7601-4b5d-84d2-be64f1c9f9f2' THEN 'JEMBO'
    WHEN q.supplier_id = 'b0c03580-f471-4637-bc33-d094781c98d5' THEN 'SUPREME'
  END AS target_brand,
  COUNT(DISTINCT q.quote_id) AS quotes_affected,
  COUNT(qli.line_item_id) AS line_items_to_update,
  COUNT(DISTINCT old_comp.component_id) AS unique_old_components,
  COUNT(DISTINCT new_comp.component_id) AS unique_new_components

FROM "4.0_price_quotes" q

INNER JOIN "4.1_price_quote_line_items" qli
  ON q.quote_id = qli.quote_id

INNER JOIN "3.0_components" old_comp
  ON qli.component_id = old_comp.component_id

INNER JOIN "3.0_components" new_comp
  ON old_comp.supplier_model = new_comp.supplier_model
  AND new_comp.brand = CASE
    WHEN q.supplier_id = 'c09289fe-7601-4b5d-84d2-be64f1c9f9f2' THEN 'JEMBO'
    WHEN q.supplier_id = 'b0c03580-f471-4637-bc33-d094781c98d5' THEN 'SUPREME'
  END

LEFT JOIN "2.0_suppliers" s
  ON q.supplier_id = s.supplier_id

WHERE q.supplier_id IN (
  'c09289fe-7601-4b5d-84d2-be64f1c9f9f2',
  'b0c03580-f471-4637-bc33-d094781c98d5'
)

GROUP BY q.supplier_id, s.supplier_name;


-- ============================================================================
-- STEP 3: EXECUTE - Update the component_ids (Run in transaction!)
-- ============================================================================

BEGIN;

-- Update quote line items for JEMBO supplier
WITH new_component_mapping AS (
  SELECT DISTINCT
    old_comp.component_id AS old_component_id,
    new_comp.component_id AS new_component_id,
    old_comp.supplier_model
  FROM "3.0_components" old_comp
  INNER JOIN "3.0_components" new_comp
    ON old_comp.supplier_model = new_comp.supplier_model
    AND new_comp.brand = 'JEMBO'
  WHERE old_comp.brand != 'JEMBO'  -- Don't map JEMBO to itself
)
UPDATE "4.1_price_quote_line_items" qli
SET
  component_id = mapping.new_component_id,
  updated_at = NOW()
FROM new_component_mapping mapping
INNER JOIN "4.0_price_quotes" q
  ON qli.quote_id = q.quote_id
WHERE qli.component_id = mapping.old_component_id
  AND q.supplier_id = 'c09289fe-7601-4b5d-84d2-be64f1c9f9f2';


-- Update quote line items for SUPREME supplier
WITH new_component_mapping AS (
  SELECT DISTINCT
    old_comp.component_id AS old_component_id,
    new_comp.component_id AS new_component_id,
    old_comp.supplier_model
  FROM "3.0_components" old_comp
  INNER JOIN "3.0_components" new_comp
    ON old_comp.supplier_model = new_comp.supplier_model
    AND new_comp.brand = 'SUPREME'
  WHERE old_comp.brand != 'SUPREME'  -- Don't map SUPREME to itself
)
UPDATE "4.1_price_quote_line_items" qli
SET
  component_id = mapping.new_component_id,
  updated_at = NOW()
FROM new_component_mapping mapping
INNER JOIN "4.0_price_quotes" q
  ON qli.quote_id = q.quote_id
WHERE qli.component_id = mapping.old_component_id
  AND q.supplier_id = 'b0c03580-f471-4637-bc33-d094781c98d5';


-- Show what was updated
SELECT
  'Line items updated' AS action,
  COUNT(*) AS count,
  CASE
    WHEN q.supplier_id = 'c09289fe-7601-4b5d-84d2-be64f1c9f9f2' THEN 'JEMBO'
    WHEN q.supplier_id = 'b0c03580-f471-4637-bc33-d094781c98d5' THEN 'SUPREME'
  END AS brand
FROM "4.1_price_quote_line_items" qli
INNER JOIN "4.0_price_quotes" q ON qli.quote_id = q.quote_id
WHERE qli.updated_at > NOW() - INTERVAL '1 minute'
  AND q.supplier_id IN (
    'c09289fe-7601-4b5d-84d2-be64f1c9f9f2',
    'b0c03580-f471-4637-bc33-d094781c98d5'
  )
GROUP BY q.supplier_id;

-- If everything looks good:
COMMIT;

-- If something looks wrong:
-- ROLLBACK;


-- ============================================================================
-- STEP 4: VERIFY - Check that updates were applied correctly
-- ============================================================================

SELECT
  q.quote_id,
  q.pi_number,
  q.supplier_id,
  s.supplier_name,

  qli.line_item_id,
  qli.component_id,

  c.supplier_model,
  c.brand,

  qli.quantity,
  qli.unit_price

FROM "4.0_price_quotes" q

INNER JOIN "4.1_price_quote_line_items" qli
  ON q.quote_id = qli.quote_id

INNER JOIN "3.0_components" c
  ON qli.component_id = c.component_id

LEFT JOIN "2.0_suppliers" s
  ON q.supplier_id = s.supplier_id

WHERE q.supplier_id IN (
  'c09289fe-7601-4b5d-84d2-be64f1c9f9f2',  -- Should all show JEMBO brand
  'b0c03580-f471-4637-bc33-d094781c98d5'   -- Should all show SUPREME brand
)

ORDER BY q.supplier_id, q.pi_number, qli.line_item_id;


-- ============================================================================
-- STEP 5: VALIDATION - Ensure brand matches supplier
-- ============================================================================

-- This should return 0 rows if everything is correct
SELECT
  q.quote_id,
  q.pi_number,
  q.supplier_id,
  c.component_id,
  c.supplier_model,
  c.brand,
  'MISMATCH!' AS issue

FROM "4.0_price_quotes" q

INNER JOIN "4.1_price_quote_line_items" qli
  ON q.quote_id = qli.quote_id

INNER JOIN "3.0_components" c
  ON qli.component_id = c.component_id

WHERE q.supplier_id = 'c09289fe-7601-4b5d-84d2-be64f1c9f9f2'
  AND c.brand != 'JEMBO'

UNION ALL

SELECT
  q.quote_id,
  q.pi_number,
  q.supplier_id,
  c.component_id,
  c.supplier_model,
  c.brand,
  'MISMATCH!' AS issue

FROM "4.0_price_quotes" q

INNER JOIN "4.1_price_quote_line_items" qli
  ON q.quote_id = qli.quote_id

INNER JOIN "3.0_components" c
  ON qli.component_id = c.component_id

WHERE q.supplier_id = 'b0c03580-f471-4637-bc33-d094781c98d5'
  AND c.brand != 'SUPREME';

-- If this query returns any rows, there's a mismatch that needs to be investigated!

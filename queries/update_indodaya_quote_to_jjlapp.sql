-- ============================================================================
-- UPDATE INDODAYA SURYA LESTARI QUOTE TO USE JJLAPP CABLES
-- ============================================================================
-- Quote ID: 92791880-c905-4deb-8b5a-d0e4bf9771a2
-- PI Number: 160752358
-- Supplier: Indodaya Surya Lestari
-- Target Brand: JJLAPP
-- ============================================================================

-- ============================================================================
-- STEP 1: PREVIEW - See current components in this quote
-- ============================================================================

SELECT
  q.quote_id,
  q.pi_number,
  q.quote_date,
  s.supplier_name,

  qli.component_id AS current_component_id,
  c.brand AS current_brand,
  c.supplier_model AS current_supplier_model,
  c.internal_description,

  qli.quantity,
  qli.unit_price

FROM "4.0_price_quotes" q
LEFT JOIN "2.0_suppliers" s ON q.supplier_id = s.supplier_id
INNER JOIN "4.1_price_quote_line_items" qli ON q.quote_id = qli.quote_id
INNER JOIN "3.0_components" c ON qli.component_id = c.component_id

WHERE q.quote_id = '92791880-c905-4deb-8b5a-d0e4bf9771a2'

ORDER BY c.supplier_model;


-- ============================================================================
-- STEP 2: SHOW JJLAPP BRANDED CABLES AVAILABLE
-- ============================================================================

SELECT
  component_id,
  brand,
  supplier_model,
  internal_description,
  category
FROM "3.0_components"
WHERE brand = 'JJLAPP'
  AND (
    supplier_model LIKE '%H1Z2Z2-K%'
    OR supplier_model LIKE '%Cable%'
    OR internal_description LIKE '%H1Z2Z2-K%'
  )
ORDER BY supplier_model;


-- ============================================================================
-- STEP 3: PREVIEW REASSIGNMENT
-- ============================================================================

SELECT
  qli.component_id AS current_component_id,
  curr_comp.brand AS current_brand,
  curr_comp.supplier_model AS current_supplier_model,

  -- Strip brand prefix to get base model
  CASE
    WHEN curr_comp.supplier_model LIKE '% %'
    THEN SUBSTRING(curr_comp.supplier_model FROM POSITION(' ' IN curr_comp.supplier_model) + 1)
    ELSE curr_comp.supplier_model
  END AS base_model,

  -- Find matching JJLAPP component
  jjlapp_comp.component_id AS jjlapp_component_id,
  jjlapp_comp.supplier_model AS jjlapp_supplier_model,

  CASE
    WHEN jjlapp_comp.component_id IS NULL THEN '❌ No JJLAPP match found'
    WHEN curr_comp.brand = 'JJLAPP' THEN '✅ Already JJLAPP'
    ELSE '🔄 Will update to JJLAPP'
  END AS status,

  qli.quantity,
  qli.unit_price

FROM "4.1_price_quote_line_items" qli
INNER JOIN "3.0_components" curr_comp ON qli.component_id = curr_comp.component_id

-- Find matching JJLAPP component
LEFT JOIN "3.0_components" jjlapp_comp
  ON jjlapp_comp.brand = 'JJLAPP'
  AND (
    -- Match by base supplier_model after stripping brand prefix
    SUBSTRING(jjlapp_comp.supplier_model FROM POSITION(' ' IN jjlapp_comp.supplier_model) + 1) =
    SUBSTRING(curr_comp.supplier_model FROM POSITION(' ' IN curr_comp.supplier_model) + 1)
    OR
    -- Fallback: if both contain H1Z2Z2-K
    (jjlapp_comp.supplier_model LIKE '%H1Z2Z2-K%' AND curr_comp.supplier_model LIKE '%H1Z2Z2-K%')
  )

WHERE qli.quote_id = '92791880-c905-4deb-8b5a-d0e4bf9771a2'

ORDER BY curr_comp.supplier_model;


-- ============================================================================
-- STEP 4: EXECUTE - Update to JJLAPP branded components
-- ============================================================================

BEGIN;

UPDATE "4.1_price_quote_line_items" qli
SET
  component_id = jjlapp_comp.component_id,
  updated_at = NOW()
FROM "3.0_components" curr_comp,
"3.0_components" jjlapp_comp
WHERE qli.component_id = curr_comp.component_id
  AND qli.quote_id = '92791880-c905-4deb-8b5a-d0e4bf9771a2'
  AND jjlapp_comp.brand = 'JJLAPP'
  AND (
    -- Match by base supplier_model after stripping brand prefix
    SUBSTRING(jjlapp_comp.supplier_model FROM POSITION(' ' IN jjlapp_comp.supplier_model) + 1) =
    SUBSTRING(curr_comp.supplier_model FROM POSITION(' ' IN curr_comp.supplier_model) + 1)
    OR
    -- Fallback: if both contain H1Z2Z2-K
    (jjlapp_comp.supplier_model LIKE '%H1Z2Z2-K%' AND curr_comp.supplier_model LIKE '%H1Z2Z2-K%')
  )
  AND qli.component_id != jjlapp_comp.component_id; -- Only update if different

-- Show what was updated
SELECT
  COUNT(*) AS line_items_updated
FROM "4.1_price_quote_line_items"
WHERE quote_id = '92791880-c905-4deb-8b5a-d0e4bf9771a2'
  AND updated_at > NOW() - INTERVAL '1 minute';

COMMIT;
-- Or ROLLBACK if something looks wrong


-- ============================================================================
-- STEP 5: VERIFY - Check all line items now use JJLAPP
-- ============================================================================

SELECT
  q.quote_id,
  q.pi_number,
  s.supplier_name,

  qli.component_id,
  c.brand,
  c.supplier_model,
  c.internal_description,

  qli.quantity,
  qli.unit_price

FROM "4.0_price_quotes" q
LEFT JOIN "2.0_suppliers" s ON q.supplier_id = s.supplier_id
INNER JOIN "4.1_price_quote_line_items" qli ON q.quote_id = qli.quote_id
INNER JOIN "3.0_components" c ON qli.component_id = c.component_id

WHERE q.quote_id = '92791880-c905-4deb-8b5a-d0e4bf9771a2'

ORDER BY c.supplier_model;


-- ============================================================================
-- STEP 6: VALIDATION - Ensure all are JJLAPP (should return 0 rows)
-- ============================================================================

SELECT
  qli.component_id,
  c.brand,
  c.supplier_model,
  'Should be JJLAPP!' AS issue
FROM "4.1_price_quote_line_items" qli
INNER JOIN "3.0_components" c ON qli.component_id = c.component_id
WHERE qli.quote_id = '92791880-c905-4deb-8b5a-d0e4bf9771a2'
  AND c.brand != 'JJLAPP';

-- If this returns any rows, some components are not JJLAPP!

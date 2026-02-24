-- ============================================================================
-- UPDATE PT TRISINDO SOLAR JAYA QUOTES TO USE SUNKEAN COMPONENTS
-- ============================================================================
-- Finds all quotes from PT Trisindo Solar Jaya supplier and updates line items
-- to use SUNKEAN branded components
-- ============================================================================

-- ============================================================================
-- STEP 1: FIND PT TRISINDO SOLAR JAYA SUPPLIER
-- ============================================================================

SELECT
  supplier_id,
  supplier_name,
  supplier_code,
  location
FROM "2.0_suppliers"
WHERE LOWER(supplier_name) LIKE '%trisindo%'
   OR LOWER(supplier_name) LIKE '%solar jaya%'
ORDER BY supplier_name;


-- ============================================================================
-- STEP 2: FIND QUOTES FROM THIS SUPPLIER
-- ============================================================================

SELECT
  q.quote_id,
  q.pi_number,
  q.quote_date,
  q.supplier_id,
  s.supplier_name,
  COUNT(qli.*) AS line_items_count
FROM "4.0_price_quotes" q
LEFT JOIN "2.0_suppliers" s ON q.supplier_id = s.supplier_id
LEFT JOIN "4.1_price_quote_line_items" qli ON q.quote_id = qli.quote_id
WHERE LOWER(s.supplier_name) LIKE '%trisindo%'
   OR LOWER(s.supplier_name) LIKE '%solar jaya%'
GROUP BY q.quote_id, q.pi_number, q.quote_date, q.supplier_id, s.supplier_name
ORDER BY q.quote_date DESC;


-- ============================================================================
-- STEP 3: PREVIEW - See what components will be updated
-- ============================================================================

WITH trisindo_quotes AS (
  SELECT q.quote_id
  FROM "4.0_price_quotes" q
  LEFT JOIN "2.0_suppliers" s ON q.supplier_id = s.supplier_id
  WHERE LOWER(s.supplier_name) LIKE '%trisindo%'
     OR LOWER(s.supplier_name) LIKE '%solar jaya%'
)
SELECT
  q.quote_id,
  q.pi_number,
  s.supplier_name,
  qli.component_id AS current_component_id,
  curr_comp.brand AS current_brand,
  curr_comp.supplier_model AS current_supplier_model,

  -- Find matching SUNKEAN component
  sunkean_comp.component_id AS sunkean_component_id,
  sunkean_comp.supplier_model AS sunkean_supplier_model,

  CASE
    WHEN sunkean_comp.component_id IS NULL THEN '❌ No SUNKEAN match'
    WHEN curr_comp.brand = 'SUNKEAN' THEN '✅ Already SUNKEAN'
    ELSE '🔄 Will update'
  END AS status

FROM "4.0_price_quotes" q
INNER JOIN trisindo_quotes tq ON q.quote_id = tq.quote_id
LEFT JOIN "2.0_suppliers" s ON q.supplier_id = s.supplier_id
INNER JOIN "4.1_price_quote_line_items" qli ON q.quote_id = qli.quote_id
INNER JOIN "3.0_components" curr_comp ON qli.component_id = curr_comp.component_id

-- Find matching SUNKEAN component by stripping brand prefix
LEFT JOIN "3.0_components" sunkean_comp
  ON sunkean_comp.brand = 'SUNKEAN'
  AND (
    -- Match by base supplier_model after stripping brand prefix
    SUBSTRING(sunkean_comp.supplier_model FROM POSITION(' ' IN sunkean_comp.supplier_model) + 1) =
    SUBSTRING(curr_comp.supplier_model FROM POSITION(' ' IN curr_comp.supplier_model) + 1)
    OR
    -- Fallback match
    sunkean_comp.supplier_model LIKE '%' ||
      SUBSTRING(curr_comp.supplier_model FROM POSITION(' ' IN curr_comp.supplier_model) + 1)
  )

ORDER BY q.quote_id, curr_comp.supplier_model;


-- ============================================================================
-- STEP 4: EXECUTE - Update to SUNKEAN components (Run in transaction)
-- ============================================================================

BEGIN;

WITH trisindo_quotes AS (
  SELECT q.quote_id
  FROM "4.0_price_quotes" q
  LEFT JOIN "2.0_suppliers" s ON q.supplier_id = s.supplier_id
  WHERE LOWER(s.supplier_name) LIKE '%trisindo%'
     OR LOWER(s.supplier_name) LIKE '%solar jaya%'
)
UPDATE "4.1_price_quote_line_items" qli
SET
  component_id = sunkean_comp.component_id,
  updated_at = NOW()
FROM trisindo_quotes tq,
"3.0_components" curr_comp,
"3.0_components" sunkean_comp
WHERE qli.quote_id = tq.quote_id
  AND qli.component_id = curr_comp.component_id
  AND sunkean_comp.brand = 'SUNKEAN'
  AND (
    -- Match by base supplier_model after stripping brand prefix
    SUBSTRING(sunkean_comp.supplier_model FROM POSITION(' ' IN sunkean_comp.supplier_model) + 1) =
    SUBSTRING(curr_comp.supplier_model FROM POSITION(' ' IN curr_comp.supplier_model) + 1)
    OR
    -- Fallback match
    sunkean_comp.supplier_model LIKE '%' ||
      SUBSTRING(curr_comp.supplier_model FROM POSITION(' ' IN curr_comp.supplier_model) + 1)
  )
  AND qli.component_id != sunkean_comp.component_id; -- Only update if different

-- Show what was updated
SELECT
  COUNT(*) AS line_items_updated
FROM "4.1_price_quote_line_items" qli
WHERE qli.updated_at > NOW() - INTERVAL '1 minute';

COMMIT;
-- Or ROLLBACK if something looks wrong


-- ============================================================================
-- STEP 5: VERIFY - Check all Trisindo quotes now use SUNKEAN
-- ============================================================================

WITH trisindo_quotes AS (
  SELECT q.quote_id
  FROM "4.0_price_quotes" q
  LEFT JOIN "2.0_suppliers" s ON q.supplier_id = s.supplier_id
  WHERE LOWER(s.supplier_name) LIKE '%trisindo%'
     OR LOWER(s.supplier_name) LIKE '%solar jaya%'
)
SELECT
  q.quote_id,
  q.pi_number,
  s.supplier_name,
  c.brand,
  c.supplier_model,
  COUNT(*) AS line_item_count
FROM "4.0_price_quotes" q
INNER JOIN trisindo_quotes tq ON q.quote_id = tq.quote_id
LEFT JOIN "2.0_suppliers" s ON q.supplier_id = s.supplier_id
INNER JOIN "4.1_price_quote_line_items" qli ON q.quote_id = qli.quote_id
INNER JOIN "3.0_components" c ON qli.component_id = c.component_id
GROUP BY q.quote_id, q.pi_number, s.supplier_name, c.brand, c.supplier_model
ORDER BY q.quote_id, c.brand;


-- ============================================================================
-- STEP 6: VALIDATION - Ensure all are SUNKEAN (should return 0 rows)
-- ============================================================================

WITH trisindo_quotes AS (
  SELECT q.quote_id
  FROM "4.0_price_quotes" q
  LEFT JOIN "2.0_suppliers" s ON q.supplier_id = s.supplier_id
  WHERE LOWER(s.supplier_name) LIKE '%trisindo%'
     OR LOWER(s.supplier_name) LIKE '%solar jaya%'
)
SELECT
  q.quote_id,
  q.pi_number,
  c.component_id,
  c.brand,
  'Should be SUNKEAN!' AS issue
FROM "4.0_price_quotes" q
INNER JOIN trisindo_quotes tq ON q.quote_id = tq.quote_id
INNER JOIN "4.1_price_quote_line_items" qli ON q.quote_id = qli.quote_id
INNER JOIN "3.0_components" c ON qli.component_id = c.component_id
WHERE c.brand != 'SUNKEAN';

-- If this returns any rows, some components are not SUNKEAN!

-- ============================================================================
-- DUPLICATE COMPONENTS BY SPECIFIC QUOTES (UNIQUE ONLY)
-- ============================================================================
-- Purpose: Duplicate components from specific quotes with new brand names
--          ENSURES ONLY ONE COMPONENT PER UNIQUE SUPPLIER_MODEL
-- ============================================================================

-- Target quotes:
-- JEMBO: quote_id = 6cab564d-6c75-425d-9922-edf6b21e6548
-- SUPREME: quote_ids = e7d4e2d9-aa7f-43fe-bdf5-a32188b40b75,
--                      9b9e0a6e-3922-4524-87cb-46fe0e13cbb9,
--                      4249859c-2bca-450b-b506-ac41db29d0b6,
--                      614cb9d3-4fcf-4b1a-ba4f-3de2801da2d5

-- ============================================================================
-- STEP 1A: PREVIEW - See all line items from these specific quotes
-- ============================================================================

SELECT
  q.quote_id,
  q.pi_number,
  q.supplier_id,
  CASE
    WHEN q.quote_id = '6cab564d-6c75-425d-9922-edf6b21e6548' THEN 'JEMBO'
    WHEN q.quote_id IN (
      'e7d4e2d9-aa7f-43fe-bdf5-a32188b40b75',
      '9b9e0a6e-3922-4524-87cb-46fe0e13cbb9',
      '4249859c-2bca-450b-b506-ac41db29d0b6',
      '614cb9d3-4fcf-4b1a-ba4f-3de2801da2d5'
    ) THEN 'SUPREME'
  END AS target_brand,

  qli.component_id,
  c.supplier_model,
  c.brand AS current_brand,
  c.internal_description,

  qli.quantity,
  qli.unit_price

FROM "4.0_price_quotes" q

INNER JOIN "4.1_price_quote_line_items" qli
  ON q.quote_id = qli.quote_id

INNER JOIN "3.0_components" c
  ON qli.component_id = c.component_id

WHERE q.quote_id IN (
  '6cab564d-6c75-425d-9922-edf6b21e6548',  -- JEMBO
  'e7d4e2d9-aa7f-43fe-bdf5-a32188b40b75',  -- SUPREME
  '9b9e0a6e-3922-4524-87cb-46fe0e13cbb9',  -- SUPREME
  '4249859c-2bca-450b-b506-ac41db29d0b6',  -- SUPREME
  '614cb9d3-4fcf-4b1a-ba4f-3de2801da2d5'   -- SUPREME
)

ORDER BY q.quote_id, c.supplier_model;


-- ============================================================================
-- STEP 1B: PREVIEW - See UNIQUE components that will be duplicated
-- ============================================================================

WITH unique_components AS (
  SELECT DISTINCT
    c.component_id,
    c.supplier_model,
    c.internal_description,
    c.brand AS current_brand,
    c.category,
    CASE
      WHEN q.quote_id = '6cab564d-6c75-425d-9922-edf6b21e6548' THEN 'JEMBO'
      WHEN q.quote_id IN (
        'e7d4e2d9-aa7f-43fe-bdf5-a32188b40b75',
        '9b9e0a6e-3922-4524-87cb-46fe0e13cbb9',
        '4249859c-2bca-450b-b506-ac41db29d0b6',
        '614cb9d3-4fcf-4b1a-ba4f-3de2801da2d5'
      ) THEN 'SUPREME'
    END AS target_brand
  FROM "3.0_components" c
  INNER JOIN "4.1_price_quote_line_items" qli
    ON c.component_id = qli.component_id
  INNER JOIN "4.0_price_quotes" q
    ON qli.quote_id = q.quote_id
  WHERE q.quote_id IN (
    '6cab564d-6c75-425d-9922-edf6b21e6548',
    'e7d4e2d9-aa7f-43fe-bdf5-a32188b40b75',
    '9b9e0a6e-3922-4524-87cb-46fe0e13cbb9',
    '4249859c-2bca-450b-b506-ac41db29d0b6',
    '614cb9d3-4fcf-4b1a-ba4f-3de2801da2d5'
  )
)
SELECT
  target_brand,
  supplier_model,
  current_brand,
  internal_description,
  category
FROM unique_components
ORDER BY target_brand, supplier_model;


-- ============================================================================
-- STEP 1C: COUNT - How many unique components per brand
-- ============================================================================

WITH unique_components AS (
  SELECT DISTINCT
    c.supplier_model,
    CASE
      WHEN q.quote_id = '6cab564d-6c75-425d-9922-edf6b21e6548' THEN 'JEMBO'
      WHEN q.quote_id IN (
        'e7d4e2d9-aa7f-43fe-bdf5-a32188b40b75',
        '9b9e0a6e-3922-4524-87cb-46fe0e13cbb9',
        '4249859c-2bca-450b-b506-ac41db29d0b6',
        '614cb9d3-4fcf-4b1a-ba4f-3de2801da2d5'
      ) THEN 'SUPREME'
    END AS target_brand
  FROM "3.0_components" c
  INNER JOIN "4.1_price_quote_line_items" qli
    ON c.component_id = qli.component_id
  INNER JOIN "4.0_price_quotes" q
    ON qli.quote_id = q.quote_id
  WHERE q.quote_id IN (
    '6cab564d-6c75-425d-9922-edf6b21e6548',
    'e7d4e2d9-aa7f-43fe-bdf5-a32188b40b75',
    '9b9e0a6e-3922-4524-87cb-46fe0e13cbb9',
    '4249859c-2bca-450b-b506-ac41db29d0b6',
    '614cb9d3-4fcf-4b1a-ba4f-3de2801da2d5'
  )
)
SELECT
  target_brand,
  COUNT(DISTINCT supplier_model) AS unique_components_to_create
FROM unique_components
GROUP BY target_brand;


-- ============================================================================
-- STEP 2: CREATE UNIQUE DUPLICATES (Run this in a transaction)
-- ============================================================================

BEGIN;

-- Insert duplicates for JEMBO (from quote 6cab564d-6c75-425d-9922-edf6b21e6548)
INSERT INTO "3.0_components" (
  component_id,
  supplier_model,
  internal_description,
  brand,
  category,
  updated_at
)
SELECT DISTINCT ON (c.supplier_model)
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
WHERE q.quote_id = '6cab564d-6c75-425d-9922-edf6b21e6548'
  AND NOT EXISTS (
    SELECT 1
    FROM "3.0_components" existing
    WHERE existing.supplier_model = c.supplier_model
      AND existing.brand = 'JEMBO'
  )
ORDER BY c.supplier_model, c.component_id;


-- Insert duplicates for SUPREME (from quotes e7d4e2d9..., 9b9e0a6e..., etc.)
INSERT INTO "3.0_components" (
  component_id,
  supplier_model,
  internal_description,
  brand,
  category,
  updated_at
)
SELECT DISTINCT ON (c.supplier_model)
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
WHERE q.quote_id IN (
  'e7d4e2d9-aa7f-43fe-bdf5-a32188b40b75',
  '9b9e0a6e-3922-4524-87cb-46fe0e13cbb9',
  '4249859c-2bca-450b-b506-ac41db29d0b6',
  '614cb9d3-4fcf-4b1a-ba4f-3de2801da2d5'
)
  AND NOT EXISTS (
    SELECT 1
    FROM "3.0_components" existing
    WHERE existing.supplier_model = c.supplier_model
      AND existing.brand = 'SUPREME'
  )
ORDER BY c.supplier_model, c.component_id;


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

SELECT
  supplier_model,
  brand,
  COUNT(*) AS duplicate_count,
  array_agg(component_id) AS component_ids
FROM "3.0_components"
WHERE brand IN ('JEMBO', 'SUPREME')
GROUP BY supplier_model, brand
HAVING COUNT(*) > 1;

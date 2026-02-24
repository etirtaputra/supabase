-- ============================================================================
-- DIAGNOSTIC: What's actually in these specific quotes?
-- ============================================================================

-- ============================================================================
-- STEP 1: Show ALL components in the JEMBO quote
-- ============================================================================

SELECT
  q.quote_id,
  q.pi_number,
  qli.component_id,
  c.supplier_model,
  c.brand AS current_brand,
  c.internal_description,
  qli.quantity
FROM "4.0_price_quotes" q
INNER JOIN "4.1_price_quote_line_items" qli ON q.quote_id = qli.quote_id
INNER JOIN "3.0_components" c ON qli.component_id = c.component_id
WHERE q.quote_id = '6cab564d-6c75-425d-9922-edf6b21e6548'
ORDER BY c.supplier_model;

-- Count
SELECT
  'JEMBO Quote' AS quote_type,
  COUNT(*) AS total_line_items,
  COUNT(DISTINCT c.component_id) AS unique_components,
  COUNT(DISTINCT c.supplier_model) AS unique_supplier_models
FROM "4.0_price_quotes" q
INNER JOIN "4.1_price_quote_line_items" qli ON q.quote_id = qli.quote_id
INNER JOIN "3.0_components" c ON qli.component_id = c.component_id
WHERE q.quote_id = '6cab564d-6c75-425d-9922-edf6b21e6548';


-- ============================================================================
-- STEP 2: Show ALL components in the SUPREME quotes
-- ============================================================================

SELECT
  q.quote_id,
  q.pi_number,
  qli.component_id,
  c.supplier_model,
  c.brand AS current_brand,
  c.internal_description,
  qli.quantity
FROM "4.0_price_quotes" q
INNER JOIN "4.1_price_quote_line_items" qli ON q.quote_id = qli.quote_id
INNER JOIN "3.0_components" c ON qli.component_id = c.component_id
WHERE q.quote_id IN (
  'e7d4e2d9-aa7f-43fe-bdf5-a32188b40b75',
  '9b9e0a6e-3922-4524-87cb-46fe0e13cbb9',
  '4249859c-2bca-450b-b506-ac41db29d0b6',
  '614cb9d3-4fcf-4b1a-ba4f-3de2801da2d5'
)
ORDER BY q.quote_id, c.supplier_model;

-- Count
SELECT
  'SUPREME Quotes' AS quote_type,
  COUNT(*) AS total_line_items,
  COUNT(DISTINCT c.component_id) AS unique_components,
  COUNT(DISTINCT c.supplier_model) AS unique_supplier_models
FROM "4.0_price_quotes" q
INNER JOIN "4.1_price_quote_line_items" qli ON q.quote_id = qli.quote_id
INNER JOIN "3.0_components" c ON qli.component_id = c.component_id
WHERE q.quote_id IN (
  'e7d4e2d9-aa7f-43fe-bdf5-a32188b40b75',
  '9b9e0a6e-3922-4524-87cb-46fe0e13cbb9',
  '4249859c-2bca-450b-b506-ac41db29d0b6',
  '614cb9d3-4fcf-4b1a-ba4f-3de2801da2d5'
);


-- ============================================================================
-- STEP 3: Check if components already have JEMBO/SUPREME brand
-- ============================================================================

SELECT
  c.brand,
  COUNT(DISTINCT c.component_id) AS components_with_this_brand,
  COUNT(DISTINCT c.supplier_model) AS unique_supplier_models
FROM "4.0_price_quotes" q
INNER JOIN "4.1_price_quote_line_items" qli ON q.quote_id = qli.quote_id
INNER JOIN "3.0_components" c ON qli.component_id = c.component_id
WHERE q.quote_id IN (
  '6cab564d-6c75-425d-9922-edf6b21e6548',
  'e7d4e2d9-aa7f-43fe-bdf5-a32188b40b75',
  '9b9e0a6e-3922-4524-87cb-46fe0e13cbb9',
  '4249859c-2bca-450b-b506-ac41db29d0b6',
  '614cb9d3-4fcf-4b1a-ba4f-3de2801da2d5'
)
GROUP BY c.brand
ORDER BY COUNT(*) DESC;


-- ============================================================================
-- STEP 4: Check if JEMBO/SUPREME components already exist
-- ============================================================================

-- For JEMBO quote - how many components already have JEMBO brand?
SELECT
  'Components in JEMBO quote that already have JEMBO brand' AS status,
  COUNT(DISTINCT c.supplier_model) AS count
FROM "4.0_price_quotes" q
INNER JOIN "4.1_price_quote_line_items" qli ON q.quote_id = qli.quote_id
INNER JOIN "3.0_components" c ON qli.component_id = c.component_id
WHERE q.quote_id = '6cab564d-6c75-425d-9922-edf6b21e6548'
  AND c.brand = 'JEMBO';

-- For SUPREME quotes - how many components already have SUPREME brand?
SELECT
  'Components in SUPREME quotes that already have SUPREME brand' AS status,
  COUNT(DISTINCT c.supplier_model) AS count
FROM "4.0_price_quotes" q
INNER JOIN "4.1_price_quote_line_items" qli ON q.quote_id = qli.quote_id
INNER JOIN "3.0_components" c ON qli.component_id = c.component_id
WHERE q.quote_id IN (
  'e7d4e2d9-aa7f-43fe-bdf5-a32188b40b75',
  '9b9e0a6e-3922-4524-87cb-46fe0e13cbb9',
  '4249859c-2bca-450b-b506-ac41db29d0b6',
  '614cb9d3-4fcf-4b1a-ba4f-3de2801da2d5'
)
  AND c.brand = 'SUPREME';


-- ============================================================================
-- STEP 5: Verify the quote_ids are correct
-- ============================================================================

SELECT
  quote_id,
  pi_number,
  supplier_id,
  quote_date,
  status
FROM "4.0_price_quotes"
WHERE quote_id IN (
  '6cab564d-6c75-425d-9922-edf6b21e6548',
  'e7d4e2d9-aa7f-43fe-bdf5-a32188b40b75',
  '9b9e0a6e-3922-4524-87cb-46fe0e13cbb9',
  '4249859c-2bca-450b-b506-ac41db29d0b6',
  '614cb9d3-4fcf-4b1a-ba4f-3de2801da2d5'
);


-- ============================================================================
-- STEP 6: Show unique supplier_models that DON'T have JEMBO/SUPREME brand yet
-- ============================================================================

-- From JEMBO quote
SELECT DISTINCT
  c.supplier_model,
  c.brand AS current_brand,
  'Should create JEMBO version' AS action
FROM "4.0_price_quotes" q
INNER JOIN "4.1_price_quote_line_items" qli ON q.quote_id = qli.quote_id
INNER JOIN "3.0_components" c ON qli.component_id = c.component_id
WHERE q.quote_id = '6cab564d-6c75-425d-9922-edf6b21e6548'
  AND NOT EXISTS (
    SELECT 1 FROM "3.0_components" existing
    WHERE existing.supplier_model = c.supplier_model
      AND existing.brand = 'JEMBO'
  )
ORDER BY c.supplier_model;

-- From SUPREME quotes
SELECT DISTINCT
  c.supplier_model,
  c.brand AS current_brand,
  'Should create SUPREME version' AS action
FROM "4.0_price_quotes" q
INNER JOIN "4.1_price_quote_line_items" qli ON q.quote_id = qli.quote_id
INNER JOIN "3.0_components" c ON qli.component_id = c.component_id
WHERE q.quote_id IN (
  'e7d4e2d9-aa7f-43fe-bdf5-a32188b40b75',
  '9b9e0a6e-3922-4524-87cb-46fe0e13cbb9',
  '4249859c-2bca-450b-b506-ac41db29d0b6',
  '614cb9d3-4fcf-4b1a-ba4f-3de2801da2d5'
)
  AND NOT EXISTS (
    SELECT 1 FROM "3.0_components" existing
    WHERE existing.supplier_model = c.supplier_model
      AND existing.brand = 'SUPREME'
  )
ORDER BY c.supplier_model;

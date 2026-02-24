-- ============================================================================
-- UPDATE QUOTE LINE ITEMS TO USE JEMBO AND SUPREME COMPONENTS
-- ============================================================================
-- Reassigns component_ids in quote line items to use branded components
-- Matches by stripping brand prefix from supplier_model
-- ============================================================================

-- Target quotes:
-- JEMBO: quote_id = 6cab564d-6c75-425d-9922-edf6b21e6548
-- SUPREME: quote_ids = e7d4e2d9-aa7f-43fe-bdf5-a32188b40b75,
--                      9b9e0a6e-3922-4524-87cb-46fe0e13cbb9,
--                      4249859c-2bca-450b-b506-ac41db29d0b6,
--                      614cb9d3-4fcf-4b1a-ba4f-3de2801da2d5

-- ============================================================================
-- STEP 1: PREVIEW - See what will be updated
-- ============================================================================

WITH line_item_details AS (
  SELECT
    q.quote_id,
    q.pi_number,
    qli.component_id AS current_component_id,

    curr_comp.brand AS current_brand,
    curr_comp.supplier_model AS current_supplier_model,

    -- Strip brand prefix to get base supplier_model
    CASE
      WHEN curr_comp.supplier_model LIKE '% %'
      THEN SUBSTRING(curr_comp.supplier_model FROM POSITION(' ' IN curr_comp.supplier_model) + 1)
      ELSE curr_comp.supplier_model
    END AS base_supplier_model,

    -- Determine target brand based on quote_id
    CASE
      WHEN q.quote_id = '6cab564d-6c75-425d-9922-edf6b21e6548' THEN 'JEMBO'
      WHEN q.quote_id IN (
        'e7d4e2d9-aa7f-43fe-bdf5-a32188b40b75',
        '9b9e0a6e-3922-4524-87cb-46fe0e13cbb9',
        '4249859c-2bca-450b-b506-ac41db29d0b6',
        '614cb9d3-4fcf-4b1a-ba4f-3de2801da2d5'
      ) THEN 'SUPREME'
    END AS target_brand,

    qli.quantity,
    qli.unit_price

  FROM "4.0_price_quotes" q
  INNER JOIN "4.1_price_quote_line_items" qli ON q.quote_id = qli.quote_id
  INNER JOIN "3.0_components" curr_comp ON qli.component_id = curr_comp.component_id

  WHERE q.quote_id IN (
    '6cab564d-6c75-425d-9922-edf6b21e6548',
    'e7d4e2d9-aa7f-43fe-bdf5-a32188b40b75',
    '9b9e0a6e-3922-4524-87cb-46fe0e13cbb9',
    '4249859c-2bca-450b-b506-ac41db29d0b6',
    '614cb9d3-4fcf-4b1a-ba4f-3de2801da2d5'
  )
)
SELECT
  li.quote_id,
  li.pi_number,
  li.current_component_id,
  li.current_brand,
  li.current_supplier_model,
  li.target_brand,

  -- Find the new component with target brand
  new_comp.component_id AS new_component_id,
  new_comp.supplier_model AS new_supplier_model,

  CASE
    WHEN new_comp.component_id IS NULL THEN '❌ No match found'
    WHEN li.current_component_id = new_comp.component_id THEN '✅ Already correct'
    ELSE '🔄 Will update'
  END AS status

FROM line_item_details li

-- Find matching component with target brand
-- Match by: target_brand + base_supplier_model
LEFT JOIN "3.0_components" new_comp
  ON new_comp.brand = li.target_brand
  AND (
    -- Match if supplier_model ends with the base model
    new_comp.supplier_model LIKE '%' || li.base_supplier_model
    -- Or if stripping brand prefix matches
    OR SUBSTRING(new_comp.supplier_model FROM POSITION(' ' IN new_comp.supplier_model) + 1) = li.base_supplier_model
  )

ORDER BY li.quote_id, li.current_component_id;


-- ============================================================================
-- STEP 2: COUNT - How many line items will be updated
-- ============================================================================

SELECT
  q.quote_id,
  q.pi_number,
  CASE
    WHEN q.quote_id = '6cab564d-6c75-425d-9922-edf6b21e6548' THEN 'JEMBO'
    WHEN q.quote_id IN (
      'e7d4e2d9-aa7f-43fe-bdf5-a32188b40b75',
      '9b9e0a6e-3922-4524-87cb-46fe0e13cbb9',
      '4249859c-2bca-450b-b506-ac41db29d0b6',
      '614cb9d3-4fcf-4b1a-ba4f-3de2801da2d5'
    ) THEN 'SUPREME'
  END AS target_brand,
  COUNT(*) AS total_line_items
FROM "4.0_price_quotes" q
INNER JOIN "4.1_price_quote_line_items" qli ON q.quote_id = qli.quote_id
WHERE q.quote_id IN (
  '6cab564d-6c75-425d-9922-edf6b21e6548',
  'e7d4e2d9-aa7f-43fe-bdf5-a32188b40b75',
  '9b9e0a6e-3922-4524-87cb-46fe0e13cbb9',
  '4249859c-2bca-450b-b506-ac41db29d0b6',
  '614cb9d3-4fcf-4b1a-ba4f-3de2801da2d5'
)
GROUP BY q.quote_id, q.pi_number;


-- ============================================================================
-- STEP 3: EXECUTE - Update the component_ids (Run in transaction!)
-- ============================================================================

BEGIN;

-- Update line items for JEMBO quote
UPDATE "4.1_price_quote_line_items" qli
SET
  component_id = new_comp.component_id,
  updated_at = NOW()
FROM "4.0_price_quotes" q,
"3.0_components" curr_comp,
"3.0_components" new_comp
WHERE qli.quote_id = q.quote_id
  AND qli.component_id = curr_comp.component_id
  AND q.quote_id = '6cab564d-6c75-425d-9922-edf6b21e6548'
  AND new_comp.brand = 'JEMBO'
  AND (
    -- Match by base supplier_model after stripping brand prefix
    SUBSTRING(new_comp.supplier_model FROM POSITION(' ' IN new_comp.supplier_model) + 1) =
    SUBSTRING(curr_comp.supplier_model FROM POSITION(' ' IN curr_comp.supplier_model) + 1)
    OR
    -- Fallback: match if supplier_model contains the base model
    new_comp.supplier_model LIKE '%' ||
      SUBSTRING(curr_comp.supplier_model FROM POSITION(' ' IN curr_comp.supplier_model) + 1)
  )
  AND qli.component_id != new_comp.component_id; -- Only update if different


-- Update line items for SUPREME quotes
UPDATE "4.1_price_quote_line_items" qli
SET
  component_id = new_comp.component_id,
  updated_at = NOW()
FROM "4.0_price_quotes" q,
"3.0_components" curr_comp,
"3.0_components" new_comp
WHERE qli.quote_id = q.quote_id
  AND qli.component_id = curr_comp.component_id
  AND q.quote_id IN (
    'e7d4e2d9-aa7f-43fe-bdf5-a32188b40b75',
    '9b9e0a6e-3922-4524-87cb-46fe0e13cbb9',
    '4249859c-2bca-450b-b506-ac41db29d0b6',
    '614cb9d3-4fcf-4b1a-ba4f-3de2801da2d5'
  )
  AND new_comp.brand = 'SUPREME'
  AND (
    -- Match by base supplier_model after stripping brand prefix
    SUBSTRING(new_comp.supplier_model FROM POSITION(' ' IN new_comp.supplier_model) + 1) =
    SUBSTRING(curr_comp.supplier_model FROM POSITION(' ' IN curr_comp.supplier_model) + 1)
    OR
    -- Fallback: match if supplier_model contains the base model
    new_comp.supplier_model LIKE '%' ||
      SUBSTRING(curr_comp.supplier_model FROM POSITION(' ' IN curr_comp.supplier_model) + 1)
  )
  AND qli.component_id != new_comp.component_id; -- Only update if different


-- Show what was updated
SELECT
  q.quote_id,
  q.pi_number,
  COUNT(*) AS line_items_updated,
  CASE
    WHEN q.quote_id = '6cab564d-6c75-425d-9922-edf6b21e6548' THEN 'JEMBO'
    ELSE 'SUPREME'
  END AS target_brand
FROM "4.1_price_quote_line_items" qli
INNER JOIN "4.0_price_quotes" q ON qli.quote_id = q.quote_id
WHERE qli.updated_at > NOW() - INTERVAL '1 minute'
  AND q.quote_id IN (
    '6cab564d-6c75-425d-9922-edf6b21e6548',
    'e7d4e2d9-aa7f-43fe-bdf5-a32188b40b75',
    '9b9e0a6e-3922-4524-87cb-46fe0e13cbb9',
    '4249859c-2bca-450b-b506-ac41db29d0b6',
    '614cb9d3-4fcf-4b1a-ba4f-3de2801da2d5'
  )
GROUP BY q.quote_id, q.pi_number;

-- If everything looks good:
COMMIT;

-- If something looks wrong:
-- ROLLBACK;


-- ============================================================================
-- STEP 4: VERIFY - Check that all line items now use correct brands
-- ============================================================================

SELECT
  q.quote_id,
  q.pi_number,
  qli.component_id,
  c.brand,
  c.supplier_model,
  qli.quantity,
  qli.unit_price
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
ORDER BY q.quote_id, c.supplier_model;


-- ============================================================================
-- STEP 5: VALIDATION - Ensure brands match expected values
-- ============================================================================

-- This should return 0 rows if everything is correct
SELECT
  q.quote_id,
  q.pi_number,
  c.component_id,
  c.brand,
  'Should be JEMBO!' AS issue
FROM "4.0_price_quotes" q
INNER JOIN "4.1_price_quote_line_items" qli ON q.quote_id = qli.quote_id
INNER JOIN "3.0_components" c ON qli.component_id = c.component_id
WHERE q.quote_id = '6cab564d-6c75-425d-9922-edf6b21e6548'
  AND c.brand != 'JEMBO'

UNION ALL

SELECT
  q.quote_id,
  q.pi_number,
  c.component_id,
  c.brand,
  'Should be SUPREME!' AS issue
FROM "4.0_price_quotes" q
INNER JOIN "4.1_price_quote_line_items" qli ON q.quote_id = qli.quote_id
INNER JOIN "3.0_components" c ON qli.component_id = c.component_id
WHERE q.quote_id IN (
  'e7d4e2d9-aa7f-43fe-bdf5-a32188b40b75',
  '9b9e0a6e-3922-4524-87cb-46fe0e13cbb9',
  '4249859c-2bca-450b-b506-ac41db29d0b6',
  '614cb9d3-4fcf-4b1a-ba4f-3de2801da2d5'
)
  AND c.brand != 'SUPREME';

-- If this returns any rows, there's a mismatch!

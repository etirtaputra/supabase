-- ============================================================================
-- DIAGNOSTIC: Find all quote line items and check if they have new components
-- ============================================================================
-- This will help identify why some line items aren't being updated

-- ============================================================================
-- STEP 1: See ALL quote line items for these suppliers
-- ============================================================================

SELECT
  q.quote_id,
  q.pi_number,
  q.supplier_id,
  s.supplier_name,

  CASE
    WHEN q.supplier_id = 'c09289fe-7601-4b5d-84d2-be64f1c9f9f2' THEN 'JEMBO'
    WHEN q.supplier_id = 'b0c03580-f471-4637-bc33-d094781c98d5' THEN 'SUPREME'
  END AS expected_brand,

  qli.component_id AS current_component_id,
  c.supplier_model,
  c.brand AS current_brand,

  -- Check if a new component exists
  new_comp.component_id AS new_component_exists,
  new_comp.brand AS new_component_brand,

  -- Status
  CASE
    WHEN new_comp.component_id IS NULL THEN '❌ NO MATCH - New component not found'
    WHEN c.brand = new_comp.brand THEN '✅ ALREADY CORRECT BRAND'
    ELSE '🔄 READY TO UPDATE'
  END AS status

FROM "4.0_price_quotes" q

INNER JOIN "4.1_price_quote_line_items" qli
  ON q.quote_id = qli.quote_id

INNER JOIN "3.0_components" c
  ON qli.component_id = c.component_id

-- LEFT JOIN to find new component (LEFT so we can see missing ones)
LEFT JOIN "3.0_components" new_comp
  ON c.supplier_model = new_comp.supplier_model
  AND new_comp.brand = CASE
    WHEN q.supplier_id = 'c09289fe-7601-4b5d-84d2-be64f1c9f9f2' THEN 'JEMBO'
    WHEN q.supplier_id = 'b0c03580-f471-4637-bc33-d094781c98d5' THEN 'SUPREME'
  END

LEFT JOIN "2.0_suppliers" s
  ON q.supplier_id = s.supplier_id

WHERE q.supplier_id IN (
  'c09289fe-7601-4b5d-84d2-be64f1c9f9f2',  -- JEMBO
  'b0c03580-f471-4637-bc33-d094781c98d5'   -- SUPREME
)

ORDER BY
  q.supplier_id,
  CASE
    WHEN new_comp.component_id IS NULL THEN 0  -- Show missing ones first
    ELSE 1
  END,
  q.pi_number;


-- ============================================================================
-- STEP 2: Summary - How many are ready vs. missing
-- ============================================================================

SELECT
  q.supplier_id,
  s.supplier_name,
  CASE
    WHEN q.supplier_id = 'c09289fe-7601-4b5d-84d2-be64f1c9f9f2' THEN 'JEMBO'
    WHEN q.supplier_id = 'b0c03580-f471-4637-bc33-d094781c98d5' THEN 'SUPREME'
  END AS expected_brand,

  COUNT(*) AS total_line_items,

  COUNT(CASE WHEN new_comp.component_id IS NULL THEN 1 END) AS missing_new_components,
  COUNT(CASE WHEN c.brand = new_comp.brand THEN 1 END) AS already_correct_brand,
  COUNT(CASE WHEN new_comp.component_id IS NOT NULL AND c.brand != new_comp.brand THEN 1 END) AS ready_to_update,

  COUNT(DISTINCT c.component_id) AS unique_current_components,
  COUNT(DISTINCT c.supplier_model) AS unique_supplier_models

FROM "4.0_price_quotes" q

INNER JOIN "4.1_price_quote_line_items" qli
  ON q.quote_id = qli.quote_id

INNER JOIN "3.0_components" c
  ON qli.component_id = c.component_id

LEFT JOIN "3.0_components" new_comp
  ON c.supplier_model = new_comp.supplier_model
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
-- STEP 3: Show which supplier_models are missing new components
-- ============================================================================

SELECT DISTINCT
  q.supplier_id,
  CASE
    WHEN q.supplier_id = 'c09289fe-7601-4b5d-84d2-be64f1c9f9f2' THEN 'JEMBO'
    WHEN q.supplier_id = 'b0c03580-f471-4637-bc33-d094781c98d5' THEN 'SUPREME'
  END AS expected_brand,

  c.supplier_model,
  c.brand AS current_brand,
  COUNT(*) AS times_used_in_quotes,

  'Missing new component!' AS issue

FROM "4.0_price_quotes" q

INNER JOIN "4.1_price_quote_line_items" qli
  ON q.quote_id = qli.quote_id

INNER JOIN "3.0_components" c
  ON qli.component_id = c.component_id

WHERE q.supplier_id IN (
  'c09289fe-7601-4b5d-84d2-be64f1c9f9f2',
  'b0c03580-f471-4637-bc33-d094781c98d5'
)

-- Only show ones where no new component exists
AND NOT EXISTS (
  SELECT 1
  FROM "3.0_components" new_comp
  WHERE new_comp.supplier_model = c.supplier_model
    AND new_comp.brand = CASE
      WHEN q.supplier_id = 'c09289fe-7601-4b5d-84d2-be64f1c9f9f2' THEN 'JEMBO'
      WHEN q.supplier_id = 'b0c03580-f471-4637-bc33-d094781c98d5' THEN 'SUPREME'
    END
)

GROUP BY q.supplier_id, c.supplier_model, c.brand
ORDER BY q.supplier_id, times_used_in_quotes DESC;


-- ============================================================================
-- STEP 4: Check if JEMBO and SUPREME branded components exist at all
-- ============================================================================

SELECT
  brand,
  COUNT(*) AS component_count,
  COUNT(DISTINCT supplier_model) AS unique_supplier_models,
  array_agg(DISTINCT supplier_model ORDER BY supplier_model) AS sample_models

FROM "3.0_components"

WHERE brand IN ('JEMBO', 'SUPREME')

GROUP BY brand;

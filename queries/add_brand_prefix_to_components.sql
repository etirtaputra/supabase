-- ============================================================================
-- ADD BRAND PREFIX TO SUPPLIER_MODEL AND INTERNAL_DESCRIPTION
-- ============================================================================
-- Updates all KMI, JEMBO, and SUPREME components to add [BRAND] prefix
-- Fills in missing supplier_models with internal_description
-- ============================================================================

-- ============================================================================
-- STEP 1: PREVIEW - See what will change
-- ============================================================================

SELECT
  component_id,
  brand,
  supplier_model AS current_supplier_model,
  CASE
    WHEN supplier_model IS NULL THEN brand || ' ' || COALESCE(internal_description, 'N/A')
    ELSE brand || ' ' || supplier_model
  END AS new_supplier_model,

  internal_description AS current_internal_description,
  brand || ' ' || COALESCE(internal_description, 'N/A') AS new_internal_description,

  CASE
    WHEN supplier_model IS NULL THEN 'Will fill from internal_description'
    ELSE 'Will add brand prefix'
  END AS change_type

FROM "3.0_components"
WHERE brand IN ('KMI', 'JEMBO', 'SUPREME')
ORDER BY brand, supplier_model NULLS LAST;

-- Count preview
SELECT
  brand,
  COUNT(*) AS total_components,
  COUNT(CASE WHEN supplier_model IS NULL THEN 1 END) AS null_supplier_models,
  COUNT(CASE WHEN supplier_model IS NOT NULL THEN 1 END) AS has_supplier_models
FROM "3.0_components"
WHERE brand IN ('KMI', 'JEMBO', 'SUPREME')
GROUP BY brand;


-- ============================================================================
-- STEP 2: UPDATE - Add brand prefix and fill nulls (Run in transaction)
-- ============================================================================

BEGIN;

-- Update all KMI, JEMBO, and SUPREME components
UPDATE "3.0_components"
SET
  -- Add brand prefix to supplier_model, or fill with internal_description if null
  supplier_model = CASE
    WHEN supplier_model IS NULL THEN brand || ' ' || COALESCE(internal_description, 'N/A')
    ELSE brand || ' ' || supplier_model
  END,

  -- Add brand prefix to internal_description
  internal_description = brand || ' ' || COALESCE(internal_description, 'N/A'),

  updated_at = NOW()

WHERE brand IN ('KMI', 'JEMBO', 'SUPREME')
  -- Only update if not already prefixed (to avoid double prefixing)
  AND (
    supplier_model NOT LIKE brand || ' %'
    OR supplier_model IS NULL
    OR internal_description NOT LIKE brand || ' %'
    OR internal_description IS NULL
  );

-- Show what was updated
SELECT
  brand,
  COUNT(*) AS components_updated
FROM "3.0_components"
WHERE updated_at > NOW() - INTERVAL '1 minute'
  AND brand IN ('KMI', 'JEMBO', 'SUPREME')
GROUP BY brand;

-- If everything looks good:
COMMIT;

-- If something looks wrong:
-- ROLLBACK;


-- ============================================================================
-- STEP 3: VERIFY - Check the results
-- ============================================================================

SELECT
  component_id,
  brand,
  supplier_model,
  internal_description,
  updated_at
FROM "3.0_components"
WHERE brand IN ('KMI', 'JEMBO', 'SUPREME')
ORDER BY brand, supplier_model;

-- Check for any without prefix (should be 0)
SELECT
  brand,
  COUNT(*) AS missing_prefix_count
FROM "3.0_components"
WHERE brand IN ('KMI', 'JEMBO', 'SUPREME')
  AND (
    supplier_model NOT LIKE brand || ' %'
    OR internal_description NOT LIKE brand || ' %'
  )
GROUP BY brand;

-- Check for any null supplier_models remaining (should be 0)
SELECT
  brand,
  COUNT(CASE WHEN supplier_model IS NULL THEN 1 END) AS null_supplier_models,
  COUNT(CASE WHEN internal_description IS NULL THEN 1 END) AS null_descriptions
FROM "3.0_components"
WHERE brand IN ('KMI', 'JEMBO', 'SUPREME')
GROUP BY brand;


-- ============================================================================
-- STEP 4: SAMPLE CHECK - Show some examples
-- ============================================================================

-- Show 5 examples from each brand
(SELECT * FROM "3.0_components" WHERE brand = 'KMI' LIMIT 5)
UNION ALL
(SELECT * FROM "3.0_components" WHERE brand = 'JEMBO' LIMIT 5)
UNION ALL
(SELECT * FROM "3.0_components" WHERE brand = 'SUPREME' LIMIT 5)
ORDER BY brand;

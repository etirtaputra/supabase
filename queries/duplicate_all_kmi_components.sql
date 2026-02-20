-- ============================================================================
-- DUPLICATE EVERY KMI COMPONENT TO JEMBO AND SUPREME
-- ============================================================================
-- Creates JEMBO and SUPREME version for EACH individual KMI component
-- Works even if supplier_model is null
-- ============================================================================

-- ============================================================================
-- STEP 1: PREVIEW - See all KMI components
-- ============================================================================

SELECT
  component_id,
  supplier_model,
  internal_description,
  brand,
  category
FROM "3.0_components"
WHERE brand = 'KMI'
ORDER BY supplier_model NULLS LAST, component_id;

-- Count
SELECT
  'KMI components to duplicate' AS info,
  COUNT(*) AS total_components,
  COUNT(DISTINCT supplier_model) AS unique_supplier_models,
  COUNT(CASE WHEN supplier_model IS NULL THEN 1 END) AS components_with_null_model
FROM "3.0_components"
WHERE brand = 'KMI';


-- ============================================================================
-- STEP 2: CREATE DUPLICATES - One JEMBO and one SUPREME for EACH KMI component
-- ============================================================================

BEGIN;

-- Create JEMBO version for EACH KMI component
INSERT INTO "3.0_components" (
  component_id,
  supplier_model,
  internal_description,
  brand,
  category,
  updated_at
)
SELECT
  gen_random_uuid() AS component_id,
  supplier_model,  -- Keep same supplier_model (even if null)
  internal_description,
  'JEMBO' AS brand,
  category,
  NOW() AS updated_at
FROM "3.0_components"
WHERE brand = 'KMI';


-- Create SUPREME version for EACH KMI component
INSERT INTO "3.0_components" (
  component_id,
  supplier_model,
  internal_description,
  brand,
  category,
  updated_at
)
SELECT
  gen_random_uuid() AS component_id,
  supplier_model,  -- Keep same supplier_model (even if null)
  internal_description,
  'SUPREME' AS brand,
  category,
  NOW() AS updated_at
FROM "3.0_components"
WHERE brand = 'KMI';


-- Show what was created
SELECT
  brand,
  COUNT(*) AS components_created,
  COUNT(CASE WHEN supplier_model IS NULL THEN 1 END) AS with_null_model,
  COUNT(CASE WHEN supplier_model IS NOT NULL THEN 1 END) AS with_supplier_model
FROM "3.0_components"
WHERE updated_at > NOW() - INTERVAL '1 minute'
  AND brand IN ('JEMBO', 'SUPREME')
GROUP BY brand;

-- If everything looks good:
COMMIT;

-- If something looks wrong:
-- ROLLBACK;


-- ============================================================================
-- STEP 3: VERIFY - Check counts
-- ============================================================================

SELECT
  brand,
  COUNT(*) AS total_components,
  COUNT(DISTINCT supplier_model) AS unique_supplier_models,
  COUNT(CASE WHEN supplier_model IS NULL THEN 1 END) AS null_models
FROM "3.0_components"
WHERE brand IN ('KMI', 'JEMBO', 'SUPREME')
GROUP BY brand
ORDER BY brand;

-- Should show:
-- KMI: 136 components
-- JEMBO: 136 components (same count as KMI)
-- SUPREME: 136 components (same count as KMI)


-- ============================================================================
-- STEP 4: DETAILED VERIFICATION
-- ============================================================================

-- Show counts by supplier_model (including nulls)
SELECT
  COALESCE(supplier_model, 'NULL') AS supplier_model_display,
  COUNT(CASE WHEN brand = 'KMI' THEN 1 END) AS kmi_count,
  COUNT(CASE WHEN brand = 'JEMBO' THEN 1 END) AS jembo_count,
  COUNT(CASE WHEN brand = 'SUPREME' THEN 1 END) AS supreme_count
FROM "3.0_components"
WHERE brand IN ('KMI', 'JEMBO', 'SUPREME')
GROUP BY supplier_model
ORDER BY supplier_model NULLS LAST;

-- Each supplier_model should have equal counts for KMI, JEMBO, and SUPREME

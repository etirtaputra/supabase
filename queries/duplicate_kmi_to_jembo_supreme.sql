-- ============================================================================
-- DUPLICATE ALL KMI COMPONENTS TO JEMBO AND SUPREME
-- ============================================================================
-- Simple approach: Take every KMI component and create JEMBO + SUPREME versions
-- ============================================================================

-- ============================================================================
-- STEP 1: PREVIEW - See all KMI components that will be duplicated
-- ============================================================================

SELECT
  component_id,
  supplier_model,
  internal_description,
  brand,
  category
FROM "3.0_components"
WHERE brand = 'KMI'
ORDER BY supplier_model;

-- Count
SELECT
  'KMI components to duplicate' AS info,
  COUNT(*) AS total_components,
  COUNT(DISTINCT supplier_model) AS unique_supplier_models
FROM "3.0_components"
WHERE brand = 'KMI';


-- ============================================================================
-- STEP 2: CREATE DUPLICATES (Run in transaction)
-- ============================================================================

BEGIN;

-- Create JEMBO versions of all KMI components
-- IMPORTANT: Only ONE per unique supplier_model (even if multiple KMI components share same supplier_model)
INSERT INTO "3.0_components" (
  component_id,
  supplier_model,
  internal_description,
  brand,
  category,
  updated_at
)
SELECT DISTINCT ON (supplier_model)
  gen_random_uuid() AS component_id,
  supplier_model,
  internal_description,
  'JEMBO' AS brand,
  category,
  NOW() AS updated_at
FROM "3.0_components"
WHERE brand = 'KMI'
  -- Skip if JEMBO version already exists with same supplier_model
  AND NOT EXISTS (
    SELECT 1
    FROM "3.0_components" existing
    WHERE existing.supplier_model = "3.0_components".supplier_model
      AND existing.brand = 'JEMBO'
  )
ORDER BY supplier_model, component_id;


-- Create SUPREME versions of all KMI components
-- IMPORTANT: Only ONE per unique supplier_model (even if multiple KMI components share same supplier_model)
INSERT INTO "3.0_components" (
  component_id,
  supplier_model,
  internal_description,
  brand,
  category,
  updated_at
)
SELECT DISTINCT ON (supplier_model)
  gen_random_uuid() AS component_id,
  supplier_model,
  internal_description,
  'SUPREME' AS brand,
  category,
  NOW() AS updated_at
FROM "3.0_components"
WHERE brand = 'KMI'
  -- Skip if SUPREME version already exists with same supplier_model
  AND NOT EXISTS (
    SELECT 1
    FROM "3.0_components" existing
    WHERE existing.supplier_model = "3.0_components".supplier_model
      AND existing.brand = 'SUPREME'
  )
ORDER BY supplier_model, component_id;


-- Show what was created
SELECT
  brand,
  COUNT(*) AS components_created
FROM "3.0_components"
WHERE updated_at > NOW() - INTERVAL '1 minute'
  AND brand IN ('JEMBO', 'SUPREME')
GROUP BY brand;

-- If everything looks good:
COMMIT;

-- If something looks wrong:
-- ROLLBACK;


-- ============================================================================
-- STEP 3: VERIFY - Check all brands now
-- ============================================================================

SELECT
  brand,
  COUNT(*) AS total_components,
  COUNT(DISTINCT supplier_model) AS unique_supplier_models
FROM "3.0_components"
WHERE brand IN ('KMI', 'JEMBO', 'SUPREME')
GROUP BY brand
ORDER BY brand;

-- Detailed view
SELECT
  component_id,
  supplier_model,
  brand,
  internal_description,
  category,
  updated_at
FROM "3.0_components"
WHERE brand IN ('JEMBO', 'SUPREME')
ORDER BY supplier_model, brand;


-- ============================================================================
-- STEP 4: VALIDATION - Check for supplier_model matches
-- ============================================================================

-- For each KMI component, verify JEMBO and SUPREME versions exist
SELECT
  kmi.supplier_model,
  kmi.component_id AS kmi_component_id,
  jembo.component_id AS jembo_component_id,
  supreme.component_id AS supreme_component_id,
  CASE
    WHEN jembo.component_id IS NULL THEN 'Missing JEMBO'
    WHEN supreme.component_id IS NULL THEN 'Missing SUPREME'
    ELSE 'Complete'
  END AS status
FROM "3.0_components" kmi
LEFT JOIN "3.0_components" jembo
  ON kmi.supplier_model = jembo.supplier_model
  AND jembo.brand = 'JEMBO'
LEFT JOIN "3.0_components" supreme
  ON kmi.supplier_model = supreme.supplier_model
  AND supreme.brand = 'SUPREME'
WHERE kmi.brand = 'KMI'
ORDER BY kmi.supplier_model;

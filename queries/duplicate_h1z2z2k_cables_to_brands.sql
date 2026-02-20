-- ============================================================================
-- DUPLICATE H1Z2Z2-K CABLES TO MULTIPLE BRANDS
-- ============================================================================
-- Creates SUNTREE, SLOCABLE, JJLAPP, JEMBO, SUPREME versions of 3 cable components
-- Adds brand prefix to supplier_model and internal_description
-- ============================================================================

-- Component IDs to duplicate:
-- 158be204-ca07-4013-9604-b24d2c157455
-- 6e550bea-e223-481f-a95e-2050c634d7d0
-- 03e730c3-f81b-4204-9356-81f8fa23e058

-- ============================================================================
-- STEP 1: PREVIEW - See current components
-- ============================================================================

SELECT
  component_id,
  supplier_model,
  internal_description,
  brand,
  category,
  updated_at
FROM "3.0_components"
WHERE component_id IN (
  '158be204-ca07-4013-9604-b24d2c157455',
  '6e550bea-e223-481f-a95e-2050c634d7d0',
  '03e730c3-f81b-4204-9356-81f8fa23e058'
)
ORDER BY component_id;


-- ============================================================================
-- STEP 2: CREATE DUPLICATES - One for each brand (Run in transaction)
-- ============================================================================

BEGIN;

-- Create duplicates for all 5 brands
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

  -- Add brand prefix to supplier_model, fill if null
  brands.brand || ' ' || COALESCE(
    NULLIF(TRIM(c.supplier_model), ''),
    COALESCE(NULLIF(TRIM(c.internal_description), ''), 'H1Z2Z2-K Cable')
  ) AS supplier_model,

  -- Add brand prefix to internal_description, fill if null
  brands.brand || ' ' || COALESCE(
    NULLIF(TRIM(c.internal_description), ''),
    'H1Z2Z2-K Cable'
  ) AS internal_description,

  brands.brand,
  c.category,
  NOW() AS updated_at

FROM "3.0_components" c

-- Cross join with all brands to create one duplicate per brand
CROSS JOIN (
  SELECT 'SUNTREE' AS brand
  UNION ALL SELECT 'SLOCABLE'
  UNION ALL SELECT 'JJLAPP'
  UNION ALL SELECT 'JEMBO'
  UNION ALL SELECT 'SUPREME'
) brands

WHERE c.component_id IN (
  '158be204-ca07-4013-9604-b24d2c157455',
  '6e550bea-e223-481f-a95e-2050c634d7d0',
  '03e730c3-f81b-4204-9356-81f8fa23e058'
);


-- Show what was created
SELECT
  brand,
  COUNT(*) AS components_created
FROM "3.0_components"
WHERE updated_at > NOW() - INTERVAL '1 minute'
  AND brand IN ('SUNTREE', 'SLOCABLE', 'JJLAPP', 'JEMBO', 'SUPREME')
GROUP BY brand
ORDER BY brand;

-- Should show 3 components per brand (total 15 new components)

-- If everything looks good:
COMMIT;

-- If something looks wrong:
-- ROLLBACK;


-- ============================================================================
-- STEP 3: VERIFY - Check all newly created components
-- ============================================================================

SELECT
  component_id,
  brand,
  supplier_model,
  internal_description,
  category,
  updated_at
FROM "3.0_components"
WHERE brand IN ('SUNTREE', 'SLOCABLE', 'JJLAPP', 'JEMBO', 'SUPREME')
  AND updated_at > NOW() - INTERVAL '2 minutes'
ORDER BY brand, supplier_model;


-- ============================================================================
-- STEP 4: SUMMARY - Count by brand
-- ============================================================================

SELECT
  brand,
  COUNT(*) AS total_components,
  COUNT(DISTINCT supplier_model) AS unique_supplier_models,
  COUNT(CASE WHEN supplier_model IS NULL THEN 1 END) AS null_models,
  COUNT(CASE WHEN internal_description IS NULL THEN 1 END) AS null_descriptions
FROM "3.0_components"
WHERE brand IN ('SUNTREE', 'SLOCABLE', 'JJLAPP', 'JEMBO', 'SUPREME')
GROUP BY brand
ORDER BY brand;


-- ============================================================================
-- STEP 5: DETAILED VIEW - Show all H1Z2Z2-K cable variants
-- ============================================================================

SELECT
  brand,
  supplier_model,
  internal_description,
  COUNT(*) AS count
FROM "3.0_components"
WHERE brand IN ('SUNTREE', 'SLOCABLE', 'JJLAPP', 'JEMBO', 'SUPREME')
  AND (
    supplier_model LIKE '%H1Z2Z2-K%'
    OR internal_description LIKE '%H1Z2Z2-K%'
    OR supplier_model LIKE '%Cable%'
  )
GROUP BY brand, supplier_model, internal_description
ORDER BY brand, supplier_model;

-- ============================================================================
-- ADD SUNKEAN BRAND TO H1Z2Z2-K CABLES
-- ============================================================================
-- Creates SUNKEAN versions of 3 cable components
-- ============================================================================

-- Component IDs:
-- 158be204-ca07-4013-9604-b24d2c157455
-- 6e550bea-e223-481f-a95e-2050c634d7d0
-- 03e730c3-f81b-4204-9356-81f8fa23e058

-- ============================================================================
-- STEP 1: PREVIEW - See source components
-- ============================================================================

SELECT
  component_id,
  supplier_model,
  internal_description,
  brand,
  category
FROM "3.0_components"
WHERE component_id IN (
  '158be204-ca07-4013-9604-b24d2c157455',
  '6e550bea-e223-481f-a95e-2050c634d7d0',
  '03e730c3-f81b-4204-9356-81f8fa23e058'
)
ORDER BY component_id;


-- ============================================================================
-- STEP 2: CREATE SUNKEAN DUPLICATES
-- ============================================================================

BEGIN;

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

  -- Add SUNKEAN prefix to supplier_model
  'SUNKEAN ' || COALESCE(
    NULLIF(TRIM(c.supplier_model), ''),
    COALESCE(NULLIF(TRIM(c.internal_description), ''), 'H1Z2Z2-K Cable')
  ) AS supplier_model,

  -- Add SUNKEAN prefix to internal_description
  'SUNKEAN ' || COALESCE(
    NULLIF(TRIM(c.internal_description), ''),
    'H1Z2Z2-K Cable'
  ) AS internal_description,

  'SUNKEAN' AS brand,
  c.category,
  NOW() AS updated_at

FROM "3.0_components" c

WHERE c.component_id IN (
  '158be204-ca07-4013-9604-b24d2c157455',
  '6e550bea-e223-481f-a95e-2050c634d7d0',
  '03e730c3-f81b-4204-9356-81f8fa23e058'
);

-- Show what was created
SELECT
  COUNT(*) AS sunkean_components_created
FROM "3.0_components"
WHERE brand = 'SUNKEAN'
  AND updated_at > NOW() - INTERVAL '1 minute';

COMMIT;


-- ============================================================================
-- STEP 3: VERIFY - Show all SUNKEAN components
-- ============================================================================

SELECT
  component_id,
  brand,
  supplier_model,
  internal_description,
  category,
  updated_at
FROM "3.0_components"
WHERE brand = 'SUNKEAN'
ORDER BY supplier_model;

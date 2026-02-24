-- ============================================================================
-- BRAND CLEANUP - SIMPLE VERSION
-- ============================================================================
-- For when you just want to clean up ALL brands, not find variations
-- ============================================================================

-- ============================================================================
-- STEP 1: SEE ALL CURRENT BRANDS (including whitespace)
-- ============================================================================
-- This shows you EXACTLY what's in the database, including hidden spaces

SELECT
  brand,
  LENGTH(brand) AS brand_length,
  LENGTH(TRIM(brand)) AS trimmed_length,
  CASE
    WHEN brand != TRIM(brand) THEN '⚠️ HAS WHITESPACE'
    ELSE '✅ Clean'
  END AS status,
  COUNT(*) AS component_count,
  array_agg(component_id) AS component_ids

FROM "3.0_components"

WHERE brand IS NOT NULL

GROUP BY brand
ORDER BY LOWER(TRIM(brand)), brand;

-- This will show if "MIBET" has trailing/leading spaces


-- ============================================================================
-- STEP 2: FIX ALL BRAND WHITESPACE (Safe - Always Run This)
-- ============================================================================
-- Trims whitespace from ALL brands, regardless of variations

BEGIN;

-- Show what will change
SELECT
  component_id,
  supplier_model,
  brand AS current_brand,
  TRIM(brand) AS cleaned_brand,
  CASE
    WHEN brand = TRIM(brand) THEN 'No change needed'
    ELSE 'Will be trimmed'
  END AS change_status

FROM "3.0_components"

WHERE brand IS NOT NULL
  AND brand != TRIM(brand);

-- If the above looks good, run this:
UPDATE "3.0_components"
SET brand = TRIM(brand)
WHERE brand IS NOT NULL
  AND brand != TRIM(brand);

-- Check results
SELECT
  CONCAT('Updated ', COUNT(*), ' components') AS result
FROM "3.0_components"
WHERE updated_at > NOW() - INTERVAL '1 minute';

COMMIT;
-- Or ROLLBACK if something looks wrong


-- ============================================================================
-- STEP 3: CHECK FOR CASE VARIATIONS
-- ============================================================================
-- See if "MIBET" vs "Mibet" vs "mibet" exists

SELECT
  LOWER(TRIM(brand)) AS normalized,
  array_agg(DISTINCT brand ORDER BY brand) AS variants,
  COUNT(DISTINCT brand) AS variant_count,
  SUM(component_count) AS total_components

FROM (
  SELECT
    brand,
    COUNT(*) AS component_count
  FROM "3.0_components"
  WHERE brand IS NOT NULL
  GROUP BY brand
) brand_stats

GROUP BY LOWER(TRIM(brand))
HAVING COUNT(DISTINCT brand) > 1  -- Only show if there are variations

ORDER BY total_components DESC;


-- ============================================================================
-- STEP 4: STANDARDIZE SPECIFIC BRAND (MIBET Example)
-- ============================================================================
-- If you want to standardize MIBET to a specific capitalization

BEGIN;

-- See all MIBET variations
SELECT
  brand,
  COUNT(*) AS component_count,
  array_agg(component_id) AS affected_components
FROM "3.0_components"
WHERE LOWER(TRIM(brand)) = 'mibet'
GROUP BY brand;

-- Standardize to "MIBET" (all caps)
UPDATE "3.0_components"
SET brand = 'MIBET'
WHERE LOWER(TRIM(brand)) = 'mibet';

-- Verify
SELECT brand, COUNT(*)
FROM "3.0_components"
WHERE LOWER(TRIM(brand)) = 'mibet'
GROUP BY brand;

COMMIT;


-- ============================================================================
-- STEP 5: SEE BRANDS AS THEY APPEAR IN DROPDOWN
-- ============================================================================
-- This mimics what the /insert page dropdown shows

SELECT DISTINCT
  brand,
  LENGTH(brand) AS length,
  '"' || brand || '"' AS quoted_view  -- Shows hidden spaces clearly

FROM "3.0_components"

WHERE brand IS NOT NULL

ORDER BY brand;

-- If you see:
-- "MIBET"
-- "MIBET "   ← This has a trailing space!
-- Then Step 2 will fix it

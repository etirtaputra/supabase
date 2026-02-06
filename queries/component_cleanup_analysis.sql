-- ============================================================================
-- COMPONENT CLEANUP ANALYSIS QUERIES
-- ============================================================================
-- Purpose: Analyze component usage and identify candidates for cleanup
-- Run these queries in order to safely clean up your components table
-- ============================================================================

-- ============================================================================
-- STEP 1: IDENTIFY ORPHANED COMPONENTS (No References)
-- ============================================================================
-- These components are not used in ANY quotes or purchase orders

SELECT
  c.component_id,
  c.supplier_model,
  c.internal_description,
  c.brand,
  c.category,
  c.updated_at,

  -- Age of component (helps decide if it's truly obsolete)
  -- Using updated_at as proxy for age since created_at may not exist
  EXTRACT(DAY FROM (NOW() - c.updated_at)) AS days_since_last_update,

  -- Why it's orphaned
  'Not used in any quote or PO' AS reason

FROM "3.0_components" c

WHERE
  -- Not in any quote line items
  NOT EXISTS (
    SELECT 1 FROM "4.1_price_quote_line_items" qli
    WHERE qli.component_id = c.component_id
  )

  -- Not in any PO line items
  AND NOT EXISTS (
    SELECT 1 FROM "5.1_purchase_line_items" pli
    WHERE pli.component_id = c.component_id
  )

ORDER BY c.updated_at DESC NULLS LAST;

-- Export this to CSV and review before deleting!
-- Components created recently might be for upcoming quotes


-- ============================================================================
-- STEP 2: FIND POTENTIAL DUPLICATES (Similar Names)
-- ============================================================================
-- Components that might be duplicates based on supplier_model or description

WITH component_similarity AS (
  SELECT
    c1.component_id AS comp1_id,
    c1.supplier_model AS comp1_model,
    c1.internal_description AS comp1_desc,
    c1.brand AS comp1_brand,

    c2.component_id AS comp2_id,
    c2.supplier_model AS comp2_model,
    c2.internal_description AS comp2_desc,
    c2.brand AS comp2_brand,

    -- Calculate similarity scores
    similarity(c1.supplier_model, c2.supplier_model) AS model_similarity,
    similarity(
      COALESCE(c1.internal_description, ''),
      COALESCE(c2.internal_description, '')
    ) AS desc_similarity,

    -- Check if used in quotes/POs
    (SELECT COUNT(*) FROM "4.1_price_quote_line_items" WHERE component_id = c1.component_id) AS comp1_quote_usage,
    (SELECT COUNT(*) FROM "5.1_purchase_line_items" WHERE component_id = c1.component_id) AS comp1_po_usage,
    (SELECT COUNT(*) FROM "4.1_price_quote_line_items" WHERE component_id = c2.component_id) AS comp2_quote_usage,
    (SELECT COUNT(*) FROM "5.1_purchase_line_items" WHERE component_id = c2.component_id) AS comp2_po_usage

  FROM "3.0_components" c1
  CROSS JOIN "3.0_components" c2

  WHERE
    c1.component_id < c2.component_id  -- Avoid comparing same component and duplicates
    AND (
      -- Similar supplier models (>70% match)
      similarity(c1.supplier_model, c2.supplier_model) > 0.7

      -- OR same brand + similar description
      OR (
        c1.brand IS NOT NULL
        AND c2.brand IS NOT NULL
        AND LOWER(c1.brand) = LOWER(c2.brand)
        AND similarity(
          COALESCE(c1.internal_description, ''),
          COALESCE(c2.internal_description, '')
        ) > 0.6
      )
    )
)

SELECT
  comp1_id,
  comp1_model,
  comp1_desc,
  comp1_brand,
  comp1_quote_usage + comp1_po_usage AS comp1_total_usage,

  comp2_id,
  comp2_model,
  comp2_desc,
  comp2_brand,
  comp2_quote_usage + comp2_po_usage AS comp2_total_usage,

  ROUND((model_similarity * 100)::numeric, 1) AS model_match_pct,
  ROUND((desc_similarity * 100)::numeric, 1) AS desc_match_pct,

  -- Recommendation
  CASE
    WHEN comp1_quote_usage + comp1_po_usage = 0 AND comp2_quote_usage + comp2_po_usage > 0
      THEN 'Consider deleting comp1 (unused)'
    WHEN comp2_quote_usage + comp2_po_usage = 0 AND comp1_quote_usage + comp1_po_usage > 0
      THEN 'Consider deleting comp2 (unused)'
    WHEN comp1_quote_usage + comp1_po_usage = 0 AND comp2_quote_usage + comp2_po_usage = 0
      THEN 'Both unused - review and pick one'
    ELSE 'Both used - consider merging'
  END AS recommendation

FROM component_similarity

ORDER BY model_similarity DESC, desc_similarity DESC;


-- ============================================================================
-- STEP 3: COMPONENT USAGE STATISTICS
-- ============================================================================
-- Get a complete picture of how components are used

SELECT
  c.component_id,
  c.supplier_model,
  c.internal_description,
  c.brand,
  c.category,

  -- Usage counts
  COALESCE(quote_usage.quote_count, 0) AS times_quoted,
  COALESCE(po_usage.po_count, 0) AS times_purchased,
  COALESCE(quote_usage.total_quoted_qty, 0) AS total_quoted_quantity,
  COALESCE(po_usage.total_purchased_qty, 0) AS total_purchased_quantity,

  -- Last usage dates
  quote_usage.last_quote_date,
  po_usage.last_po_date,

  -- Most recent activity
  GREATEST(
    COALESCE(quote_usage.last_quote_date, '1900-01-01'::date),
    COALESCE(po_usage.last_po_date, '1900-01-01'::date)
  ) AS last_used_date,

  -- Days since last use
  EXTRACT(DAY FROM (
    NOW() - GREATEST(
      COALESCE(quote_usage.last_quote_date, '1900-01-01'::date),
      COALESCE(po_usage.last_po_date, '1900-01-01'::date)
    )
  )) AS days_since_last_use,

  -- Classification
  CASE
    WHEN COALESCE(quote_usage.quote_count, 0) = 0
     AND COALESCE(po_usage.po_count, 0) = 0
      THEN '❌ UNUSED - Candidate for deletion'
    WHEN EXTRACT(DAY FROM (NOW() - GREATEST(
      COALESCE(quote_usage.last_quote_date, '1900-01-01'::date),
      COALESCE(po_usage.last_po_date, '1900-01-01'::date)
    ))) > 365
      THEN '⚠️ INACTIVE - Not used in 1+ year'
    WHEN EXTRACT(DAY FROM (NOW() - GREATEST(
      COALESCE(quote_usage.last_quote_date, '1900-01-01'::date),
      COALESCE(po_usage.last_po_date, '1900-01-01'::date)
    ))) > 180
      THEN '⏸️ DORMANT - Not used in 6+ months'
    ELSE '✅ ACTIVE'
  END AS status

FROM "3.0_components" c

LEFT JOIN (
  SELECT
    component_id,
    COUNT(DISTINCT quote_id) AS quote_count,
    SUM(quantity) AS total_quoted_qty,
    MAX(q.quote_date) AS last_quote_date
  FROM "4.1_price_quote_line_items" qli
  JOIN "4.0_price_quotes" q ON qli.quote_id = q.quote_id
  GROUP BY component_id
) quote_usage ON c.component_id = quote_usage.component_id

LEFT JOIN (
  SELECT
    component_id,
    COUNT(DISTINCT po_id) AS po_count,
    SUM(quantity) AS total_purchased_qty,
    MAX(p.po_date) AS last_po_date
  FROM "5.1_purchase_line_items" pli
  JOIN "5.0_purchases" p ON pli.po_id = p.po_id
  GROUP BY component_id
) po_usage ON c.component_id = po_usage.component_id

ORDER BY
  CASE status
    WHEN '❌ UNUSED - Candidate for deletion' THEN 1
    WHEN '⚠️ INACTIVE - Not used in 1+ year' THEN 2
    WHEN '⏸️ DORMANT - Not used in 6+ months' THEN 3
    ELSE 4
  END,
  last_used_date DESC NULLS LAST;


-- ============================================================================
-- STEP 4: NAMING INCONSISTENCIES
-- ============================================================================
-- Find components with potential naming issues

SELECT
  component_id,
  supplier_model,
  internal_description,
  brand,

  -- Identify issues
  ARRAY_REMOVE(ARRAY[
    CASE WHEN supplier_model ~ '^\s+|\s+$' THEN 'Leading/trailing spaces in model' END,
    CASE WHEN internal_description ~ '^\s+|\s+$' THEN 'Leading/trailing spaces in description' END,
    CASE WHEN supplier_model ~ '\s{2,}' THEN 'Multiple consecutive spaces in model' END,
    CASE WHEN internal_description ~ '\s{2,}' THEN 'Multiple consecutive spaces in description' END,
    CASE WHEN supplier_model != TRIM(supplier_model) THEN 'Whitespace padding in model' END,
    CASE WHEN supplier_model = UPPER(supplier_model) AND LENGTH(supplier_model) > 10 THEN 'All caps model (consider title case)' END,
    CASE WHEN supplier_model = LOWER(supplier_model) AND LENGTH(supplier_model) > 10 THEN 'All lowercase model (consider title case)' END,
    CASE WHEN brand IS NOT NULL AND brand != TRIM(brand) THEN 'Whitespace in brand' END,
    CASE WHEN LENGTH(supplier_model) < 2 THEN 'Suspiciously short model' END,
    CASE WHEN LENGTH(internal_description) < 5 THEN 'Suspiciously short description' END
  ], NULL) AS naming_issues,

  -- Suggested fixes
  TRIM(supplier_model) AS cleaned_model,
  TRIM(internal_description) AS cleaned_description,
  TRIM(brand) AS cleaned_brand

FROM "3.0_components"

WHERE
  supplier_model ~ '^\s+|\s+$|\s{2,}'  -- Whitespace issues in model
  OR internal_description ~ '^\s+|\s+$|\s{2,}'  -- Whitespace issues in description
  OR supplier_model != TRIM(supplier_model)
  OR internal_description != TRIM(internal_description)
  OR (brand IS NOT NULL AND brand != TRIM(brand))
  OR LENGTH(supplier_model) < 2
  OR LENGTH(internal_description) < 5

ORDER BY array_length(
  ARRAY_REMOVE(ARRAY[
    CASE WHEN supplier_model ~ '^\s+|\s+$' THEN 'x' END,
    CASE WHEN internal_description ~ '^\s+|\s+$' THEN 'x' END,
    CASE WHEN supplier_model ~ '\s{2,}' THEN 'x' END
  ], NULL),
  1
) DESC NULLS LAST;


-- ============================================================================
-- STEP 5: BRAND STANDARDIZATION
-- ============================================================================
-- Find brand variations that should be standardized

SELECT
  LOWER(TRIM(brand)) AS normalized_brand,
  COUNT(*) AS variant_count,
  array_agg(DISTINCT brand) AS brand_variants,
  array_agg(DISTINCT component_id) AS affected_components,
  SUM((SELECT COUNT(*) FROM "4.1_price_quote_line_items" WHERE component_id = c.component_id)) AS total_quote_usage,
  SUM((SELECT COUNT(*) FROM "5.1_purchase_line_items" WHERE component_id = c.component_id)) AS total_po_usage

FROM "3.0_components" c

WHERE brand IS NOT NULL

GROUP BY LOWER(TRIM(brand))

HAVING COUNT(DISTINCT brand) > 1  -- Only show brands with variations

ORDER BY variant_count DESC, total_quote_usage + total_po_usage DESC;


-- ============================================================================
-- EXAMPLE: Safe Deletion of Unused Components
-- ============================================================================
-- Run this ONLY after reviewing Step 1 results!

/*
-- Create backup first!
CREATE TABLE components_backup AS
SELECT * FROM "3.0_components";

-- Delete orphaned components (REVIEW FIRST!)
DELETE FROM "3.0_components"
WHERE component_id IN (
  -- Paste component_ids from Step 1 results here
  -- 'uuid-1', 'uuid-2', etc.
);

-- Verify deletion
SELECT COUNT(*) FROM components_backup;  -- Should show original count
SELECT COUNT(*) FROM "3.0_components";   -- Should show reduced count
*/

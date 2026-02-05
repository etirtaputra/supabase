-- =====================================================
-- TEXT SEARCH OPTIMIZATION - PHASE 2 (UPDATED FOR NEW SCHEMA)
-- =====================================================
-- Description: Trigram indexes for fast ILIKE queries
-- Estimated time: 3-10 minutes depending on data volume
-- Impact: 10-100x faster text search operations
--
-- UPDATED: Uses new component field names (supplier_model, internal_description)
-- =====================================================

BEGIN;

-- =====================================================
-- 1. ENABLE POSTGRESQL EXTENSIONS
-- =====================================================

-- pg_trgm: Trigram matching for similarity searches
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- btree_gin: Allows GIN indexes on multiple column types
CREATE EXTENSION IF NOT EXISTS btree_gin;

RAISE NOTICE '✓ Extensions enabled: pg_trgm, btree_gin';

-- =====================================================
-- 2. TRIGRAM INDEXES FOR TEXT SEARCH
-- =====================================================
-- These optimize ILIKE '%keyword%' queries used in route.ts

-- Suppliers - searched in keyword filtering (route.ts:29, 38)
CREATE INDEX IF NOT EXISTS idx_suppliers_name_trgm
  ON "2.0_suppliers" USING gin(supplier_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_suppliers_code_trgm
  ON "2.0_suppliers" USING gin(supplier_code gin_trgm_ops)
  WHERE supplier_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_suppliers_location_trgm
  ON "2.0_suppliers" USING gin(location gin_trgm_ops)
  WHERE location IS NOT NULL;

COMMENT ON INDEX idx_suppliers_name_trgm IS 'Optimizes supplier_name.ilike queries in /api/ask route';

-- Components - heavily searched (route.ts:29, 42, 59, 69)
-- UPDATED: Uses new field names
CREATE INDEX IF NOT EXISTS idx_components_supplier_model_trgm
  ON "3.0_components" USING gin(supplier_model gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_components_internal_description_trgm
  ON "3.0_components" USING gin(internal_description gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_components_brand_trgm
  ON "3.0_components" USING gin(brand gin_trgm_ops)
  WHERE brand IS NOT NULL;

COMMENT ON INDEX idx_components_supplier_model_trgm IS 'CRITICAL: supplier_model is searched in every /api/ask request';
COMMENT ON INDEX idx_components_internal_description_trgm IS 'CRITICAL: internal_description is searched in every /api/ask request';

-- Purchase Orders - PO number search
CREATE INDEX IF NOT EXISTS idx_purchases_po_number_trgm
  ON "5.0_purchases" USING gin(po_number gin_trgm_ops);

-- Price Quotes - Quote reference search
CREATE INDEX IF NOT EXISTS idx_price_quotes_pi_number_trgm
  ON "4.0_price_quotes" USING gin(pi_number gin_trgm_ops)
  WHERE pi_number IS NOT NULL;

COMMENT ON INDEX idx_purchases_po_number_trgm IS 'Used in PO search functionality';

-- =====================================================
-- 3. COMPOUND TEXT SEARCH (OPTIONAL - ADVANCED)
-- =====================================================
-- Multi-column trigram index for combined searches

-- Suppliers: Search across name + code + location at once
CREATE INDEX IF NOT EXISTS idx_suppliers_combined_trgm
  ON "2.0_suppliers" USING gin(
    (COALESCE(supplier_name, '') || ' ' ||
     COALESCE(supplier_code, '') || ' ' ||
     COALESCE(location, ''))
    gin_trgm_ops
  );

-- Components: Search across supplier_model + internal_description + brand
-- UPDATED: Uses new field names
CREATE INDEX IF NOT EXISTS idx_components_combined_trgm
  ON "3.0_components" USING gin(
    (COALESCE(supplier_model, '') || ' ' ||
     COALESCE(internal_description, '') || ' ' ||
     COALESCE(brand, ''))
    gin_trgm_ops
  );

COMMENT ON INDEX idx_suppliers_combined_trgm IS 'Single-query search across all supplier text fields';
COMMENT ON INDEX idx_components_combined_trgm IS 'Single-query search across all component text fields';

-- =====================================================
-- 4. FULL-TEXT SEARCH (ALTERNATIVE APPROACH)
-- =====================================================
-- For more sophisticated search capabilities

-- Add tsvector columns for full-text search
ALTER TABLE "2.0_suppliers"
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      COALESCE(supplier_name, '') || ' ' ||
      COALESCE(supplier_code, '') || ' ' ||
      COALESCE(location, '')
    )
  ) STORED;

-- UPDATED: Uses new field names
ALTER TABLE "3.0_components"
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      COALESCE(supplier_model, '') || ' ' ||
      COALESCE(internal_description, '') || ' ' ||
      COALESCE(brand, '')
    )
  ) STORED;

-- Create GIN indexes on tsvector columns
CREATE INDEX IF NOT EXISTS idx_suppliers_fts
  ON "2.0_suppliers" USING gin(search_vector);

CREATE INDEX IF NOT EXISTS idx_components_fts
  ON "3.0_components" USING gin(search_vector);

COMMENT ON INDEX idx_suppliers_fts IS 'Full-text search on suppliers - use with tsquery';
COMMENT ON INDEX idx_components_fts IS 'Full-text search on components - use with tsquery';

-- =====================================================
-- 5. TEST QUERY PERFORMANCE
-- =====================================================
-- Example queries to test the new indexes

/*
-- BEFORE: Full table scan (~500ms on 10k rows)
EXPLAIN ANALYZE
SELECT * FROM "2.0_suppliers"
WHERE supplier_name ILIKE '%electronics%';

-- AFTER: Index scan (~5ms on 10k rows)
EXPLAIN ANALYZE
SELECT * FROM "2.0_suppliers"
WHERE supplier_name ILIKE '%electronics%';

-- Full-text search (even faster)
EXPLAIN ANALYZE
SELECT * FROM "2.0_suppliers"
WHERE search_vector @@ to_tsquery('english', 'electronics');

-- Similarity search (ranked by relevance)
SELECT
  supplier_name,
  similarity(supplier_name, 'electronic') as score
FROM "2.0_suppliers"
WHERE supplier_name % 'electronic'  -- % is similarity operator
ORDER BY score DESC
LIMIT 10;
*/

-- =====================================================
-- VERIFICATION
-- =====================================================

DO $$
DECLARE
  trgm_index_count INTEGER;
  fts_index_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO trgm_index_count
  FROM pg_indexes
  WHERE indexname LIKE '%_trgm';

  SELECT COUNT(*)
  INTO fts_index_count
  FROM pg_indexes
  WHERE indexname LIKE '%_fts';

  RAISE NOTICE '✓ Trigram indexes created: %', trgm_index_count;
  RAISE NOTICE '✓ Full-text search indexes created: %', fts_index_count;
  RAISE NOTICE '→ Text search optimization complete!';
  RAISE NOTICE '→ Update route.ts to use full-text search for even better performance';
END $$;

COMMIT;

-- =====================================================
-- USAGE EXAMPLES FOR ROUTE.TS
-- =====================================================

/*
// OPTION 1: Keep using ILIKE (now 10-100x faster with trigram indexes)
const { data } = await supabase
  .from('2.0_suppliers')
  .select('*')
  .ilike('supplier_name', '%electronics%');

// OPTION 2: Use full-text search (100-1000x faster)
const { data } = await supabase
  .from('2.0_suppliers')
  .select('*')
  .textSearch('search_vector', 'electronics');

// OPTION 3: Use Postgres RPC for similarity search
const { data } = await supabase.rpc('search_suppliers', {
  search_term: 'electronics',
  limit_count: 10
});

-- Create this function in Supabase:
CREATE OR REPLACE FUNCTION search_suppliers(
  search_term TEXT,
  limit_count INTEGER DEFAULT 10
)
RETURNS TABLE (
  supplier_id INTEGER,
  supplier_name TEXT,
  similarity_score REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.supplier_id,
    s.supplier_name,
    similarity(s.supplier_name, search_term) as similarity_score
  FROM "2.0_suppliers" s
  WHERE s.supplier_name % search_term
  ORDER BY similarity_score DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;
*/

-- =====================================================
-- ROLLBACK SCRIPT
-- =====================================================

/*
BEGIN;

-- Drop trigram indexes (UPDATED index names)
DROP INDEX IF EXISTS idx_suppliers_name_trgm;
DROP INDEX IF EXISTS idx_suppliers_code_trgm;
DROP INDEX IF EXISTS idx_suppliers_location_trgm;
DROP INDEX IF EXISTS idx_components_supplier_model_trgm;
DROP INDEX IF EXISTS idx_components_internal_description_trgm;
DROP INDEX IF EXISTS idx_components_brand_trgm;
DROP INDEX IF EXISTS idx_purchases_po_number_trgm;
DROP INDEX IF EXISTS idx_price_quotes_pi_number_trgm;
DROP INDEX IF EXISTS idx_suppliers_combined_trgm;
DROP INDEX IF EXISTS idx_components_combined_trgm;

-- Drop full-text search indexes
DROP INDEX IF EXISTS idx_suppliers_fts;
DROP INDEX IF EXISTS idx_components_fts;

-- Drop tsvector columns
ALTER TABLE "2.0_suppliers" DROP COLUMN IF EXISTS search_vector;
ALTER TABLE "3.0_components" DROP COLUMN IF EXISTS search_vector;

COMMIT;
*/

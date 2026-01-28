-- =====================================================
-- INDEX VERIFICATION & PERFORMANCE TESTING
-- =====================================================
-- Run this after applying migrations to verify indexes
-- =====================================================

-- =====================================================
-- 1. LIST ALL CUSTOM INDEXES
-- =====================================================

SELECT
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
  idx_scan as times_used,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%'
ORDER BY pg_relation_size(indexrelid) DESC;

-- =====================================================
-- 2. CHECK INDEX USAGE EFFICIENCY
-- =====================================================

SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
  CASE
    WHEN idx_scan = 0 THEN '⚠️ UNUSED'
    WHEN idx_scan < 100 THEN '⚡ LOW USAGE'
    WHEN idx_scan < 1000 THEN '✓ NORMAL'
    ELSE '🔥 HIGH USAGE'
  END as usage_status
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%'
ORDER BY idx_scan DESC;

-- =====================================================
-- 3. VERIFY FOREIGN KEY INDEXES
-- =====================================================

-- This query checks if all foreign keys have indexes
WITH fk_indexes AS (
  SELECT
    tc.table_name,
    kcu.column_name,
    EXISTS (
      SELECT 1
      FROM pg_indexes i
      WHERE i.tablename = tc.table_name
        AND (
          i.indexdef LIKE '%' || kcu.column_name || '%'
          OR i.indexdef LIKE '%' || kcu.column_name || ')%'
        )
    ) as has_index
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
)
SELECT
  table_name,
  column_name,
  CASE
    WHEN has_index THEN '✓ INDEXED'
    ELSE '⚠️ MISSING INDEX'
  END as status
FROM fk_indexes
ORDER BY has_index, table_name;

-- =====================================================
-- 4. TEST QUERY PERFORMANCE - BEFORE/AFTER
-- =====================================================

-- Test 1: JOIN performance (price quotes + line items)
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT
  pq.quote_id,
  pq.quote_date,
  s.supplier_name,
  pli.component_id,
  pli.quantity,
  pli.unit_price
FROM "4.0_price_quotes" pq
JOIN "2.0_suppliers" s ON pq.supplier_id = s.supplier_id
JOIN "4.1_price_quote_line_items" pli ON pq.quote_id = pli.quote_id
WHERE pq.quote_date > (CURRENT_DATE - INTERVAL '30 days')
ORDER BY pq.quote_date DESC
LIMIT 100;

-- Expected: Should show "Index Scan" on all JOIN conditions
-- Look for: "Index Scan using idx_price_quotes_supplier_id"

-- Test 2: Text search performance (ILIKE)
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT *
FROM "3.0_components"
WHERE model_sku ILIKE '%ABC%'
   OR description ILIKE '%ABC%'
LIMIT 20;

-- Expected: Should show "Bitmap Index Scan" with trigram index
-- Look for: "Bitmap Index Scan on idx_components_model_sku_trgm"

-- Test 3: Date sorting performance
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT *
FROM "6.0_purchases"
ORDER BY po_date DESC
LIMIT 50;

-- Expected: Should show "Index Scan using idx_purchases_po_date_desc"
-- Look for: "Index Scan Backward" (using descending index)

-- Test 4: Complex analytics query
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT
  po.po_id,
  po.po_number,
  po.po_date,
  SUM(pli.quantity * pli.unit_cost) as total_cost,
  COUNT(pli.po_item_id) as line_items
FROM "6.0_purchases" po
JOIN "6.1_purchase_line_items" pli ON po.po_id = pli.po_id
WHERE po.status = 'received'
  AND po.po_date > (CURRENT_DATE - INTERVAL '90 days')
GROUP BY po.po_id, po.po_number, po.po_date
ORDER BY total_cost DESC
LIMIT 20;

-- Expected: Should show index usage on po_id, status, and po_date

-- =====================================================
-- 5. CHECK FOR MISSING INDEXES (RECOMMENDATIONS)
-- =====================================================

-- Find tables with many sequential scans but few index scans
SELECT
  schemaname,
  tablename,
  seq_scan,
  seq_tup_read,
  idx_scan,
  seq_tup_read / NULLIF(seq_scan, 0) as avg_seq_tup_read,
  CASE
    WHEN seq_scan > 1000 AND idx_scan < seq_scan / 10 THEN '⚠️ NEEDS INDEX'
    WHEN seq_scan > 100 AND idx_scan < seq_scan / 5 THEN '⚡ REVIEW'
    ELSE '✓ OK'
  END as recommendation
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY seq_scan DESC;

-- =====================================================
-- 6. CHECK INDEX BLOAT
-- =====================================================

SELECT
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
  idx_scan,
  ROUND(100 * idx_scan / NULLIF(idx_scan + seq_scan, 0), 2) as index_usage_pct
FROM pg_stat_user_indexes pui
JOIN pg_stat_user_tables put ON pui.relid = put.relid
WHERE schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC;

-- =====================================================
-- 7. MATERIALIZED VIEW STATUS
-- =====================================================

-- Check if materialized view exists
SELECT
  schemaname,
  matviewname,
  pg_size_pretty(pg_relation_size(oid)) as size,
  CASE
    WHEN ispopulated THEN '✓ POPULATED'
    ELSE '⚠️ NOT POPULATED'
  END as status
FROM pg_matviews
WHERE schemaname = 'public';

-- Check refresh history (if log table exists)
SELECT
  view_name,
  last_refresh,
  EXTRACT(EPOCH FROM age)::INTEGER / 3600 as hours_since_refresh,
  last_duration_ms,
  last_row_count,
  success_count,
  error_count
FROM v_materialized_view_status;

-- =====================================================
-- 8. QUICK PERFORMANCE SUMMARY
-- =====================================================

DO $$
DECLARE
  total_indexes INTEGER;
  total_size TEXT;
  unused_indexes INTEGER;
  fk_missing INTEGER;
BEGIN
  -- Count total custom indexes
  SELECT COUNT(*), pg_size_pretty(SUM(pg_relation_size(indexrelid)))
  INTO total_indexes, total_size
  FROM pg_stat_user_indexes
  WHERE schemaname = 'public' AND indexname LIKE 'idx_%';

  -- Count unused indexes
  SELECT COUNT(*)
  INTO unused_indexes
  FROM pg_stat_user_indexes
  WHERE schemaname = 'public'
    AND indexname LIKE 'idx_%'
    AND idx_scan = 0;

  -- Count missing FK indexes (simplified)
  SELECT COUNT(*)
  INTO fk_missing
  FROM information_schema.table_constraints
  WHERE constraint_type = 'FOREIGN KEY'
    AND table_schema = 'public'
    AND NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE tablename = table_constraints.table_name
    );

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'INDEX VERIFICATION SUMMARY';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Total custom indexes: %', total_indexes;
  RAISE NOTICE 'Total index size: %', total_size;
  RAISE NOTICE 'Unused indexes: % (these may need time to warm up)', unused_indexes;
  RAISE NOTICE 'Missing FK indexes: %', fk_missing;
  RAISE NOTICE '';

  IF fk_missing = 0 THEN
    RAISE NOTICE '✓ All foreign keys are indexed';
  ELSE
    RAISE NOTICE '⚠️ % foreign keys need indexes', fk_missing;
  END IF;

  RAISE NOTICE '========================================';
END $$;

-- =====================================================
-- 9. REAL-TIME QUERY MONITORING
-- =====================================================

-- Show currently running queries (useful for debugging)
SELECT
  pid,
  usename,
  state,
  query_start,
  NOW() - query_start as duration,
  LEFT(query, 100) as query_preview
FROM pg_stat_activity
WHERE state != 'idle'
  AND query NOT LIKE '%pg_stat_activity%'
ORDER BY query_start;

-- =====================================================
-- 10. EXPORT RESULTS FOR ANALYSIS
-- =====================================================

-- Uncomment to export to CSV (if you have file write permissions)
/*
COPY (
  SELECT
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
    idx_scan as times_used,
    idx_tup_read,
    idx_tup_fetch
  FROM pg_stat_user_indexes
  WHERE schemaname = 'public'
  ORDER BY pg_relation_size(indexrelid) DESC
) TO '/tmp/index_report.csv' WITH CSV HEADER;
*/

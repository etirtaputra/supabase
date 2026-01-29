# Database Optimization Migrations

This directory contains SQL migration scripts to optimize your Supabase database performance.

## Quick Start

Run migrations in order using the Supabase SQL Editor:

1. **Phase 1 (Critical):** `001_critical_indexes.sql` - ~5-15 minutes
2. **Phase 2 (Important):** `002_text_search_indexes.sql` - ~3-10 minutes
3. **Phase 3 (Advanced):** `003_materialized_view_setup.sql` - ~2-5 minutes
4. **Verification:** `verify_indexes.sql` - Check performance improvements

## Migration Files

### 001_critical_indexes.sql
**Priority: 🔴 CRITICAL - Run First**

Creates essential indexes for:
- Foreign key relationships (11 indexes)
- Date-based sorting (2 indexes)
- Status filtering (3 indexes)
- Analytics composite indexes (5 indexes)

**Expected Impact:** 50-500x faster JOIN operations

**Time:** 5-15 minutes depending on data volume

**How to run:**
```sql
-- In Supabase SQL Editor:
-- 1. Copy contents of 001_critical_indexes.sql
-- 2. Paste into SQL Editor
-- 3. Click "Run"
-- 4. Wait for "Index creation complete!" message
```

---

### 002_text_search_indexes.sql
**Priority: 🟡 IMPORTANT - Run Second**

Creates text search optimization:
- Trigram indexes for ILIKE queries (9 indexes)
- Full-text search capabilities
- Compound text search indexes

**Expected Impact:** 10-100x faster text search

**Time:** 3-10 minutes depending on data volume

**Requirements:**
- Enables `pg_trgm` extension (included in script)
- Enables `btree_gin` extension (included in script)

**How to run:**
```sql
-- In Supabase SQL Editor:
-- 1. Copy contents of 002_text_search_indexes.sql
-- 2. Paste into SQL Editor
-- 3. Click "Run"
-- 4. Wait for "Text search optimization complete!" message
```

---

### 003_materialized_view_setup.sql
**Priority: 🟢 OPTIMIZATION - Run Third**

Sets up automatic refresh for `mv_component_analytics`:
- Creates unique index for concurrent refresh
- Schedules daily refresh via pg_cron
- Creates manual refresh functions
- Sets up refresh logging and monitoring

**Expected Impact:** Consistent fast analytics queries

**Time:** 2-5 minutes

**Note:** If you don't have `mv_component_analytics` yet, skip this migration.

**How to run:**
```sql
-- In Supabase SQL Editor:
-- 1. Copy contents of 003_materialized_view_setup.sql
-- 2. Paste into SQL Editor
-- 3. Click "Run"
-- 4. Check status: SELECT * FROM v_materialized_view_status;
```

---

### verify_indexes.sql
**Purpose: Verification & Testing**

Run this after migrations to:
- List all created indexes
- Check index usage statistics
- Verify foreign key indexes
- Test query performance
- Identify missing indexes
- Check materialized view status

**How to run:**
```sql
-- In Supabase SQL Editor:
-- 1. Copy entire file or specific queries
-- 2. Run section by section to check results
-- 3. Compare EXPLAIN ANALYZE results before/after
```

---

## Step-by-Step Instructions

### 1. Backup Your Database
```bash
# In Supabase Dashboard:
# Settings > Database > Create Backup
```

### 2. Run Migration 001 (Critical Indexes)
1. Open Supabase Dashboard
2. Go to SQL Editor
3. Create new query
4. Copy contents of `001_critical_indexes.sql`
5. Click "Run"
6. Wait for success message

### 3. Verify Migration 001
Run these queries to verify:
```sql
-- Check created indexes
SELECT indexname, tablename
FROM pg_indexes
WHERE schemaname = 'public' AND indexname LIKE 'idx_%'
ORDER BY tablename;

-- Test a query
EXPLAIN ANALYZE
SELECT * FROM "4.0_price_quotes" pq
JOIN "4.1_price_quote_line_items" pli ON pq.quote_id = pli.quote_id
LIMIT 10;
-- Should show "Index Scan" not "Seq Scan"
```

### 4. Run Migration 002 (Text Search)
Repeat same process with `002_text_search_indexes.sql`

### 5. Verify Migration 002
```sql
-- Test trigram search
EXPLAIN ANALYZE
SELECT * FROM "3.0_components"
WHERE model_sku ILIKE '%ABC%'
LIMIT 10;
-- Should show "Bitmap Index Scan on idx_components_model_sku_trgm"

-- Test full-text search
SELECT * FROM "3.0_components"
WHERE search_vector @@ to_tsquery('english', 'laptop');
```

### 6. Run Migration 003 (Optional - Materialized View)
Only if you have `mv_component_analytics`

### 7. Run Verification Script
Copy and run sections from `verify_indexes.sql` to check:
- Index creation status
- Query performance improvements
- Index usage statistics

---

## Expected Performance Improvements

| Query Type | Before | After | Improvement |
|------------|--------|-------|-------------|
| JOINs (with FKs) | 500-5000ms | 5-50ms | **50-500x** |
| Text search (ILIKE) | 200-2000ms | 5-20ms | **10-100x** |
| Date sorting | 100-1000ms | 5-15ms | **10-50x** |
| Status filtering | 50-500ms | 5-10ms | **5-50x** |
| Analytics queries | 1000-10000ms | 50-200ms | **10-50x** |

---

## Rollback Instructions

Each migration file includes a rollback script at the bottom (commented out).

To rollback Migration 001:
```sql
BEGIN;

DROP INDEX IF EXISTS idx_price_quotes_supplier_id;
DROP INDEX IF EXISTS idx_price_quotes_company_id;
-- ... (see rollback section in 001_critical_indexes.sql)

COMMIT;
```

---

## Monitoring Performance

After migrations, use these queries to monitor:

```sql
-- 1. Check index usage
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan as times_used,
  pg_size_pretty(pg_relation_size(indexrelid)) as size
FROM pg_stat_user_indexes
WHERE schemaname = 'public' AND indexname LIKE 'idx_%'
ORDER BY idx_scan DESC;

-- 2. Find slow queries
SELECT
  query,
  calls,
  mean_exec_time,
  max_exec_time
FROM pg_stat_statements
WHERE mean_exec_time > 100
ORDER BY mean_exec_time DESC
LIMIT 20;

-- 3. Check table sizes
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) -
                 pg_relation_size(schemaname||'.'||tablename)) as index_size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

---

## Common Issues & Solutions

### Issue: "permission denied for extension pg_trgm"
**Solution:** You may need to enable extensions in Supabase Dashboard:
- Go to Database > Extensions
- Enable `pg_trgm` and `btree_gin`
- Then re-run migration 002

### Issue: "materialized view does not exist"
**Solution:** Migration 003 is optional. Skip if you don't have `mv_component_analytics`.

### Issue: "pg_cron extension not available"
**Solution:** Use manual refresh function instead:
```sql
SELECT refresh_component_analytics_mv_logged();
```

Or set up a cron job via API route (see migration 003 comments).

### Issue: "index creation taking too long"
**Solution:** Indexes are being built. This is normal for large tables. Wait for completion. You can check progress:
```sql
SELECT
  now()::time,
  query,
  state,
  wait_event_type,
  wait_event
FROM pg_stat_activity
WHERE query LIKE '%CREATE INDEX%';
```

---

## Next Steps After Migrations

1. **Update Application Code** (Optional)
   - Consider using full-text search instead of ILIKE for better performance
   - See comments in `002_text_search_indexes.sql` for examples

2. **Set Up Monitoring**
   - Enable `pg_stat_statements` extension
   - Create dashboard to track slow queries

3. **Schedule Materialized View Refresh**
   - Set up API route to refresh via cron
   - Or use pg_cron (included in migration 003)

4. **Review Code Optimizations**
   - See `SUPABASE_OPTIMIZATION_REPORT.md` for application-level optimizations
   - Implement smart view selection in `/api/ask/route.ts`

---

## Additional Resources

- **Full Optimization Report:** `../SUPABASE_OPTIMIZATION_REPORT.md`
- **Supabase Index Guide:** https://supabase.com/docs/guides/database/performance
- **PostgreSQL Performance Tips:** https://wiki.postgresql.org/wiki/Performance_Optimization

---

## Support

If you encounter issues:
1. Check Supabase Dashboard Logs
2. Run `verify_indexes.sql` to diagnose
3. Review rollback scripts to undo changes
4. Contact Supabase support if needed

---

**Last Updated:** 2026-01-28
**Database:** Supabase (PostgreSQL 15+)
**Tested On:** Supply Chain Management Database v1.0

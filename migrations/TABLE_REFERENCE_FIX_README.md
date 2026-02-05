# Table Reference Fix - Migration Guide

## Issues Found

After the database optimization where tables were renamed:
- `6.0_purchases` → `5.0_purchases`
- `6.1_purchase_line_items` → `5.1_purchase_line_items`
- `7.0_payment_details` + `7.1_landed_costs` → `6.0_po_costs`

Several database objects were left referencing the old table names.

## Problems Identified

### 1. ✅ Application Code (VERIFIED CORRECT)
- **Status:** All good! ✓
- `app/insert/page.tsx` - Uses correct table names
- `hooks/useSupabaseData.ts` - Uses TABLE_NAMES constants correctly
- `constants/tableNames.ts` - All constants updated
- `types/database.ts` - Interfaces aligned with new schema

### 2. ❌ Database Views (NEED RECREATION)
- **Issue:** `v_payment_tracking` and `v_landed_cost_summary` views were DROPPED during migration but never recreated
- **Impact:** AI assistant API (`/api/ask/route.ts`) queries these views and will fail
- **Fix:** Run migration `recreate_cost_views.sql`

### 3. ❌ Database Indexes (NEED UPDATE)
- **Issue:** Indexes from `001_critical_indexes.sql` reference old table names
- **Impact:** Performance degradation, possible query failures
- **Fix:** Run migration `update_indexes_for_renamed_tables.sql`

## Migration Order

Run these migrations in Supabase SQL Editor in this order:

### Step 1: Recreate Views
```bash
# File: migrations/recreate_cost_views.sql
```
This recreates:
- `v_payment_tracking` - Shows payment status for each PO
- `v_landed_cost_summary` - Shows total landed costs for each PO

### Step 2: Update Indexes
```bash
# File: migrations/update_indexes_for_renamed_tables.sql
```
This:
- Drops old indexes on non-existent tables
- Creates indexes on renamed tables `5.0_purchases` and `5.1_purchase_line_items`
- Creates indexes on unified table `6.0_po_costs`

## Verification

After running migrations, verify in Supabase:

### Check Views Exist
```sql
SELECT table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('v_payment_tracking', 'v_landed_cost_summary');
```

Expected: 2 rows (both views should exist)

### Check Indexes
```sql
SELECT tablename, indexname
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename IN ('5.0_purchases', '5.1_purchase_line_items', '6.0_po_costs')
ORDER BY tablename, indexname;
```

Expected: Should see multiple indexes per table

### Test Views Query
```sql
SELECT COUNT(*) FROM v_payment_tracking;
SELECT COUNT(*) FROM v_landed_cost_summary;
```

Expected: Should return counts without errors

### Test AI Assistant
Go to your app and ask the AI assistant a question like:
- "Show me payment status for recent POs"
- "What are the total landed costs?"

Expected: Should return data without errors

## Summary

All application code is already correct. Only database objects (views and indexes) need to be updated via the two migration files created.

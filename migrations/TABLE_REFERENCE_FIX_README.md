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

### 2. 🚨 **CRITICAL: Foreign Key Constraints (BREAKING INSERTS)**
- **Issue:** Foreign key constraints still reference old table names
  - `6.0_po_costs.po_id` → references `6.0_purchases` (should be `5.0_purchases`)
  - `5.1_purchase_line_items.po_id` → references `6.0_purchases` (should be `5.0_purchases`)
- **Impact:** **CANNOT INSERT PO LINE ITEMS** - Error: "relation '6.0_purchases' does not exist"
- **Fix:** Run migration `fix_foreign_key_constraints.sql` **FIRST**

### 3. ❌ Database Views (NEED RECREATION)
- **Issue:** `v_payment_tracking` and `v_landed_cost_summary` views were DROPPED during migration but never recreated
- **Impact:** AI assistant API (`/api/ask/route.ts`) queries these views and will fail
- **Fix:** Run migration `recreate_cost_views.sql`

### 4. ❌ Database Indexes (NEED UPDATE)
- **Issue:** Indexes from `001_critical_indexes.sql` reference old table names
- **Impact:** Performance degradation, possible query failures
- **Fix:** Run migration `update_indexes_for_renamed_tables.sql`

## Migration Order

⚠️ **IMPORTANT: Run Step 1 IMMEDIATELY to fix broken PO line items insert functionality!**

Run these migrations in Supabase SQL Editor in this order:

### Step 1: 🚨 **FIX FOREIGN KEY CONSTRAINTS (CRITICAL)**
```bash
# File: migrations/fix_foreign_key_constraints.sql
```
This:
- Drops old foreign key constraints referencing `6.0_purchases`
- Creates new foreign key constraints referencing `5.0_purchases`
- Fixes broken PO line items insert functionality
- **MUST RUN FIRST** - System is broken without this!

### Step 2: Recreate Views
```bash
# File: migrations/recreate_cost_views.sql
```
This recreates:
- `v_payment_tracking` - Shows payment status for each PO
- `v_landed_cost_summary` - Shows total landed costs for each PO

### Step 3: Update Indexes
```bash
# File: migrations/update_indexes_for_renamed_tables.sql
```
This:
- Drops old indexes on non-existent tables
- Creates indexes on renamed tables `5.0_purchases` and `5.1_purchase_line_items`
- Creates indexes on unified table `6.0_po_costs`

## Verification

After running migrations, verify in Supabase:

### 1. Check Foreign Key Constraints (CRITICAL)
```sql
SELECT
  conname AS constraint_name,
  conrelid::regclass AS table_name,
  confrelid::regclass AS referenced_table,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE confrelid::regclass::text IN ('5.0_purchases', '5.1_purchase_line_items', '6.0_po_costs')
AND contype = 'f'
ORDER BY table_name, constraint_name;
```

Expected: All foreign keys should reference `5.0_purchases` (NOT `6.0_purchases`)

### 2. Test PO Line Items Insert
Go to your app → Insert page → PO Items form:
1. Select a PO from dropdown
2. Fill in line item fields
3. Click "Add Item +"

Expected: Should add item without "relation '6.0_purchases' does not exist" error

### 3. Check Views Exist
```sql
SELECT table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('v_payment_tracking', 'v_landed_cost_summary');
```

Expected: 2 rows (both views should exist)

### 4. Check Indexes
```sql
SELECT tablename, indexname
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename IN ('5.0_purchases', '5.1_purchase_line_items', '6.0_po_costs')
ORDER BY tablename, indexname;
```

Expected: Should see multiple indexes per table

### 5. Test Views Query
```sql
SELECT COUNT(*) FROM v_payment_tracking;
SELECT COUNT(*) FROM v_landed_cost_summary;
```

Expected: Should return counts without errors

### 6. Test AI Assistant
Go to your app and ask the AI assistant a question like:
- "Show me payment status for recent POs"
- "What are the total landed costs?"

Expected: Should return data without errors

## Summary

**Root Cause:** Foreign key constraints in `6.0_po_costs` and `5.1_purchase_line_items` still referenced the old table name `6.0_purchases` which was renamed to `5.0_purchases`.

**Impact:** PO line items insert was completely broken - users couldn't add line items to purchase orders.

**Fix:** Run 3 migrations in order:
1. `fix_foreign_key_constraints.sql` - **CRITICAL** - Fixes broken inserts
2. `recreate_cost_views.sql` - Fixes AI assistant queries
3. `update_indexes_for_renamed_tables.sql` - Improves query performance

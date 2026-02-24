# History Tables Migration Guide

This guide explains how to migrate data from `quote_history` and `purchase_history` into the formal normalized tables.

## 🎯 What This Migration Does

### Quote History → Formal Quote Tables
**From:** `quote_history` (denormalized, 1 row per line item with header info)
**To:**
- `4.0_price_quotes` (quote headers)
- `4.1_price_quote_line_items` (line items linked to quotes)

### Purchase History → Formal PO Tables
**From:** `purchase_history` (denormalized, 1 row per line item with header info)
**To:**
- `6.0_purchases` (PO headers)
- `6.1_purchase_line_items` (line items linked to POs)

---

## 📋 Pre-Migration Checklist

### 1. Check Your History Data
Run this query to see what will be migrated:

```sql
-- Check quote_history data
SELECT
  quote_number,
  quote_date,
  supplier_id,
  COUNT(*) as line_items,
  SUM(quantity * unit_cost) as total_value
FROM quote_history
WHERE quote_number IS NOT NULL
GROUP BY quote_number, quote_date, supplier_id
ORDER BY quote_date DESC;

-- Check purchase_history data
SELECT
  po_number,
  po_date,
  supplier_id,
  COUNT(*) as line_items,
  SUM(quantity * unit_cost) as total_value
FROM purchase_history
WHERE po_number IS NOT NULL
GROUP BY po_number, po_date, supplier_id
ORDER BY po_date DESC;
```

### 2. Check for Missing Components
Ensure all `component_id` references exist:

```sql
-- Missing components in quote_history
SELECT DISTINCT qh.component_id, qh.brand, qh.model_sku, qh.description
FROM quote_history qh
LEFT JOIN "3.0_components" c ON qh.component_id = c.component_id
WHERE qh.component_id IS NOT NULL
  AND c.component_id IS NULL;

-- Missing components in purchase_history
SELECT DISTINCT ph.component_id, ph.brand, ph.model_sku, ph.description
FROM purchase_history ph
LEFT JOIN "3.0_components" c ON ph.component_id = c.component_id
WHERE ph.component_id IS NOT NULL
  AND c.component_id IS NULL;
```

If you find missing components, add them to `3.0_components` first!

### 3. Check for Missing Suppliers
```sql
-- Missing suppliers in quote_history
SELECT DISTINCT qh.supplier_id
FROM quote_history qh
LEFT JOIN "2.0_suppliers" s ON qh.supplier_id = s.supplier_id
WHERE qh.supplier_id IS NOT NULL
  AND s.supplier_id IS NULL;

-- Missing suppliers in purchase_history
SELECT DISTINCT ph.supplier_id
FROM purchase_history ph
LEFT JOIN "2.0_suppliers" s ON ph.supplier_id = s.supplier_id
WHERE ph.supplier_id IS NOT NULL
  AND s.supplier_id IS NULL;
```

---

## 🚀 Running the Migration

### Option 1: Via Supabase Dashboard (Recommended)

1. Go to your Supabase project
2. Navigate to **SQL Editor**
3. Open `/home/user/supabase/migrations/migrate_history_to_formal_tables.sql`
4. **Review the migration script** carefully
5. Click **Run** to execute

### Option 2: Via Supabase CLI

```bash
# From your project directory
supabase db reset  # WARNING: This resets entire database!

# OR run specific migration
psql $DATABASE_URL -f migrations/migrate_history_to_formal_tables.sql
```

### Option 3: Copy-Paste Individual Sections

You can run the migration in stages:

**Stage 1:** Migrate Quotes Only
```sql
-- Copy PART 1 from the migration file
```

**Stage 2:** Verify Quotes Before Proceeding
```sql
-- Run verification queries from the file
```

**Stage 3:** Migrate POs
```sql
-- Copy PART 2 from the migration file
```

---

## ✅ Verification After Migration

### 1. Count Check
Run the verification queries in the migration file:

```sql
-- This should show:
-- - Quote Headers Created
-- - Quote Line Items Created
-- - Original Quote History Records (should match line items)
-- - PO Headers Created
-- - PO Line Items Created
-- - Original Purchase History Records (should match line items)
```

**Expected Results:**
- Line items count should match history records count
- Headers count will be less than history (since grouped)

### 2. Total Value Check
The migration file includes detailed comparison queries:

```sql
-- Compare quote totals (should match)
SELECT quote_number, history_total, migrated_total FROM ...

-- Compare PO totals (should match)
SELECT po_number, history_total, migrated_total FROM ...
```

**All totals should match exactly!**

### 3. Spot Check in UI
1. Go to your `/insert` page
2. Navigate to **Quotes** tab → **Step 2: Quote Items**
3. Select "Link Quote" dropdown
4. You should see migrated quotes with their reference numbers
5. Repeat for **PI/PO** tab → **3. PO Items**

---

## 🔧 Troubleshooting

### Issue: "company_id cannot be null"
**Cause:** `4.0_price_quotes` requires a company_id, but quote_history doesn't have it.

**Fix:** The migration uses the first company by default. To use a specific company:
```sql
-- Edit line 17 in the migration file:
(SELECT company_id FROM "1.0_companies" WHERE legal_name = 'Your Company' LIMIT 1) as company_id
```

### Issue: "Duplicate quote headers"
**Cause:** Same quote_number used for different suppliers or dates.

**Fix:** The migration groups by (quote_number, quote_date, supplier_id). This is correct. Each combination creates a separate quote.

### Issue: "Missing component_id"
**Cause:** History table has NULL component_id values.

**Fix:** These records are skipped. To include them:
1. Manually create components for missing items
2. Update history tables with correct component_ids
3. Re-run migration

### Issue: "Total values don't match"
**Cause:**
- Possible rounding errors
- Missing line items (NULL component_ids)

**Check:**
```sql
-- Find records that weren't migrated
SELECT * FROM quote_history
WHERE quote_number IS NOT NULL
  AND component_id IS NULL;
```

---

## 🗑️ Deleting History Tables (Optional)

**⚠️ ONLY do this after verifying migration is 100% successful!**

### Step 1: Final Backup (Recommended)
```sql
-- Export history tables to CSV from Supabase Dashboard
-- Or create backup tables:
CREATE TABLE quote_history_backup AS SELECT * FROM quote_history;
CREATE TABLE purchase_history_backup AS SELECT * FROM purchase_history;
```

### Step 2: Drop History Tables
```sql
DROP TABLE IF EXISTS quote_history;
DROP TABLE IF EXISTS purchase_history;
```

### Step 3: Update Application Code
Remove references to history tables:
- `/home/user/supabase/hooks/useSupabaseData.ts` - Remove history fetching
- `/home/user/supabase/app/insert/page.tsx` - Remove History Import tab (or keep it for new manual entries)
- `/home/user/supabase/types/database.ts` - Remove QuoteHistory and PurchaseHistory types

---

## 📊 Migration Results Example

**Before:**
```
quote_history: 1,250 records
  - 50 unique quotes (quote_number + date + supplier combinations)

purchase_history: 2,800 records
  - 120 unique POs (po_number + date + supplier combinations)
```

**After:**
```
4.0_price_quotes: 50 headers
4.1_price_quote_line_items: 1,250 line items

6.0_purchases: 120 headers
6.1_purchase_line_items: 2,800 line items

Total: Same data, now properly normalized! ✅
```

---

## 🎓 Understanding the Migration Logic

### How Grouping Works

**Quote History:**
```
| quote_number | quote_date | supplier_id | component | qty | price |
|--------------|------------|-------------|-----------|-----|-------|
| Q-001        | 2024-01-15 | 5           | Comp A    | 10  | 5.00  |
| Q-001        | 2024-01-15 | 5           | Comp B    | 20  | 3.00  |
| Q-001        | 2024-01-15 | 5           | Comp C    | 5   | 10.00 |
```

**Migrates To:**

**4.0_price_quotes (1 header):**
```
| quote_id | pi_number | quote_date | supplier_id | total_value |
|----------|-----------|------------|-------------|-------------|
| 123      | Q-001     | 2024-01-15 | 5           | 160.00      |
```

**4.1_price_quote_line_items (3 line items):**
```
| quote_item_id | quote_id | component | qty | unit_price |
|---------------|----------|-----------|-----|------------|
| 456           | 123      | Comp A    | 10  | 5.00       |
| 457           | 123      | Comp B    | 20  | 3.00       |
| 458           | 123      | Comp C    | 5   | 10.00      |
```

---

## 📞 Need Help?

If you encounter issues:
1. Check the verification queries output
2. Review the troubleshooting section above
3. **DO NOT** drop history tables until migration is verified
4. You can always re-run the migration (it will create duplicates, so clear formal tables first if needed)

---

## ✨ Benefits After Migration

✅ **Single source of truth** - No more data duplication
✅ **Proper relationships** - Foreign keys enforce data integrity
✅ **Better queries** - Can join quotes → PIs → POs easily
✅ **Automatic totals** - Calculate quote/PO totals from line items
✅ **Version tracking** - Use replaces_quote_id / replaces_po_id for amendments
✅ **Cleaner schema** - From 12 tables → 10 tables (or less)

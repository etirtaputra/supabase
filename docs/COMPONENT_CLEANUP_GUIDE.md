# Component Cleanup Guide

## 🎯 Overview

This guide helps you safely clean up and standardize your components database.

**Philosophy:** Analyze → Review → Clean → Verify (Never bulk delete without review!)

---

## 📋 Recommended Cleanup Order

### Phase 1: Analysis (Day 1)
1. Run all analysis queries
2. Export results to CSV
3. Review with team

### Phase 2: Quick Wins (Day 2-3)
4. Fix naming inconsistencies (whitespace, capitalization)
5. Standardize brand names
6. Document naming conventions

### Phase 3: Consolidation (Day 4-5)
7. Merge duplicate components
8. Update references
9. Archive old components

### Phase 4: Deletion (Day 6)
10. Delete truly unused components
11. Verify integrity

---

## 🔍 Step-by-Step Process

### Step 1: Identify Orphaned Components

**Run:** Query from `queries/component_cleanup_analysis.sql` - Section "STEP 1"

**What it finds:**
- Components not used in ANY quotes or POs
- Shows age (days_old) to help determine if truly obsolete

**Action:**
```sql
-- Export to CSV first!
\copy (SELECT * FROM orphaned_components_query) TO 'orphaned_components.csv' CSV HEADER;

-- Review in spreadsheet:
-- - Components < 30 days old: Might be for upcoming quotes - KEEP
-- - Components 30-90 days: Review carefully
-- - Components > 90 days: Likely safe to delete
```

**⚠️ Warning:** Don't delete components created in the last 30 days - they might be for upcoming quotes!

---

### Step 2: Find Duplicates

**Run:** Query "STEP 2: FIND POTENTIAL DUPLICATES"

**What it finds:**
- Components with >70% similar supplier_models
- Same brand + >60% similar descriptions

**Example duplicates:**
| Comp 1 | Comp 2 | Match % | Recommendation |
|--------|--------|---------|----------------|
| "Samsung LCD 6.1inch" | "Samsung LCD 6.1"" | 85% | Merge - keep longer name |
| "XYZ-123" | "XYZ 123" | 90% | Merge - standardize format |
| "Power Supply 5V" (unused) | "Power Supply 5V 2A" (used 10x) | 70% | Delete first, keep second |

**Action:**
1. For each duplicate pair, decide which to keep (usually the one with more usage)
2. Update all references to point to the kept component
3. Delete the obsolete one

**SQL Template:**
```sql
-- Example: Merge component 'abc-123' into 'def-456'

BEGIN;

-- Update quote line items
UPDATE "4.1_price_quote_line_items"
SET component_id = 'def-456'  -- Keep this one
WHERE component_id = 'abc-123';  -- Delete this one

-- Update PO line items
UPDATE "5.1_purchase_line_items"
SET component_id = 'def-456'
WHERE component_id = 'abc-123';

-- Now safe to delete
DELETE FROM "3.0_components"
WHERE component_id = 'abc-123';

COMMIT;
```

---

### Step 3: Review Usage Statistics

**Run:** Query "STEP 3: COMPONENT USAGE STATISTICS"

**What it shows:**
- ❌ UNUSED - Never used in any quote or PO → **Delete candidates**
- ⚠️ INACTIVE - Not used in 1+ year → **Archive or review**
- ⏸️ DORMANT - Not used in 6+ months → **Monitor**
- ✅ ACTIVE - Recently used → **Keep**

**Decision Matrix:**
```
Status          | Usage Count | Age      | Action
----------------|-------------|----------|------------------
UNUSED          | 0           | >90 days | DELETE
UNUSED          | 0           | <90 days | REVIEW (might be new)
INACTIVE        | >0          | Any      | ARCHIVE (keep for history)
DORMANT         | >0          | Any      | MONITOR
ACTIVE          | >0          | Any      | KEEP
```

---

### Step 4: Fix Naming Issues

**Run:** Query "STEP 4: NAMING INCONSISTENCIES"

**Common issues found:**
- ✂️ Leading/trailing spaces: `" Samsung "` → `"Samsung"`
- 🔤 All caps: `"POWER SUPPLY"` → `"Power Supply"`
- 🔡 All lowercase: `"lcd display"` → `"LCD Display"`
- 📏 Too short: `"X"` → Review and expand

**Batch fix template:**
```sql
-- Fix whitespace issues
UPDATE "3.0_components"
SET
  supplier_model = TRIM(supplier_model),
  internal_description = TRIM(internal_description),
  brand = TRIM(brand)
WHERE
  supplier_model != TRIM(supplier_model)
  OR internal_description != TRIM(internal_description)
  OR (brand IS NOT NULL AND brand != TRIM(brand));

-- Fix multiple consecutive spaces
UPDATE "3.0_components"
SET
  supplier_model = REGEXP_REPLACE(supplier_model, '\s+', ' ', 'g'),
  internal_description = REGEXP_REPLACE(internal_description, '\s+', ' ', 'g');
```

---

### Step 5: Standardize Brands

**Run:** Query "STEP 5: BRAND STANDARDIZATION"

**Example output:**
| Normalized | Variants | Component Count | Usage |
|------------|----------|-----------------|-------|
| samsung | ["Samsung", "SAMSUNG", "samsung"] | 45 | High |
| philips | ["Philips", "Phillips"] | 12 | Medium |

**Standardization rules:**
1. Use official brand capitalization (e.g., "Samsung" not "SAMSUNG")
2. Fix common misspellings (e.g., "Phillips" → "Philips")
3. Remove extra spaces

**Batch fix:**
```sql
-- Standardize Samsung variants
UPDATE "3.0_components"
SET brand = 'Samsung'
WHERE LOWER(TRIM(brand)) = 'samsung';

-- Fix Philips misspelling
UPDATE "3.0_components"
SET brand = 'Philips'
WHERE LOWER(TRIM(brand)) IN ('phillips', 'philips');
```

---

## 🛡️ Safety Checklist

Before deleting ANY component:

- [ ] Backup created: `CREATE TABLE components_backup AS SELECT * FROM "3.0_components";`
- [ ] Verified component is not used in quotes
- [ ] Verified component is not used in POs
- [ ] Checked age (>90 days old is safer)
- [ ] Reviewed with team if high-value component
- [ ] Transaction wrapped in BEGIN/COMMIT
- [ ] Tested rollback: `ROLLBACK;` works

---

## 📊 Naming Conventions (Going Forward)

### Supplier Model
- **Format:** Use manufacturer's exact part number
- **Example:** `"SM-S911B"`, `"XYZ-1234-A"`
- **Rules:**
  - No leading/trailing spaces
  - Keep hyphens/dashes as per manufacturer
  - Preserve capitalization from datasheet

### Internal Description
- **Format:** Clear, descriptive, searchable
- **Example:** `"LCD Display 6.1 inch AMOLED FHD+"`, `"Power Supply 5V 2A Switching"`
- **Rules:**
  - Start with component type
  - Include key specs (size, voltage, etc.)
  - Use standard abbreviations (LCD, AMOLED, etc.)
  - No brand name (that's in brand field)

### Brand
- **Format:** Official brand name with correct capitalization
- **Example:** `"Samsung"`, `"Philips"`, `"Bosch"`
- **Rules:**
  - Use official spelling
  - Trim whitespace
  - Null for OEM/generic parts

---

## 🔄 Ongoing Maintenance

### Weekly:
- Review new components for duplicates
- Check for naming convention violations

### Monthly:
- Run usage statistics query
- Archive dormant components

### Quarterly:
- Full cleanup review
- Update naming conventions if needed

---

## 📈 Success Metrics

After cleanup, you should see:

- ✅ 0 orphaned components (or only very recent ones)
- ✅ 0 duplicate components
- ✅ 0 naming inconsistencies
- ✅ All brands standardized
- ✅ Faster search/autocomplete
- ✅ Easier component selection in forms

---

## 🆘 Troubleshooting

### "I accidentally deleted the wrong component!"
```sql
-- Restore from backup
INSERT INTO "3.0_components"
SELECT * FROM components_backup
WHERE component_id = 'the-deleted-id';
```

### "The merge broke references!"
```sql
-- Rollback the transaction
ROLLBACK;

-- Check what would be affected first
SELECT 'quote_line_items' as table_name, COUNT(*) as affected_rows
FROM "4.1_price_quote_line_items"
WHERE component_id = 'component-to-delete'
UNION ALL
SELECT 'po_line_items', COUNT(*)
FROM "5.1_purchase_line_items"
WHERE component_id = 'component-to-delete';
```

### "Query is too slow!"
```sql
-- Make sure indexes exist
CREATE INDEX IF NOT EXISTS idx_quote_line_items_component
  ON "4.1_price_quote_line_items"(component_id);

CREATE INDEX IF NOT EXISTS idx_po_line_items_component
  ON "5.1_purchase_line_items"(component_id);
```

---

## 📝 Example Cleanup Session

```sql
-- Day 1: Analysis
-- Run all 5 analysis queries
-- Export results to CSV
-- Share with team

-- Day 2: Quick wins
BEGIN;

-- Fix whitespace
UPDATE "3.0_components"
SET
  supplier_model = TRIM(supplier_model),
  internal_description = TRIM(internal_description),
  brand = TRIM(brand);

-- Standardize Samsung
UPDATE "3.0_components"
SET brand = 'Samsung'
WHERE LOWER(TRIM(brand)) = 'samsung';

COMMIT;

-- Day 3: Merge duplicates (example)
BEGIN;

-- Merge "LCD Display 6.1inch" into "LCD Display 6.1 inch AMOLED"
UPDATE "4.1_price_quote_line_items"
SET component_id = 'keep-this-id'
WHERE component_id = 'delete-this-id';

UPDATE "5.1_purchase_line_items"
SET component_id = 'keep-this-id'
WHERE component_id = 'delete-this-id';

DELETE FROM "3.0_components"
WHERE component_id = 'delete-this-id';

COMMIT;

-- Day 4: Delete unused (>90 days old)
BEGIN;

CREATE TABLE components_backup AS
SELECT * FROM "3.0_components";

DELETE FROM "3.0_components"
WHERE component_id IN (
  -- List of IDs from Step 1 query
  -- Only include components >90 days old
);

-- Verify
SELECT COUNT(*) FROM "3.0_components";

COMMIT;
```

---

## ✅ Completion Checklist

- [ ] All analysis queries run
- [ ] Orphaned components reviewed and handled
- [ ] Duplicates merged or deleted
- [ ] Naming inconsistencies fixed
- [ ] Brands standardized
- [ ] Naming conventions documented
- [ ] Backup tables created and verified
- [ ] Team trained on new conventions
- [ ] Ongoing maintenance scheduled

**Result:** A clean, consistent, well-maintained components database! 🎉

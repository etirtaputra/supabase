# PI & Costs Merge Migration Guide

## 🎯 What This Migration Does

This migration simplifies your database by merging 3 tables into 2:

### Merge 1: Proforma Invoices → Purchases
**Before:**
- `5.0_proforma_invoices` (separate table, 16 records)
- `6.0_purchases` (links to PI via pi_id)

**After:**
- `6.0_purchases` (includes PI fields: pi_number, pi_date, pi_status, quote_id)
- PI data embedded in PO rows (only populated for the 10% of POs that use PIs)

### Merge 2: Payments + Landed Costs → PO Costs
**Before:**
- `7.0_payment_details` (payment_deposit, payment_balance, etc.)
- `7.1_landed_costs` (freight, customs, duties, insurance)

**After:**
- `po_costs` (unified cost tracking with cost_category field)

---

## 📊 Impact Summary

**Tables Removed:** 3
- ❌ `5.0_proforma_invoices`
- ❌ `7.0_payment_details`
- ❌ `7.1_landed_costs`

**Tables Added:** 1
- ✅ `po_costs` (unified cost table)

**Net Result:** 10 tables → 8 tables ✨

**Data Loss:** NONE (all data migrated)

---

## ⚠️ Pre-Migration Checklist

### 1. Backup Your Database
```bash
# Export current data
pg_dump $DATABASE_URL > backup_before_merge.sql
```

Or use Supabase Dashboard → Database → Backups

### 2. Check Current Counts
Run this in SQL Editor to know what to expect:
```sql
SELECT '5.0_proforma_invoices' as table_name, COUNT(*) FROM "5.0_proforma_invoices"
UNION ALL
SELECT '7.0_payment_details', COUNT(*) FROM "7.0_payment_details"
UNION ALL
SELECT '7.1_landed_costs', COUNT(*) FROM "7.1_landed_costs";
```

Note these numbers - you'll verify them after migration.

### 3. Ensure No Active Connections
Stop your application temporarily to avoid conflicts.

---

## 🚀 Running the Migration

### Option 1: Via Supabase Dashboard (Recommended)

1. Go to Supabase Dashboard → SQL Editor
2. Create a new query
3. Copy the entire content of `/migrations/merge_pi_and_costs.sql`
4. Paste into SQL Editor
5. Review the script
6. Click **Run**
7. Wait for completion (should take < 1 minute)

### Option 2: Via psql

```bash
psql $DATABASE_URL -f migrations/merge_pi_and_costs.sql
```

---

## ✅ Post-Migration Verification

The migration includes verification queries that run automatically. You should see:

```
check_type                          | count
------------------------------------|-------
Purchases with PI data              | 16
Purchases without PI (direct)       | 148
Total PO costs (from both sources)  | XXX
Payment-type costs                  | XXX
Landed-type costs                   | XXX
Purchase history view records       | XXX
```

### Manual Verification

**1. Check PI data migrated correctly:**
```sql
SELECT po_number, pi_number, pi_date, quote_id
FROM "6.0_purchases"
WHERE pi_number IS NOT NULL
LIMIT 5;
```

Should show 16 rows with PI data.

**2. Check costs merged correctly:**
```sql
SELECT cost_category, COUNT(*), SUM(amount)
FROM po_costs
GROUP BY cost_category;
```

Should show all payment and landed cost categories.

**3. Check views still work:**
```sql
SELECT * FROM purchase_history LIMIT 5;
SELECT * FROM v_po_costs_summary LIMIT 5;
```

---

## 🔧 Updating Your Application

### 1. Update Type Definitions

**File:** `/home/user/supabase/types/database.ts`

**Remove:**
```typescript
export interface ProformaInvoice extends BaseEntity {
  pi_id: number;
  quote_id?: number;
  pi_number: string;
  pi_date: string;
  status?: ProformaStatus;
  replaces_pi_id?: number;
}

export interface PaymentDetail extends BaseEntity {
  payment_id: number;
  po_id: number;
  category: PaymentCategory;
  amount: number;
  currency: Currency;
  payment_date: string;
  notes?: string;
}

export interface LandedCost extends BaseEntity {
  landed_cost_id: number;
  po_id: number;
  cost_type: LandedCostsType;
  amount: number;
  currency: Currency;
  payment_date?: string;
  notes?: string;
}
```

**Add/Update:**
```typescript
export interface PurchaseOrder extends BaseEntity {
  po_id: number;
  po_number: string;
  po_date: string;

  // PI fields (nullable - only for POs with PI)
  pi_number?: string;
  pi_date?: string;
  pi_status?: ProformaStatus;

  // Direct quote linkage (skip PI)
  quote_id?: number;

  // Other existing fields...
  incoterms?: string;
  method_of_shipment?: MethodOfShipment;
  currency: Currency;
  exchange_rate?: number;
  total_value?: number;
  payment_terms?: string;
  freight_charges_intl?: number;
  estimated_delivery_date?: string;
  actual_delivery_date?: string;
  actual_received_date?: string;
  status?: PurchasesStatus;
  replaces_po_id?: number;
  replaces_pi_id?: number;
}

export interface POCost extends BaseEntity {
  cost_id: number;
  po_id: number;
  cost_category: 'payment_deposit' | 'payment_balance' | 'payment_full' |
                 'freight' | 'customs' | 'duties' | 'insurance' |
                 'handling' | 'storage' | 'other';
  amount: number;
  currency: Currency;
  payment_date?: string;
  notes?: string;
}
```

**Update DatabaseData:**
```typescript
export interface DatabaseData {
  companies: Company[];
  suppliers: Supplier[];
  components: Component[];
  quotes: PriceQuote[];
  quoteItems: PriceQuoteLineItem[];
  // pis: ProformaInvoice[]; // REMOVED
  pos: PurchaseOrder[];
  poItems: PurchaseLineItem[];
  // payments: PaymentDetail[]; // REMOVED
  // landedCosts: LandedCost[]; // REMOVED
  poCosts: POCost[]; // ADDED
}
```

### 2. Update Data Fetching

**File:** `/home/user/supabase/hooks/useSupabaseData.ts`

**Remove:**
```typescript
supabase
  .from(TABLE_NAMES.PROFORMA_INVOICES)
  .select('*')
  .order('pi_date', { ascending: false })
  .then(({ data: pis }) => {
    if (pis) setData((prev) => ({ ...prev, pis }));
  });

supabase
  .from(TABLE_NAMES.PAYMENT_DETAILS)
  .select('*')
  .then(({ data: payments }) => {
    if (payments) setData((prev) => ({ ...prev, payments }));
  });

supabase
  .from(TABLE_NAMES.LANDED_COSTS)
  .select('*')
  .then(({ data: landedCosts }) => {
    if (landedCosts) setData((prev) => ({ ...prev, landedCosts }));
  });
```

**Add:**
```typescript
supabase
  .from('po_costs')
  .select('*')
  .order('payment_date', { ascending: false })
  .then(({ data: poCosts }) => {
    if (poCosts) setData((prev) => ({ ...prev, poCosts }));
  });
```

### 3. Update Forms

**File:** `/home/user/supabase/app/insert/page.tsx`

**Update PI/PO Tab:**

Replace the separate PI form + PO form with a single unified PO form:

```tsx
{activeTab === 'ordering' && (
  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
    <SimpleForm
      title="Purchase Order"
      fields={[
        // Optional: Link to Quote (skips PI)
        { name: 'quote_id', label: 'Link Quote', type: 'select', options: options.quotes },

        // PI fields (optional)
        { name: 'pi_number', label: 'PI #', type: 'text' },
        { name: 'pi_date', label: 'PI Date', type: 'date' },
        { name: 'pi_status', label: 'PI Status', type: 'select', options: ENUMS.proforma_status },

        // PO fields (required)
        { name: 'po_number', label: 'PO #', type: 'text', req: true },
        { name: 'po_date', label: 'PO Date', type: 'date', req: true },
        { name: 'currency', label: 'Currency', type: 'select', options: ENUMS.currency, req: true },
        { name: 'total_value', label: 'Total Value', type: 'number' },
        { name: 'payment_terms', label: 'Terms', type: 'text' },
        { name: 'incoterms', label: 'Incoterms', type: 'text' },
        { name: 'status', label: 'Status', type: 'select', options: ENUMS.purchases_status, default: 'Draft' },
      ]}
      onSubmit={(d) => handleInsert('6.0_purchases', d)}
      loading={loading}
    />

    <BatchLineItemsForm
      title="PO Items"
      enablePdfUpload={true}
      parentField={{ name: 'po_id', label: 'Select PO', options: options.pos }}
      itemFields={[...]} // same as before
      onSubmit={(items) => handleInsert('6.1_purchase_line_items', items)}
      loading={loading}
    />
  </div>
)}
```

**Update Financials Tab:**

Merge Payment Records and Landed Costs into single form:

```tsx
{activeTab === 'financials' && (
  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
    <BatchLineItemsForm
      title="PO Costs (Payments & Landed Costs)"
      parentField={{ name: 'po_id', label: 'Select PO', options: options.pos }}
      itemFields={[
        {
          name: 'cost_category',
          label: 'Category',
          type: 'select',
          options: [
            { val: 'payment_deposit', txt: 'Payment - Deposit' },
            { val: 'payment_balance', txt: 'Payment - Balance' },
            { val: 'payment_full', txt: 'Payment - Full' },
            { val: 'freight', txt: 'Freight' },
            { val: 'customs', txt: 'Customs' },
            { val: 'duties', txt: 'Duties' },
            { val: 'insurance', txt: 'Insurance' },
            { val: 'handling', txt: 'Handling' },
            { val: 'storage', txt: 'Storage' },
            { val: 'other', txt: 'Other' },
          ],
          req: true
        },
        { name: 'amount', label: 'Amount', type: 'number', req: true },
        { name: 'currency', label: 'Currency', type: 'select', options: ENUMS.currency, req: true },
        { name: 'payment_date', label: 'Date', type: 'date', req: true },
        { name: 'notes', label: 'Notes', type: 'text' },
      ]}
      stickyFields={['currency', 'payment_date']}
      onSubmit={(items) => handleInsert('po_costs', items)}
      loading={loading}
    />
  </div>
)}
```

### 4. Update Table Names Constant

**File:** `/home/user/supabase/constants/tableNames.ts`

```typescript
export const TABLE_NAMES = {
  COMPANIES: '1.0_companies',
  SUPPLIERS: '2.0_suppliers',
  COMPONENTS: '3.0_components',
  PRICE_QUOTES: '4.0_price_quotes',
  PRICE_QUOTE_LINE_ITEMS: '4.1_price_quote_line_items',
  // PROFORMA_INVOICES: '5.0_proforma_invoices', // REMOVED
  PURCHASES: '6.0_purchases',
  PURCHASE_LINE_ITEMS: '6.1_purchase_line_items',
  // PAYMENT_DETAILS: '7.0_payment_details', // REMOVED
  // LANDED_COSTS: '7.1_landed_costs', // REMOVED
  PO_COSTS: 'po_costs', // ADDED
} as const;
```

---

## 🎓 Understanding the New Structure

### Workflow Options After Migration

**Option 1: Full workflow with PI**
```
Quote → Create PO with PI fields filled → Add PO Items
```

**Option 2: Direct PO (skip PI)**
```
Quote → Create PO (leave PI fields empty) → Add PO Items
```

**Option 3: Standalone PO (no quote)**
```
Create PO directly (leave both quote_id and PI fields empty)
```

### Cost Tracking

All costs now in one table:
```
po_costs:
  - payment_deposit, payment_balance, payment_full
  - freight, customs, duties, insurance
  - handling, storage, other
```

Query example:
```sql
-- Get total payments for a PO
SELECT SUM(amount) FROM po_costs
WHERE po_id = 'xxx' AND cost_category LIKE 'payment_%';

-- Get total landed costs for a PO
SELECT SUM(amount) FROM po_costs
WHERE po_id = 'xxx' AND cost_category IN ('freight', 'customs', 'duties');
```

---

## 🐛 Troubleshooting

### Issue: "column pi_id does not exist"
**Cause:** Old code still referencing pi_id
**Fix:** Update code to use pi_number, pi_date, pi_status instead

### Issue: "table 7.0_payment_details does not exist"
**Cause:** Old code still referencing removed tables
**Fix:** Update to use po_costs table

### Issue: Migration fails midway
**Cause:** Database state inconsistency
**Fix:** Restore from backup and re-run migration

---

## ✨ Benefits After Migration

✅ **Simpler schema** - 8 tables instead of 10
✅ **Flexible PI usage** - Use PI when needed, skip when not
✅ **Unified cost tracking** - All costs in one place
✅ **Better queries** - Direct quote → PO linkage
✅ **Less duplication** - No separate PI table for 10% use case
✅ **Cleaner UI** - Single PO form instead of PI → PO workflow

---

## 📞 Support

If you encounter issues:
1. Check the verification queries output
2. Restore from backup if needed
3. Review the troubleshooting section
4. Migration is idempotent - can re-run if needed (after dropping new columns/tables)

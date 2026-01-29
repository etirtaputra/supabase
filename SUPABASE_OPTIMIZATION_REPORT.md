# Supabase Database Optimization Report

## Executive Summary
This report analyzes your supply chain management database consisting of **12 tables** and **9 views** (including 1 materialized view). The system handles companies, suppliers, components, quotes, purchase orders, payments, and landed costs.

---

## 🔴 CRITICAL ISSUES

### 1. **Missing Indexes on Foreign Keys**

Your schema has extensive foreign key relationships that are likely unindexed:

**Tables with foreign keys needing indexes:**

```sql
-- 4.0_price_quotes
CREATE INDEX idx_price_quotes_supplier_id ON "4.0_price_quotes"(supplier_id);
CREATE INDEX idx_price_quotes_company_id ON "4.0_price_quotes"(company_id);
CREATE INDEX idx_price_quotes_replaces_quote_id ON "4.0_price_quotes"(replaces_quote_id) WHERE replaces_quote_id IS NOT NULL;

-- 4.1_price_quote_line_items
CREATE INDEX idx_quote_line_items_quote_id ON "4.1_price_quote_line_items"(quote_id);
CREATE INDEX idx_quote_line_items_component_id ON "4.1_price_quote_line_items"(component_id);

-- 5.0_proforma_invoices
CREATE INDEX idx_proforma_invoices_quote_id ON "5.0_proforma_invoices"(quote_id) WHERE quote_id IS NOT NULL;
CREATE INDEX idx_proforma_invoices_replaces_pi_id ON "5.0_proforma_invoices"(replaces_pi_id) WHERE replaces_pi_id IS NOT NULL;

-- 6.0_purchases
CREATE INDEX idx_purchases_pi_id ON "6.0_purchases"(pi_id) WHERE pi_id IS NOT NULL;
CREATE INDEX idx_purchases_replaces_po_id ON "6.0_purchases"(replaces_po_id) WHERE replaces_po_id IS NOT NULL;

-- 6.1_purchase_line_items
CREATE INDEX idx_purchase_line_items_po_id ON "6.1_purchase_line_items"(po_id);
CREATE INDEX idx_purchase_line_items_component_id ON "6.1_purchase_line_items"(component_id);

-- 7.0_payment_details
CREATE INDEX idx_payment_details_po_id ON "7.0_payment_details"(po_id);

-- 7.1_landed_costs
CREATE INDEX idx_landed_costs_po_id ON "7.1_landed_costs"(po_id);
```

**Impact:** Without these indexes, JOIN operations in your 9 views will perform full table scans, causing severe performance degradation as data grows.

---

### 2. **Missing Indexes for Common Queries**

Based on your `/api/ask/route.ts`, these queries run on EVERY request:

```sql
-- Used in keyword filtering (route.ts:29-30, 38-39, 42-43)
CREATE INDEX idx_suppliers_name_trgm ON "2.0_suppliers" USING gin(supplier_name gin_trgm_ops);
CREATE INDEX idx_components_model_sku_trgm ON "3.0_components" USING gin(model_sku gin_trgm_ops);
CREATE INDEX idx_components_description_trgm ON "3.0_components" USING gin(description gin_trgm_ops);

-- Enable pg_trgm extension first
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Date-based sorting (used in all 9 view queries)
CREATE INDEX idx_price_quotes_quote_date_desc ON "4.0_price_quotes"(quote_date DESC);
CREATE INDEX idx_purchases_po_date_desc ON "6.0_purchases"(po_date DESC);

-- Status filtering (likely used frequently)
CREATE INDEX idx_price_quotes_status ON "4.0_price_quotes"(status) WHERE status IS NOT NULL;
CREATE INDEX idx_proforma_invoices_status ON "5.0_proforma_invoices"(status) WHERE status IS NOT NULL;
CREATE INDEX idx_purchases_status ON "6.0_purchases"(status) WHERE status IS NOT NULL;
```

**Impact:**
- **~10x slower text searches** without trigram indexes
- **Full table scans** on date sorting for history queries
- **Inefficient status filtering** on dashboard/list views

---

### 3. **Inefficient View Query Pattern**

**Problem identified in `route.ts:46-91`:**

You're fetching from **9 different views on EVERY API request**, even when the user query might only need 1-2 of them:

```javascript
const [poReq, quoteReq, statsReq, supplierPerfReq, ...] = await Promise.all([
  supabase.from('v_analytics_master').select('*')...
  supabase.from('v_quotes_analytics').select('*')...
  // ... 7 more views
]);
```

**Issues:**
1. **Over-fetching data:** If user asks "What's the latest quote?", you still query purchase history, landed costs, payment tracking, etc.
2. **Unnecessary compute:** Each view may join 3-5 tables
3. **API response delay:** ~300-900ms total even with parallel requests

**Solution - Smart Query Selection:**

```javascript
// Add at the top of route.ts
function determineRequiredViews(query: string): string[] {
  const lowerQuery = query.toLowerCase();
  const views: string[] = [];

  // Always include these for context
  views.push('v_analytics_master', 'v_quotes_analytics');

  // Conditional views based on keywords
  if (lowerQuery.includes('supplier') || lowerQuery.includes('reliability') ||
      lowerQuery.includes('performance')) {
    views.push('v_supplier_performance');
  }

  if (lowerQuery.includes('payment') || lowerQuery.includes('outstanding') ||
      lowerQuery.includes('balance')) {
    views.push('v_payment_tracking');
  }

  if (lowerQuery.includes('landed cost') || lowerQuery.includes('duty') ||
      lowerQuery.includes('import') || lowerQuery.includes('true cost')) {
    views.push('v_landed_cost_summary');
  }

  if (lowerQuery.includes('demand') || lowerQuery.includes('frequency') ||
      lowerQuery.includes('reorder')) {
    views.push('v_component_demand');
  }

  if (lowerQuery.includes('history') || lowerQuery.includes('trend') ||
      lowerQuery.includes('compare')) {
    views.push('v_quote_history_analytics', 'v_purchase_history_analytics');
    views.push('mv_component_analytics');
  }

  return [...new Set(views)]; // Remove duplicates
}

// Then conditionally fetch only needed views
const requiredViews = determineRequiredViews(query);
const viewData: Record<string, any[]> = {};

await Promise.all(
  requiredViews.map(async (viewName) => {
    const { data } = await supabase.from(viewName).select('*').limit(10);
    viewData[viewName] = data || [];
  })
);
```

**Expected improvement:** 30-60% faster response times for specific queries.

---

## 🟡 MEDIUM PRIORITY ISSUES

### 4. **Inefficient Data Fetching Hook (useSupabaseData.ts)**

**Problems in lines 32-120:**

1. **Sequential non-blocking queries** (lines 52-113):
   ```javascript
   // Critical data loaded first (GOOD)
   await Promise.all([companies, suppliers, components]);

   // But then 8 more queries fire-and-forget (INEFFICIENT)
   supabase.from(TABLE_NAMES.PRICE_QUOTES).select('*').then(...)
   supabase.from(TABLE_NAMES.PRICE_QUOTE_LINE_ITEMS).select('*').then(...)
   // ... 6 more
   ```

2. **No pagination** - `SELECT *` on all tables
3. **Loads immediately** - No lazy loading option

**Optimization:**

```javascript
// Option 1: Add pagination
const INITIAL_LOAD_LIMIT = 100; // Only load recent records initially

const [compRows, sup, comp] = await Promise.all([
  supabase.from(TABLE_NAMES.COMPANIES).select('company_id, legal_name'),
  supabase.from(TABLE_NAMES.SUPPLIERS).select('*').limit(INITIAL_LOAD_LIMIT),
  supabase.from(TABLE_NAMES.COMPONENTS).select('*').limit(INITIAL_LOAD_LIMIT),
]);

// Option 2: Make second batch parallel too
const secondBatch = await Promise.all([
  supabase.from(TABLE_NAMES.PRICE_QUOTES).select('*').limit(INITIAL_LOAD_LIMIT),
  supabase.from(TABLE_NAMES.PRICE_QUOTE_LINE_ITEMS).select('*').limit(INITIAL_LOAD_LIMIT),
  // ... rest
]);

// Option 3: Add lazy loading flag
export function useSupabaseData(loadAll = false) {
  // Only fetch foundation data initially
  // Load transactional data on-demand
}
```

---

### 5. **Missing Composite Indexes for Analytics**

Your views likely perform these JOINs frequently:

```sql
-- For purchase history queries
CREATE INDEX idx_purchases_supplier_date ON "6.0_purchases"(supplier_id, po_date DESC);

-- For component analytics
CREATE INDEX idx_purchase_items_component_qty ON "6.1_purchase_line_items"(component_id, quantity);
CREATE INDEX idx_quote_items_component_price ON "4.1_price_quote_line_items"(component_id, unit_price);

-- For payment tracking
CREATE INDEX idx_payments_po_category ON "7.0_payment_details"(po_id, category, payment_date);

-- For landed costs analysis
CREATE INDEX idx_landed_costs_po_type ON "7.1_landed_costs"(po_id, cost_type);
```

---

### 6. **Table Name Convention Issues**

**Problem:** Table names like `"1.0_companies"` require double-quotes everywhere and are not URL-friendly.

**Current:**
```sql
SELECT * FROM "4.1_price_quote_line_items"  -- Requires quotes
```

**Recommendation:**
```sql
-- Better naming (if migrating):
companies
suppliers
components
price_quotes
price_quote_line_items
proforma_invoices
purchase_orders
purchase_order_line_items
payment_details
landed_costs
```

**Migration strategy:**
1. Create new tables with better names
2. Create views with old names pointing to new tables (for backwards compatibility)
3. Gradually update application code
4. Drop views after full migration

---

## 🟢 OPTIMIZATION OPPORTUNITIES

### 7. **Materialized View - Good Practice, But Needs Refresh Strategy**

You have `mv_component_analytics` (line 59 in route.ts) - this is excellent for complex aggregations!

**Issues:**
- No documented refresh strategy
- May serve stale data

**Solution:**

```sql
-- Option 1: Auto-refresh via cron (Supabase supports pg_cron)
-- Refresh daily at 1 AM
SELECT cron.schedule(
  'refresh-component-analytics',
  '0 1 * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_component_analytics$$
);

-- Option 2: Trigger-based refresh (for near real-time)
CREATE OR REPLACE FUNCTION refresh_component_analytics()
RETURNS TRIGGER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_component_analytics;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_refresh_analytics
AFTER INSERT OR UPDATE OR DELETE ON "6.1_purchase_line_items"
FOR EACH STATEMENT
EXECUTE FUNCTION refresh_component_analytics();

-- Option 3: Manual refresh endpoint (best for control)
-- Create a serverless function that calls:
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_component_analytics;
```

**Recommendation:** Use Option 3 (manual via cron job) to control refresh timing and avoid performance impact during business hours.

---

### 8. **Add Partial Indexes for Soft Deletes / Status Filtering**

If you're filtering by status frequently:

```sql
-- Only index active/pending records (saves space & improves performance)
CREATE INDEX idx_quotes_active ON "4.0_price_quotes"(quote_date DESC)
  WHERE status IN ('pending', 'active');

CREATE INDEX idx_po_open ON "6.0_purchases"(po_date DESC)
  WHERE status IN ('pending', 'in_transit', 'received');
```

---

### 9. **Query Optimization - Text Search**

**Current issue in route.ts:24-30:**

```javascript
// Inefficient: Multiple ILIKE queries
const filterString = keywords.map((k: string) =>
  `supplier_name.ilike.%${k}%,model_sku.ilike.%${k}%,component_name.ilike.%${k}%`
).join(',');
```

**Better approach with Full-Text Search:**

```sql
-- Add tsvector columns
ALTER TABLE "2.0_suppliers"
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(supplier_name, '') || ' ' || coalesce(supplier_code, ''))
  ) STORED;

ALTER TABLE "3.0_components"
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(model_sku, '') || ' ' ||
      coalesce(description, '') || ' ' ||
      coalesce(brand, '')
    )
  ) STORED;

-- Create GIN indexes
CREATE INDEX idx_suppliers_search ON "2.0_suppliers" USING gin(search_vector);
CREATE INDEX idx_components_search ON "3.0_components" USING gin(search_vector);
```

**Update query to:**
```javascript
const searchQuery = keywords.join(' | '); // OR search
const { data } = await supabase
  .from('2.0_suppliers')
  .select('*')
  .textSearch('search_vector', searchQuery);
```

**Performance gain:** 100-1000x faster on text searches with >10,000 rows.

---

### 10. **Add Database Constraints**

**Missing constraints (based on TypeScript types):**

```sql
-- Ensure valid foreign keys
ALTER TABLE "4.0_price_quotes"
  ADD CONSTRAINT fk_quotes_supplier
    FOREIGN KEY (supplier_id) REFERENCES "2.0_suppliers"(supplier_id),
  ADD CONSTRAINT fk_quotes_company
    FOREIGN KEY (company_id) REFERENCES "1.0_companies"(company_id);

-- Ensure positive values
ALTER TABLE "4.1_price_quote_line_items"
  ADD CONSTRAINT chk_quantity_positive CHECK (quantity > 0),
  ADD CONSTRAINT chk_unit_price_positive CHECK (unit_price > 0);

ALTER TABLE "6.1_purchase_line_items"
  ADD CONSTRAINT chk_quantity_positive CHECK (quantity > 0),
  ADD CONSTRAINT chk_unit_cost_positive CHECK (unit_cost > 0);

-- Ensure valid dates
ALTER TABLE "4.0_price_quotes"
  ADD CONSTRAINT chk_quote_date_valid CHECK (quote_date <= CURRENT_DATE + interval '1 day');

ALTER TABLE "6.0_purchases"
  ADD CONSTRAINT chk_po_dates CHECK (
    po_date <= COALESCE(estimated_delivery_date, po_date + interval '365 days')
  );

-- Ensure consistent currency handling
ALTER TABLE "4.1_price_quote_line_items"
  ADD CONSTRAINT chk_currency_matches_quote
    CHECK (currency = (SELECT currency FROM "4.0_price_quotes" WHERE quote_id = "4.1_price_quote_line_items".quote_id));
```

---

### 11. **Performance Monitoring Setup**

Add these helper functions to track slow queries:

```sql
-- Enable query stats
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- View to identify slow queries
CREATE OR REPLACE VIEW v_slow_queries AS
SELECT
  query,
  calls,
  total_exec_time,
  mean_exec_time,
  max_exec_time,
  rows
FROM pg_stat_statements
WHERE mean_exec_time > 100  -- Queries averaging >100ms
ORDER BY mean_exec_time DESC
LIMIT 50;

-- Grant access
GRANT SELECT ON v_slow_queries TO authenticated;
```

---

## 📊 ESTIMATED PERFORMANCE IMPACT

| Optimization | Expected Improvement | Effort |
|--------------|---------------------|--------|
| Foreign key indexes | **50-500x faster** JOINs | Low (30 min) |
| Trigram indexes for search | **10-100x faster** text search | Low (15 min) |
| Smart view selection | **30-60% faster** API responses | Medium (2 hours) |
| Materialized view refresh | **Consistent sub-100ms** analytics | Low (30 min) |
| Full-text search | **100-1000x faster** search | Medium (1 hour) |
| Composite indexes | **2-10x faster** analytics queries | Low (30 min) |
| useSupabaseData pagination | **70-90% faster** initial page load | Medium (1 hour) |

---

## 🚀 IMPLEMENTATION PRIORITY

### Phase 1 - Immediate (Day 1)
1. ✅ Add foreign key indexes (all 11 relationships)
2. ✅ Add date indexes for sorting
3. ✅ Add status indexes

### Phase 2 - This Week
4. ✅ Implement trigram indexes for text search
5. ✅ Set up materialized view refresh schedule
6. ✅ Add composite indexes for analytics

### Phase 3 - Next Sprint
7. ✅ Refactor API route for smart view selection
8. ✅ Add pagination to useSupabaseData hook
9. ✅ Implement full-text search with tsvector

### Phase 4 - Future Optimization
10. ✅ Add database constraints
11. ✅ Set up performance monitoring
12. ✅ Consider table rename migration (if feasible)

---

## 📝 TESTING RECOMMENDATIONS

After implementing indexes:

```sql
-- 1. Verify index usage
EXPLAIN ANALYZE
SELECT * FROM "4.0_price_quotes" pq
JOIN "4.1_price_quote_line_items" pli ON pq.quote_id = pli.quote_id
WHERE pq.supplier_id = 1;

-- Should show "Index Scan" not "Seq Scan"

-- 2. Check index sizes
SELECT
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC;

-- 3. Monitor query performance before/after
SELECT
  query,
  calls,
  mean_exec_time,
  max_exec_time
FROM pg_stat_statements
WHERE query LIKE '%price_quotes%'
ORDER BY mean_exec_time DESC;
```

---

## 🔒 SECURITY RECOMMENDATIONS

Based on your codebase:

1. **Row Level Security (RLS)** - Ensure RLS policies are active on all tables
2. **Service Role Key** - Only use in API routes (line 16 in route.ts), never expose to client
3. **Input Sanitization** - Your keyword filtering is good, but consider parameterized queries for complex filters

---

## 📈 NEXT STEPS

1. **Backup your database** before making any changes
2. **Apply Phase 1 indexes** in a staging environment first
3. **Run EXPLAIN ANALYZE** on critical queries before/after
4. **Monitor API response times** using application logs
5. **Set up pg_stat_statements** to track query performance over time

---

## 🛠️ SQL SCRIPT GENERATION

Would you like me to generate a complete SQL migration script with all recommended indexes and optimizations? Let me know which phase you'd like to start with, and I can create a ready-to-run script.

---

**Generated:** 2026-01-28
**Database:** Supabase (PostgreSQL)
**Tables Analyzed:** 12
**Views Analyzed:** 9
**Optimization Opportunities Identified:** 11

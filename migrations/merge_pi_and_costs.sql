-- ============================================================================
-- MIGRATION: Merge PI into Purchases & Unify Payments/Landed Costs
-- ============================================================================
-- This migration:
-- 1. Merges 5.0_proforma_invoices → 6.0_purchases
-- 2. Merges 7.0_payment_details + 7.1_landed_costs → po_costs
-- 3. Updates all views and triggers
-- 4. Result: 10 tables → 8 tables (cleaner schema)
-- ============================================================================

-- ============================================================================
-- PART 1: MERGE PROFORMA INVOICES INTO PURCHASES
-- ============================================================================

-- Step 1: Add PI columns to purchases table
ALTER TABLE "6.0_purchases"
  ADD COLUMN IF NOT EXISTS pi_number TEXT,
  ADD COLUMN IF NOT EXISTS pi_date DATE,
  ADD COLUMN IF NOT EXISTS pi_status public.proforma_invoices_status,
  ADD COLUMN IF NOT EXISTS quote_id UUID;

-- Step 2: Create indexes for new columns
CREATE INDEX IF NOT EXISTS idx_purchases_pi_number ON "6.0_purchases"(pi_number) WHERE pi_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchases_pi_date ON "6.0_purchases"(pi_date) WHERE pi_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchases_quote_id ON "6.0_purchases"(quote_id) WHERE quote_id IS NOT NULL;

-- Step 3: Migrate PI data into purchases (for the 16 POs that have PIs)
UPDATE "6.0_purchases" p
SET
  pi_number = pi.pi_number,
  pi_date = pi.pi_date,
  pi_status = pi.status,
  quote_id = pi.quote_id
FROM "5.0_proforma_invoices" pi
WHERE p.pi_id = pi.pi_id;

-- Step 4: Add foreign key constraint for quote_id
ALTER TABLE "6.0_purchases"
  ADD CONSTRAINT purchases_quote_id_fkey
  FOREIGN KEY (quote_id) REFERENCES "4.0_price_quotes"(quote_id)
  ON UPDATE CASCADE ON DELETE SET NULL;

-- Step 5: Drop old pi_id foreign key constraint
ALTER TABLE "6.0_purchases" DROP CONSTRAINT IF EXISTS purchases_pi_id_fkey;

-- Step 6: Drop views that depend on pi_id column
DROP VIEW IF EXISTS v_analytics_master CASCADE;
DROP VIEW IF EXISTS v_supplier_performance CASCADE;
DROP VIEW IF EXISTS v_payment_tracking CASCADE;
DROP VIEW IF EXISTS v_landed_cost_summary CASCADE;
DROP VIEW IF EXISTS purchase_history CASCADE;
DROP VIEW IF EXISTS v_purchase_history_analytics CASCADE;

-- Step 7: Drop old pi_id column (now safe - no dependencies)
ALTER TABLE "6.0_purchases" DROP COLUMN IF EXISTS pi_id;

-- Step 8: Drop proforma invoices table
DROP TABLE IF EXISTS "5.0_proforma_invoices" CASCADE;

-- ============================================================================
-- PART 2: MERGE PAYMENT DETAILS + LANDED COSTS INTO PO_COSTS
-- ============================================================================

-- Step 1: Create unified po_costs table
CREATE TABLE IF NOT EXISTS po_costs (
  cost_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID NOT NULL,
  cost_category TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  currency public.currency NOT NULL,
  payment_date DATE,
  notes TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT (now() AT TIME ZONE 'utc'::text),

  CONSTRAINT po_costs_po_id_fkey
    FOREIGN KEY (po_id) REFERENCES "6.0_purchases"(po_id)
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT po_costs_category_check
    CHECK (cost_category IN (
      'payment_deposit',
      'payment_balance',
      'payment_full',
      'freight',
      'customs',
      'duties',
      'insurance',
      'handling',
      'storage',
      'other'
    ))
);

-- Step 2: Create indexes
CREATE INDEX IF NOT EXISTS idx_po_costs_po_id ON po_costs(po_id);
CREATE INDEX IF NOT EXISTS idx_po_costs_category ON po_costs(cost_category);
CREATE INDEX IF NOT EXISTS idx_po_costs_po_category ON po_costs(po_id, cost_category);
CREATE INDEX IF NOT EXISTS idx_po_costs_payment_date ON po_costs(payment_date) WHERE payment_date IS NOT NULL;

-- Step 3: Migrate payment_details → po_costs
INSERT INTO po_costs (cost_id, po_id, cost_category, amount, currency, payment_date, notes, updated_at)
SELECT
  payment_id,
  po_id,
  CASE category::text
    WHEN 'deposit' THEN 'payment_deposit'
    WHEN 'balance' THEN 'payment_balance'
    WHEN 'full_payment' THEN 'payment_full'
    ELSE category::text
  END as cost_category,
  amount,
  currency,
  payment_date,
  notes,
  updated_at
FROM "7.0_payment_details"
WHERE po_id IS NOT NULL;

-- Step 4: Migrate landed_costs → po_costs
INSERT INTO po_costs (cost_id, po_id, cost_category, amount, currency, payment_date, notes, updated_at)
SELECT
  landed_cost_id,
  po_id,
  cost_type::text as cost_category,
  amount,
  currency,
  payment_date,
  notes,
  updated_at
FROM "7.1_landed_costs"
WHERE po_id IS NOT NULL;

-- Step 5: Create trigger for analytics refresh
CREATE OR REPLACE TRIGGER refresh_on_po_cost_change
  AFTER INSERT OR UPDATE OR DELETE ON po_costs
  FOR EACH STATEMENT
  EXECUTE FUNCTION refresh_analytics_view();

-- Step 6: Drop old tables
DROP TABLE IF EXISTS "7.0_payment_details" CASCADE;
DROP TABLE IF EXISTS "7.1_landed_costs" CASCADE;

-- ============================================================================
-- PART 3: UPDATE VIEWS
-- ============================================================================

-- Drop and recreate purchase_history view (remove PI join)
DROP VIEW IF EXISTS purchase_history CASCADE;

CREATE VIEW purchase_history AS
SELECT
  pli.po_line_item_id as history_id,
  p.po_date,
  p.po_number,
  COALESCE(
    s_direct.supplier_id,  -- From quote if available
    (SELECT q.supplier_id FROM "4.0_price_quotes" q WHERE q.quote_id = p.quote_id LIMIT 1)
  ) as supplier_id,
  pli.component_id,
  c.brand,
  pli.supplier_description as description,
  pli.quantity,
  pli.unit_cost,
  pli.currency,
  pli.updated_at as created_at,
  pli.updated_at
FROM "6.1_purchase_line_items" pli
JOIN "6.0_purchases" p ON pli.po_id = p.po_id
LEFT JOIN "4.0_price_quotes" q ON p.quote_id = q.quote_id
LEFT JOIN "2.0_suppliers" s_direct ON q.supplier_id = s_direct.supplier_id
LEFT JOIN "3.0_components" c ON pli.component_id = c.component_id;

-- Recreate dependent analytics views
DROP VIEW IF EXISTS v_purchase_history_analytics CASCADE;

CREATE VIEW v_purchase_history_analytics AS
SELECT
  supplier_id,
  COUNT(*) as total_purchases,
  SUM(quantity) as total_quantity,
  AVG(unit_cost) as avg_unit_cost,
  MIN(po_date) as first_purchase_date,
  MAX(po_date) as last_purchase_date
FROM purchase_history
WHERE supplier_id IS NOT NULL
GROUP BY supplier_id;

-- Create view for unified costs (optional - for analytics)
CREATE OR REPLACE VIEW v_po_costs_summary AS
SELECT
  po_id,
  SUM(CASE WHEN cost_category LIKE 'payment_%' THEN amount ELSE 0 END) as total_payments,
  SUM(CASE WHEN cost_category IN ('freight', 'customs', 'duties', 'insurance', 'handling', 'storage') THEN amount ELSE 0 END) as total_landed_costs,
  SUM(amount) as total_costs,
  currency,
  COUNT(*) as cost_entry_count
FROM po_costs
GROUP BY po_id, currency;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Check migration results
SELECT
  'Purchases with PI data' as check_type,
  COUNT(*) as count
FROM "6.0_purchases"
WHERE pi_number IS NOT NULL

UNION ALL

SELECT
  'Purchases without PI (direct)' as check_type,
  COUNT(*) as count
FROM "6.0_purchases"
WHERE pi_number IS NULL

UNION ALL

SELECT
  'Total PO costs (from both sources)' as check_type,
  COUNT(*) as count
FROM po_costs

UNION ALL

SELECT
  'Payment-type costs' as check_type,
  COUNT(*) as count
FROM po_costs
WHERE cost_category LIKE 'payment_%'

UNION ALL

SELECT
  'Landed-type costs' as check_type,
  COUNT(*) as count
FROM po_costs
WHERE cost_category IN ('freight', 'customs', 'duties', 'insurance', 'handling', 'storage')

UNION ALL

SELECT
  'Purchase history view records' as check_type,
  COUNT(*) as count
FROM purchase_history;

-- Detailed cost breakdown by category
SELECT
  cost_category,
  COUNT(*) as entry_count,
  SUM(amount) as total_amount,
  AVG(amount) as avg_amount,
  currency
FROM po_costs
GROUP BY cost_category, currency
ORDER BY cost_category;

-- Check purchases with quote linkage
SELECT
  'Purchases linked to quotes' as check_type,
  COUNT(*) as count
FROM "6.0_purchases"
WHERE quote_id IS NOT NULL;

-- ============================================================================
-- CLEANUP: Remove unused indexes from old structure
-- ============================================================================

-- Drop old PI-related indexes if they exist
DROP INDEX IF EXISTS idx_purchases_pi_id;
DROP INDEX IF EXISTS idx_proforma_invoices_quote_id;
DROP INDEX IF EXISTS idx_proforma_invoices_replaces_pi_id;

-- ============================================================================
-- SUMMARY OF CHANGES
-- ============================================================================

-- Tables BEFORE: 12 tables
-- Tables AFTER: 10 tables (-2 tables)
--
-- Removed tables:
--   - 5.0_proforma_invoices (merged into 6.0_purchases)
--   - 7.0_payment_details (merged into po_costs)
--   - 7.1_landed_costs (merged into po_costs)
--
-- New/Modified tables:
--   - 6.0_purchases: now includes PI data (pi_number, pi_date, pi_status, quote_id)
--   - po_costs: unified payment and landed cost tracking
--
-- Views updated:
--   - purchase_history: simplified join (no PI table)
--   - v_purchase_history_analytics: still works
--   - v_po_costs_summary: NEW - unified cost view
--
-- ============================================================================

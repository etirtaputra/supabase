-- ============================================================================
-- UPDATE INDEXES FOR RENAMED TABLES
-- ============================================================================
-- After renaming:
--   6.0_purchases → 5.0_purchases
--   6.1_purchase_line_items → 5.1_purchase_line_items
--   7.0_payment_details + 7.1_landed_costs → 6.0_po_costs
--
-- This migration ensures all indexes reference the correct table names
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. DROP OLD INDEXES (if they exist on old table names)
-- ============================================================================
DROP INDEX IF EXISTS idx_purchases_pi_id;
DROP INDEX IF EXISTS idx_purchases_replaces_po_id;
DROP INDEX IF EXISTS idx_purchase_line_items_po_id;
DROP INDEX IF EXISTS idx_purchase_line_items_component_id;
DROP INDEX IF EXISTS idx_purchases_po_date_desc;
DROP INDEX IF EXISTS idx_purchases_status;
DROP INDEX IF EXISTS idx_purchases_status_date;
DROP INDEX IF EXISTS idx_purchase_line_items_component_quantity;

-- Drop old payment_details and landed_costs indexes
DROP INDEX IF EXISTS idx_payment_details_po_id;
DROP INDEX IF EXISTS idx_landed_costs_po_id;
DROP INDEX IF EXISTS idx_payments_po_category_date;

-- ============================================================================
-- 2. CREATE INDEXES ON RENAMED PURCHASES TABLE (5.0_purchases)
-- ============================================================================

-- Foreign key indexes
CREATE INDEX IF NOT EXISTS idx_purchases_quote_id
  ON "5.0_purchases"(quote_id)
  WHERE quote_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchases_replaces_po_id
  ON "5.0_purchases"(replaces_po_id)
  WHERE replaces_po_id IS NOT NULL;

COMMENT ON INDEX idx_purchases_quote_id IS 'Links POs to quotes for import functionality';
COMMENT ON INDEX idx_purchases_replaces_po_id IS 'Used for tracking PO revisions';

-- Date sorting index (CRITICAL for API performance)
CREATE INDEX IF NOT EXISTS idx_purchases_po_date_desc
  ON "5.0_purchases"(po_date DESC);

COMMENT ON INDEX idx_purchases_po_date_desc IS 'Used in route.ts ORDER BY po_date DESC - CRITICAL for API performance';

-- Status filtering indexes
CREATE INDEX IF NOT EXISTS idx_purchases_status
  ON "5.0_purchases"(status)
  WHERE status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchases_status_date
  ON "5.0_purchases"(po_date DESC)
  WHERE status = 'Draft';

COMMENT ON INDEX idx_purchases_status IS 'Fast filtering by PO status';
COMMENT ON INDEX idx_purchases_status_date IS 'Used for draft PO queries';

-- ============================================================================
-- 3. CREATE INDEXES ON RENAMED PURCHASE LINE ITEMS (5.1_purchase_line_items)
-- ============================================================================

-- Foreign key indexes (MOST CRITICAL)
CREATE INDEX IF NOT EXISTS idx_purchase_line_items_po_id
  ON "5.1_purchase_line_items"(po_id);

CREATE INDEX IF NOT EXISTS idx_purchase_line_items_component_id
  ON "5.1_purchase_line_items"(component_id);

COMMENT ON INDEX idx_purchase_line_items_po_id IS 'CRITICAL: Used in v_analytics_master and all PO detail queries';
COMMENT ON INDEX idx_purchase_line_items_component_id IS 'CRITICAL: Used in component analytics and price history';

-- Composite index for component analytics
CREATE INDEX IF NOT EXISTS idx_purchase_line_items_component_quantity
  ON "5.1_purchase_line_items"(component_id, quantity);

COMMENT ON INDEX idx_purchase_line_items_component_quantity IS 'Optimizes component demand analysis queries';

-- ============================================================================
-- 4. CREATE INDEXES ON UNIFIED PO COSTS TABLE (6.0_po_costs)
-- ============================================================================

-- Foreign key index
CREATE INDEX IF NOT EXISTS idx_po_costs_po_id
  ON "6.0_po_costs"(po_id);

COMMENT ON INDEX idx_po_costs_po_id IS 'Used in v_payment_tracking and v_landed_cost_summary views';

-- Cost category filtering index
CREATE INDEX IF NOT EXISTS idx_po_costs_category
  ON "6.0_po_costs"(cost_category)
  WHERE cost_category IS NOT NULL;

COMMENT ON INDEX idx_po_costs_category IS 'Fast filtering by cost type (payment vs landed cost)';

-- Date sorting index
CREATE INDEX IF NOT EXISTS idx_po_costs_payment_date_desc
  ON "6.0_po_costs"(payment_date DESC)
  WHERE payment_date IS NOT NULL;

COMMENT ON INDEX idx_po_costs_payment_date_desc IS 'Used for chronological cost queries';

-- Composite index for cost analytics
CREATE INDEX IF NOT EXISTS idx_po_costs_po_category_date
  ON "6.0_po_costs"(po_id, cost_category, payment_date);

COMMENT ON INDEX idx_po_costs_po_category_date IS 'Optimizes payment tracking and cost breakdown queries';

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- Run this to verify indexes were created:
-- SELECT tablename, indexname FROM pg_indexes
-- WHERE schemaname = 'public'
-- AND tablename IN ('5.0_purchases', '5.1_purchase_line_items', '6.0_po_costs')
-- ORDER BY tablename, indexname;

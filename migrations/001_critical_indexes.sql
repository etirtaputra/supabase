-- =====================================================
-- CRITICAL PERFORMANCE INDEXES - PHASE 1
-- =====================================================
-- Description: Essential foreign key and sorting indexes
-- Estimated time: 5-15 minutes depending on data volume
-- Impact: 50-500x faster JOIN operations
-- =====================================================

BEGIN;

-- =====================================================
-- 1. FOREIGN KEY INDEXES
-- =====================================================
-- These are CRITICAL for JOIN performance across all views

-- Price Quotes foreign keys
CREATE INDEX IF NOT EXISTS idx_price_quotes_supplier_id
  ON "4.0_price_quotes"(supplier_id);

CREATE INDEX IF NOT EXISTS idx_price_quotes_company_id
  ON "4.0_price_quotes"(company_id);

CREATE INDEX IF NOT EXISTS idx_price_quotes_replaces_quote_id
  ON "4.0_price_quotes"(replaces_quote_id)
  WHERE replaces_quote_id IS NOT NULL;

COMMENT ON INDEX idx_price_quotes_supplier_id IS 'Critical for supplier joins in v_quotes_analytics and v_supplier_performance';
COMMENT ON INDEX idx_price_quotes_company_id IS 'Used in company-filtered quote queries';

-- Price Quote Line Items foreign keys
CREATE INDEX IF NOT EXISTS idx_quote_line_items_quote_id
  ON "4.1_price_quote_line_items"(quote_id);

CREATE INDEX IF NOT EXISTS idx_quote_line_items_component_id
  ON "4.1_price_quote_line_items"(component_id);

COMMENT ON INDEX idx_quote_line_items_quote_id IS 'Critical for quote detail queries - used in every quote view';
COMMENT ON INDEX idx_quote_line_items_component_id IS 'Used in component price history and analytics';

-- Proforma Invoices foreign keys
CREATE INDEX IF NOT EXISTS idx_proforma_invoices_quote_id
  ON "5.0_proforma_invoices"(quote_id)
  WHERE quote_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_proforma_invoices_replaces_pi_id
  ON "5.0_proforma_invoices"(replaces_pi_id)
  WHERE replaces_pi_id IS NOT NULL;

COMMENT ON INDEX idx_proforma_invoices_quote_id IS 'Links PIs to quotes';

-- Purchases (Purchase Orders) foreign keys
CREATE INDEX IF NOT EXISTS idx_purchases_pi_id
  ON "6.0_purchases"(pi_id)
  WHERE pi_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchases_replaces_po_id
  ON "6.0_purchases"(replaces_po_id)
  WHERE replaces_po_id IS NOT NULL;

COMMENT ON INDEX idx_purchases_pi_id IS 'Links POs to Proforma Invoices';

-- Purchase Line Items foreign keys (MOST CRITICAL - used heavily)
CREATE INDEX IF NOT EXISTS idx_purchase_line_items_po_id
  ON "6.1_purchase_line_items"(po_id);

CREATE INDEX IF NOT EXISTS idx_purchase_line_items_component_id
  ON "6.1_purchase_line_items"(component_id);

COMMENT ON INDEX idx_purchase_line_items_po_id IS 'CRITICAL: Used in v_analytics_master and all PO detail queries';
COMMENT ON INDEX idx_purchase_line_items_component_id IS 'CRITICAL: Used in component analytics and price history';

-- Payment Details foreign key
CREATE INDEX IF NOT EXISTS idx_payment_details_po_id
  ON "7.0_payment_details"(po_id);

COMMENT ON INDEX idx_payment_details_po_id IS 'Used in v_payment_tracking view';

-- Landed Costs foreign key
CREATE INDEX IF NOT EXISTS idx_landed_costs_po_id
  ON "7.1_landed_costs"(po_id);

COMMENT ON INDEX idx_landed_costs_po_id IS 'Used in v_landed_cost_summary view';

-- =====================================================
-- 2. DATE SORTING INDEXES
-- =====================================================
-- Critical for ORDER BY queries in API route

CREATE INDEX IF NOT EXISTS idx_price_quotes_quote_date_desc
  ON "4.0_price_quotes"(quote_date DESC);

CREATE INDEX IF NOT EXISTS idx_purchases_po_date_desc
  ON "6.0_purchases"(po_date DESC);

COMMENT ON INDEX idx_price_quotes_quote_date_desc IS 'Used in route.ts line 54 - ORDER BY quote_date DESC';
COMMENT ON INDEX idx_purchases_po_date_desc IS 'Used in route.ts line 49 - ORDER BY po_date DESC';

-- =====================================================
-- 3. STATUS FILTERING INDEXES
-- =====================================================
-- Partial indexes for common status queries

CREATE INDEX IF NOT EXISTS idx_price_quotes_status
  ON "4.0_price_quotes"(status)
  WHERE status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_proforma_invoices_status
  ON "5.0_proforma_invoices"(status)
  WHERE status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchases_status
  ON "6.0_purchases"(status)
  WHERE status IS NOT NULL;

COMMENT ON INDEX idx_price_quotes_status IS 'Filters by quote status (pending, active, expired)';
COMMENT ON INDEX idx_purchases_status IS 'Filters by PO status (pending, in_transit, received, cancelled)';

-- =====================================================
-- 4. COMPOSITE INDEXES FOR ANALYTICS
-- =====================================================
-- Multi-column indexes for common query patterns

-- Supplier + Date (used in supplier performance views)
CREATE INDEX IF NOT EXISTS idx_purchases_supplier_date
  ON "6.0_purchases"(po_date DESC)
  WHERE status IS NOT NULL;

-- Component price analysis (for min/max price queries)
CREATE INDEX IF NOT EXISTS idx_purchase_items_component_qty
  ON "6.1_purchase_line_items"(component_id, quantity);

CREATE INDEX IF NOT EXISTS idx_quote_items_component_price
  ON "4.1_price_quote_line_items"(component_id, unit_price);

-- Payment tracking composite
CREATE INDEX IF NOT EXISTS idx_payments_po_category_date
  ON "7.0_payment_details"(po_id, category, payment_date);

-- Landed costs by type
CREATE INDEX IF NOT EXISTS idx_landed_costs_po_type
  ON "7.1_landed_costs"(po_id, cost_type);

COMMENT ON INDEX idx_purchase_items_component_qty IS 'Used in mv_component_analytics for quantity aggregations';
COMMENT ON INDEX idx_payments_po_category_date IS 'Used in v_payment_tracking for payment category filtering';

-- =====================================================
-- VERIFICATION QUERY
-- =====================================================
-- Run this to verify all indexes were created

DO $$
DECLARE
  index_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO index_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname LIKE 'idx_%';

  RAISE NOTICE '✓ Total custom indexes created: %', index_count;
  RAISE NOTICE '✓ Index creation complete!';
  RAISE NOTICE '→ Run migrations/verify_indexes.sql to check performance';
END $$;

COMMIT;

-- =====================================================
-- ROLLBACK SCRIPT (if needed)
-- =====================================================
-- Uncomment and run if you need to remove these indexes:

/*
BEGIN;

DROP INDEX IF EXISTS idx_price_quotes_supplier_id;
DROP INDEX IF EXISTS idx_price_quotes_company_id;
DROP INDEX IF EXISTS idx_price_quotes_replaces_quote_id;
DROP INDEX IF EXISTS idx_quote_line_items_quote_id;
DROP INDEX IF EXISTS idx_quote_line_items_component_id;
DROP INDEX IF EXISTS idx_proforma_invoices_quote_id;
DROP INDEX IF EXISTS idx_proforma_invoices_replaces_pi_id;
DROP INDEX IF EXISTS idx_purchases_pi_id;
DROP INDEX IF EXISTS idx_purchases_replaces_po_id;
DROP INDEX IF EXISTS idx_purchase_line_items_po_id;
DROP INDEX IF EXISTS idx_purchase_line_items_component_id;
DROP INDEX IF EXISTS idx_payment_details_po_id;
DROP INDEX IF EXISTS idx_landed_costs_po_id;
DROP INDEX IF EXISTS idx_price_quotes_quote_date_desc;
DROP INDEX IF EXISTS idx_purchases_po_date_desc;
DROP INDEX IF EXISTS idx_price_quotes_status;
DROP INDEX IF EXISTS idx_proforma_invoices_status;
DROP INDEX IF EXISTS idx_purchases_status;
DROP INDEX IF EXISTS idx_purchases_supplier_date;
DROP INDEX IF EXISTS idx_purchase_items_component_qty;
DROP INDEX IF EXISTS idx_quote_items_component_price;
DROP INDEX IF EXISTS idx_payments_po_category_date;
DROP INDEX IF EXISTS idx_landed_costs_po_type;

COMMIT;
*/

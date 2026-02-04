-- Migration: Move quote_history and purchase_history data into formal tables
-- This migrates denormalized history data into normalized quote/PO structures

-- ============================================================================
-- PART 1: MIGRATE QUOTE_HISTORY → 4.0_price_quotes + 4.1_price_quote_line_items
-- ============================================================================

-- Step 1: Create quote headers from grouped quote_history records
-- Groups by: quote_number, quote_date, supplier_id, currency
INSERT INTO "4.0_price_quotes" (
  supplier_id,
  company_id,
  quote_date,
  pi_number,
  currency,
  total_value,
  status
)
SELECT DISTINCT ON (qh.quote_number, qh.quote_date, qh.supplier_id)
  qh.supplier_id,
  (SELECT company_id FROM "1.0_companies" LIMIT 1) as company_id, -- Use first company or adjust as needed
  qh.quote_date,
  qh.quote_number as pi_number,
  qh.currency,
  -- Calculate total value from all line items for this quote
  (
    SELECT COALESCE(SUM(qh2.quantity * qh2.unit_cost), 0)
    FROM quote_history qh2
    WHERE qh2.quote_number = qh.quote_number
      AND qh2.quote_date = qh.quote_date
      AND qh2.supplier_id = qh.supplier_id
  ) as total_value,
  'Open' as status
FROM quote_history qh
WHERE qh.quote_number IS NOT NULL
  AND qh.quote_date IS NOT NULL
  AND qh.supplier_id IS NOT NULL
ORDER BY qh.quote_number, qh.quote_date, qh.supplier_id, qh.history_id;

-- Step 2: Create quote line items from quote_history
INSERT INTO "4.1_price_quote_line_items" (
  quote_id,
  component_id,
  supplier_description,
  quantity,
  unit_price,
  currency
)
SELECT
  q.quote_id,
  qh.component_id,
  COALESCE(qh.description, c.description, c.model_sku) as supplier_description,
  qh.quantity,
  qh.unit_cost as unit_price,
  qh.currency
FROM quote_history qh
JOIN "4.0_price_quotes" q ON (
  q.pi_number = qh.quote_number
  AND q.quote_date = qh.quote_date
  AND q.supplier_id = qh.supplier_id
)
LEFT JOIN "3.0_components" c ON qh.component_id = c.component_id
WHERE qh.quote_number IS NOT NULL
  AND qh.component_id IS NOT NULL
ORDER BY qh.history_id;

-- ============================================================================
-- PART 2: MIGRATE PURCHASE_HISTORY → 6.0_purchases + 6.1_purchase_line_items
-- ============================================================================

-- Step 1: Create PO headers from grouped purchase_history records
-- Groups by: po_number, po_date, supplier_id, currency
INSERT INTO "6.0_purchases" (
  pi_id,
  po_number,
  po_date,
  currency,
  total_value,
  status
)
SELECT DISTINCT ON (ph.po_number, ph.po_date, ph.supplier_id)
  NULL as pi_id, -- No PI linkage for historical data
  ph.po_number,
  ph.po_date,
  ph.currency,
  -- Calculate total value from all line items for this PO
  (
    SELECT COALESCE(SUM(ph2.quantity * ph2.unit_cost), 0)
    FROM purchase_history ph2
    WHERE ph2.po_number = ph.po_number
      AND ph2.po_date = ph.po_date
      AND ph2.supplier_id = ph.supplier_id
  ) as total_value,
  'Draft' as status
FROM purchase_history ph
WHERE ph.po_number IS NOT NULL
  AND ph.po_date IS NOT NULL
  AND ph.supplier_id IS NOT NULL
ORDER BY ph.po_number, ph.po_date, ph.supplier_id, ph.history_id;

-- Step 2: Create PO line items from purchase_history
INSERT INTO "6.1_purchase_line_items" (
  po_id,
  component_id,
  supplier_description,
  quantity,
  unit_cost,
  currency
)
SELECT
  p.po_id,
  ph.component_id,
  COALESCE(ph.description, c.description, c.model_sku) as supplier_description,
  ph.quantity,
  ph.unit_cost,
  ph.currency
FROM purchase_history ph
JOIN "6.0_purchases" p ON (
  p.po_number = ph.po_number
  AND p.po_date = ph.po_date
)
LEFT JOIN "3.0_components" c ON ph.component_id = c.component_id
WHERE ph.po_number IS NOT NULL
  AND ph.component_id IS NOT NULL
ORDER BY ph.history_id;

-- ============================================================================
-- VERIFICATION QUERIES (Run these to check migration results)
-- ============================================================================

-- Check quote migration results
SELECT
  'Quote Headers Created' as check_type,
  COUNT(*) as count
FROM "4.0_price_quotes"
WHERE pi_number IN (SELECT DISTINCT quote_number FROM quote_history WHERE quote_number IS NOT NULL)

UNION ALL

SELECT
  'Quote Line Items Created' as check_type,
  COUNT(*) as count
FROM "4.1_price_quote_line_items" qli
JOIN "4.0_price_quotes" q ON qli.quote_id = q.quote_id
WHERE q.pi_number IN (SELECT DISTINCT quote_number FROM quote_history WHERE quote_number IS NOT NULL)

UNION ALL

SELECT
  'Original Quote History Records' as check_type,
  COUNT(*) as count
FROM quote_history
WHERE quote_number IS NOT NULL AND component_id IS NOT NULL

UNION ALL

-- Check PO migration results
SELECT
  'PO Headers Created' as check_type,
  COUNT(*) as count
FROM "6.0_purchases"
WHERE po_number IN (SELECT DISTINCT po_number FROM purchase_history WHERE po_number IS NOT NULL)

UNION ALL

SELECT
  'PO Line Items Created' as check_type,
  COUNT(*) as count
FROM "6.1_purchase_line_items" pli
JOIN "6.0_purchases" p ON pli.po_id = p.po_id
WHERE p.po_number IN (SELECT DISTINCT po_number FROM purchase_history WHERE po_number IS NOT NULL)

UNION ALL

SELECT
  'Original Purchase History Records' as check_type,
  COUNT(*) as count
FROM purchase_history
WHERE po_number IS NOT NULL AND component_id IS NOT NULL;

-- ============================================================================
-- DETAILED COMPARISON: Before and After
-- ============================================================================

-- Compare quote totals (history vs migrated)
SELECT
  qh.quote_number,
  qh.quote_date,
  s.supplier_name,
  COUNT(qh.history_id) as history_line_count,
  SUM(qh.quantity * qh.unit_cost) as history_total,
  (
    SELECT COUNT(*)
    FROM "4.1_price_quote_line_items" qli
    JOIN "4.0_price_quotes" q ON qli.quote_id = q.quote_id
    WHERE q.pi_number = qh.quote_number
      AND q.quote_date = qh.quote_date
      AND q.supplier_id = qh.supplier_id
  ) as migrated_line_count,
  (
    SELECT q.total_value
    FROM "4.0_price_quotes" q
    WHERE q.pi_number = qh.quote_number
      AND q.quote_date = qh.quote_date
      AND q.supplier_id = qh.supplier_id
    LIMIT 1
  ) as migrated_total
FROM quote_history qh
LEFT JOIN "2.0_suppliers" s ON qh.supplier_id = s.supplier_id
WHERE qh.quote_number IS NOT NULL
GROUP BY qh.quote_number, qh.quote_date, qh.supplier_id, s.supplier_name
ORDER BY qh.quote_date DESC;

-- Compare PO totals (history vs migrated)
SELECT
  ph.po_number,
  ph.po_date,
  s.supplier_name,
  COUNT(ph.history_id) as history_line_count,
  SUM(ph.quantity * ph.unit_cost) as history_total,
  (
    SELECT COUNT(*)
    FROM "6.1_purchase_line_items" pli
    JOIN "6.0_purchases" p ON pli.po_id = p.po_id
    WHERE p.po_number = ph.po_number
      AND p.po_date = ph.po_date
  ) as migrated_line_count,
  (
    SELECT p.total_value
    FROM "6.0_purchases" p
    WHERE p.po_number = ph.po_number
      AND p.po_date = ph.po_date
    LIMIT 1
  ) as migrated_total
FROM purchase_history ph
LEFT JOIN "2.0_suppliers" s ON ph.supplier_id = s.supplier_id
WHERE ph.po_number IS NOT NULL
GROUP BY ph.po_number, ph.po_date, ph.supplier_id, s.supplier_name
ORDER BY ph.po_date DESC;

-- ============================================================================
-- STEP 3: Convert history tables to read-only views
-- ============================================================================

-- IMPORTANT: Only run this after verifying migration was successful!

-- Drop existing history tables
DROP TABLE IF EXISTS quote_history;
DROP TABLE IF EXISTS purchase_history;

-- Create quote_history VIEW (replicates old denormalized structure)
CREATE VIEW quote_history AS
SELECT
  qli.quote_line_id as history_id,
  q.quote_date,
  q.pi_number as quote_number,
  q.supplier_id,
  qli.component_id,
  c.brand,
  qli.supplier_description as description,
  qli.quantity,
  qli.unit_price as unit_cost,
  qli.currency,
  qli.updated_at as created_at,
  qli.updated_at
FROM "4.1_price_quote_line_items" qli
JOIN "4.0_price_quotes" q ON qli.quote_id = q.quote_id
LEFT JOIN "3.0_components" c ON qli.component_id = c.component_id;

-- Create purchase_history VIEW (replicates old denormalized structure)
CREATE VIEW purchase_history AS
SELECT
  pli.po_line_item_id as history_id,
  p.po_date,
  p.po_number,
  q.supplier_id,
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
LEFT JOIN "5.0_proforma_invoices" pi ON p.pi_id = pi.pi_id
LEFT JOIN "4.0_price_quotes" q ON pi.quote_id = q.quote_id
LEFT JOIN "3.0_components" c ON pli.component_id = c.component_id;

-- Verify views work correctly
SELECT 'quote_history view' as view_name, COUNT(*) as record_count FROM quote_history
UNION ALL
SELECT 'purchase_history view' as view_name, COUNT(*) as record_count FROM purchase_history;

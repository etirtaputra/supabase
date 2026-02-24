-- ============================================================================
-- FIX: recalculate_po_total FUNCTION - Update to use renamed table
-- ============================================================================
-- The function recalculate_po_total still references the old table name
-- "6.1_purchase_line_items" which was renamed to "5.1_purchase_line_items"
--
-- This trigger function recalculates the total_value of a PO when line items
-- are inserted, updated, or deleted.
-- ============================================================================

-- Drop and recreate the function with correct table reference
CREATE OR REPLACE FUNCTION recalculate_po_total()
RETURNS TRIGGER AS $$
DECLARE
  new_total_value NUMERIC;
  target_po_id UUID;
BEGIN
  -- Determine which PO to recalculate
  IF (TG_OP = 'DELETE') THEN
    target_po_id := OLD.po_id;
  ELSE
    target_po_id := NEW.po_id;
  END IF;

  -- Calculate total from line items (FIXED: now uses 5.1_purchase_line_items)
  SELECT COALESCE(SUM(quantity * unit_cost), 0)
  INTO new_total_value
  FROM "5.1_purchase_line_items"
  WHERE po_id = target_po_id;

  -- Update the PO total_value (FIXED: now uses 5.0_purchases)
  UPDATE "5.0_purchases"
  SET total_value = new_total_value
  WHERE po_id = target_po_id;

  -- Return appropriate record
  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION recalculate_po_total() IS
'Auto-recalculates PO total_value when line items change (updated for renamed tables)';

-- ============================================================================
-- Recreate trigger on the correct table (if needed)
-- ============================================================================

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS refresh_on_line_change ON "5.1_purchase_line_items";
DROP TRIGGER IF EXISTS recalculate_po_total_trigger ON "5.1_purchase_line_items";

-- Create trigger on the renamed table
CREATE TRIGGER refresh_on_line_change
  AFTER INSERT OR DELETE OR UPDATE
  ON "5.1_purchase_line_items"
  FOR EACH ROW
  EXECUTE FUNCTION recalculate_po_total();

COMMENT ON TRIGGER refresh_on_line_change ON "5.1_purchase_line_items" IS
'Automatically recalculates PO total when line items are added, updated, or deleted';

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- Run this to verify the fix worked:
-- SELECT routine_definition
-- FROM information_schema.routines
-- WHERE routine_name = 'recalculate_po_total';
--
-- Should show "5.1_purchase_line_items" NOT "6.1_purchase_line_items"

-- recalculate_po_total() used to SET total_value = SUM(qty × unit_cost) on any
-- 5.1 line change, silently reverting a document total that legitimately
-- differs from the items sum (a CIF PI whose grand total includes freight, a
-- discount, a rounding line). Found 2026-08-14: healing PIO-2026012's line
-- currencies fired the trigger and snapped its freight-inclusive total
-- (USD 60,765) back to the items sum (USD 57,980).
--
-- The trigger now PRESERVES the delta between the stored total and the items
-- sum across line edits:
--     new_total = new_items_sum + (old_total − old_items_sum)
-- A PO whose total equalled its items sum keeps delta 0 — behaviour identical
-- to before. A NULL total is treated as delta 0 (the trigger fills items sum).
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.recalculate_po_total()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  target_po_id UUID;
  cur_sum NUMERIC;        -- items sum AFTER this row change (we are AFTER ROW)
  old_sum NUMERIC;        -- items sum BEFORE this row change, reconstructed
  old_total NUMERIC;
  delta NUMERIC;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    target_po_id := OLD.po_id;
  ELSE
    target_po_id := NEW.po_id;
  END IF;

  SELECT COALESCE(SUM(quantity * unit_cost), 0)
  INTO cur_sum
  FROM "5.1_purchase_line_items"
  WHERE po_id = target_po_id;

  old_sum := cur_sum;
  IF (TG_OP = 'INSERT') THEN
    old_sum := cur_sum - COALESCE(NEW.quantity * NEW.unit_cost, 0);
  ELSIF (TG_OP = 'UPDATE') THEN
    old_sum := cur_sum - COALESCE(NEW.quantity * NEW.unit_cost, 0) + COALESCE(OLD.quantity * OLD.unit_cost, 0);
  ELSIF (TG_OP = 'DELETE') THEN
    old_sum := cur_sum + COALESCE(OLD.quantity * OLD.unit_cost, 0);
  END IF;

  SELECT total_value INTO old_total FROM "5.0_purchases" WHERE po_id = target_po_id;
  delta := COALESCE(old_total, old_sum) - old_sum;

  UPDATE "5.0_purchases"
  SET total_value = cur_sum + delta
  WHERE po_id = target_po_id;

  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$function$;

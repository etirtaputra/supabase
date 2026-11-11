-- ICAPROC — stock follows the serial register's returns and scraps (2026-11-10)
--
-- STATUS 2026-11-11: NOT YET APPLIED to production — the apply was held at the
-- database's permission prompt. Rehearsed on production in BEGIN…ROLLBACK
-- (7/7 steps correct). Remove this note in the commit that applies it.
--
-- Owner, 2026-11-10: *"yes, make stock follow returns and scraps"*.
--
-- "On hand" in 30.1_stock_balances means SELLABLE. So:
--
--   returned  → nothing yet. The unit is back but undecided (inspect, repair,
--               scrap?) — the register shows it as Returned, stock does not
--               count it.
--   returned → in_stock ("Back on the shelf")
--               +1 IN, into the warehouse it shipped from, at the cost it left
--               at (the delivery's out line). source_type 'serial_restock'.
--   in_stock → scrapped
--               −1 OUT from the unit's warehouse at the moving-average cost
--               (stamped by stamp_stock_movement). source_type 'serial_scrap'.
--   scrapped → in_stock ("Undo scrap" of a unit scrapped from the shelf)
--               +1 IN reversing that scrap line, same warehouse and cost.
--   returned → scrapped, scrapped → returned, returned → delivered
--               nothing: a returned unit never re-entered stock.
--
-- Not 'delivery' lines on purpose: sales COGS (lib/salesFacts, useItemScores)
-- reads only those, and a return here reverses no revenue (that is a credit
-- note, not built). Reorder demand (lib/reorder) leaves serial_scrap out — a
-- write-off is a loss, not demand.
--
-- A database trigger, not the screen: the stock line is written in the same
-- transaction as the status change, whoever makes it (screen, agent, SQL), and
-- one cannot happen without the other. A unit with no catalogue item
-- (component_id NULL — a product we do not stock) moves no stock.
-- No new table or view, so no GRANTs.

CREATE OR REPLACE FUNCTION public.serial_stock_follow()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  loc      text;
  cost     numeric;
  do_no    text;
  dflt     text;
  scrap    record;
BEGIN
  IF NEW.component_id IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT code INTO dflt FROM "30.3_warehouses"
   WHERE is_active ORDER BY is_default DESC, sort_order LIMIT 1;

  -- Back on the shelf: +1 where it shipped from, at the cost it left at
  IF OLD.status = 'returned' AND NEW.status = 'in_stock' THEN
    SELECT m.location, NULLIF(m.unit_cost_idr, 0) INTO loc, cost
      FROM "30.0_stock_movements" m
     WHERE m.source_type = 'delivery' AND m.source_id = OLD.do_id::text
       AND m.component_id = NEW.component_id AND m.direction = 'out'
     ORDER BY m.moved_at DESC LIMIT 1;
    SELECT do_number INTO do_no FROM "24.0_delivery_orders" WHERE do_id = OLD.do_id;
    IF loc IS NULL THEN
      SELECT code INTO loc FROM "30.3_warehouses" WHERE code = OLD.location AND is_active;
    END IF;
    loc := COALESCE(loc, dflt);
    INSERT INTO "30.0_stock_movements"
      (component_id, location, direction, quantity, unit_cost_idr, source_type, source_id, notes)
    VALUES (NEW.component_id, loc, 'in', 1, COALESCE(cost, 0), 'serial_restock', NEW.serial_id::text,
      'Serial ' || NEW.serial || ' back on the shelf' || COALESCE(' (returned from ' || do_no || ')', ''));
    -- The register says which warehouse the unit is now in, so a later scrap
    -- takes it out of the same one. (Not a status change: this trigger does
    -- not fire again.)
    UPDATE "30.4_serial_numbers" SET location = loc
     WHERE serial_id = NEW.serial_id AND location IS DISTINCT FROM loc;

  -- Scrapped from the shelf: −1 at the moving-average cost
  ELSIF OLD.status = 'in_stock' AND NEW.status = 'scrapped' THEN
    -- Where the unit is: its own location; else where it was last put back on
    -- the shelf; else a warehouse holding the item, the default one first.
    SELECT code INTO loc FROM "30.3_warehouses" WHERE code = OLD.location AND is_active;
    IF loc IS NULL THEN
      SELECT m.location INTO loc FROM "30.0_stock_movements" m
       WHERE m.source_type = 'serial_restock' AND m.source_id = NEW.serial_id::text
       ORDER BY m.moved_at DESC LIMIT 1;
    END IF;
    IF loc IS NULL THEN
      SELECT b.location INTO loc FROM "30.1_stock_balances" b JOIN "30.3_warehouses" w ON w.code = b.location
       WHERE b.component_id = NEW.component_id AND b.qty_on_hand > 0 AND w.is_active
       ORDER BY w.is_default DESC, b.qty_on_hand DESC LIMIT 1;
    END IF;
    INSERT INTO "30.0_stock_movements"
      (component_id, location, direction, quantity, unit_cost_idr, source_type, source_id, notes, allow_negative)
    VALUES (NEW.component_id, COALESCE(loc, dflt), 'out', 1, 0, 'serial_scrap', NEW.serial_id::text,
      'Serial ' || NEW.serial || ' scrapped', TRUE);

  -- Undo a scrap from the shelf: reverse that line exactly
  ELSIF OLD.status = 'scrapped' AND NEW.status = 'in_stock' THEN
    SELECT m.location, m.unit_cost_idr INTO scrap
      FROM "30.0_stock_movements" m
     WHERE m.source_type = 'serial_scrap' AND m.source_id = NEW.serial_id::text AND m.direction = 'out'
     ORDER BY m.moved_at DESC LIMIT 1;
    -- Net scrap lines still standing for this unit (a scrap undone before has
    -- its own reversal) — only reverse one that is still out.
    IF FOUND AND (SELECT COALESCE(SUM(CASE m.direction WHEN 'out' THEN 1 WHEN 'in' THEN -1 ELSE 0 END), 0)
                    FROM "30.0_stock_movements" m
                   WHERE m.source_type = 'serial_scrap' AND m.source_id = NEW.serial_id::text) > 0 THEN
      INSERT INTO "30.0_stock_movements"
        (component_id, location, direction, quantity, unit_cost_idr, source_type, source_id, notes)
      VALUES (NEW.component_id, scrap.location, 'in', 1, COALESCE(scrap.unit_cost_idr, 0), 'serial_scrap', NEW.serial_id::text,
        'Serial ' || NEW.serial || ' scrap undone');
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.serial_stock_follow() IS
  'Stock follows the serial register: back on the shelf +1 (serial_restock), scrapped from the shelf −1 and its undo +1 (serial_scrap). Returned units are not sellable stock until put back on the shelf.';

DROP TRIGGER IF EXISTS serial_stock_follow ON public."30.4_serial_numbers";
CREATE TRIGGER serial_stock_follow
  AFTER UPDATE OF status ON public."30.4_serial_numbers"
  FOR EACH ROW EXECUTE FUNCTION public.serial_stock_follow();

-- ICAPROC — landed-cost revaluation ('revalue' movements)
-- ---------------------------------------------------------------------------
-- Goods arrive before their bills do. A goods receipt values stock at the costs
-- recorded SO FAR; the freight invoice, the customs duty and the final balance
-- payment land weeks later. This migration teaches the ledger to carry that
-- correction without inventing quantity.
--
-- A 'revalue' movement says: "the N units received under this PO actually cost
-- X more (or less) each". It never moves stock — only value:
--   • quantity      = the units the correction RELATES to (what was received)
--   • unit_cost_idr = the per-unit correction, and it may be NEGATIVE
--   • the balance's moving average absorbs only the part inventory can still
--     carry — LEAST(quantity, on_hand) — because units already sold booked
--     their COGS at the old estimate and that sale is history.
--
-- Idempotent: safe to paste again. Ends with a PostgREST schema reload.

-- 1) The ledger learns the third direction ────────────────────────────────────
ALTER TABLE "30.0_stock_movements" DROP CONSTRAINT IF EXISTS stock_movements_direction_chk;
ALTER TABLE "30.0_stock_movements" ADD CONSTRAINT stock_movements_direction_chk
  CHECK (direction = ANY (ARRAY['in'::text, 'out'::text, 'revalue'::text]));

-- 2) Balances: value moves, quantity does not ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_stock_movement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE old_qty NUMERIC; old_avg NUMERIC; new_qty NUMERIC; new_avg NUMERIC; signed NUMERIC; found_bal BOOLEAN;
BEGIN
  signed := CASE NEW.direction WHEN 'out' THEN -NEW.quantity WHEN 'revalue' THEN 0 ELSE NEW.quantity END;
  SELECT qty_on_hand, avg_cost_idr INTO old_qty, old_avg
    FROM "30.1_stock_balances" WHERE component_id = NEW.component_id AND location = NEW.location;
  found_bal := FOUND;
  IF NOT found_bal THEN old_qty := 0; old_avg := 0; END IF;

  -- Nothing on hand to carry a revaluation: the whole correction belongs to
  -- units already gone. Recorded in the ledger, no balance to touch.
  IF NEW.direction = 'revalue' AND (NOT found_bal OR old_qty <= 0) THEN
    RETURN NEW;
  END IF;

  new_qty := old_qty + signed;
  IF new_qty < 0 AND NEW.direction <> 'revalue' AND NOT COALESCE(NEW.allow_negative, FALSE) THEN
    RAISE EXCEPTION 'Insufficient stock: % on hand at %, movement of % would leave %',
      old_qty, NEW.location, signed, new_qty
      USING ERRCODE = 'check_violation', HINT = 'Set allow_negative to override.';
  END IF;

  IF NEW.direction = 'revalue' THEN
    -- Only the units still held can absorb the correction; it spreads over the
    -- whole on-hand pool because a moving average keeps no lots.
    new_avg := GREATEST(0, old_avg
      + (LEAST(NEW.quantity, old_qty) * COALESCE(NEW.unit_cost_idr, 0)) / old_qty);
  ELSIF NEW.direction = 'in' AND COALESCE(NEW.unit_cost_idr, 0) > 0 AND (old_qty + NEW.quantity) > 0 THEN
    new_avg := (GREATEST(old_qty, 0) * old_avg + NEW.quantity * NEW.unit_cost_idr) / (GREATEST(old_qty, 0) + NEW.quantity);
  ELSE
    new_avg := old_avg;
  END IF;

  INSERT INTO "30.1_stock_balances" (component_id, location, qty_on_hand, avg_cost_idr, updated_at)
    VALUES (NEW.component_id, NEW.location, new_qty, new_avg, NOW())
    ON CONFLICT (component_id, location)
    DO UPDATE SET qty_on_hand = EXCLUDED.qty_on_hand, avg_cost_idr = EXCLUDED.avg_cost_idr, updated_at = NOW();
  RETURN NEW;
END $function$;

-- 3) The replay/repair pass follows the same rule ─────────────────────────────
CREATE OR REPLACE FUNCTION public.verify_stock_balances(p_fix boolean DEFAULT false)
 RETURNS TABLE(component_id uuid, location text, ledger_qty numeric, balance_qty numeric, ledger_avg numeric, balance_avg numeric, fixed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE r RECORD; run_qty NUMERIC; run_avg NUMERIC; m RECORD;
BEGIN
  CREATE TEMP TABLE _replay (component_id UUID, location TEXT, qty NUMERIC, avg NUMERIC) ON COMMIT DROP;
  FOR r IN SELECT DISTINCT s.component_id AS cid, s.location AS loc FROM "30.0_stock_movements" s LOOP
    run_qty := 0; run_avg := 0;
    FOR m IN SELECT sm.direction AS dir, sm.quantity AS qty, sm.unit_cost_idr AS cost
             FROM "30.0_stock_movements" sm
             WHERE sm.component_id = r.cid AND sm.location = r.loc
             ORDER BY sm.moved_at, sm.created_at, sm.movement_id LOOP
      IF m.dir = 'in' THEN
        IF COALESCE(m.cost,0) > 0 AND (GREATEST(run_qty,0) + m.qty) > 0 THEN
          run_avg := (GREATEST(run_qty,0) * run_avg + m.qty * m.cost) / (GREATEST(run_qty,0) + m.qty);
        END IF;
        run_qty := run_qty + m.qty;
      ELSIF m.dir = 'revalue' THEN
        -- Value only, and only what was on hand at that moment
        IF run_qty > 0 THEN
          run_avg := GREATEST(0, run_avg + (LEAST(m.qty, run_qty) * COALESCE(m.cost,0)) / run_qty);
        END IF;
      ELSE
        run_qty := run_qty - m.qty;
      END IF;
    END LOOP;
    INSERT INTO _replay VALUES (r.cid, r.loc, run_qty, run_avg);
  END LOOP;
  IF p_fix THEN
    UPDATE "30.1_stock_balances" b SET qty_on_hand = p.qty, avg_cost_idr = p.avg, updated_at = NOW()
    FROM _replay p WHERE b.component_id = p.component_id AND b.location = p.location
      AND (ABS(b.qty_on_hand - p.qty) > 0.0001 OR ABS(COALESCE(b.avg_cost_idr,0) - p.avg) > 0.5);
    INSERT INTO "30.1_stock_balances" (component_id, location, qty_on_hand, avg_cost_idr, updated_at)
    SELECT p.component_id, p.location, p.qty, p.avg, NOW() FROM _replay p
    WHERE NOT EXISTS (SELECT 1 FROM "30.1_stock_balances" b WHERE b.component_id = p.component_id AND b.location = p.location);
  END IF;
  RETURN QUERY
  SELECT p.component_id, p.location, p.qty, COALESCE(b.qty_on_hand,0), p.avg, COALESCE(b.avg_cost_idr,0), p_fix
  FROM _replay p LEFT JOIN "30.1_stock_balances" b ON b.component_id = p.component_id AND b.location = p.location
  WHERE ABS(COALESCE(b.qty_on_hand,0) - p.qty) > 0.0001 OR ABS(COALESCE(b.avg_cost_idr,0) - p.avg) > 0.5;
END $function$;

-- 4) The reconciliation screen reads the ledger by PO ─────────────────────────
CREATE INDEX IF NOT EXISTS stock_movements_source_idx
  ON "30.0_stock_movements" (source_type, source_id);

NOTIFY pgrst, 'reload schema';

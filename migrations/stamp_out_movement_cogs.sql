-- ============================================================================
-- ICAPROC — Stock ledger: stamp COGS on `out` movements (Module 6 prerequisite)
--
-- The roadmap contract is "outs are auto-priced at the current moving-average
-- landed cost (COGS basis)", but apply_stock_movement only ever READ
-- unit_cost_idr on `in` rows — callers (FulfillmentPanel) insert outs with 0
-- and nothing filled them in, so the ledger had no COGS and Item Economics
-- would read every sale as 100% GP.
--
-- Fix, two parts, idempotent:
--  1) stamp_stock_movement (BEFORE INSERT) now prices any out/adjust-out row
--     that arrives without a cost at the CURRENT balance average — captured
--     before apply_stock_movement (AFTER) mutates the balance.
--  2) Backfill: existing zero-cost `out` rows take their component+location's
--     current average. Safe today: verified no `in` movements exist after the
--     affected outs, so the current avg equals the avg at delivery time.
-- Paste-ready. Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.stamp_stock_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE actor TEXT; bal_avg NUMERIC;
BEGIN
  SELECT email INTO actor FROM user_profiles WHERE id = auth.uid();
  NEW.created_by_email := COALESCE(actor, 'system');
  NEW.created_at := COALESCE(NEW.created_at, NOW());
  NEW.moved_at := COALESCE(NEW.moved_at, NOW());
  -- COGS: an `out` (or adjust) with no explicit cost is priced at the moving
  -- average on hand right now. Explicit non-zero costs are respected (e.g. a
  -- reversal `in` carrying back the original out's cost).
  IF NEW.direction IN ('out', 'adjust') AND COALESCE(NEW.unit_cost_idr, 0) = 0 THEN
    SELECT avg_cost_idr INTO bal_avg FROM "30.1_stock_balances"
      WHERE component_id = NEW.component_id AND location = NEW.location;
    NEW.unit_cost_idr := COALESCE(bal_avg, 0);
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS stamp_stock_movement ON "30.0_stock_movements";
CREATE TRIGGER stamp_stock_movement
  BEFORE INSERT ON "30.0_stock_movements"
  FOR EACH ROW EXECUTE FUNCTION public.stamp_stock_movement();

-- ── Backfill zero-cost outs from the current balance average ────────────────
UPDATE "30.0_stock_movements" m
SET unit_cost_idr = b.avg_cost_idr
FROM "30.1_stock_balances" b
WHERE m.direction = 'out'
  AND COALESCE(m.unit_cost_idr, 0) = 0
  AND b.component_id = m.component_id
  AND b.location = m.location
  AND COALESCE(b.avg_cost_idr, 0) > 0;

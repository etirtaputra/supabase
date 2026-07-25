-- ============================================================================
-- ICAPROC — Module 3b: Multiple warehouses + stock-ledger hardening (30.x)
--
-- 30.1_stock_balances is already keyed (component_id, location) and the moving
-- average is maintained PER LOCATION, so the math was always multi-warehouse
-- capable — the app just wrote a hard-coded 'MAIN' everywhere. This migration
-- makes warehouses first-class and tightens the ledger so stock can be trusted:
--
--   1. 30.3_warehouses     — the warehouse master (code, name, active, default).
--   2. Referential safety  — location on movements/balances/GRNs must be a real
--                            warehouse code (no more free-text typos creating
--                            phantom locations).
--   3. Ledger CHECKs       — direction must be 'in'/'out' (anything else was
--                            silently treated as an INCREASE by the balance
--                            trigger) and quantity must be > 0.
--   4. transfer_stock()    — atomic two-leg move between warehouses at the
--                            source's moving-average cost, so total inventory
--                            value is unchanged and both averages stay correct.
--   5. verify_stock_balances() — replays the whole ledger and reports (or
--                            repairs) any drift between ledger and balances.
--
-- Existing stock stays in MAIN (kept as a legacy location) — use the Transfer
-- tool to move it into the real warehouses; nothing is reassigned by guesswork.
-- Paste-ready, idempotent. Safe to re-run.
-- ============================================================================

-- ── 30.3_warehouses ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "30.3_warehouses" (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  address     TEXT DEFAULT '',
  notes       TEXT DEFAULT '',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE "30.3_warehouses" ADD COLUMN IF NOT EXISTS address    TEXT DEFAULT '';
ALTER TABLE "30.3_warehouses" ADD COLUMN IF NOT EXISTS notes      TEXT DEFAULT '';
ALTER TABLE "30.3_warehouses" ADD COLUMN IF NOT EXISTS is_active  BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE "30.3_warehouses" ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "30.3_warehouses" ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- Exactly one default warehouse (the one new receipts/deliveries preselect)
CREATE UNIQUE INDEX IF NOT EXISTS warehouses_single_default
  ON "30.3_warehouses" ((is_default)) WHERE is_default;

-- Seed: the two real warehouses + MAIN kept so existing rows stay valid.
INSERT INTO "30.3_warehouses" (code, name, is_active, is_default, sort_order)
SELECT v.code, v.name, v.is_active, v.is_default, v.sort_order
FROM (VALUES
  ('G63',  'Gudang No.: 63',        TRUE,  TRUE,  1),
  ('G25',  'Gudang No.: 25',        TRUE,  FALSE, 2),
  ('MAIN', 'Unassigned (legacy)',   TRUE,  FALSE, 99)
) AS v(code, name, is_active, is_default, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM "30.3_warehouses" w WHERE w.code = v.code);

-- ── Referential integrity: location must be a real warehouse ────────────────
-- Any location already in the data but missing from the master is adopted, so
-- the FKs below can never fail on legacy rows.
INSERT INTO "30.3_warehouses" (code, name, sort_order)
SELECT DISTINCT m.location, m.location, 50
FROM "30.0_stock_movements" m
WHERE COALESCE(TRIM(m.location), '') <> ''
  AND NOT EXISTS (SELECT 1 FROM "30.3_warehouses" w WHERE w.code = m.location);

DO $$ BEGIN
  ALTER TABLE "30.0_stock_movements"
    ADD CONSTRAINT stock_movements_location_fk
    FOREIGN KEY (location) REFERENCES "30.3_warehouses"(code);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "30.1_stock_balances"
    ADD CONSTRAINT stock_balances_location_fk
    FOREIGN KEY (location) REFERENCES "30.3_warehouses"(code);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "30.2_goods_receipts"
    ADD CONSTRAINT goods_receipts_location_fk
    FOREIGN KEY (location) REFERENCES "30.3_warehouses"(code);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Ledger CHECKs — the balance trigger treats anything not 'out' as an
-- increase, so a stray direction value would silently inflate stock. ────────
DO $$ BEGIN
  ALTER TABLE "30.0_stock_movements"
    ADD CONSTRAINT stock_movements_direction_chk CHECK (direction IN ('in', 'out'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "30.0_stock_movements"
    ADD CONSTRAINT stock_movements_qty_chk CHECK (quantity > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS stock_movements_comp_loc_idx ON "30.0_stock_movements" (component_id, location);
CREATE INDEX IF NOT EXISTS stock_movements_moved_at_idx ON "30.0_stock_movements" (moved_at DESC);
CREATE INDEX IF NOT EXISTS stock_movements_source_idx   ON "30.0_stock_movements" (source_type, source_id);

-- ── Atomic warehouse-to-warehouse transfer ──────────────────────────────────
-- Two legs in ONE transaction at the source's moving-average cost: total
-- inventory value is unchanged, the destination average absorbs the incoming
-- cost correctly, and a failure on either leg rolls both back. SECURITY
-- INVOKER, so the caller still needs the stock-movement INSERT policy.
CREATE OR REPLACE FUNCTION public.transfer_stock(
  p_component_id UUID,
  p_from         TEXT,
  p_to           TEXT,
  p_quantity     NUMERIC,
  p_notes        TEXT DEFAULT ''
) RETURNS UUID
LANGUAGE plpgsql SECURITY INVOKER AS $fn$
DECLARE src_qty NUMERIC; src_avg NUMERIC; tid UUID := gen_random_uuid(); label TEXT;
BEGIN
  IF p_from = p_to THEN
    RAISE EXCEPTION 'Source and destination warehouse must be different';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Transfer quantity must be greater than zero';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "30.3_warehouses" WHERE code = p_from) THEN
    RAISE EXCEPTION 'Unknown source warehouse %', p_from;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "30.3_warehouses" WHERE code = p_to) THEN
    RAISE EXCEPTION 'Unknown destination warehouse %', p_to;
  END IF;

  SELECT qty_on_hand, avg_cost_idr INTO src_qty, src_avg
    FROM "30.1_stock_balances"
    WHERE component_id = p_component_id AND location = p_from
    FOR UPDATE;

  IF COALESCE(src_qty, 0) < p_quantity THEN
    RAISE EXCEPTION 'Not enough stock in %: % on hand, tried to move %',
      p_from, COALESCE(src_qty, 0), p_quantity;
  END IF;

  label := CONCAT('Transfer ', p_from, ' → ', p_to, CASE WHEN COALESCE(p_notes,'') <> '' THEN ' · ' || p_notes ELSE '' END);

  -- Out of the source, then into the destination, both at the source average.
  INSERT INTO "30.0_stock_movements"
    (component_id, location, direction, quantity, unit_cost_idr, source_type, source_id, notes)
  VALUES (p_component_id, p_from, 'out', p_quantity, COALESCE(src_avg, 0), 'transfer', tid::text, label);

  INSERT INTO "30.0_stock_movements"
    (component_id, location, direction, quantity, unit_cost_idr, source_type, source_id, notes)
  VALUES (p_component_id, p_to, 'in', p_quantity, COALESCE(src_avg, 0), 'transfer', tid::text, label);

  RETURN tid;
END $fn$;

-- ── Ledger ↔ balance audit ──────────────────────────────────────────────────
-- Replays every movement in chronological order and compares the result with
-- 30.1_stock_balances. p_fix = false (default) reports only; true repairs.
-- The moving average is rebuilt exactly as the live trigger computes it.
CREATE OR REPLACE FUNCTION public.verify_stock_balances(p_fix BOOLEAN DEFAULT FALSE)
RETURNS TABLE (
  component_id  UUID,
  location      TEXT,
  ledger_qty    NUMERIC,
  balance_qty   NUMERIC,
  ledger_avg    NUMERIC,
  balance_avg   NUMERIC,
  fixed         BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE r RECORD; run_qty NUMERIC; run_avg NUMERIC; m RECORD;
BEGIN
  CREATE TEMP TABLE _replay (component_id UUID, location TEXT, qty NUMERIC, avg NUMERIC)
    ON COMMIT DROP;

  -- Aliased/renamed throughout: the OUT parameters (component_id, location)
  -- would otherwise be ambiguous against the table's own columns.
  FOR r IN SELECT DISTINCT s.component_id AS cid, s.location AS loc FROM "30.0_stock_movements" s LOOP
    run_qty := 0; run_avg := 0;
    FOR m IN
      SELECT sm.direction AS dir, sm.quantity AS qty, sm.unit_cost_idr AS cost
      FROM "30.0_stock_movements" sm
      WHERE sm.component_id = r.cid AND sm.location = r.loc
      ORDER BY sm.moved_at, sm.created_at, sm.movement_id
    LOOP
      IF m.dir = 'in' THEN
        IF COALESCE(m.cost, 0) > 0 AND (GREATEST(run_qty, 0) + m.qty) > 0 THEN
          run_avg := (GREATEST(run_qty, 0) * run_avg + m.qty * m.cost)
                     / (GREATEST(run_qty, 0) + m.qty);
        END IF;
        run_qty := run_qty + m.qty;
      ELSE
        run_qty := run_qty - m.qty;
      END IF;
    END LOOP;
    INSERT INTO _replay VALUES (r.cid, r.loc, run_qty, run_avg);
  END LOOP;

  IF p_fix THEN
    UPDATE "30.1_stock_balances" b
    SET qty_on_hand = p.qty, avg_cost_idr = p.avg, updated_at = NOW()
    FROM _replay p
    WHERE b.component_id = p.component_id AND b.location = p.location
      AND (ABS(b.qty_on_hand - p.qty) > 0.0001 OR ABS(COALESCE(b.avg_cost_idr,0) - p.avg) > 0.5);

    INSERT INTO "30.1_stock_balances" (component_id, location, qty_on_hand, avg_cost_idr, updated_at)
    SELECT p.component_id, p.location, p.qty, p.avg, NOW()
    FROM _replay p
    WHERE NOT EXISTS (SELECT 1 FROM "30.1_stock_balances" b
                      WHERE b.component_id = p.component_id AND b.location = p.location);
  END IF;

  RETURN QUERY
  SELECT p.component_id, p.location, p.qty, COALESCE(b.qty_on_hand, 0), p.avg, COALESCE(b.avg_cost_idr, 0), p_fix
  FROM _replay p
  LEFT JOIN "30.1_stock_balances" b
    ON b.component_id = p.component_id AND b.location = p.location
  WHERE ABS(COALESCE(b.qty_on_hand, 0) - p.qty) > 0.0001
     OR ABS(COALESCE(b.avg_cost_idr, 0) - p.avg) > 0.5;
END $fn$;

-- ── Row-Level Security ──────────────────────────────────────────────────────
-- Read: any signed-in user (every stock screen needs warehouse names).
-- Write: the stock-managing roles (owner / buy_admin / legacy data_entry).
ALTER TABLE "30.3_warehouses" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "warehouses read" ON "30.3_warehouses";
CREATE POLICY "warehouses read" ON "30.3_warehouses"
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "warehouses write" ON "30.3_warehouses";
CREATE POLICY "warehouses write" ON "30.3_warehouses"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','buy_admin','data_entry')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','buy_admin','data_entry')));

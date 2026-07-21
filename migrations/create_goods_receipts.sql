-- ============================================================================
-- ICAPROC — Module 3: Goods Receipt (GRN) + stock-out costing + negative guard
--   30.2_goods_receipts   GRN header — one row per receive action against a PO
--                         (GRN-YYYYMMDD-NNNN stamped by trigger).
--   30.0_stock_movements  + grn_id (groups a receive's movements under its GRN)
--                         + allow_negative (explicit override for negative stock)
--   stamp_stock_movement  'out' movements with no cost are now priced at the
--                         current moving-average cost (the COGS basis).
--   apply_stock_movement  blocks a movement that would push on-hand negative
--                         unless the row carries allow_negative = true.
-- Paste-ready, idempotent. Run in Supabase → SQL Editor.
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS goods_receipt_seq START 1;

-- ── 30.2_goods_receipts (GRN header) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "30.2_goods_receipts" (
  grn_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_number       TEXT NOT NULL DEFAULT '',
  po_id            UUID,                          -- received-against PO (null = ad-hoc receipt)
  location         TEXT NOT NULL DEFAULT 'MAIN',
  received_at      TIMESTAMPTZ DEFAULT NOW(),
  notes            TEXT DEFAULT '',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  created_by_email TEXT DEFAULT ''
);
DO $$ BEGIN
  ALTER TABLE "30.2_goods_receipts"
    ADD CONSTRAINT goods_receipts_po_fk FOREIGN KEY (po_id)
    REFERENCES "5.0_purchases"(po_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS goods_receipts_po_idx ON "30.2_goods_receipts" (po_id);

-- ── 30.0 ledger: GRN link + explicit negative-stock override ────────────────
ALTER TABLE "30.0_stock_movements" ADD COLUMN IF NOT EXISTS grn_id UUID;
DO $$ BEGIN
  ALTER TABLE "30.0_stock_movements"
    ADD CONSTRAINT stock_movements_grn_fk FOREIGN KEY (grn_id)
    REFERENCES "30.2_goods_receipts"(grn_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS stock_movements_grn_idx ON "30.0_stock_movements" (grn_id);
ALTER TABLE "30.0_stock_movements" ADD COLUMN IF NOT EXISTS allow_negative BOOLEAN NOT NULL DEFAULT FALSE;

-- ── GRN numbering + audit stamp ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stamp_goods_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE actor TEXT;
BEGIN
  SELECT email INTO actor FROM user_profiles WHERE id = auth.uid();
  IF NEW.grn_number IS NULL OR NEW.grn_number = '' THEN
    NEW.grn_number := 'GRN-' || to_char(NOW(), 'YYYYMMDD') || '-' || lpad(nextval('goods_receipt_seq')::text, 4, '0');
  END IF;
  NEW.created_by_email := COALESCE(actor, 'system');
  NEW.created_at := COALESCE(NEW.created_at, NOW());
  NEW.received_at := COALESCE(NEW.received_at, NOW());
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS stamp_goods_receipt ON "30.2_goods_receipts";
CREATE TRIGGER stamp_goods_receipt
  BEFORE INSERT ON "30.2_goods_receipts"
  FOR EACH ROW EXECUTE FUNCTION public.stamp_goods_receipt();

-- ── Movement stamp: audit + price 'out' rows at current moving average ──────
CREATE OR REPLACE FUNCTION public.stamp_stock_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE actor TEXT; cur_avg NUMERIC;
BEGIN
  SELECT email INTO actor FROM user_profiles WHERE id = auth.uid();
  NEW.created_by_email := COALESCE(actor, 'system');
  NEW.created_at := COALESCE(NEW.created_at, NOW());
  NEW.moved_at := COALESCE(NEW.moved_at, NOW());
  -- Outs are valued at the moving average in force when they happen — this is
  -- the COGS the Item Economics dashboard reads off the ledger.
  IF NEW.direction = 'out' AND COALESCE(NEW.unit_cost_idr, 0) = 0 THEN
    SELECT avg_cost_idr INTO cur_avg FROM "30.1_stock_balances"
      WHERE component_id = NEW.component_id AND location = NEW.location;
    NEW.unit_cost_idr := COALESCE(cur_avg, 0);
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS stamp_stock_movement ON "30.0_stock_movements";
CREATE TRIGGER stamp_stock_movement
  BEFORE INSERT ON "30.0_stock_movements"
  FOR EACH ROW EXECUTE FUNCTION public.stamp_stock_movement();

-- ── Balance maintenance: moving average + negative on-hand guard ────────────
CREATE OR REPLACE FUNCTION public.apply_stock_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE old_qty NUMERIC; old_avg NUMERIC; new_qty NUMERIC; new_avg NUMERIC; signed NUMERIC;
BEGIN
  signed := CASE NEW.direction WHEN 'out' THEN -NEW.quantity ELSE NEW.quantity END;
  SELECT qty_on_hand, avg_cost_idr INTO old_qty, old_avg
    FROM "30.1_stock_balances" WHERE component_id = NEW.component_id AND location = NEW.location;
  IF NOT FOUND THEN old_qty := 0; old_avg := 0; END IF;
  new_qty := old_qty + signed;
  IF new_qty < 0 AND NOT COALESCE(NEW.allow_negative, FALSE) THEN
    RAISE EXCEPTION 'Insufficient stock: % on hand at %, movement of % would leave %',
      old_qty, NEW.location, signed, new_qty
      USING ERRCODE = 'check_violation', HINT = 'Set allow_negative to override.';
  END IF;
  IF NEW.direction = 'in' AND COALESCE(NEW.unit_cost_idr, 0) > 0 AND (old_qty + NEW.quantity) > 0 THEN
    new_avg := (GREATEST(old_qty, 0) * old_avg + NEW.quantity * NEW.unit_cost_idr) / (GREATEST(old_qty, 0) + NEW.quantity);
  ELSE
    new_avg := old_avg;
  END IF;
  INSERT INTO "30.1_stock_balances" (component_id, location, qty_on_hand, avg_cost_idr, updated_at)
    VALUES (NEW.component_id, NEW.location, new_qty, new_avg, NOW())
    ON CONFLICT (component_id, location)
    DO UPDATE SET qty_on_hand = EXCLUDED.qty_on_hand, avg_cost_idr = EXCLUDED.avg_cost_idr, updated_at = NOW();
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS apply_stock_movement ON "30.0_stock_movements";
CREATE TRIGGER apply_stock_movement
  AFTER INSERT ON "30.0_stock_movements"
  FOR EACH ROW EXECUTE FUNCTION public.apply_stock_movement();

-- ── Row-Level Security ──────────────────────────────────────────────────────
-- GRN headers: read authenticated; insert = the roles that can receive stock.
ALTER TABLE "30.2_goods_receipts" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "goods receipts read" ON "30.2_goods_receipts";
CREATE POLICY "goods receipts read" ON "30.2_goods_receipts" FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "goods receipts insert" ON "30.2_goods_receipts";
CREATE POLICY "goods receipts insert" ON "30.2_goods_receipts" FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','buy_admin','data_entry')));

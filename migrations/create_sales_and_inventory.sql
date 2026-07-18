-- ============================================================================
-- ICAPROC — Sell-side documents (22.x) + Inventory ledger (30.x)
--   22.0_sales_quotes       one document, lifecycle draft→sent→accepted→
--                           ordered→invoiced→delivered (+cancelled/rejected);
--                           stamps SQ-/SO-/INV-/DO- numbers as it advances.
--   22.1_sales_quote_items  line items (product, qty, unit price, line total).
--   30.0_stock_movements    append-only ledger (in/out/adjust).
--   30.1_stock_balances     cached Physical on-hand + moving-avg landed cost.
-- Live stock = Physical − Reserved, Reserved = qty on ordered/invoiced quotes
-- (computed by the app). Cancel releases the reservation; deliver writes an
-- out movement (Physical drops).
-- Paste-ready, idempotent. Run in Supabase → SQL Editor.
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS sales_quote_seq   START 1;
CREATE SEQUENCE IF NOT EXISTS sales_order_seq   START 1;
CREATE SEQUENCE IF NOT EXISTS sales_invoice_seq START 1;
CREATE SEQUENCE IF NOT EXISTS sales_do_seq      START 1;

-- ── 22.0_sales_quotes ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "22.0_sales_quotes" (
  quote_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number     TEXT NOT NULL DEFAULT '',
  order_number     TEXT DEFAULT '',
  invoice_number   TEXT DEFAULT '',
  do_number        TEXT DEFAULT '',
  customer_id      UUID REFERENCES "20.0_customers"(customer_id) ON DELETE SET NULL,
  company_id       UUID REFERENCES "1.0_companies"(company_id) ON DELETE SET NULL,
  sales_rep_id     UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  quote_date       DATE DEFAULT CURRENT_DATE,
  status           TEXT NOT NULL DEFAULT 'draft',
  currency         TEXT DEFAULT 'IDR',
  ppn_pct          NUMERIC NOT NULL DEFAULT 11,
  subtotal         NUMERIC NOT NULL DEFAULT 0,
  ppn_amount       NUMERIC NOT NULL DEFAULT 0,
  grand_total      NUMERIC NOT NULL DEFAULT 0,
  notes            TEXT DEFAULT '',
  ordered_at       TIMESTAMPTZ,
  invoiced_at      TIMESTAMPTZ,
  delivered_at     TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  created_by_email TEXT DEFAULT '',
  updated_by_email TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS sales_quotes_customer_idx ON "22.0_sales_quotes" (customer_id);
CREATE INDEX IF NOT EXISTS sales_quotes_status_idx   ON "22.0_sales_quotes" (status);

-- ── 22.1_sales_quote_items ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "22.1_sales_quote_items" (
  item_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id     UUID NOT NULL REFERENCES "22.0_sales_quotes"(quote_id) ON DELETE CASCADE,
  component_id UUID REFERENCES "3.0_components"(component_id) ON DELETE SET NULL,
  is_section   BOOLEAN NOT NULL DEFAULT FALSE,  -- a section header row (title only)
  description  TEXT DEFAULT '',
  brand        TEXT DEFAULT '',
  note         TEXT DEFAULT '',                 -- optional comment; PDF can show/hide
  lead_time    TEXT DEFAULT '',                 -- section lead-time tag (PDF)
  unit         TEXT DEFAULT '',
  quantity     NUMERIC NOT NULL DEFAULT 0,
  unit_price   NUMERIC NOT NULL DEFAULT 0,
  line_total   NUMERIC NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE "22.1_sales_quote_items" ADD COLUMN IF NOT EXISTS is_section BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "22.1_sales_quote_items" ADD COLUMN IF NOT EXISTS brand      TEXT DEFAULT '';
ALTER TABLE "22.1_sales_quote_items" ADD COLUMN IF NOT EXISTS note       TEXT DEFAULT '';
ALTER TABLE "22.1_sales_quote_items" ADD COLUMN IF NOT EXISTS lead_time  TEXT DEFAULT '';
CREATE INDEX IF NOT EXISTS sales_quote_items_quote_idx     ON "22.1_sales_quote_items" (quote_id);
CREATE INDEX IF NOT EXISTS sales_quote_items_component_idx ON "22.1_sales_quote_items" (component_id);

-- ── 30.0_stock_movements (append-only ledger) ───────────────────────────────
CREATE TABLE IF NOT EXISTS "30.0_stock_movements" (
  movement_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id     UUID NOT NULL REFERENCES "3.0_components"(component_id) ON DELETE CASCADE,
  location         TEXT NOT NULL DEFAULT 'MAIN',
  direction        TEXT NOT NULL DEFAULT 'in',        -- in | out | adjust
  quantity         NUMERIC NOT NULL DEFAULT 0,        -- for adjust, may be negative
  unit_cost_idr    NUMERIC DEFAULT 0,                 -- landed unit cost (in movements)
  source_type      TEXT DEFAULT 'adjustment',         -- receipt | delivery | adjustment | return
  source_id        TEXT DEFAULT '',                   -- e.g. sales quote_id / po_id
  moved_at         TIMESTAMPTZ DEFAULT NOW(),
  notes            TEXT DEFAULT '',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  created_by_email TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS stock_movements_component_idx ON "30.0_stock_movements" (component_id, location);
CREATE INDEX IF NOT EXISTS stock_movements_moved_idx     ON "30.0_stock_movements" (moved_at DESC);

-- ── 30.1_stock_balances (cached Physical on-hand + moving-avg cost) ──────────
CREATE TABLE IF NOT EXISTS "30.1_stock_balances" (
  component_id UUID NOT NULL REFERENCES "3.0_components"(component_id) ON DELETE CASCADE,
  location     TEXT NOT NULL DEFAULT 'MAIN',
  qty_on_hand  NUMERIC NOT NULL DEFAULT 0,
  avg_cost_idr NUMERIC NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (component_id, location)
);

-- ── Sales-quote numbering + status stamps + audit ───────────────────────────
CREATE OR REPLACE FUNCTION public.stamp_sales_quote() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE actor TEXT; d TEXT := to_char(NOW(), 'YYYYMMDD');
BEGIN
  SELECT email INTO actor FROM user_profiles WHERE id = auth.uid();
  actor := COALESCE(actor, 'system');
  IF TG_OP = 'INSERT' THEN
    IF NEW.quote_number IS NULL OR NEW.quote_number = '' THEN
      NEW.quote_number := 'SQ-' || d || '-' || lpad(nextval('sales_quote_seq')::text, 4, '0');
    END IF;
    NEW.created_by_email := actor;
    NEW.updated_by_email := actor;
    NEW.created_at := COALESCE(NEW.created_at, NOW());
    NEW.updated_at := NOW();
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.updated_by_email := actor;
    NEW.updated_at := NOW();
    IF NEW.status = 'ordered'   AND OLD.status IS DISTINCT FROM 'ordered' THEN
      IF COALESCE(NEW.order_number,'')   = '' THEN NEW.order_number   := 'SO-'  || d || '-' || lpad(nextval('sales_order_seq')::text, 4, '0');   END IF;
      NEW.ordered_at   := COALESCE(NEW.ordered_at, NOW());
    END IF;
    IF NEW.status = 'invoiced'  AND OLD.status IS DISTINCT FROM 'invoiced' THEN
      IF COALESCE(NEW.invoice_number,'') = '' THEN NEW.invoice_number := 'INV-' || d || '-' || lpad(nextval('sales_invoice_seq')::text, 4, '0'); END IF;
      NEW.invoiced_at  := COALESCE(NEW.invoiced_at, NOW());
    END IF;
    IF NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered' THEN
      IF COALESCE(NEW.do_number,'')      = '' THEN NEW.do_number      := 'DO-'  || d || '-' || lpad(nextval('sales_do_seq')::text, 4, '0');      END IF;
      NEW.delivered_at := COALESCE(NEW.delivered_at, NOW());
    END IF;
    IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, NOW());
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS stamp_sales_quote ON "22.0_sales_quotes";
CREATE TRIGGER stamp_sales_quote
  BEFORE INSERT OR UPDATE ON "22.0_sales_quotes"
  FOR EACH ROW EXECUTE FUNCTION public.stamp_sales_quote();

-- ── Stock movement: audit stamp (before) + balance maintenance (after) ──────
CREATE OR REPLACE FUNCTION public.stamp_stock_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE actor TEXT;
BEGIN
  SELECT email INTO actor FROM user_profiles WHERE id = auth.uid();
  NEW.created_by_email := COALESCE(actor, 'system');
  NEW.created_at := COALESCE(NEW.created_at, NOW());
  NEW.moved_at := COALESCE(NEW.moved_at, NOW());
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS stamp_stock_movement ON "30.0_stock_movements";
CREATE TRIGGER stamp_stock_movement
  BEFORE INSERT ON "30.0_stock_movements"
  FOR EACH ROW EXECUTE FUNCTION public.stamp_stock_movement();

CREATE OR REPLACE FUNCTION public.apply_stock_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE old_qty NUMERIC; old_avg NUMERIC; new_qty NUMERIC; new_avg NUMERIC; signed NUMERIC;
BEGIN
  signed := CASE NEW.direction WHEN 'out' THEN -NEW.quantity ELSE NEW.quantity END;
  SELECT qty_on_hand, avg_cost_idr INTO old_qty, old_avg
    FROM "30.1_stock_balances" WHERE component_id = NEW.component_id AND location = NEW.location;
  IF NOT FOUND THEN old_qty := 0; old_avg := 0; END IF;
  new_qty := old_qty + signed;
  IF NEW.direction = 'in' AND COALESCE(NEW.unit_cost_idr, 0) > 0 AND (old_qty + NEW.quantity) > 0 THEN
    new_avg := (old_qty * old_avg + NEW.quantity * NEW.unit_cost_idr) / (old_qty + NEW.quantity);
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
-- Sales docs: read authenticated; write owner + sales.
ALTER TABLE "22.0_sales_quotes" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sales quotes read" ON "22.0_sales_quotes";
CREATE POLICY "sales quotes read" ON "22.0_sales_quotes" FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "sales quotes write" ON "22.0_sales_quotes";
CREATE POLICY "sales quotes write" ON "22.0_sales_quotes" FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales')));

ALTER TABLE "22.1_sales_quote_items" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sales quote items read" ON "22.1_sales_quote_items";
CREATE POLICY "sales quote items read" ON "22.1_sales_quote_items" FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "sales quote items write" ON "22.1_sales_quote_items";
CREATE POLICY "sales quote items write" ON "22.1_sales_quote_items" FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales')));

-- Stock ledger: read authenticated. Insert: owner/data_entry for any movement;
-- sales may insert ONLY delivery-out movements (completing their own orders).
ALTER TABLE "30.0_stock_movements" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stock movements read" ON "30.0_stock_movements";
CREATE POLICY "stock movements read" ON "30.0_stock_movements" FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "stock movements insert" ON "30.0_stock_movements";
CREATE POLICY "stock movements insert" ON "30.0_stock_movements" FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','data_entry'))
    OR (
      direction = 'out' AND source_type = 'delivery'
      AND EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales'))
    )
  );

-- Balances: read authenticated; maintained only by the SECURITY DEFINER trigger.
ALTER TABLE "30.1_stock_balances" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stock balances read" ON "30.1_stock_balances";
CREATE POLICY "stock balances read" ON "30.1_stock_balances" FOR SELECT TO authenticated USING (true);

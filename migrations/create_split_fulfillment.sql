-- ============================================================================
-- ICAPROC — Module 5B: Split fulfillment
--   One Sales Order (22.0) → many Invoices (25.x) + many Delivery Orders (24.x).
--   INV/DO stop being columns on the order row and become child documents;
--   the legacy columns stay (first child's number mirrors into them).
--   24.0_delivery_orders / 24.1 items   DO-… by trigger (reuses sales_do_seq)
--   25.0_sales_invoices / 25.1 items    INV-… by trigger (reuses sales_invoice_seq)
--   26.0_customer_receipts              + invoice_id (payments settle an invoice)
--   Backfill: every order with a stamped INV/DO number gets one real child
--   document carrying the SAME number; receipts point at the created invoice.
-- Paste-ready, idempotent. Run in Supabase → SQL Editor.
-- ============================================================================

-- ── 24.0_delivery_orders ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "24.0_delivery_orders" (
  do_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id         UUID NOT NULL REFERENCES "22.0_sales_quotes"(quote_id) ON DELETE CASCADE,
  do_number        TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'preparing',   -- preparing | delivered | cancelled
  delivery_date    DATE,
  delivery_time    TEXT DEFAULT '',
  delivery_method  TEXT DEFAULT 'delivery',             -- delivery | pickup
  delivery_via     TEXT DEFAULT '',
  delivery_address TEXT DEFAULT '',
  delivery_map_url TEXT DEFAULT '',
  delivery_contact TEXT DEFAULT '',
  delivered_at     TIMESTAMPTZ,
  notes            TEXT DEFAULT '',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  created_by_email TEXT DEFAULT '',
  updated_by_email TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS delivery_orders_quote_idx ON "24.0_delivery_orders" (quote_id);

CREATE TABLE IF NOT EXISTS "24.1_delivery_order_items" (
  do_item_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  do_id        UUID NOT NULL REFERENCES "24.0_delivery_orders"(do_id) ON DELETE CASCADE,
  so_item_id   UUID REFERENCES "22.1_sales_quote_items"(item_id) ON DELETE SET NULL,
  component_id UUID,
  description  TEXT DEFAULT '',
  unit         TEXT DEFAULT '',
  qty          NUMERIC NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS delivery_order_items_do_idx ON "24.1_delivery_order_items" (do_id);
CREATE INDEX IF NOT EXISTS delivery_order_items_comp_idx ON "24.1_delivery_order_items" (component_id);

-- ── 25.0_sales_invoices ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "25.0_sales_invoices" (
  invoice_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id         UUID NOT NULL REFERENCES "22.0_sales_quotes"(quote_id) ON DELETE CASCADE,
  invoice_number   TEXT NOT NULL DEFAULT '',
  kind             TEXT NOT NULL DEFAULT 'items',       -- items | progress
  pct              NUMERIC,                             -- progress: % of order grand total
  do_id            UUID REFERENCES "24.0_delivery_orders"(do_id) ON DELETE SET NULL,
  subtotal         NUMERIC NOT NULL DEFAULT 0,
  ppn_pct          NUMERIC NOT NULL DEFAULT 11,
  ppn_amount       NUMERIC NOT NULL DEFAULT 0,
  grand_total      NUMERIC NOT NULL DEFAULT 0,
  issued_at        DATE DEFAULT CURRENT_DATE,
  due_date         DATE,
  notes            TEXT DEFAULT '',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  created_by_email TEXT DEFAULT '',
  updated_by_email TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS sales_invoices_quote_idx ON "25.0_sales_invoices" (quote_id);

CREATE TABLE IF NOT EXISTS "25.1_sales_invoice_items" (
  inv_item_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   UUID NOT NULL REFERENCES "25.0_sales_invoices"(invoice_id) ON DELETE CASCADE,
  so_item_id   UUID REFERENCES "22.1_sales_quote_items"(item_id) ON DELETE SET NULL,
  description  TEXT DEFAULT '',
  unit         TEXT DEFAULT '',
  qty          NUMERIC NOT NULL DEFAULT 0,
  unit_price   NUMERIC NOT NULL DEFAULT 0,
  line_total   NUMERIC NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sales_invoice_items_inv_idx ON "25.1_sales_invoice_items" (invoice_id);

-- ── Receipts settle a specific invoice ──────────────────────────────────────
ALTER TABLE "26.0_customer_receipts" ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES "25.0_sales_invoices"(invoice_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS customer_receipts_invoice_idx ON "26.0_customer_receipts" (invoice_id);

-- ── Numbering + audit stamps (reuse the existing sequences → numbers continue) ──
CREATE OR REPLACE FUNCTION public.stamp_delivery_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE actor TEXT;
BEGIN
  SELECT email INTO actor FROM user_profiles WHERE id = auth.uid();
  actor := COALESCE(actor, 'system');
  IF TG_OP = 'INSERT' THEN
    IF NEW.do_number IS NULL OR NEW.do_number = '' THEN
      NEW.do_number := 'DO-' || to_char(NOW(), 'YYYYMMDD') || '-' || lpad(nextval('sales_do_seq')::text, 4, '0');
    END IF;
    NEW.created_by_email := actor;
  END IF;
  NEW.updated_by_email := actor;
  NEW.updated_at := NOW();
  IF NEW.status = 'delivered' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'delivered') THEN
    NEW.delivered_at := COALESCE(NEW.delivered_at, NOW());
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS stamp_delivery_order ON "24.0_delivery_orders";
CREATE TRIGGER stamp_delivery_order
  BEFORE INSERT OR UPDATE ON "24.0_delivery_orders"
  FOR EACH ROW EXECUTE FUNCTION public.stamp_delivery_order();

CREATE OR REPLACE FUNCTION public.stamp_sales_invoice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE actor TEXT;
BEGIN
  SELECT email INTO actor FROM user_profiles WHERE id = auth.uid();
  actor := COALESCE(actor, 'system');
  IF TG_OP = 'INSERT' THEN
    IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
      NEW.invoice_number := 'INV-' || to_char(NOW(), 'YYYYMMDD') || '-' || lpad(nextval('sales_invoice_seq')::text, 4, '0');
    END IF;
    NEW.created_by_email := actor;
  END IF;
  NEW.updated_by_email := actor;
  NEW.updated_at := NOW();
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS stamp_sales_invoice ON "25.0_sales_invoices";
CREATE TRIGGER stamp_sales_invoice
  BEFORE INSERT OR UPDATE ON "25.0_sales_invoices"
  FOR EACH ROW EXECUTE FUNCTION public.stamp_sales_invoice();

-- ── Row-Level Security (same writer set as sales docs) ──────────────────────
ALTER TABLE "24.0_delivery_orders" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "delivery orders read" ON "24.0_delivery_orders";
CREATE POLICY "delivery orders read" ON "24.0_delivery_orders" FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "delivery orders write" ON "24.0_delivery_orders";
CREATE POLICY "delivery orders write" ON "24.0_delivery_orders" FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales','sell_admin','engineer')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales','sell_admin','engineer')));

ALTER TABLE "24.1_delivery_order_items" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "delivery order items read" ON "24.1_delivery_order_items";
CREATE POLICY "delivery order items read" ON "24.1_delivery_order_items" FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "delivery order items write" ON "24.1_delivery_order_items";
CREATE POLICY "delivery order items write" ON "24.1_delivery_order_items" FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales','sell_admin','engineer')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales','sell_admin','engineer')));

ALTER TABLE "25.0_sales_invoices" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sales invoices read" ON "25.0_sales_invoices";
CREATE POLICY "sales invoices read" ON "25.0_sales_invoices" FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "sales invoices write" ON "25.0_sales_invoices";
CREATE POLICY "sales invoices write" ON "25.0_sales_invoices" FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales','sell_admin','engineer')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales','sell_admin','engineer')));

ALTER TABLE "25.1_sales_invoice_items" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sales invoice items read" ON "25.1_sales_invoice_items";
CREATE POLICY "sales invoice items read" ON "25.1_sales_invoice_items" FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "sales invoice items write" ON "25.1_sales_invoice_items";
CREATE POLICY "sales invoice items write" ON "25.1_sales_invoice_items" FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales','sell_admin','engineer')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales','sell_admin','engineer')));

-- ── Backfill: stamped numbers → real child documents (idempotent) ───────────
-- Invoices: one full-value 'items' invoice per order that has an INV number.
INSERT INTO "25.0_sales_invoices" (quote_id, invoice_number, kind, subtotal, ppn_pct, ppn_amount, grand_total, issued_at)
SELECT q.quote_id, q.invoice_number, 'items', q.subtotal, q.ppn_pct, q.ppn_amount, q.grand_total,
       COALESCE(q.invoiced_at::date, q.updated_at::date, CURRENT_DATE)
FROM "22.0_sales_quotes" q
WHERE COALESCE(q.invoice_number, '') <> ''
  AND NOT EXISTS (SELECT 1 FROM "25.0_sales_invoices" i WHERE i.quote_id = q.quote_id);

INSERT INTO "25.1_sales_invoice_items" (invoice_id, so_item_id, description, unit, qty, unit_price, line_total, sort_order)
SELECT i.invoice_id, li.item_id, li.description, li.unit, li.quantity, li.unit_price, li.line_total, li.sort_order
FROM "25.0_sales_invoices" i
JOIN "22.0_sales_quotes" q ON q.quote_id = i.quote_id AND q.invoice_number = i.invoice_number
JOIN "22.1_sales_quote_items" li ON li.quote_id = i.quote_id AND NOT li.is_section
WHERE NOT EXISTS (SELECT 1 FROM "25.1_sales_invoice_items" x WHERE x.invoice_id = i.invoice_id);

-- Delivery orders: one full-qty DO per order that has a DO number.
INSERT INTO "24.0_delivery_orders" (quote_id, do_number, status, delivery_date, delivery_time, delivery_method, delivery_via, delivery_address, delivery_map_url, delivery_contact, delivered_at)
SELECT q.quote_id, q.do_number,
       CASE WHEN q.status = 'delivered' THEN 'delivered' ELSE 'preparing' END,
       q.delivery_date, COALESCE(q.delivery_time, ''), COALESCE(q.delivery_method, 'delivery'),
       COALESCE(q.delivery_via, ''), COALESCE(q.delivery_address, ''), COALESCE(q.delivery_map_url, ''), COALESCE(q.delivery_contact, ''),
       q.delivered_at
FROM "22.0_sales_quotes" q
WHERE COALESCE(q.do_number, '') <> ''
  AND NOT EXISTS (SELECT 1 FROM "24.0_delivery_orders" d WHERE d.quote_id = q.quote_id);

INSERT INTO "24.1_delivery_order_items" (do_id, so_item_id, component_id, description, unit, qty, sort_order)
SELECT d.do_id, li.item_id, li.component_id, li.description, li.unit, li.quantity, li.sort_order
FROM "24.0_delivery_orders" d
JOIN "22.0_sales_quotes" q ON q.quote_id = d.quote_id AND q.do_number = d.do_number
JOIN "22.1_sales_quote_items" li ON li.quote_id = d.quote_id AND NOT li.is_section
WHERE NOT EXISTS (SELECT 1 FROM "24.1_delivery_order_items" x WHERE x.do_id = d.do_id);

-- Point existing receipts at their order's (backfilled) invoice.
UPDATE "26.0_customer_receipts" r
SET invoice_id = (SELECT i.invoice_id FROM "25.0_sales_invoices" i WHERE i.quote_id = r.quote_id ORDER BY i.issued_at, i.created_at LIMIT 1)
WHERE r.invoice_id IS NULL
  AND EXISTS (SELECT 1 FROM "25.0_sales_invoices" i WHERE i.quote_id = r.quote_id);

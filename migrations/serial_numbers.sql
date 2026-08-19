-- ICAPROC — Serial numbers (30.4) + after-sales for units we did not sell
-- ---------------------------------------------------------------------------
-- A serial number is the identity of ONE physical unit. Until now the system
-- knew quantities — 12 inverters shipped on DO-x — but not WHICH twelve, so
-- when a customer calls with a serial on a label, nothing in the system could
-- say which order it came from, who bought it, or whether it is still under
-- warranty. The after-sales desk was matching serials to orders by memory.
--
-- 30.4 is the register: one row per unit, carrying the documents it travelled
-- with (sales order, invoice, delivery order) and the customer it went to.
-- Warehouse writes it when goods ship; after-sales reads it by typing the
-- serial off the label.
--
-- Two realities the register must hold without lying:
--   • a unit whose product is not in our catalog (component_id NULL, the name
--     kept as text) — a customer brings in a machine bought elsewhere;
--   • a unit we never sold at all (is_external) — no order, no invoice, no
--     delivery, and no warranty of ours. It still deserves a service ticket.
--
-- Idempotent: safe to paste again. Ends with a PostgREST schema reload.

-- ── The register ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "30.4_serial_numbers" (
  serial_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- As printed on the label, kept verbatim: people read it back character by character
  serial         TEXT NOT NULL,
  -- What we MATCH on: case and punctuation are how the same unit gets typed
  -- three different ways ("SN-1234", "sn 1234", "SN1234").
  serial_norm    TEXT GENERATED ALWAYS AS (upper(regexp_replace(serial, '[^A-Za-z0-9]', '', 'g'))) STORED,
  component_id   UUID REFERENCES "3.0_components"(component_id) ON DELETE SET NULL,
  -- The product when it is not ours to catalog
  product_text   TEXT NOT NULL DEFAULT '',
  customer_id    UUID REFERENCES "20.0_customers"(customer_id) ON DELETE SET NULL,
  quote_id       UUID REFERENCES "22.0_sales_quotes"(quote_id) ON DELETE SET NULL,
  do_id          UUID REFERENCES "24.0_delivery_orders"(do_id) ON DELETE SET NULL,
  invoice_id     UUID REFERENCES "25.0_sales_invoices"(invoice_id) ON DELETE SET NULL,
  -- Where the unit is in its life
  status         TEXT NOT NULL DEFAULT 'in_stock',
  -- TRUE = the customer did not buy this from us
  is_external    BOOLEAN NOT NULL DEFAULT FALSE,
  -- When it left us — the clock warranty runs on
  delivered_at   DATE,
  location       TEXT,
  notes          TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_email TEXT NOT NULL DEFAULT '',
  updated_by_email TEXT NOT NULL DEFAULT ''
);

ALTER TABLE "30.4_serial_numbers" DROP CONSTRAINT IF EXISTS serial_status_chk;
-- in_stock → on the shelf · allocated → spoken for by a sales order, still here
-- · delivered → gone out on a delivery · returned / scrapped → back or dead
ALTER TABLE "30.4_serial_numbers" ADD CONSTRAINT serial_status_chk
  CHECK (status = ANY (ARRAY['in_stock'::text, 'allocated'::text, 'delivered'::text, 'returned'::text, 'scrapped'::text]));

ALTER TABLE "30.4_serial_numbers" DROP CONSTRAINT IF EXISTS serial_not_blank_chk;
ALTER TABLE "30.4_serial_numbers" ADD CONSTRAINT serial_not_blank_chk
  CHECK (length(btrim(serial)) > 0);

-- The same serial may legitimately exist on two different products (two
-- manufacturers, same counter) — but never twice on the same product, which is
-- how a typo or a double entry announces itself.
CREATE UNIQUE INDEX IF NOT EXISTS serial_unique_per_product
  ON "30.4_serial_numbers" (COALESCE(component_id::text, ''), serial_norm);

-- Typing a serial is THE lookup; the document columns carry the reverse walk
CREATE INDEX IF NOT EXISTS serial_norm_idx  ON "30.4_serial_numbers" (serial_norm);
CREATE INDEX IF NOT EXISTS serial_quote_idx ON "30.4_serial_numbers" (quote_id);
CREATE INDEX IF NOT EXISTS serial_do_idx    ON "30.4_serial_numbers" (do_id);
CREATE INDEX IF NOT EXISTS serial_cust_idx  ON "30.4_serial_numbers" (customer_id);
CREATE INDEX IF NOT EXISTS serial_comp_idx  ON "30.4_serial_numbers" (component_id);

CREATE OR REPLACE FUNCTION public.stamp_serial_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE actor TEXT;
BEGIN
  SELECT email INTO actor FROM user_profiles WHERE id = auth.uid();
  IF TG_OP = 'INSERT' THEN
    NEW.created_by_email := COALESCE(actor, 'system');
  END IF;
  NEW.serial := btrim(NEW.serial);
  NEW.updated_at := NOW();
  NEW.updated_by_email := COALESCE(actor, 'system');
  -- The unit's own state follows the paperwork attached to it, so the register
  -- can never claim a unit is on the shelf while a delivery says it shipped.
  IF NEW.status NOT IN ('returned', 'scrapped') THEN
    IF NEW.do_id IS NOT NULL THEN
      NEW.status := 'delivered';
    ELSIF NEW.quote_id IS NOT NULL THEN
      NEW.status := 'allocated';
    ELSE
      NEW.status := 'in_stock';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS stamp_serial_number ON "30.4_serial_numbers";
CREATE TRIGGER stamp_serial_number BEFORE INSERT OR UPDATE ON "30.4_serial_numbers"
  FOR EACH ROW EXECUTE FUNCTION public.stamp_serial_number();

ALTER TABLE "30.4_serial_numbers" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "serials read" ON "30.4_serial_numbers";
CREATE POLICY "serials read" ON "30.4_serial_numbers" FOR SELECT USING (true);

-- Warehouse records them; the sales/after-sales desk corrects them
DROP POLICY IF EXISTS "serials write" ON "30.4_serial_numbers";
CREATE POLICY "serials write" ON "30.4_serial_numbers" FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM user_profiles p WHERE p.id = auth.uid()
          AND p.role = ANY (ARRAY['owner','buy_admin','data_entry','sell_admin','sales'])));

DROP POLICY IF EXISTS "serials update" ON "30.4_serial_numbers";
CREATE POLICY "serials update" ON "30.4_serial_numbers" FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM user_profiles p WHERE p.id = auth.uid()
          AND p.role = ANY (ARRAY['owner','buy_admin','data_entry','sell_admin','sales'])));

DROP POLICY IF EXISTS "serials delete" ON "30.4_serial_numbers";
CREATE POLICY "serials delete" ON "30.4_serial_numbers" FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM user_profiles p WHERE p.id = auth.uid()
          AND p.role = ANY (ARRAY['owner','buy_admin','data_entry','sell_admin'])));

-- ── After-sales: the unit under service, and units we never sold ────────────
ALTER TABLE "27.0_aftersales_cases"
  ADD COLUMN IF NOT EXISTS serial_id UUID REFERENCES "30.4_serial_numbers"(serial_id) ON DELETE SET NULL,
  -- Typed off the label even when the register has never seen it — the ticket
  -- must open anyway; matching it can come later.
  ADD COLUMN IF NOT EXISTS serial_text TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS component_id UUID REFERENCES "3.0_components"(component_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS product_text TEXT NOT NULL DEFAULT '',
  -- Bought somewhere else: no order of ours, and no warranty of ours
  ADD COLUMN IF NOT EXISTS is_external BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS purchased_from TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS purchased_at DATE;

CREATE INDEX IF NOT EXISTS aftersales_serial_idx ON "27.0_aftersales_cases" (serial_id);

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ICAPROC — Customer Receipts (26.x): payments received against Sales Invoices
-- Mirrors the buy-side 6.0_po_costs pattern: append-only payment rows against
-- a document; paid-vs-total progress is computed from them (basis for DSO).
-- Paste-ready, idempotent. Run in Supabase → SQL Editor.
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS customer_receipt_seq START 1;

CREATE TABLE IF NOT EXISTS "26.0_customer_receipts" (
  receipt_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id         UUID NOT NULL REFERENCES "22.0_sales_quotes"(quote_id) ON DELETE CASCADE,
  receipt_number   TEXT NOT NULL DEFAULT '',            -- RCPT-YYYYMMDD-NNNN (auto)
  category         TEXT NOT NULL DEFAULT 'balance_payment', -- down_payment | balance_payment
  amount           NUMERIC NOT NULL DEFAULT 0,          -- IDR
  payment_method   TEXT DEFAULT 'bank_transfer',        -- bank_transfer | cash | cheque | giro | other
  payment_date     DATE DEFAULT CURRENT_DATE,
  bank_ref         TEXT DEFAULT '',                     -- transfer reference / cheque no.
  notes            TEXT DEFAULT '',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  created_by_email TEXT DEFAULT ''
);
ALTER TABLE "26.0_customer_receipts" ADD COLUMN IF NOT EXISTS category       TEXT NOT NULL DEFAULT 'balance_payment';
ALTER TABLE "26.0_customer_receipts" ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'bank_transfer';
ALTER TABLE "26.0_customer_receipts" ADD COLUMN IF NOT EXISTS bank_ref       TEXT DEFAULT '';
CREATE INDEX IF NOT EXISTS customer_receipts_quote_idx ON "26.0_customer_receipts" (quote_id);
CREATE INDEX IF NOT EXISTS customer_receipts_date_idx  ON "26.0_customer_receipts" (payment_date DESC);

-- Auto receipt number + audit stamp
CREATE OR REPLACE FUNCTION public.stamp_customer_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE actor TEXT;
BEGIN
  SELECT email INTO actor FROM user_profiles WHERE id = auth.uid();
  NEW.created_by_email := COALESCE(actor, 'system');
  NEW.created_at := COALESCE(NEW.created_at, NOW());
  IF NEW.receipt_number IS NULL OR NEW.receipt_number = '' THEN
    NEW.receipt_number := 'RCPT-' || to_char(NOW(), 'YYYYMMDD') || '-' || lpad(nextval('customer_receipt_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS stamp_customer_receipt ON "26.0_customer_receipts";
CREATE TRIGGER stamp_customer_receipt
  BEFORE INSERT ON "26.0_customer_receipts"
  FOR EACH ROW EXECUTE FUNCTION public.stamp_customer_receipt();

-- RLS: read any signed-in user; record/delete = owner + finance (payments are
-- the finance domain, mirroring the buy-side convention).
ALTER TABLE "26.0_customer_receipts" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customer receipts read" ON "26.0_customer_receipts";
CREATE POLICY "customer receipts read" ON "26.0_customer_receipts"
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "customer receipts write" ON "26.0_customer_receipts";
CREATE POLICY "customer receipts write" ON "26.0_customer_receipts"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','finance')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','finance')));

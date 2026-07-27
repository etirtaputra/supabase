-- ============================================================================
-- ICAPROC — Import / export traceability (40.1)
--
-- The Dolibarr cutover moves customers and order transactions into ICAPROC.
-- A migration that cannot be re-run is a migration you get exactly one attempt
-- at, so every importable record carries where it came from:
--
--   external_source  — 'dolibarr' (or any other system, later)
--   external_ref     — that system's own id/ref for the row
--
-- A partial UNIQUE index on the pair makes re-importing the same file an
-- UPDATE rather than a duplicate. Rows created inside ICAPROC leave both NULL
-- and are untouched by any of this.
--
--   40.1_import_batches — one row per import run: what was loaded, by whom,
--                         and how it landed (created / updated / skipped).
--                         An audit trail, and the thing you read when the
--                         numbers look wrong three weeks later.
--
-- RLS: any signed-in user may READ the batch log (it explains where data came
-- from); only an OWNER may write it, matching who is allowed to import.
-- Paste-ready, idempotent. Safe to re-run.
-- ============================================================================

-- ── Provenance columns ──────────────────────────────────────────────────────
ALTER TABLE "20.0_customers"         ADD COLUMN IF NOT EXISTS external_ref TEXT;
ALTER TABLE "20.0_customers"         ADD COLUMN IF NOT EXISTS external_source TEXT;
ALTER TABLE "20.1_customer_contacts" ADD COLUMN IF NOT EXISTS external_ref TEXT;
ALTER TABLE "20.1_customer_contacts" ADD COLUMN IF NOT EXISTS external_source TEXT;
ALTER TABLE "22.0_sales_quotes"      ADD COLUMN IF NOT EXISTS external_ref TEXT;
ALTER TABLE "22.0_sales_quotes"      ADD COLUMN IF NOT EXISTS external_source TEXT;
ALTER TABLE "25.0_sales_invoices"    ADD COLUMN IF NOT EXISTS external_ref TEXT;
ALTER TABLE "25.0_sales_invoices"    ADD COLUMN IF NOT EXISTS external_source TEXT;
ALTER TABLE "26.0_customer_receipts" ADD COLUMN IF NOT EXISTS external_ref TEXT;
ALTER TABLE "26.0_customer_receipts" ADD COLUMN IF NOT EXISTS external_source TEXT;

-- Re-import updates instead of duplicating. Partial, so ICAPROC-native rows
-- (both columns NULL) are unaffected and can exist in any number.
CREATE UNIQUE INDEX IF NOT EXISTS customers_external_uidx
  ON "20.0_customers" (external_source, external_ref)
  WHERE external_ref IS NOT NULL AND external_source IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS contacts_external_uidx
  ON "20.1_customer_contacts" (external_source, external_ref)
  WHERE external_ref IS NOT NULL AND external_source IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sales_quotes_external_uidx
  ON "22.0_sales_quotes" (external_source, external_ref)
  WHERE external_ref IS NOT NULL AND external_source IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sales_invoices_external_uidx
  ON "25.0_sales_invoices" (external_source, external_ref)
  WHERE external_ref IS NOT NULL AND external_source IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS receipts_external_uidx
  ON "26.0_customer_receipts" (external_source, external_ref)
  WHERE external_ref IS NOT NULL AND external_source IS NOT NULL;

-- ── 40.1_import_batches ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "40.1_import_batches" (
  batch_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity           TEXT NOT NULL,               -- 'customers' | 'orders' | 'order_lines' | …
  source           TEXT NOT NULL DEFAULT 'dolibarr',
  filename         TEXT NOT NULL DEFAULT '',
  row_count        INTEGER NOT NULL DEFAULT 0,
  created_count    INTEGER NOT NULL DEFAULT 0,
  updated_count    INTEGER NOT NULL DEFAULT 0,
  skipped_count    INTEGER NOT NULL DEFAULT 0,
  error_count      INTEGER NOT NULL DEFAULT 0,
  notes            TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_email TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS import_batches_recent_idx ON "40.1_import_batches" (created_at DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE "40.1_import_batches" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "import batches read" ON "40.1_import_batches";
CREATE POLICY "import batches read" ON "40.1_import_batches"
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "import batches write" ON "40.1_import_batches";
CREATE POLICY "import batches write" ON "40.1_import_batches"
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));

-- Stamp the actor, so the log cannot be attributed to the wrong person
CREATE OR REPLACE FUNCTION stamp_import_batch() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor TEXT;
BEGIN
  SELECT email INTO actor FROM user_profiles WHERE id = auth.uid();
  NEW.created_by_email := COALESCE(actor, '');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS stamp_import_batch_trg ON "40.1_import_batches";
CREATE TRIGGER stamp_import_batch_trg BEFORE INSERT ON "40.1_import_batches"
  FOR EACH ROW EXECUTE FUNCTION stamp_import_batch();

-- ============================================================================
-- ICAPROC — Module 1: CRM (Customers + Contacts)
-- Tables 20.0_customers and 20.1_customer_contacts.
-- Paste-ready, idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS). Safe to re-run.
-- Run in Supabase → SQL Editor → New query.
-- ============================================================================

-- Human-readable customer code sequence: CUST-00001, CUST-00002, ...
CREATE SEQUENCE IF NOT EXISTS customer_code_seq START 1;

-- ── 20.0_customers ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "20.0_customers" (
  customer_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_code      TEXT NOT NULL DEFAULT '',           -- CUST-NNNNN (auto-filled by trigger)
  legal_name         TEXT NOT NULL DEFAULT '',
  display_name       TEXT NOT NULL DEFAULT '',
  tier               TEXT DEFAULT '',                    -- free text now; FKs into 21.x price tiers later
  account_manager_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  payment_terms      TEXT DEFAULT '',
  default_currency   TEXT DEFAULT 'IDR',
  tax_id             TEXT DEFAULT '',
  billing_address    TEXT DEFAULT '',
  shipping_address   TEXT DEFAULT '',
  notes              TEXT DEFAULT '',
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  created_by_email   TEXT DEFAULT '',
  updated_by_email   TEXT DEFAULT ''
);
-- Additive guards (safe if the table already existed from an earlier run)
ALTER TABLE "20.0_customers" ADD COLUMN IF NOT EXISTS customer_code      TEXT NOT NULL DEFAULT '';
ALTER TABLE "20.0_customers" ADD COLUMN IF NOT EXISTS legal_name         TEXT NOT NULL DEFAULT '';
ALTER TABLE "20.0_customers" ADD COLUMN IF NOT EXISTS display_name       TEXT NOT NULL DEFAULT '';
ALTER TABLE "20.0_customers" ADD COLUMN IF NOT EXISTS tier               TEXT DEFAULT '';
ALTER TABLE "20.0_customers" ADD COLUMN IF NOT EXISTS account_manager_id UUID;
ALTER TABLE "20.0_customers" ADD COLUMN IF NOT EXISTS payment_terms      TEXT DEFAULT '';
ALTER TABLE "20.0_customers" ADD COLUMN IF NOT EXISTS default_currency   TEXT DEFAULT 'IDR';
ALTER TABLE "20.0_customers" ADD COLUMN IF NOT EXISTS tax_id             TEXT DEFAULT '';
ALTER TABLE "20.0_customers" ADD COLUMN IF NOT EXISTS billing_address    TEXT DEFAULT '';
ALTER TABLE "20.0_customers" ADD COLUMN IF NOT EXISTS shipping_address   TEXT DEFAULT '';
ALTER TABLE "20.0_customers" ADD COLUMN IF NOT EXISTS notes              TEXT DEFAULT '';
ALTER TABLE "20.0_customers" ADD COLUMN IF NOT EXISTS is_active          BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE "20.0_customers" ADD COLUMN IF NOT EXISTS created_at         TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE "20.0_customers" ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE "20.0_customers" ADD COLUMN IF NOT EXISTS created_by_email   TEXT DEFAULT '';
ALTER TABLE "20.0_customers" ADD COLUMN IF NOT EXISTS updated_by_email   TEXT DEFAULT '';

-- Unique customer code (only for non-empty codes)
CREATE UNIQUE INDEX IF NOT EXISTS customers_code_unique
  ON "20.0_customers" (customer_code) WHERE customer_code <> '';
CREATE INDEX IF NOT EXISTS customers_account_manager_idx
  ON "20.0_customers" (account_manager_id);

-- ── 20.1_customer_contacts ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "20.1_customer_contacts" (
  contact_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID NOT NULL REFERENCES "20.0_customers"(customer_id) ON DELETE CASCADE,
  name         TEXT NOT NULL DEFAULT '',
  title        TEXT DEFAULT '',        -- role / job title
  email        TEXT DEFAULT '',
  phone        TEXT DEFAULT '',
  is_primary   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS customer_contacts_customer_idx
  ON "20.1_customer_contacts" (customer_id);

-- ── Audit + auto-code trigger ───────────────────────────────────────────────
-- Stamps created/updated email + updated_at, and fills a CUST-NNNNN code on
-- insert when the app leaves it blank. Mirrors the log_quote_activity pattern.
CREATE OR REPLACE FUNCTION public.stamp_customer_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE actor TEXT;
BEGIN
  SELECT email INTO actor FROM user_profiles WHERE id = auth.uid();
  actor := COALESCE(actor, 'system');
  IF TG_OP = 'INSERT' THEN
    IF NEW.customer_code IS NULL OR NEW.customer_code = '' THEN
      NEW.customer_code := 'CUST-' || lpad(nextval('customer_code_seq')::text, 5, '0');
    END IF;
    NEW.created_by_email := actor;
    NEW.updated_by_email := actor;
    NEW.created_at := COALESCE(NEW.created_at, NOW());
    NEW.updated_at := NOW();
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.updated_by_email := actor;
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS stamp_customer_audit ON "20.0_customers";
CREATE TRIGGER stamp_customer_audit
  BEFORE INSERT OR UPDATE ON "20.0_customers"
  FOR EACH ROW EXECUTE FUNCTION public.stamp_customer_audit();

-- ── Row-Level Security ──────────────────────────────────────────────────────
-- Read: any signed-in user. Write: owners and sales only.
ALTER TABLE "20.0_customers" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customers read" ON "20.0_customers";
CREATE POLICY "customers read" ON "20.0_customers"
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "customers write" ON "20.0_customers";
CREATE POLICY "customers write" ON "20.0_customers"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales')));

ALTER TABLE "20.1_customer_contacts" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customer contacts read" ON "20.1_customer_contacts";
CREATE POLICY "customer contacts read" ON "20.1_customer_contacts"
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "customer contacts write" ON "20.1_customer_contacts";
CREATE POLICY "customer contacts write" ON "20.1_customer_contacts"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales')));

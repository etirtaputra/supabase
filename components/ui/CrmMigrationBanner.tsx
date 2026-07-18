'use client';
import { useEffect, useState } from 'react';
import { createSupabaseClient } from '@/lib/supabase';

// Full, idempotent schema for the CRM (Customers) module. Safe to re-run.
// Keep in sync with migrations/create_crm_customers.sql and the probe below.
const MIGRATION_SQL = `CREATE SEQUENCE IF NOT EXISTS customer_code_seq START 1;

CREATE TABLE IF NOT EXISTS "20.0_customers" (
  customer_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_code      TEXT NOT NULL DEFAULT '',
  legal_name         TEXT NOT NULL DEFAULT '',
  display_name       TEXT NOT NULL DEFAULT '',
  tier               TEXT DEFAULT '',
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

CREATE UNIQUE INDEX IF NOT EXISTS customers_code_unique
  ON "20.0_customers" (customer_code) WHERE customer_code <> '';
CREATE INDEX IF NOT EXISTS customers_account_manager_idx
  ON "20.0_customers" (account_manager_id);

CREATE TABLE IF NOT EXISTS "20.1_customer_contacts" (
  contact_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID NOT NULL REFERENCES "20.0_customers"(customer_id) ON DELETE CASCADE,
  name         TEXT NOT NULL DEFAULT '',
  title        TEXT DEFAULT '',
  email        TEXT DEFAULT '',
  phone        TEXT DEFAULT '',
  is_primary   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS customer_contacts_customer_idx
  ON "20.1_customer_contacts" (customer_id);

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
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales')));`;

/**
 * Probes the CRM tables for the columns this build writes. Renders an amber
 * banner with copyable SQL when the database is behind the app. Mirrors the
 * quote-side MigrationBanner.
 */
export default function CrmMigrationBanner() {
  const supabase = createSupabaseClient();
  const [missing, setMissing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSql, setShowSql] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      const probes = await Promise.all([
        supabase.from('20.0_customers').select('customer_id, customer_code, account_manager_id, is_active, updated_at').limit(1),
        supabase.from('20.1_customer_contacts').select('contact_id, customer_id, is_primary').limit(1),
      ]);
      if (!cancelled && probes.some((p) => p.error)) setMissing(true);
    }
    check();
    return () => { cancelled = true; };
  }, []);

  if (!missing) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(MIGRATION_SQL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setShowSql(true);
    }
  }

  return (
    <div className="bg-amber-500/10 border border-amber-500/40 rounded-2xl p-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-amber-300 font-semibold">CRM tables are not set up yet.</span>
        <span className="text-amber-200/80 text-xs">
          Creating and editing customers will fail until the migration runs. Copy the SQL, then run it in
          Supabase → SQL Editor → New query.
        </span>
        <div className="flex gap-2 ml-auto">
          <button onClick={copy}
            className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-semibold transition-colors">
            {copied ? 'Copied ✓' : 'Copy SQL'}
          </button>
          <button onClick={() => setShowSql((v) => !v)}
            className="px-3 py-1.5 rounded-lg text-amber-300/70 hover:text-amber-200 text-xs transition-colors">
            {showSql ? 'Hide' : 'Show'} SQL
          </button>
        </div>
      </div>
      {showSql && (
        <pre className="mt-3 p-3 bg-black/30 rounded-xl text-[10px] leading-relaxed text-amber-100/80 overflow-x-auto max-h-64 overflow-y-auto select-all">
          {MIGRATION_SQL}
        </pre>
      )}
    </div>
  );
}

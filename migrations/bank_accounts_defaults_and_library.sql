-- ============================================================================
-- ICAPROC — Bank accounts: per-company defaults + the bank-name library (41.x)
--
--   1. is_default_payment / is_default_receipt on 41.0_bank_accounts — which
--      account a supplier payment leaves from, and which one a customer
--      receipt lands in, PER COMPANY (each PT banks separately, so a single
--      global default would be wrong the moment two companies are involved).
--      A partial unique index enforces at most one of each per company;
--      accounts with no company share one slot via COALESCE.
--   2. 41.2_bank_names — the bank library the account editor autocompletes
--      from, so "MANDIRI", "Mandiri" and "Bank Mandiri" stop being three
--      different banks. Seeded with the Indonesian banks in common use plus
--      every name already typed into an account.
--
-- Paste-ready, idempotent. Safe to re-run.
-- ============================================================================

-- ── 1. Per-company defaults ─────────────────────────────────────────────────
ALTER TABLE "41.0_bank_accounts" ADD COLUMN IF NOT EXISTS is_default_payment BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "41.0_bank_accounts" ADD COLUMN IF NOT EXISTS is_default_receipt BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS bank_default_payment_per_company
  ON "41.0_bank_accounts" (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE is_default_payment;
CREATE UNIQUE INDEX IF NOT EXISTS bank_default_receipt_per_company
  ON "41.0_bank_accounts" (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE is_default_receipt;

-- ── 2. Bank-name library ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "41.2_bank_names" (
  bank_name        TEXT PRIMARY KEY,
  short_name       TEXT DEFAULT '',
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_email TEXT DEFAULT ''
);

ALTER TABLE "41.2_bank_names" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bank names read" ON "41.2_bank_names";
CREATE POLICY "bank names read" ON "41.2_bank_names"
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "bank names write" ON "41.2_bank_names";
CREATE POLICY "bank names write" ON "41.2_bank_names"
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));

INSERT INTO "41.2_bank_names" (bank_name, short_name, sort_order)
SELECT v.name, v.short, v.ord
FROM (VALUES
  ('BCA',                  'BCA',       1),
  ('MANDIRI',              'Mandiri',   2),
  ('BNI',                  'BNI',       3),
  ('BRI',                  'BRI',       4),
  ('BSI',                  'BSI',       5),
  ('CIMB NIAGA',           'CIMB',      6),
  ('PERMATA',              'Permata',   7),
  ('DANAMON',              'Danamon',   8),
  ('PANIN',                'Panin',     9),
  ('OCBC',                 'OCBC',     10),
  ('MAYBANK',              'Maybank',  11),
  ('BTN',                  'BTN',      12),
  ('DBS',                  'DBS',      13),
  ('HSBC',                 'HSBC',     14),
  ('UOB',                  'UOB',      15),
  ('STANDARD CHARTERED',   'StanChart',16),
  ('CITIBANK',             'Citi',     17)
) AS v(name, short, ord)
WHERE NOT EXISTS (SELECT 1 FROM "41.2_bank_names" b WHERE upper(b.bank_name) = upper(v.name));

-- Adopt whatever is already on an account, so the library starts complete
INSERT INTO "41.2_bank_names" (bank_name, sort_order)
SELECT DISTINCT a.bank_name, 90
FROM "41.0_bank_accounts" a
WHERE COALESCE(a.bank_name, '') <> ''
  AND NOT EXISTS (SELECT 1 FROM "41.2_bank_names" b WHERE upper(b.bank_name) = upper(a.bank_name));

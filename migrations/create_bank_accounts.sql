-- ============================================================================
-- ICAPROC — Bank accounts (41.x): the company's cash, where the two flows meet
--
-- Buy-side payments leave a bank account and sell-side receipts arrive in one,
-- so an account's balance is the cash side of the conversion cycle. This adds:
--
--   1. 41.0_bank_accounts     — the account master, owned by one of the group
--                               companies (1.0_companies): bank, account
--                               number, currency, opening balance.
--   2. 41.1_bank_transactions — anything that is NOT already a PO payment or a
--                               customer receipt: opening adjustments, owner
--                               corrections, transfers, bank charges. Append-
--                               only in spirit; a correction is a new row, so
--                               the history stays auditable.
--   3. bank_account_id on 6.0_po_costs (money out), payment_batches (the
--      remittance as a whole) and 26.0_customer_receipts (money in), so an
--      account statement can be assembled from the documents themselves —
--      no duplicate ledger to keep in step.
--
-- Balance = opening_balance + Σ receipts + Σ manual in − Σ payments − Σ manual out.
-- Nothing is backfilled: existing payments carry no account until someone says
-- which one they came from, and the app shows them as "unassigned".
--
-- RLS: every signed-in user may READ (the payment forms need the picker);
-- only an OWNER may write accounts or transactions.
-- Paste-ready, idempotent. Safe to re-run.
-- ============================================================================

-- ── 41.0_bank_accounts ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "41.0_bank_accounts" (
  bank_account_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID REFERENCES "1.0_companies"(company_id) ON DELETE SET NULL,
  bank_name        TEXT NOT NULL DEFAULT '',
  account_name     TEXT NOT NULL DEFAULT '',   -- the name the account is held in
  account_number   TEXT NOT NULL DEFAULT '',
  branch           TEXT DEFAULT '',
  currency         TEXT NOT NULL DEFAULT 'IDR',
  opening_balance  NUMERIC NOT NULL DEFAULT 0, -- balance as at opening_date
  opening_date     DATE,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  notes            TEXT DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_email TEXT DEFAULT '',
  updated_by_email TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS bank_accounts_company_idx ON "41.0_bank_accounts" (company_id);

-- ── 41.1_bank_transactions ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "41.1_bank_transactions" (
  txn_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id  UUID NOT NULL REFERENCES "41.0_bank_accounts"(bank_account_id) ON DELETE CASCADE,
  txn_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  direction        TEXT NOT NULL DEFAULT 'in',
  amount           NUMERIC NOT NULL DEFAULT 0,
  description      TEXT NOT NULL DEFAULT '',
  reference        TEXT DEFAULT '',
  -- 'manual'     = a real movement recorded by hand (transfer, charge, interest)
  -- 'adjustment' = the correction written when an owner sets the balance directly
  source           TEXT NOT NULL DEFAULT 'manual',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_email TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS bank_txn_account_idx ON "41.1_bank_transactions" (bank_account_id, txn_date DESC);

DO $$ BEGIN
  ALTER TABLE "41.1_bank_transactions" ADD CONSTRAINT bank_txn_direction_chk CHECK (direction IN ('in','out'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "41.1_bank_transactions" ADD CONSTRAINT bank_txn_amount_chk CHECK (amount > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Stamp who wrote it (the app never sets created_by_email itself)
CREATE OR REPLACE FUNCTION public.stamp_bank_txn() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE actor TEXT;
BEGIN
  SELECT email INTO actor FROM user_profiles WHERE id = auth.uid();
  NEW.created_by_email := COALESCE(NULLIF(NEW.created_by_email, ''), actor, 'system');
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS stamp_bank_txn ON "41.1_bank_transactions";
CREATE TRIGGER stamp_bank_txn BEFORE INSERT ON "41.1_bank_transactions"
  FOR EACH ROW EXECUTE FUNCTION public.stamp_bank_txn();

-- ── The documents point at the account they moved money through ─────────────
ALTER TABLE "6.0_po_costs"           ADD COLUMN IF NOT EXISTS bank_account_id UUID REFERENCES "41.0_bank_accounts"(bank_account_id) ON DELETE SET NULL;
ALTER TABLE payment_batches          ADD COLUMN IF NOT EXISTS bank_account_id UUID REFERENCES "41.0_bank_accounts"(bank_account_id) ON DELETE SET NULL;
ALTER TABLE "26.0_customer_receipts" ADD COLUMN IF NOT EXISTS bank_account_id UUID REFERENCES "41.0_bank_accounts"(bank_account_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS po_costs_bank_idx ON "6.0_po_costs" (bank_account_id);
CREATE INDEX IF NOT EXISTS receipts_bank_idx ON "26.0_customer_receipts" (bank_account_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE "41.0_bank_accounts"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "41.1_bank_transactions" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bank accounts read" ON "41.0_bank_accounts";
CREATE POLICY "bank accounts read" ON "41.0_bank_accounts"
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "bank accounts write" ON "41.0_bank_accounts";
CREATE POLICY "bank accounts write" ON "41.0_bank_accounts"
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));

DROP POLICY IF EXISTS "bank txn read" ON "41.1_bank_transactions";
CREATE POLICY "bank txn read" ON "41.1_bank_transactions"
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "bank txn write" ON "41.1_bank_transactions";
CREATE POLICY "bank txn write" ON "41.1_bank_transactions"
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));

-- ── Seed: one placeholder account per group company, inactive until filled in.
-- Gives the owner a row to edit instead of a blank page; nothing references it
-- until it is picked on a payment.
INSERT INTO "41.0_bank_accounts" (company_id, bank_name, account_name, account_number, currency, is_active, sort_order)
SELECT c.company_id, '', c.legal_name, '', 'IDR', FALSE, ROW_NUMBER() OVER (ORDER BY c.legal_name)
FROM "1.0_companies" c
WHERE NOT EXISTS (SELECT 1 FROM "41.0_bank_accounts" b WHERE b.company_id = c.company_id);

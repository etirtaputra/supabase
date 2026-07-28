-- ============================================================================
-- ICAPROC — After Sales (27.x): what happens to a sale after it ships
--
-- A distribution sale doesn't end at the invoice: chargers fail, panels crack
-- in transit, batteries come back under warranty. Today that history lives in
-- WhatsApp threads — which means nobody can answer "how often does this
-- product fail?", "what does supporting this customer actually cost?", or
-- "is this the third time this unit has been back?". Owning the data means
-- owning THIS data too.
--
--   27.0_aftersales_cases — the case: which customer, which sales order,
--                           what kind of problem (warranty / repair /
--                           replacement / …), open → resolved lifecycle.
--                           AS-YYYYMMDD-NNNN stamped by trigger.
--   27.1_aftersales_parts — the products involved and what was done to each
--                           (replaced / repaired / inspected / returned),
--                           linked to the catalog so failure counts roll up
--                           per item.
--   27.2_aftersales_updates — the running log: dated notes as the case moves.
--
-- Deliberately NOT done here: a replaced part does not write a stock movement
-- automatically. Warranty replacements should eventually flow through the
-- ledger (they are real COGS), but silently mutating stock from a log entry
-- is how ledgers stop being trusted — that integration is a follow-on with
-- its own explicit "issue from stock" step.
--
-- RLS mirrors the sell-side documents: any signed-in user reads, the
-- sell-side writer roles (owner / sales / sell_admin / engineer) write.
-- Paste-ready, idempotent. Safe to re-run.
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS aftersales_case_seq START 1;

-- ── 27.0_aftersales_cases ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "27.0_aftersales_cases" (
  case_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_number      TEXT NOT NULL DEFAULT '',
  customer_id      UUID REFERENCES "20.0_customers"(customer_id) ON DELETE SET NULL,
  quote_id         UUID REFERENCES "22.0_sales_quotes"(quote_id) ON DELETE SET NULL,
  -- warranty / repair / replacement / maintenance / complaint / inspection / other
  category         TEXT NOT NULL DEFAULT 'repair',
  -- open / in_progress / waiting_parts / resolved / closed
  status           TEXT NOT NULL DEFAULT 'open',
  subject          TEXT NOT NULL DEFAULT '',
  description      TEXT NOT NULL DEFAULT '',
  resolution       TEXT NOT NULL DEFAULT '',
  reported_at      DATE NOT NULL DEFAULT CURRENT_DATE,
  resolved_at      DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_email TEXT NOT NULL DEFAULT '',
  updated_by_email TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS aftersales_customer_idx ON "27.0_aftersales_cases" (customer_id);
CREATE INDEX IF NOT EXISTS aftersales_quote_idx    ON "27.0_aftersales_cases" (quote_id);
CREATE INDEX IF NOT EXISTS aftersales_status_idx   ON "27.0_aftersales_cases" (status, reported_at DESC);

DO $$ BEGIN
  ALTER TABLE "27.0_aftersales_cases" ADD CONSTRAINT aftersales_category_chk
    CHECK (category IN ('warranty','repair','replacement','maintenance','complaint','inspection','other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "27.0_aftersales_cases" ADD CONSTRAINT aftersales_status_chk
    CHECK (status IN ('open','in_progress','waiting_parts','resolved','closed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 27.1_aftersales_parts ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "27.1_aftersales_parts" (
  part_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id          UUID NOT NULL REFERENCES "27.0_aftersales_cases"(case_id) ON DELETE CASCADE,
  component_id     UUID REFERENCES "3.0_components"(component_id) ON DELETE SET NULL,
  description      TEXT NOT NULL DEFAULT '',      -- kept even when linked, so history survives a catalog edit
  -- replaced / repaired / inspected / returned / missing / other
  action           TEXT NOT NULL DEFAULT 'repaired',
  quantity         NUMERIC NOT NULL DEFAULT 1,
  notes            TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS aftersales_parts_case_idx ON "27.1_aftersales_parts" (case_id);
CREATE INDEX IF NOT EXISTS aftersales_parts_comp_idx ON "27.1_aftersales_parts" (component_id);

DO $$ BEGIN
  ALTER TABLE "27.1_aftersales_parts" ADD CONSTRAINT aftersales_action_chk
    CHECK (action IN ('replaced','repaired','inspected','returned','missing','other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 27.2_aftersales_updates ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "27.2_aftersales_updates" (
  update_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id          UUID NOT NULL REFERENCES "27.0_aftersales_cases"(case_id) ON DELETE CASCADE,
  note             TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_email TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS aftersales_updates_case_idx ON "27.2_aftersales_updates" (case_id, created_at DESC);

-- ── Stamps: case number + audit trail ───────────────────────────────────────
CREATE OR REPLACE FUNCTION stamp_aftersales_case() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE actor TEXT;
BEGIN
  SELECT email INTO actor FROM user_profiles WHERE id = auth.uid();
  IF TG_OP = 'INSERT' THEN
    IF NEW.case_number IS NULL OR NEW.case_number = '' THEN
      NEW.case_number := 'AS-' || to_char(NOW(), 'YYYYMMDD') || '-' || lpad(nextval('aftersales_case_seq')::text, 4, '0');
    END IF;
    NEW.created_by_email := COALESCE(actor, 'system');
  END IF;
  NEW.updated_at := NOW();
  NEW.updated_by_email := COALESCE(actor, 'system');
  -- Resolution date follows the status, so nobody has to remember to set it
  IF NEW.status IN ('resolved','closed') AND NEW.resolved_at IS NULL THEN
    NEW.resolved_at := CURRENT_DATE;
  ELSIF NEW.status NOT IN ('resolved','closed') THEN
    NEW.resolved_at := NULL;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS stamp_aftersales_case_trg ON "27.0_aftersales_cases";
CREATE TRIGGER stamp_aftersales_case_trg
  BEFORE INSERT OR UPDATE ON "27.0_aftersales_cases"
  FOR EACH ROW EXECUTE FUNCTION stamp_aftersales_case();

CREATE OR REPLACE FUNCTION stamp_aftersales_update() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE actor TEXT;
BEGIN
  SELECT email INTO actor FROM user_profiles WHERE id = auth.uid();
  NEW.created_by_email := COALESCE(actor, 'system');
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS stamp_aftersales_update_trg ON "27.2_aftersales_updates";
CREATE TRIGGER stamp_aftersales_update_trg
  BEFORE INSERT ON "27.2_aftersales_updates"
  FOR EACH ROW EXECUTE FUNCTION stamp_aftersales_update();

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE "27.0_aftersales_cases"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "27.1_aftersales_parts"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "27.2_aftersales_updates" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['27.0_aftersales_cases','27.1_aftersales_parts','27.2_aftersales_updates'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "aftersales read" ON %I', t);
    EXECUTE format('CREATE POLICY "aftersales read" ON %I FOR SELECT TO authenticated USING (TRUE)', t);
    EXECUTE format('DROP POLICY IF EXISTS "aftersales write" ON %I', t);
    EXECUTE format($p$CREATE POLICY "aftersales write" ON %I FOR ALL TO authenticated
      USING      (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales','sell_admin','engineer')))
      WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales','sell_admin','engineer')))$p$, t);
  END LOOP;
END $$;

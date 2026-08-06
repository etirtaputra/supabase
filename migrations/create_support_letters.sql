-- ============================================================================
-- ICAPROC — Module 28: Surat Dukungan (Support Letters)
--
-- The letter we issue as PRINCIPAL/distributor so a reseller can enter a
-- government or corporate tender carrying our backing: "PT X is supported by
-- us for project Y, with these products, at these warranties."
--
-- It is a sell-side document like any other and connects the same way:
--   · the supported company IS a Customer (20.0) — never re-typed
--   · the supported materials ARE catalog items (3.0) — type and warranty
--     come from the item master, so a Surat Dukungan can never quote a
--     warranty the Item Editor disagrees with
--   · the handling salesperson is a real user (user_profiles), and the
--     author is stamped automatically
--
-- Numbering mirrors the paper: 013-ISL-SD-VII-2026 =
--   sequence (per year) - company code - SD - roman month - year.
--
-- Paste-ready, idempotent. Run in Supabase → SQL Editor.
-- ============================================================================

-- ── 28.0_support_letters ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "28.0_support_letters" (
  letter_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  letter_number    TEXT NOT NULL DEFAULT '',
  letter_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  -- Who we support (the reseller) — their own CRM record is the source
  customer_id      UUID REFERENCES "20.0_customers"(customer_id) ON DELETE SET NULL,
  supported_person_name    TEXT NOT NULL DEFAULT '',   -- Nama
  supported_person_title   TEXT NOT NULL DEFAULT '',   -- Jabatan
  supported_company_name   TEXT NOT NULL DEFAULT '',   -- snapshot: the letter must survive a CRM rename
  supported_company_address TEXT NOT NULL DEFAULT '',
  -- The tender / project
  project_name     TEXT NOT NULL DEFAULT '',           -- Pekerjaan
  end_user_name    TEXT NOT NULL DEFAULT '',           -- Kepada Yth. (project owner)
  end_user_address TEXT NOT NULL DEFAULT '',
  -- Ours
  company_id       UUID REFERENCES "1.0_companies"(company_id) ON DELETE SET NULL,
  company_code     TEXT NOT NULL DEFAULT 'ISL',        -- the letters inside the document number
  signatory_name   TEXT NOT NULL DEFAULT '',
  signatory_title  TEXT NOT NULL DEFAULT '',
  brands           TEXT NOT NULL DEFAULT '',           -- "ICA Solar, ICAL, EPEVER" — prefilled from the items
  place_of_issue   TEXT NOT NULL DEFAULT 'Jakarta',
  sales_rep_id     UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  -- draft = still being written · issued = signed and sent · cancelled = void
  status           TEXT NOT NULL DEFAULT 'draft',
  notes            TEXT NOT NULL DEFAULT '',
  -- The letter body. Pre-formatted like a quotation's terms: the standard
  -- clauses arrive with every new letter and are editable per letter, so a
  -- special case never means retyping the standard ones.
  statements       TEXT NOT NULL DEFAULT '',   -- the numbered undertakings
  validity_note    TEXT NOT NULL DEFAULT '',   -- "berlaku jika ... ditetapkan sebagai Penyedia"
  closing_note     TEXT NOT NULL DEFAULT '',
  -- Admin charges an administration fee per letter and only releases the
  -- signed copy once it lands. Tracking it here is what lets the list answer
  -- "which letters are waiting on money?" instead of a WhatsApp search.
  fee_amount       NUMERIC NOT NULL DEFAULT 0,
  fee_paid_at      DATE,                       -- NULL = not paid yet
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_email TEXT NOT NULL DEFAULT '',
  updated_by_email TEXT NOT NULL DEFAULT ''
);

-- Additive guards (safe when the table already exists from an earlier run)
ALTER TABLE "28.0_support_letters" ADD COLUMN IF NOT EXISTS statements    TEXT NOT NULL DEFAULT '';
ALTER TABLE "28.0_support_letters" ADD COLUMN IF NOT EXISTS validity_note TEXT NOT NULL DEFAULT '';
ALTER TABLE "28.0_support_letters" ADD COLUMN IF NOT EXISTS closing_note  TEXT NOT NULL DEFAULT '';
ALTER TABLE "28.0_support_letters" ADD COLUMN IF NOT EXISTS fee_amount    NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE "28.0_support_letters" ADD COLUMN IF NOT EXISTS fee_paid_at   DATE;

CREATE INDEX IF NOT EXISTS support_letters_customer_idx ON "28.0_support_letters" (customer_id);
CREATE INDEX IF NOT EXISTS support_letters_rep_idx      ON "28.0_support_letters" (sales_rep_id);
CREATE INDEX IF NOT EXISTS support_letters_date_idx     ON "28.0_support_letters" (letter_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS support_letters_number_unique
  ON "28.0_support_letters" (letter_number) WHERE letter_number <> '';

DO $$ BEGIN
  ALTER TABLE "28.0_support_letters" ADD CONSTRAINT support_letters_status_chk
    CHECK (status IN ('draft','issued','cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 28.1_support_letter_items ───────────────────────────────────────────────
-- "Material yang didukung": No | Nama Barang | Tipe | Garansi.
-- component_id links to the master; the three text columns are SNAPSHOTS, so a
-- letter already sent keeps saying what it said when it was signed.
CREATE TABLE IF NOT EXISTS "28.1_support_letter_items" (
  item_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  letter_id      UUID NOT NULL REFERENCES "28.0_support_letters"(letter_id) ON DELETE CASCADE,
  component_id   UUID REFERENCES "3.0_components"(component_id) ON DELETE SET NULL,
  category_label TEXT NOT NULL DEFAULT '',   -- Nama Barang  ("Solar Modules")
  type_text      TEXT NOT NULL DEFAULT '',   -- Tipe         ("ICASolar ICA200-72M 200Wp Mono")
  warranty_text  TEXT NOT NULL DEFAULT '',   -- Garansi      ("2 Tahun")
  quantity       NUMERIC,                    -- optional — most letters state no quantity
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS support_letter_items_letter_idx ON "28.1_support_letter_items" (letter_id, sort_order);
CREATE INDEX IF NOT EXISTS support_letter_items_comp_idx   ON "28.1_support_letter_items" (component_id);

-- ── Number + audit stamp ────────────────────────────────────────────────────
-- The sequence restarts each year, exactly like the paper filing: the number
-- is the count of letters already dated in that year, plus one.
CREATE OR REPLACE FUNCTION public.stamp_support_letter() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  actor TEXT;
  seq   INTEGER;
  roman TEXT[] := ARRAY['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
BEGIN
  SELECT email INTO actor FROM user_profiles WHERE id = auth.uid();
  actor := COALESCE(actor, 'system');
  IF TG_OP = 'INSERT' THEN
    IF NEW.letter_number IS NULL OR NEW.letter_number = '' THEN
      SELECT COALESCE(MAX((regexp_match(letter_number, '^([0-9]+)-'))[1]::INTEGER), 0) + 1
        INTO seq
        FROM "28.0_support_letters"
       WHERE letter_number ~ '^[0-9]+-'
         AND EXTRACT(YEAR FROM letter_date) = EXTRACT(YEAR FROM NEW.letter_date);
      NEW.letter_number := lpad(seq::TEXT, 3, '0')
        || '-' || COALESCE(NULLIF(NEW.company_code, ''), 'ISL')
        || '-SD-' || roman[EXTRACT(MONTH FROM NEW.letter_date)::INTEGER]
        || '-' || EXTRACT(YEAR FROM NEW.letter_date)::TEXT;
    END IF;
    NEW.created_by_email := actor;
  END IF;
  NEW.updated_at := NOW();
  NEW.updated_by_email := actor;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS stamp_support_letter_trg ON "28.0_support_letters";
CREATE TRIGGER stamp_support_letter_trg
  BEFORE INSERT OR UPDATE ON "28.0_support_letters"
  FOR EACH ROW EXECUTE FUNCTION public.stamp_support_letter();

-- ── RLS — same shape as After Sales: every signed-in user reads, sell-side
--    roles write. ──────────────────────────────────────────────────────────
ALTER TABLE "28.0_support_letters"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "28.1_support_letter_items" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['28.0_support_letters','28.1_support_letter_items'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "support letters read" ON %I', t);
    EXECUTE format('CREATE POLICY "support letters read" ON %I FOR SELECT TO authenticated USING (TRUE)', t);
    EXECUTE format('DROP POLICY IF EXISTS "support letters write" ON %I', t);
    EXECUTE format($p$CREATE POLICY "support letters write" ON %I FOR ALL TO authenticated
      USING      (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales','sell_admin','engineer')))
      WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales','sell_admin','engineer')))$p$, t);
  END LOOP;
END $$;

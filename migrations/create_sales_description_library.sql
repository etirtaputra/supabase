-- ============================================================================
-- 22.2_sales_description_library — curated custom line texts for Sales Quotes
-- (mirrors 10.4_description_library on the project-quote side).
-- Entries feed the sales-quote item autocomplete for every sales user;
-- MANAGING the library (insert/update/delete) is owner-only, matching the
-- "library is only visible to Owners" rule for the editor page.
-- Paste-ready, idempotent. Run in Supabase → SQL Editor.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "22.2_sales_description_library" (
  entry_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description      TEXT NOT NULL DEFAULT '',
  unit             TEXT DEFAULT '',
  default_price    NUMERIC,          -- suggested sell price (IDR); NULL = none
  notes            TEXT DEFAULT '',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  created_by_email TEXT DEFAULT ''
);

ALTER TABLE "22.2_sales_description_library" ENABLE ROW LEVEL SECURITY;

-- Suggestions are for everyone signed in; curation is owner-only.
DROP POLICY IF EXISTS "sales lib read" ON "22.2_sales_description_library";
CREATE POLICY "sales lib read" ON "22.2_sales_description_library"
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "sales lib write" ON "22.2_sales_description_library";
CREATE POLICY "sales lib write" ON "22.2_sales_description_library"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));

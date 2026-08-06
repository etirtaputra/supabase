-- ============================================================================
-- ICAPROC — System Designer (roadmap Module 28), layer 2 groundwork
--
-- A sales quote can now carry the DESIGN that produced it, and each line can
-- say which part of that design it is. Together they make REGENERATE safe:
-- re-running the calculator replaces only the lines the engine owns, while a
-- line typed by hand (design_role NULL) survives untouched.
--
-- Nothing here changes an ordinary product quote: both columns stay NULL.
-- Paste-ready, idempotent. Run in Supabase → SQL Editor.
-- ============================================================================

ALTER TABLE "22.0_sales_quotes"      ADD COLUMN IF NOT EXISTS system_design JSONB;
ALTER TABLE "22.1_sales_quote_items" ADD COLUMN IF NOT EXISTS design_role   TEXT;

COMMENT ON COLUMN "22.0_sales_quotes".system_design IS
  'System Designer run: { engine, version, input, warnings, generated_at }. NULL = an ordinary product quote.';
COMMENT ON COLUMN "22.1_sales_quote_items".design_role IS
  'Which generated BoM line this is (role or role:param). NULL = typed by hand; REGENERATE never touches it.';

CREATE INDEX IF NOT EXISTS sales_quote_items_design_role_idx
  ON "22.1_sales_quote_items" (quote_id, design_role) WHERE design_role IS NOT NULL;

-- ============================================================================
-- Components without a selected unit default to 'unit'.
-- Backfills existing NULL/blank units and sets the column default so new
-- components created without a unit get 'unit' automatically.
-- Paste-ready, idempotent. Run in Supabase → SQL Editor. (Already applied live.)
-- ============================================================================
UPDATE "3.0_components" SET unit = 'unit' WHERE unit IS NULL OR btrim(unit) = '';
ALTER TABLE "3.0_components" ALTER COLUMN unit SET DEFAULT 'unit';

-- ============================================================================
-- Cost Basis for Project Quotes
-- Per item, the owner chooses what the Project Quote BOM builder shows as cost:
--   'tuc'      → raw TUC (actual landed cost)
--   'buffered' → Cost Basis = TUC + safety buffer % (default mode)
--   'hidden'   → no TUC at all (falls back to supplier quote / last-used cost)
-- Buffer % is global (app_settings.quote_cost_buffer_pct, seeded 5) with an
-- optional per-item override (3.0_components.quote_cost_buffer_pct, NULL=global).
-- Paste-ready, idempotent. Run in Supabase → SQL Editor.
-- ============================================================================

-- Tiny key-value store for app-wide settings (owner-writable)
CREATE TABLE IF NOT EXISTS app_settings (
  key              TEXT PRIMARY KEY,
  value            TEXT NOT NULL DEFAULT '',
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_by_email TEXT DEFAULT ''
);
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app settings read" ON app_settings;
CREATE POLICY "app settings read" ON app_settings
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "app settings write" ON app_settings;
CREATE POLICY "app settings write" ON app_settings
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));

INSERT INTO app_settings (key, value) VALUES ('quote_cost_buffer_pct', '5')
  ON CONFLICT (key) DO NOTHING;

-- Per-item cost mode + optional buffer override
ALTER TABLE "3.0_components" ADD COLUMN IF NOT EXISTS quote_cost_mode TEXT NOT NULL DEFAULT 'buffered';
ALTER TABLE "3.0_components" ADD COLUMN IF NOT EXISTS quote_cost_buffer_pct NUMERIC; -- NULL = use global

-- Carry over items already hidden via the earlier boolean switch
UPDATE "3.0_components" SET quote_cost_mode = 'hidden'
  WHERE show_tuc_in_quotes = FALSE AND quote_cost_mode = 'buffered';

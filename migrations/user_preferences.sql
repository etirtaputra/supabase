-- ICAPROC — a person's own preferences, kept with their ACCOUNT (2026-11-18)
--
-- ⚠ NOT YET APPLIED to production (2026-11-18: the approval prompt timed out).
-- Until it is, hooks/useExportCols reads nothing and falls back to this
-- browser's choice — the old behaviour — so the app works either way.
--
-- Owner, 2026-11-18: *"i want the mobile pdf to follow the desktop version"*.
-- The EPC proposal PDF's column choice (Brand / Qty / Unit / Lead time /
-- Amounts / Eng. notes — lib/exportCols.ts) lived in each browser's
-- localStorage, so a phone that had never been set printed the defaults while
-- the desktop printed the owner's choice. It now lives here, per person, and
-- every device that person signs in on reads the same choice
-- (hooks/useExportCols.ts). localStorage stays as a cache only.
--
-- One row per person; `prefs` is a JSON object of named preferences
-- ({ "quote_export_cols": {...} }) so the next preference needs no migration.
-- A person reads and writes ONLY their own row. Nothing here is visible to
-- anyone else, and no role is needed — any signed-in person may keep one.

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  prefs      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_preferences IS
  'A person''s own preferences, shared by every device they sign in on (e.g. quote_export_cols — the EPC PDF/Excel columns). Own row only.';

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own preferences" ON public.user_preferences;
CREATE POLICY "own preferences" ON public.user_preferences
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- New tables carry their own grants (Supabase, from 2026-10-30). anon: none.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_preferences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_preferences TO service_role;

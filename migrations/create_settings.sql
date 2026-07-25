-- ============================================================================
-- ICAPROC — Settings module (40.x)
--
-- One place where the values that used to be hard-coded per page live, so they
-- are configured ONCE and referenced everywhere: number/currency/date formats
-- (internal screens vs customer-facing documents), company letterhead, and the
-- operational defaults (PPN %, PO payment terms, slow-mover threshold, cost
-- drift threshold, EPC cost buffer, margin floor).
--
--   1. 40.0_settings          — key/value store (one row per setting), read by
--                               every authenticated user, written by owners.
--   2. allowed_emails RLS     — the sign-up allowlist had RLS ENABLED WITH NO
--                               POLICIES, so the app could neither read nor
--                               write it (same class of bug as payment_batches).
--                               Owners can now manage it from Settings › Users.
--   3. user_profiles hardening— the UPDATE policy was `USING (true)`: ANY
--                               authenticated user could promote themselves to
--                               owner via the API. Updates are now limited to
--                               your own row or an owner's, and a trigger
--                               rejects any role change not made by an owner.
--
-- Values absent from 40.0_settings fall back to the defaults in lib/settings.ts,
-- so the app behaves identically before anything is configured.
-- Paste-ready, idempotent. Safe to re-run.
-- ============================================================================

-- ── 40.0_settings ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "40.0_settings" (
  key              TEXT PRIMARY KEY,
  value            JSONB       NOT NULL DEFAULT 'null'::jsonb,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_email TEXT        NOT NULL DEFAULT ''
);

ALTER TABLE "40.0_settings" ENABLE ROW LEVEL SECURITY;

-- Read: every signed-in user (the whole app formats numbers off these).
DROP POLICY IF EXISTS "settings read" ON "40.0_settings";
CREATE POLICY "settings read" ON "40.0_settings"
  FOR SELECT TO authenticated USING (true);

-- Write: owners only — these values change what every other user sees.
DROP POLICY IF EXISTS "settings write" ON "40.0_settings";
CREATE POLICY "settings write" ON "40.0_settings"
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));

-- Carry the one pre-existing setting over from the legacy `app_settings`
-- key/value table (the EPC Cost Basis buffer %) so nothing changes on the way
-- across. `app_settings` is left in place, unread by the app from now on.
INSERT INTO "40.0_settings" (key, value, updated_by_email)
SELECT 'epcCostBufferPct',
       to_jsonb(COALESCE(NULLIF(a.value, '')::numeric, 5)),
       COALESCE(a.updated_by_email, '')
FROM app_settings a
WHERE a.key = 'quote_cost_buffer_pct'
  AND NOT EXISTS (SELECT 1 FROM "40.0_settings" s WHERE s.key = 'epcCostBufferPct');

-- ── 2. allowed_emails: RLS was on with no policies (table was unreachable) ───
ALTER TABLE allowed_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allowlist read" ON allowed_emails;
CREATE POLICY "allowlist read" ON allowed_emails
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));

DROP POLICY IF EXISTS "allowlist write" ON allowed_emails;
CREATE POLICY "allowlist write" ON allowed_emails
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));

-- ── 3. user_profiles: close the self-promotion hole ─────────────────────────
-- Before: "Authenticated users can update profiles" USING (true) — any signed-in
-- user could PATCH their own row to role='owner'.
DROP POLICY IF EXISTS "Authenticated users can update profiles" ON user_profiles;
DROP POLICY IF EXISTS "profiles update self or owner" ON user_profiles;
CREATE POLICY "profiles update self or owner" ON user_profiles
  FOR UPDATE TO authenticated
  USING      (id = auth.uid() OR EXISTS (SELECT 1 FROM user_profiles p WHERE p.id = auth.uid() AND p.role = 'owner'))
  WITH CHECK (id = auth.uid() OR EXISTS (SELECT 1 FROM user_profiles p WHERE p.id = auth.uid() AND p.role = 'owner'));

-- …and the role column itself is owner-only, whichever row it sits on.
-- auth.uid() IS NULL = a server-side/trigger context (e.g. the sign-up
-- allowlist trigger), which is allowed through.
CREATE OR REPLACE FUNCTION public.guard_user_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND auth.uid() IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM user_profiles p WHERE p.id = auth.uid() AND p.role = 'owner')
  THEN
    RAISE EXCEPTION 'Only an owner can change a user role';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_user_role_change ON user_profiles;
CREATE TRIGGER guard_user_role_change
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_role_change();

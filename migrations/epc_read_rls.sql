-- ============================================================================
-- ICAPROC — EPC (10.x) read RLS: module data only for roles with EPC access
--
-- Reads on the EPC proposal tables were open to every signed-in user
-- (SELECT USING true), so a sell-side login could pull proposal data through
-- the API even though the UI hid the module. Reads now mirror the write
-- capability set used by can_edit_quote(): owner, engineer, and the legacy
-- data_entry / finance roles. Sell-side roles (sell_admin, sales) and viewer
-- get nothing from 10.x — matching "modules a role can't access stay hidden".
-- Paste-ready, idempotent.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.can_view_epc() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND role IN ('owner','engineer','data_entry','finance')
  );
$fn$;

DROP POLICY IF EXISTS "quotes read" ON "10.0_project_quotes";
CREATE POLICY "quotes read" ON "10.0_project_quotes"
  FOR SELECT TO authenticated USING (public.can_view_epc());

DROP POLICY IF EXISTS "sections read" ON "10.1_quote_sections";
CREATE POLICY "sections read" ON "10.1_quote_sections"
  FOR SELECT TO authenticated USING (public.can_view_epc());

DROP POLICY IF EXISTS "items read" ON "10.2_quote_items";
CREATE POLICY "items read" ON "10.2_quote_items"
  FOR SELECT TO authenticated USING (public.can_view_epc());

DROP POLICY IF EXISTS "activity read" ON "10.3_quote_activity";
CREATE POLICY "activity read" ON "10.3_quote_activity"
  FOR SELECT TO authenticated USING (public.can_view_epc());

DROP POLICY IF EXISTS "library read" ON "10.4_description_library";
CREATE POLICY "library read" ON "10.4_description_library"
  FOR SELECT TO authenticated USING (public.can_view_epc());

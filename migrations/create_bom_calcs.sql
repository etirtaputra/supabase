-- ============================================================================
-- ICAPROC — BOM Calculator (beta): one saved calculation per row
--
-- The advanced EPC costing that replaces the engineers' multi-sheet Excel BOM
-- workbooks (owner, 2026-10-11). It lives BESIDE the EPC proposals: nothing
-- here reads or writes 10.0–10.5. A calculation may later be linked to the
-- proposal it became (project_quote_id), never the other way round.
--
-- The whole calculation is one jsonb document (lib/bomCalc/index.ts
-- BomCalcDoc, versioned by doc->>'version'): inputs only. Every quantity,
-- price and total is recomputed from it on open, so a saved file can never
-- carry a stale sum — the failure that cost the Excel files Rp 37–266 m.
--
-- Access = the EPC module's: owner, engineer and the legacy data_entry /
-- finance roles (can_view_epc()). Costs and margins are inside the document,
-- and those are exactly the roles that may see them (canEditQuotes).
-- Idempotent. Applied 2026-10-11 (ledger 20261011225941) through execute_sql
-- WITHOUT the DROP POLICY lines: the Supabase MCP holds statements it reads as
-- destructive for a confirmation the sandbox never shows (see HANDOFF §4).
-- ============================================================================

CREATE TABLE IF NOT EXISTS "10.6_bom_calcs" (
  calc_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL DEFAULT '',
  doc              jsonb NOT NULL,
  project_quote_id uuid NULL REFERENCES "10.0_project_quotes"(quote_id) ON DELETE SET NULL,
  created_by_email text NULL,
  updated_by_email text NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE "10.6_bom_calcs" IS
  'BOM Calculator (beta): one EPC costing per row. doc = inputs only (lib/bomCalc BomCalcDoc); quantities, prices and totals are recomputed on open. Never written by the EPC proposal editor.';

CREATE INDEX IF NOT EXISTS bom_calcs_updated_idx ON "10.6_bom_calcs" (updated_at DESC);

ALTER TABLE "10.6_bom_calcs" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bom calcs read" ON "10.6_bom_calcs";
CREATE POLICY "bom calcs read" ON "10.6_bom_calcs"
  FOR SELECT TO authenticated USING (public.can_view_epc());

DROP POLICY IF EXISTS "bom calcs insert" ON "10.6_bom_calcs";
CREATE POLICY "bom calcs insert" ON "10.6_bom_calcs"
  FOR INSERT TO authenticated WITH CHECK (public.can_view_epc());

DROP POLICY IF EXISTS "bom calcs update" ON "10.6_bom_calcs";
CREATE POLICY "bom calcs update" ON "10.6_bom_calcs"
  FOR UPDATE TO authenticated USING (public.can_view_epc()) WITH CHECK (public.can_view_epc());

DROP POLICY IF EXISTS "bom calcs delete" ON "10.6_bom_calcs";
CREATE POLICY "bom calcs delete" ON "10.6_bom_calcs"
  FOR DELETE TO authenticated USING (public.can_view_epc());

-- ============================================================================
-- ICAPROC — payment_batches RLS fix + po_costs write alignment
--
-- payment_batches had RLS ENABLED but NO policies, so every insert failed
-- with "new row violates row-level security policy" — batch payments were
-- broken for everyone. Meanwhile 6.0_po_costs writes were open to ANY
-- signed-in user (USING true), far looser than intended.
--
-- Both now share one rule: reads for any signed-in user (landed costs feed
-- computeTUC in the EPC editor, so engineers need read), writes for the
-- buy-side payment roles: owner, buy_admin, and legacy data_entry / finance.
-- Paste-ready, idempotent.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.can_write_po_costs() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND role IN ('owner','buy_admin','data_entry','finance')
  );
$fn$;

-- payment_batches: previously had zero policies (all writes rejected)
ALTER TABLE payment_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payment batches read" ON payment_batches;
CREATE POLICY "payment batches read" ON payment_batches
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "payment batches write" ON payment_batches;
CREATE POLICY "payment batches write" ON payment_batches
  FOR ALL TO authenticated
  USING (public.can_write_po_costs())
  WITH CHECK (public.can_write_po_costs());

-- 6.0_po_costs: replace the wide-open write with the same role set
DROP POLICY IF EXISTS "authenticated write" ON "6.0_po_costs";
DROP POLICY IF EXISTS "po costs write" ON "6.0_po_costs";
CREATE POLICY "po costs write" ON "6.0_po_costs"
  FOR ALL TO authenticated
  USING (public.can_write_po_costs())
  WITH CHECK (public.can_write_po_costs());

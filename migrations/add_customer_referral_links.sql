-- ============================================================================
-- ICAPROC — CRM: "Referred by" + customer-to-customer links (owner, 2026-08-01)
-- Adds 20.0_customers.referred_by and table 20.2_customer_links.
-- Paste-ready, idempotent. Run in Supabase → SQL Editor → New query.
-- ============================================================================

-- Who brought this customer in — free text on purpose: a referrer can be
-- another customer, a person, or "IG ads"; a hard FK would reject most of them.
ALTER TABLE "20.0_customers" ADD COLUMN IF NOT EXISTS referred_by TEXT NOT NULL DEFAULT '';

-- ── 20.2_customer_links ─────────────────────────────────────────────────────
-- Related companies (same group, subsidiary, sister company…). One row per
-- pair; the app reads BOTH directions and rewrites all rows touching a
-- customer when its links are edited, so either side can manage the pair.
CREATE TABLE IF NOT EXISTS "20.2_customer_links" (
  link_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        UUID NOT NULL REFERENCES "20.0_customers"(customer_id) ON DELETE CASCADE,
  linked_customer_id UUID NOT NULL REFERENCES "20.0_customers"(customer_id) ON DELETE CASCADE,
  note               TEXT NOT NULL DEFAULT '',
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT customer_links_distinct CHECK (customer_id <> linked_customer_id),
  CONSTRAINT customer_links_unique UNIQUE (customer_id, linked_customer_id)
);
CREATE INDEX IF NOT EXISTS customer_links_customer_idx ON "20.2_customer_links" (customer_id);
CREATE INDEX IF NOT EXISTS customer_links_linked_idx   ON "20.2_customer_links" (linked_customer_id);

-- ── Row-Level Security — same contract as 20.0/20.1 ─────────────────────────
ALTER TABLE "20.2_customer_links" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customer links read" ON "20.2_customer_links";
CREATE POLICY "customer links read" ON "20.2_customer_links"
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "customer links write" ON "20.2_customer_links";
CREATE POLICY "customer links write" ON "20.2_customer_links"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales')));

-- Close anonymous access to the buy side. URGENT — this was live.
--
-- Proven by a rolled-back probe on 2026-09-06 (`set local role anon`), the
-- anon role could READ 37 suppliers, 226 purchase orders, 651 PO line items
-- WITH UNIT COSTS and all 1,005 catalogue rows, and could UPDATE the
-- catalogue. The anon key ships in the JavaScript of every page on
-- icaproc.com, so this needed no login and no credential theft: load the site,
-- read the key out of the bundle, query the API directly.
--
-- These policies target the `public` ROLE, which in Postgres means every role
-- INCLUDING `anon` — not "public data". That is almost certainly how they were
-- written by mistake, and why an "authenticated read" policy sitting beside
-- them made everything look gated.
--
-- Nothing legitimate depends on them, verified before applying:
--   * every page is behind `useAuth`, so browser requests carry the user's JWT
--     and arrive as `authenticated`, never `anon`;
--   * `app/api/ask` and `app/api/next-step` use the anon key ONLY for
--     `auth.getUser(token)` and read data with the service-role key, which
--     bypasses RLS entirely.

-- ── Anonymous READ of the buy side ──────────────────────────────────────────
DROP POLICY IF EXISTS "Allow public read access"      ON "2.0_suppliers";
DROP POLICY IF EXISTS "Allow public read purchases"   ON "5.0_purchases";
DROP POLICY IF EXISTS "Allow public read lines"       ON "5.1_purchase_line_items";
DROP POLICY IF EXISTS "Allow public read components"  ON "3.0_components";

-- ── Anonymous WRITE of the catalogue ────────────────────────────────────────
-- `allow_update` was ALL-role UPDATE USING (true) WITH CHECK (true): anyone
-- could rewrite every price, description and spec in the catalogue.
DROP POLICY IF EXISTS "allow_update" ON "3.0_components";

-- ── A duplicate that only obscured the picture ──────────────────────────────
-- 8.0_component_links carried two identical ALL policies for `authenticated`.
DROP POLICY IF EXISTS "component_links_authenticated" ON "8.0_component_links";

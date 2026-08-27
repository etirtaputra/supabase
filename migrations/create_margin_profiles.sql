-- ============================================================================
-- ICAPROC — 21.2_margin_profiles: what margin a category is SUPPOSED to earn
--
-- The owner's spec (2026-08-27): classify categories into pricing profiles,
-- let an admin set the target margin range per profile, and show the tier as a
-- tag in the Item Editor.
--
-- TWO DEPARTURES FROM THE SPEC AS WRITTEN, both because the spec was written
-- against a generic schema and says to adjust:
--   • it names a `products` table; ICAPROC's item master is `3.0_components`.
--   • it names the table `margin_profiles`; the house convention (CLAUDE.md,
--     docs/ERP_ROADMAP.md) puts pricing in the 21.x block, beside
--     21.0_price_tiers and 21.1_item_tier_prices. Hence 21.2.
--
-- The category names in the spec are display names; the column holds
-- snake_case enum values (constants/enums.ts). "Inverters" is FOUR of them —
-- the owner's call (2026-08-27) is that all four are Value Capture.
--
-- The targets are DATA, not constants. Nothing in the app hardcodes 10-15 or
-- 20-25; an admin moves them on /pricing without a deploy.
--
-- Paste-ready and idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "21.2_margin_profiles" (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text UNIQUE NOT NULL,
  label             text NOT NULL,
  margin_target_min numeric(5,2) NOT NULL,
  margin_target_max numeric(5,2) NOT NULL,
  description       text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  -- An admin types these. A range that runs backwards, or a negative floor,
  -- is a typo the screen should not be able to save.
  CONSTRAINT margin_profile_range CHECK (margin_target_min <= margin_target_max),
  CONSTRAINT margin_profile_sane  CHECK (margin_target_min >= 0 AND margin_target_max <= 100)
);

ALTER TABLE "3.0_components"
  ADD COLUMN IF NOT EXISTS margin_profile_id uuid REFERENCES "21.2_margin_profiles"(id);

CREATE INDEX IF NOT EXISTS components_margin_profile_idx
  ON "3.0_components" (margin_profile_id);

-- ── Seed: the two profiles ──────────────────────────────────────────────────
-- ON CONFLICT DO NOTHING, not DO UPDATE: re-running this must never reset a
-- range the owner has since edited on the settings screen.
INSERT INTO "21.2_margin_profiles" (code, label, margin_target_min, margin_target_max, description)
VALUES
  ('loss_leader',   'Loss Leader',   10.00, 15.00,
   'Commodity, low-touch items used to win the deal — price-transparent, low after-sales burden.'),
  ('value_capture', 'Value Capture', 20.00, 25.00,
   'Technical, high-touch items that fund overall margin and cover after-sales/support cost.')
ON CONFLICT (code) DO NOTHING;

-- ── Seed: category → profile ────────────────────────────────────────────────
-- Only where nothing has been set, so a hand-placed item is never overwritten.
UPDATE "3.0_components" SET margin_profile_id =
  (SELECT id FROM "21.2_margin_profiles" WHERE code = 'loss_leader')
WHERE margin_profile_id IS NULL
  AND category IN ('pv_module', 'batteries', 'pv_cable', 'mounting');

UPDATE "3.0_components" SET margin_profile_id =
  (SELECT id FROM "21.2_margin_profiles" WHERE code = 'value_capture')
WHERE margin_profile_id IS NULL
  AND category IN ('on_grid_inverter', 'inverter_charger', 'power_inverter',
                   'solar_pump_inverter', 'solar_charge_controller');

-- Everything else stays NULL on purpose. NULL means "Unclassified" and the
-- Item Editor says so out loud — the owner's acceptance criterion is that a
-- gap is visible rather than silently defaulted into a tier.

ALTER TABLE "21.2_margin_profiles" ENABLE ROW LEVEL SECURITY;

-- Mirrors 21.0_price_tiers exactly: everyone signed in can READ a profile
-- (the Item Editor tag needs it), owner + sell_admin can change one.
DROP POLICY IF EXISTS "margin profiles read" ON "21.2_margin_profiles";
CREATE POLICY "margin profiles read" ON "21.2_margin_profiles"
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "margin profiles write" ON "21.2_margin_profiles";
CREATE POLICY "margin profiles write" ON "21.2_margin_profiles"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sell_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sell_admin')));

COMMENT ON TABLE "21.2_margin_profiles" IS
  'Target margin band per pricing profile. Admin-editable on /pricing; never hardcoded in app code.';

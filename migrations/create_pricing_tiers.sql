-- ============================================================================
-- ICAPROC — Module 2: Price List + Tiering (21.x)
-- 21.0_price_tiers  = the canonical customer tiers (default % off list + floor)
-- 21.1_item_tier_prices = per-item overrides (absolute IDR or custom %)
-- Paste-ready, idempotent. Safe to re-run. Run in Supabase → SQL Editor.
-- ============================================================================

-- ── 21.0_price_tiers ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "21.0_price_tiers" (
  tier_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_code            TEXT NOT NULL DEFAULT '',   -- stored on 20.0_customers.tier
  name                 TEXT NOT NULL DEFAULT '',
  default_discount_pct NUMERIC NOT NULL DEFAULT 0, -- % off list price (3.0_components.selling_price_idr)
  margin_floor_pct     NUMERIC NOT NULL DEFAULT 0, -- min margin over landed cost (TUC); soft warning
  sort_order           INTEGER NOT NULL DEFAULT 0,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  created_by_email     TEXT DEFAULT '',
  updated_by_email     TEXT DEFAULT ''
);
ALTER TABLE "21.0_price_tiers" ADD COLUMN IF NOT EXISTS tier_code            TEXT NOT NULL DEFAULT '';
ALTER TABLE "21.0_price_tiers" ADD COLUMN IF NOT EXISTS name                 TEXT NOT NULL DEFAULT '';
ALTER TABLE "21.0_price_tiers" ADD COLUMN IF NOT EXISTS default_discount_pct NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE "21.0_price_tiers" ADD COLUMN IF NOT EXISTS margin_floor_pct     NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE "21.0_price_tiers" ADD COLUMN IF NOT EXISTS sort_order           INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "21.0_price_tiers" ADD COLUMN IF NOT EXISTS is_active            BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE "21.0_price_tiers" ADD COLUMN IF NOT EXISTS created_at           TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE "21.0_price_tiers" ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE "21.0_price_tiers" ADD COLUMN IF NOT EXISTS created_by_email     TEXT DEFAULT '';
ALTER TABLE "21.0_price_tiers" ADD COLUMN IF NOT EXISTS updated_by_email     TEXT DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS price_tiers_code_unique
  ON "21.0_price_tiers" (lower(tier_code)) WHERE tier_code <> '';

-- ── 21.1_item_tier_prices ───────────────────────────────────────────────────
-- Effective price for (item, tier):
--   override_price_idr           if set, else
--   list * (1 - COALESCE(override_discount_pct, tier.default_discount_pct)/100)
CREATE TABLE IF NOT EXISTS "21.1_item_tier_prices" (
  price_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id          UUID NOT NULL REFERENCES "3.0_components"(component_id) ON DELETE CASCADE,
  tier_id               UUID NOT NULL REFERENCES "21.0_price_tiers"(tier_id) ON DELETE CASCADE,
  override_price_idr    NUMERIC,   -- absolute price; wins over any discount
  override_discount_pct NUMERIC,   -- custom % off list for this item+tier
  notes                 TEXT DEFAULT '',
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  created_by_email      TEXT DEFAULT '',
  updated_by_email      TEXT DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS item_tier_prices_unique
  ON "21.1_item_tier_prices" (component_id, tier_id);
CREATE INDEX IF NOT EXISTS item_tier_prices_tier_idx
  ON "21.1_item_tier_prices" (tier_id);

-- ── Audit trigger (shared) ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stamp_pricing_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE actor TEXT;
BEGIN
  SELECT email INTO actor FROM user_profiles WHERE id = auth.uid();
  actor := COALESCE(actor, 'system');
  IF TG_OP = 'INSERT' THEN
    NEW.created_by_email := actor;
    NEW.updated_by_email := actor;
    NEW.created_at := COALESCE(NEW.created_at, NOW());
    NEW.updated_at := NOW();
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.updated_by_email := actor;
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS stamp_pricing_audit ON "21.0_price_tiers";
CREATE TRIGGER stamp_pricing_audit
  BEFORE INSERT OR UPDATE ON "21.0_price_tiers"
  FOR EACH ROW EXECUTE FUNCTION public.stamp_pricing_audit();

DROP TRIGGER IF EXISTS stamp_pricing_audit ON "21.1_item_tier_prices";
CREATE TRIGGER stamp_pricing_audit
  BEFORE INSERT OR UPDATE ON "21.1_item_tier_prices"
  FOR EACH ROW EXECUTE FUNCTION public.stamp_pricing_audit();

-- ── Row-Level Security ──────────────────────────────────────────────────────
-- Read: any signed-in user (sell-side modules read tier prices).
-- Write: owners only (pricing strategy exposes margin vs landed cost).
ALTER TABLE "21.0_price_tiers" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "price tiers read" ON "21.0_price_tiers";
CREATE POLICY "price tiers read" ON "21.0_price_tiers"
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "price tiers write" ON "21.0_price_tiers";
CREATE POLICY "price tiers write" ON "21.0_price_tiers"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));

ALTER TABLE "21.1_item_tier_prices" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "item tier prices read" ON "21.1_item_tier_prices";
CREATE POLICY "item tier prices read" ON "21.1_item_tier_prices"
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "item tier prices write" ON "21.1_item_tier_prices";
CREATE POLICY "item tier prices write" ON "21.1_item_tier_prices"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));

-- ── Seed a starter tier set (idempotent by tier_code) ───────────────────────
INSERT INTO "21.0_price_tiers" (tier_code, name, default_discount_pct, margin_floor_pct, sort_order)
SELECT v.tier_code, v.name, v.default_discount_pct, v.margin_floor_pct, v.sort_order
FROM (VALUES
  ('retail',      'Retail',      0,  20, 1),
  ('dealer',      'Dealer',      7,  12, 2),
  ('distributor', 'Distributor', 12, 8,  3)
) AS v(tier_code, name, default_discount_pct, margin_floor_pct, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM "21.0_price_tiers" t WHERE lower(t.tier_code) = lower(v.tier_code)
);

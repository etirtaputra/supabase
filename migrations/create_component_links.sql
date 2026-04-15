-- ─────────────────────────────────────────────────────────────────────────────
-- 8.0_component_links  –  Cross-reference / equivalent model registry
-- ─────────────────────────────────────────────────────────────────────────────
-- Links two components so you can compare their TUC and market intel
-- side-by-side without context switching.
--
-- Link types:
--   exact_model         — Same specs, drop-in replacement (may differ in brand)
--   brand_equivalent    — Same brand/function, different model number
--   normalized          — Different specs; compare via a unit metric (cost/Wp etc.)
--   category_comparable — Same category, general market reference (no normalization)
--   successor           — One product replaces / supersedes the other
--
-- Normalized comparison example:
--   550Wp panel (norm_value_a=550) vs 715Wp panel (norm_value_b=715), unit="Wp"
--   → compute TUC ÷ Wp for each side and show delta %
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "8.0_component_links" (
  link_id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,

  -- The two linked components (stored with smaller UUID as _a to avoid duplicates)
  component_id_a       uuid        NOT NULL REFERENCES "3.0_components"(component_id) ON DELETE CASCADE,
  component_id_b       uuid        NOT NULL REFERENCES "3.0_components"(component_id) ON DELETE CASCADE,

  -- Relationship classification
  link_type            text        NOT NULL DEFAULT 'category_comparable',
                                   -- exact_model | brand_equivalent | normalized |
                                   -- category_comparable | successor

  -- Normalization fields (only used when link_type = 'normalized')
  normalization_unit   text,       -- 'Wp' | 'kWh' | 'kW' | 'Ah' | 'kg' | 'unit' | custom
  norm_value_a         numeric,    -- spec value for component_a (e.g. 550 for 550 Wp)
  norm_value_b         numeric,    -- spec value for component_b (e.g. 715 for 715 Wp)

  notes                text,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  -- Prevent duplicate links (store a < b so (a,b) and (b,a) collapse to one row)
  CONSTRAINT uq_component_link UNIQUE (component_id_a, component_id_b),
  CONSTRAINT no_self_link      CHECK  (component_id_a <> component_id_b)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_component_links_a
  ON "8.0_component_links" (component_id_a);

CREATE INDEX IF NOT EXISTS idx_component_links_b
  ON "8.0_component_links" (component_id_b);

-- ── Auto-update updated_at ─────────────────────────────────────────────────────
-- Reuses set_updated_at() created in create_competitor_prices.sql
CREATE OR REPLACE TRIGGER component_links_updated_at
  BEFORE UPDATE ON "8.0_component_links"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Row Level Security ─────────────────────────────────────────────────────────
ALTER TABLE "8.0_component_links" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "component_links_authenticated" ON "8.0_component_links"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── Comments ───────────────────────────────────────────────────────────────────
COMMENT ON TABLE "8.0_component_links" IS
  'Cross-references between components for TUC and market-intel comparison (equivalent models, normalized comparisons, successors).';

COMMENT ON COLUMN "8.0_component_links".link_type IS
  'exact_model=drop-in replacement; brand_equivalent=same function diff brand; normalized=compare via unit metric; category_comparable=general reference; successor=one replaces the other.';

COMMENT ON COLUMN "8.0_component_links".normalization_unit IS
  'Unit for cost-per-unit comparison when link_type=normalized. Common values: Wp (solar), kWh (batteries), kW (inverters), Ah, kg.';

COMMENT ON COLUMN "8.0_component_links".norm_value_a IS
  'Capacity/rating of component_a in normalization_unit. E.g. 550 for a 550 Wp panel.';

COMMENT ON COLUMN "8.0_component_links".norm_value_b IS
  'Capacity/rating of component_b in normalization_unit. E.g. 715 for a 715 Wp panel.';

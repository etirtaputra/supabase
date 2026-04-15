-- 8.0_component_links: cross-reference / equivalent model registry
-- Links two components for side-by-side TUC and market-intel comparison.
--
-- link_type values:
--   exact_model         - same specs, drop-in replacement
--   brand_equivalent    - same function, different brand/model
--   normalized          - different specs, compare via cost-per-unit (e.g. IDR/Wp)
--   category_comparable - same category, general market reference
--   successor           - one product replaces the other

CREATE TABLE IF NOT EXISTS "8.0_component_links" (
  link_id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  component_id_a       uuid        NOT NULL REFERENCES "3.0_components"(component_id) ON DELETE CASCADE,
  component_id_b       uuid        NOT NULL REFERENCES "3.0_components"(component_id) ON DELETE CASCADE,
  link_type            text        NOT NULL DEFAULT 'category_comparable',
  normalization_unit   text,
  norm_value_a         numeric,
  norm_value_b         numeric,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_component_link UNIQUE (component_id_a, component_id_b),
  CONSTRAINT no_self_link      CHECK  (component_id_a <> component_id_b)
);

CREATE INDEX IF NOT EXISTS idx_component_links_a ON "8.0_component_links" (component_id_a);
CREATE INDEX IF NOT EXISTS idx_component_links_b ON "8.0_component_links" (component_id_b);

DROP TRIGGER IF EXISTS component_links_updated_at ON "8.0_component_links";
CREATE TRIGGER component_links_updated_at
  BEFORE UPDATE ON "8.0_component_links"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "8.0_component_links" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "component_links_authenticated" ON "8.0_component_links"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

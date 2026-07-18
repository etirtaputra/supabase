'use client';
import { useEffect, useState } from 'react';
import { createSupabaseClient } from '@/lib/supabase';

// Idempotent schema for the Pricing (tiers) module. Keep in sync with
// migrations/create_pricing_tiers.sql and the probe below.
const MIGRATION_SQL = `CREATE TABLE IF NOT EXISTS "21.0_price_tiers" (
  tier_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_code            TEXT NOT NULL DEFAULT '',
  name                 TEXT NOT NULL DEFAULT '',
  default_discount_pct NUMERIC NOT NULL DEFAULT 0,
  margin_floor_pct     NUMERIC NOT NULL DEFAULT 0,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  created_by_email     TEXT DEFAULT '',
  updated_by_email     TEXT DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS price_tiers_code_unique
  ON "21.0_price_tiers" (lower(tier_code)) WHERE tier_code <> '';

CREATE TABLE IF NOT EXISTS "21.1_item_tier_prices" (
  price_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id          UUID NOT NULL REFERENCES "3.0_components"(component_id) ON DELETE CASCADE,
  tier_id               UUID NOT NULL REFERENCES "21.0_price_tiers"(tier_id) ON DELETE CASCADE,
  override_price_idr    NUMERIC,
  override_discount_pct NUMERIC,
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

INSERT INTO "21.0_price_tiers" (tier_code, name, default_discount_pct, margin_floor_pct, sort_order)
SELECT v.tier_code, v.name, v.default_discount_pct, v.margin_floor_pct, v.sort_order
FROM (VALUES
  ('retail','Retail',0,20,1),('dealer','Dealer',7,12,2),('distributor','Distributor',12,8,3)
) AS v(tier_code, name, default_discount_pct, margin_floor_pct, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM "21.0_price_tiers" t WHERE lower(t.tier_code) = lower(v.tier_code));`;

/** Probes the pricing tables; shows copyable SQL when the DB is behind. */
export default function PricingMigrationBanner() {
  const supabase = createSupabaseClient();
  const [missing, setMissing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSql, setShowSql] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      const probes = await Promise.all([
        supabase.from('21.0_price_tiers').select('tier_id, tier_code, default_discount_pct, margin_floor_pct').limit(1),
        supabase.from('21.1_item_tier_prices').select('price_id, component_id, tier_id, override_price_idr').limit(1),
      ]);
      if (!cancelled && probes.some((p) => p.error)) setMissing(true);
    }
    check();
    return () => { cancelled = true; };
  }, []);

  if (!missing) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(MIGRATION_SQL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setShowSql(true);
    }
  }

  return (
    <div className="bg-amber-500/10 border border-amber-500/40 rounded-2xl p-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-amber-300 font-semibold">Pricing tables are not set up yet.</span>
        <span className="text-amber-200/80 text-xs">
          Tiers and tier prices will fail to save until the migration runs. Copy the SQL, then run it in
          Supabase → SQL Editor → New query.
        </span>
        <div className="flex gap-2 ml-auto">
          <button onClick={copy}
            className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-semibold transition-colors">
            {copied ? 'Copied ✓' : 'Copy SQL'}
          </button>
          <button onClick={() => setShowSql((v) => !v)}
            className="px-3 py-1.5 rounded-lg text-amber-300/70 hover:text-amber-200 text-xs transition-colors">
            {showSql ? 'Hide' : 'Show'} SQL
          </button>
        </div>
      </div>
      {showSql && (
        <pre className="mt-3 p-3 bg-black/30 rounded-xl text-[10px] leading-relaxed text-amber-100/80 overflow-x-auto max-h-64 overflow-y-auto select-all">
          {MIGRATION_SQL}
        </pre>
      )}
    </div>
  );
}

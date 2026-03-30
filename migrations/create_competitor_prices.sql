-- ─────────────────────────────────────────────────────────────────
-- 7.0_competitor_prices  –  Market Intelligence / Revenue Management
-- ─────────────────────────────────────────────────────────────────
-- Records observed competitor / market prices so you can compare them
-- against your True Unit Cost and make data-driven sell-price decisions.
--
-- Usage pattern (like airline/hotel yield management):
--   1. Log a competitor's price with source and confidence metadata.
--   2. Link it to your own component (component_id).
--   3. The front-end CompetitorPriceForm shows a live price index:
--        (their price − your PO cost) / your PO cost × 100
--   4. Use the resulting signal to set sell price with a conscious margin.
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "7.0_competitor_prices" (
  competitor_price_id   uuid            DEFAULT gen_random_uuid() PRIMARY KEY,

  -- ── Competitor product description ───────────────────────────────────
  competitor_brand      text,
  competitor_model      text,
  competitor_description text,
  category              text,            -- mirrors product_category enum
  capacity_w            numeric,         -- Wp (PV) or kWh (battery) for normalisation

  -- ── Pricing ──────────────────────────────────────────────────────────
  unit_price            numeric         NOT NULL,
  currency              text            NOT NULL DEFAULT 'USD',
  min_quantity          integer,        -- volume threshold this price applies to
  incoterms             text,           -- EXW / FOB / CIF etc.
  price_type            text,           -- listed | quoted | contracted | estimated | market_report

  -- ── Reference to our own component ───────────────────────────────────
  component_id          uuid            REFERENCES "3.0_components"(component_id) ON DELETE SET NULL,

  -- ── Source provenance ────────────────────────────────────────────────
  source_type           text,           -- website | supplier_quote | customer_info | industry_report | trade_show | distributor_list | other
  source_name           text,           -- e.g. "Lazada", "PVInfoLink Weekly", "Customer ABC"
  source_url            text,
  region                text,           -- e.g. "Indonesia", "Philippines"

  -- ── Dates ────────────────────────────────────────────────────────────
  observed_at           timestamptz     NOT NULL DEFAULT now(),   -- when price was seen; manually editable
  valid_until           date,           -- price expiry if known

  -- ── Analysis metadata ────────────────────────────────────────────────
  confidence            text            DEFAULT 'medium',  -- high | medium | low
  notes                 text,

  -- ── Auto timestamps ──────────────────────────────────────────────────
  created_at            timestamptz     NOT NULL DEFAULT now(),
  updated_at            timestamptz     NOT NULL DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_competitor_prices_component
  ON "7.0_competitor_prices" (component_id);

CREATE INDEX IF NOT EXISTS idx_competitor_prices_observed
  ON "7.0_competitor_prices" (observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_competitor_prices_category
  ON "7.0_competitor_prices" (category);

-- ── Auto-update updated_at ────────────────────────────────────────────────────
-- Plain trigger function — no extension required
CREATE OR REPLACE FUNCTION set_updated_at()
  RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER competitor_prices_updated_at
  BEFORE UPDATE ON "7.0_competitor_prices"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE "7.0_competitor_prices" ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read/write (adjust as needed)
CREATE POLICY "competitor_prices_authenticated" ON "7.0_competitor_prices"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── Comments ──────────────────────────────────────────────────────────────────
COMMENT ON TABLE "7.0_competitor_prices" IS
  'Market intelligence: observed competitor prices for revenue management and sell-price optimisation.';
COMMENT ON COLUMN "7.0_competitor_prices".capacity_w IS
  'Power (Wp) or energy capacity (kWh) — used to normalise to price-per-Wp for apples-to-apples comparison.';
COMMENT ON COLUMN "7.0_competitor_prices".observed_at IS
  'When this price was observed or received. User-editable so historical quotes can be backdated.';
COMMENT ON COLUMN "7.0_competitor_prices".price_type IS
  'listed = public catalogue; quoted = formal quote received; contracted = known deal price; estimated = derived; market_report = industry publication.';
COMMENT ON COLUMN "7.0_competitor_prices".confidence IS
  'Reliability of this data point. Used to weight averages. high=signed quote/contract, medium=website/report, low=hearsay/estimate.';

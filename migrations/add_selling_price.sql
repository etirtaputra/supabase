-- Ensure selling_price_idr exists on 3.0_components.
-- Handles all states:
--   1. Neither column exists yet → add selling_price_idr
--   2. selling_price_usd was added by the previous migration → rename it
--   3. selling_price_idr already exists → no-op (IF NOT EXISTS)

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = '3.0_components' AND column_name = 'selling_price_usd'
  ) THEN
    ALTER TABLE "3.0_components" RENAME COLUMN selling_price_usd TO selling_price_idr;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = '3.0_components' AND column_name = 'selling_price_idr'
  ) THEN
    ALTER TABLE "3.0_components" ADD COLUMN selling_price_idr numeric;
  END IF;
END $$;

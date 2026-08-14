-- Lead time becomes free text so Settings › Terms can offer custom options
-- (the "Lead Time editor", 2026-08-14). Values are unchanged — '45 working
-- days' stays exactly that string; only the column's type stops being an enum.
-- Idempotent: the ALTER runs only while the column is still enum-typed, and
-- the type drop is guarded.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = '4.0_price_quotes' AND column_name = 'estimated_lead_time_days'
      AND data_type = 'USER-DEFINED'
  ) THEN
    ALTER TABLE "4.0_price_quotes"
      ALTER COLUMN estimated_lead_time_days TYPE text
      USING estimated_lead_time_days::text;
  END IF;
END $$;

DROP TYPE IF EXISTS estimated_lead_time_days;

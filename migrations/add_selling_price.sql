-- Add selling_price_idr to components for margin tracking
ALTER TABLE "3.0_components"
  ADD COLUMN IF NOT EXISTS selling_price_idr numeric;

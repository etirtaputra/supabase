-- Add packing/logistics fields to pv_modules
ALTER TABLE pv_modules
  ADD COLUMN IF NOT EXISTS packing_pcs_per_pallet          INTEGER,
  ADD COLUMN IF NOT EXISTS packing_pallets_per_container   INTEGER,
  ADD COLUMN IF NOT EXISTS packing_total_pcs_per_container INTEGER;

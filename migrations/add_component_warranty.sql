-- Warranty period per product, shown on the sell-side Products list.
-- (datasheet_url already exists on 3.0_components.)
ALTER TABLE "3.0_components" ADD COLUMN IF NOT EXISTS warranty TEXT DEFAULT '';

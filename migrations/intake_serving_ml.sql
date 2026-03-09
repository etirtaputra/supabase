-- Add serving_ml column to intake_items
-- This stores the volume in ml for one default serving (useful for caffeine items).
-- e.g. an espresso shot = 40ml → 120mg caffeine
-- 0 means not set.

ALTER TABLE intake_items
  ADD COLUMN IF NOT EXISTS serving_ml numeric NOT NULL DEFAULT 0;

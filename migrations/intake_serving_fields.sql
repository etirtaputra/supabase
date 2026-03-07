-- Add serving size fields to intake_items
ALTER TABLE intake_items
  ADD COLUMN IF NOT EXISTS serving_count NUMERIC NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS serving_label TEXT    NOT NULL DEFAULT '';

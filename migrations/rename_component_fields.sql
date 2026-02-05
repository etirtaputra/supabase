-- Migration: Rename component fields for clarity
-- Changes:
--   - model_sku → supplier_model (clearer intent, avoids confusion with quote_line_items.supplier_description)
--   - description → internal_description (clarifies it's our internal description for OEM items)

-- Rename columns in 3.0_components table
ALTER TABLE "3.0_components"
  RENAME COLUMN model_sku TO supplier_model;

ALTER TABLE "3.0_components"
  RENAME COLUMN description TO internal_description;

-- Update any indexes that reference these columns
-- (PostgreSQL automatically updates index column references when renaming columns)

-- Verify the changes
COMMENT ON COLUMN "3.0_components".supplier_model IS 'Supplier/manufacturer model number or SKU';
COMMENT ON COLUMN "3.0_components".internal_description IS 'Internal description for OEM components or custom parts';

-- Note: No data migration needed since we're just renaming columns
-- All foreign key relationships remain intact (they reference component_id)

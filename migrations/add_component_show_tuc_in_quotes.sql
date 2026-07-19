-- Per-product switch: should this component's TUC (landed cost) auto-show in
-- the Project Quote BOM builder? Default TRUE — owners turn it off per item
-- (e.g. a one-off deal that skews TUC). Catalog/Insights always show TUC.
ALTER TABLE "3.0_components" ADD COLUMN IF NOT EXISTS show_tuc_in_quotes BOOLEAN NOT NULL DEFAULT TRUE;

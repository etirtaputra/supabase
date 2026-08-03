-- Sales quote lines remember the =formula behind Qty / Unit price (EPC parity).
-- The stored quantity/unit_price stays the evaluated NUMBER — documents, totals
-- and stock math never see a formula; the formula is what the editor shows
-- again on focus and tags with the ƒ badge. Idempotent.

ALTER TABLE "22.1_sales_quote_items"
  ADD COLUMN IF NOT EXISTS qty_formula   text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS price_formula text NOT NULL DEFAULT '';

COMMENT ON COLUMN "22.1_sales_quote_items".qty_formula IS
  'Excel-style formula behind quantity (e.g. =2*6); '''' = typed number.';
COMMENT ON COLUMN "22.1_sales_quote_items".price_formula IS
  'Excel-style formula behind unit_price; '''' = typed number.';

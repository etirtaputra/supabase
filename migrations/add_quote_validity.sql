-- Quote validity: a sales quotation carries the date its offer stops standing.
-- Prefilled from Settings › Defaults ("Quotation valid for N days") on new
-- quotes; printed on the PDF ("Berlaku s/d …"); validated/sent quotes past it
-- show an Expired badge on /sales and in the editor. NULL = no expiry (all
-- pre-existing quotes stay unbadged — no retroactive expiry).
-- Idempotent.

ALTER TABLE "22.0_sales_quotes"
  ADD COLUMN IF NOT EXISTS valid_until date;

COMMENT ON COLUMN "22.0_sales_quotes".valid_until IS
  'Offer stands until this date (inclusive). NULL = no expiry. Prefilled quote_date + quoteValidityDays.';

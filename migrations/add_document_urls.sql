-- Add document link fields to components, quotes, and purchase orders.
-- These store Google Drive or other file URLs for datasheets, quote docs, PO files.

ALTER TABLE "3.0_components"
  ADD COLUMN IF NOT EXISTS datasheet_url text;

ALTER TABLE "4.0_price_quotes"
  ADD COLUMN IF NOT EXISTS document_url text;

ALTER TABLE "5.0_purchases"
  ADD COLUMN IF NOT EXISTS document_url text;

-- New Deal: Freight Cost is captured on the quote (PI) itself, not only the PO,
-- so a Quote-only deal records the supplier's quoted freight. When the PO is
-- raised the value flows to 5.0_purchases.freight_charges_intl unchanged.
-- Idempotent. Applied live 2026-08-10.
ALTER TABLE "4.0_price_quotes" ADD COLUMN IF NOT EXISTS freight_charges_intl numeric;
COMMENT ON COLUMN "4.0_price_quotes".freight_charges_intl IS
  'Supplier-quoted international freight captured on the New Deal quote. Flows to 5.0_purchases.freight_charges_intl when the PO is raised.';

-- Customers are companies OR individuals (owner, 2026-08-14). One column, two
-- values; everything existing defaults to 'company' — deliberately no
-- name-based guessing (misclassifying a company is worse than flipping the
-- few individuals by hand in the UI). Idempotent.

ALTER TABLE "20.0_customers" ADD COLUMN IF NOT EXISTS customer_type text NOT NULL DEFAULT 'company';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_customer_type_check') THEN
    ALTER TABLE "20.0_customers" ADD CONSTRAINT customers_customer_type_check
      CHECK (customer_type IN ('company', 'individual'));
  END IF;
END $$;

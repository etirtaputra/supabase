-- Add supplier_id and company_id to 5.0_purchases
-- Needed so that standalone POs (no linked quote) can still reference
-- who the supplier is and which company the order is addressed to.
-- NOTE: supplier_id is uuid to match 2.0_suppliers.supplier_id

ALTER TABLE "5.0_purchases"
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES "2.0_suppliers"(supplier_id),
  ADD COLUMN IF NOT EXISTS company_id  integer REFERENCES "1.0_companies"(company_id);

CREATE INDEX IF NOT EXISTS purchases_supplier_id_idx ON "5.0_purchases" (supplier_id);
CREATE INDEX IF NOT EXISTS purchases_company_id_idx  ON "5.0_purchases" (company_id);

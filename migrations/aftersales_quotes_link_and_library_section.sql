-- After-sales quotes reuse the sales-quote pipeline: a quote carrying case_id
-- IS the repair/replacement quote for that case (editor, revisions, print,
-- SO → invoice → receipt all inherited). The description library gains a
-- section so after-sales texts have their own shelf in the same editor.
-- Applied to production 2026-08-04.
ALTER TABLE "22.0_sales_quotes"
  ADD COLUMN IF NOT EXISTS case_id uuid REFERENCES "27.0_aftersales_cases"(case_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sales_quotes_case
  ON "22.0_sales_quotes"(case_id) WHERE case_id IS NOT NULL;

ALTER TABLE "22.2_sales_description_library"
  ADD COLUMN IF NOT EXISTS section text NOT NULL DEFAULT 'sales'
  CHECK (section IN ('sales','aftersales'));

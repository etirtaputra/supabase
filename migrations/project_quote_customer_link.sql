-- ============================================================================
-- Link EPC Project Quotes (10.0) to CRM customers (20.0).
-- Project quotes carried only a free-text customer_name; adding customer_id
-- joins the EPC line into the same document graph as the sell side, so a
-- customer's profile can list their project quotes too.
-- Backfill matches existing quotes by name (case/space-insensitive) against
-- display_name or legal_name. Paste-ready, idempotent.
-- ============================================================================

ALTER TABLE "10.0_project_quotes"
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES "20.0_customers"(customer_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS project_quotes_customer_idx ON "10.0_project_quotes" (customer_id);

UPDATE "10.0_project_quotes" q
SET customer_id = c.customer_id
FROM "20.0_customers" c
WHERE q.customer_id IS NULL
  AND btrim(lower(q.customer_name)) <> ''
  AND (btrim(lower(c.display_name)) = btrim(lower(q.customer_name))
    OR btrim(lower(c.legal_name))  = btrim(lower(q.customer_name)));

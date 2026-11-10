-- Lifecycle values, enforced by the database (2026-11-10).
--
-- Three status columns accepted ANY text: a typo in a screen, a script or an
-- agent's write ("Sent", "won", "deliverd") would have been stored and then
-- silently dropped by every list that filters on the real values. The values
-- are declared in lib/lifecycles.ts; lib/lifecycles.test.ts fails the build if
-- a list below and the declaration disagree.
--
-- Values only — which MOVES are legal stays with the screens and the existing
-- triggers (guard_quote_unsend), as lib/lifecycles.ts states per lifecycle.
-- Every row already satisfied these lists when they were added (checked
-- 2026-11-10: proposals draft/sent/rejected, sales draft/validated/ordered/
-- delivered, delivery orders delivered).
-- No new table or view, so no GRANTs.

ALTER TABLE public."10.0_project_quotes" DROP CONSTRAINT IF EXISTS proposal_status_valid;
ALTER TABLE public."10.0_project_quotes" ADD CONSTRAINT proposal_status_valid
  CHECK (status IN ('draft', 'sent', 'accepted', 'rejected'));

ALTER TABLE public."22.0_sales_quotes" DROP CONSTRAINT IF EXISTS sales_document_status_valid;
ALTER TABLE public."22.0_sales_quotes" ADD CONSTRAINT sales_document_status_valid
  CHECK (status IN ('draft', 'validated', 'sent', 'accepted', 'ordered', 'invoiced', 'preparing', 'delivered', 'cancelled', 'rejected'));

ALTER TABLE public."24.0_delivery_orders" DROP CONSTRAINT IF EXISTS delivery_order_status_valid;
ALTER TABLE public."24.0_delivery_orders" ADD CONSTRAINT delivery_order_status_valid
  CHECK (status IN ('preparing', 'delivered', 'cancelled'));

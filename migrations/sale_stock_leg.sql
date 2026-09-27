-- ICAPROC — the stock leg of a mirrored (Dolibarr) sale
--
-- Owner, 2026-09-17: "mirror documents first then stock as a separate step".
-- Owner, 2026-09-27: go ahead with it. Code: app/api/agent/sales/stock/route.ts,
-- rules: lib/saleStock.ts.
--
-- ONE grant, widened by exactly one word.
--
-- Sell-side roles (owner, sales, sell_admin, engineer) may already insert a
-- stock-OUT whose source is a delivery order — that is how a DO marked
-- delivered takes its goods off. A mirrored Dolibarr order has no ICAPROC
-- delivery order; its goods leave under source_type 'sale', keyed to the order.
-- The same people, the same direction, one more source name.
--
-- What is deliberately NOT widened: an `in`. A sell-side role still cannot
-- book stock IN under any source, so "reverse a sale" cannot become a way to
-- raise a balance. Reversal stays with the roles that could book stock in
-- already (owner, buy_admin, data_entry, warehouse).
--
-- Idempotent.

DROP POLICY IF EXISTS "stock movements insert" ON public."30.0_stock_movements";
CREATE POLICY "stock movements insert" ON public."30.0_stock_movements"
  FOR INSERT TO authenticated
  WITH CHECK (
    (EXISTS (SELECT 1 FROM user_profiles p
       WHERE p.id = auth.uid() AND p.role = ANY (ARRAY['owner', 'buy_admin', 'data_entry', 'warehouse'])))
    OR (
      direction = 'out'
      AND source_type IN ('delivery', 'sale')
      AND EXISTS (SELECT 1 FROM user_profiles p
        WHERE p.id = auth.uid() AND p.role = ANY (ARRAY['owner', 'sales', 'sell_admin', 'engineer']))
    )
  );

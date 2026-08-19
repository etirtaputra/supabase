-- ICAPROC — supplier payments are buy-side
-- ---------------------------------------------------------------------------
-- What the company PAYS its suppliers is a price list read backwards: give
-- someone the payments against a PO and they can work out the buy price of
-- everything on it. `6.0_po_costs` was readable by ANY signed-in user, so a
-- sell-side login could open Finance and read every payment to every supplier
-- — amount, date and the account it left.
--
-- The screens now ask for these rows only when the role may see them (Finance
-- runs a money-in-only statement for sell-side, and the dashboard's cash tile
-- is buy-side). This makes the database agree, so a direct link cannot do what
-- the screen will not.
--
-- Buy-side roles: owner, buy_admin, data_entry, finance. Sell-side roles keep
-- Finance for the customer receipts they record.
--
-- Idempotent: safe to paste again. Ends with a PostgREST schema reload.

DROP POLICY IF EXISTS "authenticated read" ON "6.0_po_costs";
DROP POLICY IF EXISTS "po costs read (buy side)" ON "6.0_po_costs";
CREATE POLICY "po costs read (buy side)" ON "6.0_po_costs" FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM user_profiles p WHERE p.id = auth.uid()
          AND p.role = ANY (ARRAY['owner','buy_admin','data_entry','finance'])));

NOTIFY pgrst, 'reload schema';

-- Buy-side writes gated in the DATABASE, not only in React.
--
-- Ten tables carried `ALL TO authenticated USING (true) WITH CHECK (true)`, so
-- role gating for the whole buy side lived in the app alone: `po@icasolar.com`'s
-- buy_admin was a label, not a constraint, and any authenticated caller —
-- including an agent with a Project Engineer login — could rewrite supplier
-- prices, purchase orders and the catalogue through the API.
--
-- The gates mirror `constants/roles.ts` exactly, so the database now enforces
-- what ROLE_PERMISSIONS already claims. SELECT policies are deliberately left
-- as they are: this change removes no read that works today, so it cannot
-- break a screen. Gating READS on the cost-bearing tables is a separate pass —
-- the analytics views read 4.x/5.x/6.0 and need checking one at a time.

-- ── Who may write what ──────────────────────────────────────────────────────
-- Mirrors ROLE_PERMISSIONS.buySide && canEdit. Same membership as the existing
-- can_write_po_costs(), kept as its own function so the two can diverge.
CREATE OR REPLACE FUNCTION public.can_write_buy_side() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND role IN ('owner','buy_admin','data_entry','finance')
  );
$$;

-- The catalogue is SHARED, not buy-side: Tech Specs, Products, tier pricing and
-- margin profiles all write it from the sell side. So the gate is
-- ROLE_PERMISSIONS.canEdit — every role the app lets save anything. This is
-- what stops `sales`, `engineer` (MANDA) and `viewer` writing items.
CREATE OR REPLACE FUNCTION public.can_edit_catalog() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid()
      AND role IN ('owner','buy_admin','sell_admin','warehouse','aftersales','data_entry','finance')
  );
$$;

-- Mirrors ROLE_PERMISSIONS.canManageStock. A warehouse user marking a PO
-- received (`app/stock/receive`) updates `5.0_purchases`, so that one table
-- accepts stock roles as well as buy-side ones.
CREATE OR REPLACE FUNCTION public.can_manage_stock() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND role IN ('owner','buy_admin','warehouse','data_entry')
  );
$$;

-- ── Replace the open ALL policies ───────────────────────────────────────────
DROP POLICY IF EXISTS "authenticated write" ON "1.0_companies";
CREATE POLICY "buy side write" ON "1.0_companies" FOR ALL TO authenticated
  USING (can_write_buy_side()) WITH CHECK (can_write_buy_side());

DROP POLICY IF EXISTS "authenticated write" ON "2.0_suppliers";
CREATE POLICY "buy side write" ON "2.0_suppliers" FOR ALL TO authenticated
  USING (can_write_buy_side()) WITH CHECK (can_write_buy_side());

DROP POLICY IF EXISTS "authenticated write" ON "4.0_price_quotes";
CREATE POLICY "buy side write" ON "4.0_price_quotes" FOR ALL TO authenticated
  USING (can_write_buy_side()) WITH CHECK (can_write_buy_side());

DROP POLICY IF EXISTS "authenticated write" ON "4.1_price_quote_line_items";
CREATE POLICY "buy side write" ON "4.1_price_quote_line_items" FOR ALL TO authenticated
  USING (can_write_buy_side()) WITH CHECK (can_write_buy_side());

DROP POLICY IF EXISTS "authenticated write" ON "5.1_purchase_line_items";
CREATE POLICY "buy side write" ON "5.1_purchase_line_items" FOR ALL TO authenticated
  USING (can_write_buy_side()) WITH CHECK (can_write_buy_side());

DROP POLICY IF EXISTS "authenticated write" ON "7.0_competitor_prices";
CREATE POLICY "buy side write" ON "7.0_competitor_prices" FOR ALL TO authenticated
  USING (can_write_buy_side()) WITH CHECK (can_write_buy_side());

DROP POLICY IF EXISTS "authenticated write" ON "8.0_component_links";
CREATE POLICY "buy side write" ON "8.0_component_links" FOR ALL TO authenticated
  USING (can_write_buy_side()) WITH CHECK (can_write_buy_side());

DROP POLICY IF EXISTS "authenticated write" ON "9.0_exchange_rate_history";
CREATE POLICY "buy side write" ON "9.0_exchange_rate_history" FOR ALL TO authenticated
  USING (can_write_buy_side()) WITH CHECK (can_write_buy_side());

-- Goods receipt marks the PO received, so stock roles write here too.
DROP POLICY IF EXISTS "authenticated write" ON "5.0_purchases";
CREATE POLICY "buy side or stock write" ON "5.0_purchases" FOR ALL TO authenticated
  USING (can_write_buy_side() OR can_manage_stock())
  WITH CHECK (can_write_buy_side() OR can_manage_stock());

-- The catalogue: every role the app lets edit.
DROP POLICY IF EXISTS "authenticated write" ON "3.0_components";
CREATE POLICY "catalog write" ON "3.0_components" FOR ALL TO authenticated
  USING (can_edit_catalog()) WITH CHECK (can_edit_catalog());

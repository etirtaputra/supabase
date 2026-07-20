-- ============================================================================
-- Role taxonomy v2: owner / buy_admin / sell_admin / sales / engineer / viewer
-- Migrates legacy buy-side roles and updates role-gated write policies to the
-- new role sets. Idempotent (DROP POLICY IF EXISTS). Buy-side tables (1–10.x)
-- are not role-gated, so buy_admin (authenticated) keeps full buy-side access.
-- ============================================================================

-- Widen the role CHECK constraint to the new taxonomy (+ legacy for safety)
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role = ANY (ARRAY['owner','buy_admin','sell_admin','sales','engineer','viewer','data_entry','finance']::text[]));

-- Migrate legacy buy-side roles → buy_admin
UPDATE user_profiles SET role = 'buy_admin' WHERE role IN ('data_entry', 'finance');

-- Sell-side documents: owner + sales + sell_admin + engineer
DROP POLICY IF EXISTS "customers write" ON "20.0_customers";
CREATE POLICY "customers write" ON "20.0_customers" FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales','sell_admin','engineer')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales','sell_admin','engineer')));

DROP POLICY IF EXISTS "customer contacts write" ON "20.1_customer_contacts";
CREATE POLICY "customer contacts write" ON "20.1_customer_contacts" FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales','sell_admin','engineer')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales','sell_admin','engineer')));

DROP POLICY IF EXISTS "sales quotes write" ON "22.0_sales_quotes";
CREATE POLICY "sales quotes write" ON "22.0_sales_quotes" FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales','sell_admin','engineer')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales','sell_admin','engineer')));

DROP POLICY IF EXISTS "sales quote items write" ON "22.1_sales_quote_items";
CREATE POLICY "sales quote items write" ON "22.1_sales_quote_items" FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales','sell_admin','engineer')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales','sell_admin','engineer')));

-- Pricing tiers: owner + sell_admin
DROP POLICY IF EXISTS "price tiers write" ON "21.0_price_tiers";
CREATE POLICY "price tiers write" ON "21.0_price_tiers" FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sell_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sell_admin')));

DROP POLICY IF EXISTS "item tier prices write" ON "21.1_item_tier_prices";
CREATE POLICY "item tier prices write" ON "21.1_item_tier_prices" FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sell_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sell_admin')));

-- Customer receipts (AR): owner + sell_admin
DROP POLICY IF EXISTS "customer receipts write" ON "26.0_customer_receipts";
CREATE POLICY "customer receipts write" ON "26.0_customer_receipts" FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sell_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sell_admin')));

-- Project quotes: can_edit_quote() gated data_entry/finance (now migrated away),
-- leaving only owners able to edit. Add engineer (keep legacy for safety).
CREATE OR REPLACE FUNCTION public.can_edit_quote(qid uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner')
      OR (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('engineer','data_entry','finance'))
        AND NOT EXISTS (SELECT 1 FROM "10.0_project_quotes" q WHERE q.quote_id = qid AND q.status = 'sent')
      );
$function$;

-- Stock ledger: receive/adjust = owner + buy_admin (+ legacy data_entry);
-- delivery-out = owner + sales + sell_admin + engineer (completing their orders)
DROP POLICY IF EXISTS "stock movements insert" ON "30.0_stock_movements";
CREATE POLICY "stock movements insert" ON "30.0_stock_movements" FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','buy_admin','data_entry'))
    OR (
      direction = 'out' AND source_type = 'delivery'
      AND EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','sales','sell_admin','engineer'))
    )
  );

-- ICAPROC — two roles for two jobs that already existed
-- ---------------------------------------------------------------------------
-- Before this, a warehouse person had to be given `data_entry` — which also
-- opens the Purchasing catalog, quoting and Deal Lookup, i.e. every supplier
-- price. An after-sales person had to be given `sell_admin` — which also
-- grants pricing, invoicing and the bank. Both were the whole side of the
-- business to do one job inside it.
--
--   warehouse   goods in, counted, and out: Stock, Receive Goods, Serial
--               Numbers, Delivery. No supplier prices, no selling prices, no
--               money. It is NOT added to 6.0_po_costs.
--   aftersales  the service desk: tickets, the unit register, warranty, and
--               the customer behind the machine. No pricing, no invoicing,
--               no bank.
--
-- Nobody loses anything: every role that could open After Sales still can, and
-- the buy-side roles keep Stock and Receive Goods.
--
-- Idempotent: safe to paste again. Ends with a PostgREST schema reload.

ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check CHECK (role = ANY (ARRAY[
  'owner','buy_admin','sell_admin','sales','engineer','warehouse','aftersales','viewer','data_entry','finance']));

-- ── Warehouse: goods in, counted, and out ───────────────────────────────────
DROP POLICY IF EXISTS "stock movements insert" ON "30.0_stock_movements";
CREATE POLICY "stock movements insert" ON "30.0_stock_movements" FOR INSERT TO authenticated WITH CHECK (
  (EXISTS (SELECT 1 FROM user_profiles p WHERE p.id = auth.uid()
           AND p.role = ANY (ARRAY['owner','buy_admin','data_entry','warehouse'])))
  OR (direction = 'out' AND source_type = 'delivery' AND EXISTS (
        SELECT 1 FROM user_profiles p WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner','sales','sell_admin','engineer']))));

DROP POLICY IF EXISTS "goods receipts insert" ON "30.2_goods_receipts";
CREATE POLICY "goods receipts insert" ON "30.2_goods_receipts" FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM user_profiles p WHERE p.id = auth.uid()
          AND p.role = ANY (ARRAY['owner','buy_admin','data_entry','warehouse'])));

DROP POLICY IF EXISTS "delivery orders write" ON "24.0_delivery_orders";
CREATE POLICY "delivery orders write" ON "24.0_delivery_orders" FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM user_profiles p WHERE p.id = auth.uid()
          AND p.role = ANY (ARRAY['owner','sales','sell_admin','engineer','warehouse'])));
DROP POLICY IF EXISTS "delivery order items write" ON "24.1_delivery_order_items";
CREATE POLICY "delivery order items write" ON "24.1_delivery_order_items" FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM user_profiles p WHERE p.id = auth.uid()
          AND p.role = ANY (ARRAY['owner','sales','sell_admin','engineer','warehouse'])));

-- ── After-sales desk ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "aftersales write" ON "27.0_aftersales_cases";
CREATE POLICY "aftersales write" ON "27.0_aftersales_cases" FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM user_profiles p WHERE p.id = auth.uid()
          AND p.role = ANY (ARRAY['owner','sales','sell_admin','engineer','aftersales'])));
DROP POLICY IF EXISTS "aftersales write" ON "27.1_aftersales_parts";
CREATE POLICY "aftersales write" ON "27.1_aftersales_parts" FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM user_profiles p WHERE p.id = auth.uid()
          AND p.role = ANY (ARRAY['owner','sales','sell_admin','engineer','aftersales'])));
DROP POLICY IF EXISTS "aftersales write" ON "27.2_aftersales_updates";
CREATE POLICY "aftersales write" ON "27.2_aftersales_updates" FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM user_profiles p WHERE p.id = auth.uid()
          AND p.role = ANY (ARRAY['owner','sales','sell_admin','engineer','aftersales'])));

DROP POLICY IF EXISTS "customers write" ON "20.0_customers";
CREATE POLICY "customers write" ON "20.0_customers" FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM user_profiles p WHERE p.id = auth.uid()
          AND p.role = ANY (ARRAY['owner','sales','sell_admin','engineer','aftersales'])));
DROP POLICY IF EXISTS "customer contacts write" ON "20.1_customer_contacts";
CREATE POLICY "customer contacts write" ON "20.1_customer_contacts" FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM user_profiles p WHERE p.id = auth.uid()
          AND p.role = ANY (ARRAY['owner','sales','sell_admin','engineer','aftersales'])));

-- ── The unit register: both new roles live in it ────────────────────────────
DROP POLICY IF EXISTS "serials write" ON "30.4_serial_numbers";
CREATE POLICY "serials write" ON "30.4_serial_numbers" FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM user_profiles p WHERE p.id = auth.uid()
          AND p.role = ANY (ARRAY['owner','buy_admin','data_entry','sell_admin','sales','warehouse','aftersales'])));
DROP POLICY IF EXISTS "serials update" ON "30.4_serial_numbers";
CREATE POLICY "serials update" ON "30.4_serial_numbers" FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM user_profiles p WHERE p.id = auth.uid()
          AND p.role = ANY (ARRAY['owner','buy_admin','data_entry','sell_admin','sales','warehouse','aftersales'])));
DROP POLICY IF EXISTS "serials delete" ON "30.4_serial_numbers";
CREATE POLICY "serials delete" ON "30.4_serial_numbers" FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM user_profiles p WHERE p.id = auth.uid()
          AND p.role = ANY (ARRAY['owner','buy_admin','data_entry','sell_admin','warehouse'])));

NOTIFY pgrst, 'reload schema';

-- Rename the currency code RMB → CNY everywhere it is stored (owner, 2026-08-07).
--
-- The `currency` enum (USD/CNY/IDR) backs six columns — 4.0_price_quotes,
-- 4.1_price_quote_line_items, 5.0_purchases, 5.1_purchase_line_items,
-- 6.0_po_costs, payment_batches. Renaming the enum VALUE updates all of them
-- atomically (rows store the value by id, so there is no row rewrite and no
-- check-constraint to touch). The remaining currency columns are plain text —
-- 20.0_customers.default_currency, 22.0_sales_quotes.currency,
-- 41.0_bank_accounts.currency, 7.0_competitor_prices.currency,
-- 9.0_exchange_rate_history.currency — and are migrated by UPDATE. quote_history
-- is a VIEW over the quote tables, so it follows automatically.
--
-- Idempotent: the enum rename is guarded by an existence check, and every UPDATE
-- only touches rows still carrying 'RMB'.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'currency' AND e.enumlabel = 'RMB'
  ) THEN
    ALTER TYPE currency RENAME VALUE 'RMB' TO 'CNY';
  END IF;
END $$;

update "20.0_customers"            set default_currency = 'CNY' where default_currency = 'RMB';
update "22.0_sales_quotes"         set currency = 'CNY' where currency = 'RMB';
update "41.0_bank_accounts"        set currency = 'CNY' where currency = 'RMB';
update "7.0_competitor_prices"     set currency = 'CNY' where currency = 'RMB';
update "9.0_exchange_rate_history" set currency = 'CNY' where currency = 'RMB';

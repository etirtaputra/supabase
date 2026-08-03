-- Payment & delivery terms on the sales quote header. Chosen from the
-- settings-driven preset lists (Settings › Terms); free text survives too.
-- The invoice and order confirmation print the payment terms from the same
-- row — the child documents are views of the 22.0 order, so the terms follow
-- automatically. Idempotent.

ALTER TABLE "22.0_sales_quotes"
  ADD COLUMN IF NOT EXISTS payment_terms  text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS delivery_terms text NOT NULL DEFAULT '';

COMMENT ON COLUMN "22.0_sales_quotes".payment_terms IS
  'Ketentuan pembayaran printed on quotation/order/invoice (preset list in Settings, free text allowed).';
COMMENT ON COLUMN "22.0_sales_quotes".delivery_terms IS
  'Ketentuan pengiriman (Di antar / Di ambil sendiri / …) printed on quotation/order.';

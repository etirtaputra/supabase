-- Create exchange rate history table to track realized FX rates from quotes vs payments
CREATE TABLE "9.0_exchange_rate_history" (
  rate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID REFERENCES "5.0_purchases"(po_id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES "2.0_suppliers"(supplier_id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  quoted_amount_foreign DECIMAL NOT NULL,
  paid_amount_idr DECIMAL NOT NULL,
  implied_rate DECIMAL NOT NULL,
  payment_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Index for common queries: latest rate by supplier + currency
CREATE INDEX idx_xr_history_supplier_currency_date
  ON "9.0_exchange_rate_history"(supplier_id, currency, payment_date DESC);

-- Index for PO lookups
CREATE INDEX idx_xr_history_po_id
  ON "9.0_exchange_rate_history"(po_id);

-- View: latest rates by supplier and currency
CREATE OR REPLACE VIEW v_latest_exchange_rates AS
SELECT DISTINCT ON (supplier_id, currency)
  supplier_id,
  currency,
  implied_rate,
  payment_date,
  rate_id
FROM "9.0_exchange_rate_history"
ORDER BY supplier_id, currency, payment_date DESC;

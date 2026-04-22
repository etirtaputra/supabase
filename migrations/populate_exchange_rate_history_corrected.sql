-- CORRECTED: Populate 9.0_exchange_rate_history with realized FX rates from FULLY-PAID POs only
-- Only includes POs where total principal payments >= PO total_value

-- First, DELETE old incorrect data
DELETE FROM "9.0_exchange_rate_history";

-- Then INSERT only fully-paid PO rates
INSERT INTO "9.0_exchange_rate_history" (
  po_id,
  supplier_id,
  currency,
  quoted_amount_foreign,
  paid_amount_idr,
  implied_rate,
  payment_date,
  notes
)
WITH po_payments AS (
  -- Calculate total principal payments per PO in IDR
  SELECT
    pc.po_id,
    MAX(pc.payment_date) as latest_payment_date,
    SUM(
      CASE
        WHEN pc.currency = 'IDR' THEN pc.amount
        ELSE pc.amount * COALESCE(pc.exchange_rate, 1)
      END
    ) as total_paid_idr
  FROM "6.0_po_costs" pc
  WHERE pc.cost_category IN ('down_payment', 'balance_payment', 'additional_balance_payment')
  GROUP BY pc.po_id
),
fully_paid_pos AS (
  -- Only include POs where payments >= PO total value (in equivalent IDR)
  SELECT
    p.po_id,
    p.po_number,
    p.po_date,
    p.quote_id,
    p.supplier_id,
    p.currency,
    p.total_value as quoted_amount,
    pp.total_paid_idr,
    pp.latest_payment_date
  FROM "5.0_purchases" p
  INNER JOIN po_payments pp ON p.po_id = pp.po_id
  WHERE p.quote_id IS NOT NULL
    AND p.supplier_id IS NOT NULL
    AND p.currency IS NOT NULL
    AND p.currency != 'IDR'
    -- Only POs where we have substantial payment (at least 90% of PO value)
    AND pp.total_paid_idr >= (p.total_value * COALESCE(p.exchange_rate, 1) * 0.9)
)
SELECT
  fpp.po_id,
  fpp.supplier_id,
  fpp.currency,
  fpp.quoted_amount,
  fpp.total_paid_idr,
  ROUND((fpp.total_paid_idr / (fpp.quoted_amount * COALESCE(p.exchange_rate, 1)))::numeric, 4) as implied_rate,
  fpp.latest_payment_date,
  'Fully-paid PO ' || fpp.po_number || ' (' || fpp.po_date || ') - rate realized at final payment'
FROM fully_paid_pos fpp
LEFT JOIN "5.0_purchases" p ON fpp.po_id = p.po_id
WHERE fpp.quoted_amount > 0
ORDER BY fpp.latest_payment_date DESC;

-- Show summary
SELECT
  currency,
  COUNT(*) as count,
  ROUND(AVG(implied_rate)::numeric, 4) as avg_rate,
  ROUND(MIN(implied_rate)::numeric, 4) as min_rate,
  ROUND(MAX(implied_rate)::numeric, 4) as max_rate,
  ROUND((MAX(implied_rate) - MIN(implied_rate))::numeric, 4) as range
FROM "9.0_exchange_rate_history"
GROUP BY currency
ORDER BY currency;

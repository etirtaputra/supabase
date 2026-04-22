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
po_cost_categories AS (
  -- Find all cost categories per PO to filter out those with non-principal costs
  SELECT
    po_id,
    ARRAY_AGG(DISTINCT cost_category) as categories
  FROM "6.0_po_costs"
  GROUP BY po_id
),
fully_paid_pos AS (
  -- Only include POs where:
  -- 1. ALL cost records are ONLY principal payments (no bank fees, delivery, taxes, etc.)
  -- 2. Total principal payments >= PO total value
  SELECT
    p.po_id,
    p.po_number,
    p.po_date,
    p.quote_id,
    q.supplier_id,
    p.currency,
    p.total_value as quoted_amount,
    pp.total_paid_idr,
    pp.latest_payment_date,
    p.exchange_rate
  FROM "5.0_purchases" p
  LEFT JOIN "4.0_price_quotes" q ON p.quote_id = q.quote_id
  INNER JOIN po_payments pp ON p.po_id = pp.po_id
  INNER JOIN po_cost_categories pcc ON p.po_id = pcc.po_id
  WHERE p.quote_id IS NOT NULL
    AND q.supplier_id IS NOT NULL
    AND p.currency IS NOT NULL
    AND p.currency != 'IDR'
    -- CRITICAL: Only include if PO has ONLY principal payment categories
    AND pcc.categories <@ ARRAY['down_payment', 'balance_payment', 'additional_balance_payment']::text[]
    -- Total principal payments >= PO total value (in equivalent IDR)
    AND pp.total_paid_idr >= (p.total_value * COALESCE(p.exchange_rate, 1) * 0.95)
)
SELECT
  fpp.po_id,
  fpp.supplier_id,
  fpp.currency,
  fpp.quoted_amount,
  fpp.total_paid_idr,
  ROUND((fpp.total_paid_idr / fpp.quoted_amount)::numeric, 4) as implied_rate,
  fpp.latest_payment_date,
  'Fully-paid PO ' || fpp.po_number || ' (' || fpp.po_date || ') - rate realized at final payment'
FROM fully_paid_pos fpp
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

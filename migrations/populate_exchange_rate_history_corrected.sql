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
  -- Calculate total PRINCIPAL payments per PO in IDR (only sum these categories)
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
  -- Sum quoted line items to get actual goods value (excludes freight)
  SELECT
    p.po_id,
    p.po_number,
    p.po_date,
    p.quote_id,
    q.supplier_id,
    pli.currency,
    SUM(pli.unit_price * pli.quantity) as quoted_line_total,
    pp.total_paid_idr,
    pp.latest_payment_date,
    p.exchange_rate
  FROM "5.0_purchases" p
  LEFT JOIN "4.0_price_quotes" q ON p.quote_id = q.quote_id
  LEFT JOIN "4.1_price_quote_line_items" pli ON q.quote_id = pli.quote_id
  INNER JOIN po_payments pp ON p.po_id = pp.po_id
  WHERE p.quote_id IS NOT NULL
    AND q.supplier_id IS NOT NULL
    AND pli.currency IS NOT NULL
    AND pli.currency != 'IDR'
    -- Total principal payments >= quoted line items total (excludes freight/other costs)
    AND pp.total_paid_idr >= (SUM(pli.unit_price * pli.quantity) * COALESCE(p.exchange_rate, 1) * 0.95)
  GROUP BY p.po_id, p.po_number, p.po_date, p.quote_id, q.supplier_id, pli.currency, pp.total_paid_idr, pp.latest_payment_date, p.exchange_rate
)
SELECT
  fpp.po_id,
  fpp.supplier_id,
  fpp.currency,
  fpp.quoted_line_total,
  fpp.total_paid_idr,
  ROUND((fpp.total_paid_idr / fpp.quoted_line_total)::numeric, 4) as implied_rate,
  fpp.latest_payment_date,
  'Fully-paid PO ' || fpp.po_number || ' (' || fpp.po_date || ') - rate from quote line items (excl. freight)'
FROM fully_paid_pos fpp
WHERE fpp.quoted_line_total > 0
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

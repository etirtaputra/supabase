-- FIXED: Populate 9.0_exchange_rate_history using PO's recorded exchange_rate
--
-- Previous approach (inferring rate from payments) failed because:
-- 1. IDR-denominated costs (customs, freight) tagged as down_payment/balance_payment
--    inflate total_paid_idr while the USD denominator stays fixed → rate too high
-- 2. Payments cover full PO value (incl. freight) but quoted_line_total excludes
--    freight → denominator too small → rate too high (e.g. 20139 instead of 16578)
--
-- Fix: use p.exchange_rate (the agreed rate at time of purchase) directly.
-- The po_payments CTE is kept only as a "is this PO substantially paid?" gate.

DELETE FROM "9.0_exchange_rate_history";

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
eligible_pos AS (
  SELECT
    p.po_id,
    p.po_number,
    p.po_date,
    q.supplier_id,
    p.currency,
    p.total_value,
    p.exchange_rate,
    pp.latest_payment_date,
    pp.total_paid_idr
  FROM "5.0_purchases" p
  LEFT JOIN "4.0_price_quotes" q ON p.quote_id = q.quote_id
  INNER JOIN po_payments pp ON p.po_id = pp.po_id
  WHERE p.currency IS NOT NULL
    AND p.currency != 'IDR'
    AND p.exchange_rate IS NOT NULL
    AND p.exchange_rate > 0
    AND p.total_value IS NOT NULL
    AND p.total_value > 0
    AND q.supplier_id IS NOT NULL
    -- PO is substantially paid (≥90% of expected IDR equivalent)
    AND pp.total_paid_idr >= (p.total_value * p.exchange_rate * 0.9)
)
SELECT
  ep.po_id,
  ep.supplier_id,
  ep.currency,
  ep.total_value                              AS quoted_amount_foreign,
  ROUND((ep.total_value * ep.exchange_rate)::numeric, 2) AS paid_amount_idr,
  ep.exchange_rate                            AS implied_rate,
  ep.latest_payment_date,
  'Fully-paid PO ' || ep.po_number || ' (' || ep.po_date || ') - rate from PO exchange_rate field'
FROM eligible_pos ep
ORDER BY ep.latest_payment_date DESC;

-- Verification summary
SELECT
  currency,
  COUNT(*)                                    AS count,
  ROUND(AVG(implied_rate)::numeric, 4)        AS avg_rate,
  ROUND(MIN(implied_rate)::numeric, 4)        AS min_rate,
  ROUND(MAX(implied_rate)::numeric, 4)        AS max_rate,
  ROUND((MAX(implied_rate) - MIN(implied_rate))::numeric, 4) AS range
FROM "9.0_exchange_rate_history"
GROUP BY currency
ORDER BY currency;

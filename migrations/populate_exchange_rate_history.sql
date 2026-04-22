-- Populate 9.0_exchange_rate_history with realized FX rates from existing POs
-- This extracts: quoted_amount (foreign) vs paid_amount_idr to calculate implied_rate

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
WITH po_quote_data AS (
  -- Get POs with their quotes and line items
  SELECT
    p.po_id,
    p.po_number,
    p.po_date,
    q.supplier_id,
    q.quote_id,
    pli.currency,
    -- Sum quoted amounts by currency
    SUM(pli.unit_price * pli.quantity) as total_quoted
  FROM "5.0_purchases" p
  LEFT JOIN "4.0_price_quotes" q ON p.quote_id = q.quote_id
  LEFT JOIN "4.1_price_quote_line_items" pli ON q.quote_id = pli.quote_id
  WHERE p.quote_id IS NOT NULL
    AND q.supplier_id IS NOT NULL
    AND pli.currency IS NOT NULL
    AND pli.currency != 'IDR'
  GROUP BY p.po_id, p.po_number, p.po_date, q.supplier_id, q.quote_id, pli.currency
),
po_payment_data AS (
  -- Get principal payments by PO (sum in IDR)
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
  HAVING SUM(
    CASE
      WHEN pc.currency = 'IDR' THEN pc.amount
      ELSE pc.amount * COALESCE(pc.exchange_rate, 1)
    END
  ) > 0
)
SELECT
  pqd.po_id,
  pqd.supplier_id,
  pqd.currency,
  pqd.total_quoted,
  ppd.total_paid_idr,
  ppd.total_paid_idr / pqd.total_quoted as implied_rate,
  ppd.latest_payment_date,
  'Extracted from PO ' || pqd.po_number || ' (' || pqd.po_date || ')' as notes
FROM po_quote_data pqd
INNER JOIN po_payment_data ppd ON pqd.po_id = ppd.po_id
ORDER BY ppd.latest_payment_date DESC;

-- Show summary of inserted rates
SELECT
  currency,
  COUNT(*) as count,
  ROUND(AVG(implied_rate)::numeric, 4) as avg_rate,
  ROUND(MIN(implied_rate)::numeric, 4) as min_rate,
  ROUND(MAX(implied_rate)::numeric, 4) as max_rate
FROM "9.0_exchange_rate_history"
GROUP BY currency
ORDER BY currency;

-- Investigate which POs are producing outlier exchange rates
SELECT
  xrh.po_id,
  p.po_number,
  p.po_date,
  p.quote_id,
  p.currency,
  p.total_value,
  xrh.implied_rate,
  xrh.quoted_amount_foreign,
  xrh.paid_amount_idr,
  COUNT(pli.quote_line_id) as line_item_count,
  SUM(pli.unit_price * pli.quantity) as quoted_line_total,
  STRING_AGG(pli.supplier_description || ' (Qty: ' || pli.quantity || ', Unit: ' || pli.unit_price || ')', ' | ') as line_items
FROM "9.0_exchange_rate_history" xrh
LEFT JOIN "5.0_purchases" p ON xrh.po_id = p.po_id
LEFT JOIN "4.0_price_quotes" q ON p.quote_id = q.quote_id
LEFT JOIN "4.1_price_quote_line_items" pli ON q.quote_id = pli.quote_id
WHERE xrh.currency = 'USD'
  AND (xrh.implied_rate > 20000 OR xrh.implied_rate < 16000)
GROUP BY xrh.po_id, p.po_number, p.po_date, p.quote_id, p.currency, p.total_value, xrh.implied_rate, xrh.quoted_amount_foreign, xrh.paid_amount_idr
ORDER BY xrh.implied_rate DESC;

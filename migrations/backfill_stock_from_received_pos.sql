-- One-time backfill: seed the stock ledger from POs already marked
-- 'Fully Received'. Inserts an 'in' movement per PO line (trigger updates
-- 30.1 balances → Physical & Live). Unit cost approximates landed cost as
-- line unit_cost × PO exchange rate (principal only, no fees) — the moving
-- average refines as real receipts land. Idempotent: skips lines whose PO
-- receipt movement already exists. Safe to re-run.
INSERT INTO "30.0_stock_movements"
  (component_id, location, direction, quantity, unit_cost_idr, source_type, source_id, moved_at, notes)
SELECT
  li.component_id,
  'MAIN',
  'in',
  li.quantity,
  ROUND(li.unit_cost * CASE WHEN li.currency = 'IDR' THEN 1 ELSE COALESCE(p.exchange_rate, 1) END),
  'receipt',
  p.po_id::text,
  COALESCE(p.actual_received_date::timestamptz, NOW()),
  'Backfill from Fully Received PO ' || COALESCE(p.po_number, p.po_id::text)
FROM "5.1_purchase_line_items" li
JOIN "5.0_purchases" p ON p.po_id = li.po_id
WHERE p.status = 'Fully Received'
  AND li.component_id IS NOT NULL
  AND li.quantity > 0
  AND NOT EXISTS (
    SELECT 1 FROM "30.0_stock_movements" m
    WHERE m.source_type = 'receipt'
      AND m.source_id = p.po_id::text
      AND m.component_id = li.component_id
  );

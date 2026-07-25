-- ============================================================================
-- ICAPROC — Remove a double-entered supplier payment on PIO-2026005
--
-- The 2026-02-09 remittance "DP30 PJ-260114-09 V4" was recorded TWICE:
--   1. Correctly as payment batch 6b5bc8e2-6fb2-4bb5-927f-2c4d11ab45c9
--      (batch total 69,131,043 split across 2 POs — PIO-2026005's share was
--      25,010,530 principal + 18,089 of the 50,000 admin fee), and
--   2. Again as two MANUAL rows on PIO-2026005 carrying the FULL remittance:
--        down_payment    69,131,043   (= the entire batch total)
--        admin_bank_fee      50,000   (= the entire batch admin fee)
--
-- The manual rows are the duplicates: their amounts equal the batch totals
-- exactly, on the same date and bank reference. Left in place they overstate
-- principal paid on this PO by 69,131,043 — an implied FX of 23,136 IDR/USD
-- against a PO rate of 16,871. After removal principal is 224,401,355, an
-- implied 17,687 IDR/USD, in line with the 17,309–17,618 actually paid to
-- other suppliers that month.
--
-- Deleted rows are reproduced below so this is fully reversible.
--   cost_id 823884ea-597d-4b43-ad8c-19530c29e547 | down_payment   | 69,131,043
--     | IDR | 2026-02-09 | notes "2. DP_ PJ-260114-09 V04_2026-02-06"
--   cost_id ea736afa-d4f0-4e79-9a4a-024f5a4594a1 | admin_bank_fee |     50,000
--     | IDR | 2026-02-09 | notes "2. DP_ PJ-260114-09 V04_2026-02-06"
--
-- Idempotent: deletes by primary key, so re-running is a no-op.
-- ============================================================================

DELETE FROM "6.0_po_costs"
WHERE cost_id IN (
  '823884ea-597d-4b43-ad8c-19530c29e547',   -- duplicate down_payment 69,131,043
  'ea736afa-d4f0-4e79-9a4a-024f5a4594a1'    -- duplicate admin_bank_fee 50,000
);

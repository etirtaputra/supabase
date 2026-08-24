-- ── Three PO totals that counted their own line items twice ─────────────────
--
-- Owner, 2026-08-24, looking at PO-149-MBS-08-2026 in Deal Lookup: "there's
-- something wrong with the total calculation here." The card read
--
--     committed IDR 1.619.460 · 50.0% paid · IDR 809.730 outstanding
--
-- above a single line item worth IDR 809.730 that the bank had already paid in
-- full (IDR 809.729,73, "Balance Payment", 21 Aug 2026). The deal was settled;
-- the screen said half of it was still owed.
--
-- `5.0_purchases.total_value` is the COMMITTED obligation — the grand total off
-- the supplier's document — and it is deliberately allowed to exceed the line
-- items, because freight is billed on top of them. That licence is what let
-- this hide: outstanding balance, the paid percentage, the deal's progress bar
-- and the Dashboard's "We owe" are all computed from this column and never
-- from the lines, so a wrong total is silently authoritative.
--
-- A sweep of all 222 POs carrying line items found:
--     207  total = lines (+ freight)          — sound
--       3  total = EXACTLY 2 × its own lines  — this file
--       1  otherwise over
--      11  short by exactly their freight     — LEFT ALONE, see below
--
-- The three, with what the row says now and what its own lines say:
--
--     EB.42277             1.357.440  →    678.720   (8 line items)
--     EB.42324               268.800  →    134.400   (3 line items)
--     PO-149-MBS-08-2026   1.619.460  →    809.730   (1 line item)
--
-- Corroboration for PO-149 beyond the arithmetic: its quote (b1249245) totals
-- 809.730, its quote line items total 809.730, and the only principal payment
-- against it is 809.729,73 — the lines, to the rupiah. Correcting the total
-- makes the deal read 100% paid, which is what actually happened. The two EB
-- POs carry no payments yet, so nothing downstream moves for them beyond the
-- committed figure itself.
--
-- How they came to be doubled could not be established from the code: the
-- quote→PO path copies the quote's total (correct here), the revise path
-- recomputes from the edited lines, and the PDF importer writes quotes only.
-- `5.0_purchases` keeps no audit trail, so this heals the rows and
-- `lib/poTotals.ts` + `DealLookupTab` now make any recurrence visible in amber
-- on the deal card rather than leaving it to be found by eye.
--
-- NOT in this file, by the owner's decision (2026-08-24): the eleven POs whose
-- total is short by exactly their freight. They are older, mostly foreign
-- PIOs, several already Fully Received; raising their totals would rewrite
-- historical AP on closed POs. They are flagged in the UI instead.
--
-- SAFE TO RE-RUN. The WHERE clause re-proves the fault before touching a row:
-- a total that is no longer exactly twice its own (non-empty) line items is
-- left alone, so this can never fire twice on the same PO, and can never
-- touch a PO somebody has since corrected by hand.

UPDATE "5.0_purchases" p
SET total_value = t.items_sum
FROM (
  SELECT i.po_id, SUM(i.quantity * i.unit_cost) AS items_sum
  FROM "5.1_purchase_line_items" i
  GROUP BY i.po_id
  HAVING SUM(i.quantity * i.unit_cost) > 0
) t
WHERE t.po_id = p.po_id
  AND p.po_number IN ('EB.42277', 'EB.42324', 'PO-149-MBS-08-2026')
  -- Exactly double, and no freight that could explain the gap.
  AND COALESCE(p.freight_charges_intl, 0) = 0
  AND ABS(p.total_value::numeric - 2 * t.items_sum) < 1;

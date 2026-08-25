-- ── Write down what recalculate_po_total() actually promises ────────────────
--
-- No schema change. A COMMENT, because the absence of one cost a day.
--
-- `5.1_purchase_line_items` carries an AFTER-ROW trigger, `recalculate_po_total()`,
-- which keeps `5.0_purchases.total_value` in step with the line items while
-- preserving whatever the total exceeds them by — the freight a supplier bills
-- on top of the goods:
--
--     delta        = total_value - (items sum BEFORE this row change)
--     total_value  = (items sum AFTER this row change) + delta
--
-- That is a good rule with one unstated precondition: the total must already
-- describe the lines it is being compared against. Nothing in the application
-- said so, and nothing in the database said so either — so `app/purchasing`
-- inserted each PO with its total already filled in and its line items still to
-- come. On the first line the "items sum before" was ZERO, the entire stated
-- total was therefore read as freight, and the goods were stacked on top of it.
-- The PO came out at exactly twice its own line items:
--
--     stated 809.730 → one line of 809.730    → 1.619.460   (PO-149-MBS-08-2026)
--     stated 134.400 → three lines of 134.400 →   268.800   (EB.42324)
--     stated NULL    → one line of 809.730    →   809.730   (correct)
--
-- Those numbers are measured, not derived: reproduced against this trigger on
-- 2026-08-24 inside a DO block that raised at the end, so the probe rolled
-- itself back.
--
-- The application now writes line items FIRST and the stated total LAST
-- (`stampPoTotal` in app/purchasing/page.tsx, pinned by lib/poTotals.test.ts),
-- which is all the trigger ever needed. The three affected rows were corrected
-- in migrations/fix_doubled_po_totals.sql.
--
-- The precondition is not enforceable from inside the trigger: a guard for
-- "there were no lines before" fixes a single-line PO and still mis-adds every
-- row after the first in a multi-line batch, because each of those rows reads a
-- total the previous row already inflated. So it is written down instead, where
-- the next person to meet this function will actually find it.
--
-- Safe to re-run.

COMMENT ON FUNCTION public.recalculate_po_total() IS
$c$Keeps 5.0_purchases.total_value in step with 5.1_purchase_line_items, preserving the gap between them (freight billed on top of the goods).

  delta = total_value - (items sum BEFORE the change)
  total_value = (items sum AFTER the change) + delta

PRECONDITION: total_value must already describe the lines it is measured against. Never write a total onto a PO that has no line items yet — the delta is then computed against zero, the whole stated total is read as freight, and the first line insert lands the PO at exactly TWICE its goods. That is what happened to PO-149-MBS-08-2026, EB.42277 and EB.42324 (2026-08-24). Insert the lines first and stamp the stated total last; see stampPoTotal() in app/purchasing/page.tsx.$c$;

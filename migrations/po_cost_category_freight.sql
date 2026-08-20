-- ICAPROC — freight_cost as a PO cost category
-- ---------------------------------------------------------------------------
-- Third-party freight billed SEPARATELY from the supplier's invoice. (Freight
-- the supplier bills on the PO itself already goes in the PO's own Freight
-- Cost field and sits inside the document total; this is the other kind — the
-- forwarder's invoice that arrives on its own.)
--
-- It is landed cost by nature, and the cost engines are subtractive: anything
-- that is not principal, not a bank fee and not a tax is landed. So adding the
-- category is all that is needed for it to reach the true unit cost, the
-- moving-average stock cost and the landed-cost true-up.
--
-- Idempotent: safe to paste again. Ends with a PostgREST schema reload.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'po_cost_category' AND e.enumlabel = 'freight_cost'
  ) THEN
    ALTER TYPE po_cost_category ADD VALUE 'freight_cost' BEFORE 'local_delivery';
  END IF;
END $$;

-- The column is TEXT with its own CHECK, so the enum alone is not enough —
-- both have to name the value or an insert is rejected.
ALTER TABLE "6.0_po_costs" DROP CONSTRAINT IF EXISTS po_costs_category_check;
ALTER TABLE "6.0_po_costs" ADD CONSTRAINT po_costs_category_check CHECK (cost_category = ANY (ARRAY[
  'down_payment'::text, 'balance_payment'::text, 'additional_balance_payment'::text, 'overpayment_credit'::text,
  'full_amount_bank_fee'::text, 'telex_bank_fee'::text, 'value_today_bank_fee'::text, 'admin_bank_fee'::text,
  'inter_bank_transfer_fee'::text,
  'local_import_duty'::text, 'local_vat'::text, 'local_income_tax'::text,
  'freight_cost'::text, 'local_delivery'::text, 'demurrage_fee'::text, 'penalty_fee'::text,
  'dhl_advance_payment_fee'::text, 'local_import_tax'::text]));

NOTIFY pgrst, 'reload schema';

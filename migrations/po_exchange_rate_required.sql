-- ============================================================================
-- ICAPROC — a non-IDR PO is never saved without its exchange rate
--
-- The owner's ask (2026-10-23): "whenever MIRA helps to enter the PO in
-- ICAPROC, she always misses the exchange or currency rate. How to fix this?"
--
-- The New Deal screen estimates an empty Exch Rate from payment history — in
-- the browser. MIRA writes 5.0_purchases directly, so that code never ran and
-- EB.42538, PIO-2026020 and PIO-2026021 (KSTAR, CNY) were saved with
-- exchange_rate NULL. Every total reads a missing rate as 1, so Deal Lookup
-- showed "CNY 333.798 = IDR 333.798" and the Spend panels undercounted.
--
-- Two parts:
--   1. Backfill the three with 2688 — what lib/poRate.ts gives for KSTAR CNY
--      on 2026-10-23: the rate actually paid on 16 Oct for PIO-2026013
--      (IDR 2,015,733,651.10 ÷ CNY 750,000 = 2687.64). An ESTIMATE, as on every
--      unpaid PO; the realised rate replaces it once the PO is paid. Only rows
--      still NULL are touched.
--   2. A guard that refuses any non-IDR PO without a positive rate, naming
--      where to get one. The screen and GET /api/agent/purchasing/rate share
--      one rule (lib/poRate.ts); this is what stops a third writer.
--
-- No new table or view, so no GRANTs. Paste-ready and idempotent.
-- ============================================================================

UPDATE public."5.0_purchases"
   SET exchange_rate = 2688
 WHERE po_number IN ('EB.42538', 'PIO-2026020', 'PIO-2026021')
   AND currency = 'CNY'
   AND exchange_rate IS NULL;

CREATE OR REPLACE FUNCTION public.po_exchange_rate_required()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.currency IS NOT NULL AND NEW.currency <> 'IDR'
     AND (NEW.exchange_rate IS NULL OR NEW.exchange_rate <= 0) THEN
    RAISE EXCEPTION 'PO % is in % and has no exchange_rate. Save it with the rate: from the PI or the bank if they state one, else GET /api/agent/purchasing/rate?supplier_id=%&currency=% (the New Deal screen estimates it when Exch Rate is left empty). Never 1.',
      coalesce(NEW.po_number, '(new)'), NEW.currency, coalesce(NEW.supplier_id::text, ''), NEW.currency
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS po_exchange_rate_required ON public."5.0_purchases";
CREATE TRIGGER po_exchange_rate_required
  BEFORE INSERT OR UPDATE OF currency, exchange_rate ON public."5.0_purchases"
  FOR EACH ROW EXECUTE FUNCTION public.po_exchange_rate_required();

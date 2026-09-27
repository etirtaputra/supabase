-- ICAPROC — four Kstar CNY purchase orders booked at a USD exchange rate
--
-- NOT APPLIED. Read the evidence, then run it. (Owner's standing rule: never
-- mutate production data without asking first — this file is the asking.)
--
-- ── WHAT IS WRONG ────────────────────────────────────────────────────────────
--
-- Four POs to Shenzhen Kstar, all dated August 2026, carry `exchange_rate`
-- values of 17,822–17,882. That is the USD/IDR rate. Their currency is CNY,
-- where the rate at the time was ~2,634 (the average of every other CNY PO
-- within 120 days). Every rupiah figure derived from these four — committed
-- value, outstanding, landed cost, TUC, the vendor roll-up — is therefore
-- about 6.8× too large.
--
-- ── WHY IT IS THE RATE THAT IS WRONG, AND NOT THE CURRENCY ───────────────────
--
-- The line items settle it. They are priced in CNY and the prices only make
-- sense as CNY (checked 2026-09-27):
--
--   EB.42277    COLAN USB cable A–B 1.2m        7,000 × CNY 1.90
--               KSTAR UPS 600VA-2               1,000 × CNY 112.00
--               KSTAR GP803S 3kVA                  30 × CNY 3,392.00
--   PIO-2026013 KSTAR SIN202-9 II                 300 × CNY 1,200.00
--
-- At 2,634 a USB cable is Rp 5,005 and a 3kVA UPS is Rp 8.9m — ordinary. At
-- 17,822 the same cable is Rp 33,862 and the UPS Rp 60.4m. So the amounts are
-- right and the rate is a typo: a USD rate typed onto a CNY order.
--
-- ── WHY IT IS SAFE TO CORRECT ────────────────────────────────────────────────
--
-- None of the four has a single cost row — no payment, no freight, no duty
-- (verified 2026-09-27). Nothing is allocated against them, so no landed cost
-- or TUC is restated by this change; it only stops four future obligations
-- being reported at nearly seven times their size. When they are paid, the
-- payment rows carry their own rates and those, not this field, will drive the
-- real landed cost.
--
-- ── THE RATE CHOSEN ──────────────────────────────────────────────────────────
--
-- 2,634 — the average booked rate across every other CNY purchase order within
-- 120 days of these (individual nearby POs: 2,626 · 2,643 · 2,645 · 2,651 ·
-- 2,658). It is a placeholder for an unpaid order, and deliberately not a
-- guess dressed up as a measurement: change it if the PI states a rate.

BEGIN;

-- Look before overwriting.
SELECT po_number, po_date, currency, total_value, exchange_rate AS booked_rate,
       ROUND((total_value * exchange_rate)::numeric, 0) AS idr_today,
       ROUND((total_value * 2634)::numeric, 0)          AS idr_after
FROM public."5.0_purchases"
WHERE po_number IN ('EB.42277', 'EB.42278', 'PIO-2026011', 'PIO-2026013')
ORDER BY po_number;

UPDATE public."5.0_purchases"
SET exchange_rate = 2634
WHERE po_number IN ('EB.42277', 'EB.42278', 'PIO-2026011', 'PIO-2026013')
  AND currency::text = 'CNY'
  -- Idempotent, and a guard: if somebody has already corrected one of these by
  -- hand, this leaves their number alone rather than overwriting it.
  AND exchange_rate > 8000
  -- And it must still be true that nothing has been allocated against them. If
  -- a payment has landed since this file was written, STOP and re-read it —
  -- the landed cost would be restated and that is a different decision.
  AND NOT EXISTS (SELECT 1 FROM public."6.0_po_costs" c WHERE c.po_id = "5.0_purchases".po_id);

-- Expect: UPDATE 4. Anything else means the situation has moved — ROLLBACK.
COMMIT;

-- ICAPROC — a settled PO records its own debt, whoever settled it
--
-- Owner, 2026-09-16: *"do the true-up server-side one next"*.
--
-- THE GAP. Auto-post shipped on 2026-09-13 wired into `app/purchasing/page.tsx`
-- — the BROWSER. MIRA writes `6.0_po_costs` rows directly over PostgREST,
-- which is its documented procedure and a large share of the payments this
-- business enters. So the moment MIRA logged the balance payment that made a
-- PO's bills final, nothing told the stock ledger, and the exact gap the
-- feature was built to close reopened for the agent entering most of the work.
--
-- ── WHAT THIS TRIGGER DELIBERATELY DOES NOT DO ───────────────────────────────
--
-- **It does not compute the true-up.** The obvious fix is a trigger that posts
-- the revaluation itself, and it is the wrong one: the allocation rules live in
-- `lib/landedCost.ts` beside `computeTUC` precisely so a landed cost means ONE
-- thing. Re-deriving pool, factor, per-line share, moving-average revaluable
-- quantity and the materiality floor in PL/pgSQL would give one rule two
-- implementations, and they would drift the first time a cost category moved —
-- silently, inside the number every margin is measured against. That is the
-- same trap refused for the tier-price chain on 2026-09-11.
--
-- So the trigger records a FACT — "this PO's bills went final, it is owed a
-- true-up" — and the arithmetic stays in the one place that knows it. The queue
-- is the debt made visible; `POST /api/landed/autopost` (no body) drains it
-- with the same `autoPostVerdict` the reconcile screen shows.
--
-- ── WHY A QUEUE AND NOT A SWEEP ──────────────────────────────────────────────
--
-- A sweep over every settled PO would work and would also, on its first run,
-- post the IDR 777.9m backlog that predates all of this — a decision that is
-- the owner's to make deliberately on `/stock/reconcile`, not a side effect of
-- a deploy. A queue is its own watermark: only a PO whose payment is entered
-- from now on gets queued, so the backlog stays exactly where it is.

CREATE TABLE IF NOT EXISTS public."30.5_landed_true_up_queue" (
  -- One row per PO, not per payment: three cost rows arriving together are one
  -- debt, and re-queuing an already-queued PO must not multiply the work.
  po_id            uuid PRIMARY KEY REFERENCES public."5.0_purchases"(po_id) ON DELETE CASCADE,
  queued_at        timestamptz NOT NULL DEFAULT now(),
  -- WHO made the bills final. The drain runs as whoever happens to be signed in,
  -- so `30.0_stock_movements.created_by_email` records the drainer; this keeps
  -- the other half of the story — usually an agent, and worth being able to see.
  queued_by_email  text NOT NULL DEFAULT 'system',
  attempts         int  NOT NULL DEFAULT 0,
  last_attempt_at  timestamptz,
  -- 'pending' · 'held' (a human must look — see lib/landedAutoPost.ts) · 'error'.
  -- A POSTED row is DELETED: the queue holds work outstanding, never history.
  -- History is the ledger, which is append-only and already has it.
  outcome          text NOT NULL DEFAULT 'pending',
  note             text
);

COMMENT ON TABLE public."30.5_landed_true_up_queue" IS
  'POs whose bills went final and whose landed-cost true-up has not been posted yet. Written by a trigger on 6.0_po_costs; drained by POST /api/landed/autopost. A posted row is deleted — this is a worklist, not a log.';

CREATE INDEX IF NOT EXISTS landed_true_up_queue_outcome_idx
  ON public."30.5_landed_true_up_queue" (outcome, queued_at);

ALTER TABLE public."30.5_landed_true_up_queue" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "buy side read"  ON public."30.5_landed_true_up_queue";
DROP POLICY IF EXISTS "buy side write" ON public."30.5_landed_true_up_queue";
-- It names purchase orders and who paid them, so it follows the buy side.
CREATE POLICY "buy side read" ON public."30.5_landed_true_up_queue"
  FOR SELECT TO authenticated USING (public.can_read_buy_side());
-- The drain runs AS THE CALLER and must clear rows it has posted.
CREATE POLICY "buy side write" ON public."30.5_landed_true_up_queue"
  FOR ALL TO authenticated
  USING (public.can_write_buy_side()) WITH CHECK (public.can_write_buy_side());

-- ── The trigger: record the debt, never the arithmetic ───────────────────────
CREATE OR REPLACE FUNCTION public.queue_landed_true_up()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  target  uuid;
  settled boolean;
  actor   text;
BEGIN
  target := COALESCE(NEW.po_id, OLD.po_id);
  IF target IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Settled = a balance payment exists, the same test `isSettled` makes in
  -- lib/landedCost.ts. Until then the bills are still moving and truing up now
  -- only means truing up again later.
  SELECT EXISTS (
    SELECT 1 FROM public."6.0_po_costs" c
    WHERE c.po_id = target
      AND c.cost_category IN ('balance_payment', 'additional_balance_payment')
  ) INTO settled;

  IF NOT settled THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT email INTO actor FROM public.user_profiles WHERE id = auth.uid();

  INSERT INTO public."30.5_landed_true_up_queue" AS q
    (po_id, queued_at, queued_by_email, outcome, attempts, note)
  VALUES (target, now(), COALESCE(actor, 'system'), 'pending', 0, NULL)
  ON CONFLICT (po_id) DO UPDATE SET
    -- A later bill on an already-settled PO is a NEW debt (the increment), so a
    -- row previously parked as 'held' goes back to 'pending' and is judged
    -- again on the numbers as they now stand.
    queued_at       = now(),
    queued_by_email = EXCLUDED.queued_by_email,
    outcome         = 'pending',
    attempts        = 0,
    note            = NULL;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Fires on every path into the table — the purchasing screen, an agent writing
-- over PostgREST, a hand-run INSERT. That universality is the entire point:
-- the previous version lived in one React component.
DROP TRIGGER IF EXISTS queue_landed_true_up_trigger ON public."6.0_po_costs";
CREATE TRIGGER queue_landed_true_up_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public."6.0_po_costs"
  FOR EACH ROW EXECUTE FUNCTION public.queue_landed_true_up();

-- Fix: a sales document created straight at a milestone never got its number.
--
-- stamp_sales_quote() stamped order/invoice/DO numbers ONLY in its UPDATE
-- branch, each gated on `OLD.status IS DISTINCT FROM '<milestone>'`. A row
-- INSERTED already at 'ordered' — which is what an API client does when it
-- writes a confirmed order in one shot — has no OLD, so it passed no gate and
-- came out with order_number = ''. lib/salesStatus.ts then correctly falls back
-- to showing the PQ- number, so a Confirmed Order kept reading as a quote.
-- The same gap existed for invoice_number and do_number, and for any UPDATE
-- that skipped milestones (draft -> delivered stamped only the DO number).
--
-- The numbering is now derived from the milestone the row is AT: every number
-- that status implies gets stamped if missing, on INSERT and UPDATE alike.
-- A number supplied by the caller is always kept.
--
-- Timestamps deliberately do NOT follow that rule — only the milestone the row
-- actually sits at is stamped, so the ladder never invents history for stages
-- the document skipped.
--
-- Applied 2026-09-01.

CREATE OR REPLACE FUNCTION public.stamp_sales_quote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  actor  TEXT;
  d      TEXT   := to_char(NOW(), 'YYYYMMDD');
  ladder TEXT[] := ARRAY['draft','validated','sent','accepted',
                         'ordered','invoiced','preparing','delivered'];
  idx    INT;
BEGIN
  SELECT email INTO actor FROM user_profiles WHERE id = auth.uid();
  actor := COALESCE(actor, 'system');

  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.quote_number, '') = '' THEN
      NEW.quote_number := 'SQ-' || d || '-' || lpad(nextval('sales_quote_seq')::text, 4, '0');
    END IF;
    NEW.created_by_email := actor;
    NEW.updated_by_email := actor;
    NEW.created_at := COALESCE(NEW.created_at, NOW());
    NEW.updated_at := NOW();
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.updated_by_email := actor;
    NEW.updated_at := NOW();
    IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, NOW());
    END IF;
  END IF;

  -- Milestone numbers: everything the current status implies. Runs for INSERT
  -- and UPDATE, which is the whole point of this fix.
  idx := array_position(ladder, NEW.status);
  IF idx IS NOT NULL THEN
    IF idx >= array_position(ladder, 'ordered')
       AND COALESCE(NEW.order_number, '') = '' THEN
      NEW.order_number := 'SO-' || d || '-' || lpad(nextval('sales_order_seq')::text, 4, '0');
    END IF;
    IF idx >= array_position(ladder, 'invoiced')
       AND COALESCE(NEW.invoice_number, '') = '' THEN
      NEW.invoice_number := 'INV-' || d || '-' || lpad(nextval('sales_invoice_seq')::text, 4, '0');
    END IF;
    IF idx >= array_position(ladder, 'preparing')
       AND COALESCE(NEW.do_number, '') = '' THEN
      NEW.do_number := 'DO-' || d || '-' || lpad(nextval('sales_do_seq')::text, 4, '0');
    END IF;

    -- Timestamp: only the milestone the row is at.
    CASE NEW.status
      WHEN 'validated' THEN NEW.validated_at := COALESCE(NEW.validated_at, NOW());
      WHEN 'sent'      THEN NEW.sent_at      := COALESCE(NEW.sent_at,      NOW());
      WHEN 'accepted'  THEN NEW.accepted_at  := COALESCE(NEW.accepted_at,  NOW());
      WHEN 'ordered'   THEN NEW.ordered_at   := COALESCE(NEW.ordered_at,   NOW());
      WHEN 'invoiced'  THEN NEW.invoiced_at  := COALESCE(NEW.invoiced_at,  NOW());
      WHEN 'preparing' THEN NEW.preparing_at := COALESCE(NEW.preparing_at, NOW());
      WHEN 'delivered' THEN NEW.delivered_at := COALESCE(NEW.delivered_at, NOW());
      ELSE NULL;
    END CASE;
  END IF;

  -- A revision bump invalidates the approval trail. Last, so it wins over the
  -- stamping above (matches the behaviour before this fix).
  IF TG_OP = 'UPDATE' AND NEW.revision > COALESCE(OLD.revision, 0) THEN
    NEW.revised_at   := NOW();
    NEW.validated_at := NULL;
    NEW.sent_at      := NULL;
    NEW.accepted_at  := NULL;
  END IF;

  RETURN NEW;
END $function$;

-- ── One-time backfill (run once, 2026-09-01) ────────────────────────────────
-- The two orders the agent inserted straight at 'ordered' before the fix.
-- The sequence was first wound back to 6 (the highest SO in use) to undo the
-- numbers burned by the rolled-back rehearsals, so these land on 0007/0008 with
-- no gap. Each SO carries its own ordered_at date, matching how every earlier
-- SO was numbered (SQ-20260802-0003 ordered 2026-08-03 -> SO-20260803-0002).
--
--   select setval('sales_order_seq', 6, true);
--
--   with target as (
--     select quote_id, ordered_at,
--            row_number() over (order by ordered_at, created_at) as rn
--     from "22.0_sales_quotes"
--     where status in ('ordered','invoiced','preparing','delivered')
--       and coalesce(order_number,'') = ''
--   )
--   update "22.0_sales_quotes" q
--   set order_number = 'SO-' || to_char(t.ordered_at,'YYYYMMDD') || '-'
--                    || lpad(nextval('sales_order_seq')::text, 4, '0')
--   from target t
--   where q.quote_id = t.quote_id;
--
-- Result: SQ-20260831-0018 -> SO-20260831-0007
--         SQ-20260901-0019 -> SO-20260831-0008
-- Verified after: 0 documents at 'ordered' or beyond without an SO number,
-- 0 without an invoice number at 'invoiced'+, 0 without a DO at 'preparing'+,
-- 0 duplicate SO numbers, 13 rows total (unchanged).

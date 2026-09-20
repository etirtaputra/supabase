-- ICAPROC — a Project Engineer may pull a SENT proposal back to draft
--
-- Owner, 2026-09-20: *"give project engineer role in icaproc the ability to
-- revert 'sent' epc proposals back to draft"*.
--
-- Today `can_edit_quote()` lets `engineer`, `data_entry` and `finance` edit a
-- proposal freely until it is SENT, and then stops them dead — only `owner`
-- may touch it. That is right for the CONTENT: a sent proposal is what the
-- customer is holding, and quietly changing it under them is how a quote and a
-- conversation stop matching. It is wrong for the one case that actually
-- happens: the engineer sent it, spotted something, and needs it back.
--
-- ── WHAT THIS DELIBERATELY DOES NOT GRANT ────────────────────────────────────
--
-- Not "engineers can edit sent proposals". The ask was ONE transition, and the
-- easy version of this change is much wider than the ask:
--
--   · The existing `quotes write` policy is UNTOUCHED, so DELETE of a sent
--     proposal stays owner-only. `can_edit_quote()` is used for ALL commands —
--     widening it would have handed engineers the delete too, invisibly.
--   · A new UPDATE-only policy adds exactly the un-send. Permissive policies
--     are OR'd, so this grants the transition without loosening anything else.
--   · A BEFORE UPDATE trigger then holds the engineer to it: on a sent row, a
--     non-owner may change the STATUS to draft and nothing else. Once the row
--     is a draft again, the ordinary rules apply and they can edit it normally.
--
-- Enforced in the DATABASE, not in React. This session has already found two
-- places where a rule lived only in the UI and was therefore not a rule
-- (buy-side reads, and the true-up that lived in a page component). A guard
-- that a PostgREST call can walk around is decoration.
--
-- The un-send is audited for free: `log_quote_activity` already fires BEFORE
-- INSERT OR UPDATE OR DELETE on this table, so who reverted what, and when, is
-- in `10.3_quote_activity` without anything new.

-- ── 1. Who may un-send ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_unsend_quote()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
AS $function$
  -- Owner is already covered by can_edit_quote(); named here too so the policy
  -- reads as one idea rather than two halves.
  SELECT EXISTS (SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND role IN ('owner', 'engineer'));
$function$;

COMMENT ON FUNCTION public.can_unsend_quote() IS
  'May pull a SENT EPC proposal back to draft. NOT permission to edit a sent proposal — guard_quote_unsend() holds a non-owner to the status change alone.';

-- ── 2. The one extra path ────────────────────────────────────────────────────
-- UPDATE only. `quotes write` still governs INSERT and DELETE unchanged.
DROP POLICY IF EXISTS "quotes unsend" ON public."10.0_project_quotes";
CREATE POLICY "quotes unsend" ON public."10.0_project_quotes"
  FOR UPDATE TO authenticated
  USING (status = 'sent' AND public.can_unsend_quote())
  WITH CHECK (status = 'draft' AND public.can_unsend_quote());

-- ── 3. And nothing more than that path ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_quote_unsend()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  is_owner boolean;
  skip     text[] := ARRAY['status', 'sent_at', 'updated_at', 'updated_by_email'];
BEGIN
  -- Only a sent row is protected, and only for a non-owner. An owner editing a
  -- sent proposal is a deliberate, long-standing power and is left alone.
  IF OLD.status IS DISTINCT FROM 'sent' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner')
    INTO is_owner;
  IF is_owner THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'A SENT proposal can only be moved back to draft. To change it any other way, ask an Owner.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Column-agnostic on purpose: a business field added to this table next year
  -- is protected the day it is added, with nobody having to remember this file.
  -- `sent_at` is skipped because it is trigger-stamped, not user data.
  IF (to_jsonb(NEW) - skip) IS DISTINCT FROM (to_jsonb(OLD) - skip) THEN
    RAISE EXCEPTION 'Reverting a SENT proposal to draft must change ONLY its status — save your other edits after it is back in draft.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.guard_quote_unsend() IS
  'Holds a non-owner un-send to the status column alone, so "a sent proposal is read-only" stays true with exactly one exception.';

-- Fires before `log_quote_activity` (g < l, and Postgres runs BEFORE triggers
-- in name order), so a rejected un-send is never written to the activity log.
DROP TRIGGER IF EXISTS guard_quote_unsend_trigger ON public."10.0_project_quotes";
CREATE TRIGGER guard_quote_unsend_trigger
  BEFORE UPDATE ON public."10.0_project_quotes"
  FOR EACH ROW EXECUTE FUNCTION public.guard_quote_unsend();

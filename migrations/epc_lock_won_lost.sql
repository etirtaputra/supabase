-- ICAPROC — a WON or LOST proposal is locked like a SENT one (2026-11-10)
--
-- Owner, 2026-11-10: *"yes, lock won and lost proposals like sent ones"*.
--
-- Until now only `sent` was locked: an engineer could reopen the content of an
-- accepted (won) or rejected (lost) proposal and change it freely — the
-- document the customer signed, or the record of what was lost, quietly
-- drifting. Now `sent`, `accepted` and `rejected` are all LOCKED states
-- (lib/lifecycles.ts → PROPOSAL_LOCKED_STATES), with exactly the rules `sent`
-- already had:
--
--   · content (header, sections, lines) is owner-only — can_edit_quote();
--   · an Owner or a Project Engineer may move it back to DRAFT and nothing
--     else — policy "quotes unsend" + trigger guard_quote_unsend();
--   · DELETE stays owner-only ("quotes write" is untouched).
--
-- Moving a DRAFT to sent / accepted / rejected is unchanged: the lock applies
-- once the proposal is in one of those states, as it always did for sent.
--
-- Same three objects as migrations/epc_engineer_unsend.sql and
-- role_taxonomy_v2.sql; only the status list changes. No new table or view,
-- so no GRANTs.

-- 1. Content: owner-only once locked
CREATE OR REPLACE FUNCTION public.can_edit_quote(qid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner')
      OR (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('engineer','data_entry','finance'))
        AND NOT EXISTS (SELECT 1 FROM "10.0_project_quotes" q
                        WHERE q.quote_id = qid AND q.status IN ('sent', 'accepted', 'rejected'))
      );
$function$;

-- 2. The one extra path: a locked proposal back to draft (UPDATE only)
DROP POLICY IF EXISTS "quotes unsend" ON public."10.0_project_quotes";
CREATE POLICY "quotes unsend" ON public."10.0_project_quotes"
  FOR UPDATE TO authenticated
  USING (status IN ('sent', 'accepted', 'rejected') AND public.can_unsend_quote())
  WITH CHECK (status = 'draft' AND public.can_unsend_quote());

-- 3. And nothing more than that path
CREATE OR REPLACE FUNCTION public.guard_quote_unsend()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  is_owner boolean;
  skip     text[] := ARRAY['status', 'sent_at', 'updated_at', 'updated_by_email'];
BEGIN
  IF OLD.status NOT IN ('sent', 'accepted', 'rejected') THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner')
    INTO is_owner;
  IF is_owner THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'A sent, won or lost proposal can only be moved back to draft. To change it any other way, ask an Owner.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (to_jsonb(NEW) - skip) IS DISTINCT FROM (to_jsonb(OLD) - skip) THEN
    RAISE EXCEPTION 'Moving a locked proposal back to draft must change ONLY its status — save your other edits after it is back in draft.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.guard_quote_unsend() IS
  'Holds a non-owner to the status column alone on a sent, won or lost proposal: the only move is back to draft.';
COMMENT ON FUNCTION public.can_unsend_quote() IS
  'May move a sent, won or lost EPC proposal back to draft. NOT permission to edit it — guard_quote_unsend() holds a non-owner to the status change alone.';

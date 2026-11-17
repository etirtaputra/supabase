-- ICAPROC — archive an EPC proposal by hand (2026-11-17)
--
-- Owner, 2026-11-17: *"yes, add a manual Archive button"*. Until now the list
-- archived a proposal only by rule (lib/proposalGroups.ts isActive): its
-- newest version won or lost, or sent and untouched for 60 days. A deal that
-- went quiet without an answer stayed in Active for two months.
--
-- Archived is a TIMESTAMP, not a status — a proposal keeps its status (sent,
-- won…) when it is put away. Declared in lib/lifecycles.ts as
-- `epc_proposal_archive`. The list reads the family's NEWEST version: a new
-- revision (-REV) of an archived proposal is live again by itself.
--
--   1. two columns: archived_at, archived_by_email
--   2. guard_quote_unsend(): a sent / won / lost proposal is locked, but
--      putting it away is not editing it — a change to the archive columns
--      ALONE passes. (Direct UPDATEs of a locked row are still refused by RLS
--      for a non-owner; the only way in is the RPC below.)
--   3. log_quote_activity(): an archive/restore is logged as `archived` /
--      `restored`, not as an `edited`. Archiving does not touch updated_at
--      ("Edited by" stays the last real editor); RESTORING restarts it, so a
--      proposal idle for 60+ days does not fall straight back into the archive.
--   4. RPC proposal_set_archived(quote_id, archived) — the same people who may
--      edit a draft (can_edit_quote's roles: owner, engineer, data_entry,
--      finance), on any status.
--
-- No new table or view, so no table GRANTs.

-- 1. Columns
ALTER TABLE public."10.0_project_quotes"
  ADD COLUMN IF NOT EXISTS archived_at       timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by_email text;

COMMENT ON COLUMN public."10.0_project_quotes".archived_at IS
  'Put away by hand (RPC proposal_set_archived). NULL = not archived by hand; the list may still archive it by rule (won/lost/idle 60 days). Read on the family''s newest version.';
COMMENT ON COLUMN public."10.0_project_quotes".archived_by_email IS
  'Who archived it (set with archived_at, cleared on restore).';

-- 2. The lock lets the archive columns through, and only them
CREATE OR REPLACE FUNCTION public.guard_quote_unsend()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  is_owner boolean;
  skip     text[] := ARRAY['status', 'sent_at', 'updated_at', 'updated_by_email'];
  shelf    text[] := ARRAY['archived_at', 'archived_by_email', 'updated_at', 'updated_by_email'];
BEGIN
  IF OLD.status NOT IN ('sent', 'accepted', 'rejected') THEN
    RETURN NEW;
  END IF;

  -- Putting a proposal away (or back) is not editing it.
  IF (to_jsonb(NEW) - shelf) IS NOT DISTINCT FROM (to_jsonb(OLD) - shelf) THEN
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

-- 3. Archive / restore is its own entry in the history
CREATE OR REPLACE FUNCTION public.log_quote_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  actor TEXT;
  shelf text[] := ARRAY['archived_at', 'archived_by_email'];
BEGIN
  SELECT email INTO actor FROM user_profiles WHERE id = auth.uid();
  actor := COALESCE(actor, 'system');
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM "10.0_project_quotes" WHERE quote_id = NEW.quote_id) THEN
      RETURN NEW;
    END IF;
    NEW.created_by_email := actor;
    NEW.updated_by_email := actor;
    IF NEW.status = 'sent' THEN NEW.sent_at := COALESCE(NEW.sent_at, NOW()); END IF;
    INSERT INTO "10.3_quote_activity"(quote_id, quote_number, action, actor_email)
      VALUES (NEW.quote_id, NEW.quote_number, 'created', actor);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Only the archive columns changed: log it as such and leave the edit
    -- stamps alone — except on restore, which restarts the 60-day clock.
    IF NEW.archived_at IS DISTINCT FROM OLD.archived_at
       AND (to_jsonb(NEW) - shelf) IS NOT DISTINCT FROM (to_jsonb(OLD) - shelf) THEN
      IF NEW.archived_at IS NULL THEN
        NEW.updated_by_email := actor;
        NEW.updated_at := NOW();
      END IF;
      INSERT INTO "10.3_quote_activity"(quote_id, quote_number, action, actor_email)
        VALUES (NEW.quote_id, NEW.quote_number,
                CASE WHEN NEW.archived_at IS NULL THEN 'restored' ELSE 'archived' END, actor);
      RETURN NEW;
    END IF;
    NEW.updated_by_email := actor;
    NEW.updated_at := NOW();
    IF NEW.status = 'sent' AND OLD.status IS DISTINCT FROM 'sent' THEN
      NEW.sent_at := NOW();
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO "10.3_quote_activity"(quote_id, quote_number, action, detail, actor_email)
        VALUES (NEW.quote_id, NEW.quote_number, 'status', OLD.status || ' -> ' || NEW.status, actor);
    ELSIF NOT EXISTS (
      SELECT 1 FROM "10.3_quote_activity"
      WHERE quote_id = NEW.quote_id AND action = 'edited' AND actor_email = actor
        AND at > NOW() - INTERVAL '10 minutes'
    ) THEN
      INSERT INTO "10.3_quote_activity"(quote_id, quote_number, action, actor_email)
        VALUES (NEW.quote_id, NEW.quote_number, 'edited', actor);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO "10.3_quote_activity"(quote_id, quote_number, action, actor_email)
      VALUES (OLD.quote_id, OLD.quote_number, 'deleted', actor);
    RETURN OLD;
  END IF;
  RETURN NULL;
END $function$;

-- 4. The one way in
CREATE OR REPLACE FUNCTION public.proposal_set_archived(p_quote_id uuid, p_archived boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor text;
BEGIN
  SELECT email INTO actor FROM user_profiles
   WHERE id = auth.uid() AND role IN ('owner', 'engineer', 'data_entry', 'finance');
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Only someone who can edit EPC proposals may archive one.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "10.0_project_quotes" WHERE quote_id = p_quote_id) THEN
    RAISE EXCEPTION 'No such proposal.' USING ERRCODE = 'no_data_found';
  END IF;
  -- Already in that state: nothing to do (no second history entry).
  UPDATE "10.0_project_quotes"
     SET archived_at       = CASE WHEN p_archived THEN NOW() END,
         archived_by_email = CASE WHEN p_archived THEN actor END
   WHERE quote_id = p_quote_id
     AND (archived_at IS NULL) = p_archived;
END;
$function$;

COMMENT ON FUNCTION public.proposal_set_archived(uuid, boolean) IS
  'Archive (true) or restore (false) an EPC proposal by hand. Any status; roles that may edit a draft. Logged in 10.3 as archived/restored.';

REVOKE ALL ON FUNCTION public.proposal_set_archived(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proposal_set_archived(uuid, boolean) TO authenticated, service_role;

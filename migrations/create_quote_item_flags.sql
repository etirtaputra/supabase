-- ============================================================================
-- ICAPROC — 10.7_quote_item_flags: a proposal line WAITING on someone
--
-- The owner's ask (2026-10-22): "for the epc proposal can we actually flag a
-- line items awaiting for price or technical clarifications? for example in
-- the latest AYANA BOH Atap ballroom now we're just waiting for the updated
-- price of the ACDP and we can tag who is responsible." Then: "clear by hand
-- (but the log should say who clears what). Tag only owners and people on
-- Project Engineers or Admin Project."
--
-- One row per flag. A flag is OPEN until someone clears it by hand; clearing
-- stamps the time and the person and the row stays, so the proposal keeps the
-- whole story (who raised it, who it was on, who settled it). No DELETE policy.
--
-- WHO is stamped by the database, never by the browser — the same rule as
-- 42.0_page_views: a log a user can forge is not a log. Every raise, reassign
-- and clear is also written to 10.3_quote_activity, so it shows in the
-- proposal's History next to its edits and status changes.
--
-- Never printed. The PDF only ever asks how many are open, to warn.
-- Paste-ready and idempotent.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public."10.7_quote_item_flags" (
  flag_id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quote_id          uuid NOT NULL REFERENCES public."10.0_project_quotes"(quote_id) ON DELETE CASCADE,
  -- A deleted line takes its flags with it: a question about a line that no
  -- longer exists is not something anyone is waiting on.
  item_id           uuid NOT NULL REFERENCES public."10.2_quote_items"(item_id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('price', 'technical')),
  assignee_email    text NOT NULL,
  note              text NOT NULL DEFAULT '',
  created_by_email  text NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  resolved_by_email text
);

CREATE INDEX IF NOT EXISTS quote_item_flags_open_quote_idx
  ON public."10.7_quote_item_flags" (quote_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS quote_item_flags_open_assignee_idx
  ON public."10.7_quote_item_flags" (assignee_email) WHERE resolved_at IS NULL;

ALTER TABLE public."10.7_quote_item_flags" ENABLE ROW LEVEL SECURITY;

-- Same audience as the follow-up notes (10.5): anyone who works on EPC
-- proposals. can_view_epc(), not can_edit_quote(): a SENT proposal is locked
-- to owners, and a sent proposal can still be waiting on a revised price.
DROP POLICY IF EXISTS "item flags read" ON public."10.7_quote_item_flags";
CREATE POLICY "item flags read" ON public."10.7_quote_item_flags"
  FOR SELECT TO authenticated USING (public.can_view_epc());
DROP POLICY IF EXISTS "item flags raise" ON public."10.7_quote_item_flags";
CREATE POLICY "item flags raise" ON public."10.7_quote_item_flags"
  FOR INSERT TO authenticated WITH CHECK (public.can_view_epc());
DROP POLICY IF EXISTS "item flags update" ON public."10.7_quote_item_flags";
CREATE POLICY "item flags update" ON public."10.7_quote_item_flags"
  FOR UPDATE TO authenticated USING (public.can_view_epc()) WITH CHECK (public.can_view_epc());

-- Supabase's default privileges may still hand a new table to anon with every
-- right; take them back so the grants below are the whole list. No DELETE for
-- staff: a flag is cleared, never removed.
REVOKE ALL ON public."10.7_quote_item_flags" FROM anon;
REVOKE ALL ON public."10.7_quote_item_flags" FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public."10.7_quote_item_flags" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."10.7_quote_item_flags" TO service_role;

COMMENT ON TABLE public."10.7_quote_item_flags" IS
  'Proposal lines waiting on a price or a technical answer, and who it is on. Cleared by hand, never deleted; who raised/cleared is stamped by trigger. Never printed.';

-- ── Who, when, and the History line ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stamp_quote_item_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  actor  text;
  qnum   text;
  what   text;
  label  text;
BEGIN
  SELECT email INTO actor FROM user_profiles WHERE id = auth.uid();
  actor := COALESCE(actor, 'system');
  SELECT quote_number INTO qnum FROM "10.0_project_quotes" WHERE quote_id = NEW.quote_id;
  SELECT left(btrim(description), 60) INTO what FROM "10.2_quote_items" WHERE item_id = NEW.item_id;
  label := CASE NEW.kind WHEN 'price' THEN 'Price' ELSE 'Technical' END || ': ' || COALESCE(NULLIF(what, ''), 'line');

  -- Only owners and project engineers (incl. Admin Project) can be tagged.
  IF TG_OP = 'INSERT' OR NEW.assignee_email IS DISTINCT FROM OLD.assignee_email THEN
    IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE email = NEW.assignee_email AND role IN ('owner', 'engineer')) THEN
      RAISE EXCEPTION 'Only owners and project engineers can be tagged (%).', NEW.assignee_email;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by_email  := actor;
    NEW.created_at        := now();
    NEW.resolved_at       := NULL;
    NEW.resolved_by_email := NULL;
    INSERT INTO "10.3_quote_activity"(quote_id, quote_number, action, detail, actor_email)
      VALUES (NEW.quote_id, qnum, 'flagged', label || ' → ' || split_part(NEW.assignee_email, '@', 1), actor);
    RETURN NEW;
  END IF;

  -- UPDATE. A cleared flag is history: it does not change again.
  IF OLD.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'This flag was already cleared.';
  END IF;
  -- What it was about, and who raised it, never change.
  NEW.quote_id := OLD.quote_id; NEW.item_id := OLD.item_id; NEW.kind := OLD.kind;
  NEW.created_by_email := OLD.created_by_email; NEW.created_at := OLD.created_at;

  IF NEW.resolved_at IS NOT NULL THEN
    NEW.resolved_at       := now();
    NEW.resolved_by_email := actor;
    INSERT INTO "10.3_quote_activity"(quote_id, quote_number, action, detail, actor_email)
      VALUES (NEW.quote_id, qnum, 'cleared', label, actor);
  ELSE
    NEW.resolved_by_email := NULL;
    IF NEW.assignee_email IS DISTINCT FROM OLD.assignee_email THEN
      INSERT INTO "10.3_quote_activity"(quote_id, quote_number, action, detail, actor_email)
        VALUES (NEW.quote_id, qnum, 'flagged', label || ' → ' || split_part(NEW.assignee_email, '@', 1), actor);
    END IF;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS stamp_quote_item_flag ON public."10.7_quote_item_flags";
CREATE TRIGGER stamp_quote_item_flag
  BEFORE INSERT OR UPDATE ON public."10.7_quote_item_flags"
  FOR EACH ROW EXECUTE FUNCTION public.stamp_quote_item_flag();

-- ── "Save PDF anyway" goes on the record ────────────────────────────────────
-- The browser only says WHICH proposal; the database counts the open flags
-- itself and names the lines, so the History line cannot be softened.
CREATE OR REPLACE FUNCTION public.log_quote_pdf_with_flags(p_quote_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  actor text;
  n     int;
  lines text;
BEGIN
  IF NOT public.can_view_epc() THEN RETURN; END IF;
  SELECT email INTO actor FROM user_profiles WHERE id = auth.uid();
  SELECT count(*), string_agg(left(btrim(i.description), 40), ', ' ORDER BY f.created_at)
    INTO n, lines
    FROM "10.7_quote_item_flags" f JOIN "10.2_quote_items" i ON i.item_id = f.item_id
   WHERE f.quote_id = p_quote_id AND f.resolved_at IS NULL;
  IF n = 0 THEN RETURN; END IF;
  INSERT INTO "10.3_quote_activity"(quote_id, quote_number, action, detail, actor_email)
    SELECT p_quote_id, q.quote_number, 'pdf', 'PDF with ' || n || ' waiting: ' || lines, COALESCE(actor, 'system')
      FROM "10.0_project_quotes" q WHERE q.quote_id = p_quote_id;
END $function$;

REVOKE ALL ON FUNCTION public.log_quote_pdf_with_flags(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_quote_pdf_with_flags(uuid) TO authenticated, service_role;

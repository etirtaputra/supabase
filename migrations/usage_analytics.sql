-- ICAPROC — Module 42: what the team actually opens
--
-- Owner, 2026-09-21: *"a new dashboard module that counts the number of visits
-- to which page which module used, the clicks to get to that page… the goal is
-- to optimize the pages design and make the menus more focused. i feel right
-- now there's too many menus and pages but not sure what to get rid of."*
--
-- The menu has 56 destinations across 7 groups. Which of them earn their place
-- is currently a matter of opinion, and an opinion about a menu is what put 56
-- entries in it. This table is the evidence: one row per screen opened, by
-- whom, from where, and how many clicks in.
--
-- ── WHAT THIS RECORDS, AND WHAT IT DELIBERATELY DOES NOT ─────────────────────
--
--   · The PATH, normalised — `/proposals/<uuid>` is stored as `/proposals/:id`,
--     because the question is "does anybody open the proposal editor", never
--     "who read quote Q-20260919-HBI8-P". The document-level audit logs already
--     answer the second question and this one has no business duplicating them.
--   · No search terms, no form contents, no scroll, no mouse position. A path,
--     a referrer path, and how the person got there.
--   · Staff screens only (owner's call, 2026-09-21). The tracker skips /shop,
--     /login and the customer-facing print surfaces.
--
-- ── WHO, AND WHY THE CLIENT DOES NOT GET TO SAY ──────────────────────────────
--
-- The browser sends the path. The DATABASE stamps the identity: `user_id`
-- defaults to auth.uid() and a BEFORE INSERT trigger fills `user_email` and
-- `user_role` from `user_profiles`, ignoring whatever the client passed. A
-- usage log a user can forge rows in is a log you cannot draw a conclusion
-- from — and the conclusion here is which modules get deleted.
--
-- Reads are OWNER ONLY. This says who opened what, by name.

-- ── 1. The log ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."42.0_page_views" (
  view_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viewed_at   timestamptz NOT NULL DEFAULT now(),
  -- Identity is stamped by the trigger below, never by the caller.
  user_id     uuid        NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email  text        NOT NULL DEFAULT '',
  user_role   text        NOT NULL DEFAULT '',
  -- One browser tab, from load to close. Two views in one session are what
  -- make "clicks to get there" and "time on the page" computable at all.
  session_id  text        NOT NULL,
  path        text        NOT NULL,
  -- The DESTINATIONS entry this path belongs to, when it is one. Null means a
  -- screen that is in the app but not in the menu OR search — worth knowing.
  dest_href   text,
  from_path   text,
  -- How they arrived. 'menu' vs 'spotlight' is the whole point: a page people
  -- reach by searching is a page the menu is hiding.
  nav_source  text        NOT NULL,
  -- Navigations since this tab landed. THE "clicks to get to that page".
  depth       smallint    NOT NULL DEFAULT 0,
  viewport    text,
  CONSTRAINT page_views_source_check CHECK (nav_source IN ('menu', 'spotlight', 'link', 'direct', 'back')),
  CONSTRAINT page_views_depth_check  CHECK (depth >= 0 AND depth < 1000),
  CONSTRAINT page_views_path_len     CHECK (length(path) <= 300),
  CONSTRAINT page_views_viewport_chk CHECK (viewport IS NULL OR viewport IN ('phone', 'desktop'))
);

COMMENT ON TABLE public."42.0_page_views" IS
  'One row per screen opened. Feeds /usage — which menu entries earn their place. Owner-read only; identity is stamped server-side.';

-- The dashboard asks three questions and these are them: a window of time, one
-- destination over that window, and a session in order.
CREATE INDEX IF NOT EXISTS page_views_at_idx      ON public."42.0_page_views" (viewed_at DESC);
CREATE INDEX IF NOT EXISTS page_views_dest_idx    ON public."42.0_page_views" (dest_href, viewed_at DESC);
CREATE INDEX IF NOT EXISTS page_views_session_idx ON public."42.0_page_views" (session_id, viewed_at);

-- ── 2. The client says WHERE; the database says WHO ──────────────────────────
CREATE OR REPLACE FUNCTION public.stamp_page_view()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  NEW.user_id := auth.uid();
  SELECT p.email, p.role INTO NEW.user_email, NEW.user_role
    FROM user_profiles p WHERE p.id = auth.uid();
  -- A signed-in user with no profile row should still be counted rather than
  -- rejected: losing the view is a worse outcome than an unlabelled one.
  NEW.user_email := COALESCE(NEW.user_email, '');
  NEW.user_role  := COALESCE(NEW.user_role, '');
  NEW.viewed_at  := now();
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.stamp_page_view() IS
  'Overwrites the identity and timestamp on every page view. A usage log a user can forge is not evidence.';

DROP TRIGGER IF EXISTS stamp_page_view_trigger ON public."42.0_page_views";
CREATE TRIGGER stamp_page_view_trigger
  BEFORE INSERT ON public."42.0_page_views"
  FOR EACH ROW EXECUTE FUNCTION public.stamp_page_view();

-- ── 3. Who may read it ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_view_usage()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner');
$function$;

COMMENT ON FUNCTION public.can_view_usage() IS
  'May read the page-view log. Owner only — it names who opened what.';

ALTER TABLE public."42.0_page_views" ENABLE ROW LEVEL SECURITY;

-- Everyone signed in writes their OWN trail, and only their own.
DROP POLICY IF EXISTS "page views insert" ON public."42.0_page_views";
CREATE POLICY "page views insert" ON public."42.0_page_views"
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "page views read" ON public."42.0_page_views";
CREATE POLICY "page views read" ON public."42.0_page_views"
  FOR SELECT TO authenticated
  USING (public.can_view_usage());

-- No UPDATE and no DELETE policy, on purpose: nobody edits or erases their own
-- trail, the owner included. Pruning goes through the function below, which is
-- a deliberate act with a number attached rather than a quiet DELETE.

-- ── 4. Retention ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prune_page_views(keep_days int DEFAULT 365)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  n integer;
BEGIN
  IF NOT public.can_view_usage() THEN
    RAISE EXCEPTION 'Only an Owner may prune the usage log.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF keep_days < 30 THEN
    RAISE EXCEPTION 'Keep at least 30 days — a shorter window cannot tell a quiet week from a dead page.'
      USING ERRCODE = 'check_violation';
  END IF;
  DELETE FROM public."42.0_page_views" WHERE viewed_at < now() - make_interval(days => keep_days);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

COMMENT ON FUNCTION public.prune_page_views(int) IS
  'Owner-only retention. 11 people generate a few thousand rows a month; a year of history is small and worth keeping.';

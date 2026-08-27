-- ============================================================================
-- ICAPROC — 10.5_quote_notes: the follow-up thread on an EPC proposal
--
-- The owner's ask (2026-08-27): "we can add addition notes or status that can
-- be written by users and it will show also on the list… like a chat thread in
-- Google Chat so you can clear it later and can see the time logs."
--
-- WHY A NEW TABLE, not one of the three things that already exist:
--   • `10.0_project_quotes.notes` is the proposal's OWN notes and is PRINTED
--     on the customer-facing document (22 of 36 proposals carry one). A
--     follow-up thread is internal; putting it there would print it.
--   • `10.3_quote_activity` is the machine audit log — action / actor / at,
--     470 rows written by the app, never by a person. Mixing typed notes into
--     it would pollute the audit trail and make "clear" meaningless.
--   • A single text column cannot hold a thread, and the owner asked for the
--     time log.
--
-- CLEARED, NEVER DELETED. `cleared_at` is what takes a note off the list; the
-- note itself stays in the thread with its timestamps, because the point of
-- the time log is that it survives being settled. There is deliberately no
-- DELETE policy.
--
-- Paste-ready and idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "10.5_quote_notes" (
  note_id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quote_id         uuid NOT NULL REFERENCES "10.0_project_quotes"(quote_id) ON DELETE CASCADE,
  body             text NOT NULL CHECK (btrim(body) <> ''),
  author_email     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  cleared_at       timestamptz,
  cleared_by_email text
);

-- The thread, newest first.
CREATE INDEX IF NOT EXISTS quote_notes_thread_idx
  ON "10.5_quote_notes" (quote_id, created_at DESC);
-- The list only ever asks for notes still open, so that question gets its own
-- (small) partial index rather than filtering the whole table.
CREATE INDEX IF NOT EXISTS quote_notes_open_idx
  ON "10.5_quote_notes" (quote_id, created_at DESC) WHERE cleared_at IS NULL;

ALTER TABLE "10.5_quote_notes" ENABLE ROW LEVEL SECURITY;

-- Reads mirror every other 10.x table: EPC-capable roles only, so a sell-side
-- login cannot pull proposal notes through the API.
DROP POLICY IF EXISTS "quote notes read" ON "10.5_quote_notes";
CREATE POLICY "quote notes read" ON "10.5_quote_notes"
  FOR SELECT TO authenticated USING (public.can_view_epc());

-- Writes are can_view_epc(), NOT can_edit_quote(). That is deliberate and is
-- the whole point of the feature: can_edit_quote() locks a SENT proposal to
-- owners, and a proposal that has been SENT is exactly the one somebody needs
-- to write "awaiting answer from the customer" against. Notes are about the
-- proposal, not its contents — they change nothing a customer ever sees.
DROP POLICY IF EXISTS "quote notes write" ON "10.5_quote_notes";
CREATE POLICY "quote notes write" ON "10.5_quote_notes"
  FOR INSERT TO authenticated WITH CHECK (public.can_view_epc());

-- Clearing (and un-clearing) a note is an UPDATE; same audience.
DROP POLICY IF EXISTS "quote notes clear" ON "10.5_quote_notes";
CREATE POLICY "quote notes clear" ON "10.5_quote_notes"
  FOR UPDATE TO authenticated USING (public.can_view_epc()) WITH CHECK (public.can_view_epc());

COMMENT ON TABLE "10.5_quote_notes" IS
  'Internal follow-up thread per EPC proposal. Never printed. cleared_at takes a note off the list without losing it.';

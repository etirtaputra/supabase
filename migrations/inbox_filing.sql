-- ICAPROC — the Inbox: duplicates, Drive filing, 30-day cleanup (2026-11-22)
--
-- Owner, 2026-11-22: *"MIRA files to Drive, do the photo shrinking and
-- cleanup"* and *"how will the Inbox and MIRA check for duplicates? This is
-- important."*
--
-- The Inbox is a WAITING ROOM, not an archive. The evidence lives in the
-- deal's Google Drive folder (MIRA's purchasing-sync runbook, §11). Once a
-- document became a deal, MIRA files it there and records where; 30 days
-- later the copy in Supabase storage is deleted (free plan: 1 GB in all).
-- A dismissed document is deleted 30 days after it was dismissed.
--
-- Declared in lib/lifecycles.ts as `inbox_file` (timestamps):
--   in ICAPROC → filed (filed_at, drive_url) → cleared (file_cleared_at)
--   dismissed (dismissed_at) → cleared
--
--   1. columns: dismissed_at, filed_at, filed_by_email, drive_url,
--      file_md5 (Drive's checksum — MIRA's upload script compares it before
--      every upload, so a file already on Drive is never uploaded again),
--      file_cleared_at
--   2. filed only once it is a deal; a Drive link is a Drive link
--   3. the same FILE twice is refused by the database, not only by the route
--      (two uploads at the same moment)
--
-- No new table or view, so no table GRANTs.

-- 1. Columns
ALTER TABLE public."43.0_inbox_items"
  ADD COLUMN IF NOT EXISTS dismissed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS filed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS filed_by_email  text,
  ADD COLUMN IF NOT EXISTS drive_url       text,
  ADD COLUMN IF NOT EXISTS file_md5        text,
  ADD COLUMN IF NOT EXISTS file_cleared_at timestamptz;

COMMENT ON COLUMN public."43.0_inbox_items".filed_at IS
  'When the document was filed in the deal''s Google Drive folder (MIRA, POST /api/agent/inbox/:id action=filed). The storage copy is deleted 30 days later.';
COMMENT ON COLUMN public."43.0_inbox_items".drive_url IS
  'The Drive file it was filed as (or the copy that was already there).';
COMMENT ON COLUMN public."43.0_inbox_items".file_md5 IS
  'md5 of the stored file, hex — what Google Drive reports as md5Checksum. The duplicate check before a Drive upload.';
COMMENT ON COLUMN public."43.0_inbox_items".file_cleared_at IS
  'When the copy in storage bucket `inbox` was deleted (GET /api/cron/inbox-cleanup). The row stays; the file lives in Drive.';

UPDATE public."43.0_inbox_items" SET dismissed_at = COALESCE(dismissed_at, received_at)
 WHERE status = 'dismissed' AND dismissed_at IS NULL;

-- 2. Rules the database keeps
ALTER TABLE public."43.0_inbox_items" DROP CONSTRAINT IF EXISTS inbox_item_filed_when_done;
ALTER TABLE public."43.0_inbox_items" ADD CONSTRAINT inbox_item_filed_when_done
  CHECK (filed_at IS NULL OR status = 'done');
ALTER TABLE public."43.0_inbox_items" DROP CONSTRAINT IF EXISTS inbox_item_drive_url_valid;
ALTER TABLE public."43.0_inbox_items" ADD CONSTRAINT inbox_item_drive_url_valid
  CHECK (drive_url IS NULL OR drive_url ~ '^https://(drive|docs)\.google\.com/');

-- 3. One row per file
DROP INDEX IF EXISTS public.inbox_items_sha;
CREATE UNIQUE INDEX IF NOT EXISTS inbox_items_sha_unique
  ON public."43.0_inbox_items" (file_sha256) WHERE file_sha256 IS NOT NULL;

-- The cleanup's question: what is still stored and may go?
CREATE INDEX IF NOT EXISTS inbox_items_to_clear
  ON public."43.0_inbox_items" (filed_at, dismissed_at) WHERE file_cleared_at IS NULL;

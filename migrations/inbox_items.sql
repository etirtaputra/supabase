-- ICAPROC — the Inbox: zero-entry ERP, first stream (2026-11-22)
--
-- Owner, 2026-11-22: *"Yes i love the zero-entry ERP, path of least
-- resistance. Let's make no. 1 happen first."* — the system reads the
-- documents that arrive and PROPOSES the record; a person confirms instead of
-- typing. First stream: a supplier's PI / quote → a deal (quote, + PO when it
-- is a PI). Channels: upload / photo in ICAPROC, MIRA (same API), and later a
-- forwarding email address.
--
-- One row per document that came in. The file itself lives in the private
-- storage bucket `inbox`; the row keeps what was read from it (`extracted`,
-- the reader's raw answer), what the system made of it (`proposal`, from
-- lib/inboxMatch.ts) and what it finally became (`quote_id` / `po_id`).
-- Status is declared in lib/lifecycles.ts as `inbox_item`:
--
--   received → proposed (read) | failed (could not read)
--   failed   → proposed (read again)
--   proposed → done (a person saved the deal it proposed) | dismissed
--   dismissed → proposed (put back)
--
-- Who: the buy side, as everywhere else for supplier documents —
-- can_read_buy_side() reads, can_write_buy_side() adds and updates. MIRA's
-- account is a buy-side account, so the same rule covers her.

CREATE TABLE IF NOT EXISTS public."43.0_inbox_items" (
  item_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at       timestamptz NOT NULL DEFAULT now(),
  received_by_email text,
  source            text NOT NULL DEFAULT 'upload',
  note              text,
  -- The document
  file_path         text NOT NULL,           -- in storage bucket `inbox`
  file_name         text NOT NULL,
  mime_type         text NOT NULL,
  file_bytes        integer,
  file_sha256       text,                    -- the same file twice is caught here
  -- What the system made of it
  status            text NOT NULL DEFAULT 'received',
  kind              text,                    -- supplier_pi | supplier_quote | supplier_po | payment_proof | invoice | delivery_note | other
  extracted         jsonb,
  proposal          jsonb,
  error             text,
  read_at           timestamptz,
  -- What it became
  quote_id          uuid REFERENCES public."4.0_price_quotes"(quote_id) ON DELETE SET NULL,
  po_id             uuid REFERENCES public."5.0_purchases"(po_id) ON DELETE SET NULL,
  done_at           timestamptz,
  done_by_email     text,
  dismissed_reason  text,
  CONSTRAINT inbox_item_source_valid CHECK (source IN ('upload', 'agent', 'email')),
  CONSTRAINT inbox_item_status_valid CHECK (status IN ('received', 'proposed', 'failed', 'done', 'dismissed'))
);

COMMENT ON TABLE public."43.0_inbox_items" IS
  'Zero-entry Inbox: one row per document that came in (upload, agent, email). The system reads it and proposes the record; a person confirms. Status = lifecycle inbox_item (lib/lifecycles.ts).';

CREATE INDEX IF NOT EXISTS inbox_items_status_received ON public."43.0_inbox_items" (status, received_at DESC);
CREATE INDEX IF NOT EXISTS inbox_items_sha ON public."43.0_inbox_items" (file_sha256);

ALTER TABLE public."43.0_inbox_items" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inbox read" ON public."43.0_inbox_items";
CREATE POLICY "inbox read" ON public."43.0_inbox_items"
  FOR SELECT TO authenticated USING (public.can_read_buy_side());
DROP POLICY IF EXISTS "inbox add" ON public."43.0_inbox_items";
CREATE POLICY "inbox add" ON public."43.0_inbox_items"
  FOR INSERT TO authenticated WITH CHECK (public.can_write_buy_side());
DROP POLICY IF EXISTS "inbox update" ON public."43.0_inbox_items";
CREATE POLICY "inbox update" ON public."43.0_inbox_items"
  FOR UPDATE TO authenticated USING (public.can_write_buy_side()) WITH CHECK (public.can_write_buy_side());

-- New tables carry their own grants (Supabase, from 2026-10-30). anon: none.
GRANT SELECT, INSERT, UPDATE, DELETE ON public."43.0_inbox_items" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."43.0_inbox_items" TO service_role;

-- The files: a private bucket, read and added by the buy side, never public,
-- never overwritten (no UPDATE policy). 20 MB, PDFs and photos only (the
-- formats Claude reads; an iPhone browser sends camera photos as JPEG).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('inbox', 'inbox', false, 20971520,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "inbox files read" ON storage.objects;
CREATE POLICY "inbox files read" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'inbox' AND public.can_read_buy_side());
DROP POLICY IF EXISTS "inbox files add" ON storage.objects;
CREATE POLICY "inbox files add" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'inbox' AND public.can_write_buy_side());

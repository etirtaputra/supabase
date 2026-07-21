-- ============================================================================
-- Sales-quote milestones: validated + revision tracking, sent stamp.
-- The lifecycle becomes:
--   draft → validated → sent → accepted → ordered (SO) → invoiced (INV)
--   → delivered (DO), with payments (26.0 receipts, RCPT-) recorded from
--   'ordered' onward; "complete" = delivered AND fully paid (derived).
-- "Revised" is a counter, not a status: revising a validated/sent quote
-- returns it to draft and bumps revision (stamped revised_at).
-- Document codes (stamped by trigger, already live):
--   SQ-YYYYMMDD-NNNN  quote        (on insert)
--   SO-YYYYMMDD-NNNN  sales order  (on → ordered)
--   INV-YYYYMMDD-NNNN invoice      (on → invoiced)
--   DO-YYYYMMDD-NNNN  delivery     (on → delivered)
--   RCPT-YYYYMMDD-NNNN customer receipt (on insert, 26.0)
-- Paste-ready, idempotent. Run in Supabase → SQL Editor.
-- ============================================================================

ALTER TABLE "22.0_sales_quotes" ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ;
ALTER TABLE "22.0_sales_quotes" ADD COLUMN IF NOT EXISTS sent_at      TIMESTAMPTZ;
ALTER TABLE "22.0_sales_quotes" ADD COLUMN IF NOT EXISTS accepted_at  TIMESTAMPTZ;
ALTER TABLE "22.0_sales_quotes" ADD COLUMN IF NOT EXISTS revision     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "22.0_sales_quotes" ADD COLUMN IF NOT EXISTS revised_at   TIMESTAMPTZ;

-- Re-issue the stamp trigger with the new milestone stamps
CREATE OR REPLACE FUNCTION public.stamp_sales_quote() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE actor TEXT; d TEXT := to_char(NOW(), 'YYYYMMDD');
BEGIN
  SELECT email INTO actor FROM user_profiles WHERE id = auth.uid();
  actor := COALESCE(actor, 'system');
  IF TG_OP = 'INSERT' THEN
    IF NEW.quote_number IS NULL OR NEW.quote_number = '' THEN
      NEW.quote_number := 'SQ-' || d || '-' || lpad(nextval('sales_quote_seq')::text, 4, '0');
    END IF;
    NEW.created_by_email := actor;
    NEW.updated_by_email := actor;
    NEW.created_at := COALESCE(NEW.created_at, NOW());
    NEW.updated_at := NOW();
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.updated_by_email := actor;
    NEW.updated_at := NOW();
    IF NEW.status = 'validated' AND OLD.status IS DISTINCT FROM 'validated' THEN
      NEW.validated_at := COALESCE(NEW.validated_at, NOW());
    END IF;
    IF NEW.status = 'sent' AND OLD.status IS DISTINCT FROM 'sent' THEN
      NEW.sent_at := COALESCE(NEW.sent_at, NOW());
    END IF;
    IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
      NEW.accepted_at := COALESCE(NEW.accepted_at, NOW());
    END IF;
    -- Revision bump (app sets revision = revision + 1 when revising)
    IF NEW.revision > COALESCE(OLD.revision, 0) THEN
      NEW.revised_at := NOW();
      -- A revised quote goes back through validation/sending: clear the
      -- downstream quote milestones so the timeline reflects the new revision
      NEW.validated_at := NULL;
      NEW.sent_at := NULL;
      NEW.accepted_at := NULL;
    END IF;
    IF NEW.status = 'ordered'   AND OLD.status IS DISTINCT FROM 'ordered' THEN
      IF COALESCE(NEW.order_number,'')   = '' THEN NEW.order_number   := 'SO-'  || d || '-' || lpad(nextval('sales_order_seq')::text, 4, '0');   END IF;
      NEW.ordered_at   := COALESCE(NEW.ordered_at, NOW());
    END IF;
    IF NEW.status = 'invoiced'  AND OLD.status IS DISTINCT FROM 'invoiced' THEN
      IF COALESCE(NEW.invoice_number,'') = '' THEN NEW.invoice_number := 'INV-' || d || '-' || lpad(nextval('sales_invoice_seq')::text, 4, '0'); END IF;
      NEW.invoiced_at  := COALESCE(NEW.invoiced_at, NOW());
    END IF;
    IF NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered' THEN
      IF COALESCE(NEW.do_number,'')      = '' THEN NEW.do_number      := 'DO-'  || d || '-' || lpad(nextval('sales_do_seq')::text, 4, '0');      END IF;
      NEW.delivered_at := COALESCE(NEW.delivered_at, NOW());
    END IF;
    IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, NOW());
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS stamp_sales_quote ON "22.0_sales_quotes";
CREATE TRIGGER stamp_sales_quote
  BEFORE INSERT OR UPDATE ON "22.0_sales_quotes"
  FOR EACH ROW EXECUTE FUNCTION public.stamp_sales_quote();

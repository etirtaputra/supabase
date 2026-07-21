-- ============================================================================
-- Delivery Order stage for sales quotes.
-- New status 'preparing' (label: "Preparing Items") sits between 'invoiced'
-- and 'delivered': "Create Delivery Order" stamps the DO number + delivery
-- instructions for the warehouse; "Mark Delivered" later completes the
-- delivery (stock-out happens then, as before).
-- New delivery fields captured when the DO is created:
--   delivery_date / delivery_time      target date + time of day
--   delivery_method                    'delivery' | 'pickup'
--   delivery_via                       courier / own fleet / customer truck…
--   delivery_address, delivery_map_url address + Google Maps link
--   delivery_contact                   contact person (name · phone snapshot)
-- Paste-ready, idempotent. Run in Supabase → SQL Editor.
-- ============================================================================

ALTER TABLE "22.0_sales_quotes" ADD COLUMN IF NOT EXISTS preparing_at     TIMESTAMPTZ;
ALTER TABLE "22.0_sales_quotes" ADD COLUMN IF NOT EXISTS delivery_date    DATE;
ALTER TABLE "22.0_sales_quotes" ADD COLUMN IF NOT EXISTS delivery_time    TEXT DEFAULT '';
ALTER TABLE "22.0_sales_quotes" ADD COLUMN IF NOT EXISTS delivery_method  TEXT DEFAULT '';
ALTER TABLE "22.0_sales_quotes" ADD COLUMN IF NOT EXISTS delivery_via     TEXT DEFAULT '';
ALTER TABLE "22.0_sales_quotes" ADD COLUMN IF NOT EXISTS delivery_address TEXT DEFAULT '';
ALTER TABLE "22.0_sales_quotes" ADD COLUMN IF NOT EXISTS delivery_map_url TEXT DEFAULT '';
ALTER TABLE "22.0_sales_quotes" ADD COLUMN IF NOT EXISTS delivery_contact TEXT DEFAULT '';

-- Re-issue the stamp trigger: DO number + preparing_at stamp on → preparing
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
    IF NEW.revision > COALESCE(OLD.revision, 0) THEN
      NEW.revised_at := NOW();
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
    -- Create Delivery Order → warehouse starts preparing; DO number stamps here
    IF NEW.status = 'preparing' AND OLD.status IS DISTINCT FROM 'preparing' THEN
      IF COALESCE(NEW.do_number,'')      = '' THEN NEW.do_number      := 'DO-'  || d || '-' || lpad(nextval('sales_do_seq')::text, 4, '0');      END IF;
      NEW.preparing_at := COALESCE(NEW.preparing_at, NOW());
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

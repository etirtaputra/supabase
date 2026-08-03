-- 22.3 Sales activity log — WHO did WHAT, WHEN, on a sales document.
-- Written by DATABASE TRIGGERS, not app code: a status change, revision,
-- invoice/DO create/delete, delivery, reopen or payment cannot happen without
-- leaving a row, whichever screen (or script) performed it.
-- Append-only: RLS exposes SELECT to signed-in users; the only write path is
-- the SECURITY DEFINER logger, and there are no UPDATE/DELETE policies.
-- Idempotent.

CREATE TABLE IF NOT EXISTS "22.3_sales_activity_log" (
  log_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id    uuid NOT NULL REFERENCES "22.0_sales_quotes"(quote_id) ON DELETE CASCADE,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_email text NOT NULL DEFAULT '',
  action      text NOT NULL,
  detail      text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_22_3_quote_at ON "22.3_sales_activity_log"(quote_id, at DESC);

ALTER TABLE "22.3_sales_activity_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sales log read" ON "22.3_sales_activity_log";
CREATE POLICY "sales log read" ON "22.3_sales_activity_log"
  FOR SELECT TO authenticated USING (true);
-- No INSERT/UPDATE/DELETE policies: rows arrive only via the definer function.

CREATE OR REPLACE FUNCTION log_sales_activity(p_quote uuid, p_action text, p_detail text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO "22.3_sales_activity_log"(quote_id, actor_email, action, detail)
  VALUES (p_quote, coalesce(auth.email(), 'system'), p_action, p_detail);
$$;

-- ── 22.0 order header: create / status transitions / revisions ──────────────
CREATE OR REPLACE FUNCTION trg_log_sales_quote() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM log_sales_activity(NEW.quote_id, 'created', coalesce(NEW.quote_number, ''));
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      PERFORM log_sales_activity(NEW.quote_id, 'status', OLD.status || ' → ' || NEW.status);
    END IF;
    IF coalesce(NEW.revision, 0) > coalesce(OLD.revision, 0) THEN
      PERFORM log_sales_activity(NEW.quote_id, 'revised', 'Rev ' || NEW.revision);
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS log_sales_quote ON "22.0_sales_quotes";
CREATE TRIGGER log_sales_quote AFTER INSERT OR UPDATE ON "22.0_sales_quotes"
  FOR EACH ROW EXECUTE FUNCTION trg_log_sales_quote();

-- ── 25.0 invoices: created / deleted ────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_log_sales_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM log_sales_activity(NEW.quote_id, 'invoice_created',
      coalesce(NEW.invoice_number, '') || ' · Rp ' || to_char(round(coalesce(NEW.grand_total, 0)), 'FM999G999G999G999'));
    RETURN NEW;
  ELSE
    PERFORM log_sales_activity(OLD.quote_id, 'invoice_deleted', coalesce(OLD.invoice_number, ''));
    RETURN OLD;
  END IF;
END $$;
DROP TRIGGER IF EXISTS log_sales_invoice ON "25.0_sales_invoices";
CREATE TRIGGER log_sales_invoice AFTER INSERT OR DELETE ON "25.0_sales_invoices"
  FOR EACH ROW EXECUTE FUNCTION trg_log_sales_invoice();

-- ── 24.0 delivery orders: created / delivered / reopened / deleted ──────────
CREATE OR REPLACE FUNCTION trg_log_sales_do() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM log_sales_activity(NEW.quote_id, 'do_created', coalesce(NEW.do_number, ''));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM log_sales_activity(OLD.quote_id, 'do_deleted', coalesce(OLD.do_number, ''));
    RETURN OLD;
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status = 'delivered' THEN
        PERFORM log_sales_activity(NEW.quote_id, 'do_delivered', coalesce(NEW.do_number, ''));
      ELSIF OLD.status = 'delivered' THEN
        PERFORM log_sales_activity(NEW.quote_id, 'do_reopened', coalesce(NEW.do_number, ''));
      ELSE
        PERFORM log_sales_activity(NEW.quote_id, 'status', coalesce(NEW.do_number, '') || ': ' || OLD.status || ' → ' || NEW.status);
      END IF;
    END IF;
    RETURN NEW;
  END IF;
END $$;
DROP TRIGGER IF EXISTS log_sales_do ON "24.0_delivery_orders";
CREATE TRIGGER log_sales_do AFTER INSERT OR UPDATE OR DELETE ON "24.0_delivery_orders"
  FOR EACH ROW EXECUTE FUNCTION trg_log_sales_do();

-- ── 26.0 receipts: recorded / removed ───────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_log_sales_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.quote_id IS NOT NULL THEN
      PERFORM log_sales_activity(NEW.quote_id, 'payment_recorded',
        coalesce(NEW.receipt_number, '') || ' · Rp ' || to_char(round(coalesce(NEW.amount, 0)), 'FM999G999G999G999'));
    END IF;
    RETURN NEW;
  ELSE
    IF OLD.quote_id IS NOT NULL THEN
      PERFORM log_sales_activity(OLD.quote_id, 'payment_removed',
        coalesce(OLD.receipt_number, '') || ' · Rp ' || to_char(round(coalesce(OLD.amount, 0)), 'FM999G999G999G999'));
    END IF;
    RETURN OLD;
  END IF;
END $$;
DROP TRIGGER IF EXISTS log_sales_receipt ON "26.0_customer_receipts";
CREATE TRIGGER log_sales_receipt AFTER INSERT OR DELETE ON "26.0_customer_receipts"
  FOR EACH ROW EXECUTE FUNCTION trg_log_sales_receipt();

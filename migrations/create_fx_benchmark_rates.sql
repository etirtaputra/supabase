-- ============================================================================
-- ICAPROC — 9.1_fx_benchmark_rates: the company's exchange rate per currency
--
-- The owner's ask (2026-10-23): "maybe we can set a universal exchange rate
-- for USD and CNY, in settings, and it will have logs of each which date
-- modified and so on. So when a new rate is used, it will only affect new
-- POs. Only then, we can compare what's the rates use during payment, vs. the
-- benchmark." Then: "make the fx benchmark in this thread".
--
-- One row per CHANGE. The log IS the table: the current rate of a currency is
-- its newest row, and "what was our rate on 13 Oct" is the newest row on or
-- before that day. A correction is a new row, never an edit — so there is no
-- UPDATE or DELETE for staff, and the history cannot be rewritten.
--
-- A PO keeps the rate it was saved with (5.0_purchases.exchange_rate);
-- changing the benchmark never touches an existing PO.
--
-- Not 9.0_exchange_rate_history: that is the old record of rates actually
-- PAID per PO (18 rows, unused by the app) — a different fact.
--
-- WHO and WHEN are stamped by the database, never by the browser.
-- Paste-ready and idempotent.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public."9.1_fx_benchmark_rates" (
  benchmark_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  currency      text NOT NULL CHECK (currency ~ '^[A-Z]{3}$' AND currency <> 'IDR'),
  rate          numeric NOT NULL CHECK (rate > 0),
  note          text NOT NULL DEFAULT '',
  set_at        timestamptz NOT NULL DEFAULT now(),
  set_by_email  text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS fx_benchmark_rates_currency_idx
  ON public."9.1_fx_benchmark_rates" (currency, set_at DESC);

ALTER TABLE public."9.1_fx_benchmark_rates" ENABLE ROW LEVEL SECURITY;

-- Read: whoever reads purchasing (the New Deal screen and the agents fill a
-- new PO's rate from it). Write: the owner — it is a company decision.
DROP POLICY IF EXISTS "fx benchmark read" ON public."9.1_fx_benchmark_rates";
CREATE POLICY "fx benchmark read" ON public."9.1_fx_benchmark_rates"
  FOR SELECT TO authenticated USING (public.can_read_buy_side());
DROP POLICY IF EXISTS "fx benchmark set" ON public."9.1_fx_benchmark_rates";
CREATE POLICY "fx benchmark set" ON public."9.1_fx_benchmark_rates"
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));

-- Supabase's default privileges may still hand a new table to anon; take them
-- back so the grants below are the whole list. Staff add rows, never change them.
REVOKE ALL ON public."9.1_fx_benchmark_rates" FROM anon;
REVOKE ALL ON public."9.1_fx_benchmark_rates" FROM authenticated;
GRANT SELECT, INSERT ON public."9.1_fx_benchmark_rates" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."9.1_fx_benchmark_rates" TO service_role;

COMMENT ON TABLE public."9.1_fx_benchmark_rates" IS
  'The company benchmark exchange rate per currency, as a log: newest row = current rate. New POs start from it; payments are compared against it. Rows are added, never edited.';

CREATE OR REPLACE FUNCTION public.stamp_fx_benchmark_rate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  actor text;
BEGIN
  SELECT email INTO actor FROM user_profiles WHERE id = auth.uid();
  NEW.set_by_email := COALESCE(actor, 'system');
  NEW.set_at       := now();
  NEW.currency     := upper(btrim(NEW.currency));
  NEW.note         := btrim(COALESCE(NEW.note, ''));
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS stamp_fx_benchmark_rate ON public."9.1_fx_benchmark_rates";
CREATE TRIGGER stamp_fx_benchmark_rate
  BEFORE INSERT ON public."9.1_fx_benchmark_rates"
  FOR EACH ROW EXECUTE FUNCTION public.stamp_fx_benchmark_rate();

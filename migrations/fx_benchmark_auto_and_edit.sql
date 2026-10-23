-- ============================================================================
-- ICAPROC — the company exchange rate: owner edits, and the daily KlikBCA check
--
-- Owner, 2026-10-24: "allow us to edit" (two notes said "TT Counter" where
-- they meant KlikBCA e-Rate), and: "use BCA e-Rate, warn above 1.5% … round
-- up to the nearest hundreds … Check daily every morning. and update itself."
--
-- 1. 9.1_fx_benchmark_rates becomes EDITABLE by the owner — rate and note
--    only. When it was set and by whom never change; every edit is stamped
--    (edited_at, edited_by_email) by the database, so a corrected row says so.
--    `source` tells a rate the owner typed from one the morning check set.
-- 2. 9.2_fx_reference_rates — what KlikBCA e-Rate said each morning (buy and
--    sell), one row per currency per day. Written only by the server job
--    (service role); read by whoever reads purchasing.
--
-- Paste-ready and idempotent.
-- ============================================================================
ALTER TABLE public."9.1_fx_benchmark_rates"
  ADD COLUMN IF NOT EXISTS source          text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS edited_at       timestamptz,
  ADD COLUMN IF NOT EXISTS edited_by_email text;

DROP POLICY IF EXISTS "fx benchmark edit" ON public."9.1_fx_benchmark_rates";
CREATE POLICY "fx benchmark edit" ON public."9.1_fx_benchmark_rates"
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));
GRANT UPDATE ON public."9.1_fx_benchmark_rates" TO authenticated;

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
  IF TG_OP = 'INSERT' THEN
    -- A signed-in person is stamped from their session. With no session the
    -- writer is the server job (service role — nobody else may insert), which
    -- names itself.
    NEW.set_by_email := COALESCE(actor, NULLIF(btrim(NEW.set_by_email), ''), 'system');
    NEW.set_at       := now();
    NEW.currency     := upper(btrim(NEW.currency));
    NEW.note         := btrim(COALESCE(NEW.note, ''));
    NEW.source       := CASE WHEN actor IS NOT NULL THEN 'manual' ELSE COALESCE(NULLIF(NEW.source, ''), 'system') END;
    NEW.edited_at := NULL; NEW.edited_by_email := NULL;
    RETURN NEW;
  END IF;
  -- UPDATE: the rate and the note may be corrected; when, who and how it was
  -- set never change.
  NEW.benchmark_id := OLD.benchmark_id; NEW.currency := OLD.currency;
  NEW.set_at := OLD.set_at; NEW.set_by_email := OLD.set_by_email; NEW.source := OLD.source;
  NEW.note := btrim(COALESCE(NEW.note, ''));
  IF NEW.rate IS DISTINCT FROM OLD.rate OR NEW.note IS DISTINCT FROM OLD.note THEN
    NEW.edited_at := now();
    NEW.edited_by_email := COALESCE(actor, 'system');
  ELSE
    NEW.edited_at := OLD.edited_at; NEW.edited_by_email := OLD.edited_by_email;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS stamp_fx_benchmark_rate ON public."9.1_fx_benchmark_rates";
CREATE TRIGGER stamp_fx_benchmark_rate
  BEFORE INSERT OR UPDATE ON public."9.1_fx_benchmark_rates"
  FOR EACH ROW EXECUTE FUNCTION public.stamp_fx_benchmark_rate();

CREATE TABLE IF NOT EXISTS public."9.2_fx_reference_rates" (
  reference_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rate_date    date NOT NULL,
  currency     text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  source       text NOT NULL DEFAULT 'KlikBCA e-Rate',
  buy          numeric CHECK (buy > 0),
  sell         numeric NOT NULL CHECK (sell > 0),
  quoted_at    text NOT NULL DEFAULT '',
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rate_date, currency, source)
);
ALTER TABLE public."9.2_fx_reference_rates" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fx reference read" ON public."9.2_fx_reference_rates";
CREATE POLICY "fx reference read" ON public."9.2_fx_reference_rates"
  FOR SELECT TO authenticated USING (public.can_read_buy_side());
REVOKE ALL ON public."9.2_fx_reference_rates" FROM anon;
REVOKE ALL ON public."9.2_fx_reference_rates" FROM authenticated;
GRANT SELECT ON public."9.2_fx_reference_rates" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."9.2_fx_reference_rates" TO service_role;
COMMENT ON TABLE public."9.2_fx_reference_rates" IS
  'What KlikBCA e-Rate said each morning (buy/sell per currency). Written only by /api/cron/fx-benchmark; the company rate follows it when it moves more than 1.5%.';

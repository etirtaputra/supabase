-- Structured warranty on the item master (owner's ask, 2026-08-06).
--
-- The legacy free-text `warranty` column stays for display fallback, but the
-- numbers After Sales computes with live in structured columns:
--   warranty_value / warranty_unit           = PRODUCT warranty (the claimable
--                                              clock After Sales runs on)
--   perf_warranty_value / perf_warranty_unit = PERFORMANCE warranty (PV modules:
--                                              output guarantee, e.g. 25 years —
--                                              informational, not a repair claim)
-- Units: 'years' (default in the UI) | 'months' | 'days'.
-- Idempotent: safe to re-run.

ALTER TABLE "3.0_components" ADD COLUMN IF NOT EXISTS warranty_value numeric;
ALTER TABLE "3.0_components" ADD COLUMN IF NOT EXISTS warranty_unit text;
ALTER TABLE "3.0_components" ADD COLUMN IF NOT EXISTS perf_warranty_value numeric;
ALTER TABLE "3.0_components" ADD COLUMN IF NOT EXISTS perf_warranty_unit text;

DO $$ BEGIN
  ALTER TABLE "3.0_components"
    ADD CONSTRAINT chk_warranty_unit CHECK (warranty_unit IS NULL OR warranty_unit IN ('years','months','days'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "3.0_components"
    ADD CONSTRAINT chk_perf_warranty_unit CHECK (perf_warranty_unit IS NULL OR perf_warranty_unit IN ('years','months','days'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Conservative backfill from the legacy text: only unambiguous "<number> <unit>"
-- values are parsed; anything else stays text-only until someone edits it.
UPDATE "3.0_components"
SET warranty_value = (regexp_match(warranty, '(\d+(?:[.,]\d+)?)'))[1]::numeric,
    warranty_unit  = 'years'
WHERE warranty_value IS NULL
  AND warranty ~* '^\s*\d+(?:[.,]\d+)?\s*(y|yr|yrs|year|years|tahun|thn)\s*$';

UPDATE "3.0_components"
SET warranty_value = (regexp_match(warranty, '(\d+(?:[.,]\d+)?)'))[1]::numeric,
    warranty_unit  = 'months'
WHERE warranty_value IS NULL
  AND warranty ~* '^\s*\d+(?:[.,]\d+)?\s*(m|mo|mos|month|months|bulan|bln)\s*$';

UPDATE "3.0_components"
SET warranty_value = (regexp_match(warranty, '(\d+(?:[.,]\d+)?)'))[1]::numeric,
    warranty_unit  = 'days'
WHERE warranty_value IS NULL
  AND warranty ~* '^\s*\d+(?:[.,]\d+)?\s*(d|day|days|hari)\s*$';

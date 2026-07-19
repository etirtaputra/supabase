'use client';
import { useEffect, useState } from 'react';
import { createSupabaseClient } from '@/lib/supabase';

// Full, idempotent schema for the project-quote feature. Safe to re-run.
const MIGRATION_SQL = `CREATE TABLE IF NOT EXISTS "10.0_project_quotes" (
  quote_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number TEXT NOT NULL DEFAULT '',
  quote_date DATE NOT NULL DEFAULT CURRENT_DATE,
  company_id UUID,
  customer_name TEXT DEFAULT '',
  customer_address TEXT DEFAULT '',
  project_description TEXT DEFAULT '',
  project_type TEXT DEFAULT 'custom',
  system_specs JSONB DEFAULT '{}',
  location TEXT DEFAULT '',
  ppn_pct NUMERIC(5,2) DEFAULT 11,
  status TEXT DEFAULT 'draft',
  notes TEXT DEFAULT '',
  group_margins JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE "10.0_project_quotes" ADD COLUMN IF NOT EXISTS company_id UUID;
ALTER TABLE "10.0_project_quotes" ADD COLUMN IF NOT EXISTS group_margins JSONB DEFAULT '{}';
ALTER TABLE "10.0_project_quotes" ADD COLUMN IF NOT EXISTS project_type TEXT DEFAULT 'custom';
ALTER TABLE "10.0_project_quotes" ADD COLUMN IF NOT EXISTS system_specs JSONB DEFAULT '{}';
ALTER TABLE "10.0_project_quotes" ADD COLUMN IF NOT EXISTS location TEXT DEFAULT '';
-- Stamped by the log_quote_activity trigger whenever status transitions to 'sent'
ALTER TABLE "10.0_project_quotes" ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS "10.1_quote_sections" (
  section_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES "10.0_project_quotes"(quote_id) ON DELETE CASCADE,
  group_key TEXT NOT NULL DEFAULT 'bos',
  title TEXT NOT NULL DEFAULT '',
  lead_time TEXT DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE "10.1_quote_sections" ADD COLUMN IF NOT EXISTS group_key TEXT NOT NULL DEFAULT 'bos';

CREATE TABLE IF NOT EXISTS "10.2_quote_items" (
  item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES "10.1_quote_sections"(section_id) ON DELETE CASCADE,
  quote_id UUID NOT NULL REFERENCES "10.0_project_quotes"(quote_id) ON DELETE CASCADE,
  parent_item_id UUID REFERENCES "10.2_quote_items"(item_id) ON DELETE CASCADE,
  component_id UUID,
  description TEXT NOT NULL DEFAULT '',
  brand TEXT DEFAULT '',
  quantity NUMERIC,
  qty_formula TEXT DEFAULT '',
  eng_note TEXT DEFAULT '',
  unit TEXT DEFAULT '',
  cost_price NUMERIC,
  sell_price NUMERIC,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE "10.2_quote_items" ADD COLUMN IF NOT EXISTS qty_formula TEXT DEFAULT '';
ALTER TABLE "10.2_quote_items" ADD COLUMN IF NOT EXISTS eng_note TEXT DEFAULT '';

-- Audit trail: who created / last edited each quote, plus an activity log
ALTER TABLE "10.0_project_quotes" ADD COLUMN IF NOT EXISTS created_by_email TEXT DEFAULT '';
ALTER TABLE "10.0_project_quotes" ADD COLUMN IF NOT EXISTS updated_by_email TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS "10.3_quote_activity" (
  activity_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quote_id UUID,                -- deliberately no FK: the log survives quote deletion
  quote_number TEXT DEFAULT '',
  action TEXT NOT NULL,         -- created | edited | status | deleted
  detail TEXT DEFAULT '',
  actor_email TEXT DEFAULT '',
  at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE "10.3_quote_activity" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "activity read" ON "10.3_quote_activity";
CREATE POLICY "activity read" ON "10.3_quote_activity" FOR SELECT TO authenticated USING (true);
-- no client insert/update/delete policies: only the trigger below writes

CREATE OR REPLACE FUNCTION public.log_quote_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE actor TEXT;
BEGIN
  SELECT email INTO actor FROM user_profiles WHERE id = auth.uid();
  actor := COALESCE(actor, 'system');
  IF TG_OP = 'INSERT' THEN
    -- Upserts fire INSERT triggers even on the conflict path; only a truly
    -- new row counts as "created"
    IF EXISTS (SELECT 1 FROM "10.0_project_quotes" WHERE quote_id = NEW.quote_id) THEN
      RETURN NEW;
    END IF;
    NEW.created_by_email := actor;
    NEW.updated_by_email := actor;
    IF NEW.status = 'sent' THEN NEW.sent_at := COALESCE(NEW.sent_at, NOW()); END IF;
    INSERT INTO "10.3_quote_activity"(quote_id, quote_number, action, actor_email)
      VALUES (NEW.quote_id, NEW.quote_number, 'created', actor);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.updated_by_email := actor;
    NEW.updated_at := NOW();
    -- Sent date: stamped on every transition into 'sent'
    IF NEW.status = 'sent' AND OLD.status IS DISTINCT FROM 'sent' THEN
      NEW.sent_at := NOW();
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO "10.3_quote_activity"(quote_id, quote_number, action, detail, actor_email)
        VALUES (NEW.quote_id, NEW.quote_number, 'status', OLD.status || ' -> ' || NEW.status, actor);
    ELSIF NOT EXISTS (
      -- throttle: autosave fires every 30s, one "edited" entry per editing
      -- session (same actor, last 10 minutes) is enough
      SELECT 1 FROM "10.3_quote_activity"
      WHERE quote_id = NEW.quote_id AND action = 'edited' AND actor_email = actor
        AND at > NOW() - INTERVAL '10 minutes'
    ) THEN
      INSERT INTO "10.3_quote_activity"(quote_id, quote_number, action, actor_email)
        VALUES (NEW.quote_id, NEW.quote_number, 'edited', actor);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO "10.3_quote_activity"(quote_id, quote_number, action, actor_email)
      VALUES (OLD.quote_id, OLD.quote_number, 'deleted', actor);
    RETURN OLD;
  END IF;
  RETURN NULL;
END $fn$;

DROP TRIGGER IF EXISTS log_quote_activity ON "10.0_project_quotes";
CREATE TRIGGER log_quote_activity
  BEFORE INSERT OR UPDATE OR DELETE ON "10.0_project_quotes"
  FOR EACH ROW EXECUTE FUNCTION public.log_quote_activity();

-- Description Library: curated item texts for the editor autocomplete,
-- managed on /quotes/library (read: everyone signed in; write: Owners)
CREATE TABLE IF NOT EXISTS "10.4_description_library" (
  entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description TEXT NOT NULL,
  brand TEXT DEFAULT '',
  unit TEXT DEFAULT '',
  group_key TEXT DEFAULT 'bos',
  section_title TEXT DEFAULT '',
  default_cost NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS description_library_unique
  ON "10.4_description_library" (lower(description));
ALTER TABLE "10.4_description_library" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "library read" ON "10.4_description_library";
CREATE POLICY "library read" ON "10.4_description_library"
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "library write" ON "10.4_description_library";
CREATE POLICY "library write" ON "10.4_description_library"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));

-- Cost Basis for Project Quotes (per-item mode + global safety buffer)
CREATE TABLE IF NOT EXISTS app_settings (
  key              TEXT PRIMARY KEY,
  value            TEXT NOT NULL DEFAULT '',
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_by_email TEXT DEFAULT ''
);
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app settings read" ON app_settings;
CREATE POLICY "app settings read" ON app_settings
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "app settings write" ON app_settings;
CREATE POLICY "app settings write" ON app_settings
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));
INSERT INTO app_settings (key, value) VALUES ('quote_cost_buffer_pct', '5')
  ON CONFLICT (key) DO NOTHING;
ALTER TABLE "3.0_components" ADD COLUMN IF NOT EXISTS quote_cost_mode TEXT NOT NULL DEFAULT 'buffered';
ALTER TABLE "3.0_components" ADD COLUMN IF NOT EXISTS quote_cost_buffer_pct NUMERIC;`;

/**
 * Probes the quote tables for the columns this build writes. Renders an
 * amber banner with copyable SQL when the database is behind the app.
 */
export default function MigrationBanner() {
  const supabase = createSupabaseClient();
  const [missing, setMissing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSql, setShowSql] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      const probes = await Promise.all([
        supabase.from('10.0_project_quotes').select('company_id, group_margins, project_type, system_specs, location, created_by_email, updated_by_email, sent_at').limit(1),
        supabase.from('10.1_quote_sections').select('group_key').limit(1),
        supabase.from('10.2_quote_items').select('qty_formula, eng_note').limit(1),
        supabase.from('10.3_quote_activity').select('activity_id').limit(1),
        supabase.from('10.4_description_library').select('entry_id').limit(1),
        // Cost Basis (migrations/add_cost_basis.sql)
        supabase.from('3.0_components').select('quote_cost_mode, quote_cost_buffer_pct').limit(1),
        supabase.from('app_settings').select('key, value').limit(1),
      ]);
      if (!cancelled && probes.some((p) => p.error)) setMissing(true);
    }
    check();
    return () => { cancelled = true; };
  }, []);

  if (!missing) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(MIGRATION_SQL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setShowSql(true);
    }
  }

  return (
    <div className="bg-amber-500/10 border border-amber-500/40 rounded-2xl p-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-amber-300 font-semibold">Database schema is out of date.</span>
        <span className="text-amber-200/80 text-xs">
          Saving and duplicating quotes will fail until the migration runs. Copy the SQL, then run it in
          Supabase → SQL Editor → New query.
        </span>
        <div className="flex gap-2 ml-auto">
          <button onClick={copy}
            className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-semibold transition-colors">
            {copied ? 'Copied ✓' : 'Copy SQL'}
          </button>
          <button onClick={() => setShowSql((v) => !v)}
            className="px-3 py-1.5 rounded-lg text-amber-300/70 hover:text-amber-200 text-xs transition-colors">
            {showSql ? 'Hide' : 'Show'} SQL
          </button>
        </div>
      </div>
      {showSql && (
        <pre className="mt-3 p-3 bg-black/30 rounded-xl text-[10px] leading-relaxed text-amber-100/80 overflow-x-auto max-h-64 overflow-y-auto select-all">
          {MIGRATION_SQL}
        </pre>
      )}
    </div>
  );
}

-- =====================================================
-- MATERIALIZED VIEW OPTIMIZATION - PHASE 2
-- =====================================================
-- Description: Set up automatic refresh for mv_component_analytics
-- Estimated time: 2-5 minutes
-- Impact: Consistent fast analytics queries
-- =====================================================

BEGIN;

-- =====================================================
-- 1. CREATE CONCURRENTLY-REFRESHABLE INDEX
-- =====================================================
-- For REFRESH MATERIALIZED VIEW CONCURRENTLY to work,
-- the materialized view needs a unique index

-- First, check if the materialized view exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_matviews
    WHERE schemaname = 'public'
      AND matviewname = 'mv_component_analytics'
  ) THEN
    RAISE NOTICE '✓ Found materialized view: mv_component_analytics';

    -- Create unique index if it doesn't exist
    IF NOT EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'mv_component_analytics'
        AND indexname = 'mv_component_analytics_unique_idx'
    ) THEN
      -- Assuming the view has component_id as a unique identifier
      -- Adjust this based on your actual view structure
      EXECUTE 'CREATE UNIQUE INDEX mv_component_analytics_unique_idx
               ON mv_component_analytics (component_id)';
      RAISE NOTICE '✓ Created unique index on mv_component_analytics';
    ELSE
      RAISE NOTICE '→ Unique index already exists';
    END IF;
  ELSE
    RAISE NOTICE '⚠ Materialized view mv_component_analytics not found';
    RAISE NOTICE '→ Create it first, then re-run this migration';
  END IF;
END $$;

-- =====================================================
-- 2. ENABLE PG_CRON EXTENSION
-- =====================================================
-- Note: pg_cron requires superuser privileges
-- If you can't enable it, use the Supabase Dashboard instead

CREATE EXTENSION IF NOT EXISTS pg_cron;

RAISE NOTICE '✓ pg_cron extension enabled (if available)';

-- =====================================================
-- 3. SCHEDULE AUTOMATIC REFRESH
-- =====================================================
-- Refresh daily at 1:00 AM UTC (adjust timezone as needed)

-- Remove existing schedule if it exists
SELECT cron.unschedule('refresh-component-analytics')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'refresh-component-analytics'
);

-- Schedule new refresh job
SELECT cron.schedule(
  'refresh-component-analytics',           -- Job name
  '0 1 * * *',                             -- Cron schedule: 1 AM daily
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_component_analytics$$
);

RAISE NOTICE '✓ Scheduled automatic refresh: Daily at 1:00 AM UTC';

-- =====================================================
-- 4. MANUAL REFRESH FUNCTION (ALTERNATIVE)
-- =====================================================
-- If pg_cron is not available, create a function to call manually
-- or via a serverless cron job (e.g., Vercel Cron, AWS EventBridge)

CREATE OR REPLACE FUNCTION refresh_component_analytics_mv()
RETURNS TEXT AS $$
BEGIN
  -- Refresh concurrently (doesn't lock the view)
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_component_analytics;

  RETURN 'Materialized view refreshed at ' || NOW()::TEXT;
EXCEPTION
  WHEN OTHERS THEN
    RETURN 'Error refreshing view: ' || SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION refresh_component_analytics_mv IS
  'Manually refresh mv_component_analytics. Call via API route or cron job.';

RAISE NOTICE '✓ Created manual refresh function: refresh_component_analytics_mv()';

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION refresh_component_analytics_mv() TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_component_analytics_mv() TO service_role;

-- =====================================================
-- 5. CREATE REFRESH HISTORY TABLE (OPTIONAL)
-- =====================================================
-- Track when the materialized view was last refreshed

CREATE TABLE IF NOT EXISTS materialized_view_refresh_log (
  id SERIAL PRIMARY KEY,
  view_name TEXT NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_ms INTEGER,
  row_count INTEGER,
  status TEXT NOT NULL DEFAULT 'success', -- success, error
  error_message TEXT
);

COMMENT ON TABLE materialized_view_refresh_log IS
  'Audit log for materialized view refresh operations';

CREATE INDEX IF NOT EXISTS idx_mv_log_view_time
  ON materialized_view_refresh_log(view_name, refreshed_at DESC);

-- Enhanced refresh function with logging
CREATE OR REPLACE FUNCTION refresh_component_analytics_mv_logged()
RETURNS TEXT AS $$
DECLARE
  start_time TIMESTAMPTZ;
  end_time TIMESTAMPTZ;
  duration INTEGER;
  row_count INTEGER;
  error_msg TEXT;
BEGIN
  start_time := clock_timestamp();

  -- Refresh the materialized view
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_component_analytics;

  end_time := clock_timestamp();
  duration := EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER;

  -- Get row count
  SELECT COUNT(*) INTO row_count FROM mv_component_analytics;

  -- Log the refresh
  INSERT INTO materialized_view_refresh_log (
    view_name,
    refreshed_at,
    duration_ms,
    row_count,
    status
  ) VALUES (
    'mv_component_analytics',
    end_time,
    duration,
    row_count,
    'success'
  );

  RETURN format(
    'View refreshed successfully in %s ms. Row count: %s',
    duration,
    row_count
  );

EXCEPTION
  WHEN OTHERS THEN
    error_msg := SQLERRM;

    -- Log the error
    INSERT INTO materialized_view_refresh_log (
      view_name,
      refreshed_at,
      status,
      error_message
    ) VALUES (
      'mv_component_analytics',
      NOW(),
      'error',
      error_msg
    );

    RETURN 'Error refreshing view: ' || error_msg;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION refresh_component_analytics_mv_logged() TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_component_analytics_mv_logged() TO service_role;

RAISE NOTICE '✓ Created logged refresh function: refresh_component_analytics_mv_logged()';

-- =====================================================
-- 6. VIEW FOR REFRESH STATUS
-- =====================================================

CREATE OR REPLACE VIEW v_materialized_view_status AS
SELECT
  view_name,
  MAX(refreshed_at) as last_refresh,
  NOW() - MAX(refreshed_at) as age,
  MAX(duration_ms) FILTER (WHERE refreshed_at = (SELECT MAX(refreshed_at) FROM materialized_view_refresh_log WHERE view_name = mvrl.view_name)) as last_duration_ms,
  MAX(row_count) FILTER (WHERE refreshed_at = (SELECT MAX(refreshed_at) FROM materialized_view_refresh_log WHERE view_name = mvrl.view_name)) as last_row_count,
  COUNT(*) FILTER (WHERE status = 'success') as success_count,
  COUNT(*) FILTER (WHERE status = 'error') as error_count,
  MAX(error_message) FILTER (WHERE status = 'error' AND refreshed_at = (SELECT MAX(refreshed_at) FROM materialized_view_refresh_log WHERE view_name = mvrl.view_name AND status = 'error')) as last_error
FROM materialized_view_refresh_log mvrl
GROUP BY view_name;

COMMENT ON VIEW v_materialized_view_status IS
  'Shows status and refresh history of materialized views';

GRANT SELECT ON v_materialized_view_status TO authenticated;

RAISE NOTICE '✓ Created status view: v_materialized_view_status';

-- =====================================================
-- VERIFICATION & INITIAL REFRESH
-- =====================================================

-- Perform initial refresh
SELECT refresh_component_analytics_mv_logged();

-- Show status
DO $$
DECLARE
  last_refresh TIMESTAMPTZ;
  row_count INTEGER;
BEGIN
  SELECT MAX(refreshed_at), MAX(row_count)
  INTO last_refresh, row_count
  FROM materialized_view_refresh_log
  WHERE view_name = 'mv_component_analytics';

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'MATERIALIZED VIEW SETUP COMPLETE';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Last refreshed: %', COALESCE(last_refresh::TEXT, 'Never');
  RAISE NOTICE 'Row count: %', COALESCE(row_count::TEXT, 'Unknown');
  RAISE NOTICE '';
  RAISE NOTICE 'REFRESH OPTIONS:';
  RAISE NOTICE '1. Automatic: Daily at 1 AM UTC (pg_cron)';
  RAISE NOTICE '2. Manual: SELECT refresh_component_analytics_mv();';
  RAISE NOTICE '3. Manual with logging: SELECT refresh_component_analytics_mv_logged();';
  RAISE NOTICE '';
  RAISE NOTICE 'CHECK STATUS: SELECT * FROM v_materialized_view_status;';
  RAISE NOTICE '========================================';
END $$;

COMMIT;

-- =====================================================
-- USAGE EXAMPLES
-- =====================================================

/*
-- Check refresh status
SELECT * FROM v_materialized_view_status;

-- Manually trigger refresh
SELECT refresh_component_analytics_mv_logged();

-- View refresh history
SELECT
  refreshed_at,
  duration_ms,
  row_count,
  status,
  error_message
FROM materialized_view_refresh_log
WHERE view_name = 'mv_component_analytics'
ORDER BY refreshed_at DESC
LIMIT 10;

-- Check current cron jobs (if pg_cron is enabled)
SELECT * FROM cron.job;

-- Disable automatic refresh
SELECT cron.unschedule('refresh-component-analytics');

-- Change refresh schedule (e.g., every 6 hours)
SELECT cron.unschedule('refresh-component-analytics');
SELECT cron.schedule(
  'refresh-component-analytics',
  '0 */6 * * *',  -- Every 6 hours
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_component_analytics$$
);
*/

-- =====================================================
-- API ROUTE INTEGRATION (Next.js)
-- =====================================================

/*
// Create a new file: app/api/refresh-analytics/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  // Verify secret token (important for security!)
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    const { data, error } = await supabase.rpc('refresh_component_analytics_mv_logged');

    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: data
    });
  } catch (error) {
    console.error('Refresh error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// Then set up a cron job (e.g., Vercel Cron):
// vercel.json:
{
  "crons": [{
    "path": "/api/refresh-analytics",
    "schedule": "0 1 * * *"
  }]
}
*/

-- =====================================================
-- ROLLBACK SCRIPT
-- =====================================================

/*
BEGIN;

-- Unschedule cron job
SELECT cron.unschedule('refresh-component-analytics');

-- Drop functions
DROP FUNCTION IF EXISTS refresh_component_analytics_mv();
DROP FUNCTION IF EXISTS refresh_component_analytics_mv_logged();

-- Drop view and table
DROP VIEW IF EXISTS v_materialized_view_status;
DROP TABLE IF EXISTS materialized_view_refresh_log;

-- Drop unique index
DROP INDEX IF EXISTS mv_component_analytics_unique_idx;

COMMIT;
*/

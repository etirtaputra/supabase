-- ============================================================================
-- FIX: Replace refresh_analytics_view() function to handle missing MV
-- ============================================================================
-- Run this BEFORE the main migration to fix the trigger issue

-- Replace the function to be more resilient
CREATE OR REPLACE FUNCTION refresh_analytics_view()
RETURNS TRIGGER AS $$
BEGIN
  -- Only refresh if the materialized view exists
  IF EXISTS (
    SELECT 1 FROM pg_matviews
    WHERE schemaname = 'public'
    AND matviewname = 'mv_component_analytics'
  ) THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_component_analytics";
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Verify function was updated
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name = 'refresh_analytics_view';

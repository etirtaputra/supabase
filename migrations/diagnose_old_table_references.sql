-- ============================================================================
-- DIAGNOSE: Find ALL references to old table name "6.0_purchases"
-- ============================================================================
-- This query will find every database object that references the old table

-- Check for triggers
SELECT
  'TRIGGER' as object_type,
  trigger_name as name,
  event_object_table as table_name,
  action_statement as definition
FROM information_schema.triggers
WHERE action_statement LIKE '%6.0_purchases%'
   OR action_statement LIKE '%6.1_purchase%';

-- Check for RLS policies
SELECT
  'RLS POLICY' as object_type,
  schemaname,
  tablename,
  policyname as name,
  qual as definition
FROM pg_policies
WHERE qual LIKE '%6.0_purchases%'
   OR qual LIKE '%6.1_purchase%';

-- Check for check constraints
SELECT
  'CHECK CONSTRAINT' as object_type,
  conname as name,
  conrelid::regclass as table_name,
  pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE contype = 'c'
  AND pg_get_constraintdef(oid) LIKE '%6.0_purchases%'
   OR pg_get_constraintdef(oid) LIKE '%6.1_purchase%';

-- Check for foreign keys still pointing to old table
SELECT
  'FOREIGN KEY' as object_type,
  conname as name,
  conrelid::regclass as table_name,
  confrelid::regclass as referenced_table,
  pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE contype = 'f'
  AND (confrelid::regclass::text = '6.0_purchases'
       OR confrelid::regclass::text = '6.1_purchase_line_items');

-- Check for functions
SELECT
  'FUNCTION' as object_type,
  routine_name as name,
  routine_definition as definition
FROM information_schema.routines
WHERE routine_definition LIKE '%6.0_purchases%'
   OR routine_definition LIKE '%6.1_purchase%';

-- Check for views
SELECT
  'VIEW' as object_type,
  table_name as name,
  view_definition as definition
FROM information_schema.views
WHERE view_definition LIKE '%6.0_purchases%'
   OR view_definition LIKE '%6.1_purchase%';

-- ============================================================================
-- DEPENDENCY ANALYSIS: Check cascading effects before merging tables
-- ============================================================================

-- Check what references 5.0_proforma_invoices
SELECT
  'Foreign Keys to Proforma Invoices' as check_type,
  tc.table_name as referencing_table,
  kcu.column_name as referencing_column,
  ccu.table_name as referenced_table,
  ccu.column_name as referenced_column
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_name = '5.0_proforma_invoices';

-- Check what references 7.0_payment_details
SELECT
  'Foreign Keys to Payment Details' as check_type,
  tc.table_name as referencing_table,
  kcu.column_name as referencing_column,
  ccu.table_name as referenced_table,
  ccu.column_name as referenced_column
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_name = '7.0_payment_details';

-- Check what references 7.1_landed_costs
SELECT
  'Foreign Keys to Landed Costs' as check_type,
  tc.table_name as referencing_table,
  kcu.column_name as referencing_column,
  ccu.table_name as referenced_table,
  ccu.column_name as referenced_column
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_name = '7.1_landed_costs';

-- Check views that depend on these tables
SELECT
  'Views Depending on Proforma Invoices' as check_type,
  view_name,
  view_definition
FROM information_schema.views
WHERE table_schema = 'public'
  AND view_definition ILIKE '%5.0_proforma_invoices%'
  OR view_definition ILIKE '%proforma_invoices%';

SELECT
  'Views Depending on Payment Details' as check_type,
  view_name,
  view_definition
FROM information_schema.views
WHERE table_schema = 'public'
  AND (view_definition ILIKE '%7.0_payment_details%'
  OR view_definition ILIKE '%payment_details%');

SELECT
  'Views Depending on Landed Costs' as check_type,
  view_name,
  view_definition
FROM information_schema.views
WHERE table_schema = 'public'
  AND (view_definition ILIKE '%7.1_landed_costs%'
  OR view_definition ILIKE '%landed_costs%');

-- Check columns in each table to plan merge
SELECT
  '5.0_proforma_invoices columns' as table_info,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = '5.0_proforma_invoices'
ORDER BY ordinal_position;

SELECT
  '6.0_purchases columns' as table_info,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = '6.0_purchases'
ORDER BY ordinal_position;

SELECT
  '7.0_payment_details columns' as table_info,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = '7.0_payment_details'
ORDER BY ordinal_position;

SELECT
  '7.1_landed_costs columns' as table_info,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = '7.1_landed_costs'
ORDER BY ordinal_position;

-- Check current record counts
SELECT '5.0_proforma_invoices' as table_name, COUNT(*) as record_count FROM "5.0_proforma_invoices"
UNION ALL
SELECT '6.0_purchases' as table_name, COUNT(*) as record_count FROM "6.0_purchases"
UNION ALL
SELECT '7.0_payment_details' as table_name, COUNT(*) as record_count FROM "7.0_payment_details"
UNION ALL
SELECT '7.1_landed_costs' as table_name, COUNT(*) as record_count FROM "7.1_landed_costs";

-- Check for triggers on these tables
SELECT
  event_object_table as table_name,
  trigger_name,
  event_manipulation,
  action_statement
FROM information_schema.triggers
WHERE event_object_table IN (
  '5.0_proforma_invoices',
  '7.0_payment_details',
  '7.1_landed_costs'
)
ORDER BY event_object_table, trigger_name;

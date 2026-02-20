-- ============================================================================
-- CHECK AND REASSIGN H1Z2Z2-K CABLE COMPONENTS IN QUOTES AND POS
-- ============================================================================
-- Checks which quotes/POs use the 3 cable components and reassigns to branded versions
-- ============================================================================

-- Component IDs to check:
-- 158be204-ca07-4013-9604-b24d2c157455
-- 6e550bea-e223-481f-a95e-2050c634d7d0
-- 03e730c3-f81b-4204-9356-81f8fa23e058

-- ============================================================================
-- STEP 1: CHECK USAGE IN QUOTES
-- ============================================================================

SELECT
  q.quote_id,
  q.pi_number,
  q.quote_date,
  q.supplier_id,
  s.supplier_name,

  qli.component_id,
  c.brand AS current_brand,
  c.supplier_model,

  qli.quantity,
  qli.unit_price,

  COUNT(*) OVER (PARTITION BY q.quote_id) AS total_line_items_in_quote

FROM "4.0_price_quotes" q
LEFT JOIN "2.0_suppliers" s ON q.supplier_id = s.supplier_id
INNER JOIN "4.1_price_quote_line_items" qli ON q.quote_id = qli.quote_id
INNER JOIN "3.0_components" c ON qli.component_id = c.component_id

WHERE qli.component_id IN (
  '158be204-ca07-4013-9604-b24d2c157455',
  '6e550bea-e223-481f-a95e-2050c634d7d0',
  '03e730c3-f81b-4204-9356-81f8fa23e058'
)

ORDER BY q.quote_date DESC, q.quote_id;


-- ============================================================================
-- STEP 2: CHECK USAGE IN PURCHASE ORDERS
-- ============================================================================

SELECT
  p.po_id,
  p.po_number,
  p.po_date,
  p.supplier_id,
  s.supplier_name,

  pli.component_id,
  c.brand AS current_brand,
  c.supplier_model,

  pli.quantity,
  pli.unit_cost,

  COUNT(*) OVER (PARTITION BY p.po_id) AS total_line_items_in_po

FROM "5.0_purchases" p
LEFT JOIN "2.0_suppliers" s ON p.supplier_id = s.supplier_id
INNER JOIN "5.1_purchase_line_items" pli ON p.po_id = pli.po_id
INNER JOIN "3.0_components" c ON pli.component_id = c.component_id

WHERE pli.component_id IN (
  '158be204-ca07-4013-9604-b24d2c157455',
  '6e550bea-e223-481f-a95e-2050c634d7d0',
  '03e730c3-f81b-4204-9356-81f8fa23e058'
)

ORDER BY p.po_date DESC, p.po_id;


-- ============================================================================
-- STEP 3: SUMMARY - Count usage
-- ============================================================================

SELECT
  c.component_id,
  c.brand,
  c.supplier_model,

  (SELECT COUNT(*)
   FROM "4.1_price_quote_line_items" qli
   WHERE qli.component_id = c.component_id) AS used_in_quotes,

  (SELECT COUNT(DISTINCT quote_id)
   FROM "4.1_price_quote_line_items" qli
   WHERE qli.component_id = c.component_id) AS unique_quotes,

  (SELECT COUNT(*)
   FROM "5.1_purchase_line_items" pli
   WHERE pli.component_id = c.component_id) AS used_in_pos,

  (SELECT COUNT(DISTINCT po_id)
   FROM "5.1_purchase_line_items" pli
   WHERE pli.component_id = c.component_id) AS unique_pos

FROM "3.0_components" c

WHERE c.component_id IN (
  '158be204-ca07-4013-9604-b24d2c157455',
  '6e550bea-e223-481f-a95e-2050c634d7d0',
  '03e730c3-f81b-4204-9356-81f8fa23e058'
)

ORDER BY c.component_id;


-- ============================================================================
-- STEP 4: SHOW AVAILABLE BRANDED VERSIONS
-- ============================================================================

-- Show what branded versions exist for reassignment
SELECT
  c.component_id,
  c.brand,
  c.supplier_model,
  c.internal_description,
  c.category
FROM "3.0_components" c
WHERE c.brand IN ('SUNTREE', 'SLOCABLE', 'JJLAPP', 'JEMBO', 'SUPREME', 'SUNKEAN')
  AND (
    c.supplier_model LIKE '%H1Z2Z2-K%'
    OR c.internal_description LIKE '%H1Z2Z2-K%'
    OR c.supplier_model LIKE '%Cable%'
  )
ORDER BY c.brand, c.supplier_model;


-- ============================================================================
-- STEP 5: PREVIEW REASSIGNMENT BY SUPPLIER
-- ============================================================================

-- Show which branded component each quote/PO should use based on supplier
WITH quote_usage AS (
  SELECT
    q.quote_id,
    q.pi_number,
    s.supplier_name,
    qli.component_id AS current_component_id,
    c.supplier_model AS current_supplier_model,

    -- Determine target brand based on supplier name
    CASE
      WHEN LOWER(s.supplier_name) LIKE '%trisindo%' THEN 'SUNKEAN'
      WHEN LOWER(s.supplier_name) LIKE '%solar jaya%' THEN 'SUNKEAN'
      WHEN LOWER(s.supplier_name) LIKE '%persada%' THEN 'JEMBO'
      WHEN LOWER(s.supplier_name) LIKE '%supreme%' THEN 'SUPREME'
      WHEN LOWER(s.supplier_name) LIKE '%suntree%' THEN 'SUNTREE'
      WHEN LOWER(s.supplier_name) LIKE '%slocable%' THEN 'SLOCABLE'
      WHEN LOWER(s.supplier_name) LIKE '%jjlapp%' THEN 'JJLAPP'
      ELSE 'UNKNOWN'
    END AS target_brand

  FROM "4.0_price_quotes" q
  LEFT JOIN "2.0_suppliers" s ON q.supplier_id = s.supplier_id
  INNER JOIN "4.1_price_quote_line_items" qli ON q.quote_id = qli.quote_id
  INNER JOIN "3.0_components" c ON qli.component_id = c.component_id

  WHERE qli.component_id IN (
    '158be204-ca07-4013-9604-b24d2c157455',
    '6e550bea-e223-481f-a95e-2050c634d7d0',
    '03e730c3-f81b-4204-9356-81f8fa23e058'
  )
)
SELECT
  qu.quote_id,
  qu.pi_number,
  qu.supplier_name,
  qu.target_brand,
  qu.current_supplier_model,

  -- Find matching branded component
  bc.component_id AS branded_component_id,
  bc.supplier_model AS branded_supplier_model,

  CASE
    WHEN bc.component_id IS NULL THEN '❌ No branded component found'
    ELSE '✅ Ready to reassign'
  END AS status

FROM quote_usage qu
LEFT JOIN "3.0_components" bc
  ON bc.brand = qu.target_brand
  AND bc.supplier_model LIKE '%H1Z2Z2-K%'

ORDER BY qu.supplier_name, qu.quote_id;


-- ============================================================================
-- STEP 6: EXECUTE REASSIGNMENT (MANUAL - Specify target brand)
-- ============================================================================

-- Example: Reassign to SUNKEAN for PT Trisindo Solar Jaya quotes
-- Modify the target_brand and supplier name filter as needed

/*
BEGIN;

UPDATE "4.1_price_quote_line_items" qli
SET
  component_id = bc.component_id,
  updated_at = NOW()
FROM "4.0_price_quotes" q
LEFT JOIN "2.0_suppliers" s ON q.supplier_id = s.supplier_id
INNER JOIN "3.0_components" bc ON bc.brand = 'SUNKEAN'  -- Change target brand here
WHERE qli.quote_id = q.quote_id
  AND qli.component_id IN (
    '158be204-ca07-4013-9604-b24d2c157455',
    '6e550bea-e223-481f-a95e-2050c634d7d0',
    '03e730c3-f81b-4204-9356-81f8fa23e058'
  )
  AND LOWER(s.supplier_name) LIKE '%trisindo%'  -- Change supplier filter here
  AND bc.supplier_model LIKE '%H1Z2Z2-K%';

-- Show updated count
SELECT COUNT(*) AS updated_line_items
FROM "4.1_price_quote_line_items"
WHERE updated_at > NOW() - INTERVAL '1 minute';

COMMIT;
-- Or ROLLBACK if something looks wrong
*/


-- ============================================================================
-- STEP 7: VERIFY REASSIGNMENT
-- ============================================================================

-- After reassignment, check what brands are now being used
SELECT
  s.supplier_name,
  c.brand,
  c.supplier_model,
  COUNT(*) AS line_item_count
FROM "4.0_price_quotes" q
LEFT JOIN "2.0_suppliers" s ON q.supplier_id = s.supplier_id
INNER JOIN "4.1_price_quote_line_items" qli ON q.quote_id = qli.quote_id
INNER JOIN "3.0_components" c ON qli.component_id = c.component_id
WHERE c.brand IN ('SUNTREE', 'SLOCABLE', 'JJLAPP', 'JEMBO', 'SUPREME', 'SUNKEAN')
  AND (c.supplier_model LIKE '%H1Z2Z2-K%' OR c.supplier_model LIKE '%Cable%')
GROUP BY s.supplier_name, c.brand, c.supplier_model
ORDER BY s.supplier_name, c.brand;

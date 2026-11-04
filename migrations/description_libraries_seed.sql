-- Seed the description libraries from the wordings already used (owner, 2026-11-04:
-- "yes ... seed the EPC library from the ~520 wordings already used, duplicates merged").
--
-- One entry per normalised wording (lib_norm: case, punctuation, spacing): the
-- spelling used most (newest on a tie), the commonest brand and unit, and for
-- EPC the commonest section group/title. Approved — they are history, not new
-- proposals. Every free-text line is then linked to its entry by setting
-- library_entry_id only, so no line text changes and no trigger fires.
-- Measured before: 537 EPC spellings → 520 entries, 2,483 lines; Sales 9 → 9.

WITH f AS (
  SELECT i.description, i.brand, i.unit, i.section_id, i.created_at, public.lib_norm(i.description) AS k
    FROM "10.2_quote_items" i
   WHERE i.component_id IS NULL AND length(public.lib_norm(i.description)) >= 3),
v AS (SELECT k, btrim(description) AS d, count(*) AS n, max(created_at) AS last FROM f GROUP BY k, btrim(description)),
canon AS (SELECT DISTINCT ON (k) k, d FROM v ORDER BY k, n DESC, last DESC),
attrs AS (SELECT k, coalesce(mode() WITHIN GROUP (ORDER BY NULLIF(btrim(brand), '')), '') AS brand,
                    coalesce(mode() WITHIN GROUP (ORDER BY NULLIF(btrim(unit), '')), '') AS unit
            FROM f GROUP BY k),
sec AS (SELECT f.k, mode() WITHIN GROUP (ORDER BY s.group_key) AS g, coalesce(mode() WITHIN GROUP (ORDER BY s.title), '') AS t
          FROM f JOIN "10.1_quote_sections" s ON s.section_id = f.section_id GROUP BY f.k)
INSERT INTO "10.4_description_library"(description, brand, unit, group_key, section_title, status,
                                       created_by_email, updated_by_email, reviewed_at, reviewed_by_email)
SELECT c.d, a.brand, a.unit, s.g, coalesce(s.t, ''), 'approved', 'seed', 'seed', now(), 'seed'
  FROM canon c JOIN attrs a USING (k) LEFT JOIN sec s USING (k)
ON CONFLICT DO NOTHING;

UPDATE "10.2_quote_items" i SET library_entry_id = l.entry_id
  FROM "10.4_description_library" l
 WHERE i.component_id IS NULL AND l.archived_at IS NULL AND l.norm_key = public.lib_norm(i.description)
   AND i.library_entry_id IS DISTINCT FROM l.entry_id;

WITH f AS (
  SELECT i.description, i.brand, i.unit, i.unit_price, i.created_at, public.lib_norm(i.description) AS k,
         CASE WHEN q.case_id IS NOT NULL THEN 'aftersales' ELSE 'sales' END AS sect
    FROM "22.1_sales_quote_items" i JOIN "22.0_sales_quotes" q ON q.quote_id = i.quote_id
   WHERE i.component_id IS NULL AND NOT coalesce(i.is_section, false) AND length(public.lib_norm(i.description)) >= 3),
v AS (SELECT sect, k, btrim(description) AS d, count(*) AS n, max(created_at) AS last FROM f GROUP BY sect, k, btrim(description)),
canon AS (SELECT DISTINCT ON (sect, k) sect, k, d FROM v ORDER BY sect, k, n DESC, last DESC),
attrs AS (SELECT sect, k, coalesce(mode() WITHIN GROUP (ORDER BY NULLIF(btrim(brand), '')), '') AS brand,
                 coalesce(mode() WITHIN GROUP (ORDER BY NULLIF(btrim(unit), '')), '') AS unit,
                 (array_agg(unit_price ORDER BY created_at DESC) FILTER (WHERE unit_price > 0))[1] AS price
            FROM f GROUP BY sect, k)
INSERT INTO "22.2_sales_description_library"(description, brand, unit, default_price, section, status,
                                             created_by_email, updated_by_email, reviewed_at, reviewed_by_email)
SELECT c.d, a.brand, a.unit, a.price, c.sect, 'approved', 'seed', 'seed', now(), 'seed'
  FROM canon c JOIN attrs a USING (sect, k)
ON CONFLICT DO NOTHING;

UPDATE "22.1_sales_quote_items" i SET library_entry_id = l.entry_id
  FROM "22.0_sales_quotes" q, "22.2_sales_description_library" l
 WHERE q.quote_id = i.quote_id AND i.component_id IS NULL AND NOT coalesce(i.is_section, false)
   AND l.archived_at IS NULL AND l.norm_key = public.lib_norm(i.description)
   AND coalesce(l.section, 'sales') = CASE WHEN q.case_id IS NOT NULL THEN 'aftersales' ELSE 'sales' END
   AND i.library_entry_id IS DISTINCT FROM l.entry_id;

-- The seed itself is in the log, so the libraries' history starts at their first entry.
SELECT public.lib_log('epc', 'create', array_agg(entry_id),
  format('Seeded %s entries from the wordings already used in EPC proposals', count(*)),
  jsonb_build_object('seed', true))
  FROM "10.4_description_library" WHERE created_by_email = 'seed';
SELECT public.lib_log('sales', 'create', array_agg(entry_id),
  format('Seeded %s entries from the custom lines already used in sales quotes', count(*)),
  jsonb_build_object('seed', true))
  FROM "22.2_sales_description_library" WHERE created_by_email = 'seed';

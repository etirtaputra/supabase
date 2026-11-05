-- Description libraries clean-up (owner, 2026-11-04: "yes to all three, go
-- ahead" — the review's build order ended with "link the lines that are really
-- catalogue items; add the main components to the catalogue").
--
-- Main components (panels, inverters, batteries) typed as free text have no
-- supplier price history: "those are items we would like to monitor for its
-- prices". So:
--   1. Seven main components that were only ever free text become catalogue
--      items (Item Editor). Only those with a stated model code; generic
--      wordings ("Canadian Solar 320Wp", "Goodwe Hybrid Inverter 10kw",
--      "Battery Pack Lithium 51,2V 100Ah") stay free text for the owner.
--   2. Their proposal lines, and the lines whose wording IS an existing
--      catalogue item (45 lines, e.g. "ICA Solar SNV-GF1021 1kW/24V" ×29),
--      are linked to the item. The WORDING of every line is left as it is —
--      sent proposals read exactly as the customer received them.
--   3. The library entries those lines came from now have no lines, so they
--      are archived, logged in 10.5_library_log (Undo puts them back).
--
-- Not linked, for the owner to decide (near but not certainly the same item):
--   "DEYE SUN-12K-SG05L-P3-Three-Phase 12KW Hybrid Inverter" ≈ catalogue
--   "DEYE SUN-12K-SG05LP3-EU-SM2 …" ; "ICAL LIP48100LF … 3-years Warranty" ≈
--   catalogue "… 5-years Warranty".
--
-- Applied to production 2026-11-05. Idempotent: re-running links nothing new.

BEGIN;

-- 1. New catalogue items (fixed ids so the file is repeatable)
INSERT INTO "3.0_components"(component_id, internal_description, supplier_model, brand, category, unit, norm_value)
VALUES
  ('af7b96ea-707a-4746-b76e-67b1ffceaccb', 'JINKO JKM650-66HL4M-BDV 650Wp', 'JINKO JKM650-66HL4M-BDV', 'JINKO', 'pv_module', 'unit', 650),
  ('bd4b7364-bcc0-4417-b5b3-3c0d15325687', 'LONGI Hi-MO LR7-72HVH 655Wp', 'LONGI LR7-72HVH 655Wp', 'LONGI', 'pv_module', 'unit', 655),
  ('be1ecea1-3d54-4a73-ab68-6da0d181d1f5', 'SUNGROW SG125CX-P2 C&I Three Phase On-grid Inverter 125 kW', 'SUNGROW SG125CX-P2', 'SUNGROW', 'on_grid_inverter', 'unit', 125000),
  ('751c3915-bade-4e11-9dc4-8cfc390a64a0', 'HUAWEI SUN2000-100KTL-M2 100kW 3P', 'HUAWEI SUN2000-100KTL-M2', 'HUAWEI', 'on_grid_inverter', 'unit', 100000),
  ('a56a3b34-88cb-4b50-bda9-09aa67777496', 'HUAWEI SUN2000-150KTL-M2 150kW 3P', 'HUAWEI SUN2000-150KTL-M2', 'HUAWEI', 'on_grid_inverter', 'unit', 150000),
  ('fb87d5a9-0ab6-4b35-967c-a0ebf0ab4257', 'SUNGROW ST255C2-2h Powerstack Battery 255 kWh / 125 kW', 'SUNGROW ST255C2-2h', 'SUNGROW', 'batteries', 'unit', NULL),
  ('707943fa-b1de-411f-8994-ca8bf27a4e7f', 'SUNGROW EMS300CP EMS C&I Inside BESS Cabinet', 'SUNGROW EMS300CP', 'SUNGROW', 'monitoring', 'unit', NULL)
ON CONFLICT (component_id) DO NOTHING;

-- 2a. Library entry → catalogue item
CREATE TEMP TABLE lib_to_item(entry_id uuid PRIMARY KEY, component_id uuid NOT NULL) ON COMMIT DROP;
INSERT INTO lib_to_item VALUES
  ('dc09c4d2-c8e9-4e91-9090-c45e4f7ee364', 'af7b96ea-707a-4746-b76e-67b1ffceaccb'), -- JINKO 650Wp
  ('cc118c8d-d0e6-45ba-8637-440e4baebfa2', 'bd4b7364-bcc0-4417-b5b3-3c0d15325687'), -- LONGI 655Wp
  ('1c47d19d-a740-4c71-b296-9b2371c1ab49', 'be1ecea1-3d54-4a73-ab68-6da0d181d1f5'), -- SUNGROW SG125CX-P2
  ('2e97cbff-5bbe-41a8-8e00-4df3874f4c76', '751c3915-bade-4e11-9dc4-8cfc390a64a0'), -- HUAWEI 100KTL
  ('9bd0577d-6ce0-448f-b6be-ae54e9c37c0e', 'a56a3b34-88cb-4b50-bda9-09aa67777496'), -- HUAWEI 150KTL
  ('68380378-1328-460c-bda1-bc316460f1a3', 'fb87d5a9-0ab6-4b35-967c-a0ebf0ab4257'), -- SUNGROW ST255C2
  ('602c0b6d-2ce0-4e3e-ae8f-d902421c3f7c', 'fb87d5a9-0ab6-4b35-967c-a0ebf0ab4257'), -- "Sungrow Powerstack Battery 255 kWh 125 kW": same item
  ('e25d3e61-0dc0-420a-af49-b1c291fa78e3', '707943fa-b1de-411f-8994-ca8bf27a4e7f'), -- SUNGROW EMS300CP
  ('042dae2a-d945-4cc7-ae1e-10f3f0b7d59f', 'ef28bf38-6d2c-4653-b813-96c9866a4491'), -- TRINA 725Wp (in the catalogue already)
  ('cdc45a68-db3f-472d-80e5-ca09393d3a01', '0de28460-85c1-4838-8a99-fb2915431bf9'), -- HUAWEI 330KTL (in the catalogue already)
  ('a532c881-5a43-46f8-9084-767abc687d37', '1c05447d-94eb-43ef-b292-fa6d62efe4e8'); -- SUNGROW SG150CX (in the catalogue already)

-- Entries whose wording IS a live catalogue item (one item per wording)
INSERT INTO lib_to_item
SELECT l.entry_id, min(c.component_id::text)::uuid
  FROM "10.4_description_library" l
  JOIN "3.0_components" c ON c.archived_at IS NULL
   AND (public.lib_norm(coalesce(nullif(c.internal_description, ''), c.supplier_model)) = l.norm_key
        OR public.lib_norm(c.supplier_model) = l.norm_key)
 WHERE l.archived_at IS NULL
 GROUP BY l.entry_id HAVING count(DISTINCT c.component_id) = 1
ON CONFLICT (entry_id) DO NOTHING;

-- 2b. Link the lines (trigger lib_link clears library_entry_id on a catalogue line)
UPDATE "10.2_quote_items" i SET component_id = m.component_id
  FROM lib_to_item m
 WHERE i.library_entry_id = m.entry_id AND i.component_id IS NULL;

-- 3. Archive the entries left without lines, logged so Undo can restore them
CREATE TEMP TABLE gone ON COMMIT DROP AS
SELECT l.entry_id FROM "10.4_description_library" l JOIN lib_to_item m USING (entry_id)
 WHERE l.archived_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM "10.2_quote_items" i WHERE i.library_entry_id = l.entry_id);
CREATE TEMP TABLE snap ON COMMIT DROP AS
SELECT public.lib_snapshot('epc', (SELECT coalesce(array_agg(entry_id), '{}') FROM gone)) AS b;

UPDATE "10.4_description_library" SET archived_at = now(), archived_by_email = 'system',
       updated_at = now(), updated_by_email = 'system'
 WHERE entry_id IN (SELECT entry_id FROM gone);

SELECT public.lib_log('epc', 'archive', (SELECT array_agg(entry_id) FROM gone),
         (SELECT string_agg(x->>'description', ' · ') FROM jsonb_array_elements((SELECT b FROM snap)) x),
         jsonb_build_object('before', (SELECT b FROM snap),
           'after', public.lib_snapshot('epc', (SELECT array_agg(entry_id) FROM gone)),
           'catalogue', (SELECT jsonb_object_agg(entry_id, component_id) FROM lib_to_item),
           'cleanup', '2026-11-04 — now Item Editor items'))
 WHERE EXISTS (SELECT 1 FROM gone);

COMMIT;

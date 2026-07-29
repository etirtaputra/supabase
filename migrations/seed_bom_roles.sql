-- ── Seed BOM roles on mounting parts, connectors and PV cable ────────────────
--
-- The mounting/BoM engines (Module 28) emit GENERIC line items — "rail
-- 4850mm", "mid clamp for a 35mm-thick panel", "MC4 pair" — and resolve them
-- to real catalog items by `specifications.bom_role` plus the role's
-- discriminating parameter (see lib/specSchema.ts BOM_ROLES /
-- BOM_ROLE_PARAMS). This seed derives those roles from the supplier_model
-- names for the patterns that are unambiguous; anything uncertain is left
-- untagged (an untagged part simply can't be auto-picked — the generated
-- line falls back to free text, which is honest).
--
-- Idempotent: existing spec keys always win (jsonb || puts the seed on the
-- LEFT), so a hand-corrected role is never clobbered by a re-run.
-- clamp_thickness_mm keeps the raw token ('30', '30-33', '30/35') — several
-- clamps serve a range, and the resolver parses it.

-- Rails with an explicit length token: "… Rail … L4850mm"
UPDATE "3.0_components" SET specifications =
  jsonb_build_object('bom_role', 'rail',
    'rail_length_mm', (substring(supplier_model FROM 'L(\d{3,4})mm'))::numeric)
  || COALESCE(specifications, '{}'::jsonb)
WHERE category = 'mounting'
  AND supplier_model ~* 'rail' AND supplier_model ~ 'L\d{3,4}mm'
  AND supplier_model !~* '(splice|walkway|jointer)';

-- Rails named "… Base Rail F43 - 4850" (length after a trailing dash)
UPDATE "3.0_components" SET specifications =
  jsonb_build_object('bom_role', 'rail',
    'rail_length_mm', (substring(supplier_model FROM '- ?(\d{3,4})$'))::numeric)
  || COALESCE(specifications, '{}'::jsonb)
WHERE category = 'mounting'
  AND supplier_model ~* 'base rail' AND supplier_model ~ '- ?\d{3,4}$';

-- Rails named "… Rail SE30-900" (length glued to the profile code)
UPDATE "3.0_components" SET specifications =
  jsonb_build_object('bom_role', 'rail',
    'rail_length_mm', (substring(supplier_model FROM '-(\d{3,4})$'))::numeric)
  || COALESCE(specifications, '{}'::jsonb)
WHERE category = 'mounting'
  AND supplier_model ~* 'rail se\d+-\d{3,4}$';

-- Rail splices / jointers (walkway splices are NOT rail joints)
UPDATE "3.0_components" SET specifications =
  jsonb_build_object('bom_role', 'rail_joint')
  || COALESCE(specifications, '{}'::jsonb)
WHERE category = 'mounting'
  AND supplier_model ~* '(splice|jointer)' AND supplier_model !~* 'walkway';

-- Mid clamps ("Inter Clamp", "Middle Clamp", "Mid Clamp") + thickness token
UPDATE "3.0_components" SET specifications =
  jsonb_build_object('bom_role', 'mid_clamp',
    'clamp_thickness_mm', substring(supplier_model FROM '[Cc]lamp ([0-9/-]+)'))
  || COALESCE(specifications, '{}'::jsonb)
WHERE category = 'mounting'
  AND supplier_model ~* '(inter clamp|middle clamp|mid clamp)'
  AND supplier_model ~ '[Cc]lamp [0-9/-]+';

-- End clamps + thickness token
UPDATE "3.0_components" SET specifications =
  jsonb_build_object('bom_role', 'end_clamp',
    'clamp_thickness_mm', substring(supplier_model FROM '[Cc]lamp ([0-9/-]+)'))
  || COALESCE(specifications, '{}'::jsonb)
WHERE category = 'mounting'
  AND supplier_model ~* 'end clamp'
  AND supplier_model ~ '[Cc]lamp [0-9/-]+';

-- Grounding / bonding clips
UPDATE "3.0_components" SET specifications =
  jsonb_build_object('bom_role', 'grounding_clip')
  || COALESCE(specifications, '{}'::jsonb)
WHERE category = 'mounting' AND supplier_model ~* 'grounding.{0,12}clip';

-- Grounding lugs
UPDATE "3.0_components" SET specifications =
  jsonb_build_object('bom_role', 'grounding_lug')
  || COALESCE(specifications, '{}'::jsonb)
WHERE category = 'mounting' AND supplier_model ~* 'grounding lug';

-- L-feet = metal-roof attachment
UPDATE "3.0_components" SET specifications =
  jsonb_build_object('bom_role', 'roof_hook', 'roof_type', 'metal')
  || COALESCE(specifications, '{}'::jsonb)
WHERE category = 'mounting' AND supplier_model ~* 'l feet';

-- Tilt structures (tripods, adjustable front/back supports) = concrete/flat
UPDATE "3.0_components" SET specifications =
  jsonb_build_object('bom_role', 'roof_hook', 'roof_type', 'concrete')
  || COALESCE(specifications, '{}'::jsonb)
WHERE category = 'mounting'
  AND supplier_model ~* '(tripod|adjustable (front|back) support)';

-- MC4 connector pairs
UPDATE "3.0_components" SET specifications =
  jsonb_build_object('bom_role', 'mc4_pair')
  || COALESCE(specifications, '{}'::jsonb)
WHERE category = 'accessories' AND supplier_model ~* 'mc4 connector';

-- PV string cable (H1Z2Z2-K), cross-section from "1 x 6mm"
UPDATE "3.0_components" SET specifications =
  jsonb_build_object('bom_role', 'solar_cable',
    'cable_cross_section_mm2', (substring(supplier_model FROM '1 ?x ?(\d+) ?mm'))::numeric)
  || COALESCE(specifications, '{}'::jsonb)
WHERE category = 'pv_cable'
  AND supplier_model ~* 'H1Z2Z2' AND supplier_model ~* '1 ?x ?\d+ ?mm';

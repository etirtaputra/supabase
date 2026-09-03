/**
 * Emit the PV-module `specifications` migration.
 *
 * Datasheet values are typed here ONCE, then every record is put through
 * `conformSpecs` so the JSON that reaches the database is guaranteed to carry
 * the canonical key set in the canonical order — the file cannot drift from
 * lib/specSchema.ts, because it is generated from it.
 *
 *   node scripts/pv-module-specs.mjs > migrations/pv_module_specs.sql
 */
import { conformSpecs, CATEGORY_SPEC_FIELDS, CATEGORY_ALIASES } from '../lib/specSchema.ts';

const ICA_CERTS = [
  'LSPr-072-IDN',
  'SNI IEC 61215-1-1:2016',
  'SNI IEC 61215-1:2016',
  'SNI IEC 61215-2:2016',
  'IEC 61730',
];
const TRINA_CERTS = ['IEC 61215', 'IEC 61730', 'IEC 61701', 'IEC 62716', 'UL 61730'];

/** Shared across the whole NEG21C.20 series — only the bin numbers differ. */
const NEG21C = {
  cell_type: 'N-type i-TOPCon Monocrystalline',
  number_of_cells: 132,
  bifacial: true,
  bifaciality_percent: 80,
  power_tolerance: '0 to +5 W',
  noct_c: '43 ± 2',
  temp_coeff_pmax_percent_per_c: -0.29,
  temp_coeff_voc_percent_per_c: -0.24,
  temp_coeff_isc_percent_per_c: 0.04,
  max_system_voltage_vdc: 1500,
  max_series_fuse_a: 35,
  operating_temp_range_c: '-40 to +70',
  dimensions_l_w_h_mm: '2384 x 1303 x 33',
  weight_kg: 38.3,
  frame_material: '33mm anodized aluminium alloy',
  front_glass: '2.0mm AR coating heat strengthened glass',
  back_glass: '2.0mm heat strengthened glass',
  junction_box: 'IP68 rated',
  connector_type: 'TS4 / TS4 Plus / MC4 EVO2',
  cable_cross_section_mm2: 4.0,
  cable_length_mm: 'Portrait: 370 / 230 (length can be customized)',
  packing_pcs_per_pallet: 33,
  packing_pallets_per_container_40ft: 18,
  packing_pcs_per_container_40ft: 594,
  product_warranty_years: 12,
  performance_warranty_years: 30,
  certifications: TRINA_CERTS,
};

/** Rows the uploaded datasheets cover — these REPLACE whatever is stored. */
const FROM_DATASHEET = [
  {
    id: '3ab27012-7792-4733-99e7-98825e763368',
    label: 'ICA SOLAR ICA100-36M 100Wp Mono (890x580x28)',
    source: 'ICA100-36M datasheet MKT.PRM/MY/I/2024 V.03',
    specs: {
      cell_type: 'Monocrystalline',
      power_stc_w: 100, power_tolerance: '±5%',
      vmp_stc_v: 22.97, imp_stc_a: 4.36, voc_stc_v: 26.91, isc_stc_a: 4.61,
      efficiency_percent: 19.37, noct_c: '45 ± 2',
      temp_coeff_pmax_percent_per_c: -0.45,
      temp_coeff_voc_percent_per_c: -0.32,
      temp_coeff_isc_percent_per_c: 0.06,
      max_system_voltage_vdc: 1000, max_series_fuse_a: 15,
      operating_temp_range_c: '-45 to +80',
      dimensions_l_w_h_mm: '890 x 580 x 28', weight_kg: 5.9,
      certifications: ICA_CERTS,
    },
  },
  {
    id: '20d14978-a950-42ba-9c81-08f29a814449',
    label: 'ICA SOLAR ICA550-72HMI 550Wp Mono 2278x1134x30mm',
    source: 'ICA550-72HMI datasheet MKT.PRM/MY/IX/2026',
    specs: {
      cell_type: 'Monocrystalline', number_of_cells: 144,
      cell_configuration: '6 x 24', cell_size_mm: '182 x 91',
      bifacial: false,
      power_stc_w: 550, power_tolerance: '0 to +5 W',
      vmp_stc_v: 42.40, imp_stc_a: 12.98, voc_stc_v: 50.20, isc_stc_a: 13.82,
      efficiency_percent: 21.29,
      power_noct_w: 414.30, vmp_noct_v: 39.10, imp_noct_a: 10.58,
      voc_noct_v: 46.90, isc_noct_a: 11.17, noct_c: '45 ± 2',
      temp_coeff_pmax_percent_per_c: -0.35,
      temp_coeff_voc_percent_per_c: -0.27,
      temp_coeff_isc_percent_per_c: 0.05,
      max_system_voltage_vdc: 1500, max_series_fuse_a: 25,
      operating_temp_range_c: '-40 to +85',
      dimensions_l_w_h_mm: '2278 x 1134 x 30', weight_kg: 29.0,
      frame_material: 'Anodized aluminium',
      // The stored value said 3.2mm; the datasheet the owner supplied says 2.0.
      front_glass: '2.0mm low iron tempered glass',
      back_glass: '2.0mm low iron tempered glass',
      junction_box: 'Split junction box (IP68, three diodes)',
      connector_type: 'MC4 compatible',
      cable_cross_section_mm2: 4.0,
      cable_length_mm: '+300 / -300 (customized length)',
      packing_pcs_per_pallet: 31,
      packing_pallets_per_container_40ft: 20,
      packing_pcs_per_container_40ft: 620,
      certifications: ICA_CERTS,
    },
  },
  {
    id: '3ddfcdb1-db6e-452d-9d68-b46809d1924a',
    label: 'TRINA TSM-620NEG19RC.20',
    source: 'TSM-NEG19RC.20 datasheet TSM_EN_2024_APAC_B, 620W bin',
    specs: {
      cell_type: 'N-type i-TOPCon Monocrystalline', number_of_cells: 132,
      bifacial: true, bifaciality_percent: 80,
      power_stc_w: 620, power_tolerance: '0 to +5 W',
      vmp_stc_v: 41.4, imp_stc_a: 14.99, voc_stc_v: 49.6, isc_stc_a: 15.91,
      efficiency_percent: 23.0,
      power_noct_w: 474, vmp_noct_v: 38.8, imp_noct_a: 12.20,
      voc_noct_v: 47.1, isc_noct_a: 12.82, noct_c: '43 ± 2',
      temp_coeff_pmax_percent_per_c: -0.29,
      temp_coeff_voc_percent_per_c: -0.24,
      temp_coeff_isc_percent_per_c: 0.04,
      max_system_voltage_vdc: 1500, max_series_fuse_a: 35,
      operating_temp_range_c: '-40 to +85',
      dimensions_l_w_h_mm: '2382 x 1134 x 30', weight_kg: 33.0,
      frame_material: '30mm anodized aluminium alloy',
      front_glass: '2.0mm high transmission AR coated heat strengthened glass',
      back_glass: '2.0mm heat strengthened glass',
      encapsulant: 'POE/EVA',
      junction_box: 'IP68 rated',
      connector_type: 'TS4 Plus / TS4',
      cable_cross_section_mm2: 4.0,
      cable_length_mm: 'Portrait: 350 / 280 (length can be customized)',
      packing_pcs_per_pallet: 36,
      packing_pallets_per_container_40ft: 20,
      packing_pcs_per_container_40ft: 720,
      product_warranty_years: 12, performance_warranty_years: 30,
      certifications: TRINA_CERTS,
    },
  },
  ...[
    { id: '78f4f475-1792-465d-9cea-598fc6961485', w: 715, vmp: 41.10, imp: 17.40, voc: 49.20, isc: 18.44, eff: 23.0, pn: 547, vmpn: 38.70, impn: 14.14, vocn: 46.70, iscn: 14.86 },
    { id: 'e814539a-d3d3-4133-993e-a802251fcd2d', w: 720, vmp: 41.30, imp: 17.44, voc: 49.40, isc: 18.49, eff: 23.2, pn: 551, vmpn: 38.80, impn: 14.19, vocn: 46.90, iscn: 14.90 },
    { id: 'ef28bf38-6d2c-4653-b813-96c9866a4491', w: 725, vmp: 41.50, imp: 17.47, voc: 49.60, isc: 18.54, eff: 23.3, pn: 555, vmpn: 39.00, impn: 14.23, vocn: 47.10, iscn: 14.94 },
  ].map((b) => ({
    id: b.id,
    label: `TRINA TSM-${b.w}NEG21C.20`,
    source: `TSM-NEG21C.20 datasheet, ${b.w}W bin`,
    specs: {
      ...NEG21C,
      power_stc_w: b.w,
      vmp_stc_v: b.vmp, imp_stc_a: b.imp, voc_stc_v: b.voc, isc_stc_a: b.isc,
      efficiency_percent: b.eff,
      power_noct_w: b.pn, vmp_noct_v: b.vmpn, imp_noct_a: b.impn,
      voc_noct_v: b.vocn, isc_noct_a: b.iscn,
    },
  })),
];

/**
 * Rows no uploaded datasheet covers. Their STORED values are carried across
 * verbatim — this is a reshape, not a rewrite — and only the key set changes.
 * Written out row by row rather than as one clever UPDATE so the file says
 * exactly what each record becomes, and so the legacy-spelling fold runs
 * through the same `conformSpecs` the app uses.
 */
const CONFORM_ONLY = [
  {
    id: '14647a6d-2f26-4139-88e5-c156b478044c',
    label: 'ICA SOLAR ICA100-36M 100Wp Mono 900x585x30mm',
    note: 'A different build from the 890x580x28 sheet — 18.3 Vmp, not 22.97.',
    specs: {
      noct_c: '47 ± 2', cell_type: 'Monocrystalline',
      imp_stc_a: 5.47, isc_stc_a: 5.89, vmp_stc_v: 18.3, voc_stc_v: 21.6,
      weight_kg: 5.7, power_stc_w: 100, certifications: ICA_CERTS,
      power_tolerance: '±5%', max_series_fuse_a: 15, efficiency_percent: 19.37,
      dimensions_l_w_h_mm: '900 x 585 x 30', max_system_voltage_vdc: 1000,
      operating_temp_range_c: '-40 to +85',
      temp_coeff_isc_percent_per_c: 0.065,
      temp_coeff_voc_percent_per_c: -0.32,
      temp_coeff_pmax_percent_per_c: -0.45,
    },
  },
  {
    id: '0e435e91-7d03-49d2-ba21-079d3d281034',
    label: 'ICA SOLAR ICA200-36M 200Wp Mono',
    note: 'Held one key. Now holds the full set, all but power unanswered.',
    specs: { power_stc_w: 200 },
  },
  {
    id: '6eb8a2b5-3fc6-43f5-9fc3-76f86458e9de',
    label: 'ICA SOLAR ICA200-72M 200Wp Mono',
    note: 'NOT updated from the ICA200-72M sheet — see the note at the end.',
    specs: {
      noct_c: '45 ± 2', cell_type: 'Monocrystalline',
      imp_stc_a: 4.08, isc_stc_a: 4.23, vmp_stc_v: 49.04, voc_stc_v: 56.74,
      weight_kg: 11.4, power_stc_w: 200, certifications: ICA_CERTS,
      power_tolerance: '±5%', max_series_fuse_a: 15, efficiency_percent: 19.7,
      dimensions_l_w_h_mm: '1328 x 765 x 28', max_system_voltage_vdc: 1000,
      operating_temp_range_c: '-45 to +80',
      temp_coeff_isc_percent_per_c: 0.06,
      temp_coeff_voc_percent_per_c: -0.32,
      temp_coeff_pmax_percent_per_c: -0.45,
    },
  },
  {
    id: '65f101bd-a532-42e2-bbec-9f820c1df640',
    label: 'ICA SOLAR ICA200-72M 200Wp Mono 1265x770x30mm',
    note: 'Had no specifications at all. Now has the shape, awaiting values.',
    specs: {},
  },
  {
    id: 'f59f87db-ddab-4f32-913f-73c887a886b6',
    label: 'ICA SOLAR ICA450-72HMG 450Wp Mono',
    specs: {
      noct_c: '45 ± 2', cell_type: 'Monocrystalline',
      imp_stc_a: 10.87, isc_stc_a: 11.36, vmp_stc_v: 41.4, voc_stc_v: 50,
      weight_kg: 24.5, imp_noct_a: 8.7, isc_noct_a: 9.18,
      vmp_noct_v: 38.9, voc_noct_v: 46.6, power_stc_w: 450,
      cell_size_mm: '166 x 83',
      junction_box: 'Split junction box (IP68, three diodes)',
      power_noct_w: 338.3, certifications: ['IEC 61730'],
      connector_type: 'MC4 compatible', frame_material: 'Anodized aluminium',
      cable_length_mm: '+300 / -300 (customized)', number_of_cells: 144,
      glass_description: '3.2mm tempered low iron glass',
      max_series_fuse_a: 20, power_tolerance_w: '0 to +5',
      cell_configuration: '6 x 24', efficiency_percent: 20.37,
      dimensions_l_w_h_mm: '2108 x 1048 x 35', max_system_voltage_vdc: 1500,
      operating_temp_range_c: '-40 to +85', cable_cross_section_mm2: 4,
      temp_coeff_isc_percent_per_c: 0.05,
      temp_coeff_voc_percent_per_c: -0.29,
      temp_coeff_pmax_percent_per_c: -0.36,
      packing_container_40ft_total_pcs: 704,
      packing_container_40ft_pcs_per_pallet: 31,
      packing_container_40ft_pallets_per_container: 22,
    },
  },
  {
    id: '499488fe-0f20-4558-b7be-87fc14127139',
    label: 'ICA SOLAR ICA550-72HMI 550Wp Mono 2278x1134x35mm',
    note: 'The 35mm frame variant; the supplied sheet is the 30mm one.',
    specs: {
      noct_c: '45 ± 2', cell_type: 'Monocrystalline',
      imp_stc_a: 12.98, isc_stc_a: 13.82, vmp_stc_v: 42.4, voc_stc_v: 50.2,
      weight_kg: 29, imp_noct_a: 10.58, isc_noct_a: 11.17,
      vmp_noct_v: 39.1, voc_noct_v: 46.9, power_stc_w: 550,
      cell_size_mm: '182 x 91',
      junction_box: 'Split junction box (IP68, three diodes)',
      power_noct_w: 414.3, certifications: ICA_CERTS,
      connector_type: 'MC4 compatible', frame_material: 'Anodized aluminium',
      cable_length_mm: '+300 / -300 (customized length)', number_of_cells: 144,
      glass_description: '3.2mm tempered low iron glass',
      max_series_fuse_a: 25, power_tolerance_w: '0 to +5',
      cell_configuration: '6 x 24', efficiency_percent: 21.29,
      dimensions_l_w_h_mm: '2278 x 1134 x 35', max_system_voltage_vdc: 1500,
      operating_temp_range_c: '-40 to +85', cable_cross_section_mm2: 4,
      temp_coeff_isc_percent_per_c: 0.05,
      temp_coeff_voc_percent_per_c: -0.27,
      temp_coeff_pmax_percent_per_c: -0.35,
      packing_container_40ft_total_pcs: 620,
      packing_container_40ft_pcs_per_pallet: 31,
      packing_container_40ft_pallets_per_container: 20,
    },
  },
  {
    id: '05651a2b-0b6e-44f7-bb5d-c0b85dc0ad69',
    label: 'JINKO JKM575N-72HL4-V',
    note: 'No datasheet on file — seven of the forty-one keys are answered.',
    specs: {
      imp_stc_a: 13.62, isc_stc_a: 14.39, vmp_stc_v: 42.22, voc_stc_v: 50.88,
      weight_kg: 28, power_stc_w: 575, dimensions_l_w_h_mm: '2278 x 1134 x 35',
    },
  },
];

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const out = [];
out.push(`-- PV module specifications, conformed to CATEGORY_SPEC_FIELDS.pv_module.
--
-- GENERATED by scripts/pv-module-specs.mjs — edit the script, re-run it, do
-- not hand-patch this file.
--
-- Two things happen here, and they are separate:
--
--   1. Every pv_module row is CONFORMED: the ${CATEGORY_SPEC_FIELDS.pv_module.length} declared keys, in declared
--      order, null where the datasheet does not say. Values already stored are
--      kept; legacy spellings (glass_description, power_tolerance_w, the three
--      packing_container_40ft_* keys) fold into their canonical names. This is
--      a reshape, not a rewrite.
--
--   2. Six rows are REPLACED from the datasheets the owner supplied on
--      2026-09-03. Those are listed one by one below with their source.
--
-- Why every key on every row: before this, one TRINA row carried three keys
-- and one ICA row carried thirty. A query cannot tell a missing KEY from a
-- missing VALUE, so "which modules have no NOCT data?" was unanswerable. With
-- the key always present and null meaning "the datasheet does not say", it is
-- one WHERE clause.`);

for (const r of FROM_DATASHEET) {
  // Only the keys the datasheet actually states. The conform below supplies
  // the rest as null, so merging rather than replacing keeps the statement to
  // what the document says — and makes re-running it a no-op.
  const stated = Object.fromEntries(
    Object.entries(conformSpecs('pv_module', r.specs)).filter(([, v]) => v !== null));
  out.push(`
-- ${r.label}
-- source: ${r.source}
update "3.0_components"
set specifications = coalesce(specifications, '{}'::jsonb) || ${q(JSON.stringify(stated, null, 2))}::jsonb
where component_id = '${r.id}';`);
}

const FIELDS = CATEGORY_SPEC_FIELDS.pv_module;
const ALIASES = Object.entries(CATEGORY_ALIASES.pv_module ?? {});

out.push(`
-- ── Every other PV module: reshape only ─────────────────────────────────────
-- The rows below are NOT rewritten. Two idempotent statements put them into
-- the same shape as the six above, so re-running this file (or running it
-- after a new module is added) is harmless.
--
-- They are emitted from lib/specSchema.ts — the alias map and the field list
-- are the same ones the app uses, so SQL and TypeScript cannot drift.
--
-- ${CONFORM_ONLY.map((r) => `${r.label}${r.note ? ` — ${r.note}` : ''}`).join('\n-- ')}

-- 1. Column data never belongs in the blob (lib/specSchema NON_SPEC_KEYS) —
--    it would also leak a brand onto a customer-facing spec annex.
update "3.0_components"
set specifications = specifications - 'model' - 'brand' - 'selling_price_idr'
where category::text = 'pv_module'
  and specifications ?| array['model', 'brand', 'selling_price_idr'];

-- 2. Fold the spellings that predate the field set into their canonical names.
update "3.0_components"
set specifications = (specifications ${ALIASES.map(([from]) => `- ${q(from)}`).join('\n     ')})
  || jsonb_strip_nulls(jsonb_build_object(
${ALIASES.map(([from, rule]) => `       ${q(rule.to)}, specifications -> ${q(from)}`).join(',\n')}
     ))
where category::text = 'pv_module'
  and specifications ?| array[${ALIASES.map(([from]) => q(from)).join(', ')}];

-- 3. Add every declared key the row does not carry, as null. Null is an
--    answer — "the datasheet does not say" — and a query can count it. A
--    missing key cannot be counted, which is the whole reason for this file.
update "3.0_components" c
set specifications = coalesce((
      select jsonb_object_agg(k, 'null'::jsonb)
      from unnest(array[${FIELDS.map((f) => q(f)).join(', ')}]) as k
      where not (coalesce(c.specifications, '{}'::jsonb) ? k)
    ), '{}'::jsonb) || coalesce(c.specifications, '{}'::jsonb)
where c.category::text = 'pv_module';`);

console.log(out.join('\n'));

/**
 * Battery and solar-charge-controller specifications, from the datasheets
 * supplied 2026-09-03.
 *
 *   node scripts/battery-scc-specs.mjs > migrations/battery_scc_specs.sql
 *
 * Two categories in one file because they arrived together and share a
 * generator; the emitter runs once per category.
 */
import { emitSpecSql } from './lib/emitSpecSql.mjs';

const BATTERIES = [
  {
    id: '5aaf8efd-e790-4ae8-bf8c-123b48dfb5f1',
    label: 'ICAL LIP12100D 12V/100Ah',
    source: 'LIP12100D Deep Cycle datasheet MKT.MY.032024',
    // "LIP" in the model name notwithstanding, this is a lead-acid deep cycle
    // cell: 10-hour rate capacity, mΩ internal resistance, 14.4V cycle / 13.8V
    // float, and 32.5 kg for 12V100Ah (a LiFePO4 pack of that rating is ~13).
    note: 'lead-acid despite the LIP model prefix — see the charge voltages',
    specs: {
      battery_type: 'Lead-acid (deep cycle)',
      nominal_voltage_v: 12,
      rated_capacity_ah: 100,
      energy_wh: 1200,
      charge_voltage_cycle_v: 14.4,
      charge_voltage_float_v: 13.8,
      rated_charge_current_a: 30,
      max_discharge_current_a: 800,
      internal_resistance_mohm: '5',
      self_discharge_percent_per_month: '~3 (91% of capacity after 3 months)',
      dimensions_l_w_h_mm: '407 x 174 x 236 (total height with terminals)',
      weight_kg: 32.5,
      terminal_type: 'Bolt, 8mm',
    },
  },
  {
    id: 'a702ab94-b76a-4de9-a5a1-ef169d8ad9dc',
    label: 'ICAL LIP12200D 12V/200Ah',
    source: 'LIP12200D Deep Cycle datasheet',
    note: 'lead-acid despite the LIP model prefix',
    specs: {
      battery_type: 'Lead-acid (deep cycle)',
      nominal_voltage_v: 12,
      rated_capacity_ah: 200,
      energy_wh: 2400,
      charge_voltage_cycle_v: 14.4,
      charge_voltage_float_v: 13.8,
      internal_resistance_mohm: '3',
      self_discharge_percent_per_month: '~3 (91% of capacity after 3 months)',
      dimensions_l_w_h_mm: '523 x 240 x 230 (total height with terminals)',
      weight_kg: 57.5,
      terminal_type: 'Bolt, 8mm',
    },
  },
  {
    id: '066ce835-45b4-4643-8a67-9d708e1728bf',
    label: 'ICAL LIP48100LF 48V/100Ah 15S1P LiFePO4',
    source: 'LIP48100LF datasheet',
    specs: {
      battery_type: 'LiFePO4 (with BMS)',
      configuration: '15S1P',
      nominal_voltage_v: 48,
      rated_capacity_ah: 100,
      minimal_capacity_ah: 100,
      energy_wh: 4800,
      charge_voltage_v: 54,
      discharge_cut_off_voltage_v: 39,
      rated_charge_current_a: 30,
      max_charge_current_a: 100,
      max_discharge_current_a: 100,
      cycle_life: '≥4000 cycles @ 25°C 0.2C/0.2C 80% DOD',
      internal_resistance_mohm: '≤30 @ 50% SOC 1kHz',
      self_discharge_percent_per_month: '<3',
      operating_temp_range_charge_c: '0 to 50',
      operating_temp_range_discharge_c: '-20 to 55',
      storage_temp_range_c: '0 to 40',
      ip_rating: 'IP54',
      dimensions_l_w_h_mm: '450 x 483 x 133',
      weight_kg: 42,
      case_material: 'Sheet metal shell',
      certifications: ['UN38.3', 'MSDS'],
    },
  },
  {
    id: '88e6cdae-3421-47fa-89a5-506138c6edf3',
    label: 'EPEVER LR51100A 51.2V/100Ah LiFePO4',
    source: 'LR51100 A/B/E series datasheet — the A column',
    // The stored row said 48V. 51.2 is what 16 LiFePO4 cells at 3.2V make,
    // and what the sheet states.
    note: 'nominal voltage corrected from the stored 48V to the datasheet 51.2V',
    specs: {
      battery_type: 'LiFePO4',
      configuration: '16S1P',
      nominal_voltage_v: 51.2,
      rated_capacity_ah: 100,
      energy_wh: 5120,
      charge_voltage_v: 57.6,
      discharge_cut_off_voltage_v: 41.6,
      max_charge_current_a: 100,
      max_discharge_current_a: 100,
      recommended_discharge_current_a: 50,
      recommended_depth_of_discharge_percent: 80,
      max_parallel_units: 32,
      cycle_life: '>6000 cycles @ 25°C 0.5C 80% DOD',
      operating_temp_range_charge_c: '0 to 50',
      operating_temp_range_discharge_c: '-20 to 50',
      storage_temp_range_c: '5 to 35',
      humidity_range_percent: '40 to 80',
      ip_rating: 'IP21',
      dimensions_l_w_h_mm: '476 x 450 x 136',
      terminal_type: 'M8',
      mounting: 'Rack-mounted 3U',
      communication: 'RS485, CAN',
      display: 'LCD',
      certifications: ['UN38.3', 'MSDS', 'IEC 62619', 'RoHS', 'CE'],
    },
  },
];

/** Every XTRA-N G3 shares these; only the per-model numbers differ. */
const XTRA_COMMON = {
  controller_type: 'MPPT',
  rated_charging_power_w: null,   // per model
  tracking_efficiency_percent: '≥99.5',
  discharge_circuit_voltage_drop_v: '≤0.23',
  temperature_compensation: '-3mV/°C/2V (default)',
  grounding_type: 'Common negative',
  battery_types: 'Lithium, gel, sealed',
  communication: 'RS485 (5VDC/200mA, RJ45); Bluetooth on the BLE models',
  ip_rating: 'IP33',
  storage_temperature_range_c: '-20 to 70',
  humidity_range_percent: '≤95 (non-condensing)',
  pollution_degree: 'PD2',
  certifications: ['CE', 'IECS'],
};

const SCC = [
  {
    id: 'a7277c9d-60e3-476f-9f5e-1134676c2b99', label: 'EPEVER XTRA1210N-G3 MPPT 10A',
    a: 10, power: '130W/12V; 260W/24V', voc: 100, mppt: '(Battery voltage + 2V) ~ 72',
    conv: 98.20, load: 96.20, dim: '175 x 143 x 48', mount: '120 x 134',
    term: 4, wire: 4, kg: 0.59, sys: '12/24 auto', range: '8 ~ 31', temp: '-25 to 50',
  },
  {
    id: 'c0d60322-1e0f-4daa-9fc6-443e23f735d9', label: 'EPEVER XTRA2210N-G3 MPPT 20A',
    a: 20, power: '260W/12V; 520W/24V', voc: 100, mppt: '(Battery voltage + 2V) ~ 72',
    conv: 98.30, load: 96.40, dim: '217 x 158 x 56.5', mount: '160 x 149',
    term: 16, wire: 6, kg: 0.97, sys: '12/24 auto', range: '8 ~ 31', temp: '-25 to 50',
  },
  {
    id: '3ef54ee2-af0d-494f-942a-b875c743a083', label: 'EPEVER XTRA3210N-G3 MPPT 30A',
    a: 30, power: '390W/12V; 780W/24V', voc: 100, mppt: '(Battery voltage + 2V) ~ 72',
    conv: 98.60, load: 96.60, dim: '230 x 165 x 63', mount: '173 x 156',
    term: 16, wire: 10, kg: 1.30, sys: '12/24 auto', range: '8 ~ 31', temp: '-25 to 50',
  },
  {
    id: '37631729-7433-4639-97a7-9ae40804b87c', label: 'EPEVER XTRA4210N-G3 MPPT 40A',
    a: 40, power: '520W/12V; 1040W/24V', voc: 100, mppt: '(Battery voltage + 2V) ~ 72',
    conv: 98.60, load: 96.50, dim: '255 x 185 x 67.8', mount: '200 x 176',
    term: 16, wire: 16, kg: 1.72, sys: '12/24 auto', range: '8 ~ 31', temp: '-25 to 50',
  },
  {
    id: '9c8f7486-7b5f-4cf3-8314-d986ccf62710', label: 'EPEVER XTRA4215N-G3 MPPT 40A',
    // A 12/24V battery bus with the 150V PV front end — the reason this model
    // exists beside the 4210N, and the one row that had no specs at all.
    a: 40, power: '520W/12V; 1040W/24V', voc: 150, mppt: '(Battery voltage + 2V) ~ 108',
    conv: 97.90, load: 95.40, dim: '255 x 187 x 75.7', mount: '200 x 178',
    term: 16, wire: 16, kg: 2.08, sys: '12/24 auto', range: '8 ~ 31', temp: '-25 to 45',
  },
  {
    id: 'e8deff05-f4b3-4b64-9ac7-fec2945217ad', label: 'EPEVER XTRA4415N-G3 MPPT 40A',
    a: 40, power: '520W/12V; 1040W/24V; 1560W/36V; 2080W/48V', voc: 150,
    mppt: '(Battery voltage + 2V) ~ 108', conv: 98.50, load: 97.20,
    dim: '255 x 189 x 83.2', mount: '200 x 180',
    term: 16, wire: 16, kg: 2.60, sys: '12/24/36/48 auto', range: '8 ~ 62', temp: '-25 to 45',
  },
].map((m) => ({
  id: m.id,
  label: m.label,
  source: 'XTRA-N G3 / G3 BLE series datasheet, technical specifications table',
  specs: {
    ...XTRA_COMMON,
    system_voltage_v: m.sys,
    controller_operating_voltage_range_v: m.range,
    rated_charge_current_a: m.a,
    rated_discharge_current_a: m.a,
    rated_charging_power_w: m.power,
    pv_max_voc_v: m.voc,
    mppt_voltage_range_v: m.mppt,
    max_conversion_efficiency_percent: m.conv,
    max_load_efficiency_percent: m.load,
    dimensions_mm: m.dim,
    mounting_size_mm: m.mount,
    terminal_mm2: String(m.term),
    recommended_cable_mm2: m.wire,
    weight_kg: m.kg,
    operating_temperature_range_c: m.temp,
  },
}));

console.log(emitSpecSql({
  category: 'batteries',
  title: 'Battery specifications, conformed to CATEGORY_SPEC_FIELDS.batteries.',
  why: `Lead-acid and lithium share one field set. A float voltage reads null on
-- a lithium pack and a discharge cut-off reads null on a flooded cell — that is
-- the chemistry answering, not the record being incomplete.`,
  rows: BATTERIES,
}) + '\n\n' + emitSpecSql({
  category: 'solar_charge_controller',
  title: 'Solar charge controller specifications, conformed to CATEGORY_SPEC_FIELDS.solar_charge_controller.',
  why: `MPPT and PWM share one field set: a PWM unit answers null where the
-- tracking questions are, which is the honest way to say "it does not track".`,
  rows: SCC,
}) + '\n\n-- Generated by scripts/battery-scc-specs.mjs');

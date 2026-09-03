/**
 * Inverter-charger specifications, from the ICA SOLAR datasheets supplied
 * 2026-09-03.
 *
 *   node scripts/inverter-charger-specs.mjs > migrations/inverter_charger_specs.sql
 *
 * The five SNV sheets map onto catalogue rows by `internal_description`, not by
 * `supplier_model` — ICA SOLAR sells these as rebadged VOLTRONIC units, so the
 * row is called "VOLTRONIC Axpert VM 1K-24" and only its internal description
 * carries "SNV-GF1021". Each row below names both.
 */
import { emitSpecSql } from './lib/emitSpecSql.mjs';

/** Shared by both off-grid (GF) sheets — same input ranges, same wording. */
const GF_COMMON = {
  system_type: 'Off-grid',
  waveform: 'Pure sine wave',
  pv_solar_charger_type: 'MPPT',
  ac_input_frequency_range_hz: '50/60 (auto sensing)',
  transfer_time_ms: '10 (personal computers) / 20 (home appliances)',
  humidity_range_percent: '5 to 95 (non-condensing)',
  operating_temperature_range_c: '-10 to 50',
  storage_temperature_range_c: '-15 to 60',
};

/** Shared by the three hybrid (GH) sheets. */
const GH_COMMON = {
  system_type: 'Hybrid',
  phase: '1-phase in / 1-phase out',
  waveform: 'Pure Sine Wave',
  pv_max_open_circuit_voltage_vdc: 450,
  no_of_mpp_trackers: 1,
  nominal_output_voltage_vac: '220/230/240',
  grid_output_voltage_range_vac: '184~264.5 or 195.5~253 (selectable)',
  grid_output_frequency_range_hz: '47.5~51.5 or 49~51 (selectable)',
  power_factor: '>0.99',
  max_conversion_efficiency_dc_ac_percent: 95,
  ac_input_voltage_range_vac: '90~280 or 170~280',
  ac_input_frequency_range_hz: '50/60 (auto sensing)',
  nominal_output_frequency_hz: 50,
  efficiency_dc_to_ac_percent: 93,
  battery_nominal_voltage_vdc: 48,
  parallel_operation: 'Yes, up to 9 units',
  humidity_range_percent: '0~90 (non-condensing)',
  operating_temperature_range_c: '-10 to 50',
};

const ROWS = [
  {
    id: '88611ef2-3ae1-4f36-b784-6fedf6b7c200',
    label: 'VOLTRONIC Axpert VM 1K-24  ·  ICA SOLAR SNV-GF1021 1kW/24V',
    source: 'SNV-GF1021 datasheet MKT.PRM/MY/III/2021',
    // The only sheet of the five that states its dimensions in a different
    // order, so the value carries its own order rather than being silently
    // rearranged into the key's.
    note: 'dimensions are stated W*L*D on this sheet, D*W*H on the others',
    specs: {
      ...GF_COMMON,
      rated_output_power_w: 1000,
      rated_output_power_va: 1000,
      surge_power_va: 2000,
      ac_input_voltage_vac: '220',
      ac_input_voltage_range_vac: '170~280 (personal computers) / 90~280 (home appliances)',
      nominal_output_voltage_vac: '220',
      output_voltage_regulation_vac: '220 ±5%',
      max_conversion_efficiency_dc_ac_percent: 93,
      battery_nominal_voltage_vdc: 24,
      floating_charge_voltage_vdc: 27,
      overcharge_protection_vdc: 31,
      pv_max_open_circuit_voltage_vdc: 102,
      pv_max_input_power_w: 1000,
      pv_mppt_voltage_range_vdc: '30~80',
      max_solar_charging_current_a: 40,
      max_ac_charging_current_a: 20,
      max_total_charging_current_a: 60,
      dimensions_d_w_h_mm: '88 x 225 x 320 (stated W x L x D)',
      weight_kg: 5,
      communication_interfaces: 'USB / RS232',
    },
  },
  {
    id: 'f2fd5a15-dc8b-419d-abf5-051f657f5827',
    label: 'VOLTRONIC Axpert MKS5 Twin 6.5K  ·  ICA SOLAR SNV-GF6541 6.5kW/48V',
    source: 'SNV-GF6541 datasheet',
    note: 'rated 6.5kVA/6.5kW with PV+battery, 6kVA/6kW on battery alone',
    specs: {
      ...GF_COMMON,
      rated_output_power_w: 6500,
      rated_output_power_va: 6500,
      overload_capability: '5s @ ≥150% load; 10s @ 110~150% load; 100ms @ ≥200% load',
      ac_input_voltage_vac: '230',
      ac_input_voltage_range_vac: '170~280 (personal computers) / 90~280 (home appliances)',
      nominal_output_voltage_vac: '230',
      output_voltage_regulation_vac: '230 ±5%',
      max_conversion_efficiency_dc_ac_percent: 93,
      battery_nominal_voltage_vdc: 48,
      floating_charge_voltage_vdc: 54,
      overcharge_protection_vdc: 66,
      pv_max_input_power_w: 9000,
      pv_mppt_voltage_range_vdc: '90~450',
      pv_max_open_circuit_voltage_vdc: 500,
      max_pv_input_current_a: 27,
      max_solar_charging_current_a: 120,
      max_ac_charging_current_a: 120,
      max_total_charging_current_a: 120,
      dimensions_d_w_h_mm: '140 x 295 x 468',
      weight_kg: 12,
      communication_interfaces: 'RS232 / RS485 / WiFi',
    },
  },
  {
    id: '8701cc63-133f-4a10-86c2-8881b823e090',
    label: 'VOLTRONIC Infinisolar VII 2K-48  ·  ICA SOLAR SNV-GH2041 2kW/48V',
    source: 'SNV-GH2041 datasheet MKT.PRM/MY/III/2023',
    specs: {
      ...GH_COMMON,
      pv_max_input_power_w: 3000,
      rated_output_power_w: 2000,
      pv_nominal_voltage_vdc: 240,
      pv_mppt_voltage_range_vdc: '90~430',
      max_pv_input_current_a: 13,
      grid_nominal_output_current_a: 8.7,
      max_ac_input_current_a: 30,
      max_solar_charging_current_a: 60,
      max_ac_charging_current_a: 60,
      max_total_charging_current_a: 60,
      dimensions_d_w_h_mm: '120 x 295 x 468',
      weight_kg: 11,
      communication_interfaces: 'USB or RS-232 / Dry contact',
    },
  },
  {
    id: 'd9b72daa-9adb-408d-9398-49a8cd83513b',
    label: 'VOLTRONIC Infinisolar VII 3K-48  ·  ICA SOLAR SNV-GH3041 3kW/48V',
    source: 'SNV-GH3041 datasheet MKT.PRM/MY/III/2021',
    specs: {
      ...GH_COMMON,
      pv_max_input_power_w: 4000,
      rated_output_power_w: 3000,
      pv_nominal_voltage_vdc: 360,
      pv_mppt_voltage_range_vdc: '120~430',
      max_pv_input_current_a: 18,
      grid_nominal_output_current_a: 13,
      max_ac_input_current_a: 40,
      max_solar_charging_current_a: 60,
      max_ac_charging_current_a: 60,
      max_total_charging_current_a: 60,
      dimensions_d_w_h_mm: '120 x 295 x 468',
      weight_kg: 11,
      communication_interfaces: 'USB or RS-232 / Dry contact',
    },
  },
  {
    id: '253bafd9-d00b-42a8-b299-68f97bbd5f85',
    label: 'VOLTRONIC Infinisolar VIII 5K  ·  ICA SOLAR SNV-GH5042 5kW/48V',
    source: 'SNV-GH5042 datasheet',
    note: 'GH5041 (Infinisolar VII 5K-48) is a different unit and has no sheet here',
    specs: {
      ...GH_COMMON,
      pv_max_input_power_w: 6000,
      rated_output_power_w: 5000,
      pv_nominal_voltage_vdc: 360,
      pv_mppt_voltage_range_vdc: '120~430',
      max_pv_input_current_a: 27,
      grid_nominal_output_current_a: 21.7,
      max_ac_input_current_a: 40,
      max_solar_charging_current_a: 100,
      max_ac_charging_current_a: 100,
      max_total_charging_current_a: 100,
      dimensions_d_w_h_mm: '140 x 295 x 468',
      weight_kg: 12,
      communication_interfaces: 'USB or RS-232 / Dry contact; inbuilt WiFi monitoring data logger',
    },
  },
];

console.log(emitSpecSql({
  category: 'inverter_charger',
  title: 'Inverter-charger specifications, conformed to CATEGORY_SPEC_FIELDS.inverter_charger.',
  why: `Forty-seven inverter chargers carried between 0 and 26 keys each: most
-- held only rated_output_power_w and a battery voltage, seven held nothing at
-- all, and one (SNV-GH30081) held a full transcription. Off-grid and hybrid
-- units share one field set — a hybrid is an off-grid inverter that can also
-- export, and the grid block reading null on an off-grid unit is itself the
-- answer to "can this export?".`,
  rows: ROWS,
  conformOnly: [
    'The other 42 rows keep every value they had; only the key set changes.',
    'Several store `phase` as a number (1) and one as a string ("3-phase") —',
    'a value inconsistency the field set does not fix. Left alone deliberately:',
    'rewriting values is not what a reshape is for.',
  ],
}) + '\n\n-- Generated by scripts/inverter-charger-specs.mjs');

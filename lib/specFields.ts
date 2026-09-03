/**
 * specFields — what each spec key MEANS, in one place.
 *
 * `specSchema` says which keys a category carries and in what order.
 * This says how to render and how to EDIT each one: its human label, its unit,
 * which group it belongs to, and what kind of value it holds.
 *
 * One table, three readers — the Tech Specs form, the side-by-side comparison,
 * and SpecRenderer. That is the point: a field the form calls "Max PV Voc"
 * cannot be labelled something else in a comparison, and neither can drift
 * from the field set the database actually stores.
 *
 * `kind` is DECLARED, never inferred. A suffix is not a type: both
 * `operating_temperature_range_c` and `weight_kg` end in a unit, and one is
 * "-40 to +85" while the other is 29. Guessing gives you a number input that
 * refuses the only value a datasheet offers.
 */

export type SpecKind = 'number' | 'text' | 'boolean' | 'list';

export interface SpecFieldMeta {
  label: string;
  unit?: string;
  group: string;
  kind: SpecKind;
  /** Shown in the headline strip of a spec panel. */
  highlight?: boolean;
  /** Placeholder / example, for a field whose shape is not obvious. */
  hint?: string;
}

/**
 * Group order across every category. A PV module carries none of the converter
 * groups and a converter none of the module groups, so one order serves both
 * and a third category simply adds its own.
 */
export const SPEC_GROUP_ORDER = [
  'Topology',
  'AC Output',
  'Grid Export',
  'AC Input & Charger',
  'PV Input',
  'Battery',
  'Electrical (STC)',
  'Electrical (NOCT)',
  'Temperature Coefficients',
  'Physical',
  'Balance of System',
  'System Limits',
  'Logistics',
  'General',
] as const;

const N = (label: string, group: string, unit?: string, extra?: Partial<SpecFieldMeta>): SpecFieldMeta =>
  ({ label, group, unit, kind: 'number', ...extra });
const T = (label: string, group: string, unit?: string, extra?: Partial<SpecFieldMeta>): SpecFieldMeta =>
  ({ label, group, unit, kind: 'text', ...extra });

export const SPEC_FIELD_META: Record<string, SpecFieldMeta> = {
  // ── Inverter charger · topology ───────────────────────────────────────────
  system_type:        { label: 'System Type',        group: 'Topology', kind: 'text', highlight: true, hint: 'Off-grid / Hybrid' },
  phase:              T('Phase',              'Topology', undefined, { hint: '1-phase in / 1-phase out' }),
  parallel_operation: T('Parallel Operation', 'Topology', undefined, { hint: 'Yes, up to 9 units' }),
  no_of_mpp_trackers: N('MPP Trackers',       'Topology'),

  // ── Inverter charger · AC output ──────────────────────────────────────────
  rated_output_power_w:          N('Rated Output Power',  'AC Output', 'W', { highlight: true }),
  rated_output_power_va:         N('Rated Output',        'AC Output', 'VA'),
  surge_power_va:                N('Surge Power',         'AC Output', 'VA'),
  overload_capability:           T('Overload Capability', 'AC Output'),
  nominal_output_voltage_vac:    T('Nominal Output Voltage',    'AC Output', 'Vac', { hint: '230 or 220/230/240' }),
  output_voltage_regulation_vac: T('Output Voltage Regulation', 'AC Output', undefined, { hint: '230 ±5%' }),
  nominal_output_frequency_hz:   N('Nominal Output Frequency',  'AC Output', 'Hz'),
  waveform:                      T('Waveform',            'AC Output', undefined, { hint: 'Pure sine wave' }),
  transfer_time_ms:              T('Transfer Time',       'AC Output', 'ms'),
  efficiency_dc_to_ac_percent:   N('Efficiency (DC→AC)',  'AC Output', '%'),
  max_conversion_efficiency_dc_ac_percent: N('Max Conversion Efficiency', 'AC Output', '%'),

  // ── Inverter charger · grid export (null on an off-grid unit) ─────────────
  grid_output_voltage_range_vac:  T('Grid Output Voltage Range',   'Grid Export', 'Vac'),
  grid_output_frequency_range_hz: T('Grid Output Frequency Range', 'Grid Export', 'Hz'),
  grid_nominal_output_current_a:  N('Nominal Output Current',      'Grid Export', 'A'),
  power_factor:                   T('Power Factor (cos Φ)',        'Grid Export', undefined, { hint: '>0.99' }),
  ac_start_up_voltage_vac:        T('AC Start-Up Voltage',         'Grid Export', 'Vac'),

  // ── Inverter charger · AC input and the AC charger ────────────────────────
  ac_input_voltage_vac:        T('AC Input Voltage',        'AC Input & Charger', 'Vac'),
  ac_input_voltage_range_vac:  T('Acceptable Input Range',  'AC Input & Charger', 'Vac', { hint: '90~280' }),
  ac_input_frequency_range_hz: T('Input Frequency Range',   'AC Input & Charger', 'Hz'),
  max_ac_input_current_a:      N('Max AC Input Current',    'AC Input & Charger', 'A'),
  max_ac_charging_current_a:   N('Max AC Charging Current', 'AC Input & Charger', 'A'),

  // ── Inverter charger · PV input ───────────────────────────────────────────
  pv_solar_charger_type:           T('Solar Charger Type',   'PV Input', undefined, { hint: 'MPPT' }),
  pv_max_input_power_w:            N('Max PV Input Power',   'PV Input', 'W', { highlight: true }),
  pv_nominal_voltage_vdc:          N('Nominal PV Voltage',   'PV Input', 'Vdc'),
  pv_max_open_circuit_voltage_vdc: N('Max PV Voc',           'PV Input', 'Vdc', { highlight: true }),
  pv_mppt_voltage_range_vdc:       T('MPPT Voltage Range',   'PV Input', 'Vdc', { hint: '120~430' }),
  // "26 per MPPT" is a real datasheet answer, so this cannot be a number.
  max_pv_input_current_a:          T('Max PV Input Current', 'PV Input', 'A'),
  max_solar_charging_current_a:    N('Max Solar Charging Current', 'PV Input', 'A'),

  // ── Inverter charger · battery port ───────────────────────────────────────
  battery_nominal_voltage_vdc:  N('Nominal Battery Voltage', 'Battery', 'Vdc', { highlight: true }),
  battery_voltage_range_vdc:    T('Battery Voltage Range',   'Battery', 'Vdc'),
  floating_charge_voltage_vdc:  N('Floating Charge Voltage', 'Battery', 'Vdc'),
  overcharge_protection_vdc:    N('Overcharge Protection',   'Battery', 'Vdc'),
  max_total_charging_current_a: N('Max Total Charging Current', 'Battery', 'A'),

  // ── Battery ───────────────────────────────────────────────────────────────
  battery_type:        T('Battery Type',      'Topology', undefined, { highlight: true, hint: 'LiFePO4 / Lead-acid (deep cycle)' }),
  configuration:       T('Pack Configuration','Topology', undefined, { hint: '16S1P' }),
  nominal_voltage_v:   N('Nominal Voltage',   'Topology', 'V', { highlight: true }),
  rated_capacity_ah:   N('Rated Capacity',    'Topology', 'Ah', { highlight: true }),
  minimal_capacity_ah: N('Minimal Capacity',  'Topology', 'Ah'),
  energy_wh:           N('Energy',            'Topology', 'Wh', { highlight: true }),

  charge_voltage_v:                       N('Charge Voltage',            'Battery', 'V'),
  charge_voltage_cycle_v:                 N('Charge Voltage (cycle)',    'Battery', 'V'),
  charge_voltage_float_v:                 N('Float Voltage',             'Battery', 'V'),
  discharge_cut_off_voltage_v:            N('Discharge Cut-Off Voltage', 'Battery', 'V'),
  max_charge_current_a:                   N('Max Charge Current',        'Battery', 'A'),
  max_discharge_current_a:                N('Max Discharge Current',     'Battery', 'A'),
  recommended_discharge_current_a:        N('Recommended Discharge Current', 'Battery', 'A'),
  recommended_depth_of_discharge_percent: N('Recommended Depth of Discharge', 'Battery', '%'),
  max_parallel_units:                     N('Max Units in Parallel',     'Battery'),
  cycle_life:                             T('Cycle Life',                'Battery', undefined, { hint: '≥4000 @ 25°C 0.2C 80% DOD' }),
  internal_resistance_mohm:               T('Internal Resistance',       'Battery', 'mΩ'),
  self_discharge_percent_per_month:       T('Self-Discharge',            'Battery', '%/month'),

  operating_temp_range_charge_c:    T('Charge Temperature',    'General', '°C'),
  operating_temp_range_discharge_c: T('Discharge Temperature', 'General', '°C'),
  storage_temp_range_c:             T('Storage Temperature',   'General', '°C'),
  terminal_type:  T('Terminal',      'Physical', undefined, { hint: 'M8' }),
  case_material:  T('Case Material', 'Physical'),
  mounting:       T('Mounting',      'Physical', undefined, { hint: 'Rack-mounted 3U' }),
  display:        T('Display',       'Physical', undefined, { hint: 'LCD / LED' }),
  communication:  T('Communication', 'Physical', undefined, { hint: 'RS485, CAN' }),
  ip_rating:      T('Ingress Protection', 'Physical', undefined, { hint: 'IP54' }),

  // ── Solar charge controller ───────────────────────────────────────────────
  controller_type:                     T('Controller Type', 'Topology', undefined, { highlight: true, hint: 'MPPT / PWM' }),
  system_voltage_v:                    T('Battery Rated Voltage', 'Topology', 'V', { highlight: true, hint: '12/24 auto' }),
  controller_operating_voltage_range_v: T('Controller Work Voltage Range', 'Topology', 'V'),
  rated_charge_current_a:              N('Rated Charging Current',    'Battery', 'A', { highlight: true }),
  rated_discharge_current_a:           N('Rated Discharging Current', 'Battery', 'A'),
  rated_charge_current_a_note:         T('Charging Current Note',     'Battery'),
  rated_charging_power_w:              T('Rated Charging Power',      'Battery', 'W', { hint: '390W/12V; 780W/24V' }),
  pv_max_voc_v:                        N('PV Max Open-Circuit Voltage', 'PV Input', 'V', { highlight: true }),
  mppt_voltage_range_v:                T('MPPT Voltage Range',        'PV Input', 'V'),
  max_conversion_efficiency_percent:   N('Max Conversion Efficiency', 'PV Input', '%'),
  max_load_efficiency_percent:         N('Max Load Efficiency',       'PV Input', '%'),
  tracking_efficiency_percent:         T('Tracking Efficiency',       'PV Input', '%'),
  self_consumption_ma:                 T('Self-Consumption',          'PV Input', 'mA'),
  discharge_circuit_voltage_drop_v:    T('Discharge-Circuit Voltage Drop', 'PV Input', 'V'),
  temperature_compensation:            T('Temperature Compensation',  'Battery', undefined, { hint: '-3mV/°C/2V' }),
  grounding_type:                      T('Grounding Type',            'Balance of System', undefined, { hint: 'Common negative' }),
  battery_types:                       T('Battery Types Supported',   'Battery', undefined, { hint: 'Lithium, gel, sealed' }),
  dimensions_mm:                       T('Dimensions (L × W × H)',    'Physical', 'mm'),
  mounting_size_mm:                    T('Mounting Size (L × W)',     'Physical', 'mm'),
  terminal_mm2:                        T('Terminal',                  'Physical', 'mm²'),
  recommended_cable_mm2:               N('Recommended Wire Size',     'Balance of System', 'mm²'),
  pv_inputs:                           N('PV Inputs',                 'PV Input'),
  pollution_degree:                    T('Pollution Degree',          'General', undefined, { hint: 'PD2' }),

  // ── PV module · electrical at STC ─────────────────────────────────────────
  power_stc_w:        N('Peak Power (Pmax)',           'Electrical (STC)', 'W', { highlight: true }),
  efficiency_percent: N('Module Efficiency',           'Electrical (STC)', '%', { highlight: true }),
  voc_stc_v:          N('Open-Circuit Voltage (Voc)',  'Electrical (STC)', 'V', { highlight: true }),
  vmp_stc_v:          N('Max Power Voltage (Vmp)',     'Electrical (STC)', 'V'),
  isc_stc_a:          N('Short-Circuit Current (Isc)', 'Electrical (STC)', 'A'),
  imp_stc_a:          N('Operating Current (Imp)',     'Electrical (STC)', 'A'),
  power_tolerance:    T('Power Tolerance',             'Electrical (STC)', undefined, { hint: '0 to +5 W' }),

  // ── PV module · electrical at NOCT ────────────────────────────────────────
  noct_c:       T('NOCT',           'Electrical (NOCT)', '°C', { hint: '45 ± 2' }),
  power_noct_w: N('Power at NOCT',  'Electrical (NOCT)', 'W'),
  voc_noct_v:   N('Voc at NOCT',    'Electrical (NOCT)', 'V'),
  vmp_noct_v:   N('Vmp at NOCT',    'Electrical (NOCT)', 'V'),
  isc_noct_a:   N('Isc at NOCT',    'Electrical (NOCT)', 'A'),
  imp_noct_a:   N('Imp at NOCT',    'Electrical (NOCT)', 'A'),

  // ── PV module · temperature coefficients ──────────────────────────────────
  temp_coeff_pmax_percent_per_c: N('Temp Coeff. Pmax', 'Temperature Coefficients', '%/°C'),
  temp_coeff_voc_percent_per_c:  N('Temp Coeff. Voc',  'Temperature Coefficients', '%/°C'),
  temp_coeff_isc_percent_per_c:  N('Temp Coeff. Isc',  'Temperature Coefficients', '%/°C'),

  // ── Physical (both categories) ────────────────────────────────────────────
  dimensions_l_w_h_mm: T('Dimensions (L × W × H)', 'Physical', 'mm', { hint: '2278 x 1134 x 30' }),
  dimensions_d_w_h_mm: T('Dimensions (D × W × H)', 'Physical', 'mm', { hint: '140 x 295 x 468' }),
  weight_kg:           N('Weight',            'Physical', 'kg'),
  number_of_cells:     N('Number of Cells',   'Physical', 'cells'),
  cell_configuration:  T('Cell Configuration','Physical', undefined, { hint: '6 x 24' }),
  cell_size_mm:        T('Cell Size',         'Physical', 'mm'),
  cell_type:           T('Cell Type',         'Physical'),
  bifacial:            { label: 'Bifacial',   group: 'Physical', kind: 'boolean' },
  bifaciality_percent: N('Bifaciality',       'Physical', '%'),
  frame_material:      T('Frame Material',    'Physical'),
  front_glass:         T('Front Glass',       'Physical'),
  back_glass:          T('Back Glass',        'Physical'),
  encapsulant:         T('Encapsulant',       'Physical'),
  communication_interfaces: T('Communication', 'Physical'),
  intelligent_slot:         T('Intelligent Slot', 'Physical'),

  // ── Balance of system (PV module) ─────────────────────────────────────────
  max_series_fuse_a:       N('Max Series Fuse',     'Balance of System', 'A'),
  cable_cross_section_mm2: N('Cable Cross-Section', 'Balance of System', 'mm²'),
  cable_length_mm:         T('Cable Length',        'Balance of System', 'mm'),
  connector_type:          T('Connector Type',      'Balance of System'),
  junction_box:            T('Junction Box',        'Balance of System'),

  // ── System limits (PV module) ─────────────────────────────────────────────
  max_system_voltage_vdc: N('Max System Voltage',   'System Limits', 'VDC', { highlight: true }),
  operating_temp_range_c: T('Operating Temperature','System Limits', '°C', { hint: '-40 to +85' }),

  // ── Logistics ─────────────────────────────────────────────────────────────
  packing_pcs_per_container_40ft:     N('Total Pcs / 40ft',      'Logistics', 'pcs'),
  packing_pcs_per_pallet:             N('Pcs per Pallet',        'Logistics', 'pcs'),
  packing_pallets_per_container_40ft: N('Pallets per Container', 'Logistics', 'pallets'),

  // ── General ───────────────────────────────────────────────────────────────
  product_warranty_years:        N('Product Warranty',      'General', 'years'),
  performance_warranty_years:    N('Performance Warranty',  'General', 'years'),
  certifications:                { label: 'Certifications', group: 'General', kind: 'list' },
  humidity_range_percent:        T('Humidity',              'General', '%'),
  operating_temperature_range_c: T('Operating Temperature', 'General', '°C', { hint: '-10 to 50' }),
  storage_temperature_range_c:   T('Storage Temperature',   'General', '°C'),
};

/** Turn `packing_pcs_per_pallet` into "Packing Pcs Per Pallet". */
export const prettifyKey = (key: string): string =>
  key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Metadata for a key, invented from the key itself when it is not declared —
 * an undeclared key is still shown rather than swallowed, because a spec
 * nobody anticipated is data.
 */
export const fieldMeta = (key: string): SpecFieldMeta =>
  SPEC_FIELD_META[key] ?? { label: prettifyKey(key), group: 'General', kind: 'text' };

/** Every declared key that names this group, in declaration order. */
export const fieldsInGroup = (keys: readonly string[], group: string): string[] =>
  keys.filter((k) => fieldMeta(k).group === group);

/** The groups this key list touches, in SPEC_GROUP_ORDER. */
export const groupsFor = (keys: readonly string[]): string[] => {
  const present = new Set(keys.map((k) => fieldMeta(k).group));
  return SPEC_GROUP_ORDER.filter((g) => present.has(g));
};

/** Is this value an answer, or an unanswered field? */
export const isAnswered = (v: unknown): boolean =>
  v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === '')
  && !(Array.isArray(v) && v.length === 0);

/** One value, as a person reads it. */
export function displaySpecValue(v: unknown): string {
  if (!isAnswered(v)) return '—';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

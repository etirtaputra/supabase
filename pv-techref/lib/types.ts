// ─────────────────────────────────────────
// Category definitions
// ─────────────────────────────────────────

export type CategorySlug =
  | "pv-modules"
  | "hybrid-inverters"
  | "batteries"
  | "solar-charge-controllers"
  | "on-grid-inverters";

export interface CategoryInfo {
  slug: CategorySlug;
  label: string;
  table: string;
  color: string;
  textColor: string;
  borderColor: string;
  bgColor: string;
  icon: string;
}

export const CATEGORIES: CategoryInfo[] = [
  {
    slug: "pv-modules",
    label: "PV Modules",
    table: "pv_modules",
    color: "#10b981",
    textColor: "text-emerald-400",
    borderColor: "border-emerald-500",
    bgColor: "bg-emerald-500/10",
    icon: "☀️",
  },
  {
    slug: "hybrid-inverters",
    label: "Hybrid Inverters",
    table: "hybrid_inverters",
    color: "#8b5cf6",
    textColor: "text-violet-400",
    borderColor: "border-violet-500",
    bgColor: "bg-violet-500/10",
    icon: "⚡",
  },
  {
    slug: "batteries",
    label: "Batteries",
    table: "batteries",
    color: "#f59e0b",
    textColor: "text-amber-400",
    borderColor: "border-amber-500",
    bgColor: "bg-amber-500/10",
    icon: "🔋",
  },
  {
    slug: "solar-charge-controllers",
    label: "Solar Charge Controllers",
    table: "solar_charge_controllers",
    color: "#0ea5e9",
    textColor: "text-sky-400",
    borderColor: "border-sky-500",
    bgColor: "bg-sky-500/10",
    icon: "🎛️",
  },
  {
    slug: "on-grid-inverters",
    label: "On-Grid Inverters",
    table: "on_grid_inverters",
    color: "#f43f5e",
    textColor: "text-rose-400",
    borderColor: "border-rose-500",
    bgColor: "bg-rose-500/10",
    icon: "🔌",
  },
];

// ─────────────────────────────────────────
// Product type interfaces
// ─────────────────────────────────────────

export interface PVModule {
  id: string;
  model: string;
  cell_type: string | null;
  cell_size_mm: string | null;
  number_of_cells: number | null;
  cell_configuration: string | null;
  power_stc_w: number | null;
  power_noct_w: number | null;
  efficiency_percent: number | null;
  vmp_stc_v: number | null;
  vmp_noct_v: number | null;
  imp_stc_a: number | null;
  imp_noct_a: number | null;
  voc_stc_v: number | null;
  voc_noct_v: number | null;
  isc_stc_a: number | null;
  isc_noct_a: number | null;
  power_tolerance: string | null;
  temp_coeff_voc_percent_per_c: number | null;
  temp_coeff_pmax_percent_per_c: number | null;
  temp_coeff_isc_percent_per_c: number | null;
  max_system_voltage_vdc: number | null;
  max_series_fuse_a: number | null;
  operating_temp_range_c: string | null;
  noct_c: string | null;
  dimensions_l_w_h_mm: string | null;
  weight_kg: number | null;
  glass_description: string | null;
  frame_material: string | null;
  junction_box: string | null;
  connector_type: string | null;
  cable_cross_section_mm2: number | null;
  cable_length_mm: string | null;
  certifications: string[] | null;
  selling_price_idr: number | null;
  created_at: string;
}

export interface HybridInverter {
  id: string;
  model: string;
  system_type: string | null;
  rated_output_power_w: number | null;
  surge_power_va: number | null;
  waveform: string | null;
  efficiency_dc_to_ac_percent: string | null;
  max_conversion_efficiency_dc_ac_percent: number | null;
  efficiency_peak_percent: number | null;
  transfer_time_ms: string | null;
  pv_solar_charger_type: string | null;
  pv_max_input_power_w: number | null;
  pv_nominal_voltage_vdc: number | null;
  pv_max_open_circuit_voltage_vdc: number | null;
  pv_mppt_voltage_range_vdc: string | null;
  no_of_mpp_trackers: number | null;
  max_pv_input_current_a: string | null;
  battery_nominal_voltage_vdc: number | null;
  battery_voltage_range_vdc: string | null;
  battery_floating_charge_voltage_vdc: number | null;
  battery_overcharge_protection_vdc: number | null;
  max_solar_charging_current_a: string | null;
  max_ac_charging_current_a: number | null;
  max_total_charging_current_a: string | null;
  ac_input_voltage_range_vac: string | null;
  ac_start_up_voltage_vac: string | null;
  ac_input_frequency_hz: string | null;
  max_ac_input_current_a: number | null;
  nominal_output_voltage_vac: string | null;
  output_voltage_regulation: string | null;
  phase: string | null;
  parallel_operation: string | null;
  communication_interfaces: string | null;
  monitoring: string | null;
  intelligent_slot: string | null;
  operating_temperature_range_c: string | null;
  storage_temperature_range_c: string | null;
  humidity_range_percent: string | null;
  dimensions_d_w_h_mm: string | null;
  weight_kg: number | null;
  selling_price_idr: number | null;
  created_at: string;
}

export interface Battery {
  id: string;
  model: string;
  battery_type: string | null;
  nominal_voltage_v: number | null;
  rated_capacity_ah: number | null;
  minimal_capacity_ah: number | null;
  energy_wh: number | null;
  max_discharge_current_a: number | null;
  max_charge_current_a: number | null;
  rated_charge_current_a: number | null;
  charge_voltage_cycle_v: number | null;
  charge_voltage_float_v: number | null;
  charge_voltage_v: number | null;
  discharge_cut_off_voltage_v: number | null;
  internal_resistance_mohm: string | null;
  self_discharge_percent_per_month: string | null;
  cycle_life: string | null;
  configuration: string | null;
  operating_temp_range_charge_c: string | null;
  operating_temp_range_discharge_c: string | null;
  storage_temp_range_c: string | null;
  dimensions_l_w_h_mm: string | null;
  weight_kg: number | null;
  terminal_type: string | null;
  selling_price_idr: number | null;
  created_at: string;
}

export interface SolarChargeController {
  id: string;
  model: string;
  controller_type: string | null;
  rated_charge_current_a: number | null;
  rated_charging_power_w: string | null;
  system_voltage_v: string | null;
  controller_operating_voltage_range_v: string | null;
  pv_max_voc_v: number | null;
  mppt_voltage_range_v: string | null;
  max_conversion_efficiency_percent: number | null;
  max_load_efficiency_percent: number | null;
  tracking_efficiency_percent: string | null;
  self_consumption_ma: string | null;
  ip_rating: string | null;
  grounding_type: string | null;
  operating_temperature_range_c: string | null;
  recommended_cable_mm2: string | null;
  dimensions_mm: string | null;
  weight_kg: number | null;
  communication: string | null;
  battery_types: string | null;
  parallel_operation: string | null;
  pv_inputs: number | null;
  battery_temp_compensation: string | null;
  certifications: string | null;
  selling_price_idr: number | null;
  created_at: string;
}

export interface OnGridInverter {
  id: string;
  model: string;
  rated_output_power_kw: number | null;
  max_ac_apparent_power_kva: number | null;
  max_pv_input_power_kw: number | null;
  no_of_mppts: number | null;
  strings_per_mppt: number | null;
  pv_max_voltage_vdc: number | null;
  pv_nominal_voltage_vdc: number | null;
  pv_mppt_voltage_range_vdc: string | null;
  pv_start_voltage_vdc: number | null;
  max_input_current_per_mppt_a: number | null;
  max_short_circuit_current_per_mppt_a: number | null;
  nominal_ac_voltage_vac: string | null;
  ac_grid_frequency_range_hz: string | null;
  max_output_current_a: number | null;
  power_factor_cos_phi: string | null;
  thdi_percent: string | null;
  max_efficiency_percent: number | null;
  euro_efficiency_percent: number | null;
  surge_protection_dc_ac: string | null;
  dc_reverse_polarity_protection: string | null;
  ac_short_circuit_protection: string | null;
  anti_islanding_protection: string | null;
  output_over_current_protection: string | null;
  dc_switch: string | null;
  string_fault_detection: string | null;
  insulation_detection: string | null;
  ip_rating: string | null;
  cooling_type: string | null;
  operating_temperature_range_c: string | null;
  max_operating_humidity_percent: string | null;
  max_operating_altitude_m: number | null;
  topology: string | null;
  communication_interfaces: string | null;
  display: string | null;
  certifications: string | null;
  dimensions_w_h_d_mm: string | null;
  weight_kg: number | null;
  selling_price_idr: number | null;
  created_at: string;
}

export type AnyProduct =
  | PVModule
  | HybridInverter
  | Battery
  | SolarChargeController
  | OnGridInverter;

export interface SearchResult {
  id: string;
  model: string;
  category: CategorySlug;
  categoryLabel: string;
  keySummary: string;
  selling_price_idr: number | null;
}

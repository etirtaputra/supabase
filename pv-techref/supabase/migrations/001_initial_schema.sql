-- Enable full-text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─────────────────────────────────────────
-- TABLE: pv_modules
-- ─────────────────────────────────────────
CREATE TABLE pv_modules (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model                           TEXT NOT NULL UNIQUE,
  cell_type                       TEXT,
  cell_size_mm                    TEXT,
  number_of_cells                 INTEGER,
  cell_configuration              TEXT,
  power_stc_w                     NUMERIC,
  power_noct_w                    NUMERIC,
  efficiency_percent              NUMERIC,
  vmp_stc_v                       NUMERIC,
  vmp_noct_v                      NUMERIC,
  imp_stc_a                       NUMERIC,
  imp_noct_a                      NUMERIC,
  voc_stc_v                       NUMERIC,
  voc_noct_v                      NUMERIC,
  isc_stc_a                       NUMERIC,
  isc_noct_a                      NUMERIC,
  power_tolerance                 TEXT,
  temp_coeff_voc_percent_per_c    NUMERIC,
  temp_coeff_pmax_percent_per_c   NUMERIC,
  temp_coeff_isc_percent_per_c    NUMERIC,
  max_system_voltage_vdc          NUMERIC,
  max_series_fuse_a               NUMERIC,
  operating_temp_range_c          TEXT,
  noct_c                          TEXT,
  dimensions_l_w_h_mm             TEXT,
  weight_kg                       NUMERIC,
  glass_description               TEXT,
  frame_material                  TEXT,
  junction_box                    TEXT,
  connector_type                  TEXT,
  cable_cross_section_mm2         NUMERIC,
  cable_length_mm                 TEXT,
  certifications                  TEXT[],
  selling_price_idr               NUMERIC,
  created_at                      TIMESTAMPTZ DEFAULT now(),
  search_vector                   TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(model, '') || ' ' || coalesce(cell_type, ''))
  ) STORED
);
CREATE INDEX pv_modules_search_idx ON pv_modules USING GIN(search_vector);
CREATE INDEX pv_modules_model_trgm_idx ON pv_modules USING GIN(model gin_trgm_ops);

-- ─────────────────────────────────────────
-- TABLE: hybrid_inverters
-- ─────────────────────────────────────────
CREATE TABLE hybrid_inverters (
  id                                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model                                     TEXT NOT NULL UNIQUE,
  system_type                               TEXT,
  rated_output_power_w                      NUMERIC,
  surge_power_va                            NUMERIC,
  waveform                                  TEXT,
  efficiency_dc_to_ac_percent               TEXT,
  max_conversion_efficiency_dc_ac_percent   NUMERIC,
  efficiency_peak_percent                   NUMERIC,
  transfer_time_ms                          TEXT,
  pv_solar_charger_type                     TEXT,
  pv_max_input_power_w                      NUMERIC,
  pv_nominal_voltage_vdc                    NUMERIC,
  pv_max_open_circuit_voltage_vdc           NUMERIC,
  pv_mppt_voltage_range_vdc                 TEXT,
  no_of_mpp_trackers                        INTEGER,
  max_pv_input_current_a                    TEXT,
  battery_nominal_voltage_vdc               NUMERIC,
  battery_voltage_range_vdc                 TEXT,
  battery_floating_charge_voltage_vdc       NUMERIC,
  battery_overcharge_protection_vdc         NUMERIC,
  max_solar_charging_current_a              TEXT,
  max_ac_charging_current_a                 NUMERIC,
  max_total_charging_current_a              TEXT,
  ac_input_voltage_range_vac                TEXT,
  ac_start_up_voltage_vac                   TEXT,
  ac_input_frequency_hz                     TEXT,
  max_ac_input_current_a                    NUMERIC,
  nominal_output_voltage_vac                TEXT,
  output_voltage_regulation                 TEXT,
  phase                                     TEXT,
  parallel_operation                        TEXT,
  communication_interfaces                  TEXT,
  monitoring                                TEXT,
  intelligent_slot                          TEXT,
  operating_temperature_range_c             TEXT,
  storage_temperature_range_c               TEXT,
  humidity_range_percent                    TEXT,
  dimensions_d_w_h_mm                       TEXT,
  weight_kg                                 NUMERIC,
  selling_price_idr                         NUMERIC,
  created_at                                TIMESTAMPTZ DEFAULT now(),
  search_vector                             TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(model, '') || ' ' || coalesce(system_type, '') || ' ' || coalesce(phase, ''))
  ) STORED
);
CREATE INDEX hybrid_inverters_search_idx ON hybrid_inverters USING GIN(search_vector);
CREATE INDEX hybrid_inverters_model_trgm_idx ON hybrid_inverters USING GIN(model gin_trgm_ops);

-- ─────────────────────────────────────────
-- TABLE: batteries
-- ─────────────────────────────────────────
CREATE TABLE batteries (
  id                                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model                               TEXT NOT NULL UNIQUE,
  battery_type                        TEXT,
  nominal_voltage_v                   NUMERIC,
  rated_capacity_ah                   NUMERIC,
  minimal_capacity_ah                 NUMERIC,
  energy_wh                           NUMERIC,
  max_discharge_current_a             NUMERIC,
  max_charge_current_a                NUMERIC,
  rated_charge_current_a              NUMERIC,
  charge_voltage_cycle_v              NUMERIC,
  charge_voltage_float_v              NUMERIC,
  charge_voltage_v                    NUMERIC,
  discharge_cut_off_voltage_v         NUMERIC,
  internal_resistance_mohm            TEXT,
  self_discharge_percent_per_month    TEXT,
  cycle_life                          TEXT,
  configuration                       TEXT,
  operating_temp_range_charge_c       TEXT,
  operating_temp_range_discharge_c    TEXT,
  storage_temp_range_c                TEXT,
  dimensions_l_w_h_mm                 TEXT,
  weight_kg                           NUMERIC,
  terminal_type                       TEXT,
  selling_price_idr                   NUMERIC,
  created_at                          TIMESTAMPTZ DEFAULT now(),
  search_vector                       TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(model, '') || ' ' || coalesce(battery_type, ''))
  ) STORED
);
CREATE INDEX batteries_search_idx ON batteries USING GIN(search_vector);
CREATE INDEX batteries_model_trgm_idx ON batteries USING GIN(model gin_trgm_ops);

-- ─────────────────────────────────────────
-- TABLE: solar_charge_controllers
-- ─────────────────────────────────────────
CREATE TABLE solar_charge_controllers (
  id                                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model                                 TEXT NOT NULL UNIQUE,
  controller_type                       TEXT,
  rated_charge_current_a                NUMERIC,
  rated_charging_power_w                TEXT,
  system_voltage_v                      TEXT,
  controller_operating_voltage_range_v  TEXT,
  pv_max_voc_v                          NUMERIC,
  mppt_voltage_range_v                  TEXT,
  max_conversion_efficiency_percent     NUMERIC,
  max_load_efficiency_percent           NUMERIC,
  tracking_efficiency_percent           TEXT,
  self_consumption_ma                   TEXT,
  ip_rating                             TEXT,
  grounding_type                        TEXT,
  operating_temperature_range_c         TEXT,
  recommended_cable_mm2                 TEXT,
  dimensions_mm                         TEXT,
  weight_kg                             NUMERIC,
  communication                         TEXT,
  battery_types                         TEXT,
  parallel_operation                    TEXT,
  pv_inputs                             INTEGER,
  battery_temp_compensation             TEXT,
  certifications                        TEXT,
  selling_price_idr                     NUMERIC,
  created_at                            TIMESTAMPTZ DEFAULT now(),
  search_vector                         TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(model, '') || ' ' || coalesce(controller_type, '') || ' ' || coalesce(system_voltage_v, ''))
  ) STORED
);
CREATE INDEX solar_charge_controllers_search_idx ON solar_charge_controllers USING GIN(search_vector);
CREATE INDEX solar_charge_controllers_model_trgm_idx ON solar_charge_controllers USING GIN(model gin_trgm_ops);

-- ─────────────────────────────────────────
-- TABLE: on_grid_inverters
-- ─────────────────────────────────────────
CREATE TABLE on_grid_inverters (
  id                                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model                                 TEXT NOT NULL UNIQUE,
  rated_output_power_kw                 NUMERIC,
  max_ac_apparent_power_kva             NUMERIC,
  max_pv_input_power_kw                 NUMERIC,
  no_of_mppts                           INTEGER,
  strings_per_mppt                      INTEGER,
  pv_max_voltage_vdc                    NUMERIC,
  pv_nominal_voltage_vdc                NUMERIC,
  pv_mppt_voltage_range_vdc             TEXT,
  pv_start_voltage_vdc                  NUMERIC,
  max_input_current_per_mppt_a          NUMERIC,
  max_short_circuit_current_per_mppt_a  NUMERIC,
  nominal_ac_voltage_vac                TEXT,
  ac_grid_frequency_range_hz            TEXT,
  max_output_current_a                  NUMERIC,
  power_factor_cos_phi                  TEXT,
  thdi_percent                          TEXT,
  max_efficiency_percent                NUMERIC,
  euro_efficiency_percent               NUMERIC,
  surge_protection_dc_ac                TEXT,
  dc_reverse_polarity_protection        TEXT,
  ac_short_circuit_protection           TEXT,
  anti_islanding_protection             TEXT,
  output_over_current_protection        TEXT,
  dc_switch                             TEXT,
  string_fault_detection                TEXT,
  insulation_detection                  TEXT,
  ip_rating                             TEXT,
  cooling_type                          TEXT,
  operating_temperature_range_c         TEXT,
  max_operating_humidity_percent        TEXT,
  max_operating_altitude_m              NUMERIC,
  topology                              TEXT,
  communication_interfaces              TEXT,
  display                               TEXT,
  certifications                        TEXT,
  dimensions_w_h_d_mm                   TEXT,
  weight_kg                             NUMERIC,
  selling_price_idr                     NUMERIC,
  created_at                            TIMESTAMPTZ DEFAULT now(),
  search_vector                         TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(model, '') || ' ' || coalesce(topology, '') || ' ' || coalesce(nominal_ac_voltage_vac, ''))
  ) STORED
);
CREATE INDEX on_grid_inverters_search_idx ON on_grid_inverters USING GIN(search_vector);
CREATE INDEX on_grid_inverters_model_trgm_idx ON on_grid_inverters USING GIN(model gin_trgm_ops);

-- ─────────────────────────────────────────
-- Enable Row Level Security (RLS) — read-only public access
-- ─────────────────────────────────────────
ALTER TABLE pv_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE hybrid_inverters ENABLE ROW LEVEL SECURITY;
ALTER TABLE batteries ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar_charge_controllers ENABLE ROW LEVEL SECURITY;
ALTER TABLE on_grid_inverters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON pv_modules FOR SELECT USING (true);
CREATE POLICY "Public read access" ON hybrid_inverters FOR SELECT USING (true);
CREATE POLICY "Public read access" ON batteries FOR SELECT USING (true);
CREATE POLICY "Public read access" ON solar_charge_controllers FOR SELECT USING (true);
CREATE POLICY "Public read access" ON on_grid_inverters FOR SELECT USING (true);

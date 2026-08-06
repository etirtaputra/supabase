/**
 * The component database embedded in "Smart Solar BoM v7", extracted verbatim.
 * The golden tests feed the engine EXACTLY what the HTML app chooses from, so
 * a parity failure can only mean the arithmetic diverged — never that the two
 * were shown different catalogs.
 */
import type { PanelSpec, OnGridInverterSpec, HybridInverterSpec, BatterySpec } from './system.ts';

export const V7_PANELS: PanelSpec[] = [
  {
    "model": "ICA100-36M",
    "power_stc_w": 100,
    "voc_stc_v": 26.91,
    "dimensions_l_w_h_mm": "890 x 580 x 28"
  },
  {
    "model": "ICA200-72M",
    "power_stc_w": 200,
    "voc_stc_v": 56.74,
    "dimensions_l_w_h_mm": "1328 x 765 x 28"
  },
  {
    "model": "ICA390-72MF",
    "power_stc_w": 390,
    "voc_stc_v": 49.2,
    "dimensions_l_w_h_mm": "1979 x 1002 x 35"
  },
  {
    "model": "ICA450-72HMG",
    "power_stc_w": 450,
    "voc_stc_v": 50,
    "dimensions_l_w_h_mm": "2108 x 1048 x 35"
  },
  {
    "model": "ICA550-72HMI",
    "power_stc_w": 550,
    "voc_stc_v": 50.2,
    "dimensions_l_w_h_mm": "2278 x 1134 x 35"
  }
];

export const V7_ON_GRID_INVERTERS: OnGridInverterSpec[] = [
  {
    "model": "SNV-GT2023SSC",
    "rated_output_power_kw": 2,
    "nominal_ac_voltage_vac": "230 L-N",
    "pv_max_voltage_vdc": 600,
    "no_of_mppts": 1,
    "strings_per_mppt": 1
  },
  {
    "model": "SNV-GT3023SSC",
    "rated_output_power_kw": 3,
    "nominal_ac_voltage_vac": "230 L-N",
    "pv_max_voltage_vdc": 600,
    "no_of_mppts": 1,
    "strings_per_mppt": 1
  },
  {
    "model": "SNV-GT5023DSC",
    "rated_output_power_kw": 5,
    "nominal_ac_voltage_vac": "230 L-N",
    "pv_max_voltage_vdc": 600,
    "no_of_mppts": 2,
    "strings_per_mppt": 1
  },
  {
    "model": "SNV-GT5023DT",
    "rated_output_power_kw": 5,
    "nominal_ac_voltage_vac": "400 3L+N",
    "pv_max_voltage_vdc": 1100,
    "no_of_mppts": 2,
    "strings_per_mppt": 1
  },
  {
    "model": "SNV-GT1033DT",
    "rated_output_power_kw": 10,
    "nominal_ac_voltage_vac": "400 3L+N",
    "pv_max_voltage_vdc": 1100,
    "no_of_mppts": 2,
    "strings_per_mppt": 1
  },
  {
    "model": "SNV-GT3033TT",
    "rated_output_power_kw": 30,
    "nominal_ac_voltage_vac": "400 3L+N+PE",
    "pv_max_voltage_vdc": 1100,
    "no_of_mppts": 3,
    "strings_per_mppt": 2
  },
  {
    "model": "SNV-GT5033QT",
    "rated_output_power_kw": 50,
    "nominal_ac_voltage_vac": "400 3L+N+PE",
    "pv_max_voltage_vdc": 1100,
    "no_of_mppts": 4,
    "strings_per_mppt": 2
  },
  {
    "model": "SNV-GT6033QT",
    "rated_output_power_kw": 60,
    "nominal_ac_voltage_vac": "400 3L+N+PE",
    "pv_max_voltage_vdc": 1100,
    "no_of_mppts": 4,
    "strings_per_mppt": 2
  },
  {
    "model": "SNV-GT8033QT",
    "rated_output_power_kw": 80,
    "nominal_ac_voltage_vac": "400 3L+N+PE",
    "pv_max_voltage_vdc": 1100,
    "no_of_mppts": 4,
    "strings_per_mppt": 3
  }
];

export const V7_HYBRID_INVERTERS: HybridInverterSpec[] = [
  {
    "model": "SNV-GF1021",
    "rated_output_power_w": 1000,
    "battery_nominal_voltage_vdc": 24,
    "surge_power_va": 2000,
    "pv_max_open_circuit_voltage_vdc": 102,
    "no_of_mpp_trackers": 1,
    "phase": "1-phase"
  },
  {
    "model": "SNV-GH2041",
    "rated_output_power_w": 2000,
    "battery_nominal_voltage_vdc": 48,
    "pv_max_open_circuit_voltage_vdc": 450,
    "no_of_mpp_trackers": 1,
    "phase": "1-phase in/1-phase out"
  },
  {
    "model": "SNV-GH3041",
    "rated_output_power_w": 3000,
    "battery_nominal_voltage_vdc": 48,
    "pv_max_open_circuit_voltage_vdc": 450,
    "no_of_mpp_trackers": 1,
    "phase": "1-phase in/1-phase out"
  },
  {
    "model": "SNV-GH5042",
    "rated_output_power_w": 5000,
    "battery_nominal_voltage_vdc": 48,
    "pv_max_open_circuit_voltage_vdc": 450,
    "no_of_mpp_trackers": 1,
    "phase": "1-phase in/1-phase out"
  },
  {
    "model": "SNV-GH10041",
    "rated_output_power_w": 10000,
    "battery_nominal_voltage_vdc": 48,
    "pv_max_open_circuit_voltage_vdc": 900,
    "no_of_mpp_trackers": 2,
    "phase": "3-phase in/3-phase out"
  },
  {
    "model": "SNV-GH30081",
    "rated_output_power_w": 30000,
    "pv_max_open_circuit_voltage_vdc": 1000,
    "no_of_mpp_trackers": 3,
    "phase": "3-phase"
  },
  {
    "model": "SNV-GHT30071",
    "rated_output_power_w": 30000,
    "battery_nominal_voltage_vdc": 384,
    "pv_max_open_circuit_voltage_vdc": 950,
    "no_of_mpp_trackers": 1,
    "phase": "3-phase"
  }
];

export const V7_BATTERIES: BatterySpec[] = [
  {
    "model": "LIP12100D",
    "battery_type": "Lead-Acid (Deep Cycle)",
    "nominal_voltage_v": 12,
    "energy_wh": 1200,
    "rated_capacity_ah": 100
  },
  {
    "model": "LIP12200D",
    "battery_type": "Lead-Acid (Deep Cycle)",
    "nominal_voltage_v": 12,
    "energy_wh": 2400,
    "rated_capacity_ah": 200
  },
  {
    "model": "LIP48100LF",
    "battery_type": "LiFePO4 (with BMS)",
    "nominal_voltage_v": 48,
    "energy_wh": 4800,
    "rated_capacity_ah": 100
  }
];

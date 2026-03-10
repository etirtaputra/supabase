"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, notFound } from "next/navigation";
import { ChevronRight, Printer } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import {
  CategorySlug,
  PVModule,
  HybridInverter,
  Battery,
  SolarChargeController,
  OnGridInverter,
  CATEGORIES,
} from "@/lib/types";
import { formatIDR, getCategoryInfo } from "@/lib/utils";
import CategoryBadge from "../../components/CategoryBadge";
import SpecTable, { SpecSection } from "../../components/SpecTable";

// Build spec sections for each product type
function buildPVModuleSections(product: PVModule): SpecSection[] {
  return [
    {
      title: "Electrical — STC (Standard Test Conditions)",
      rows: [
        { key: "power_stc_w", label: "Peak Power (Pmax)", value: product.power_stc_w, unit: "W" },
        { key: "efficiency_percent", label: "Module Efficiency", value: product.efficiency_percent, unit: "%" },
        { key: "vmp_stc_v", label: "Maximum Power Voltage (Vmp)", value: product.vmp_stc_v, unit: "V" },
        { key: "imp_stc_a", label: "Maximum Power Current (Imp)", value: product.imp_stc_a, unit: "A" },
        { key: "voc_stc_v", label: "Open Circuit Voltage (Voc)", value: product.voc_stc_v, unit: "V" },
        { key: "isc_stc_a", label: "Short Circuit Current (Isc)", value: product.isc_stc_a, unit: "A" },
        { key: "power_tolerance", label: "Power Tolerance", value: product.power_tolerance },
      ],
    },
    {
      title: "Electrical — NOCT (Normal Operating Cell Temperature)",
      rows: [
        { key: "power_noct_w", label: "Peak Power (Pmax)", value: product.power_noct_w, unit: "W" },
        { key: "vmp_noct_v", label: "Maximum Power Voltage (Vmp)", value: product.vmp_noct_v, unit: "V" },
        { key: "imp_noct_a", label: "Maximum Power Current (Imp)", value: product.imp_noct_a, unit: "A" },
        { key: "voc_noct_v", label: "Open Circuit Voltage (Voc)", value: product.voc_noct_v, unit: "V" },
        { key: "isc_noct_a", label: "Short Circuit Current (Isc)", value: product.isc_noct_a, unit: "A" },
        { key: "noct_c", label: "NOCT", value: product.noct_c, unit: "°C" },
      ],
    },
    {
      title: "Temperature Coefficients",
      rows: [
        { key: "temp_coeff_pmax", label: "Pmax Temp. Coefficient", value: product.temp_coeff_pmax_percent_per_c, unit: "%/°C" },
        { key: "temp_coeff_voc", label: "Voc Temp. Coefficient", value: product.temp_coeff_voc_percent_per_c, unit: "%/°C" },
        { key: "temp_coeff_isc", label: "Isc Temp. Coefficient", value: product.temp_coeff_isc_percent_per_c, unit: "%/°C" },
      ],
    },
    {
      title: "System Limits",
      rows: [
        { key: "max_system_voltage_vdc", label: "Max System Voltage", value: product.max_system_voltage_vdc, unit: "VDC" },
        { key: "max_series_fuse_a", label: "Max Series Fuse Rating", value: product.max_series_fuse_a, unit: "A" },
        { key: "operating_temp_range_c", label: "Operating Temp Range", value: product.operating_temp_range_c, unit: "°C" },
      ],
    },
    {
      title: "Cell Technology",
      rows: [
        { key: "cell_type", label: "Cell Type", value: product.cell_type },
        { key: "cell_size_mm", label: "Cell Size", value: product.cell_size_mm, unit: "mm" },
        { key: "number_of_cells", label: "Number of Cells", value: product.number_of_cells },
        { key: "cell_configuration", label: "Cell Configuration", value: product.cell_configuration },
      ],
    },
    {
      title: "Mechanical",
      rows: [
        { key: "dimensions_l_w_h_mm", label: "Dimensions (L×W×H)", value: product.dimensions_l_w_h_mm, unit: "mm" },
        { key: "weight_kg", label: "Weight", value: product.weight_kg, unit: "kg" },
        { key: "glass_description", label: "Glass", value: product.glass_description },
        { key: "frame_material", label: "Frame Material", value: product.frame_material },
        { key: "junction_box", label: "Junction Box", value: product.junction_box },
        { key: "connector_type", label: "Connector Type", value: product.connector_type },
        { key: "cable_cross_section_mm2", label: "Cable Cross Section", value: product.cable_cross_section_mm2, unit: "mm²" },
        { key: "cable_length_mm", label: "Cable Length", value: product.cable_length_mm, unit: "mm" },
      ],
    },
    {
      title: "Certifications",
      rows: [
        { key: "certifications", label: "Certifications", value: product.certifications },
      ],
    },
  ];
}

function buildHybridInverterSections(product: HybridInverter): SpecSection[] {
  return [
    {
      title: "Output",
      rows: [
        { key: "rated_output_power_w", label: "Rated Output Power", value: product.rated_output_power_w, unit: "W" },
        { key: "surge_power_va", label: "Surge Power", value: product.surge_power_va, unit: "VA" },
        { key: "waveform", label: "Output Waveform", value: product.waveform },
        { key: "nominal_output_voltage_vac", label: "Nominal Output Voltage", value: product.nominal_output_voltage_vac, unit: "VAC" },
        { key: "output_voltage_regulation", label: "Output Voltage Regulation", value: product.output_voltage_regulation },
        { key: "phase", label: "Phase", value: product.phase },
      ],
    },
    {
      title: "Efficiency & Transfer",
      rows: [
        { key: "efficiency_peak_percent", label: "Peak Efficiency", value: product.efficiency_peak_percent, unit: "%" },
        { key: "efficiency_dc_to_ac_percent", label: "DC-AC Efficiency", value: product.efficiency_dc_to_ac_percent, unit: "%" },
        { key: "max_conversion_efficiency_dc_ac_percent", label: "Max Conversion Efficiency", value: product.max_conversion_efficiency_dc_ac_percent, unit: "%" },
        { key: "transfer_time_ms", label: "Transfer Time", value: product.transfer_time_ms, unit: "ms" },
      ],
    },
    {
      title: "Solar PV Input",
      rows: [
        { key: "pv_solar_charger_type", label: "Solar Charger Type", value: product.pv_solar_charger_type },
        { key: "pv_max_input_power_w", label: "Max PV Input Power", value: product.pv_max_input_power_w, unit: "W" },
        { key: "pv_nominal_voltage_vdc", label: "PV Nominal Voltage", value: product.pv_nominal_voltage_vdc, unit: "VDC" },
        { key: "pv_max_open_circuit_voltage_vdc", label: "PV Max Open Circuit Voltage", value: product.pv_max_open_circuit_voltage_vdc, unit: "VDC" },
        { key: "pv_mppt_voltage_range_vdc", label: "MPPT Voltage Range", value: product.pv_mppt_voltage_range_vdc, unit: "VDC" },
        { key: "no_of_mpp_trackers", label: "Number of MPPT Trackers", value: product.no_of_mpp_trackers },
        { key: "max_pv_input_current_a", label: "Max PV Input Current", value: product.max_pv_input_current_a, unit: "A" },
      ],
    },
    {
      title: "Battery",
      rows: [
        { key: "battery_nominal_voltage_vdc", label: "Battery Nominal Voltage", value: product.battery_nominal_voltage_vdc, unit: "VDC" },
        { key: "battery_voltage_range_vdc", label: "Battery Voltage Range", value: product.battery_voltage_range_vdc, unit: "VDC" },
        { key: "battery_floating_charge_voltage_vdc", label: "Float Charge Voltage", value: product.battery_floating_charge_voltage_vdc, unit: "VDC" },
        { key: "battery_overcharge_protection_vdc", label: "Overcharge Protection Voltage", value: product.battery_overcharge_protection_vdc, unit: "VDC" },
        { key: "max_solar_charging_current_a", label: "Max Solar Charging Current", value: product.max_solar_charging_current_a, unit: "A" },
        { key: "max_ac_charging_current_a", label: "Max AC Charging Current", value: product.max_ac_charging_current_a, unit: "A" },
        { key: "max_total_charging_current_a", label: "Max Total Charging Current", value: product.max_total_charging_current_a, unit: "A" },
      ],
    },
    {
      title: "AC Input",
      rows: [
        { key: "ac_input_voltage_range_vac", label: "AC Input Voltage Range", value: product.ac_input_voltage_range_vac, unit: "VAC" },
        { key: "ac_start_up_voltage_vac", label: "AC Start-Up Voltage", value: product.ac_start_up_voltage_vac, unit: "VAC" },
        { key: "ac_input_frequency_hz", label: "AC Input Frequency", value: product.ac_input_frequency_hz, unit: "Hz" },
        { key: "max_ac_input_current_a", label: "Max AC Input Current", value: product.max_ac_input_current_a, unit: "A" },
      ],
    },
    {
      title: "Connectivity & Communication",
      rows: [
        { key: "parallel_operation", label: "Parallel Operation", value: product.parallel_operation },
        { key: "communication_interfaces", label: "Communication Interfaces", value: product.communication_interfaces },
        { key: "monitoring", label: "Monitoring", value: product.monitoring },
        { key: "intelligent_slot", label: "Intelligent Slot", value: product.intelligent_slot },
      ],
    },
    {
      title: "Environmental & Mechanical",
      rows: [
        { key: "operating_temperature_range_c", label: "Operating Temperature", value: product.operating_temperature_range_c, unit: "°C" },
        { key: "storage_temperature_range_c", label: "Storage Temperature", value: product.storage_temperature_range_c, unit: "°C" },
        { key: "humidity_range_percent", label: "Humidity Range", value: product.humidity_range_percent, unit: "%" },
        { key: "dimensions_d_w_h_mm", label: "Dimensions (D×W×H)", value: product.dimensions_d_w_h_mm, unit: "mm" },
        { key: "weight_kg", label: "Weight", value: product.weight_kg, unit: "kg" },
      ],
    },
  ];
}

function buildBatterySections(product: Battery): SpecSection[] {
  return [
    {
      title: "Electrical",
      rows: [
        { key: "battery_type", label: "Battery Type", value: product.battery_type },
        { key: "nominal_voltage_v", label: "Nominal Voltage", value: product.nominal_voltage_v, unit: "V" },
        { key: "rated_capacity_ah", label: "Rated Capacity", value: product.rated_capacity_ah, unit: "Ah" },
        { key: "minimal_capacity_ah", label: "Minimal Capacity", value: product.minimal_capacity_ah, unit: "Ah" },
        { key: "energy_wh", label: "Energy", value: product.energy_wh, unit: "Wh" },
        { key: "configuration", label: "Configuration", value: product.configuration },
      ],
    },
    {
      title: "Charge & Discharge",
      rows: [
        { key: "max_charge_current_a", label: "Max Charge Current", value: product.max_charge_current_a, unit: "A" },
        { key: "rated_charge_current_a", label: "Rated Charge Current", value: product.rated_charge_current_a, unit: "A" },
        { key: "max_discharge_current_a", label: "Max Discharge Current", value: product.max_discharge_current_a, unit: "A" },
        { key: "charge_voltage_cycle_v", label: "Charge Voltage (Cycle)", value: product.charge_voltage_cycle_v, unit: "V" },
        { key: "charge_voltage_float_v", label: "Charge Voltage (Float)", value: product.charge_voltage_float_v, unit: "V" },
        { key: "charge_voltage_v", label: "Charge Voltage", value: product.charge_voltage_v, unit: "V" },
        { key: "discharge_cut_off_voltage_v", label: "Discharge Cut-off Voltage", value: product.discharge_cut_off_voltage_v, unit: "V" },
      ],
    },
    {
      title: "Performance",
      rows: [
        { key: "internal_resistance_mohm", label: "Internal Resistance", value: product.internal_resistance_mohm, unit: "mΩ" },
        { key: "self_discharge_percent_per_month", label: "Self Discharge", value: product.self_discharge_percent_per_month, unit: "%/month" },
        { key: "cycle_life", label: "Cycle Life", value: product.cycle_life },
      ],
    },
    {
      title: "Environmental & Mechanical",
      rows: [
        { key: "operating_temp_range_charge_c", label: "Operating Temp (Charge)", value: product.operating_temp_range_charge_c, unit: "°C" },
        { key: "operating_temp_range_discharge_c", label: "Operating Temp (Discharge)", value: product.operating_temp_range_discharge_c, unit: "°C" },
        { key: "storage_temp_range_c", label: "Storage Temp Range", value: product.storage_temp_range_c, unit: "°C" },
        { key: "dimensions_l_w_h_mm", label: "Dimensions (L×W×H)", value: product.dimensions_l_w_h_mm, unit: "mm" },
        { key: "weight_kg", label: "Weight", value: product.weight_kg, unit: "kg" },
        { key: "terminal_type", label: "Terminal Type", value: product.terminal_type },
      ],
    },
  ];
}

function buildSCCSections(product: SolarChargeController): SpecSection[] {
  return [
    {
      title: "Charging",
      rows: [
        { key: "controller_type", label: "Controller Type", value: product.controller_type },
        { key: "rated_charge_current_a", label: "Rated Charge Current", value: product.rated_charge_current_a, unit: "A" },
        { key: "rated_charging_power_w", label: "Rated Charging Power", value: product.rated_charging_power_w },
        { key: "system_voltage_v", label: "System Voltage", value: product.system_voltage_v, unit: "V" },
        { key: "controller_operating_voltage_range_v", label: "Controller Operating Voltage", value: product.controller_operating_voltage_range_v, unit: "V" },
      ],
    },
    {
      title: "Solar PV Input",
      rows: [
        { key: "pv_max_voc_v", label: "PV Max Open Circuit Voltage", value: product.pv_max_voc_v, unit: "V" },
        { key: "mppt_voltage_range_v", label: "MPPT Voltage Range", value: product.mppt_voltage_range_v, unit: "V" },
        { key: "pv_inputs", label: "PV Inputs", value: product.pv_inputs },
      ],
    },
    {
      title: "Efficiency",
      rows: [
        { key: "max_conversion_efficiency_percent", label: "Max Conversion Efficiency", value: product.max_conversion_efficiency_percent, unit: "%" },
        { key: "max_load_efficiency_percent", label: "Max Load Efficiency", value: product.max_load_efficiency_percent, unit: "%" },
        { key: "tracking_efficiency_percent", label: "Tracking Efficiency", value: product.tracking_efficiency_percent, unit: "%" },
        { key: "self_consumption_ma", label: "Self Consumption", value: product.self_consumption_ma, unit: "mA" },
      ],
    },
    {
      title: "Connectivity & Battery",
      rows: [
        { key: "communication", label: "Communication", value: product.communication },
        { key: "battery_types", label: "Compatible Battery Types", value: product.battery_types },
        { key: "parallel_operation", label: "Parallel Operation", value: product.parallel_operation },
        { key: "battery_temp_compensation", label: "Battery Temp Compensation", value: product.battery_temp_compensation },
      ],
    },
    {
      title: "Environmental & Mechanical",
      rows: [
        { key: "ip_rating", label: "IP Rating", value: product.ip_rating },
        { key: "grounding_type", label: "Grounding Type", value: product.grounding_type },
        { key: "operating_temperature_range_c", label: "Operating Temperature", value: product.operating_temperature_range_c, unit: "°C" },
        { key: "recommended_cable_mm2", label: "Recommended Cable", value: product.recommended_cable_mm2, unit: "mm²" },
        { key: "dimensions_mm", label: "Dimensions", value: product.dimensions_mm, unit: "mm" },
        { key: "weight_kg", label: "Weight", value: product.weight_kg, unit: "kg" },
      ],
    },
    {
      title: "Certifications",
      rows: [
        { key: "certifications", label: "Certifications", value: product.certifications },
      ],
    },
  ];
}

function buildOnGridInverterSections(product: OnGridInverter): SpecSection[] {
  return [
    {
      title: "AC Output",
      rows: [
        { key: "rated_output_power_kw", label: "Rated Output Power", value: product.rated_output_power_kw, unit: "kW" },
        { key: "max_ac_apparent_power_kva", label: "Max AC Apparent Power", value: product.max_ac_apparent_power_kva, unit: "kVA" },
        { key: "nominal_ac_voltage_vac", label: "Nominal AC Voltage", value: product.nominal_ac_voltage_vac, unit: "VAC" },
        { key: "max_output_current_a", label: "Max Output Current", value: product.max_output_current_a, unit: "A" },
        { key: "ac_grid_frequency_range_hz", label: "Grid Frequency Range", value: product.ac_grid_frequency_range_hz, unit: "Hz" },
        { key: "power_factor_cos_phi", label: "Power Factor (cos φ)", value: product.power_factor_cos_phi },
        { key: "thdi_percent", label: "THDi", value: product.thdi_percent, unit: "%" },
      ],
    },
    {
      title: "DC Input (PV)",
      rows: [
        { key: "max_pv_input_power_kw", label: "Max PV Input Power", value: product.max_pv_input_power_kw, unit: "kW" },
        { key: "no_of_mppts", label: "Number of MPPTs", value: product.no_of_mppts },
        { key: "strings_per_mppt", label: "Strings per MPPT", value: product.strings_per_mppt },
        { key: "pv_max_voltage_vdc", label: "PV Max Input Voltage", value: product.pv_max_voltage_vdc, unit: "VDC" },
        { key: "pv_nominal_voltage_vdc", label: "PV Nominal Voltage", value: product.pv_nominal_voltage_vdc, unit: "VDC" },
        { key: "pv_mppt_voltage_range_vdc", label: "MPPT Voltage Range", value: product.pv_mppt_voltage_range_vdc, unit: "VDC" },
        { key: "pv_start_voltage_vdc", label: "Start Voltage", value: product.pv_start_voltage_vdc, unit: "VDC" },
        { key: "max_input_current_per_mppt_a", label: "Max Input Current per MPPT", value: product.max_input_current_per_mppt_a, unit: "A" },
        { key: "max_short_circuit_current_per_mppt_a", label: "Max Short Circuit Current per MPPT", value: product.max_short_circuit_current_per_mppt_a, unit: "A" },
      ],
    },
    {
      title: "Efficiency",
      rows: [
        { key: "max_efficiency_percent", label: "Max Efficiency", value: product.max_efficiency_percent, unit: "%" },
        { key: "euro_efficiency_percent", label: "Euro Efficiency", value: product.euro_efficiency_percent, unit: "%" },
        { key: "topology", label: "Topology", value: product.topology },
      ],
    },
    {
      title: "Protection",
      rows: [
        { key: "surge_protection_dc_ac", label: "Surge Protection (DC/AC)", value: product.surge_protection_dc_ac },
        { key: "dc_reverse_polarity_protection", label: "DC Reverse Polarity Protection", value: product.dc_reverse_polarity_protection },
        { key: "ac_short_circuit_protection", label: "AC Short Circuit Protection", value: product.ac_short_circuit_protection },
        { key: "anti_islanding_protection", label: "Anti-islanding Protection", value: product.anti_islanding_protection },
        { key: "output_over_current_protection", label: "Output Over-Current Protection", value: product.output_over_current_protection },
        { key: "dc_switch", label: "DC Switch", value: product.dc_switch },
        { key: "string_fault_detection", label: "String Fault Detection", value: product.string_fault_detection },
        { key: "insulation_detection", label: "Insulation Detection", value: product.insulation_detection },
      ],
    },
    {
      title: "Communication & Display",
      rows: [
        { key: "communication_interfaces", label: "Communication Interfaces", value: product.communication_interfaces },
        { key: "display", label: "Display", value: product.display },
        { key: "certifications", label: "Certifications", value: product.certifications },
      ],
    },
    {
      title: "Environmental & Mechanical",
      rows: [
        { key: "ip_rating", label: "IP Rating", value: product.ip_rating },
        { key: "cooling_type", label: "Cooling Type", value: product.cooling_type },
        { key: "operating_temperature_range_c", label: "Operating Temperature", value: product.operating_temperature_range_c, unit: "°C" },
        { key: "max_operating_humidity_percent", label: "Max Operating Humidity", value: product.max_operating_humidity_percent, unit: "%" },
        { key: "max_operating_altitude_m", label: "Max Operating Altitude", value: product.max_operating_altitude_m, unit: "m" },
        { key: "dimensions_w_h_d_mm", label: "Dimensions (W×H×D)", value: product.dimensions_w_h_d_mm, unit: "mm" },
        { key: "weight_kg", label: "Weight", value: product.weight_kg, unit: "kg" },
      ],
    },
  ];
}

type AnyProduct = PVModule | HybridInverter | Battery | SolarChargeController | OnGridInverter;

function buildSections(category: CategorySlug, product: AnyProduct): SpecSection[] {
  switch (category) {
    case "pv-modules":
      return buildPVModuleSections(product as PVModule);
    case "hybrid-inverters":
      return buildHybridInverterSections(product as HybridInverter);
    case "batteries":
      return buildBatterySections(product as Battery);
    case "solar-charge-controllers":
      return buildSCCSections(product as SolarChargeController);
    case "on-grid-inverters":
      return buildOnGridInverterSections(product as OnGridInverter);
    default:
      return [];
  }
}

function getHeroSummary(category: CategorySlug, product: AnyProduct): string {
  switch (category) {
    case "pv-modules": {
      const p = product as PVModule;
      return [
        p.power_stc_w ? `${p.power_stc_w}W` : null,
        p.efficiency_percent ? `${p.efficiency_percent}%` : null,
        p.max_system_voltage_vdc ? `${p.max_system_voltage_vdc}V sys.` : null,
        p.cell_type,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    case "hybrid-inverters": {
      const p = product as HybridInverter;
      return [
        p.rated_output_power_w ? `${p.rated_output_power_w / 1000}kW` : null,
        p.phase,
        p.system_type,
        p.pv_solar_charger_type,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    case "batteries": {
      const p = product as Battery;
      return [
        p.nominal_voltage_v ? `${p.nominal_voltage_v}V` : null,
        p.rated_capacity_ah ? `${p.rated_capacity_ah}Ah` : null,
        p.energy_wh ? `${p.energy_wh}Wh` : null,
        p.battery_type,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    case "solar-charge-controllers": {
      const p = product as SolarChargeController;
      return [
        p.rated_charge_current_a ? `${p.rated_charge_current_a}A` : null,
        p.system_voltage_v ? `${p.system_voltage_v}V` : null,
        p.controller_type,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    case "on-grid-inverters": {
      const p = product as OnGridInverter;
      return [
        p.rated_output_power_kw ? `${p.rated_output_power_kw}kW` : null,
        p.no_of_mppts ? `${p.no_of_mppts} MPPT` : null,
        p.topology,
        p.nominal_ac_voltage_vac ? `${p.nominal_ac_voltage_vac}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    default:
      return "";
  }
}

export default function ProductDetailPage() {
  const params = useParams();
  const categorySlug = params.category as CategorySlug;
  const modelSlug = decodeURIComponent(params.model as string);

  const catInfo = getCategoryInfo(categorySlug);
  const [product, setProduct] = useState<AnyProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound404, setNotFound404] = useState(false);

  useEffect(() => {
    if (!catInfo) return;
    const supabase = getSupabaseClient();
    supabase
      .from(catInfo.table)
      .select("*")
      .eq("model", modelSlug)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          setNotFound404(true);
        } else {
          setProduct(data as AnyProduct);
        }
        setLoading(false);
      });
  }, [catInfo, modelSlug]);

  if (!catInfo) return null;

  if (notFound404 && !loading) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-300 mb-2">Product Not Found</h1>
          <p className="text-slate-500 mb-4">Model &ldquo;{modelSlug}&rdquo; was not found.</p>
          <Link href={`/${categorySlug}`} className="text-sky-400 hover:underline">
            ← Back to {catInfo.label}
          </Link>
        </div>
      </div>
    );
  }

  const sections = product ? buildSections(categorySlug, product) : [];
  const heroSummary = product ? getHeroSummary(categorySlug, product) : "";
  const price = product
    ? (product as unknown as Record<string, unknown>).selling_price_idr as number | null
    : null;

  return (
    <div className="min-h-screen bg-[#0f172a]">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-40 no-print">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-2 text-sm">
          <Link href="/" className="text-slate-400 hover:text-slate-100 transition-colors">
            Home
          </Link>
          <ChevronRight className="h-3 w-3 text-slate-600" />
          <Link
            href={`/${categorySlug}`}
            className={`hover:text-slate-100 transition-colors ${catInfo.textColor}`}
          >
            {catInfo.label}
          </Link>
          <ChevronRight className="h-3 w-3 text-slate-600" />
          <span className="text-slate-300 font-mono font-medium truncate max-w-xs">
            {modelSlug}
          </span>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
          <div className="space-y-4">
            <div className="h-8 bg-slate-800 rounded-lg animate-pulse w-1/3" />
            <div className="h-4 bg-slate-800 rounded animate-pulse w-1/2" />
            <div className="h-64 bg-slate-800 rounded-xl animate-pulse" />
          </div>
        ) : product ? (
          <>
            {/* Hero Section */}
            <div className="mb-8 print-friendly">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <CategoryBadge category={categorySlug} size="md" />
                    <button
                      onClick={() => window.print()}
                      className="no-print flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors px-2 py-1 rounded border border-slate-700 hover:border-slate-600"
                    >
                      <Printer className="h-3 w-3" />
                      Print
                    </button>
                  </div>
                  <h1 className="text-3xl sm:text-4xl font-mono font-bold text-slate-100 mb-2">
                    {modelSlug}
                  </h1>
                  <p className="text-sm text-slate-400">{heroSummary}</p>
                </div>
                <div className="text-right">
                  {price !== null && price !== undefined ? (
                    <div>
                      <p className="text-xs text-slate-500 mb-1">Selling Price</p>
                      <p className="text-2xl font-mono font-bold text-emerald-400">
                        {formatIDR(price)}
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs text-slate-500 mb-1">Price</p>
                      <p className="text-lg text-slate-500 italic">— Contact sales</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Spec Table */}
            <SpecTable sections={sections} />

            {/* Navigation */}
            <div className="mt-8 pt-6 border-t border-slate-800 no-print">
              <Link
                href={`/${categorySlug}`}
                className="text-sm text-slate-400 hover:text-slate-100 transition-colors"
              >
                ← Back to {catInfo.label}
              </Link>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

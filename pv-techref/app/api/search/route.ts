export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { SearchResult, CATEGORIES } from "@/lib/types";

function getPVModuleSummary(row: Record<string, unknown>): string {
  const parts: string[] = [];
  if (row.power_stc_w) parts.push(`${row.power_stc_w}W`);
  if (row.efficiency_percent) parts.push(`${row.efficiency_percent}%`);
  if (row.max_system_voltage_vdc) parts.push(`${row.max_system_voltage_vdc}V`);
  if (row.cell_type) parts.push(String(row.cell_type));
  return parts.join(" | ");
}

function getHybridInverterSummary(row: Record<string, unknown>): string {
  const parts: string[] = [];
  if (row.rated_output_power_w)
    parts.push(`${Number(row.rated_output_power_w) / 1000}kW`);
  if (row.phase) parts.push(String(row.phase));
  if (row.pv_max_open_circuit_voltage_vdc)
    parts.push(`${row.pv_max_open_circuit_voltage_vdc}Voc`);
  if (row.system_type) parts.push(String(row.system_type));
  return parts.join(" | ");
}

function getBatterySummary(row: Record<string, unknown>): string {
  const parts: string[] = [];
  if (row.nominal_voltage_v) parts.push(`${row.nominal_voltage_v}V`);
  if (row.rated_capacity_ah) parts.push(`${row.rated_capacity_ah}Ah`);
  if (row.energy_wh) parts.push(`${row.energy_wh}Wh`);
  if (row.battery_type) parts.push(String(row.battery_type));
  return parts.join(" | ");
}

function getSCCSummary(row: Record<string, unknown>): string {
  const parts: string[] = [];
  if (row.rated_charge_current_a) parts.push(`${row.rated_charge_current_a}A`);
  if (row.system_voltage_v) parts.push(`${row.system_voltage_v}V`);
  if (row.pv_max_voc_v) parts.push(`Voc ${row.pv_max_voc_v}V`);
  if (row.controller_type) parts.push(String(row.controller_type));
  return parts.join(" | ");
}

function getOnGridInverterSummary(row: Record<string, unknown>): string {
  const parts: string[] = [];
  if (row.rated_output_power_kw) parts.push(`${row.rated_output_power_kw}kW`);
  if (row.no_of_mppts) parts.push(`${row.no_of_mppts} MPPT`);
  if (row.max_efficiency_percent) parts.push(`${row.max_efficiency_percent}%`);
  if (row.topology) parts.push(String(row.topology));
  return parts.join(" | ");
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim();

  if (!query || query.length < 1) {
    return NextResponse.json({ results: [] });
  }

  const supabase = createServerClient();
  const results: SearchResult[] = [];

  const searches = [
    {
      table: "pv_modules",
      category: CATEGORIES[0],
      getSummary: getPVModuleSummary,
    },
    {
      table: "hybrid_inverters",
      category: CATEGORIES[1],
      getSummary: getHybridInverterSummary,
    },
    {
      table: "batteries",
      category: CATEGORIES[2],
      getSummary: getBatterySummary,
    },
    {
      table: "solar_charge_controllers",
      category: CATEGORIES[3],
      getSummary: getSCCSummary,
    },
    {
      table: "on_grid_inverters",
      category: CATEGORIES[4],
      getSummary: getOnGridInverterSummary,
    },
  ];

  await Promise.all(
    searches.map(async ({ table, category, getSummary }) => {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .ilike("model", `%${query}%`)
        .limit(5);

      if (!error && data) {
        data.forEach((row) => {
          results.push({
            id: row.id,
            model: row.model,
            category: category.slug,
            categoryLabel: category.label,
            keySummary: getSummary(row as Record<string, unknown>),
            selling_price_idr: row.selling_price_idr,
          });
        });
      }
    })
  );

  return NextResponse.json({ results: results.slice(0, 20) });
}

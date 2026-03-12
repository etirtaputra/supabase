"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronRight } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { CATEGORIES, CategorySlug } from "@/lib/types";
import { formatIDR, cn, getCategoryInfo } from "@/lib/utils";
import CategoryBadge from "../components/CategoryBadge";
import FilterBar, { FilterState } from "../components/FilterBar";

type SortDir = "asc" | "desc" | null;

interface SortState {
  key: string;
  dir: SortDir;
}

// Column definitions per category
const COLUMNS: Record<
  CategorySlug,
  Array<{ key: string; label: string; unit?: string }>
> = {
  "pv-modules": [
    { key: "model", label: "Model" },
    { key: "power_stc_w", label: "Power (STC)", unit: "W" },
    { key: "efficiency_percent", label: "Efficiency", unit: "%" },
    { key: "vmp_stc_v", label: "Vmp", unit: "V" },
    { key: "voc_stc_v", label: "Voc", unit: "V" },
    { key: "max_system_voltage_vdc", label: "Max Sys V", unit: "VDC" },
    { key: "weight_kg", label: "Weight", unit: "kg" },
    { key: "selling_price_idr", label: "Price (IDR)" },
  ],
  "hybrid-inverters": [
    { key: "model", label: "Model" },
    { key: "rated_output_power_w", label: "Output Power", unit: "W" },
    { key: "system_type", label: "Type" },
    { key: "phase", label: "Phase" },
    { key: "pv_max_open_circuit_voltage_vdc", label: "PV Max Voc", unit: "VDC" },
    { key: "max_conversion_efficiency_dc_ac_percent", label: "Efficiency", unit: "%" },
    { key: "weight_kg", label: "Weight", unit: "kg" },
    { key: "selling_price_idr", label: "Price (IDR)" },
  ],
  batteries: [
    { key: "model", label: "Model" },
    { key: "battery_type", label: "Chemistry" },
    { key: "nominal_voltage_v", label: "Voltage", unit: "V" },
    { key: "rated_capacity_ah", label: "Capacity", unit: "Ah" },
    { key: "energy_wh", label: "Energy", unit: "Wh" },
    { key: "cycle_life", label: "Cycle Life" },
    { key: "weight_kg", label: "Weight", unit: "kg" },
    { key: "selling_price_idr", label: "Price (IDR)" },
  ],
  "solar-charge-controllers": [
    { key: "model", label: "Model" },
    { key: "controller_type", label: "Type" },
    { key: "rated_charge_current_a", label: "Rated Current", unit: "A" },
    { key: "system_voltage_v", label: "Sys Voltage", unit: "V" },
    { key: "pv_max_voc_v", label: "PV Max Voc", unit: "V" },
    { key: "max_conversion_efficiency_percent", label: "Efficiency", unit: "%" },
    { key: "weight_kg", label: "Weight", unit: "kg" },
    { key: "selling_price_idr", label: "Price (IDR)" },
  ],
  "on-grid-inverters": [
    { key: "model", label: "Model" },
    { key: "rated_output_power_kw", label: "Output Power", unit: "kW" },
    { key: "no_of_mppts", label: "MPPTs" },
    { key: "pv_max_voltage_vdc", label: "PV Max V", unit: "VDC" },
    { key: "max_efficiency_percent", label: "Max Eff.", unit: "%" },
    { key: "nominal_ac_voltage_vac", label: "AC Voltage", unit: "VAC" },
    { key: "weight_kg", label: "Weight", unit: "kg" },
    { key: "selling_price_idr", label: "Price (IDR)" },
  ],
};

function getCellValue(row: Record<string, unknown>, key: string, unit?: string): React.ReactNode {
  const value = row[key];

  if (key === "selling_price_idr") {
    if (value === null || value === undefined) {
      return <span className="text-slate-500 italic text-xs">— Contact sales</span>;
    }
    return (
      <span className="font-mono text-emerald-400 text-xs">
        {formatIDR(value as number)}
      </span>
    );
  }

  if (value === null || value === undefined || value === "") {
    return <span className="text-slate-600">—</span>;
  }

  if (unit) {
    return (
      <span className="font-mono text-sm">
        {String(value)} <span className="text-slate-500 text-xs">{unit}</span>
      </span>
    );
  }

  return <span className="text-sm">{String(value)}</span>;
}

export default function CategoryPage() {
  const params = useParams();
  const categorySlug = params.category as CategorySlug;
  const catInfo = getCategoryInfo(categorySlug);

  const [products, setProducts] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortState>({ key: "model", dir: "asc" });
  const [filters, setFilters] = useState<FilterState>({});

  const columns = COLUMNS[categorySlug] || [];

  useEffect(() => {
    if (!catInfo) return;
    const supabase = getSupabaseClient();
    supabase
      .from(catInfo.table)
      .select("*")
      .order("model")
      .then(({ data, error }) => {
        if (!error && data) setProducts(data as Record<string, unknown>[]);
        setLoading(false);
      });
  }, [catInfo]);

  const filteredProducts = useMemo(() => {
    let result = [...products];

    if (categorySlug === "pv-modules" && filters.powerRange) {
      const [min, max] = filters.powerRange;
      result = result.filter((p) => {
        const power = p.power_stc_w as number;
        return power >= min && power <= max;
      });
    }

    if (
      (categorySlug === "hybrid-inverters" || categorySlug === "on-grid-inverters") &&
      filters.phase
    ) {
      result = result.filter((p) => {
        const phase = (p.phase as string) || "";
        return phase.toLowerCase().includes(filters.phase!.toLowerCase().replace("-", ""));
      });
    }

    if (categorySlug === "batteries" && filters.batteryType) {
      result = result.filter((p) => {
        const bt = (p.battery_type as string) || "";
        return bt.toLowerCase().includes(filters.batteryType!.toLowerCase());
      });
    }

    if (categorySlug === "solar-charge-controllers" && filters.systemVoltage) {
      result = result.filter((p) => {
        const sv = (p.system_voltage_v as string) || "";
        return sv === filters.systemVoltage;
      });
    }

    return result;
  }, [products, filters, categorySlug]);

  const sortedProducts = useMemo(() => {
    if (!sort.dir) return filteredProducts;
    return [...filteredProducts].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [filteredProducts, sort]);

  const toggleSort = (key: string) => {
    setSort((prev) => ({
      key,
      dir:
        prev.key === key
          ? prev.dir === "asc"
            ? "desc"
            : prev.dir === "desc"
              ? null
              : "asc"
          : "asc",
    }));
  };

  if (!catInfo) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center text-slate-400">
        Category not found
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a]">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-4">
          <Link href="/" className="text-sm text-slate-400 hover:text-slate-100 transition-colors">
            ← Home
          </Link>
          <ChevronRight className="h-3 w-3 text-slate-600" />
          <span className={`text-sm font-semibold ${catInfo.textColor}`}>
            {catInfo.icon} {catInfo.label}
          </span>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Category Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-3xl">{catInfo.icon}</span>
              <h1 className={`text-2xl font-bold ${catInfo.textColor}`}>
                {catInfo.label}
              </h1>
            </div>
            <p className="text-slate-500 text-sm">
              {loading
                ? "Loading..."
                : `${sortedProducts.length} of ${products.length} products`}
            </p>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="mb-4 p-3 rounded-lg bg-slate-800/30 border border-slate-800">
          <FilterBar
            category={categorySlug}
            filters={filters}
            onChange={setFilters}
          />
        </div>

        {/* Products Table */}
        <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-900/20">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-800/50">
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => toggleSort(col.key)}
                      className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-200 transition-colors group whitespace-nowrap"
                    >
                      <div className="flex items-center gap-1">
                        {col.label}
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                          {sort.key === col.key && sort.dir === "asc" ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : sort.key === col.key && sort.dir === "desc" ? (
                            <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ArrowUpDown className="h-3 w-3" />
                          )}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      {columns.map((col) => (
                        <td key={col.key} className="px-4 py-3">
                          <div className="h-4 bg-slate-800 rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : sortedProducts.length === 0 ? (
                  <tr>
                    <td
                      colSpan={columns.length}
                      className="px-4 py-12 text-center text-slate-500"
                    >
                      No products match the current filters
                    </td>
                  </tr>
                ) : (
                  sortedProducts.map((product) => (
                    <Link
                      key={String(product.id)}
                      href={`/${categorySlug}/${encodeURIComponent(String(product.model))}`}
                      legacyBehavior
                    >
                      <tr
                        className="hover:bg-slate-800/50 transition-colors cursor-pointer group"
                      >
                        {columns.map((col) => (
                          <td
                            key={col.key}
                            className={cn(
                              "px-4 py-3 whitespace-nowrap",
                              col.key === "model" &&
                                `font-mono font-semibold ${catInfo.textColor} group-hover:brightness-110`
                            )}
                          >
                            {col.key === "model" ? (
                              <Link
                                href={`/${categorySlug}/${encodeURIComponent(String(product.model))}`}
                                className="hover:underline"
                              >
                                {String(product.model)}
                              </Link>
                            ) : (
                              getCellValue(product, col.key, col.unit)
                            )}
                          </td>
                        ))}
                      </tr>
                    </Link>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

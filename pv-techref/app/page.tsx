export const dynamic = "force-dynamic";

import Link from "next/link";
import { createServerClient } from "@/lib/supabase";
import { CATEGORIES, SearchResult } from "@/lib/types";
import { formatIDR } from "@/lib/utils";
import SearchBar from "./components/SearchBar";
import CategoryNav from "./components/CategoryNav";
import CategoryBadge from "./components/CategoryBadge";

async function getAllProducts(): Promise<SearchResult[]> {
  const supabase = createServerClient();
  const results: SearchResult[] = [];

  const fetches = [
    {
      table: "pv_modules",
      category: CATEGORIES[0],
      getSummary: (row: Record<string, unknown>) => {
        const parts = [];
        if (row.power_stc_w) parts.push(`${row.power_stc_w}W`);
        if (row.efficiency_percent) parts.push(`${row.efficiency_percent}%`);
        if (row.max_system_voltage_vdc) parts.push(`${row.max_system_voltage_vdc}V`);
        return parts.join(" | ");
      },
    },
    {
      table: "hybrid_inverters",
      category: CATEGORIES[1],
      getSummary: (row: Record<string, unknown>) => {
        const parts = [];
        if (row.rated_output_power_w)
          parts.push(`${Number(row.rated_output_power_w) / 1000}kW`);
        if (row.phase) parts.push(String(row.phase));
        if (row.system_type) parts.push(String(row.system_type));
        return parts.join(" | ");
      },
    },
    {
      table: "batteries",
      category: CATEGORIES[2],
      getSummary: (row: Record<string, unknown>) => {
        const parts = [];
        if (row.nominal_voltage_v) parts.push(`${row.nominal_voltage_v}V`);
        if (row.rated_capacity_ah) parts.push(`${row.rated_capacity_ah}Ah`);
        if (row.battery_type) parts.push(String(row.battery_type));
        return parts.join(" | ");
      },
    },
    {
      table: "solar_charge_controllers",
      category: CATEGORIES[3],
      getSummary: (row: Record<string, unknown>) => {
        const parts = [];
        if (row.rated_charge_current_a)
          parts.push(`${row.rated_charge_current_a}A`);
        if (row.system_voltage_v) parts.push(`${row.system_voltage_v}V`);
        if (row.controller_type) parts.push(String(row.controller_type));
        return parts.join(" | ");
      },
    },
    {
      table: "on_grid_inverters",
      category: CATEGORIES[4],
      getSummary: (row: Record<string, unknown>) => {
        const parts = [];
        if (row.rated_output_power_kw)
          parts.push(`${row.rated_output_power_kw}kW`);
        if (row.no_of_mppts) parts.push(`${row.no_of_mppts} MPPT`);
        if (row.topology) parts.push(String(row.topology));
        return parts.join(" | ");
      },
    },
  ];

  await Promise.all(
    fetches.map(async ({ table, category, getSummary }) => {
      const { data } = await supabase.from(table).select("*").order("model");
      if (data) {
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

  return results;
}

async function getCategoryCounts(): Promise<Record<string, number>> {
  const supabase = createServerClient();
  const counts: Record<string, number> = {};

  await Promise.all(
    CATEGORIES.map(async (cat) => {
      const { count } = await supabase
        .from(cat.table)
        .select("*", { count: "exact", head: true });
      counts[cat.slug] = count || 0;
    })
  );

  return counts;
}

export default async function HomePage() {
  const [allProducts, counts] = await Promise.all([
    getAllProducts(),
    getCategoryCounts(),
  ]);

  const recentProducts = allProducts.slice(0, 8);

  return (
    <div className="min-h-screen bg-[#0f172a]">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-500 to-sky-500 flex items-center justify-center">
              <span className="text-white font-bold text-sm">☀</span>
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-100">ICA Solar</h1>
              <p className="text-xs text-slate-500 leading-none">
                PV Component Reference
              </p>
            </div>
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {CATEGORIES.map((cat) => (
              <Link
                key={cat.slug}
                href={`/${cat.slug}`}
                className={`text-xs px-3 py-1.5 rounded-lg transition-colors text-slate-400 hover:text-slate-100 hover:bg-slate-800 ${cat.textColor}`}
              >
                {cat.icon} {cat.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        {/* Hero Section */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400 text-xs font-medium mb-4">
            <span>⚡</span>
            <span>Engineering Technical Reference</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-100 mb-3">
            PV Solar Component
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-sky-400">
              {" "}
              Reference Database
            </span>
          </h2>
          <p className="text-slate-400 max-w-xl mx-auto text-sm">
            Instantly look up technical specifications for solar PV modules,
            inverters, batteries, and charge controllers.
          </p>
        </div>

        {/* Search Bar */}
        <div className="max-w-2xl mx-auto mb-10">
          <SearchBar allProducts={allProducts} />
        </div>

        {/* Category Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-12">
          {CATEGORIES.map((cat) => (
            <Link
              key={cat.slug}
              href={`/${cat.slug}`}
              className={`group p-4 rounded-xl border bg-slate-900/50 hover:bg-slate-800/60 transition-all ${cat.borderColor} border-opacity-30 hover:border-opacity-60`}
            >
              <div className="text-2xl mb-2">{cat.icon}</div>
              <h3
                className={`text-sm font-semibold ${cat.textColor} mb-1`}
              >
                {cat.label}
              </h3>
              <p className="text-xs text-slate-500">
                {counts[cat.slug] || 0}{" "}
                {counts[cat.slug] === 1 ? "item" : "items"}
              </p>
            </Link>
          ))}
        </div>

        {/* All Products Table */}
        <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-900/30">
          <div className="flex items-center justify-between px-5 py-3.5 bg-slate-800/50 border-b border-slate-800">
            <h3 className="text-sm font-semibold text-slate-300">
              All Products
            </h3>
            <span className="text-xs text-slate-500">
              {allProducts.length} total
            </span>
          </div>
          <div className="divide-y divide-slate-800/50">
            {allProducts.map((product) => (
              <Link
                key={product.id}
                href={`/${product.category}/${encodeURIComponent(product.model)}`}
                className="flex items-center gap-4 px-5 py-3 hover:bg-slate-800/50 transition-colors group"
              >
                <CategoryBadge category={product.category} size="sm" />
                <span className="font-mono font-semibold text-slate-100 text-sm group-hover:text-white min-w-0 flex-shrink-0">
                  {product.model}
                </span>
                <span className="text-xs text-slate-500 truncate flex-1 hidden sm:block">
                  {product.keySummary}
                </span>
                <span className="text-xs font-mono shrink-0">
                  {product.selling_price_idr !== null ? (
                    <span className="text-emerald-400">
                      {formatIDR(product.selling_price_idr)}
                    </span>
                  ) : (
                    <span className="text-slate-600">— Contact sales</span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-12 pt-6 border-t border-slate-800 text-center text-xs text-slate-600">
          <p>ICA Solar — PV Component Technical Reference · Internal Use Only</p>
        </footer>
      </div>
    </div>
  );
}

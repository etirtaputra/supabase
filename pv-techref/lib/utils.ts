import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { CategorySlug, CATEGORIES, CategoryInfo } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a number as Indonesian Rupiah currency
 */
export function formatIDR(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "— (contact sales)";
  }
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Format a value with its unit. Returns em dash for null/undefined.
 */
export function formatUnit(
  value: number | string | null | undefined,
  unit?: string
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (unit) return `${value} ${unit}`;
  return String(value);
}

/**
 * Format a numeric value with fixed decimal places
 */
export function formatNumber(
  value: number | null | undefined,
  decimals = 2
): string {
  if (value === null || value === undefined) return "—";
  return value.toFixed(decimals);
}

/**
 * Slugify a string for URL usage
 */
export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .trim();
}

/**
 * Get category info from a slug
 */
export function getCategoryInfo(slug: CategorySlug): CategoryInfo | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}

/**
 * Get category slug from a table name
 */
export function getCategorySlugFromTable(table: string): CategorySlug | null {
  const map: Record<string, CategorySlug> = {
    pv_modules: "pv-modules",
    hybrid_inverters: "hybrid-inverters",
    batteries: "batteries",
    solar_charge_controllers: "solar-charge-controllers",
    on_grid_inverters: "on-grid-inverters",
  };
  return map[table] || null;
}

/**
 * Format a spec value with type-aware formatting
 */
export function formatSpecValue(
  value: unknown,
  unit?: string
): string {
  if (value === null || value === undefined || value === "") return "—";

  // Handle arrays (e.g., certifications)
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  // Handle numbers
  if (typeof value === "number") {
    return unit ? `${value} ${unit}` : String(value);
  }

  // Handle strings
  if (typeof value === "string") {
    return unit ? `${value} ${unit}` : value;
  }

  return String(value);
}

/**
 * Capitalize the first letter of a string
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Convert a snake_case key to a human-readable label
 */
export function keyToLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase())
    .replace(/\bVdc\b/g, "VDC")
    .replace(/\bVac\b/g, "VAC")
    .replace(/\bStc\b/g, "STC")
    .replace(/\bNoct\b/g, "NOCT")
    .replace(/\bMppt\b/g, "MPPT")
    .replace(/\bPv\b/g, "PV")
    .replace(/\bIdr\b/g, "IDR")
    .replace(/\bAh\b/g, "Ah")
    .replace(/\bKw\b/g, "kW")
    .replace(/\bKva\b/g, "kVA")
    .replace(/\bMm2\b/g, "mm²")
    .replace(/\bMohm\b/g, "mΩ")
    .replace(/\bThdi\b/g, "THDi")
    .replace(/\bPhi\b/g, "φ")
    .replace(/\bDc\b/g, "DC")
    .replace(/\bAc\b/g, "AC")
    .replace(/\bRls\b/g, "RLS")
    .replace(/\bIp\b/g, "IP")
    .replace(/\bBms\b/g, "BMS");
}

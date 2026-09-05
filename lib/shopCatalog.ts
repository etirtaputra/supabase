/**
 * The storefront's view of the catalogue.
 *
 * ICAPROC is the catalogue; a shop is one READING of it. Everything the public
 * side needs to decide — what is sellable, which department an item belongs
 * to, what its price says per watt, whether a courier can carry it — is a rule,
 * and every rule lives here rather than inside a page, so the demo running at
 * /shop and a future public site cannot answer the same question differently.
 *
 * Nothing here reads cost, supplier, or margin. A storefront that cannot see
 * them cannot leak them.
 */

import { CATEGORY_UNITS } from '../constants/categoryUnits.ts';

/** What a storefront needs of a catalogue row — deliberately less than a row has. */
export interface ShopItem {
  component_id: string;
  internal_description: string | null;
  supplier_model: string;
  brand: string | null;
  category: string | null;
  unit: string | null;
  norm_value: number | null;
  selling_price_idr: number | null;
  datasheet_url: string | null;
  warranty_value: number | null;
  warranty_unit: string | null;
  perf_warranty_value: number | null;
  perf_warranty_unit: string | null;
  specifications: Record<string, unknown> | null;
}

export interface Department {
  key: string;
  label: string;
  /** Catalogue categories that shop under this department. */
  categories: readonly string[];
  blurb: string;
}

/**
 * Departments are how a BUYER divides the catalogue; categories are how the
 * business does. They are not the same cut — three inverter categories are one
 * aisle to someone shopping, and `non_stock` (607 rows of one-off project
 * lines) is not an aisle at all, which is why it appears in no department and
 * therefore never reaches the shop.
 */
export const DEPARTMENTS: readonly Department[] = [
  { key: 'panel',      label: 'Panel Surya',             categories: ['pv_module'],
    blurb: 'Modul monokristal dan bifacial N-type' },
  { key: 'inverter',   label: 'Inverter',                categories: ['inverter_charger', 'on_grid_inverter', 'power_inverter'],
    blurb: 'On-grid, hybrid, dan off-grid' },
  { key: 'battery',    label: 'Baterai & Penyimpanan',   categories: ['batteries', 'portable_power'],
    blurb: 'LiFePO4 rak, dinding, dan portabel' },
  { key: 'controller', label: 'Solar Charge Controller', categories: ['solar_charge_controller'],
    blurb: 'MPPT dan PWM, 10–100 A' },
  { key: 'mounting',   label: 'Mounting',                categories: ['mounting'],
    blurb: 'Rail, klem, kaki, dan walkway' },
  { key: 'protection', label: 'Proteksi & Kabel',        categories: ['accessories', 'pv_cable'],
    blurb: 'MCB, MCCB, SPD, konektor, kabel PV' },
  { key: 'pump',       label: 'Pompa Surya',             categories: ['solar_pump_inverter'],
    blurb: 'Inverter pompa 0,75–250 kW' },
  { key: 'power',      label: 'UPS & Stabilizer',        categories: ['ups', 'stabilizer'],
    blurb: 'Cadangan daya dan penstabil tegangan' },
  { key: 'ev',         label: 'Pengisian EV',            categories: ['ev_charger'],
    blurb: 'Pengisi daya kendaraan listrik' },
  { key: 'enclosure',  label: 'Panel Box & Kabinet',     categories: ['standing_cabinet', 'wallmount_cabinet'],
    blurb: 'Kabinet berdiri dan tempel dinding' },
] as const;

const DEPT_OF_CATEGORY = new Map<string, Department>();
for (const d of DEPARTMENTS) for (const c of d.categories) DEPT_OF_CATEGORY.set(c, d);

export const departmentOf = (category: string | null | undefined): Department | null =>
  (category && DEPT_OF_CATEGORY.get(category)) || null;

export const departmentByKey = (key: string): Department | null =>
  DEPARTMENTS.find((d) => d.key === key) ?? null;

/** The customer-facing name. Never the supplier's own code when we have our own. */
export const shopName = (i: ShopItem): string =>
  (i.internal_description || '').trim() || i.supplier_model;

/**
 * On the shop at all? A department, and a name. NOT a price: an item without
 * one is quote-only, which is a real way to sell a 250 kW pump inverter — and
 * showing it is how the gap in the catalogue stays visible instead of hidden.
 */
export const isShoppable = (i: ShopItem): boolean =>
  !!departmentOf(i.category) && !!shopName(i).trim();

export const hasPrice = (i: ShopItem): boolean =>
  i.selling_price_idr != null && Number(i.selling_price_idr) > 0;

/**
 * Price per capacity unit — Rp/Wp for a module, Rp/Wh for a battery, Rp/W for
 * an inverter. The number an installer actually compares on, and the reason
 * `norm_value` is worth filling in.
 *
 * Categories priced BY the unit already (cable, sold per metre) are excluded
 * by their own flag: dividing their price by a cross-section would be noise.
 */
export function pricePerUnit(i: ShopItem): { value: number; unit: string } | null {
  if (!hasPrice(i) || !i.category) return null;
  const cu = CATEGORY_UNITS[i.category];
  if (!cu || cu.priceIsPerUnit) return null;
  const n = Number(i.norm_value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return { value: Number(i.selling_price_idr) / n, unit: cu.unit };
}

/** Kilograms, when the datasheet said so. */
export function weightKg(i: ShopItem): number | null {
  const raw = (i.specifications ?? {})['weight_kg'];
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Above this, a parcel courier is the wrong answer. */
export const COURIER_WEIGHT_LIMIT_KG = 25;

/**
 * Can a parcel courier carry it?
 *
 * Weight decides when the datasheet states it. Otherwise the CATEGORY does:
 * a 2,4 m module and a 4,85 m rail are refused for their size long before
 * their mass, and neither states a weight on file — a rule that waited for
 * complete data would put a pallet of panels in a JNE box.
 */
export const OVERSIZE_CATEGORIES: readonly string[] = ['pv_module', 'mounting', 'standing_cabinet'];

export function needsFreight(i: ShopItem): boolean {
  const kg = weightKg(i);
  if (kg != null) return kg > COURIER_WEIGHT_LIMIT_KG;
  return OVERSIZE_CATEGORIES.includes(i.category ?? '');
}

/** A URL-safe, readable id for a product page: "trina-tsm-620neg19rc-20-620wp". */
export function slugify(text: string): string {
  return text.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

/** Warranty in one phrase, from the two pairs the catalogue keeps. */
export function warrantyLine(i: ShopItem): string | null {
  const unit = (v: number | null, u: string | null) =>
    v == null ? null : `${v} ${u === 'years' ? (v === 1 ? 'tahun' : 'tahun') : (u ?? '')}`.trim();
  const p = unit(i.warranty_value, i.warranty_unit);
  const f = unit(i.perf_warranty_value, i.perf_warranty_unit);
  if (p && f) return `${p} produk · ${f} performa`;
  return p ?? (f ? `${f} performa` : null);
}

/** The line-item total of a cart, in rupiah. */
export function cartSubtotal(lines: { item: ShopItem; qty: number }[]): number {
  return lines.reduce((s, l) => s + (Number(l.item.selling_price_idr) || 0) * l.qty, 0);
}

/** Everything in the cart a courier cannot take. */
export const freightLines = (lines: { item: ShopItem; qty: number }[]) =>
  lines.filter((l) => needsFreight(l.item));

/**
 * Rupiah the way an Indonesian customer reads it: "Rp 1.656.000".
 *
 * Deliberately NOT the ERP's `fmtRupiah`, which follows each installation's
 * own currency and separator settings. A storefront's prices are read by the
 * public, not by whoever configured the back office, so they are fixed here —
 * and the shop lifts out to another host without carrying settings with it.
 */
export const formatIdr = (n: number): string =>
  `Rp ${Math.round(n).toLocaleString('id-ID')}`;

/** Per-unit rupiah, which is often under a thousand: "Rp 2.671", "Rp 2,4". */
export const formatIdrUnit = (n: number): string =>
  `Rp ${n >= 100 ? Math.round(n).toLocaleString('id-ID') : n.toLocaleString('id-ID', { maximumFractionDigits: 1 })}`;

/** PPN as the shop states it — the rate the documents already use. */
export const PPN_PCT = 11;
export const withPpn = (n: number): number => n * (1 + PPN_PCT / 100);

// ── Generated navigation: filters, columns, search ──────────────────────────
//
// A McMaster-shaped catalogue works because every category has a fixed
// parameter set behind it, and the filters ARE those parameters. This
// catalogue has exactly that in CATEGORY_SPEC_FIELDS, so the filter sidebar
// and the listing table's columns are GENERATED from the declaration rather
// than designed by hand — add a parameter in Tech Specs and it becomes a filter
// and a column here, in the same commit.

import { CATEGORY_SPEC_FIELDS, conformSpecs, specNumber } from './specSchema.ts';
import { fieldMeta, isAnswered, displaySpecValue } from './specFields.ts';
import { CATEGORY_LABELS } from '../constants/categoryUnits.ts';

/** The declared field set of a category — empty when it has none yet. */
export const declaredFields = (category: string | null | undefined): readonly string[] =>
  ((category && CATEGORY_SPEC_FIELDS[category as keyof typeof CATEGORY_SPEC_FIELDS]) ?? []) as readonly string[];

/** An item's specs conformed to its category's shape (declared keys always present). */
export const specsOf = (i: ShopItem): Record<string, unknown> =>
  conformSpecs(i.category, i.specifications ?? {}) as Record<string, unknown>;

export interface RangeFacet {
  kind: 'range'; key: string; label: string; unit?: string; min: number; max: number;
}
export interface OptionFacet {
  kind: 'options'; key: string; label: string; unit?: string;
  options: { value: string; count: number }[];
}
export type Facet = RangeFacet | OptionFacet;

/** How many distinct text values still read as a set of choices, not free text. */
const OPTION_LIMIT = 8;
/**
 * How many distinct NUMBERS are still better ticked than windowed. Twelve
 * modules have six wattages: a list of six is faster than a min/max pair, and
 * shows what exists. Past this, a range.
 */
const NUMERIC_OPTION_LIMIT = 12;
/** How many facets a sidebar can carry before it stops being scannable. */
const FACET_LIMIT = 10;

/**
 * The filters for a set of items in one category, from that category's own
 * field set. A numeric field becomes a range when the items span more than one
 * value; a boolean becomes Ya/Tidak; a text field becomes checkboxes when it
 * has a handful of distinct answers. A field every item answers identically,
 * or no item answers, is not a filter — it would only ever return everything
 * or nothing. Highlighted fields lead; the rest keep declared order.
 */
export function facetsFor(category: string | null | undefined, items: ShopItem[]): Facet[] {
  const fields = declaredFields(category);
  if (fields.length === 0 || items.length === 0) return [];
  const specs = items.map(specsOf);
  const ordered = [...fields].sort((a, b) => Number(!!fieldMeta(b).highlight) - Number(!!fieldMeta(a).highlight));
  const out: Facet[] = [];
  for (const key of ordered) {
    if (out.length >= FACET_LIMIT) break;
    const meta = fieldMeta(key);
    if (meta.kind === 'number') {
      const nums = specs.map((s) => specNumber(s[key])).filter((n): n is number => n != null);
      const distinct = new Set(nums);
      if (distinct.size < 2) continue;
      if (distinct.size <= NUMERIC_OPTION_LIMIT) {
        const counts = new Map<number, number>();
        for (const n of nums) counts.set(n, (counts.get(n) ?? 0) + 1);
        out.push({
          kind: 'options', key, label: meta.label, unit: meta.unit,
          options: [...counts.entries()].sort((a, b) => a[0] - b[0])
            .map(([n, count]) => ({ value: displaySpecValue(n), count })),
        });
      } else {
        out.push({ kind: 'range', key, label: meta.label, unit: meta.unit, min: Math.min(...nums), max: Math.max(...nums) });
      }
    } else {
      const counts = new Map<string, number>();
      for (const s of specs) {
        if (!isAnswered(s[key])) continue;
        const v = displaySpecValue(s[key]);
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      if (counts.size < 2 || counts.size > OPTION_LIMIT) continue;
      out.push({
        kind: 'options', key, label: meta.label, unit: meta.unit,
        options: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([value, count]) => ({ value, count })),
      });
    }
  }
  return out;
}

/** What the person has chosen: a numeric window, or a set of ticked values, per field. */
export type FacetState = Record<string, { min?: number; max?: number } | string[]>;

/**
 * Items that pass every active facet. An item that does not ANSWER a field a
 * range is set on is excluded — "modules between 600 and 700 Wp" cannot
 * include one whose wattage is unknown — while an empty state passes all.
 */
export function applyFacets(items: ShopItem[], state: FacetState): ShopItem[] {
  const active = Object.entries(state).filter(([, v]) =>
    Array.isArray(v) ? v.length > 0 : v.min != null || v.max != null);
  if (active.length === 0) return items;
  return items.filter((i) => {
    const s = specsOf(i);
    return active.every(([key, sel]) => {
      if (Array.isArray(sel)) return isAnswered(s[key]) && sel.includes(displaySpecValue(s[key]));
      const n = specNumber(s[key]);
      if (n == null) return false;
      if (sel.min != null && n < sel.min) return false;
      if (sel.max != null && n > sel.max) return false;
      return true;
    });
  });
}

/** Table columns for a category: its highlighted fields, at most five. */
export const columnsFor = (category: string | null | undefined): string[] =>
  declaredFields(category).filter((k) => fieldMeta(k).highlight).slice(0, 5);

/** A category's customer-facing name — ours where the business one is jargon. */
const CATEGORY_LABEL_ID: Record<string, string> = {
  pv_module: 'Modul surya', inverter_charger: 'Inverter hybrid / off-grid',
  on_grid_inverter: 'Inverter on-grid', power_inverter: 'Power inverter',
  batteries: 'Baterai', portable_power: 'Power station portabel',
  solar_charge_controller: 'Solar charge controller', mounting: 'Mounting',
  accessories: 'Proteksi & aksesori', pv_cable: 'Kabel PV', solar_pump_inverter: 'Inverter pompa surya',
  ups: 'UPS', stabilizer: 'Stabilizer', ev_charger: 'Pengisi daya EV',
  standing_cabinet: 'Kabinet berdiri', wallmount_cabinet: 'Kabinet dinding',
};
export const categoryLabel = (category: string | null | undefined): string =>
  (category && (CATEGORY_LABEL_ID[category] ?? CATEGORY_LABELS[category])) || '';

/**
 * Everything a person might type to find this item, lowercased: name, model,
 * brand, category, the capacity in its own unit ("620wp"), and the highlighted
 * spec values with their units ("48v", "5000w"). Spaces are also collapsed so
 * "5 kw" and "5kw" both land.
 */
export function searchText(i: ShopItem): string {
  const parts: string[] = [shopName(i), i.supplier_model, i.brand ?? '', categoryLabel(i.category), CATEGORY_LABELS[i.category ?? ''] ?? ''];
  const cu = i.category ? CATEGORY_UNITS[i.category] : undefined;
  if (cu && Number(i.norm_value) > 0) parts.push(`${Number(i.norm_value)}${cu.unit}`, `${Number(i.norm_value)} ${cu.unit}`);
  const s = specsOf(i);
  for (const k of columnsFor(i.category)) {
    if (!isAnswered(s[k])) continue;
    const v = displaySpecValue(s[k]);
    const u = fieldMeta(k).unit ?? '';
    parts.push(v, u ? `${v}${u}` : '');
  }
  const text = parts.filter(Boolean).join(' ').toLowerCase();
  return `${text} ${text.replace(/\s+/g, '')}`;
}

/** Does the item answer every token of the query? "5kw 48v" needs both. */
export function matchesQuery(i: ShopItem, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = searchText(i);
  return tokens.every((t) => hay.includes(t));
}

/**
 * Search results, best first: a hit in the model number outranks one in the
 * description, which outranks one in a spec value. Ties keep capacity order.
 */
export function searchItems(items: ShopItem[], query: string): ShopItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const compact = q.replace(/\s+/g, '');
  const score = (i: ShopItem): number => {
    const model = i.supplier_model.toLowerCase().replace(/\s+/g, '');
    if (model === compact) return 0;
    if (model.startsWith(compact)) return 1;
    if (model.includes(compact)) return 2;
    if (shopName(i).toLowerCase().includes(q)) return 3;
    return 4;
  };
  return items.filter((i) => matchesQuery(i, q))
    .sort((a, b) => score(a) - score(b) || Number(b.norm_value ?? 0) - Number(a.norm_value ?? 0) || shopName(a).localeCompare(shopName(b)));
}

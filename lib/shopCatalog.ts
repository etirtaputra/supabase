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

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
import { MAIN_CATEGORIES } from '../constants/productTaxonomy.ts';

/** What a storefront needs of a catalogue row — deliberately less than a row has. */
export interface ShopItem {
  component_id: string;
  internal_description: string | null;
  /** Present in the ERP's rows; the shop neither fetches nor shows it. */
  supplier_model?: string;
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
 * aisle to someone shopping, and `non_stock` (project one-off lines, cable
 * tray and ladder) is not an aisle at all, which is why it appears in no
 * department and therefore never reaches the shop.
 *
 * This is DERIVED from `MAIN_CATEGORIES`, the one taxonomy the ERP renders
 * too, so a department cannot exist on the shop that the Item Editor has never
 * heard of. What the shop supplies is the language: `labelId`, because the
 * storefront is Indonesian-primary and the ERP is not.
 */
export const DEPARTMENTS: readonly Department[] = MAIN_CATEGORIES.map((m) => ({
  key: m.key,
  label: m.labelId,
  categories: m.categories,
  blurb: m.blurb,
}));

const DEPT_OF_CATEGORY = new Map<string, Department>();
for (const d of DEPARTMENTS) for (const c of d.categories) DEPT_OF_CATEGORY.set(c, d);

export const departmentOf = (category: string | null | undefined): Department | null =>
  (category && DEPT_OF_CATEGORY.get(category)) || null;

export const departmentByKey = (key: string): Department | null =>
  DEPARTMENTS.find((d) => d.key === key) ?? null;

/**
 * The customer-facing name: OUR description, and nothing else.
 *
 * The supplier's own description and model code never reach a customer
 * (owner, 2026-09-05) — it is the supplier's naming, not ours, and it is
 * how a buyer finds the same item elsewhere. An item with no description of
 * ours has no name on the shop, and so is not on the shop.
 */
export const shopName = (i: ShopItem): string => (i.internal_description || '').trim();

/**
 * On the shop at all? A department, and a name OF OURS. NOT a price: an item
 * without one is quote-only, which is a real way to sell a 250 kW pump
 * inverter — and showing it is how the gap in the catalogue stays visible.
 */
export const isShoppable = (i: ShopItem): boolean =>
  !!departmentOf(i.category) && shopName(i).length > 0;

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
  switchgear: 'Switchgear', monitoring: 'Monitoring & komunikasi',
  accessories: 'Aksesori', pv_cable: 'Kabel PV', ac_cable: 'Kabel AC',
  solar_pump_inverter: 'Inverter pompa surya',
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
  const parts: string[] = [shopName(i), i.brand ?? '', categoryLabel(i.category), CATEGORY_LABELS[i.category ?? ''] ?? '', familyOf(i)?.label ?? ''];
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
 * Search results, best first. A hit early in OUR name (the brand and model
 * come first in it) outranks one buried later, which outranks a hit only in a
 * spec value or category. Ties keep capacity order.
 */
export function searchItems(items: ShopItem[], query: string): ShopItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const compact = q.replace(/\s+/g, '');
  const first = q.split(/\s+/)[0];
  const score = (i: ShopItem): number => {
    const name = shopName(i).toLowerCase();
    const at = name.replace(/\s+/g, '').indexOf(compact);
    if (at >= 0) return at;
    const t = name.indexOf(first);
    return t >= 0 ? 1000 + t : 10000;
  };
  return items.filter((i) => matchesQuery(i, q))
    .sort((a, b) => score(a) - score(b) || Number(b.norm_value ?? 0) - Number(a.norm_value ?? 0) || shopName(a).localeCompare(shopName(b)));
}

// ── Families: the first cut inside a category ────────────────────────────────
//
// A category is the business's cut; a FAMILY is the buyer's first question
// inside it — "rail, clamp, or foot?", "on-grid or off-grid?", "12 V or 48 V?".
// McMaster opens every category with that question. These are rules over the
// item's own name and capacity, first match wins, and an item no rule claims
// is "Lainnya" rather than hidden: a family list that quietly dropped items
// would be a worse catalogue than none.

export interface Family { key: string; label: string; test: (i: ShopItem) => boolean; }

const re = (r: RegExp) => (i: ShopItem) => r.test(shopName(i));
const cap = (lo: number, hi = Infinity) => (i: ShopItem) => {
  const n = Number(i.norm_value); return Number.isFinite(n) && n >= lo && n < hi;
};
const both = (...fs: ((i: ShopItem) => boolean)[]) => (i: ShopItem) => fs.every((f) => f(i));
const not = (f: (i: ShopItem) => boolean) => (i: ShopItem) => !f(i);

export const FAMILIES: Record<string, readonly Family[]> = {
  mounting: [
    { key: 'walkway',   label: 'Walkway',                       test: re(/walkway/i) },
    { key: 'splice',    label: 'Sambungan rail (splice)',       test: re(/splice|jointer/i) },
    { key: 'rail',      label: 'Rail',                          test: re(/\brail\b/i) },
    { key: 'roofclamp', label: 'Klem atap metal',               test: re(/klip-lok|standing seam/i) },
    { key: 'clamp',     label: 'Klem modul (end / mid)',        test: re(/clamp/i) },
    { key: 'foot',      label: 'Kaki & penyangga',              test: re(/l feet|z support|tripod|support kit|support \d|asphalt/i) },
    { key: 'ground',    label: 'Grounding',                     test: re(/ground|earthing/i) },
    { key: 'hardware',  label: 'Baut, sekrup & aksesori',       test: re(/bolt|screw|nut|epdm|cable clip/i) },
  ],
  switchgear: [
    { key: 'mcb',       label: 'MCB & MCCB DC',                 test: re(/\bmccb\b|\bmcb\b/i) },
    { key: 'fuse',      label: 'Fuse & fuse holder',            test: re(/fuse/i) },
    { key: 'spd',       label: 'SPD (surge protection)',        test: re(/\bspd\b/i) },
    { key: 'box',       label: 'Box distribusi',                test: re(/distribution box|combiner|panel box/i) },
  ],
  monitoring: [
    { key: 'logger',    label: 'Data logger & stick',           test: re(/logger|stick|smartmgc|com100/i) },
    { key: 'meter',     label: 'kWh meter & CT',                test: re(/\bmeter\b|dtsu|dtsd|\bsdm\d/i) },
    { key: 'comm',      label: 'WiFi, 4G & antarmuka',          test: re(/wifi|\bble\b|rj45|\btcp\b|serial|\b4g\b|gps|pal-adp|rc-01/i) },
  ],
  accessories: [
    { key: 'mc4',       label: 'Konektor MC4',                  test: re(/mc4|connector/i) },
    { key: 'battacc',   label: 'Aksesori baterai',              test: re(/bos-|pdu|cluster|rack battery/i) },
    { key: 'converter', label: 'Konverter DC-DC',               test: re(/dc-dc|converter/i) },
  ],
  solar_charge_controller: [
    { key: 'pwm',       label: 'PWM',                           test: re(/\bpwm\b|\bLS\d|\bVS\d/) },
    { key: 'tracer',    label: 'MPPT Tracer (10–100 A)',        test: re(/tracer/i) },
    { key: 'xtra',      label: 'MPPT XTRA (10–40 A)',           test: re(/xtra/i) },
    { key: 'industrial',label: 'MPPT industri IT / ET / TEP / TES / TIS (50–100 A)', test: re(/\b(IT|ET|TEP|TES|TIS)\d/) },
  ],
  batteries: [
    { key: 'hv',        label: 'Baterai HV (high voltage)',     test: re(/\bhv\b|high.?voltage|409\.6|bos-|hr16/i) },
    { key: 'v48',       label: 'LiFePO4 48 V (rak)',            test: re(/51\.2 ?v|48 ?v|\bLR51|\bLS51|\bLF51/i) },
    { key: 'v24',       label: 'LiFePO4 24 V',                  test: re(/25\.6 ?v|24 ?v|\bLR25|\bLW25/i) },
    { key: 'v12',       label: '12 V (LiFePO4 & VRLA)',         test: re(/12\.8 ?v|12 ?v|\bLIP12|\bIP12/i) },
  ],
  inverter_charger: [
    { key: 'hybrid3',   label: 'Hybrid 3 fasa & HV',            test: re(/three-?phase|\b3p\b|hv hybrid|\bpcs\b|sg0[12]hp3|sg05lp3|wp ii|luna/i) },
    { key: 'offgrid',   label: 'Off-grid inverter charger',     test: re(/\b(UC|UCP|KR|QI|UP)\d|SNV-GF/) },
    { key: 'hybrid1',   label: 'Hybrid 1 fasa (24–48 V)',       test: re(/./) },
  ],
  on_grid_inverter: [
    { key: 'res',       label: 'Residensial (≤ 5 kW)',          test: cap(0, 5001) },
    { key: 'com',       label: 'Komersial (6–30 kW)',           test: cap(5001, 30001) },
    { key: 'ind',       label: 'Industri (> 30 kW)',            test: cap(30001) },
  ],
  solar_pump_inverter: [
    { key: 'ip65',      label: '3 fasa 380 V, IP65',            test: re(/ip65/i) },
    { key: 'ph1',       label: '1 fasa 220 V',                  test: re(/\b1 ?ph\b|220 ?v|-2s\b/i) },
    { key: 'ph3',       label: '3 fasa 380 V',                  test: re(/380 ?v|\b3 ?ph\b|-4t\b/i) },
  ],
  pv_module: [
    { key: 'bifacial',  label: 'Bifacial N-type TOPCon',        test: re(/bifacial|n-type|topcon/i) },
    { key: 'mono',      label: 'Mono ≥ 500 Wp',                 test: both(not(re(/bifacial/i)), cap(500)) },
    { key: 'small',     label: 'Mono kecil (≤ 200 Wp)',         test: cap(0, 500) },
  ],
  pv_cable: [
    { key: 'c4',        label: '4 mm²',                         test: re(/\b4 ?mm/i) },
    { key: 'c6',        label: '6 mm²',                         test: re(/\b6 ?mm/i) },
    { key: 'c10',       label: '10 mm²',                        test: re(/\b10 ?mm/i) },
  ],
  // The buyer's first question about an AC cable is its CONSTRUCTION, not its
  // size — the size is the second, and it is already a spec filter. These are
  // the same SPLN/IEC codes the categorisation migration filed the rows on.
  ac_cable: [
    { key: 'mv',        label: 'Tegangan menengah 20 kV (N2XSY / N2XSEBY)', test: re(/\bn2xsy\b|\bn2xseby\b|\bn2xsefgby\b/i) },
    { key: 'xlpe',      label: 'XLPE tanah (N2XY / NA2XY)',     test: re(/\bn2xy\b|\bna2xy\b/i) },
    { key: 'armoured',  label: 'Berperisai (NYFGbY / NYRGbY)',  test: re(/\bnyfgby\b|\bnyrgby\b|\bnyfgbf\b/i) },
    { key: 'aerial',    label: 'Udara berpilin (NFA2X)',        test: re(/\bnfa2x\b|\bnfa2xt\b|twisted/i) },
    { key: 'nyy',       label: 'Instalasi tetap (NYY / NYM)',   test: re(/\bnyy\b|\bnyyhy\b|\bnym\b|\bnymhy\b/i) },
    { key: 'nyaf',      label: 'Kabel serabut & tunggal (NYAF / NYA)', test: re(/\bnyaf\b|\bnyaaf\b|\bnya\b/i) },
  ],
};

export const OTHER_FAMILY: Family = { key: 'lainnya', label: 'Lainnya', test: () => true };

/** The families a category opens with — empty when it lists directly. */
export const familiesOf = (category: string | null | undefined): readonly Family[] =>
  (category && FAMILIES[category]) || [];

/** Which family claims this item: the first whose rule matches, else Lainnya when the category has families at all. */
export function familyOf(i: ShopItem): Family | null {
  const fams = familiesOf(i.category);
  if (fams.length === 0) return null;
  return fams.find((f) => f.test(i)) ?? OTHER_FAMILY;
}

/** Families present in a set of items, with counts, in declared order; Lainnya last and only if used. */
export function familyIndex(category: string | null | undefined, items: ShopItem[]): { family: Family; n: number; min: number | null }[] {
  const fams = familiesOf(category);
  if (fams.length === 0) return [];
  const rows = [...fams, OTHER_FAMILY].map((family) => ({ family, n: 0, min: null as number | null }));
  for (const i of items) {
    const f = familyOf(i);
    const row = rows.find((r) => r.family.key === (f?.key ?? OTHER_FAMILY.key))!;
    row.n += 1;
    if (hasPrice(i)) { const p = Number(i.selling_price_idr); row.min = row.min == null ? p : Math.min(row.min, p); }
  }
  return rows.filter((r) => r.n > 0);
}

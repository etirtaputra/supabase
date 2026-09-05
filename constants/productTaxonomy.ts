/**
 * productTaxonomy — the ONE product hierarchy, for the ERP and the shop alike.
 *
 * Three levels, and only the middle one is stored:
 *
 *   Main category   "Inverters"            DERIVED here, never typed, never a
 *                                          column — so it cannot disagree with
 *                                          itself between two screens.
 *   Category        `inverter_charger`     the existing `3.0_components.category`
 *                                          enum. Unchanged, one column.
 *   Sub-category    "Hybrid"               a DECLARED SPEC FIELD in the
 *                                          `specifications` jsonb every item
 *                                          already carries (see
 *                                          SUBCATEGORY_FIELD below).
 *
 * The point of the middle level being an enum and the outer two being
 * declarations: a finer cut costs no schema. The discipline that keeps this
 * from sprawling into a taxonomy rewrite is one rule —
 *
 *   **A NEW CATEGORY only when the spec field set genuinely differs.
 *   A SUB-CATEGORY when it does not.**
 *
 * MPPT and PWM answer the same datasheet questions, so they are sub-categories
 * of one category. An AC cable has no Voc rating and a PV cable has no phase,
 * so those are two categories.
 *
 * ── Naming (owner, 2026-09-05) ──────────────────────────────────────────────
 * `CATEGORY_LABEL` is the ONLY place a category's human name is written. Before
 * this file there were three answers to "what is this category called": the raw
 * enum (`pv_module`, rendered as-is in the Item Editor), `formatCategory()`'s
 * acronym-aware humaniser ("PV Module"), and a hand-written `CATEGORY_LABELS`
 * map in `categoryUnits.ts` ("PV Module"). Both of those now read from here, so
 * every screen says the same word.
 */

export interface MainCategory {
  key: string;
  /** The canonical English name — what the ERP renders, and the i18n key. */
  label: string;
  /** What the shop renders; it is Indonesian-primary and customer-facing. */
  labelId: string;
  /** One line under the department tile on the shop index. */
  blurb: string;
  /** The `product_category` enum values that roll up into it. */
  categories: readonly string[];
}

/**
 * The customer's aisle. This is the buyer's cut of the catalogue, not the
 * business's: the three inverter categories are ONE aisle because nobody
 * shops for "an inverter_charger".
 *
 * `non_stock` belongs to no main category ON PURPOSE — after the AC cables
 * were lifted out of it, what remains is project one-offs, cable tray and
 * ladder, and it has no place on a storefront.
 */
export const MAIN_CATEGORIES: readonly MainCategory[] = [
  { key: 'panel', label: 'Solar Panels', labelId: 'Panel Surya',
    blurb: 'Modul monokristal dan bifacial N-type',
    categories: ['pv_module'] },
  { key: 'inverter', label: 'Inverters', labelId: 'Inverter',
    blurb: 'On-grid, hybrid, dan off-grid',
    categories: ['inverter_charger', 'on_grid_inverter', 'power_inverter'] },
  { key: 'battery', label: 'Batteries', labelId: 'Baterai & Penyimpanan',
    blurb: 'LiFePO4 rak, dinding, dan portabel',
    categories: ['batteries', 'portable_power'] },
  { key: 'controller', label: 'Solar Charge Controllers', labelId: 'Solar Charge Controller',
    blurb: 'MPPT dan PWM, 10–100 A',
    categories: ['solar_charge_controller'] },
  { key: 'cable', label: 'Cables', labelId: 'Kabel',
    blurb: 'Kabel PV H1Z2Z2-K dan kabel AC',
    categories: ['pv_cable', 'ac_cable'] },
  { key: 'switchgear', label: 'Switchgears', labelId: 'Switchgear',
    blurb: 'MCB, MCCB, SPD, fuse, dan box distribusi',
    categories: ['switchgear'] },
  { key: 'mounting', label: 'Mounting', labelId: 'Mounting',
    blurb: 'Rail, klem, kaki, dan grounding',
    categories: ['mounting'] },
  { key: 'monitoring', label: 'Monitoring & Comms', labelId: 'Monitoring & Komunikasi',
    blurb: 'Logger, WiFi, kWh meter, dan gateway',
    categories: ['monitoring'] },
  { key: 'pump', label: 'Solar Pumps', labelId: 'Pompa Surya',
    blurb: 'Inverter pompa 0,75–250 kW',
    categories: ['solar_pump_inverter'] },
  { key: 'power', label: 'UPS & Stabilizers', labelId: 'UPS & Stabilizer',
    blurb: 'Cadangan daya dan penstabil tegangan',
    categories: ['ups', 'stabilizer'] },
  { key: 'ev', label: 'EV Charging', labelId: 'Pengisian EV',
    blurb: 'Pengisi daya kendaraan listrik',
    categories: ['ev_charger'] },
  { key: 'enclosure', label: 'Enclosures', labelId: 'Panel Box & Kabinet',
    blurb: 'Kabinet rak berdiri dan tempel dinding',
    categories: ['standing_cabinet', 'wallmount_cabinet'] },
  { key: 'accessory', label: 'Accessories', labelId: 'Aksesori',
    blurb: 'Konektor MC4, aksesori baterai, dan lain-lain',
    categories: ['accessories', 'box_bsp'] },
] as const;

/**
 * The human name of a CATEGORY — the single place one is written.
 *
 * These are the owner's own words where the enum was jargon: `pv_module` is
 * "Solar Panels", not "PV Module", because that is what a person shopping for
 * one calls it (owner, 2026-09-05).
 */
export const CATEGORY_LABEL: Record<string, string> = {
  accessories: 'Accessories',
  ac_cable: 'AC Cables',
  batteries: 'Batteries',
  box_bsp: 'Box / BSP',
  ev_charger: 'EV Chargers',
  inverter_charger: 'Hybrid & Off-Grid Inverters',
  monitoring: 'Monitoring & Comms',
  mounting: 'Mounting',
  non_stock: 'Non-Stock',
  on_grid_inverter: 'On-Grid Inverters',
  portable_power: 'Portable Power',
  power_inverter: 'Power Inverters',
  pv_cable: 'PV Cables',
  pv_module: 'Solar Panels',
  solar_charge_controller: 'Solar Charge Controllers',
  solar_pump_inverter: 'Solar Pump Inverters',
  stabilizer: 'Stabilizers',
  standing_cabinet: 'Standing Cabinets',
  switchgear: 'Switchgears',
  ups: 'UPS',
  wallmount_cabinet: 'Wallmount Cabinets',
};

/**
 * Which DECLARED SPEC FIELD carries a category's sub-category.
 *
 * This is the whole answer to "a second level without a second column": the
 * sub-category is a spec field, so it costs no schema, it appears in Tech Specs
 * where staff already type, and the shop turns it into a filter and a column on
 * its own — `facetsFor` and `columnsFor` generate from the declared field set.
 *
 * Four of these were ALREADY being typed before anyone called them
 * sub-categories: `bom_role` on mounting (44 of 72 rows), `controller_type`
 * (47 of 72), `battery_type` (19 of 27), `system_type` (6 of 48).
 */
export const SUBCATEGORY_FIELD: Record<string, string> = {
  pv_module: 'module_type',
  inverter_charger: 'system_type',
  batteries: 'battery_type',
  solar_charge_controller: 'controller_type',
  mounting: 'bom_role',
  switchgear: 'switchgear_type',
  monitoring: 'device_type',
  ac_cable: 'cable_construction',
};

const MAIN_OF_CATEGORY = new Map<string, MainCategory>();
for (const m of MAIN_CATEGORIES) for (const c of m.categories) MAIN_OF_CATEGORY.set(c, m);

/** The aisle a category sits in, or null when it is in none (`non_stock`). */
export const mainCategoryOf = (category: string | null | undefined): MainCategory | null =>
  (category && MAIN_OF_CATEGORY.get(category)) || null;

export const mainCategoryByKey = (key: string): MainCategory | null =>
  MAIN_CATEGORIES.find((m) => m.key === key) ?? null;

/**
 * A category's name, in one word for every screen. Falls back to the raw key
 * so a category added to the database before it is added here still renders as
 * something a person can read, rather than vanishing.
 */
export const categoryLabelOf = (category: string | null | undefined): string =>
  (category && (CATEGORY_LABEL[category] ?? category)) || '';

/**
 * "Inverters › On-Grid Inverters" — the two levels in one cell, which is how
 * the hierarchy shows up in ICAPROC without costing a second column.
 *
 * When an aisle holds exactly one category and they read the same word
 * ("Solar Panels › Solar Panels"), the repetition is dropped.
 */
export function categoryPath(category: string | null | undefined): string {
  const label = categoryLabelOf(category);
  if (!label) return '';
  const main = mainCategoryOf(category);
  if (!main || main.label === label) return label;
  return `${main.label} › ${label}`;
}

/** Categories grouped by aisle, for a two-level picker in one field slot. */
export const CATEGORY_GROUPS: readonly { main: MainCategory; categories: readonly string[] }[] =
  MAIN_CATEGORIES.map((main) => ({ main, categories: main.categories }));

/** Everything the taxonomy places, plus the ones it deliberately does not. */
export const UNGROUPED_CATEGORIES: readonly string[] = ['non_stock'];

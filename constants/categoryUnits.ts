/**
 * Normalized unit definitions per product category.
 * Used for capacity-normalized pricing comparisons (positioning map).
 *
 * UNIT CONVENTION — keep these consistent across categories, and store the
 * BASE unit (never a kilo- multiple), so the Capacity column and every
 * price-per-unit comparison line up:
 *   • Real power .......... W   (inverters, EV chargers, pumps)
 *   • Peak power .......... Wp  (PV modules)
 *   • Energy .............. Wh  (batteries, portable power)
 *   • Apparent power ...... VA  (UPS, stabilizers)
 *   • Current ............. A   (charge controllers)
 * Display code adds the k/M prefix for readability; the stored norm_value is
 * always in the base unit.
 */

export interface CategoryUnit {
  unit: string;        // e.g. 'Wp', 'W', 'mm²'
  label: string;       // e.g. 'Watt-peak', 'Watt', 'Cross-section'
  priceLabel: string;  // e.g. 'Price/Wp', 'Price/W', 'Price/m'
  axis: string;        // X-axis label on positioning map
  /** When true, unit price from quotes/POs is already the meaningful Y value (e.g. cable priced per meter).
   *  The norm_value is the X-axis spec only — do NOT divide price by norm_value. */
  priceIsPerUnit?: boolean;
}

export const CATEGORY_UNITS: Record<string, CategoryUnit> = {
  pv_module: {
    unit: 'Wp',
    label: 'Watt-peak',
    priceLabel: 'Price / Wp',
    axis: 'Capacity (Wp)',
  },
  on_grid_inverter: {
    unit: 'W',
    label: 'Watt',
    priceLabel: 'Price / W',
    axis: 'Power (W)',
  },
  power_inverter: {
    unit: 'W',
    label: 'Watt',
    priceLabel: 'Price / W',
    axis: 'Power (W)',
  },
  inverter_charger: {
    unit: 'W',
    label: 'Watt',
    priceLabel: 'Price / W',
    axis: 'Power (W)',
  },
  solar_pump_inverter: {
    unit: 'W',
    label: 'Watt',
    priceLabel: 'Price / W',
    axis: 'Power (W)',
  },
  batteries: {
    unit: 'Wh',
    label: 'Watt-hour',
    priceLabel: 'Price / Wh',
    axis: 'Capacity (Wh)',
  },
  // Watts, like every other power category — capacity units are universal so
  // "160,000 W" and "150,000 W" sit on the same scale and Price/W compares.
  ev_charger: {
    unit: 'W',
    label: 'Watt',
    priceLabel: 'Price / W',
    axis: 'Power (W)',
  },
  // AC cable is sold by the metre exactly as PV cable is, and its
  // cross-section is the axis a person compares on — same shape, own category
  // because an AC cable answers `phase` and a PV cable answers `voltage_rating`.
  ac_cable: {
    unit: 'mm²',
    label: 'Cross-section',
    priceLabel: 'Price / m',
    axis: 'Cross-section (mm²)',
    priceIsPerUnit: true,
  },
  pv_cable: {
    unit: 'mm²',
    label: 'Cross-section',
    priceLabel: 'Price / m',
    axis: 'Cross-section (mm²)',
    priceIsPerUnit: true, // unit price in quotes/POs is already per-meter; norm_value is cable gauge for X-axis only
  },
  solar_charge_controller: {
    unit: 'A',
    label: 'Ampere',
    priceLabel: 'Price / A',
    axis: 'Current (A)',
  },
  ups: {
    unit: 'VA',
    label: 'Volt-Ampere',
    priceLabel: 'Price / VA',
    axis: 'Capacity (VA)',
  },
  portable_power: {
    unit: 'Wh',
    label: 'Watt-hour',
    priceLabel: 'Price / Wh',
    axis: 'Capacity (Wh)',
  },
  stabilizer: {
    unit: 'VA',
    label: 'Volt-Ampere',
    priceLabel: 'Price / VA',
    axis: 'Capacity (VA)',
  },
};

/** Returns true if a category has a meaningful normalized unit for comparison. */
export function hasCategoryUnit(category: string | undefined): boolean {
  return !!category && category in CATEGORY_UNITS;
}

/**
 * Category names, re-exported from the ONE list that owns them
 * (`constants/productTaxonomy.ts`). This alias is kept because the cost views
 * and the positioning map already import it; it is no longer a second list
 * that could drift from the Item Editor's.
 */
export { CATEGORY_LABEL as CATEGORY_LABELS } from './productTaxonomy.ts';

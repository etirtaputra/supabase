/**
 * Normalized unit definitions per product category.
 * Used for capacity-normalized pricing comparisons (positioning map).
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
  ev_charger: {
    unit: 'kW',
    label: 'Kilowatt',
    priceLabel: 'Price / kW',
    axis: 'Power (kW)',
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

/** Human-readable category names for display. */
export const CATEGORY_LABELS: Record<string, string> = {
  accessories: 'Accessories',
  batteries: 'Batteries',
  box_bsp: 'Box / BSP',
  ev_charger: 'EV Charger',
  inverter_charger: 'Inverter Charger',
  mounting: 'Mounting',
  non_stock: 'Non-Stock',
  on_grid_inverter: 'On-Grid Inverter',
  portable_power: 'Portable Power',
  power_inverter: 'Power Inverter',
  pv_cable: 'PV Cable',
  pv_module: 'PV Module',
  solar_charge_controller: 'Solar Charge Controller',
  solar_pump_inverter: 'Solar Pump Inverter',
  stabilizer: 'Stabilizer',
  standing_cabinet: 'Standing Cabinet',
  ups: 'UPS',
  wallmount_cabinet: 'Wallmount Cabinet',
};

/**
 * Fabricated rows for the component preview (app/preview).
 *
 * Shaped to exercise what actually breaks in a chart: several series so every
 * colour in a palette gets used, a long tail so the small slices render, and
 * values spread widely enough that bars and shares are visibly different.
 *
 * Deliberately NOT realistic company data — it is a colour and layout rig, and
 * anyone reading the preview should be able to tell at a glance that these are
 * not real vendors.
 */
const SUPPLIER_NAMES = [
  'Northwind Power', 'Acme Solar', 'Blue Ridge Energy', 'Cobalt Systems', 'Delta Voltaic',
  'Everest Components', 'Fairline Electric', 'Granite Cells', 'Harbour Inverters', 'Ionis Storage',
];
const CATEGORY_NAMES = [
  'pv_module', 'inverter_charger', 'batteries', 'mounting', 'ups',
  'solar_charge_controller', 'accessories', 'pv_cable', 'solar_pump_inverter', 'non_stock',
];

/** Values fall off steeply, so both the leaders and the tail get exercised. */
const weight = (i: number) => Math.max(1, 10 - i);

export const mockSuppliers = SUPPLIER_NAMES.map((supplier_name, i) => ({
  supplier_id: `mock-s${i}`, supplier_name, supplier_code: `MS${i}`,
}));

export const mockComponents = CATEGORY_NAMES.map((category, i) => ({
  component_id: `mock-c${i}`,
  category,
  supplier_model: `MODEL-${String(i).padStart(3, '0')}`,
  internal_description: `Sample ${category.replace(/_/g, ' ')}`,
  unit: 'pcs',
  selling_price_idr: weight(i) * 1_250_000,
  norm_value: weight(i) * 100,
}));

export const mockPos = SUPPLIER_NAMES.map((_, i) => ({
  po_id: `mock-p${i}`, po_number: `PO-MOCK-${i}`, supplier_id: `mock-s${i}`,
  status: i % 4 === 0 ? 'Sent' : 'Confirmed',
  po_date: `2026-0${(i % 8) + 1}-1${i % 9}`,
  currency: 'IDR', exchange_rate: 1,
  total_value: weight(i) * 450_000_000,
  estimated_delivery_date: null, actual_received_date: null,
}));

export const mockPoItems = CATEGORY_NAMES.map((_, i) => ({
  po_id: `mock-p${i}`, component_id: `mock-c${i}`,
  quantity: weight(i) * 240, unit_cost: weight(i) * 320_000, currency: 'IDR',
}));

export const mockPoCosts = SUPPLIER_NAMES.map((_, i) => ({
  po_id: `mock-p${i}`, cost_id: `mock-cost${i}`, cost_category: 'supplier_principal',
  amount: weight(i) * 300_000_000, currency: 'IDR', exchange_rate: 1,
  payment_date: `2026-0${(i % 8) + 1}-2${i % 8}`,
}));

export const mockQuotes = SUPPLIER_NAMES.map((_, i) => ({
  quote_id: `mock-q${i}`, supplier_id: `mock-s${i}`,
  quote_date: `2026-0${(i % 8) + 1}-0${(i % 8) + 1}`, currency: 'IDR', exchange_rate: 1,
}));

export const mockQuoteItems = CATEGORY_NAMES.map((_, i) => ({
  quote_id: `mock-q${i}`, component_id: `mock-c${i}`,
  quantity: weight(i) * 120, unit_cost: weight(i) * 300_000, currency: 'IDR',
}));

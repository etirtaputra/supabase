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

// ── Dashboard widgets ────────────────────────────────────────────────────────
// Shaped to exercise the awkward cases rather than the happy one: a loss-making
// row, an estimated cost, a name long enough to truncate, a zero, a missing
// date. Those are where a widget's layout actually breaks.

export const mockQueue = [
  { key: 'q1', domain: 'buy', kind: 'PO', tone: 'urgent', href: '/purchasing',
    title: '16 POs overdue', detail: 'paid for, past expected arrival — oldest 273 days late', amount: 2_102_509_390 },
  { key: 'q2', domain: 'buy', kind: 'PO', tone: 'normal', href: '/stock/reconcile',
    title: '23 POs costing more than stock says', detail: 'bills landed after the goods did', amount: 708_985_067 },
  { key: 'q3', domain: 'sell', kind: 'Order', tone: 'normal', href: '/sales',
    title: '2 orders cannot ship', detail: '1 item short of confirmed demand', amount: 4_678_650 },
  { key: 'q4', domain: 'cash', kind: 'Bank', tone: 'normal', href: '/banks',
    title: '294 movements not on a bank account', detail: 'until they are tagged, no statement reconciles', amount: 0 },
];

export const mockActivity = [
  { key: 'a1', domain: 'sell', kind: 'Invoice', title: 'INV-2026-0042', sub: 'Northwind Power', at: '2026-08-21', href: '/invoices' },
  { key: 'a2', domain: 'buy', kind: 'PO', title: 'PO-MOCK-3', sub: 'Cobalt Systems', at: '2026-08-20', href: '/purchasing' },
  { key: 'a3', domain: 'cash', kind: 'Paid', title: 'Delta Voltaic', sub: 'supplier principal', at: '2026-08-19', href: '/banks' },
];

export const mockMotion = [
  { key: 'invoiced', label: 'Invoiced', now: 812_000_000, prev: 645_000_000, deltaPct: 25.9 },
  { key: 'received', label: 'Received', now: 402_000_000, prev: 511_000_000, deltaPct: -21.3 },
  { key: 'paid-out', label: 'Paid out', now: 690_000_000, prev: 690_000_000, deltaPct: 0 },
  { key: 'nobase', label: 'Delivered', now: 15_000_000, prev: 0, deltaPct: null },
];

export const mockNewArrivals = [
  { component_id: 'mock-c0', name: 'Sample pv module 550W monocrystalline half-cut', unit: 'pcs',
    qty: 120, arrivedAt: '2026-08-21', daysAgo: 0, brandNew: true, needsPrice: true },
  { component_id: 'mock-c1', name: 'Sample inverter charger', unit: 'pcs',
    qty: 8, arrivedAt: '2026-08-18', daysAgo: 3, brandNew: true, needsPrice: false },
  { component_id: 'mock-c2', name: 'Sample batteries', unit: 'pcs',
    qty: 40, arrivedAt: '2026-08-15', daysAgo: 6, brandNew: false, needsPrice: false },
];

export const mockArriving = {
  soon: [
    { component_id: 'mock-c3', name: 'Sample mounting rail', unit: 'pcs', qty: 400,
      expected: '2026-09-04', source: 'eta' as const, daysAway: 13, overdue: false, pos: ['PO-MOCK-3'] },
    { component_id: 'mock-c4', name: 'Sample ups', unit: 'pcs', qty: 12,
      expected: null, source: null, daysAway: null, overdue: false, pos: [] },
  ],
  late: [
    { component_id: 'mock-c5', name: 'Sample solar charge controller', unit: 'pcs', qty: 30,
      expected: '2026-05-18', source: 'lead' as const, daysAway: -96, overdue: true, pos: ['PO-MOCK-5'] },
  ],
  openPos: 25, posWithoutEta: 21, stalePos: 16, oldestStaleDays: 311,
};

export const mockBoard = {
  rows: [
    { key: 'b1', name: 'Northwind Power', sub: '4 orders · 120 items', revenue: 812_000_000, profit: 214_000_000, margin: 26.4, share: 0.52, estimated: false },
    { key: 'b2', name: 'Acme Solar', sub: '2 orders · 40 items', revenue: 410_000_000, profit: 61_000_000, margin: 14.9, share: 0.27, estimated: true },
    { key: 'b3', name: 'Blue Ridge Energy', sub: '1 order · 8 items', revenue: 190_000_000, profit: -22_000_000, margin: -11.6, share: 0, estimated: false },
  ],
  ranked: 7, total: 1_560_000_000, anyEstimated: true, profitKnown: true,
};

export const mockPayments = {
  rows: [
    { key: 'in-1', title: 'Northwind Power', sub: 'SO-2026-011 · transfer', at: '2026-08-21', amount: 240_000_000, direction: 'in' as const, href: '/invoices' },
    { key: 'out-1', title: 'PO-MOCK-2', sub: 'supplier principal', at: '2026-08-20', amount: 1_120_000_000, direction: 'out' as const, href: '/purchasing?tab=financials' },
    { key: 'out-2', title: 'PO-MOCK-7', sub: 'freight cost', at: '2026-08-18', amount: 18_500_000, direction: 'out' as const, href: '/purchasing?tab=financials' },
  ],
  includes: ['in', 'out'],
};

export const mockPosition = {
  cash: { accounts: 4, byCurrency: [{ currency: 'IDR', total: -1_240_000_000 }, { currency: 'USD', total: 12_400 }] },
  ar: { outstanding: 640_000_000, overdue: 210_000_000, openCount: 9 },
  ap: { outstanding: 2_980_000_000, receivedOwed: 420_000_000, openCount: 23, excludedNoRate: 2 },
  ccc: { ccc: 118, dio: 96, dso: 41, dpo: 19, stockValue: 3_100_000_000 },
  inTransit: { paidIdr: 2_102_509_390, overdueCount: 16 },
  motion: mockMotion,
};

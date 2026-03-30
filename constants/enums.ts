/**
 * Enum definitions for the supply chain application
 * Centralized constants for dropdowns and validation
 */

export const ENUMS = {
  currency: ['USD', 'RMB', 'IDR'] as const,

  product_category: [
    'accessories',
    'batteries',
    'box_bsp',
    'inverter_charger',
    'mounting',
    'non_stock',
    'on_grid_inverter',
    'portable_power',
    'power_inverter',
    'pv_cable',
    'pv_module',
    'solar_charge_controller',
    'solar_pump_inverter',
    'standing_cabinet',
    'wallmount_cabinet',
  ] as const,

  // Unified PO cost categories (replaces payment_category + landed_costs_type)
  po_cost_category: [
    // Payment categories
    'down_payment',
    'balance_payment',
    'additional_balance_payment',
    'overpayment_credit',
    // Bank fee categories
    'full_amount_bank_fee',
    'telex_bank_fee',
    'value_today_bank_fee',
    'admin_bank_fee',
    'inter_bank_transfer_fee',
    // Landed cost categories
    'local_import_duty',
    'local_vat',
    'local_income_tax',
    'local_delivery',
    'demurrage_fee',
    'penalty_fee',
    'dhl_advance_payment_fee',
    'local_import_tax',
  ] as const,

  // Legacy enums (kept for backward compatibility if needed)
  payment_category: [
    'down_payment',
    'balance_payment',
    'additional_balance_payment',
    'overpayment_credit',
    'full_amount_bank_fee',
    'telex_bank_fee',
    'value_today_bank_fee',
    'admin_bank_fee',
    'inter_bank_transfer_fee',
  ] as const,

  landed_costs_type: [
    'local_import_duty',
    'local_vat',
    'local_income_tax',
    'local_delivery',
    'demurrage_fee',
    'penalty_fee',
    'dhl_advance_payment_fee',
    'local_import_tax',
  ] as const,

  method_of_shipment: ['Sea', 'Air', 'Local Delivery'] as const,

  price_quotes_status: ['Open', 'Accepted', 'Replaced', 'Rejected', 'Expired'] as const,

  proforma_status: ['Open', 'Accepted', 'Replaced', 'Rejected', 'Expired'] as const,

  purchases_status: [
    'Draft',
    'Sent',
    'Confirmed',
    'Replaced',
    'Partially Received',
    'Fully Received',
    'Cancelled',
  ] as const,

  lead_time: [
    '2 working day',
    '3 working days',
    '5 working days',
    '7 working days',
    '10 working days',
    '14 working days',
    '21 working days',
    '30 working days',
    '45 working days',
    '60 working days',
    '90 working days',
  ] as const,

  // ── Competitor / Market Intelligence ───────────────────────────────────
  competitor_price_type: [
    'listed',        // Public website / catalogue price
    'quoted',        // Received formal quote
    'contracted',    // Known contracted / deal price
    'estimated',     // Derived / estimated from other data
    'market_report', // Industry report (PVInfoLink, BloombergNEF, etc.)
  ] as const,

  competitor_source_type: [
    'website',
    'supplier_quote',
    'customer_info',
    'industry_report',
    'trade_show',
    'distributor_list',
    'other',
  ] as const,

  competitor_confidence: ['high', 'medium', 'low'] as const,

  market_region: [
    'Indonesia',
    'Philippines',
    'Vietnam',
    'Malaysia',
    'Thailand',
    'Singapore',
    'Southeast Asia',
    'Australia',
    'China',
    'Global',
  ] as const,
} as const;

// Export type-safe enum value types
export type Currency = typeof ENUMS.currency[number];
export type ProductCategory = typeof ENUMS.product_category[number];
export type PaymentCategory = typeof ENUMS.payment_category[number];
export type LandedCostsType = typeof ENUMS.landed_costs_type[number];
export type MethodOfShipment = typeof ENUMS.method_of_shipment[number];
export type PriceQuotesStatus = typeof ENUMS.price_quotes_status[number];
export type ProformaStatus = typeof ENUMS.proforma_status[number];
export type PurchasesStatus = typeof ENUMS.purchases_status[number];
export type LeadTime = typeof ENUMS.lead_time[number];
export type CompetitorPriceType = typeof ENUMS.competitor_price_type[number];
export type CompetitorSourceType = typeof ENUMS.competitor_source_type[number];
export type CompetitorConfidence = typeof ENUMS.competitor_confidence[number];
export type MarketRegion = typeof ENUMS.market_region[number];

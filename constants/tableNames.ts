/**
 * Supabase table name constants
 * Centralized to avoid typos and enable easy refactoring
 */

export const TABLE_NAMES = {
  COMPANIES: '1.0_companies',
  SUPPLIERS: '2.0_suppliers',
  COMPONENTS: '3.0_components',
  PRICE_QUOTES: '4.0_price_quotes',
  PRICE_QUOTE_LINE_ITEMS: '4.1_price_quote_line_items',
  PROFORMA_INVOICES: '5.0_proforma_invoices',
  PURCHASES: '6.0_purchases',
  PURCHASE_LINE_ITEMS: '6.1_purchase_line_items',
  PAYMENT_DETAILS: '7.0_payment_details',
  LANDED_COSTS: '7.1_landed_costs',
  PURCHASE_HISTORY: 'purchase_history',
  QUOTE_HISTORY: 'quote_history',
} as const;

export type TableName = typeof TABLE_NAMES[keyof typeof TABLE_NAMES];

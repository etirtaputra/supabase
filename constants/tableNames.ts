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
  PROFORMA_INVOICES: '5.0_proforma_invoices', // Still exists for historical data
  PURCHASES: '5.0_purchases', // Renamed from 6.0, now includes PI fields
  PURCHASE_LINE_ITEMS: '5.1_purchase_line_items', // Renamed from 6.1
  PO_COSTS: '6.0_po_costs', // Unified costs table (replaces payment_details + landed_costs)
  PURCHASE_HISTORY: 'purchase_history',
  QUOTE_HISTORY: 'quote_history',
} as const;

export type TableName = typeof TABLE_NAMES[keyof typeof TABLE_NAMES];

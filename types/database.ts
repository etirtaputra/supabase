/**
 * Database entity type definitions
 * Provides type safety for Supabase queries and responses
 */

import type {
  Currency,
  ProductCategory,
  PaymentCategory,
  LandedCostsType,
  MethodOfShipment,
  PriceQuotesStatus,
  ProformaStatus,
  PurchasesStatus,
  LeadTime,
} from '../constants/enums';

// Base entity with common fields
export interface BaseEntity {
  created_at?: string;
  updated_at?: string;
}

// 1.0 Companies
export interface Company extends BaseEntity {
  company_id: number;
  legal_name: string;
}

// 2.0 Suppliers
export interface Supplier extends BaseEntity {
  supplier_id: number;
  supplier_name: string;
  supplier_code?: string;
  location?: string;
  primary_contact_email?: string;
  payment_terms_default?: string;
  supplier_bank_details?: string;
}

// 3.0 Components
export interface Component extends BaseEntity {
  component_id: number;
  model_sku: string;
  description: string;
  brand?: string;
  category?: ProductCategory;
  specifications?: Record<string, any>;
}

// 4.0 Price Quotes
export interface PriceQuote extends BaseEntity {
  quote_id: number;
  supplier_id: number;
  company_id: number;
  quote_date: string;
  pi_number?: string;
  currency: Currency;
  total_value: number;
  status?: PriceQuotesStatus;
  estimated_lead_time_days?: LeadTime;
  replaces_quote_id?: number;
}

// 4.1 Price Quote Line Items
export interface PriceQuoteLineItem extends BaseEntity {
  quote_item_id: number;
  quote_id: number;
  component_id: number;
  supplier_description?: string;
  quantity: number;
  unit_price: number;
  currency: Currency;
}

// 5.0 Proforma Invoices
export interface ProformaInvoice extends BaseEntity {
  pi_id: number;
  quote_id?: number;
  pi_number: string;
  pi_date: string;
  status?: ProformaStatus;
  replaces_pi_id?: number;
}

// 6.0 Purchases (Purchase Orders)
export interface PurchaseOrder extends BaseEntity {
  po_id: number;
  pi_id?: number;
  po_number: string;
  po_date: string;
  incoterms?: string;
  method_of_shipment?: MethodOfShipment;
  currency: Currency;
  exchange_rate?: number;
  total_value?: number;
  payment_terms?: string;
  freight_charges_intl?: number;
  estimated_delivery_date?: string;
  actual_delivery_date?: string;
  actual_received_date?: string;
  status?: PurchasesStatus;
  replaces_po_id?: number;
}

// 6.1 Purchase Line Items
export interface PurchaseLineItem extends BaseEntity {
  po_item_id: number;
  po_id: number;
  component_id: number;
  supplier_description?: string;
  quantity: number;
  unit_cost: number;
  currency: Currency;
}

// 7.0 Payment Details
export interface PaymentDetail extends BaseEntity {
  payment_id: number;
  po_id: number;
  category: PaymentCategory;
  amount: number;
  currency: Currency;
  payment_date: string;
  notes?: string;
}

// 7.1 Landed Costs
export interface LandedCost extends BaseEntity {
  landed_cost_id: number;
  po_id: number;
  cost_type: LandedCostsType;
  amount: number;
  currency: Currency;
  payment_date?: string;
  notes?: string;
}

// Purchase History
export interface PurchaseHistory extends BaseEntity {
  history_id: number;
  po_date?: string;
  po_number?: string;
  supplier_id?: number;
  component_id?: number;
  brand?: string;
  description?: string;
  quantity?: number;
  unit_cost?: number;
  currency?: Currency;
}

// Quote History
export interface QuoteHistory extends BaseEntity {
  history_id: number;
  quote_date?: string;
  quote_number?: string;
  supplier_id?: number;
  component_id?: number;
  brand?: string;
  description?: string;
  quantity?: number;
  unit_cost?: number;
  currency?: Currency;
}

// Aggregated data structures
export interface DatabaseData {
  companies: Company[];
  suppliers: Supplier[];
  components: Component[];
  quotes: PriceQuote[];
  quoteItems: PriceQuoteLineItem[];
  pis: ProformaInvoice[];
  pos: PurchaseOrder[];
  poItems: PurchaseLineItem[];
  payments: PaymentDetail[];
  landedCosts: LandedCost[];
  poHistory: PurchaseHistory[];
  quoteHistory: QuoteHistory[];
}

// Autocomplete suggestions structure
export interface Suggestions {
  brands: string[];
  locations: string[];
  paymentTerms: string[];
  incoterms: string[];
  modelSkus: string[];
  descriptions: string[];
  supplierNames: string[];
  poNumbers: string[];
  quoteNumbers: string[];
}

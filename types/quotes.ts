import type { SystemSpecs } from '../lib/projectSpec';

export interface ProjectQuote {
  quote_id: string;
  quote_number: string;
  quote_date: string;
  company_id?: string | null;   // issuing company (1.0_companies)
  customer_name: string;
  customer_address: string;
  project_description: string;
  // Structured classification — see lib/projectSpec.ts
  project_type?: string;              // on_grid | hybrid_bess | off_grid | custom
  system_specs?: SystemSpecs | null;  // kwp_dc, kw_ac, kw_pcs, kwh_bess
  location?: string;
  ppn_pct: number;
  status: 'draft' | 'sent' | 'accepted' | 'rejected';
  // Stamped by the log_quote_activity trigger when status transitions to
  // 'sent' (re-stamped on every draft→sent transition), never by the client
  sent_at?: string | null;
  notes: string;
  // Default GM% per top-level group (keys: solar_panels/bos/services);
  // applied to new line items, overridable per line
  group_margins?: Record<string, number> | null;
  // Audit stamps — filled by database trigger, never by the client
  created_by_email?: string;
  updated_by_email?: string;
  created_at?: string;
  updated_at?: string;
}

// Fixed top-level groups every quote is divided into.
// Sections are sub-sections that live inside one of these groups.
export type SectionGroup = 'solar_panels' | 'bos' | 'services';

export const SECTION_GROUPS: { key: SectionGroup; label: string }[] = [
  { key: 'solar_panels', label: 'Solar Panels' },
  { key: 'bos',          label: 'Balance of System (BoS)' },
  { key: 'services',     label: 'Services' },
];

// Canonical unit choices shared by the quote editor and the Description
// Library (free text stays allowed everywhere)
export const QUOTE_UNITS = ['pcs', 'set', 'meter', 'Wp', 'kWh', 'ls', 'modules', 'eng days', 'man days', 'Month', 'kg', 'roll'] as const;

// House-style sub-section titles per group: every new quote is seeded with
// these, and the section-title autocomplete suggests them. Free text is
// still allowed for the odd case, but staying on the list keeps quotes
// consistent and comparable.
export const STANDARD_SECTIONS: Record<SectionGroup, string[]> = {
  solar_panels: [
    'Solar panels',
  ],
  bos: [
    'Inverters',
    'Monitoring systems',
    'Array mounting kits',
    'DC cables, conduits and terminators',
    'AC cables, conduits and terminators',
    'AC switchgears and protection devices',
    'Battery Energy Storage Systems (BESS)',
    'Transformers',
  ],
  services: [
    'Design, engineering and test commissioning',
    'Installation',
    'Logistics and misc.',
  ],
};

export interface QuoteSection {
  section_id: string;
  quote_id: string;
  group_key: SectionGroup;
  title: string;
  lead_time: string;
  sort_order: number;
  created_at?: string;
}

export interface QuoteItem {
  item_id: string;
  section_id: string;
  quote_id: string;
  parent_item_id: string | null;
  component_id: string | null;
  description: string;
  brand: string;
  quantity: number | null;
  qty_formula?: string;   // internal: Excel-style formula behind quantity
  eng_note?: string;      // internal: engineering notes, never exported
  unit: string;
  cost_price: number | null;
  sell_price: number | null;
  sort_order: number;
  created_at?: string;
}

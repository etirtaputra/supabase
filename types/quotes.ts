export interface ProjectQuote {
  quote_id: string;
  quote_number: string;
  quote_date: string;
  customer_name: string;
  customer_address: string;
  project_description: string;
  ppn_pct: number;
  status: 'draft' | 'sent' | 'accepted' | 'rejected';
  notes: string;
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
  unit: string;
  cost_price: number | null;
  sell_price: number | null;
  sort_order: number;
  created_at?: string;
}

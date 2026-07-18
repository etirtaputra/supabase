export type UserRole = 'owner' | 'data_entry' | 'finance' | 'sales' | 'viewer';

export interface RolePermissions {
  // Tabs visible in the data entry app
  tabs: {
    catalog: boolean;
    quoting: boolean;
    ordering: boolean;
    financials: boolean;
    lookup: boolean;
    'market-intel': boolean;
  };
  // Feature-level gates
  canEdit: boolean;           // can save changes (false = read-only everywhere)
  canExportCsv: boolean;
  canViewSellingPrice: boolean;
  canViewBankFees: boolean;
  canViewCompetitorPrices: boolean;
  canManageUsers: boolean;    // owner-only: role management page
  canEditQuotes: boolean;     // project quotes / BOM builder (costs & margins visible)
  canManageCustomers: boolean; // CRM: create/edit customers + contacts, assign AM
  canEditSalesDocs: boolean;   // sell-side docs (product quotes, sales orders, DOs) — used by later modules
  canManagePricing: boolean;   // price tiers + item tier prices; sees margin vs landed cost (internal)
  canManageStock: boolean;     // inventory: receive / adjust stock movements
  canRecordReceipts: boolean;  // AR: record customer payments against sales invoices
}

export const ROLE_PERMISSIONS: Record<UserRole, RolePermissions> = {
  owner: {
    tabs: { catalog: true, quoting: true, ordering: true, financials: true, lookup: true, 'market-intel': true },
    canEdit: true,
    canExportCsv: true,
    canViewSellingPrice: true,
    canViewBankFees: true,
    canViewCompetitorPrices: true,
    canManageUsers: true,
    canEditQuotes: true,
    canManageCustomers: true,
    canEditSalesDocs: true,
    canManagePricing: true,
    canManageStock: true,
    canRecordReceipts: true,
  },
  data_entry: {
    tabs: { catalog: true, quoting: true, ordering: true, financials: false, lookup: true, 'market-intel': false },
    canEdit: true,
    canExportCsv: false,
    canViewSellingPrice: false,
    canViewBankFees: false,
    canViewCompetitorPrices: false,
    canManageUsers: false,
    canEditQuotes: true,
    canManageCustomers: false,
    canEditSalesDocs: false,
    canManagePricing: false,
    canManageStock: true,
    canRecordReceipts: false,
  },
  finance: {
    tabs: { catalog: false, quoting: false, ordering: false, financials: true, lookup: true, 'market-intel': false },
    canEdit: true,
    canExportCsv: true,
    canViewSellingPrice: false,
    canViewBankFees: true,
    canViewCompetitorPrices: false,
    canManageUsers: false,
    canEditQuotes: true,
    canManageCustomers: false,
    canEditSalesDocs: false,
    canManagePricing: false,
    canManageStock: false,
    canRecordReceipts: true,
  },
  // Sell-side rep. Owns the CRM + sell-side docs; no buy-side procurement,
  // payments, or user management. Sees selling prices (they quote them).
  sales: {
    tabs: { catalog: false, quoting: false, ordering: false, financials: false, lookup: true, 'market-intel': false },
    canEdit: false,
    canExportCsv: false,
    canViewSellingPrice: true,
    canViewBankFees: false,
    canViewCompetitorPrices: false,
    canManageUsers: false,
    canEditQuotes: false,
    canManageCustomers: true,
    canEditSalesDocs: true,
    canManagePricing: false,
    canManageStock: false,
    canRecordReceipts: false,
  },
  viewer: {
    tabs: { catalog: false, quoting: false, ordering: false, financials: false, lookup: true, 'market-intel': false },
    canEdit: false,
    canExportCsv: false,
    canViewSellingPrice: false,
    canViewBankFees: false,
    canViewCompetitorPrices: false,
    canManageUsers: false,
    canEditQuotes: false,
    canManageCustomers: false,
    canEditSalesDocs: false,
    canManagePricing: false,
    canManageStock: false,
    canRecordReceipts: false,
  },
};

export const ROLE_LABELS: Record<UserRole, string> = {
  owner:      'Owner',
  data_entry: 'Data Entry',
  finance:    'Finance',
  sales:      'Sales',
  viewer:     'Viewer',
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  owner:      'Full access to everything including user management',
  data_entry: 'Can enter catalog, quotes, and orders — no financial details',
  finance:    'Can manage payments and view deal lookup',
  sales:      'Manages customers & sell-side documents — no procurement or payments',
  viewer:     'Read-only access to deal lookup only',
};

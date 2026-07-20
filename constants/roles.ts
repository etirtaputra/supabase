// Role taxonomy. Pages gate on the capability booleans below (not role names),
// so adding/retuning a role is a matter of setting its flags here.
//   owner       — full access, main editor
//   buy_admin   — buy-side modules (Catalog, Insights), can edit; sees buy-side
//                 sensitive info (brand, bank fees, competitor prices, TUC)
//   sell_admin  — sell-side modules (Customers, Products, Sales, Invoices,
//                 Delivery), can edit incl. pricing tiers & receipts
//   sales       — sell-side operational (Customers, Products, Sales, Invoices);
//                 manages customers + sales docs, no back-end (pricing/stock/AR)
//   engineer    — Project Quotes + sell-side sales access
//   viewer      — read-only lookup
// data_entry / finance are LEGACY (superseded by buy_admin); kept so any
// un-migrated row still resolves. Not offered in the admin picker.
export type UserRole =
  | 'owner' | 'buy_admin' | 'sell_admin' | 'sales' | 'engineer' | 'viewer'
  | 'data_entry' | 'finance';

export interface RolePermissions {
  // Which of the two ERP flows + project quotes this role can navigate to
  buySide: boolean;   // Catalog, Insights
  sellSide: boolean;  // Customers, Products, Sales, Invoices, Delivery
  projects: boolean;  // Project Quotes
  // Tabs visible in the Catalog (buy-side) app
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
  canViewBrand: boolean;      // brand reveals the supplier relationship — buy-side sensitive
  canManageUsers: boolean;    // owner-only: role management page
  canEditQuotes: boolean;     // project quotes / BOM builder (costs & margins visible)
  canManageCustomers: boolean; // CRM: create/edit customers + contacts, assign AM
  canEditSalesDocs: boolean;   // sell-side docs (sales quotes → orders → DOs)
  canManagePricing: boolean;   // price tiers + item tier prices; sees margin vs landed cost (internal)
  canManageStock: boolean;     // inventory: receive / adjust stock movements
  canRecordReceipts: boolean;  // AR: record customer payments against sales invoices
}

export const ROLE_PERMISSIONS: Record<UserRole, RolePermissions> = {
  owner: {
    buySide: true, sellSide: true, projects: true,
    tabs: { catalog: true, quoting: true, ordering: true, financials: true, lookup: true, 'market-intel': true },
    canEdit: true, canExportCsv: true,
    canViewSellingPrice: true, canViewBankFees: true, canViewCompetitorPrices: true, canViewBrand: true,
    canManageUsers: true, canEditQuotes: true,
    canManageCustomers: true, canEditSalesDocs: true, canManagePricing: true, canManageStock: true, canRecordReceipts: true,
  },
  // Buy-side admin — procurement + catalog, can edit; sees buy-side cost signals.
  buy_admin: {
    buySide: true, sellSide: false, projects: false,
    tabs: { catalog: true, quoting: true, ordering: true, financials: true, lookup: true, 'market-intel': true },
    canEdit: true, canExportCsv: true,
    canViewSellingPrice: true, canViewBankFees: true, canViewCompetitorPrices: true, canViewBrand: true,
    canManageUsers: false, canEditQuotes: false,
    canManageCustomers: false, canEditSalesDocs: false, canManagePricing: false, canManageStock: true, canRecordReceipts: false,
  },
  // Sell-side admin — runs the whole sell-side incl. pricing tiers + receipts.
  sell_admin: {
    buySide: false, sellSide: true, projects: false,
    tabs: { catalog: false, quoting: false, ordering: false, financials: false, lookup: false, 'market-intel': false },
    canEdit: true, canExportCsv: true,
    canViewSellingPrice: true, canViewBankFees: false, canViewCompetitorPrices: false, canViewBrand: false,
    canManageUsers: false, canEditQuotes: false,
    canManageCustomers: true, canEditSalesDocs: true, canManagePricing: true, canManageStock: false, canRecordReceipts: true,
  },
  // Sell-side sales — customers + sales docs; no back-end (pricing/stock/AR).
  sales: {
    buySide: false, sellSide: true, projects: false,
    tabs: { catalog: false, quoting: false, ordering: false, financials: false, lookup: false, 'market-intel': false },
    canEdit: false, canExportCsv: false,
    canViewSellingPrice: true, canViewBankFees: false, canViewCompetitorPrices: false, canViewBrand: false,
    canManageUsers: false, canEditQuotes: false,
    canManageCustomers: true, canEditSalesDocs: true, canManagePricing: false, canManageStock: false, canRecordReceipts: false,
  },
  // Project engineer — Project Quotes + sell-side sales access.
  engineer: {
    buySide: false, sellSide: true, projects: true,
    tabs: { catalog: false, quoting: false, ordering: false, financials: false, lookup: false, 'market-intel': false },
    canEdit: false, canExportCsv: false,
    canViewSellingPrice: true, canViewBankFees: false, canViewCompetitorPrices: false, canViewBrand: false,
    canManageUsers: false, canEditQuotes: true,
    canManageCustomers: true, canEditSalesDocs: true, canManagePricing: false, canManageStock: false, canRecordReceipts: false,
  },
  viewer: {
    buySide: false, sellSide: false, projects: false,
    tabs: { catalog: false, quoting: false, ordering: false, financials: false, lookup: true, 'market-intel': false },
    canEdit: false, canExportCsv: false,
    canViewSellingPrice: false, canViewBankFees: false, canViewCompetitorPrices: false, canViewBrand: false,
    canManageUsers: false, canEditQuotes: false,
    canManageCustomers: false, canEditSalesDocs: false, canManagePricing: false, canManageStock: false, canRecordReceipts: false,
  },
  // ── Legacy (superseded by buy_admin); kept for backward-compatibility ──
  data_entry: {
    buySide: true, sellSide: false, projects: false,
    tabs: { catalog: true, quoting: true, ordering: true, financials: false, lookup: true, 'market-intel': false },
    canEdit: true, canExportCsv: false,
    canViewSellingPrice: false, canViewBankFees: false, canViewCompetitorPrices: false, canViewBrand: true,
    canManageUsers: false, canEditQuotes: true,
    canManageCustomers: false, canEditSalesDocs: false, canManagePricing: false, canManageStock: true, canRecordReceipts: false,
  },
  finance: {
    buySide: true, sellSide: false, projects: false,
    tabs: { catalog: false, quoting: false, ordering: false, financials: true, lookup: true, 'market-intel': false },
    canEdit: true, canExportCsv: true,
    canViewSellingPrice: false, canViewBankFees: true, canViewCompetitorPrices: false, canViewBrand: true,
    canManageUsers: false, canEditQuotes: true,
    canManageCustomers: false, canEditSalesDocs: false, canManagePricing: false, canManageStock: false, canRecordReceipts: true,
  },
};

// Roles offered in the admin user-management picker (legacy roles excluded).
export const ASSIGNABLE_ROLES: UserRole[] = ['owner', 'buy_admin', 'sell_admin', 'sales', 'engineer', 'viewer'];

export const ROLE_LABELS: Record<UserRole, string> = {
  owner:      'Owner',
  buy_admin:  'Buy-side Admin',
  sell_admin: 'Sell-side Admin',
  sales:      'Sell-side Sales',
  engineer:   'Project Engineer',
  viewer:     'Viewer',
  data_entry: 'Data Entry (legacy)',
  finance:    'Finance (legacy)',
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  owner:      'Full access to everything, including user management',
  buy_admin:  'Buy-side modules (Catalog, Insights) — can edit; sees costs & brands',
  sell_admin: 'Sell-side modules — can edit customers, pricing, stock, invoices & receipts',
  sales:      'Sell-side sales — customers, products, sales & invoices; no back-end editing',
  engineer:   'Project Quotes plus sell-side sales access',
  viewer:     'Read-only access to deal lookup',
  data_entry: 'Legacy buy-side editor — reassign to Buy-side Admin',
  finance:    'Legacy buy-side finance — reassign to Buy-side Admin',
};

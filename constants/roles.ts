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
  canViewEconomics: boolean;   // /profitability — item GP, landed costs, CCC. Owner only: the whole P&L in one screen.
  canViewAnalytics: boolean;   // the Analytics group — Spend & Cash, Items, Profitability. Owner only (decided 2026-07-30).
  canManageStock: boolean;     // inventory: receive / adjust stock movements
  canRecordReceipts: boolean;  // AR: record customer payments against sales invoices
  canViewBanks: boolean;       // bank accounts + their statements (cash position)
  canEditBanks: boolean;       // owner-only: create accounts, correct balances
}

export const ROLE_PERMISSIONS: Record<UserRole, RolePermissions> = {
  owner: {
    buySide: true, sellSide: true, projects: true,
    tabs: { catalog: true, quoting: true, ordering: true, financials: true, lookup: true, 'market-intel': true },
    canEdit: true, canExportCsv: true,
    canViewSellingPrice: true, canViewBankFees: true, canViewCompetitorPrices: true, canViewBrand: true,
    canManageUsers: true, canEditQuotes: true,
    canManageCustomers: true, canEditSalesDocs: true, canManagePricing: true, canManageStock: true, canRecordReceipts: true,
    canViewEconomics: true,
    canViewAnalytics: true,
    canViewBanks: true, canEditBanks: true,
  },
  // Buy-side admin — procurement + catalog, can edit; sees buy-side cost signals.
  buy_admin: {
    buySide: true, sellSide: false, projects: false,
    tabs: { catalog: true, quoting: true, ordering: true, financials: true, lookup: true, 'market-intel': true },
    canEdit: true, canExportCsv: true,
    canViewSellingPrice: true, canViewBankFees: true, canViewCompetitorPrices: true, canViewBrand: true,
    canManageUsers: false, canEditQuotes: false,
    canManageCustomers: false, canEditSalesDocs: false, canManagePricing: false, canManageStock: true, canRecordReceipts: false,
    canViewEconomics: false,
    canViewAnalytics: false,
    canViewBanks: true, canEditBanks: false,
  },
  // Sell-side admin — runs the whole sell-side incl. pricing tiers + receipts.
  sell_admin: {
    buySide: false, sellSide: true, projects: false,
    tabs: { catalog: false, quoting: false, ordering: false, financials: false, lookup: false, 'market-intel': false },
    canEdit: true, canExportCsv: true,
    canViewSellingPrice: true, canViewBankFees: false, canViewCompetitorPrices: false, canViewBrand: false,
    canManageUsers: false, canEditQuotes: false,
    canManageCustomers: true, canEditSalesDocs: true, canManagePricing: true, canManageStock: false, canRecordReceipts: true,
    canViewEconomics: false,
    canViewAnalytics: false,
    canViewBanks: true, canEditBanks: false,
  },
  // Sell-side sales — customers + sales docs; no back-end (pricing/stock/AR).
  sales: {
    buySide: false, sellSide: true, projects: false,
    tabs: { catalog: false, quoting: false, ordering: false, financials: false, lookup: false, 'market-intel': false },
    canEdit: false, canExportCsv: false,
    canViewSellingPrice: true, canViewBankFees: false, canViewCompetitorPrices: false, canViewBrand: false,
    canManageUsers: false, canEditQuotes: false,
    canManageCustomers: true, canEditSalesDocs: true, canManagePricing: false, canManageStock: false, canRecordReceipts: false,
    canViewEconomics: false,
    canViewAnalytics: false,
    canViewBanks: false, canEditBanks: false,
  },
  // Project engineer — Project Quotes + sell-side sales access.
  engineer: {
    buySide: false, sellSide: true, projects: true,
    tabs: { catalog: false, quoting: false, ordering: false, financials: false, lookup: false, 'market-intel': false },
    canEdit: false, canExportCsv: false,
    canViewSellingPrice: true, canViewBankFees: false, canViewCompetitorPrices: false, canViewBrand: false,
    canManageUsers: false, canEditQuotes: true,
    canManageCustomers: true, canEditSalesDocs: true, canManagePricing: false, canManageStock: false, canRecordReceipts: false,
    canViewEconomics: false,
    canViewAnalytics: false,
    canViewBanks: false, canEditBanks: false,
  },
  viewer: {
    buySide: false, sellSide: false, projects: false,
    tabs: { catalog: false, quoting: false, ordering: false, financials: false, lookup: true, 'market-intel': false },
    canEdit: false, canExportCsv: false,
    canViewSellingPrice: false, canViewBankFees: false, canViewCompetitorPrices: false, canViewBrand: false,
    canManageUsers: false, canEditQuotes: false,
    canManageCustomers: false, canEditSalesDocs: false, canManagePricing: false, canManageStock: false, canRecordReceipts: false,
    canViewEconomics: false,
    canViewAnalytics: false,
    canViewBanks: false, canEditBanks: false,
  },
  // ── Legacy (superseded by buy_admin); kept for backward-compatibility ──
  data_entry: {
    buySide: true, sellSide: false, projects: false,
    tabs: { catalog: true, quoting: true, ordering: true, financials: false, lookup: true, 'market-intel': false },
    canEdit: true, canExportCsv: false,
    canViewSellingPrice: false, canViewBankFees: false, canViewCompetitorPrices: false, canViewBrand: true,
    canManageUsers: false, canEditQuotes: true,
    canManageCustomers: false, canEditSalesDocs: false, canManagePricing: false, canManageStock: true, canRecordReceipts: false,
    canViewEconomics: false,
    canViewAnalytics: false,
    canViewBanks: false, canEditBanks: false,
  },
  finance: {
    buySide: true, sellSide: false, projects: false,
    tabs: { catalog: false, quoting: false, ordering: false, financials: true, lookup: true, 'market-intel': false },
    canEdit: true, canExportCsv: true,
    canViewSellingPrice: false, canViewBankFees: true, canViewCompetitorPrices: false, canViewBrand: true,
    canManageUsers: false, canEditQuotes: true,
    canManageCustomers: false, canEditSalesDocs: false, canManagePricing: false, canManageStock: false, canRecordReceipts: true,
    canViewEconomics: false,
    canViewAnalytics: false,
    canViewBanks: true, canEditBanks: false,
  },
};

// Roles offered in the admin user-management picker (legacy roles excluded).
/**
 * Human-readable map of every capability, grouped for display.
 *
 * Settings › Users renders ROLE_PERMISSIONS through this list, so the matrix
 * people read is DERIVED from the flags the code enforces — it cannot drift
 * into flattery. A capability missing here simply doesn't render; add its row
 * when you add the flag.
 */
export type PermissionKey = Exclude<keyof RolePermissions, 'tabs'>;
export const PERMISSION_MATRIX: { group: string; rows: { key: PermissionKey; label: string }[] }[] = [
  { group: 'Modules', rows: [
    { key: 'buySide',          label: 'Buy side — Catalog, Suppliers, Stock, Insights' },
    { key: 'sellSide',         label: 'Sell side — Customers, Products, Sales, Invoices, Delivery, After Sales' },
    { key: 'projects',         label: 'EPC Proposals' },
    { key: 'canViewBanks',     label: 'Banks — accounts & statements' },
    { key: 'canViewAnalytics', label: 'Analytics — Spend & Cash, Items, Profitability' },
    { key: 'canViewEconomics', label: 'Economics — item GP, landed cost, cash cycle' },
  ]},
  { group: 'Can edit', rows: [
    { key: 'canEdit',            label: 'Save changes at all (off = read-only)' },
    { key: 'canManageCustomers', label: 'Customers & contacts' },
    { key: 'canEditSalesDocs',   label: 'Sales documents — quote → order → delivery → invoice' },
    { key: 'canRecordReceipts',  label: 'Record customer payments (AR)' },
    { key: 'canManageStock',     label: 'Receive & adjust stock' },
    { key: 'canEditQuotes',      label: 'EPC proposal editor (sees costs & margins)' },
    { key: 'canEditBanks',       label: 'Bank accounts & balance corrections' },
  ]},
  { group: 'Sensitive data', rows: [
    { key: 'canViewSellingPrice',    label: 'Selling prices' },
    { key: 'canViewBrand',           label: 'Brands & supplier identity' },
    { key: 'canViewBankFees',        label: 'Bank fees & payment details' },
    { key: 'canViewCompetitorPrices', label: 'Competitor prices' },
  ]},
  { group: 'Administration', rows: [
    { key: 'canManagePricing', label: 'Price tiers, floors & overrides' },
    { key: 'canExportCsv',     label: 'Export CSV' },
    { key: 'canManageUsers',   label: 'Users, roles & settings' },
  ]},
];

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

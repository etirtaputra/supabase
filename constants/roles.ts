export type UserRole = 'owner' | 'data_entry' | 'finance' | 'viewer';

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
  },
  data_entry: {
    tabs: { catalog: true, quoting: true, ordering: true, financials: false, lookup: true, 'market-intel': false },
    canEdit: true,
    canExportCsv: false,
    canViewSellingPrice: false,
    canViewBankFees: false,
    canViewCompetitorPrices: false,
    canManageUsers: false,
  },
  finance: {
    tabs: { catalog: false, quoting: false, ordering: false, financials: true, lookup: true, 'market-intel': false },
    canEdit: true,
    canExportCsv: true,
    canViewSellingPrice: false,
    canViewBankFees: true,
    canViewCompetitorPrices: false,
    canManageUsers: false,
  },
  viewer: {
    tabs: { catalog: false, quoting: false, ordering: false, financials: false, lookup: true, 'market-intel': false },
    canEdit: false,
    canExportCsv: false,
    canViewSellingPrice: false,
    canViewBankFees: false,
    canViewCompetitorPrices: false,
    canManageUsers: false,
  },
};

export const ROLE_LABELS: Record<UserRole, string> = {
  owner:      'Owner',
  data_entry: 'Data Entry',
  finance:    'Finance',
  viewer:     'Viewer',
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  owner:      'Full access to everything including user management',
  data_entry: 'Can enter catalog, quotes, and orders — no financial details',
  finance:    'Can manage payments and view deal lookup',
  viewer:     'Read-only access to deal lookup only',
};

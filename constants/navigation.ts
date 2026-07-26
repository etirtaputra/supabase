import type { RolePermissions } from './roles';

/**
 * Every place in ICAPROC you can navigate to — the single list behind BOTH the
 * menu and Spotlight's "Pages" results.
 *
 * Keeping one list is the point: a module that exists in the nav but not in
 * search (or the reverse) is how an ERP grows corners nobody can find. Deep
 * destinations that are NOT menu entries (a Settings tab, a Catalog tab, the
 * receive flow) carry `inNav: false` — they are reachable by search and by the
 * screen that owns them, without bloating the menu.
 *
 * Gating mirrors the nav exactly: `section` is the flow the role must have,
 * `cap` an extra capability. Anything a role can't open is not indexed for it,
 * so search never advertises a locked door.
 */

export type NavSection = 'buySide' | 'sellSide' | 'projects' | null;

export interface Destination {
  href: string;
  label: string;                    // what the menu/search shows
  group: string;                    // section header ("Buy side", "Admin"…)
  section: NavSection;              // flow gate
  cap?: keyof RolePermissions;      // extra capability gate
  /** What this screen is for — Spotlight's sub-line. */
  hint?: string;
  /** Synonyms people actually type. Searched, never displayed. */
  keywords?: string;
  /** In the menu, or search-only (deep links, tabs). */
  inNav?: boolean;
}

export const DESTINATIONS: Destination[] = [
  { href: '/', label: 'Dashboard', group: 'Home', section: null, inNav: true,
    hint: 'Today at a glance — outstanding, paid this month, stock value',
    keywords: 'home start overview kpi' },

  // ── Buy side ──────────────────────────────────────────────────────────────
  { href: '/catalog', label: 'Catalog', group: 'Buy side', section: 'buySide', inNav: true,
    hint: 'Components, supplier quotes, purchase orders, payments',
    keywords: 'components parts items procurement buying' },
  { href: '/catalog?tab=lookup', label: 'Deal Lookup', group: 'Buy side', section: 'buySide', inNav: false,
    hint: 'Every PI → PO → payment as one deal',
    keywords: 'deals pi po payments history search' },
  { href: '/catalog?tab=quoting', label: 'Catalog · Supplier Quotes', group: 'Buy side', section: 'buySide', inNav: false,
    hint: 'Record a supplier quote / proforma invoice',
    keywords: 'pi proforma quote entry new' },
  { href: '/catalog?tab=ordering', label: 'Catalog · Purchase Orders', group: 'Buy side', section: 'buySide', inNav: false,
    hint: 'Raise a PO against a supplier quote',
    keywords: 'po purchase order new raise' },
  { href: '/catalog?tab=financials', label: 'Catalog · Payments', group: 'Buy side', section: 'buySide', cap: 'canViewBankFees', inNav: false,
    hint: 'Record supplier payments, bank fees and landed costs',
    keywords: 'payment batch remittance costs fees' },
  { href: '/suppliers', label: 'Suppliers', group: 'Buy side', section: 'buySide', inNav: true,
    hint: 'Vendor profiles, purchase volume, outstanding payables',
    keywords: 'vendors payables' },
  { href: '/stock', label: 'Stock', group: 'Buy side', section: 'buySide', inNav: true,
    hint: 'On-hand per warehouse, moving-average cost, shortages',
    keywords: 'inventory warehouse gudang on hand balance' },
  { href: '/stock/receive', label: 'Stock · Receive against PO', group: 'Buy side', section: 'buySide', cap: 'canManageStock', inNav: false,
    hint: 'Book goods in against a purchase order (GRN)',
    keywords: 'grn goods receipt receiving inbound' },
  { href: '/insights', label: 'Insights', group: 'Buy side', section: 'buySide', inNav: true,
    hint: 'Spend analytics, cash cycle, exchange rates',
    keywords: 'analytics reports spend forex fx' },

  // ── Sell side ─────────────────────────────────────────────────────────────
  { href: '/customers', label: 'Customers', group: 'Sell side', section: 'sellSide', inNav: true,
    hint: 'CRM — customers, contacts, account managers',
    keywords: 'crm clients contacts buyers' },
  { href: '/products', label: 'Products', group: 'Sell side', section: 'sellSide', inNav: true,
    hint: 'What we sell, with tier prices and live stock',
    keywords: 'catalogue selling price tier' },
  { href: '/sales', label: 'Sales', group: 'Sell side', section: 'sellSide', inNav: true,
    hint: 'Quotations → orders → invoices → delivery',
    keywords: 'quotation sq so order penawaran' },
  { href: '/sales/new', label: 'Sales · New Quotation', group: 'Sell side', section: 'sellSide', cap: 'canEditSalesDocs', inNav: false,
    hint: 'Start a new sales quotation',
    keywords: 'new quote create sq penawaran baru' },
  { href: '/sales/library', label: 'Sales · Description Library', group: 'Sell side', section: 'sellSide', cap: 'canEditSalesDocs', inNav: false,
    hint: 'Curated line texts that feed the item picker',
    keywords: 'library descriptions text' },
  { href: '/invoices', label: 'Invoices', group: 'Sell side', section: 'sellSide', inNav: true,
    hint: 'Accounts receivable — issued, received, outstanding',
    keywords: 'ar receivable billing tagihan' },
  { href: '/delivery', label: 'Delivery', group: 'Sell side', section: 'sellSide', inNav: true,
    hint: 'Delivery orders and Surat Jalan',
    keywords: 'do surat jalan shipping dispatch' },
  { href: '/economics', label: 'Economics', group: 'Sell side', section: 'sellSide', cap: 'canManagePricing', inNav: true,
    hint: 'GP per item / customer / rep, stock aging, cash cycle',
    keywords: 'margin profit ccc dio dso dpo turnover' },

  // ── Cash ──────────────────────────────────────────────────────────────────
  { href: '/banks', label: 'Banks', group: 'Cash', section: null, cap: 'canViewBanks', inNav: true,
    hint: 'Bank accounts, statements and cash position',
    keywords: 'bank account cash balance statement rekening' },

  // ── Projects ──────────────────────────────────────────────────────────────
  { href: '/proposals', label: 'Proposals', group: 'Projects', section: 'projects', inNav: true,
    hint: 'EPC project proposals',
    keywords: 'epc project quote solar pv' },
  { href: '/proposals/library', label: 'Proposals · Description Library', group: 'Projects', section: 'projects', cap: 'canEditQuotes', inNav: false,
    hint: 'Curated proposal line texts and default costs',
    keywords: 'library descriptions' },
  { href: '/proposals/directory', label: 'Proposals · Directory', group: 'Projects', section: 'projects', cap: 'canManageUsers', inNav: false,
    hint: 'Merge duplicate customers, sites, addresses and brands',
    keywords: 'merge duplicates cleanup directory' },

  // ── Admin / configuration ────────────────────────────────────────────────
  { href: '/pricing', label: 'Pricing', group: 'Admin', section: null, cap: 'canManagePricing', inNav: true,
    hint: 'Price tiers, margin floor audit, per-item overrides',
    keywords: 'tiers markup discount floor margin' },
  { href: '/settings', label: 'Settings', group: 'Admin', section: null, cap: 'canManageUsers', inNav: true,
    hint: 'Formatting, defaults, company, banks and users',
    keywords: 'preferences configuration admin setup' },
  { href: '/settings?tab=format', label: 'Settings · Formatting', group: 'Admin', section: null, cap: 'canManageUsers', inNav: false,
    hint: 'Number, currency and date formats; list layout',
    keywords: 'number currency date format layout compact card separator' },
  { href: '/settings?tab=pricing', label: 'Settings · Pricing', group: 'Admin', section: null, cap: 'canManageUsers', inNav: false,
    hint: 'Rounding step, default markup, margin floor, customer tier',
    keywords: 'rounding markup tier floor default' },
  { href: '/settings?tab=defaults', label: 'Settings · Defaults', group: 'Admin', section: null, cap: 'canManageUsers', inNav: false,
    hint: 'PPN, payment terms, warehouse, thresholds',
    keywords: 'ppn vat tax terms warehouse slow mover drift' },
  { href: '/settings?tab=company', label: 'Settings · Company', group: 'Admin', section: null, cap: 'canManageUsers', inNav: false,
    hint: 'Letterhead, bank details and document footer',
    keywords: 'letterhead address npwp footer' },
  { href: '/settings?tab=banks', label: 'Settings · Banks', group: 'Admin', section: null, cap: 'canManageUsers', inNav: false,
    hint: 'Bank accounts per company, defaults and the bank library',
    keywords: 'bank account rekening default library' },
  { href: '/settings?tab=users', label: 'Settings · Users', group: 'Admin', section: null, cap: 'canManageUsers', inNav: false,
    hint: 'Roles and the sign-up allowlist',
    keywords: 'users roles permissions access allowlist invite' },
];

/** The destinations this role can actually open. */
export const destinationsFor = (perms: RolePermissions | null): Destination[] =>
  DESTINATIONS.filter((d) => {
    if (!perms) return true;                       // profile still loading
    if (d.section && !perms[d.section]) return false;
    if (d.cap && !perms[d.cap]) return false;
    return true;
  });

/** Menu order — groups in the order they first appear above. */
export const NAV_GROUP_ORDER = ['Home', 'Buy side', 'Sell side', 'Cash', 'Projects'] as const;

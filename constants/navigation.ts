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

/**
 * `trading` = either trading flow (buySide OR sellSide) — used by the Item
 * hub, which is the pivot BETWEEN the two flows and must be reachable from
 * both sides. It is not a capability of its own: it derives from the two
 * flow booleans, so the role matrix stays the single authority.
 */
export type NavSection = 'buySide' | 'sellSide' | 'projects' | 'trading' | null;

/** Does this role pass a section gate? (null = open to everyone signed in) */
export const sectionAllowed = (perms: RolePermissions | null, s: NavSection): boolean =>
  !s || !perms || (s === 'trading' ? (perms.buySide || perms.sellSide) : perms[s]);

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
  // Search-only: the header clock links here, so the menu stays lean.
  { href: '/changelog', label: "What's New", group: 'Home', section: null, inNav: false,
    hint: 'The update log — what changed, and when',
    keywords: 'changelog updates news release log history version' },

  // ── Buy ───────────────────────────────────────────────────────────────────
  // `/purchasing` is labelled PURCHASING: the screen is the procure-to-pay
  // workspace (supplier quotes → POs → payments), not an item list. Products
  // is the item list people mean when they say "catalog", so the old name is
  // kept as a search keyword rather than as a label competing with it.
  { href: '/purchasing', label: 'Purchasing', group: 'Buy', section: 'buySide', inNav: true,
    hint: 'Supplier quotes, purchase orders and the component master',
    keywords: 'catalog components parts items procurement buying pi po' },
  { href: '/purchasing?tab=lookup', label: 'Deal Lookup', group: 'Buy', section: 'buySide', inNav: false,
    hint: 'Every PI → PO → payment as one deal',
    keywords: 'deals pi po payments history search catalog' },
  { href: '/purchasing?tab=quoting', label: 'Supplier Quotes', group: 'Buy', section: 'buySide', inNav: false,
    hint: 'Record a supplier quote / proforma invoice',
    keywords: 'pi proforma quote entry new catalog' },
  { href: '/purchasing?tab=ordering', label: 'Purchase Orders', group: 'Buy', section: 'buySide', inNav: false,
    hint: 'Raise a PO against a supplier quote',
    keywords: 'po purchase order new raise catalog' },
  { href: '/suppliers', label: 'Suppliers', group: 'Buy', section: 'buySide', inNav: true,
    hint: 'Vendor profiles, purchase volume, outstanding payables',
    keywords: 'vendors payables' },
  { href: '/stock', label: 'Stock', group: 'Buy', section: 'buySide', inNav: true,
    hint: 'On-hand per warehouse, moving-average cost, shortages',
    keywords: 'inventory warehouse gudang on hand balance' },
  // Promoted out of hiding: booking goods in is a daily warehouse job and the
  // moment landed cost enters the system — it should not be search-only.
  { href: '/stock/receive', label: 'Receive Goods', group: 'Buy', section: 'buySide', cap: 'canManageStock', inNav: true,
    hint: 'Book goods in against a purchase order (GRN)',
    keywords: 'grn goods receipt receiving inbound terima barang' },

  // ── Sell ──────────────────────────────────────────────────────────────────
  { href: '/customers', label: 'Customers', group: 'Sell', section: 'sellSide', inNav: true,
    hint: 'CRM — customers, contacts, account managers',
    keywords: 'crm clients contacts buyers' },
  { href: '/products', label: 'Products', group: 'Sell', section: 'sellSide', inNav: true,
    hint: 'What we sell, with tier prices and live stock',
    keywords: 'catalogue catalog items selling price tier' },
  { href: '/sales', label: 'Sales', group: 'Sell', section: 'sellSide', inNav: true,
    hint: 'Quotations → orders → invoices → delivery',
    keywords: 'quotation sq so order penawaran' },
  { href: '/sales/new', label: 'New Quotation', group: 'Sell', section: 'sellSide', cap: 'canEditSalesDocs', inNav: false,
    hint: 'Start a new sales quotation',
    keywords: 'new quote create sq penawaran baru sales' },
  { href: '/sales/library', label: 'Sales · Description Library', group: 'Sell', section: 'sellSide', cap: 'canEditSalesDocs', inNav: false,
    hint: 'Curated line texts that feed the item picker',
    keywords: 'library descriptions text' },
  { href: '/invoices', label: 'Invoices', group: 'Sell', section: 'sellSide', inNav: true,
    hint: 'Accounts receivable — issued, received, outstanding',
    keywords: 'ar receivable billing tagihan' },
  { href: '/delivery', label: 'Delivery', group: 'Sell', section: 'sellSide', inNav: true,
    hint: 'Delivery orders and Surat Jalan',
    keywords: 'do surat jalan shipping dispatch' },
  { href: '/aftersales', label: 'After Sales', group: 'Sell', section: 'sellSide', inNav: true,
    hint: 'Service & warranty cases — repairs, replacements, complaints',
    keywords: 'service warranty klaim garansi rma repair replacement complaint case claim' },

  // ── Finance ───────────────────────────────────────────────────────────────
  // Cash work used to be scattered: AR under Sell, AP buried in a Purchasing
  // tab, banks in a group of one. Payables moves here — the money side of a
  // PO is a treasury job, not a procurement one. (Renamed Money → Finance
  // 2026-07-30, owner's wording.)
  { href: '/banks', label: 'Banks', group: 'Finance', section: null, cap: 'canViewBanks', inNav: true,
    hint: 'Bank accounts, statements and cash position',
    keywords: 'bank account cash balance statement rekening money' },
  { href: '/purchasing?tab=financials', label: 'Supplier Payments', group: 'Finance', section: 'buySide', cap: 'canViewBankFees', inNav: true,
    hint: 'Record supplier payments, bank fees and landed costs',
    keywords: 'payment batch remittance costs fees ap payable catalog financials money' },

  // ── Analytics — OWNER ONLY (canViewAnalytics, decided 2026-07-30) ─────────
  // Two analytics screens plus the Item hub. The names say which question
  // each answers: what did we SPEND, what does an ITEM look like end-to-end,
  // and what did we EARN.
  { href: '/spend-cash', label: 'Spend & Cash', group: 'Analytics', section: 'buySide', cap: 'canViewAnalytics', inNav: true,
    hint: 'Spend analytics, cash cycle, exchange rates',
    keywords: 'insights analytics reports spend forex fx tuc cash cycle' },
  // The Item hub (Module 29): one page per stock item, assembled from the
  // screens that own each number. Filed under Analytics per the owner.
  { href: '/items', label: 'Items', group: 'Analytics', section: 'trading', cap: 'canViewAnalytics', inNav: true,
    hint: 'Everything about one item — buy, sell, stock, specs, profit',
    keywords: 'item hub component sku part product barang produk master 360' },
  { href: '/profitability', label: 'Profitability', group: 'Analytics', section: 'sellSide', cap: 'canViewEconomics', inNav: true,
    hint: 'GP per item / customer / rep, stock aging, position, cash cycle',
    keywords: 'economics margin profit gp ccc dio dso dpo turnover position' },

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
  // Pricing lives here per the owner (2026-07-30): tiers, floors and
  // overrides are configuration in this house, not a daily sell-side tool.
  { href: '/pricing', label: 'Pricing', group: 'Admin', section: null, cap: 'canManagePricing', inNav: true,
    hint: 'Price tiers, margin floor audit, per-item overrides',
    keywords: 'tiers markup discount floor margin' },
  { href: '/settings', label: 'Settings', group: 'Admin', section: null, cap: 'canManageUsers', inNav: true,
    hint: 'Formatting, defaults, company, banks and users',
    keywords: 'preferences configuration admin setup' },
  { href: '/settings?tab=format', label: 'Settings · Formatting', group: 'Admin', section: null, cap: 'canManageUsers', inNav: false,
    hint: 'Number, currency and date formats; list layout',
    keywords: 'number currency date format layout compact card separator' },
  { href: '/settings?tab=appearance', label: 'Settings · Appearance', group: 'Admin', section: null, cap: 'canManageUsers', inNav: false,
    hint: 'The default skin — dark, dim, light or paper',
    keywords: 'theme skin colour color dark light dim paper mode default appearance' },
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
  { href: '/import-export', label: 'Import & Export', group: 'Admin', section: null, cap: 'canExportCsv', inNav: true,
    hint: 'Bulk CSV in and out — customers, orders, invoices, receipts',
    keywords: 'data import export csv migration dolibarr bulk upload download backup transfer migrate' },
];

/** The destinations this role can actually open. */
export const destinationsFor = (perms: RolePermissions | null): Destination[] =>
  DESTINATIONS.filter((d) => {
    if (!perms) return true;                       // profile still loading
    if (!sectionAllowed(perms, d.section)) return false;
    if (d.cap && !perms[d.cap]) return false;
    return true;
  });

/**
 * Menu order. The two trading flows lead (that is the business), then the
 * money they move, then what it earned, then the separate EPC product line.
 * Admin is appended by the menu itself, below the daily modules.
 */
export const NAV_GROUP_ORDER = ['Home', 'Buy', 'Sell', 'Finance', 'Analytics', 'Projects'] as const;

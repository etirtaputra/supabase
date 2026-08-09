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

  // ── Purchasing (owner's naming, 2026-08-07) ──────────────────────────────
  // The group is PURCHASING, not "Buy", and its five workspaces are listed
  // one by one rather than hidden behind a single entry: the tabs are where
  // the work actually happens, so the menu names them.
  { href: '/purchasing?tab=catalog', label: 'Item Editor', group: 'Catalog', section: 'buySide', inNav: true,
    hint: 'The component master — models, prices, specs, links',
    keywords: 'catalog components parts items master editor sku spec' },
  // Supplier Quotes + Purchase Orders merged into ONE entry form (2026-08-04):
  // record a PI, or PI + PO in one save, or raise the PO for a stored quote.
  // Old names stay as keywords so Spotlight muscle memory keeps working.
  { href: '/purchasing?tab=quoting', label: 'New Deal', group: 'Purchasing', section: 'buySide', inNav: true,
    hint: 'Record a supplier quote / PI — alone or straight to its PO',
    keywords: 'pi proforma quote entry new catalog supplier quotes po purchase order raise deal' },
  { href: '/purchasing?tab=financials', label: 'Payments', group: 'Purchasing', section: 'buySide', cap: 'canViewBankFees', inNav: true,
    hint: 'Record supplier payments, bank fees and landed costs',
    keywords: 'payment batch remittance costs fees ap payable financials money supplier' },
  { href: '/purchasing?tab=lookup', label: 'Deal Lookup', group: 'Purchasing', section: 'buySide', inNav: true,
    hint: 'Every PI → PO → payment as one deal',
    keywords: 'deals pi po payments history search catalog' },
  { href: '/purchasing?tab=market-intel', label: 'Market Intel', group: 'Catalog', section: 'buySide', inNav: true,
    hint: 'Competitor prices and what the market is charging',
    keywords: 'competitor market price intel benchmark rival' },
  { href: '/suppliers', label: 'Suppliers', group: 'Purchasing', section: 'buySide', inNav: true,
    hint: 'Vendor profiles, purchase volume, outstanding payables',
    keywords: 'vendors payables' },
  { href: '/stock', label: 'Stock', group: 'Purchasing', section: 'buySide', inNav: true,
    hint: 'On-hand per warehouse, moving-average cost, shortages',
    keywords: 'inventory warehouse gudang on hand balance' },
  // Promoted out of hiding: booking goods in is a daily warehouse job and the
  // moment landed cost enters the system — it should not be search-only.
  { href: '/stock/receive', label: 'Receive Goods', group: 'Purchasing', section: 'buySide', cap: 'canManageStock', inNav: true,
    hint: 'Book goods in against a purchase order (GRN)',
    keywords: 'grn goods receipt receiving inbound terima barang' },
  // The bare /purchasing URL still resolves (it opens the Item Editor tab) —
  // search-only so the menu is not saying the same thing twice.
  { href: '/purchasing', label: 'Purchasing', group: 'Purchasing', section: 'buySide', inNav: false,
    hint: 'The procure-to-pay workspace',
    keywords: 'procurement buying purchase' },

  // ── Sales (owner's wording 2026-08-07; the section gate stays `sellSide`) ──
  { href: '/customers', label: 'Customers', group: 'Sales', section: 'sellSide', inNav: true,
    hint: 'CRM — customers, contacts, account managers',
    keywords: 'crm clients contacts buyers' },
  { href: '/products', label: 'Products', group: 'Catalog', section: 'sellSide', inNav: true,
    hint: 'What we sell, with tier prices and live stock',
    keywords: 'catalogue catalog items selling price tier' },
  { href: '/sales', label: 'Sales Orders', group: 'Sales', section: 'sellSide', inNav: true,
    hint: 'Quotations → orders → invoices → delivery (DQ → PQ → SO)',
    keywords: 'sales quotation dq pq sq so price quote order penawaran' },
  { href: '/sales/new', label: 'New Quotation', group: 'Sales', section: 'sellSide', cap: 'canEditSalesDocs', inNav: false,
    hint: 'Start a new sales quotation',
    keywords: 'new quote create sq penawaran baru sales' },
  { href: '/sales/library', label: 'Sales · Description Library', group: 'Sales', section: 'sellSide', cap: 'canEditSalesDocs', inNav: false,
    hint: 'Curated line texts that feed the item picker',
    keywords: 'library descriptions text' },
  { href: '/invoices', label: 'Invoices', group: 'Sales', section: 'sellSide', inNav: true,
    hint: 'Accounts receivable — issued, received, outstanding',
    keywords: 'ar receivable billing tagihan' },
  { href: '/delivery', label: 'Delivery', group: 'Sales', section: 'sellSide', inNav: true,
    hint: 'Delivery orders and Surat Jalan',
    keywords: 'do surat jalan shipping dispatch' },
  { href: '/aftersales', label: 'After Sales', group: 'Sales', section: 'sellSide', inNav: true,
    hint: 'Service & warranty cases — repairs, replacements, complaints',
    keywords: 'service warranty klaim garansi rma repair replacement complaint case claim' },
  { href: '/support-letters', label: 'Support Letters', group: 'Sales', section: 'sellSide', inNav: true,
    hint: 'Surat Dukungan — our backing for a reseller entering a tender',
    keywords: 'surat dukungan support letter principal distributor tender lelang project dukungan sd reseller' },

  // ── Finance ───────────────────────────────────────────────────────────────
  // Cash work used to be scattered: AR under Sell, AP buried in a Purchasing
  // tab, banks in a group of one. Payables moves here — the money side of a
  // PO is a treasury job, not a procurement one. (Renamed Money → Finance
  // 2026-07-30, owner's wording.)
  // The group holds one entry, so it names itself "Finance" rather than
  // "Finance Banks" (owner, 2026-08-07). "banks" stays a keyword so Spotlight
  // muscle memory still lands here.
  { href: '/banks', label: 'Finance', group: 'Finance', section: null, cap: 'canViewBanks', inNav: true,
    hint: 'Bank accounts, statements and cash position',
    keywords: 'bank banks account cash balance statement rekening money finance treasury' },

  // ── Analytics — OWNER ONLY (canViewAnalytics, decided 2026-07-30) ─────────
  // Two analytics screens plus the Item hub. The names say which question
  // each answers: what did we SPEND, what does an ITEM look like end-to-end,
  // and what did we EARN.
  { href: '/spend-cash', label: 'Spend & Cash', group: 'Insights', section: 'buySide', cap: 'canViewAnalytics', inNav: true,
    hint: 'Spend analytics, cash cycle, exchange rates, pricing intelligence',
    keywords: 'insights analytics reports spend forex fx tuc cash cycle pricing' },
  { href: '/profitability', label: 'Profitability', group: 'Insights', section: 'sellSide', cap: 'canViewEconomics', inNav: true,
    hint: 'GP per item / customer / rep, capital allocation, cash cycle',
    keywords: 'economics margin profit gp ccc dio dso dpo turnover position capital allocation gmroi' },
  // The Item hub (Module 29): one page per stock item — the item is the pivot,
  // so it lives with the Catalog, not buried in the reports.
  { href: '/items', label: 'Item Hub', group: 'Catalog', section: 'trading', cap: 'canViewAnalytics', inNav: true,
    hint: 'Everything about one item — buy, sell, stock, specs, profit, score',
    keywords: 'item hub component sku part product barang produk master 360 items' },
  { href: '/items/specs', label: 'Spec Readiness', group: 'Catalog', section: 'trading', cap: 'canViewAnalytics', inNav: false,
    hint: 'What the system calculators can size from — fill the missing specs',
    keywords: 'specs specifications calculator ready designer sizing missing data quality bom' },

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
  // Pricing joins the Catalog (2026-08-07): tiers, floors and overrides are
  // about the ITEMS we sell, so they sit with the item master and the market
  // intel rather than off in Admin.
  { href: '/pricing', label: 'Pricing', group: 'Catalog', section: null, cap: 'canManagePricing', inNav: true,
    hint: 'Price tiers, margin floor audit, per-item overrides',
    keywords: 'tiers markup discount floor margin pricing' },
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
export const NAV_GROUP_ORDER = ['Home', 'Purchasing', 'Sales', 'Catalog', 'Finance', 'Insights', 'Projects'] as const;

/**
 * The groups the owner may reorder (Settings › Menu). Home is pinned first —
 * it IS the wordmark's Dashboard — and Admin is pinned last (configuration,
 * not a daily module), so neither is in play. The default order is the one
 * above, minus those two fixed ends.
 */
export const MENU_ORDERABLE_GROUPS = ['Purchasing', 'Sales', 'Catalog', 'Finance', 'Insights', 'Projects'] as const;
export const DEFAULT_MENU_ORDER: string[] = [...MENU_ORDERABLE_GROUPS];

/**
 * Old group names a saved preference might still carry, mapped to today's.
 * Keeps a renamed group in the owner's chosen position instead of dropping it
 * to the end. (Sell → Sales; Analytics → Insights, 2026-08-07.)
 */
const GROUP_ALIASES: Record<string, string> = { Sell: 'Sales', Analytics: 'Insights' };

/**
 * The daily group order to actually render, given the owner's stored
 * preference. Robust by construction: a stored name that is no longer a group
 * is dropped, and a real group the stored list never mentions (a module added
 * after the preference was saved) is appended, so nothing the code ships can
 * silently vanish from the menu. Home always leads; Admin is appended by the
 * menu itself, so it is not part of this list.
 */
export function orderedNavGroups(stored: string[] | null | undefined): string[] {
  const orderable = new Set<string>(MENU_ORDERABLE_GROUPS);
  const seen = new Set<string>();
  const ranked: string[] = [];
  for (const raw of stored ?? []) {
    const g = GROUP_ALIASES[raw] ?? raw;
    if (orderable.has(g) && !seen.has(g)) { ranked.push(g); seen.add(g); }
  }
  for (const g of MENU_ORDERABLE_GROUPS) if (!seen.has(g)) ranked.push(g);
  return ['Home', ...ranked];
}

/**
 * Order a group's entries by the owner's stored preference (Settings › Menu),
 * keyed by `href`. Same reconciliation as the group order: a stored href no
 * longer in the group is dropped, and an entry the stored list never mentions
 * (a module added after the preference was saved) keeps its shipped position
 * at the end — so a saved sub-order can never hide a module either.
 */
export function orderedGroupItems<T extends { href: string }>(items: T[], stored: string[] | null | undefined): T[] {
  const byHref = new Map(items.map((i) => [i.href, i]));
  const seen = new Set<string>();
  const out: T[] = [];
  for (const h of stored ?? []) {
    const it = byHref.get(h);
    if (it && !seen.has(h)) { out.push(it); seen.add(h); }
  }
  for (const it of items) if (!seen.has(it.href)) out.push(it);
  return out;
}

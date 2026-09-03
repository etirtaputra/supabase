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

/**
 * Where a role lands when it signs in with no particular page in mind.
 *
 * This is not cosmetic: sign-in used to send EVERYONE to /purchasing, and a
 * sell-side account has no buy-side access, so the first thing a new sales
 * admin ever saw was "Access restricted" — an account that worked perfectly,
 * reading as a broken one. Send each role somewhere it can actually open.
 * The dashboard is the safe floor: every signed-in role may open it.
 */
export const homeFor = (perms: RolePermissions | null): string => {
  if (!perms) return '/';
  if (perms.buySide) return '/purchasing';
  if (perms.sellSide && perms.canEditSalesDocs) return '/sales';
  // Single-job roles land ON that job — the dashboard has little to tell a
  // picker or a service desk, and an empty home screen reads as a broken one.
  if (perms.canManageStock) return '/stock';
  if (perms.canHandleService) return '/aftersales';
  return '/';
};

/** Does this role pass a section gate? (null = open to everyone signed in) */
export const sectionAllowed = (perms: RolePermissions | null, s: NavSection): boolean =>
  !s || !perms || (s === 'trading' ? (perms.buySide || perms.sellSide) : perms[s]);

export interface Destination {
  href: string;
  label: string;                    // what the menu/search shows
  group: string;                    // section header ("Buy side", "Admin"…)
  section: NavSection;              // flow gate
  cap?: keyof RolePermissions;      // extra capability gate (all must pass)
  /** A page gated on "A OR B" — any one of these is enough. */
  caps?: (keyof RolePermissions)[];
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
  // The group is PURCHASING, not "Buy", and its workspaces are listed one by
  // one rather than hidden behind a single entry: the tabs are where the work
  // actually happens, so the menu names them. (The item screens — Editor,
  // Market Intel — live in the Catalog block below, with the rest of the
  // item lenses.)
  // Item Editor leads Purchasing (owner's call, 2026-08-10): the component
  // master sits beside New Deal, the two buy-side entry points, which is where
  // the buyer expects it — more intuitive than filed under Catalog.
  { href: '/purchasing?tab=catalog', label: 'Item Editor', group: 'Purchasing', section: 'buySide', inNav: true,
    hint: 'The component master — models, prices, specs, links',
    keywords: 'catalog components parts items master editor sku spec' },
  // Supplier Quotes + Purchase Orders merged into ONE entry form (2026-08-04):
  // record a PI, or PI + PO in one save, or raise the PO for a stored quote.
  // Old names stay as keywords so Spotlight muscle memory keeps working.
  { href: '/purchasing?tab=quoting', label: 'New Deal', group: 'Purchasing', section: 'buySide', inNav: true,
    hint: 'Record a supplier quote / PI — alone or straight to its PO',
    keywords: 'pi proforma quote entry new catalog supplier quotes po purchase order raise deal' },
  // The board the team opens first thing: which PO is at which stage. It sits
  // before Payments because that is the order the morning runs — look at the
  // board, see what needs paying, go and pay it.
  { href: '/purchasing?tab=progress', label: 'Progress', group: 'Purchasing', section: 'buySide', inNav: true,
    hint: 'Which PO is at which stage — PI, PO, payments, docs, PIB',
    keywords: 'kanban board progress stage milestone status pipeline basecamp impor import track' },
  { href: '/purchasing?tab=financials', label: 'Payments', group: 'Purchasing', section: 'buySide', cap: 'canViewBankFees', inNav: true,
    hint: 'Record supplier payments, bank fees and landed costs',
    keywords: 'payment batch remittance costs fees ap payable financials money supplier' },
  { href: '/purchasing?tab=lookup', label: 'Deal Lookup', group: 'Purchasing', section: 'buySide', inNav: true,
    hint: 'Every PI → PO → payment as one deal',
    keywords: 'deals pi po payments history search catalog' },
  { href: '/suppliers', label: 'Suppliers', group: 'Purchasing', section: 'buySide', inNav: true,
    hint: 'Vendor profiles, purchase volume, outstanding payables',
    keywords: 'vendors payables' },
  // Buy-side roles keep Stock; the warehouse reaches it through the capability
  // that names its job, without being handed the buy prices next door.
  { href: '/stock', label: 'Stock', group: 'Purchasing', section: null, caps: ['buySide', 'canManageStock'], inNav: true,
    hint: 'On-hand per warehouse, moving-average cost, shortages',
    keywords: 'inventory warehouse gudang on hand balance' },
  // Promoted out of hiding: booking goods in is a daily warehouse job and the
  // moment landed cost enters the system — it should not be search-only.
  { href: '/stock/receive', label: 'Receive Goods', group: 'Purchasing', section: null, cap: 'canManageStock', inNav: true,
    hint: 'Book goods in against a purchase order (GRN)',
    keywords: 'grn goods receipt receiving inbound terima barang' },
  // The other half of receiving: the bills that arrive after the goods do.
  { href: '/stock/reconcile', label: 'Landed Cost', group: 'Purchasing', section: 'buySide', inNav: true,
    hint: 'True up stock cost when the freight, duty and final payment land',
    keywords: 'landed cost true up reconcile variance freight duty revaluation biaya' },
  // The bare /purchasing URL still resolves (it opens the Item Editor tab) —
  // search-only so the menu is not saying the same thing twice.
  { href: '/purchasing', label: 'Purchasing', group: 'Purchasing', section: 'buySide', inNav: false,
    hint: 'The procure-to-pay workspace',
    keywords: 'procurement buying purchase' },

  // ── Sales (owner's wording 2026-08-07; the section gate stays `sellSide`) ──
  // Gated on the capability alone: the service desk keeps customer records
  // current as part of a service call, without being a sell-side role.
  { href: '/customers', label: 'Customers', group: 'Sales', section: null, cap: 'canManageCustomers', inNav: true,
    hint: 'CRM — customers, contacts, account managers',
    keywords: 'crm clients contacts buyers' },
  // Products lives with Sales — it is the list the sales team quotes from, in
  // their own words (internal description, tier price, live stock; never a
  // brand or supplier model). The item's OTHER lenses sit in Catalog.
  { href: '/products', label: 'Products', group: 'Sales', section: null, cap: 'canViewSellingPrice', inNav: true,
    hint: 'What we sell, with tier prices and live stock',
    keywords: 'catalogue catalog items selling price tier products' },
  { href: '/sales', label: 'Sales Orders', group: 'Sales', section: 'sellSide', cap: 'canEditSalesDocs', inNav: true,
    hint: 'Quotations → orders → invoices → delivery (DQ → PQ → SO)',
    keywords: 'sales quotation dq pq sq so price quote order penawaran' },
  { href: '/sales/new', label: 'New Quotation', group: 'Sales', section: 'sellSide', cap: 'canEditSalesDocs', inNav: false,
    hint: 'Start a new sales quotation',
    keywords: 'new quote create sq penawaran baru sales' },
  // Owner-only, and always has been — the nav used to advertise it to every
  // sell-side role, so search offered a door that bounced them.
  { href: '/sales/library', label: 'Sales · Description Library', group: 'Sales', section: 'sellSide', cap: 'canManageUsers', inNav: false,
    hint: 'Curated line texts that feed the item picker',
    keywords: 'library descriptions text' },
  { href: '/invoices', label: 'Invoices', group: 'Sales', section: null, caps: ['canEditSalesDocs', 'canRecordReceipts'], inNav: true,
    hint: 'Accounts receivable — issued, received, outstanding',
    keywords: 'ar receivable billing tagihan' },
  { href: '/delivery', label: 'Delivery', group: 'Sales', section: null, caps: ['canEditSalesDocs', 'canManageStock'], inNav: true,
    hint: 'Delivery orders and Surat Jalan',
    keywords: 'do surat jalan shipping dispatch' },
  // The unit register: the warehouse writes it while packing, after-sales reads
  // it from a label. Both sides of that need the door.
  { href: '/serials', label: 'Serial Numbers', group: 'Sales', section: null, caps: ['canManageStock', 'canEditSalesDocs', 'canHandleService'], inNav: true,
    hint: 'Record the serial numbers on a delivery, and find the order from one',
    keywords: 'serial number sn unit register nomor seri warranty label' },
  { href: '/aftersales', label: 'After Sales', group: 'Sales', section: null, cap: 'canHandleService', inNav: true,
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
  // Pricing Intelligence, Cash Cycle and Exchange Rates moved to the Item
  // hub's per-item tabs (2026-08-11) — their keywords moved with them.
  { href: '/spend-cash', label: 'Spend & Cash', group: 'Insights', section: null, cap: 'canViewAnalytics', inNav: true,
    hint: 'Spend analytics, cost breakdown, positioning map',
    keywords: 'insights analytics reports spend tuc costs positioning' },
  { href: '/profitability', label: 'Profitability', group: 'Insights', section: null, cap: 'canViewEconomics', inNav: true,
    hint: 'GP per item / customer / rep, capital allocation, cash cycle',
    keywords: 'economics margin profit gp ccc dio dso dpo turnover position capital allocation gmroi' },
  // ── Catalog — the item and its back-office lenses (consolidated 2026-08-10) ─
  // The Item Hub (the 360° page — the pivot of the whole system) leads, then
  // the record itself, the market, and our price ladder. The sell team's
  // Products list lives in Sales, where they reach for it; Catalog is the
  // back-office view of the same item. Every entry keeps its own gate.
  { href: '/items', label: 'Item Hub', group: 'Catalog', section: 'trading', cap: 'canViewAnalytics', inNav: true,
    hint: 'Everything about one item — purchases, sales, pricing, FX, cash cycle, stock, specs',
    keywords: 'item hub component sku part product barang produk master 360 items pricing intelligence cash cycle exchange rate fx forex' },
  { href: '/specs', label: 'Tech Specs', group: 'Catalog', section: 'trading', cap: 'canEdit', inNav: true,
    hint: 'Enter a datasheet, and compare products side by side',
    keywords: 'specs specifications technical datasheet compare comparison side by side parameters json form' },
  { href: '/items/specs', label: 'Spec Readiness', group: 'Catalog', section: 'trading', cap: 'canViewAnalytics', inNav: false,
    hint: 'What the system calculators can size from — fill the missing specs',
    keywords: 'specs specifications calculator ready designer sizing missing data quality bom' },
  { href: '/purchasing?tab=market-intel', label: 'Market Intel', group: 'Catalog', section: 'buySide', inNav: true,
    hint: 'Competitor prices and what the market is charging',
    keywords: 'competitor market price intel benchmark rival' },
  // "Selling Prices" (owner, 2026-08-29). It was "Pricing Tiers" while the page
  // was only the tier ladder; it now OPENS on Set Pricing, because entering
  // prices moved off the Item Editor. "Selling" earns its place — it is the one
  // word that separates this from landed cost, which is the other price on
  // every one of these rows. Bare "Pricing" was rejected on 2026-08-11 for
  // being the ladder only; that reason has gone, but the ambiguity has not.
  { href: '/pricing', label: 'Selling Prices', group: 'Catalog', section: null, cap: 'canManagePricing', inNav: true,
    hint: 'Set prices per tier, margin floor audit, per-item overrides',
    keywords: 'tiers markup discount floor margin pricing tier set pricing sell price harga jual selling price bulk' },
  // The buy-side AI assistant — answers questions over suppliers, costs, POs
  // and quotes. Search-only: it has no menu tile today, so Spotlight is how it
  // is reached. Gate matches the page (buySide, redirects otherwise).
  { href: '/ask', label: 'Ask ICAPROC', group: 'Insights', section: 'buySide', inNav: false,
    hint: 'Ask the AI about suppliers, costs, POs and quotes',
    keywords: 'ask ai assistant question chat query natural language help answer bot' },

  // ── Projects ──────────────────────────────────────────────────────────────
  { href: '/proposals', label: 'Proposals', group: 'Projects', section: 'projects', inNav: true,
    hint: 'EPC project proposals',
    keywords: 'epc project quote solar pv' },
  // Owner-only: the page itself says so to everybody else.
  { href: '/proposals/library', label: 'Proposals · Description Library', group: 'Projects', section: 'projects', cap: 'canManageUsers', inNav: false,
    hint: 'Curated proposal line texts and default costs',
    keywords: 'library descriptions' },
  // Any projects role may REVIEW the duplicates; merging and renaming are
  // owner-only inside the page, which is why the door itself is not.
  { href: '/proposals/directory', label: 'Proposals · Directory', group: 'Projects', section: 'projects', inNav: false,
    hint: 'Merge duplicate customers, sites, addresses and brands',
    keywords: 'merge duplicates cleanup directory' },

  // ── Admin / configuration ────────────────────────────────────────────────
  { href: '/settings', label: 'Settings', group: 'Admin', section: null, cap: 'canManageUsers', inNav: true,
    hint: 'Formatting, defaults, company, banks and users',
    keywords: 'preferences configuration admin setup' },
  { href: '/settings?tab=format', label: 'Settings · Formatting', group: 'Admin', section: null, cap: 'canManageUsers', inNav: false,
    hint: 'Number, currency and date formats; list layout',
    keywords: 'number currency date format layout compact card separator' },
  { href: '/settings?tab=appearance', label: 'Settings · Appearance', group: 'Admin', section: null, cap: 'canManageUsers', inNav: false,
    hint: 'The default skin — dark, dim, light or paper',
    keywords: 'theme skin colour color dark light dim paper mode default appearance' },
  { href: '/settings?tab=menu', label: 'Settings · Menu', group: 'Admin', section: null, cap: 'canManageUsers', inNav: false,
    hint: 'Reorder the navigation — groups and the entries inside them',
    keywords: 'menu order reorder nav navigation arrange rearrange groups entries sidebar' },
  { href: '/settings?tab=dashboard', label: 'Settings · Dashboard', group: 'Admin', section: null, cap: 'canManageUsers', inNav: false,
    hint: 'The house dashboard — which widgets everyone starts with, and in what order',
    keywords: 'dashboard widgets panels home layout arrange reorder show hide tiles kpi customise customize' },
  { href: '/settings?tab=lists', label: 'Settings · Lists', group: 'Admin', section: null, cap: 'canManageUsers', inNav: false,
    hint: 'How each list opens — its default order and the period it covers',
    keywords: 'lists list default sort order period opening layout compact card' },
  { href: '/settings?tab=pricing', label: 'Settings · Pricing', group: 'Admin', section: null, cap: 'canManageUsers', inNav: false,
    hint: 'Rounding step, default markup, margin floor, customer tier',
    keywords: 'rounding markup tier floor default' },
  { href: '/settings?tab=defaults', label: 'Settings · Defaults', group: 'Admin', section: null, cap: 'canManageUsers', inNav: false,
    hint: 'PPN, payment terms, warehouse, thresholds',
    keywords: 'ppn vat tax terms warehouse slow mover drift' },
  { href: '/settings?tab=terms', label: 'Settings · Terms', group: 'Admin', section: null, cap: 'canManageUsers', inNav: false,
    hint: 'Sales payment and delivery term options',
    keywords: 'terms payment delivery conditions sales options library' },
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
/**
 * THE access rule. The menu, Spotlight and the screens themselves all ask this
 * one function, which is the point: a rule written twice is a rule that drifts,
 * and every way it drifts is a bug someone meets. Either the menu offers a door
 * that throws you out, or it hides a door you were allowed to walk through.
 */
export const destinationAllowed = (perms: RolePermissions | null, d: Destination): boolean => {
  if (!perms) return true;                         // profile still loading
  if (!sectionAllowed(perms, d.section)) return false;
  if (d.cap && !perms[d.cap]) return false;
  if (d.caps && !d.caps.some((c) => !!perms[c])) return false;
  return true;
};

export const destinationsFor = (perms: RolePermissions | null): Destination[] =>
  DESTINATIONS.filter((d) => destinationAllowed(perms, d));

/**
 * What the MENU shows — and it answers "role not known yet" the opposite way
 * to everything else: NOTHING.
 *
 * A page gate that does not yet know the role must wait rather than bounce
 * someone mid-load, so `destinationAllowed` is permissive while `perms` is
 * null. A menu has no such excuse: showing every module and then removing the
 * ones a person may not open tells them what they are missing and looks
 * broken while it happens. A menu that fills in is honest; a menu that empties
 * out is not.
 */
export const menuDestinationsFor = (perms: RolePermissions | null): Destination[] =>
  (perms ? DESTINATIONS.filter((d) => d.inNav && destinationAllowed(perms, d)) : []);

/**
 * May this role open this path? Screens call this for their own gate, so what
 * the menu shows and what the page admits can never disagree. A path nobody
 * registered is open to any signed-in user — registering it is how it gets a
 * gate, and `lib/access.test.ts` fails the build if a gated page is missing.
 */
export const canOpenPath = (perms: RolePermissions | null, path: string): boolean => {
  const bare = path.split('?')[0];
  const d = DESTINATIONS.find((x) => x.href.split('?')[0] === bare);
  return d ? destinationAllowed(perms, d) : true;
};

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

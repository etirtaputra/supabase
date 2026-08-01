/**
 * The update log — what changed in ICAPROC, and when.
 *
 * HOUSE RULE (owner's call, 2026-07-30): every update shipped to main adds an
 * entry HERE in the same commit, newest first. `at` is the moment the change
 * was pushed (ISO, UTC) — the page renders it through the settings-driven
 * formatters in the viewer's own timezone, so "when" always reads local.
 *
 * Keep entries in the user's language: what someone will SEE changed, not the
 * code that changed it. One entry per shipped update; details are optional
 * bullets for the parts worth knowing.
 */

export interface ChangelogEntry {
  /** When the update went live — ISO timestamp, UTC. */
  at: string;
  title: string;
  details?: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    at: '2026-08-01T03:30:00Z',
    title: 'Menu fits the phone screen — no more sideways scroll',
    details: [
      'The skin circles were wider than the menu, which silently gave the whole dropdown a sideways scroll and clipped the first letter of every entry.',
      'Each skin is now one plain circle in its main colour, the menu is slightly wider, and sideways scrolling is disabled for good.',
    ],
  },
  {
    at: '2026-08-01T03:00:00Z',
    title: 'Mobile polish round · Cost Lookup retired · “Item Editor” naming',
    details: [
      'Skin switcher in the ICAPROC menu is now four colour circles — no more cut-off labels; the name shows on hover.',
      'Payments: the Single PO / Multi-PO Batch toggle no longer wraps oddly on phones.',
      'Compact layout is now genuinely compact on phones: Customers become one line per customer, Products drop to name + stock + list price.',
      'Item Editor filters (Unused, Has Specs, Low Margin…) wrap into visible rows on mobile instead of scrolling far off to the right.',
      'Spend & Cash › Cost Lookup is retired — everything it showed lives in Analytics › Items.',
      'The catalog editor is now titled “Item Editor” to match the Items naming everywhere.',
    ],
  },
  {
    at: '2026-08-01T01:20:00Z',
    title: 'Skins: menu row no longer cut off · Settings previews the default live',
    details: [
      'The Appearance chips in the ICAPROC menu now sit on their own line, so all four fit instead of running off the edge.',
      'Selecting a skin in Settings › Appearance now repaints the screen immediately so you see what you are choosing — it only becomes the company default when you Save, and leaving the tab restores your own skin.',
    ],
  },
  {
    at: '2026-08-01T00:45:00Z',
    title: 'Four skins — Dark, Dim, Light and Paper — plus a company default in Settings',
    details: [
      'Two new looks join the originals: Dim is a softened dark (graphite instead of near-black — kinder to office monitors), and Paper is a warm cream light for all-day reading.',
      'Pick yours from the ICAPROC menu: the choice sticks to your browser.',
      'Settings › Appearance sets the company-wide default — what everyone sees before they pick their own.',
    ],
  },
  {
    at: '2026-08-01T00:05:00Z',
    title: 'Fixed: the Buy / Sell / Finance / Analytics dropdowns open again',
    details: [
      'Yesterday’s header overlap fix accidentally clipped the open menus into invisibility — the group button toggled but no list appeared.',
      'The overlap protection stays; only the clipping is gone.',
    ],
  },
  {
    at: '2026-07-31T10:45:00Z',
    title: 'Price history: free-text lines now name their deal too',
    details: [
      'Lines not linked to a catalog item had a separate price history that showed only the quote number — that is why some entries had no customer or project.',
      'Both histories now describe the deal the same way: customer, and the project’s system and size.',
    ],
  },
  {
    at: '2026-07-31T10:10:00Z',
    title: 'Page headers survive a narrow desktop window on every screen',
    details: [
      'Every page header now wraps its buttons onto a second line instead of letting them overlap the menu when the browser is made smaller.',
      'Applied across all 21 screens, not just the ones where it was noticed.',
    ],
  },
  {
    at: '2026-07-31T09:30:00Z',
    title: 'Back from a proposal always works · header stops overlapping on narrow screens',
    details: [
      'Leaving a proposal now saves your changes and goes, instead of asking a question that some browsers silently answer “stay” — which is why Back sometimes did nothing.',
      'The top bar no longer piles the menu, search and page buttons on top of each other between laptop and desktop widths; the full menu stays in the ICAPROC dropdown.',
    ],
  },
  {
    at: '2026-07-31T08:40:00Z',
    title: 'Proposal price history says which deal each price came from',
    details: [
      'A previously-used cost now shows the customer and the system it was quoted for — e.g. “Xurya Daya Indonesia · PV On-Grid 234 kWp DC / 200 kW AC” — under the quote number.',
      'A price is only reusable if you can see whether the job was comparable.',
    ],
  },
  {
    at: '2026-07-31T08:05:00Z',
    title: 'Fixed: an Owner can move a SENT proposal back to Draft',
    details: [
      'Picking DRAFT on a sent proposal was refused with “Not saved — quote is SENT”, or silently forced back to Sent: the guard that stops a stale tab un-sending someone else’s quote could not tell that apart from a deliberate un-send.',
      'A status you pick yourself now always reaches the database; the stale-tab protection still applies when you did not touch it.',
      'Non-owners get a clear message instead: only an Owner can move a sent proposal back.',
      'The status pill no longer squeezes the quote number off the header on phones.',
    ],
  },
  {
    at: '2026-07-30T09:05:00Z',
    title: 'Fixed: EPC proposals no longer fall back to Drafts after being sent',
    details: [
      'Engineers and project admins picking SENT locked their own editor before the save could run, so the change never reached the database and the proposal reappeared under Drafts.',
      'The editor now locks only once SENT is actually saved — choose Sent, save (or just close), and it stays sent.',
    ],
  },
  {
    at: '2026-07-30T08:25:00Z',
    title: 'Header clock no longer clashes with the menu on smaller desktops',
    details: [
      'Between laptop and wide-desktop widths the clock shows the time only; the full date returns when there is room.',
      'The search field keeps a usable minimum width instead of collapsing.',
    ],
  },
  {
    at: '2026-07-30T07:55:00Z',
    title: 'A clock in the header · this update log',
    details: [
      'The date and time sit fixed at the top of every page, phones included, in your own timezone.',
      'Tapping the clock opens What’s New — every update, what changed and when. Spotlight finds it as "What\'s New".',
    ],
  },
  {
    at: '2026-07-30T07:08:38Z',
    title: 'Item cost forensics: the last Cost Lookup details arrive',
    details: [
      'Last Price shows the ▲/▼ movement vs the previous supplier quote.',
      'Quote lines regained their Total column; payment records their notes.',
      'Expanded /items rows carry the item’s datasheet link.',
    ],
  },
  {
    at: '2026-07-30T06:14:02Z',
    title: 'Search results for items open the Items list, row already expanded',
    details: [
      'Picking an item in Spotlight lands on /items with the search pre-filled and that row’s cost forensics open.',
      'The full item hub stays one ↗ away.',
    ],
  },
  {
    at: '2026-07-30T05:39:10Z',
    title: 'Cost Lookup’s audit trail now lives in the Item hub · Pricing back under Admin',
    details: [
      'Items rows expand in place: quote lines, per-PO TUC allocations (principal / fees / landed split), payment records, linked & comparable items.',
      'The hub’s Buy tab shows the same forensic layer; Spend & Cash › Cost Lookup stays until it’s retired.',
      'Pricing moved back to the Admin menu group; the ICAPROC menu is more compact so it fits without scrolling.',
    ],
  },
  {
    at: '2026-07-30T02:57:18Z',
    title: 'Settings › Lists covers Items and After Sales',
    details: [
      'Items: choose the opening sort (ships on Most traded).',
      'After Sales gained a reported-date period filter, configurable like every other list.',
    ],
  },
  {
    at: '2026-07-30T02:51:43Z',
    title: 'Bank account pickers show the owning company',
    details: ['"Paid from" / "Received in" now read like BCA · 0827211111 — PT Indodaya Surya Lestari.'],
  },
  {
    at: '2026-07-30T02:12:19Z',
    title: 'Page addresses match the menu names',
    details: [
      '/catalog → /purchasing, /insights → /spend-cash, /economics → /profitability, /data → /import-export.',
      'Old links and bookmarks redirect permanently, tabs and searches included.',
    ],
  },
  {
    at: '2026-07-30T01:59:58Z',
    title: 'Money is now Finance · Analytics is owner-only',
    details: [
      'The Items hub sits in the Analytics group beside Spend & Cash and Profitability.',
      'Analytics (all three screens) requires the new owner-only permission; other roles keep their own screens.',
    ],
  },
  {
    at: '2026-07-30T01:45:39Z',
    title: 'The Item hub: one page per stock item',
    details: [
      '/items — every item, one click to its buy history, tier prices, warehouse ledger, specs and economics.',
      'Every number is assembled from the screen that owns it, so the hub always agrees with its sources.',
    ],
  },
];

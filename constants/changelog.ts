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
    at: '2026-08-03T18:50:00Z',
    title: 'Sales list: the number IS the link',
    details: [
      'Click the SQ number to open the document; click anywhere else on the row to expand the preview. The “Open document →” button is gone — the number underlines green on hover to say it’s the door.',
    ],
  },
  {
    at: '2026-08-03T18:30:00Z',
    title: 'Sales list: fulfillment digest in the expanded row + Payment/Delivery filters',
    details: [
      'Expanding an order now shows the whole fulfillment picture above the items: payment state with Rp received of total, every invoice with its own Paid/Partial/Unpaid chip and how much of the order is billed, and every delivery order with its Delivered/Preparing chip — including ×2 counts and “partly delivered / fully invoiced” notes for split fulfillment.',
      'Two new filters beside the sort: Payment (Unpaid / Partial / Outstanding / Paid) and Delivery (Not shipped / Preparing / Partly delivered / Delivered) — “delivered but not fully paid” is now two clicks.',
    ],
  },
  {
    at: '2026-08-03T18:00:00Z',
    title: 'Status chips read the same everywhere · doc tags count every child',
    details: [
      'All state chips now use the same style as the status pills — Paid, Partial, Unpaid, Outstanding, Expired, Delivered, Preparing — instead of a mix of ALL-CAPS badges.',
      'The SO / INV / DO tags in the editor’s top bar now come from the real child documents: two delivery orders show as “DO-… +1”, and hovering the tag lists every number. Before, only the first invoice/DO ever appeared.',
    ],
  },
  {
    at: '2026-08-03T17:35:00Z',
    title: 'Sales list: Status and Payment are separate columns',
    details: [
      '“Where is the order” and “where is the money” no longer share one crowded cell: Status keeps the lifecycle pill (and EXPIRED), and a new Payment column shows exactly one chip — PAID, PARTIAL, UNPAID, or OUTSTANDING (delivered but money open) — with the paid %.',
      'Grand Total went back to being just the number.',
    ],
  },
  {
    at: '2026-08-03T17:10:00Z',
    title: 'Delivered-but-unpaid orders are tagged OUTSTANDING',
    details: [
      'When goods have gone out but the money hasn’t fully come in, the sales list and the editor now show an OUTSTANDING badge next to Delivered — red when nothing is received, amber when partly paid, with the open amount in the tooltip. Typing “outstanding” (or “belum lunas”) in the list search finds them.',
      'Fixed: a payment a rounding-hair under 100% showed “100%” in amber with no PAID badge — paid checks now use the house half-rupiah tolerance.',
    ],
  },
  {
    at: '2026-08-03T16:45:00Z',
    title: 'Fulfillment: Invoices and Delivery each get their own box',
    details: [
      'The panel is now two side-by-side boxes — INVOICES (meter, + New Invoice, its documents) and DELIVERY (meter, + New Delivery Order, Ship from, its DOs) — instead of one interleaved list. On a phone they stack as two clean sections.',
      'Row chips slimmed to fit the narrower boxes: the box title says what the rows are, so the INV/DO badges went.',
    ],
  },
  {
    at: '2026-08-03T16:20:00Z',
    title: 'Money & quantity fields accept =formulas like Excel',
    details: [
      'The payment Amount, the invoice/DO quantity fields and the progress-% field now evaluate =formulas on blur — type =2181773/2 and it becomes the number. Same calculator as the quote lines and the EPC editor.',
    ],
  },
  {
    at: '2026-08-03T16:00:00Z',
    title: 'Payments are now applied to a specific invoice',
    details: [
      'Record Payment opens with the invoice pre-selected (the first one still owed) and the amount pre-filled with THAT invoice’s outstanding — switch invoice and the amount follows. The payment writes its invoice link, so the invoice’s UNPAID badge finally turns PARTIAL/PAID.',
      'Each payment row now shows which invoice it pays; “Whole order” remains available for money not tied to one invoice (e.g. a DP taken before invoicing).',
      'The Payments panel moved up to sit directly under Fulfillment — invoices, deliveries and money in one screenful, no scrolling past the item list.',
      'The printed invoice already counted only its own payments for the LUNAS stamp — with payments now linked, that stamp is finally fed correctly.',
    ],
  },
  {
    at: '2026-08-03T15:30:00Z',
    title: '“Set to today’s date” is always under the quote date',
    details: [
      'The button no longer appears and disappears — it sits permanently under the Quote date box, muted when the quote is already dated today.',
    ],
  },
  {
    at: '2026-08-03T15:10:00Z',
    title: 'Fulfillment panel: each side owns its button',
    details: [
      '“+ New Invoice” now sits under the Invoiced meter and “+ New Delivery Order” (with Ship from) under the Delivered meter — billing on the left, shipping on the right.',
      'All fulfillment buttons restyled to the sleek outlined language of the command bar.',
      'Reminder of what was already there: an order can carry any number of invoices and delivery orders, and both dialogs let you pick which items and quantities go on each one (set a line to 0 to leave it for later).',
    ],
  },
  {
    at: '2026-08-03T14:45:00Z',
    title: 'Sales quote: pre-set Payment terms & Delivery terms',
    details: [
      'Two new dropdowns on the quotation: Payment terms (lunas 100%, DP 20/30/50%, or 7/14/21/30 hari setelah Invoice / Surat Jalan) and Delivery terms (Di antar / Di ambil sendiri).',
      'The lists live in Settings › Terms — one term per line, edit them any time; documents keep the exact wording they were saved with.',
      'The chosen payment term prints on the quotation, the order confirmation AND the invoice (“Ketentuan Pembayaran”); the delivery term prints on the quotation and order (“Pengiriman”).',
    ],
  },
  {
    at: '2026-08-03T14:00:00Z',
    title: '“Set to today’s date” shows on every quote, and “today” means YOUR today',
    details: [
      'The shortcut under the quote date now appears whenever the date isn’t today — on any status, not only drafts (the date field was always editable anyway).',
      'Fixed: “today” was computed in UTC, so before 07:00 WIB a new quote was dated yesterday and expiry flipped a day early. New documents, the expiry badges and the dashboard check now use your local date.',
    ],
  },
  {
    at: '2026-08-03T13:40:00Z',
    title: 'Sales quote editor restyled to the EPC command-bar language',
    details: [
      'The action bar now matches the EPC proposal editor: quiet outlined buttons that light up on hover, with Save as the single solid green button. Status actions keep their meaning through colour — green for the natural next step, red for Reject/Cancel, blue for Revise.',
      'The 7d/14d/30d validity presets became one segmented control, and “Set to today’s date” is a proper button beneath the quote date (drafts only).',
      'PPN %, Qty and Unit price now align left like every other field; the ƒ formula badge moved to the right corner of the field.',
    ],
  },
  {
    at: '2026-08-02T10:20:00Z',
    title: 'Sales quote: formula cells now work like the EPC editor',
    details: [
      'Qty and Unit price fields look normal again — no “(=formula)” hint in the empty field.',
      'Type =2*6 and the field shows 12 with a small ƒ badge saying a formula is behind it (hover the badge to read it). Click back into the field and the formula returns for editing — exactly like the EPC proposal editor.',
      'The formula is remembered with the quote, so the ƒ badge survives reopening the document. Documents and totals always use the calculated number.',
    ],
  },
  {
    at: '2026-08-02T09:45:00Z',
    title: 'Sales quote: one-click validity presets + “Set to today’s date”',
    details: [
      '“Valid until” now has 7d / 14d / 30d buttons — one click sets the date from the quote date, with the active preset highlighted and the day count shown beside it.',
      'On a draft, a “Set to today’s date” shortcut appears under the quote date whenever it isn’t today — sent documents keep their date without a one-click rewrite.',
    ],
  },
  {
    at: '2026-08-02T09:10:00Z',
    title: 'Sales quotes now carry a validity date',
    details: [
      'A new quotation gets a “Valid until” date automatically — quote date + the days set in Settings › Defaults › “Quotation valid for (days)” (ships at 30). Editable per quote; clear it for an open-ended offer.',
      'The PDF prints “Berlaku s/d …” under the quote date — on the quotation only, never on the order confirmation or invoice.',
      'A validated/sent quote past its date shows an amber EXPIRED badge on the sales list and in the editor. Existing quotes have no date, so nothing expires retroactively.',
      'Revising a quote the customer has seen restarts validity from today — a revision is a fresh offer.',
      'The dashboard’s “quotations awaiting an answer” now also flags sent quotes past their validity, however recent, and says how many are past it.',
    ],
  },
  {
    at: '2026-08-02T08:20:00Z',
    title: 'Sales list: “Open document” moved to the left of the preview, more compact',
    details: [
      'Expanding a quote row now puts the Open document button first, where reading starts, with the SO / INV / DO numbers beside it — and the button is smaller so the preview stays about the items.',
    ],
  },
  {
    at: '2026-08-01T18:30:00Z',
    title: 'Sales quote: no phantom “Unsaved” after saving · Library lists used custom lines',
    details: [
      'Fixed: after saving, Back to list could still claim unsaved changes and the Save button stayed lit — the freshly loaded state now always counts as saved.',
      'The Sales Description Library now also lists custom lines already used in sales quotes (with usage count and last price) — one click adds any of them as a curated LIB suggestion.',
    ],
  },
  {
    at: '2026-08-01T17:45:00Z',
    title: 'Sales quote revisions only count what the customer has seen',
    details: [
      'Revising a quote that was validated but never sent re-opens it under the SAME revision number — Rev only bumps when the quote has actually gone out (sent or accepted).',
    ],
  },
  {
    at: '2026-08-01T17:15:00Z',
    title: 'Sales quote: no “Ready” without the stock to back it',
    details: [
      'A line whose live stock can’t cover the quantity never gets “Ready” suggested — the field stays blank instead.',
      'If a short line still says “Ready” (or is left blank), the lead-time control turns amber with a warning to set the real lead time.',
    ],
  },
  {
    at: '2026-08-01T16:45:00Z',
    title: 'Sales quote Save behaves like EPC: mutes when saved, Ctrl+S works',
    details: [
      'The Save button dims and stops being clickable once everything is saved — it lights up again on the next change (auto-save counts).',
      'Ctrl+S / Cmd+S saves from anywhere in the editor, same as EPC proposals.',
    ],
  },
  {
    at: '2026-08-01T16:15:00Z',
    title: 'Sales quote price intel opens on hover / while editing — like EPC costs',
    details: [
      'No more clicking the Unit price label: hovering the price shows the log when THIS customer has bought or quoted the item before (a green dot marks such lines), and focusing the field to edit opens tier prices + history whenever there is anything to show.',
      'Clicking a price in the panel still applies it; typing your own still overrides.',
    ],
  },
  {
    at: '2026-08-01T15:45:00Z',
    title: 'Sold-before history stays inside Sales Quotes',
    details: [
      'Owner’s call: the Sales Quote price history reads sales quotes ONLY, and EPC proposals keep their own price log — the two product lines’ libraries never mix.',
    ],
  },
  {
    at: '2026-08-01T15:15:00Z',
    title: 'Sales quote: one command bar on top — number, status and every action together',
    details: [
      'Save, PDF and the status buttons moved from the bottom of the page into a sticky bar at the top, right above the milestone strip — always in reach while you edit.',
      'Back to list sits beside the quote number and status pill in the same bar.',
      'A draft shows its own unique SQ number the moment the first auto-save lands — no more “New Sales Quote” placeholder hanging around.',
    ],
  },
  {
    at: '2026-08-01T14:30:00Z',
    title: 'Sales quotes: leave-warning · smart lead times · searchable customer · EPC price history',
    details: [
      'Leaving a quote with unsaved changes now warns you: closing or refreshing the tab shows the browser prompt, and Back to list offers Save & leave / Discard. Drafts simply save themselves and go.',
      'Lead time now suggests itself: when live stock covers the ordered quantity it proposes “Ready”; otherwise it uses the item’s real historical PO → received average from Purchasing, always rounded up to whole months (82 days → 3 bulan). One tap applies it, and it pre-fills when you pick a catalog item.',
      'The Customer field is now type-to-search instead of a scroll-through list.',
    ],
  },
  {
    at: '2026-08-01T13:45:00Z',
    title: 'Sales quotes: drafts save themselves · formulas · price intel · per-item lead time',
    details: [
      'A draft now auto-saves a moment after every change (and when you leave the tab) — walking away no longer loses work. Only drafts; sent and later stages still save explicitly.',
      'Qty and Unit price accept Excel-style formulas: type “=12*40”, get 480 on leaving the cell — same as EPC proposals.',
      'Click the Unit price label on a catalog line for the price picker: every tier’s price with the customer’s tier pre-marked, plus what the item actually sold for before (this customer’s deals first). One click applies; typing any number still overrides.',
      'Every item line has a lead time (same presets as EPC proposals, custom allowed) and it prints on the PDF when the lead-time column is on.',
    ],
  },
  {
    at: '2026-08-01T12:45:00Z',
    title: 'Customers: duplicate finder with merge · header never overlaps again',
    details: [
      'New Duplicates button groups customers with similar names or a shared contact email / phone. Pick the record to keep and merge: blank fields fill in, contacts, sales documents and links move across, the copies are deleted.',
      'Clicking Updated now sorts newest-first (a second click flips) — text columns still start A→Z.',
      'The top menu now claims the width it actually needs, so when the browser narrows, page buttons wrap to a second row instead of painting over the search box and clock.',
    ],
  },
  {
    at: '2026-08-01T11:15:00Z',
    title: 'Customers: last-modified column · Referred by · linked customers',
    details: [
      'The list shows when each customer was last modified (hover for by whom) — sortable like the other columns.',
      'New “Referred by” field on every customer — a customer, a person, or a channel; existing customer names autocomplete.',
      'Customers can now be linked to each other (same group, subsidiaries): add links in the editor, and the profile shows them as chips that jump straight to the linked company.',
    ],
  },
  {
    at: '2026-08-01T10:30:00Z',
    title: 'Customers: sortable column titles + manager / tier / status filters',
    details: [
      'Click Code, Name, Tier, Account Manager or Status to sort ascending; click again to flip. The order dropdown takes back over when you change it.',
      'New toolbar filters: by account manager (incl. Unassigned), by tier (incl. No tier), and by status — the “Show inactive” checkbox became a proper Active / Inactive / All selector.',
    ],
  },
  {
    at: '2026-08-01T09:30:00Z',
    title: 'Live market FX rates · tidier headers · Positioning Map readable',
    details: [
      'Exchange Rates now opens with live market rates (USD / RMB / EUR → IDR) with an “Updated” stamp — fetched automatically and refreshed hourly, next to the supplier implied rates.',
      'Supplier rate history defaults to a compact one-line view; the detailed cards are one tap away.',
      'Headers no longer repeat your email + Sign out next to the clock — the account lives in the ICAPROC menu.',
      'Positioning Map: the price axis switches to a log scale when one outlier would flatten everything, axis labels are back to a sane count, and point labels no longer overlap.',
    ],
  },
  {
    at: '2026-08-01T04:00:00Z',
    title: 'Skin circles sit on their own row under APPEARANCE',
    details: ['Cleaner and consistent on desktop and mobile — label above, the four colour circles below.'],
  },
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

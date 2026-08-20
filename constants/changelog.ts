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
    at: '2026-08-19T23:30:00Z',
    title: 'New PO cost category: Freight \u2014 and it counts towards the item cost',
    details: [
      '\u201cfreight_cost\u201d is now in the PO Costs dropdown, for freight billed separately from the supplier\u2019s invoice \u2014 the forwarder\u2019s own bill. Freight the supplier charges on the PO itself still belongs in the PO\u2019s Freight Cost field, inside the document total.',
      'It counts as landed cost everywhere that matters: the true unit cost behind Last Price, the moving-average stock cost when goods are received, and the landed-cost true-up. Only local VAT and income tax stay out of those, as before.',
    ],
  },
  {
    at: '2026-08-19T22:10:00Z',
    title: 'Two new roles: Warehouse and After-Sales Desk',
    details: [
      'Warehouse \u2014 goods in, counted and out: Stock, Receive Goods, Serial Numbers and Delivery, opening straight onto Stock. It never sees supplier prices, selling prices or the bank. Until now a warehouse login had to be Data Entry, which also opened the Purchasing catalog and every buy price in it.',
      'After-Sales Desk \u2014 service tickets, the serial register, warranty, and the customer behind the machine, opening straight onto After Sales. No pricing, no invoicing, no bank. Until now it had to be Sell-side Admin, which granted all three.',
      'Both are in Settings \u203a Users like any other role. Nobody lost anything: every role that could open After Sales still can, and the buy-side roles keep Stock and Receive Goods.',
      'Enforced in the database too \u2014 each new role can write exactly the records its job needs, and supplier costs stay buy-side.',
    ],
  },
  {
    at: '2026-08-19T20:40:00Z',
    title: 'Bahasa Indonesia for the descriptions \u2014 Settings \u203a Defaults \u203a Language',
    details: [
      'Set \u201cLanguage of the descriptions\u201d to Bahasa Indonesia and the text that EXPLAINS the app follows: the one-liners under menu entries and in search results, the page subtitles, the hints under Settings fields, and the tooltips people hover.',
      'Menu names, column headings and document numbers stay English on purpose \u2014 Stock, Deal Lookup, Landed Cost, SO, PO, GRN are the words the team already shares with suppliers and customers, and translating them would give one thing two names.',
      'Anything not translated yet simply reads in English, so nothing ever shows as blank or as a code. More Indonesian can be added later without touching any screen.',
    ],
  },
  {
    at: '2026-08-19T19:15:00Z',
    title: 'Supplier payments are buy-side only \u2014 sell-side Finance now shows money in',
    details: [
      'A sell-side login could open Finance and read every payment made to every supplier \u2014 amount, date and the account it left. Supplier payments against a purchase order are the buy price read backwards, so that is now buy-side only.',
      'Sell-side roles keep Finance for the customer receipts they record: money in, searchable, per account. Supplier payments, the Money out and Balance columns, and the untagged-movements panel are gone from that view.',
      'Bank balances are NOT shown in that view, deliberately. A balance built from receipts alone would look like the account\u2019s real position while ignoring everything paid out \u2014 a wrong number wearing the right label. The screen says so rather than leaving a blank.',
      'The dashboard follows the same line: the cash tile and the untagged-movements nudge are buy-side.',
      'Enforced in the database as well as on screen, so a direct link cannot reach what the screen will not show.',
    ],
  },
  {
    at: '2026-08-19T18:05:00Z',
    title: 'Customer list: the column titles now sit over their own columns',
    details: [
      'The tick box on each row sits outside the row\u2019s columns, but the header row had no matching space \u2014 so every title, Name included, was drawn about a tick-box\u2019s width to the left of the values under it. The header now carries the same leading space and the columns line up.',
    ],
  },
  {
    at: '2026-08-19T17:30:00Z',
    title: 'The menu no longer shows everything and then takes it away',
    details: [
      'Staff were shown the full menu at first, and a moment later the modules they cannot open disappeared one by one. The menu was treating \u201crole not known yet\u201d as permission to show everything \u2014 it now shows nothing until the role is known, so the menu fills in instead of emptying out.',
      'The wait itself is gone too: the app remembers the role from the last sign-in on that computer, so from the second visit onwards the correct menu is there on the very first frame. Signing out forgets it, and a different person signing in on the same computer never inherits the previous menu.',
      'This is only about what the menu DRAWS. Every screen still checks with the server before it opens, so a remembered role can never let anyone into a page they are not allowed to open.',
    ],
  },
  {
    at: '2026-08-19T16:10:00Z',
    title: 'Serial numbers: scan with the gun, and see at a glance what has gone out',
    details: [
      'Recording units now follows the warehouse\u2019s actual motion: pick the product once, then scan. The box takes one unit per scan, clears itself and keeps the focus, so a whole pallet goes in without touching the mouse. Each line says whether it is new, already registered, or the same label read twice. Pasting a column still works \u2014 it is the second tab.',
      'Attaching to paperwork is now a separate job, done later. Units scan into stock when they arrive; when they ship, tick them in the list, pick the sales order (and the delivery order if it is going out today) and press Attach. \u201cBack to stock\u201d undoes it.',
      'The master list says where every unit stands: In stock, Allocated (spoken for by an order, still on the shelf) or Out \u2014 with the sales order beside it. The status chips at the top filter the list to any one of them, and every column sorts.',
      'The Serial Numbers header no longer overlaps the menu bar.',
      'Item fix: eleven ICA SOLAR SNV items (SNV-GH5042 and its GF / GH / SP sister models) were flagged Cost Basis \u2192 Hidden, which keeps an item out of the EPC proposal and Surat Dukungan pickers. They are quotable again.',
    ],
  },
  {
    at: '2026-08-19T14:20:00Z',
    title: 'Serial numbers, and an After Sales desk that starts from the unit',
    details: [
      'New menu: Serial Numbers. The warehouse records the units on a delivery by PASTING the whole column off the packing list — pick the order, the delivery and the product once, paste, and the screen says what it will write before it writes: how many are new, how many are already registered, and which lines the paste repeated.',
      'A serial matches however it is typed. “SN-1234”, “sn 1234” and “SN1234” are the same unit everywhere — the register, the search box and Spotlight (type “sn 1234”).',
      'After Sales now opens BY TICKET: one row per service ticket, newest first, and every column sorts — ticket number, reported date, serial, product, customer, order, category, status. Ticket numbers already carry their date (AS-YYYYMMDD-NNNN), so sorting by ticket is sorting by day.',
      'A new ticket starts from the serial number. Type it off the label and the product, the customer, the sales order, the invoice and the delivery order arrive with it. If the same serial exists on two products, the desk picks; nothing is guessed.',
      'The old view is untouched: “By order” in the toolbar is the grouped-by-status screen exactly as it was. Which one opens by default is now a setting — Settings › Defaults › “After Sales opens on”.',
      'Products that did not come from us are finally allowed. A ticket can be marked “not bought from us”, name the product in free text, and record where and when the customer bought it — no order of ours, no warranty of ours, but a real service history.',
      'Deliveries carry an “SN” button through to the units recorded against them, and any unit in the register opens a service ticket in one click.',
    ],
  },
  {
    at: '2026-08-19T12:30:00Z',
    title: 'EPC proposals are now for project roles only — the same rule the menu shows',
    details: [
      'The EPC proposal screens used to let in anyone with the older “edit quotes” flag, which included the warehouse (Data Entry) and Finance logins even though Proposals has never appeared in their menu. They now follow the menu exactly: Owner and Engineer.',
      'The Description Library says “Owners only” to everybody else, so that is now what its door says too; the Directory stays open to project roles for reviewing duplicates, with merging and renaming still owner-only.',
      'Nothing else changed hands: sales roles never had proposal access, and the customer profile has always hidden the EPC section from them.',
    ],
  },
  {
    at: '2026-08-19T11:45:00Z',
    title: 'The menu now shows exactly what your account can open — nothing more, nothing less',
    details: [
      'A menu that offers a page you are not allowed to open is a broken menu. Access is now decided in ONE place: the menu, the search bar and the screens themselves all ask the same question, so a hidden item is genuinely closed and a visible item genuinely opens.',
      'Two things were quietly out of step and are now fixed. Search offered “Sales · Description Library” to every sell-side role although the page has always been owner-only — it is no longer offered. And several screens were hidden from people who could already use them: Invoices and Landed Cost now appear for Finance, Delivery for the warehouse roles who post the stock, and Products for buy-side admins.',
      'Nobody lost access to anything they had. If a page let you in before, it still does — the menu simply stopped pretending otherwise.',
      'A test now reads the app\u2019s own screens and fails the build if any of them starts deciding access on its own again.',
    ],
  },
  {
    at: '2026-08-19T10:35:00Z',
    title: 'Sell-side accounts no longer sign in straight into “Access restricted”',
    details: [
      'Signing in sent everyone to Purchasing, and a Sell-side Admin is not allowed to open Purchasing — so a brand-new sales account entered the right code, signed in perfectly, and was met with “Access restricted”. The account was never the problem.',
      'Sign-in now lands each role somewhere it can actually open: buy-side roles on Purchasing as before, sell-side roles on Sales, and anyone else on the Dashboard, which every signed-in role can open.',
      'The “Access restricted” screen also gained a “Go to my home page” button — “Go back” alone led straight back to the page you are not allowed to open.',
    ],
  },
  {
    at: '2026-08-19T09:40:00Z',
    title: 'Landed cost: the bills that arrive after the goods now correct the stock cost',
    details: [
      'Goods arrive before their invoices do. Receiving books stock at the costs recorded that day — usually the principal and whatever fees are in — and the freight, the duty and the final payment land weeks later. Until now nothing went back, so imports sat in stock below what they cost and every margin measured off that cost looked better than it was.',
      'Stock › Landed Cost is the going back. Per purchase order it shows what the receipt booked, what the bills now say, and the difference per item — with the new average cost each item would carry. Right now it finds 23 purchase orders and about Rp 709 million of understated cost, of which nearly all is still sitting in stock and can be recovered.',
      'The correction is split honestly: units STILL ON HAND are revalued, units ALREADY SOLD are shown separately as gross profit that was overstated, because that sale is history and cannot be re-priced.',
      '“Post true-up” writes value-only ledger entries — quantities never move, and the item’s movement history shows them as a per-unit correction rather than goods arriving. Safe to press twice: a trued-up PO drops off the list, and if another bill turns up later only the new difference comes back.',
      'The Stock screen and the dashboard action queue both carry the total, and Receive Goods now points at the true-up for the bills it knows are still coming. Corrections too small to matter are counted at the bottom of the screen instead of being dropped quietly.',
    ],
  },
  {
    at: '2026-08-19T06:15:00Z',
    title: 'Customer find & replace: whole words, and no more “Bpk..”',
    details: [
      'Replacing “Bpk” with “Bpk.” used to also hit the names already written “Bpk.” and stack another dot (“Bpk..”). When the replacement extends the search term, matches already carrying the full form are now skipped — running the same replace twice changes nothing.',
      'A “Whole words” option (on by default) makes “Bpk” match the word Bpk but never letters inside a longer word.',
    ],
  },
  {
    at: '2026-08-19T05:30:00Z',
    title: 'Customers: auto-tagged individuals, tick-to-select bulk actions, find & replace',
    details: [
      '80 customers whose names carry a person marker (Pak, Ibu, Bpk, Bp, Bapak, Sdr) and no company marker (PT, CV, UD, PD, Toko, Yayasan, Koperasi) are now tagged Individual; the other 409 stay Company. The rule was the owner’s: no marker = usually a company.',
      'Every row has a tick box, plus “Select shown” in the toolbar. Ticked rows get a bulk bar: set Company / Individual / Active / Inactive in one go — the fastest way to correct any tagging the name rule got wrong.',
      '“⇅ Replace” beside the filters is the Item Editor’s find-and-replace for customer names: find → replace-with, scoped to Display / Legal / both names, match-case optional, live before→after preview, and it applies to the SELECTED rows when a selection exists, otherwise to everything currently filtered.',
    ],
  },
  {
    at: '2026-08-19T04:30:00Z',
    title: 'Customer save crash fixed for real; New Order can no longer become a quote',
    details: [
      'The frozen “Save changes” finally confessed: customers with empty fields (imports, quick adds) crashed the save before any request was sent — “Cannot read properties of null”. Every field is now null-safe, so those customers save instantly. This was the actual cause all along.',
      'New Order mode no longer shows Validate or Sent at all — those are quotation actions, and offering them is how a direct order quietly validated into a PQ price quote. The only forward action is Confirm Order, and the mode now survives the automatic URL change after the first save.',
      'The PQ that resulted from the earlier attempt is one click from being an order: open it and press Confirm Order.',
    ],
  },
  {
    at: '2026-08-19T03:30:00Z',
    title: 'Fix: sales editor buttons could go silently dead; saves that stall now say so',
    details: [
      'If anything threw during a save or status change in the sales editor, the “busy” flag stayed on forever — Validate, Confirm Order and every other button silently ignored clicks from then on. Every action now releases the buttons no matter what and shows the actual error.',
      'The customer editor’s Save now times out after 15 seconds with “this tab looks stuck — reload the tab” instead of spinning forever when a request never leaves the browser.',
      'A draft opened via “+ New Order” is labelled “Draft order”; the DQ number is the draft’s identity — the SO number stamps at Confirm Order, as with any order.',
    ],
  },
  {
    at: '2026-08-19T02:30:00Z',
    title: '“+ New Order” button, and the real fix for stuck saves',
    details: [
      'Sales gained a “+ New Order” button beside “+ New Quote” — same editor, but Confirm Order is the primary action, so a customer who simply ordered never walks the quotation steps.',
      'The stuck “Save changes” had nothing to do with the customer form: the browser’s cross-tab auth lock could be held forever by a stale background tab, and then EVERY request from other tabs queued silently (the save never even reached the server — a fresh tab saved in under half a second). The app now uses a per-tab lock, so one wedged tab can no longer freeze the rest. If a tab was already stuck, reload it once.',
    ],
  },
  {
    at: '2026-08-19T01:45:00Z',
    title: 'Fix: saving a customer-type change no longer stalls; emoji dropped',
    details: [
      'Changing a customer between Company and Individual could hang on “Save changes” — the API layer’s schema cache didn’t know the new column yet. The cache has been reloaded (and the migration now does this itself), so saves go through instantly.',
      'The Company / Individual labels lost their emoticons — plain text in the filter, the editor toggle and the row badge.',
    ],
  },
  {
    at: '2026-08-19T01:00:00Z',
    title: 'Straight to Sales Order, plus two visual fixes',
    details: [
      'Not every order arrives through a quotation: a draft can now be confirmed as a Sales Order in one click — fill in the customer and items, hit “Confirm Order”, and the SO number stamps and stock reserves exactly as if it had walked the quote → validated → sent path. The full quote flow is unchanged for deals that DO negotiate.',
      'Fixed: on some screens the top navigation painted underneath the search field (the active group’s “· Sales Orders” suffix widened the bar). The nav no longer shrinks below its content and the suffix is capped — the search field yields space instead of overlapping.',
      'Fixed: the chips under a sales line (catalog link, live stock, lead time) now align exactly with the Product / description field above them.',
    ],
  },
  {
    at: '2026-08-14T13:30:00Z',
    title: 'Customers: companies vs individuals, and people are searchable',
    details: [
      'A customer is now either a 🏢 Company (with contact people and their positions, as before) or a 👤 Individual (the person IS the customer). The type is set in the editor — for an individual, the name fields relabel accordingly. Existing customers all start as Company; flip the few individuals as you meet them.',
      'The customers list gained an “All types / Companies / Individuals” filter, and individuals carry a 👤 badge on their row. The CSV export includes the type.',
      'People are searchable everywhere: the customers search now also matches contact names, positions, emails and phones — and Spotlight finds a company by typing its contact person (“Budi” lands on the company Budi works at).',
    ],
  },
  {
    at: '2026-08-14T12:15:00Z',
    title: 'Deal Lookup: In process leads the list; tag a quote as replaced from either side',
    details: [
      '“In process” (accepted quotes and active POs) now sits at the top of the list — the running money first, the decision pile right under it.',
      'A quote card can now be tagged from either direction: “+ replaces a quote” (this newer quote supersedes an older one) or “+ replaced by…” (pick the newer quote that supersedes THIS one). Both write the same link — the old quote is set to Replaced and shows “⤷ Replaced by …”, the new one shows “↩ Revision of …”.',
    ],
  },
  {
    at: '2026-08-14T11:30:00Z',
    title: 'Deal Lookup: the list now reads in work order',
    details: [
      'The “All” view is grouped into sections instead of one long stream: “Quotes — awaiting an answer” (no PO, not accepted — the decisions) first, then “In process” (accepted quotes and active POs), “Received — balance open” (goods in, supplier not fully paid, with the summed outstanding on the header), “Completed”, and “Void / replaced” at the bottom.',
      'An accepted quote counts as in-process even before its PO exists; a rejected or expired quote sinks to Void instead of sitting among the open ones.',
      'The stage chips still work as before — picking one shows that bucket as a flat list; in the sectioned view, column sorting applies within each section.',
    ],
  },
  {
    at: '2026-08-14T09:30:00Z',
    title: 'New Deal: Total Value and Incoterms inputs retired — the total is automatic',
    details: [
      'The deal’s total is no longer typed: it saves as line items + supplier-billed freight, and the footer now shows exactly what will be stored, live (“Items CNY 134.400 + freight 1.800 — saves as Total CNY 136.200”). A discount is entered as a negative-price line, so it stays visible as a line.',
      'Raising a PO from a stored quote no longer inherits the quote’s full total — the PO totals from the lines you actually keep in the editor (plus freight), so a partial PO is never over-stated. Revisions compute the same way.',
      'The Incoterms input is hidden with it (data kept — historical values still show in Deal Lookup; freight context lives on the supplier’s documents).',
      'Guidance for the two freight cases: freight the SUPPLIER bills (a CIF PI, or a quoted freight line like KSTAR’s CNY 1.800) goes in Freight Cost and lands in the total; freight billed by a third party (forwarder, destination charges) is logged at payment time as a landed cost instead — it is part of landed cost, not of what you owe the supplier.',
    ],
  },
  {
    at: '2026-08-14T08:15:00Z',
    title: 'Fix: editing a PO’s line items no longer erases the freight in its total',
    details: [
      'A database trigger recalculated a PO’s total as the plain sum of its line items on every line edit — so a total that rightly includes freight (like PIO-2026012’s USD 60.765) silently snapped back to items-only (57.980) the moment any line was touched. That is why the corrected total reverted.',
      'The trigger now keeps the DIFFERENCE between the stored total and the items sum across edits: change a quantity and the total moves by exactly that change, with the freight (or discount) portion intact. POs whose total equals their items sum behave exactly as before.',
      'PIO-2026012 re-corrected to USD 60.765 and verified to survive a line edit.',
    ],
  },
  {
    at: '2026-08-14T07:30:00Z',
    title: 'Deal Lookup: one basis for a PO’s value',
    details: [
      'The PO card’s headline said USD 57.980 while its IDR figure was computed from the 60.765 document total — two bases on one line. The document total now leads everywhere (it is the committed obligation, freight included when the supplier bills it), with the line-item sum shown beside it as detail: “items 57.980 + freight 2.785”. The quote card’s Total follows the same rule.',
      'Data repair: PIO-2026012’s two line items carried CNY from the old-draft bug fixed earlier today — corrected to USD.',
    ],
  },
  {
    at: '2026-08-14T06:30:00Z',
    title: 'New Deal fixes: stored quote loads clean, lines always seed, totals include freight',
    details: [
      '“Create PO” / “Revise →” from Deal Lookup now REPLACES any half-typed draft with the chosen document — header and items. Before, an old draft kept its grip until you clicked Clear draft, and mixing the two risked saving wrong values.',
      'The seeded line items are now driven by their CONTENT, not by an internal identity that a background refresh could remake — so a selected quote’s items reliably appear, a data refresh mid-edit no longer wipes your rows, and “Clear draft” with a quote selected returns to THAT quote’s items instead of stranding you with empty rows.',
      'When Total Value is left blank, the auto-filled total is now items PLUS freight — the full obligation to the supplier. (Freight was already carried onto the PO; it just wasn’t counted into an auto-filled total, which is how PIO-2026012 showed USD 57,980 in Payments instead of 60,765 — that PO has been corrected.) A typed total is still taken exactly as typed.',
    ],
  },
  {
    at: '2026-08-14T03:30:00Z',
    title: 'Products: priced items by default + PO-number hardening',
    details: [
      'The Products list now opens showing only items with a sell price set — the list is for quoting, and an unpriced item cannot be quoted. A new “Priced” checkbox (on by default) brings the rest back when you need them; “Clear ×” returns to the priced view.',
      'Hardening: PO numbers are no longer even FETCHED for sales roles on Products — they no longer appear in the browser’s network traffic, the same rule already applied to costs and brands. Buy-side roles are unaffected.',
    ],
  },
  {
    at: '2026-08-14T03:00:00Z',
    title: 'Products polish: tidier arrival hover, PO numbers gated, resizable Description',
    details: [
      'The Incoming hover is restructured — each shipment on its own two lines (quantity + date, then how the date was derived) instead of one long run-on line.',
      'PO numbers in that hover now show only to buy-side roles; a sales login sees “Shipment 1 / 2 / …” with the same dates — purchase documents are not sell-side data.',
      'The Description column is now resizable: drag the thin handle at the right edge of its header to set the width you like (remembered on your device), double-click it to return to the automatic width.',
    ],
  },
  {
    at: '2026-08-14T02:00:00Z',
    title: 'Products: pick your columns, owner-enforced visibility, arrival on hover',
    details: [
      'The Products table gained a “▦ Columns” menu — tick which columns you want (Sell Price, Stock, Incoming, Brand, Category, Capacity, Warranty, Sheet, Updated). Your choice is remembered on your device; Description always shows.',
      'Settings › Lists gained “Products columns”: columns the owner switches off there disappear for EVERYONE — they also leave the page’s Columns menu, so a personal toggle can never reveal what the owner hid.',
      'Hover the Incoming number to see when the goods should land: each open PO with its quantity and expected arrival — the supplier’s stated ETA, or the PO date plus the lead time quoted on the supplier quote (working days skip weekends), or the supplier’s measured history. Late shipments show amber.',
      'Settings › Terms gained a Lead times editor — add your own options (e.g. “120 working days”) and the New Deal form offers them; the database column was widened from a fixed list to free text to allow it.',
      'Fixed: the Description column header no longer sits on a different colour tone than the rest of the header row.',
    ],
  },
  {
    at: '2026-08-14T00:15:00Z',
    title: 'Fix: Settings › Layout now actually changes the lists',
    details: [
      'Changing the house default to Card did nothing on lists whose Compact/Card toggle had ever been clicked — each click silently pinned that list on that device forever (even clicking the option that was already active), and nothing could un-pin it.',
      'A per-list flip now lasts until the house default is next changed: flip Sales to Card and it stays Card on your device, but when the owner changes Settings › Layout, every list follows the new default again. Picking the option that matches the house default simply un-pins the list.',
      'Old permanent pins are cleared automatically the first time each list is opened — no action needed; your Card default now applies everywhere.',
    ],
  },
  {
    at: '2026-08-13T23:15:00Z',
    title: 'Item Editor: filter items by vendor / supplier',
    details: [
      'Item Editor gained an “All Suppliers” filter beside Brand — it narrows the list to the items a vendor has quoted or that were ordered from them. Because most POs carry their vendor on the linked quote, the filter resolves it there, so PO-only history counts too. The choice is remembered and shows as a clearable chip like the other filters.',
    ],
  },
  {
    at: '2026-08-13T22:30:00Z',
    title: 'Rename PO / PI numbers and link quote revisions in Deal Lookup',
    details: [
      'Click a PO number in Deal Lookup to rename it in place (guarded against clashing with an existing PO number).',
      'Click a PI / quote reference to rename it — and it updates the POs raised from that quote too, so the deal stays grouped under the new reference.',
      'Quotes now show their revision lineage like POs do (“↩ Revision of …” / “⤷ Replaced by …”), and a “+ mark as replacing a quote” link lets you point a quote at the one it supersedes right from Deal Lookup — the old quote is set to Replaced and linked, no need to open the New Deal form.',
    ],
  },
  {
    at: '2026-08-13T21:30:00Z',
    title: 'Delete redundant deals and POs from Deal Lookup',
    details: [
      'Deal Lookup can now delete the clutter: each PO card has a “Delete” action, and every deal has a “Delete deal” that removes the PI/quote and all its POs together. Both take a two-step confirm.',
      'Safety first: only records with NO payments and NO goods received can be deleted (drafts, replaced, unpaid). Anything paid or received shows “🔒 Paid / received — cancel instead”, because that money and stock history has to stay auditable. The guard is re-checked against the live database at delete time, not just in the screen.',
      'Deleting a PO removes its line items, and deleting a deal removes the quote’s items too (the database cascades those). A superseded PO’s successor is never dragged along by the delete.',
    ],
  },
  {
    at: '2026-08-13T20:00:00Z',
    title: 'PO revision, round two — Revise button, richer picker, Replaces PO',
    details: [
      'Deal Lookup: every live PO card now has a “Revise →” button that opens New Deal with that PO already loaded (header + items) — no need to find it again in the picker.',
      'The “Stored PO” picker now shows and searches by vendor, PO date, value and the PI/deal reference, not just the PO number — most POs carry their vendor on the linked quote, which the picker now resolves. Newest first, with a stable tiebreak.',
      'The PO section gained its own “Replaces PO” field (and the shared one is now clearly labelled “Replaces Quote”). Picking a PO here marks it Replaced and links it to the new PO — the declarative counterpart to loading it via Stored PO.',
    ],
  },
  {
    at: '2026-08-13T18:00:00Z',
    title: 'Revise a stored PO — amend, split, or supersede',
    details: [
      'New Deal (Quote + PO) gained a searchable “Stored PO” picker beside “Stored Quote”, sorted newest first and showing each PO’s vendor and value. Picking one loads its whole header AND its line items into the editor — no more re-typing a PO to change it.',
      'Keep the PO number and Save amends that PO in place — its line items are replaced with what the editor shows, and its payments and goods receipts stay attached. This is how you drop or change lines on an existing PO (e.g. trimming EB.42278 down to the items that stay).',
      'Change the PO number and a choice appears: “Split off” creates a new PO under the same PI while the original is left unchanged (for moving some lines into a fresh PO, e.g. PIO-2026013) — both stay in the same deal group; or “Supersede”, which creates the new PO and marks the original Replaced, linked to its successor.',
      'Deal Lookup now shows the lineage on each PO card: “↩ Revision of …” on a successor and “⤷ Replaced by …” on the one it replaced, so a superseded order is never a dead end.',
    ],
  },
  {
    at: '2026-08-13T16:00:00Z',
    title: 'In-transit goods: what’s on the water, and what’s late',
    details: [
      'Every open purchase order (ordered, not yet fully received) now has an expected arrival date — its stamped ETA when it has one, otherwise its PO date plus the supplier’s own measured lead time (average PO→goods-receipt days, falling back to the business-wide average, then 30 days).',
      'Products: each item with incoming stock shows when it should land — a muted “ETA 20 Aug” chip beside the “+N incoming” tag, or an amber “⚠ 5d late” chip when a shipment is past due and still not received.',
      'Dashboard: the “We owe” tile now carries a second line — “Rp X on the water” — the cash already paid out on goods not yet in the warehouse (the prepaid-import money that makes our payment cycle run ahead of delivery), with an overdue count when shipments are late.',
      'Dashboard action queue: a new “N POs overdue” signal for orders past their expected arrival, ranked by the money at stake, linking straight to Deal Lookup to chase the supplier.',
      'Item hub: the Incoming figure and its Overview signal now show the nearest expected arrival, turning amber when a shipment is overdue.',
    ],
  },
  {
    at: '2026-08-13T11:00:00Z',
    title: 'Deal Lookup line items: numbers finally line up straight',
    details: [
      'The edit / delete / add buttons that used to sit inside the price cells were pushing the numbers left by different amounts per row (a quote-only row got an extra button, so its price landed further left than a matched row). Those actions now live in their own column at the right of each row, revealed on hover — so the Q Qty, Q Price, PO Qty and PO Price columns are perfectly aligned in every row.',
    ],
  },
  {
    at: '2026-08-13T09:00:00Z',
    title: 'Deal Lookup: line-item columns line up, PI/PO cards are tighter',
    details: [
      'The line-items comparison no longer sprawls across a wide monitor — the four number columns (Q Qty · Q Price · PO Qty · PO Price) are fixed-width and cluster neatly beside the component name, so quote and PO figures line up cleanly instead of drifting apart.',
      'The quote and purchase-order cards are more compact: tighter field spacing, and the Committed / Paid / Outstanding figures now sit on one dense line instead of three stacked boxes — same information, less scrolling.',
    ],
  },
  {
    at: '2026-08-12T15:00:00Z',
    title: 'Deal Lookup line items: each section names its PO',
    details: [
      'When a quote is split across POs, each Line Items table now carries a header naming its PO (number, date, status, “1 of 2 POs on this quote”), so you can see which items went on which PO.',
      'A line that belongs to another PO of the same deal now reads “on EB.42278” (dimmed) instead of the misleading “← quote only” — it isn’t missing, it’s just on the other PO. The “+ PO” add button now appears only for items genuinely not ordered on any PO.',
    ],
  },
  {
    at: '2026-08-12T14:00:00Z',
    title: 'Deal Lookup: two POs off one quote read as two separate POs',
    details: [
      'When a single quote is ordered across several POs, the deal title now shows each PO as its own chip (e.g. “2 POs · EB.42277 · EB.42278”) with the quote name following — so they read clearly as two separate purchase orders sharing one quote source, not one fused label. The deal is still grouped by its quote, and the individual PO cards inside are unchanged.',
    ],
  },
  {
    at: '2026-08-12T13:00:00Z',
    title: 'Deal Lookup: PO number leads the title; splitting a quote into POs is no longer a “mismatch”',
    details: [
      'Once a deal reaches a PO, the deal title now leads with the PO number(s) — what the warehouse and finance quote back — with the quote name following in a dimmer tone. Quote-only deals (no PO yet) still lead with the quote name and keep their “+ Create PO” button.',
      'The “⚠ Mismatch” warning was firing whenever one quote was ordered across several POs, because each PO was checked against the whole quote and looked “incomplete”. It now compares the quote against ALL of its POs together — a quote split into two POs that add up is correct, not a mismatch. It still flags real problems: a component on a PO that was never quoted, more ordered than quoted, or a component duplicated on a quote. Ordering only part of a quote (a partial or in-progress order) is normal and no longer warns.',
    ],
  },
  {
    at: '2026-08-12T10:00:00Z',
    title: 'New Deal: drag to reorder the line items',
    details: [
      'On the New Deal form (Quote only and Quote + PO), each line now has a drag handle — grab it and drop a line where you want it. On phones, ▲▼ buttons on each item card move it up or down. The order you set is the order that lands on the quote and the PO.',
    ],
  },
  {
    at: '2026-08-12T08:00:00Z',
    title: 'Item Hub tabs scroll sideways only on phones',
    details: [
      'The Item Hub tab row (Overview · Purchases · Sales · …) used to rubber-band up and down on touch. It now scrolls horizontally only, and the header stats sit in a tidy two-column grid on phones.',
    ],
  },
  {
    at: '2026-08-11T16:00:00Z',
    title: 'New Deal (Quote + PO): the stored-quote items are fully editable again',
    details: [
      'When you raise a PO from a stored quote, its line items now open in the SAME full editor as a fresh deal — each row is the component picker showing the supplier model SKU (and description), and you can change items, edit the description, add new lines, adjust qty / cost, or remove a line. The old read-only “items going onto the PO” list (checkbox + qty + cost only) is gone.',
      'The PO gets exactly what the editor shows on save; the stored quote’s own line items are still never rewritten.',
    ],
  },
  {
    at: '2026-08-11T13:00:00Z',
    title: 'Receiving goods flows end-to-end — prompts, tags, cost history',
    details: [
      'Deal Lookup: marking a PO Fully (or Partially) Received now prompts the next step — “Receive goods →”, one click into the Receive page with that PO pre-selected. The status records the fact; receiving is what writes the stock and its landed cost, and now the path between the two is one tap.',
      'Products: items whose goods receipt landed in the last 14 days carry a tag — “New” (first stock ever, a brand-new product, emerald) or “New stock” (fresh arrival of a known item, blue) — and a “Just arrived” filter shows only them. Hover a tag for the arrival date.',
      'Receive Goods: the pre-filled Landed Cost/Unit now has a small clock button showing this item’s previous landed costs (date, PO, cost — from earlier booked receipts, newest first). Click one to use it, so today’s entry can be sanity-checked against history in place.',
      'Ways back: the Receive Goods page has a “Deal Lookup →” button in its header (carrying the selected PO), and the Dashboard quick actions gained Deal Lookup and Receive Goods.',
    ],
  },
  {
    at: '2026-08-11T10:00:00Z',
    title: 'Spend & Cash slims down; “Pricing” becomes “Pricing Tiers”',
    details: [
      'With Pricing, Cash Cycle and Exchange Rates now living on the Item Hub, their tabs are gone from Spend & Cash entirely — the page keeps what is genuinely portfolio-wide: Spend Overview, Cost Breakdown and the Positioning Map. Old links to the removed tabs land on Spend Overview.',
      'The Catalog menu entry “Pricing” is renamed “Pricing Tiers” — the page manages the tier ladder, floors and overrides; per-item pricing intelligence is the Item Hub’s Pricing tab. Searching “pricing”, “cash cycle”, “exchange rate” or “fx” in Spotlight now points at the right doors.',
    ],
  },
  {
    at: '2026-08-11T08:00:00Z',
    title: 'Item Hub: Pricing, Exchange Rate and Cash Cycle move in — one item, every lens',
    details: [
      'The Item Hub gained three tabs, each pinned to the item you are viewing: Pricing (the pricing-intelligence engine that lived in Spend & Cash — ideal price, pricing score, competitor band, sell-price simulator — no more searching for the item, the page IS the item), Exchange Rate (what this item’s foreign POs actually cost in rupiah: the foreign nominal vs the IDR principal paid, the implied rate per deal, realized vs estimate, newest first), and Cash Cycle (money out → goods in → sold, for this item’s POs only).',
      'Tabs renamed to plain words: Purchases (was Buy) and Sales (was Sell).',
      'In the Items list, clicking the item’s NAME now opens its hub page — no more hunting for the little ↗ symbol. Clicking anywhere else on the row still expands the cost forensics in place.',
      'Spend & Cash: the Pricing tab retired (it lives on the hub now); Cash Cycle and Exchange Rates stay as the portfolio-wide views. Old pricing links fall back to Spend Overview.',
    ],
  },
  {
    at: '2026-08-10T19:00:00Z',
    title: 'New Deal — tidier Quote + PO layout, more formulas, more carried forward',
    details: [
      'Freight Cost (and Exch Rate) now accept “=” formulas, like Qty and Unit Price.',
      'A Freight Cost typed on a quote is carried forward — it survives switching to Quote + PO, and when you raise the PO from a stored quote its freight, lead time and document folder all prefill, so you re-enter nothing.',
      'The Quote + PO form was misaligned because a few labels ran onto two lines and pushed their inputs out of row. Labels are now single-line (the full text is on hover), and the PO’s own violet fields are grouped together at the end — so the form reads “the deal, then what the PO adds”.',
      'Document URL is renamed Document Folder — it’s the link to the deal’s folder, not a single file.',
      'On phones the form stays neat: the header fields stack one per line, each item is its own numbered card, and the amount fields bring up the numeric keypad.',
    ],
  },
  {
    at: '2026-08-10T17:30:00Z',
    title: 'New Deal: a Freight Cost field, formulas in Qty & Price, and Item Editor back in Purchasing',
    details: [
      'New Deal now has a Freight Cost field in BOTH modes — Quote only and Quote + PO. The supplier quotes freight and the PO pays it, so it belongs on the quote itself; when you raise the PO, the freight carries across automatically.',
      'Qty and Unit Price on each line now accept Excel-style formulas: type “=1200*0.98” or “=500+40” and it evaluates when you leave the field — the same behaviour the sales quote editor already has.',
      'Item Editor is back in the Purchasing menu, next to New Deal — the two buy-side entry points sit together, which is where buyers look for it. The Item Hub, Market Intel and Pricing stay under Catalog.',
    ],
  },
  {
    at: '2026-08-10T16:00:00Z',
    title: 'Cleaner menu dropdowns — labels, no icons',
    details: [
      'The desktop menu dropdowns showed a small icon beside each entry, and items without their own icon fell back to a generic “home” glyph (so Item Editor and Market Intel both looked like Home). The dropdowns are now plain labels, matching the phone menu. The bottom tab bar on phones keeps its icons — those are how you tell the tabs apart at a glance.',
    ],
  },
  {
    at: '2026-08-10T15:00:00Z',
    title: 'Products: item names use the space a wide monitor gives them',
    details: [
      'On the Products list, the description column was capped at a fixed width, so a long item name got cut with “…” even on a big screen with empty space to spare. It now grows with the monitor — the full description shows whenever it fits, and only shortens when the row genuinely runs out of room.',
    ],
  },
  {
    at: '2026-08-10T13:00:00Z',
    title: 'The item screens now hang together — one center, its lenses',
    details: [
      'Catalog now leads with the Item Hub — the 360° page — followed by the item’s back-office lenses: Item Editor (the record), Market Intel and Pricing. Products stays in the Sales menu, where the sales team reaches for it. Same doors, same permissions per entry.',
      'The Hub gained a lens bar right under its tabs — “This item elsewhere”: Edit in Item Editor (new — you could see a wrong spec but had no door to fix it), Products, Stock, Deal Lookup and Profitability, each landing pre-filtered on the item you were reading. Item Editor and Profitability now accept those pre-filled links.',
      'Spend & Cash closes the ring: item names in the price-drift and top-items tables now open that item’s hub page.',
      'Spotlight: pressing → on a Customer now expands their latest sales documents (with line previews), exactly as → on a supplier expands its PI/POs. Enter opens the document.',
      'Settings › Users: the permission table’s module names caught up with the menu renames (Purchasing, Finance, Insights). Labels only — nobody’s access changed.',
    ],
  },
  {
    at: '2026-08-10T09:00:00Z',
    title: 'Every page is searchable now — and a tidier dashboard',
    details: [
      'Spotlight (⌘I) now finds every screen in the app. A few that had no menu tile — the AI assistant (“Ask”), and the Menu, Lists and Terms tabs in Settings — were reachable by URL but not by search; they’re indexed now, so typing “ask”, “menu order”, “lists” or “terms” lands you there. As always, search only ever offers a door your role can actually open.',
      'On the dashboard, the “Next best step” card and “Month in motion” were cramped in a side rail next to a short action queue, leaving an awkward gap. The queue now runs full width with those two balanced in a row beneath it — nothing floats in half-empty space.',
    ],
  },
  {
    at: '2026-08-09T12:00:00Z',
    title: 'Dashboard: the company position at a glance, and an AI next-best-step',
    details: [
      'The dashboard now opens with the position strip — the four numbers that ARE the business: Cash (what the bank accounts hold, by the same math as the /banks statements), Owed to us (every open customer invoice, with the overdue slice called out), We owe (unpaid across active POs, with “goods already received” called out — this replaces the old Outstanding KPI tile; draft/cancelled POs and POs with no recorded exchange rate are excluded rather than mis-valued), and CCC — the runway (DIO + DSO − DPO on a 90-day basis, same rule as Profitability). Each tile appears only for roles that can see its module.',
      '“Month in motion” compares this month so far against the SAME days of last month — on the 9th you compare to the 9th, never to a whole month — for what was invoiced, collected, and paid out, with the swing in percent.',
      'A “Next best step” card asks the AI what it would do next, given the position, the month’s motion and the action queue — one proposed step and its economic consequence, refreshed once a day (or on demand with ↻). It reads only the numbers this page already shows for your role, and it proposes — you decide.',
    ],
  },
  {
    at: '2026-08-07T18:00:00Z',
    title: 'Menu reorganised — a Catalog section, and Insights for the numbers',
    details: [
      'Everything about the items you trade now lives in one place — a new Catalog group: Item Editor, Products, the Item Hub, Market Intel and Pricing. The item is the pivot of the whole business, so its screens are no longer scattered between Purchasing, Sales and Analytics.',
      'Analytics is renamed Insights and holds the decision dashboards — Profitability (GP, capital allocation) and Spend & Cash (cash cycle, FX, pricing intelligence). Purchasing is now the clean buy flow (deals, payments, suppliers, stock, receiving); Sales is the clean sell flow (customers, orders, invoices, delivery, after-sales, support letters).',
      'Finance keeps its own top-level menu, for one-tap access to bank accounts and transactions. Pages and links are unchanged — nothing moved, only where they sit in the menu — and you can still reorder any of it in Settings › Menu.',
    ],
  },
  {
    at: '2026-08-07T17:20:00Z',
    title: 'Spend & Cash header no longer overlaps on the phone',
    details: [
      'The Spend & Cash page shows its own “Updated …” stamp, so the global clock and online-users dot were doubling up and colliding with the Refresh button on a narrow screen. Those two are now hidden on this page, leaving the header clean.',
    ],
  },
  {
    at: '2026-08-07T17:00:00Z',
    title: 'Pricing intelligence — the right price, and a score for how close you are',
    details: [
      'The pricing lookup (Spend & Cash) now proposes an ideal sell price and scores your current one 0–100. It’s not cost-plus: the ideal is settled between the FX-adjusted cost floor, the competitor band from Market Intel, your target margin, and demand — so the number reflects whether the market says you’re too dear or too cheap, not just whether you’re above cost.',
      'The pricing score gates the way it should: below cost scores near zero, below the margin floor is capped low, dearer than every competitor reads “overpriced”, cheaper than the cheapest reads “underpriced” (money left on the table), and sitting at target margin inside the market band reads “well priced”. Each verdict says why.',
      'Two levers you asked for: an FX-risk % that raises the floor toward what the NEXT restock will cost (so a weakening rupiah lifts the price ahead of the cost), and a demand setting (strong/normal/weak) that positions you high or low in the market band. When even the floor sits above the whole market, it’s flagged “uncompetitive” — a supply-cost problem to renegotiate, not a discount to give.',
    ],
  },
  {
    at: '2026-08-07T16:00:00Z',
    title: 'Capital allocation — where the cash earns most, and where it must not go',
    details: [
      'Profitability now answers the real question: where should the company’s cash go for the most return, and — the point in a slow market — where should it NOT go. Each item gets a capital verdict: Deploy (put cash here), Hold, Trim (don’t add, let it run down), or Divest (free the frozen cash). The verdict is gated downside-first — below cost, dead stock, obsolete or weak-return items are pulled back before any item is deployed, because a trap that happens to score well is still a trap.',
      'The headline number is GMROI — return on cash: gross margin per rupiah of stock per year (shown as “2.3×”). It’s the one figure that compares “bang for cash” across any item; sort the new Capital column by it. A summary strip totals the cash working vs the cash frozen in items you shouldn’t allocate to, and “Deploy” / “⚑ Don’t allocate” filters give you each shortlist in a click.',
      'A Defensive mode toggle switches to slow-market thinking: it raises the return bar (a staple must clear a higher GMROI and actually be due to reorder before new cash goes in) and widens the traps (weak-return held stock becomes cash to pull back) — deploy less, protect more.',
    ],
  },
  {
    at: '2026-08-07T15:00:00Z',
    title: 'A “Buy now” board on Profitability — quality meets timing',
    details: [
      'The Item Score says WHAT is worth buying; the reorder engine says WHEN. Profitability now shows both together: each item that’s due for restock carries a badge — amber “reorder” (below its reorder point) or red “● order now” (a stock-out is projected before a PO raised today would even land) — with the suggested order quantity and days of cover on hover.',
      'A new “⚡ Buy now” filter combines the two axes into a shortlist: the items that are BOTH a good trade (Core or Solid) AND due to reorder right now. That’s the “what / how much / when to buy” question answered in one click. Same reorder engine as the Dashboard’s Stock alerts.',
    ],
  },
  {
    at: '2026-08-07T14:30:00Z',
    title: 'Item Score: honest bands, plus profit-per-day-of-cash',
    details: [
      'A top band now means good in ABSOLUTE terms, not just “best of a weak category”. Two reality checks override the rank: an item selling below cost can’t be Core or Solid (its action says “fix pricing before buying more”), and stock that hasn’t moved recently can’t be Core (“clear before restocking”).',
      'Profitability adds a “GP / locked day” column — gross profit ÷ DIO, i.e. the profit each item earns per day its cash sits as stock. It’s the single truest “is this worth restocking” number; sort by it to see which items work your cash hardest.',
    ],
  },
  {
    at: '2026-08-07T14:00:00Z',
    title: 'Item Score is steadier: smoothed momentum and confidence for thin data',
    details: [
      'Momentum now reads sales VALUE against the item’s TYPICAL 90 days (a smoothed average of the prior nine months), instead of unit count against the single prior quarter — so one lumpy B2B order no longer reads as a 300% surge or crash.',
      'Thin histories are handled honestly: an item with only a sale or two has its sales-driven factors pulled toward neutral (we shouldn’t sound confident about a fluke), and its chip carries a small “~” marker — hover shows “thin sales history”. As real sales accumulate the score firms up on its own.',
      'Both screens (Items and Profitability) now compute the score through one shared engine, so a given item always reads the same score on both.',
    ],
  },
  {
    at: '2026-08-07T13:00:00Z',
    title: 'Sort items by volume and what’s trending',
    details: [
      'The Items list now has a “Vol · 90d” column — each item’s sales value over the last 90 days, the item equivalent of 24-hour volume on an exchange, with a green/red arrow for demand growth vs the prior 90 days (and a “new” tag for a first sale). Click the header to rank items by recent volume, high to low.',
      'The sort menu adds two views: “Volume · 90d (high)” for the biggest movers, and “Trending (rising volume)” which floats items that are both selling well AND accelerating — the closest thing to an exchange’s trending board. Both read off the same sales data as the Item Score.',
    ],
  },
  {
    at: '2026-08-07T12:30:00Z',
    title: 'The Item Score now shows on the Items list too',
    details: [
      'The Item Score wasn’t only meant for the Profitability screen — it now has its own column on Items (Analytics › Items), right after the name. Sort by it (or pick “Item Score” in the sort menu) to put the best items to keep buying at the top; hover a chip for the seven factor scores and the suggested action.',
      'It’s the same score, same engine and same basis as Profitability — computed across the whole catalog so the category ranking is identical on both screens.',
    ],
  },
  {
    at: '2026-08-07T12:00:00Z',
    title: 'Item Score gains a seventh factor: cash cycle',
    details: [
      'The Item Score now also weighs how fast each item turns its cash — its days inventory outstanding (stock value ÷ daily COGS). An item that sits on the shelf for months ranks below one that cycles in weeks, so the score leans toward what keeps the cash conversion cycle short. (The inventory leg is the part of the cycle an item actually drives; DSO and DPO are customer- and supplier-level and stay on the company CCC strip.)',
      'Its weight is set alongside the others in Settings › Defaults, defaulting to 15.',
    ],
  },
  {
    at: '2026-08-07T11:30:00Z',
    title: 'Item Score — one 0–100 number for “what to keep buying”',
    details: [
      'Profitability now scores every item 0–100, GuruFocus-style: each item is ranked against others in its OWN category on six factors — sales-volume share, gross margin, momentum (demand growth), lead time (shorter is better), position (is the trade already in profit) and consistency (repeat sales, cost stability, still-current model). The blend lands in a band — Core, Solid, Watch or Reduce — with a plain suggested action next to it (“keep stocked — reorder on the point”, “reduce / clear — free the cash”). A superseded item is never told to restock.',
      'The Score column sorts like the rest; hover any score to see the six factor scores and the action behind it. Two new filters — Core buys and Clear / reduce — turn the table straight into a shortlist. Every input is already measured (margin and position from delivered GP, lead time from PO→receipt, momentum from the last two 90-day windows, cost stability from receipt costs, successor from item links).',
      'How much each factor counts is yours to set in Settings › Defaults — the weights need not add to 100, and the share each carries is shown as you type.',
      'This is the first of the item-economics decision aids; “how much to buy” (order quantity from demand variability) and “when to buy” (reorder timing, FX and price momentum) build on it next.',
    ],
  },
  {
    at: '2026-08-07T10:00:00Z',
    title: 'Sort the Suppliers list by any column',
    details: [
      'Every Suppliers column header now sorts — Code, Supplier, Quotes / POs, Purchased and Outstanding. Click a header to sort by it, click again to flip ascending/descending; the arrow shows which is active. The list still opens on the biggest spender, as before.',
    ],
  },
  {
    at: '2026-08-07T09:00:00Z',
    title: 'The Chinese-yuan currency is now CNY everywhere, not RMB',
    details: [
      'Every place that named the Chinese yuan “RMB” now uses the ISO code “CNY” — the currency dropdown on quotes, POs and bank accounts, the market-rate strip, competitor-price handling and the cost calculators. Existing quotes, POs, line items and exchange-rate history were migrated in place, so nothing needs re-entering; the numbers are unchanged, only the code.',
      'A nice side effect: supplier quotes priced in yuan now share the exact code (CNY) with the live market-rate feed, so the reference rate lines up instead of sitting under two different names.',
      'PDF import still reads supplier documents that write “RMB” or “¥” and records them as CNY.',
    ],
  },
  {
    at: '2026-08-07T08:00:00Z',
    title: 'Drag to reorder the menu — groups and the entries inside each — and Finance stands on its own',
    details: [
      'The Sell menu group is now named Sales.',
      'Finance is its own section again in the wordmark dropdown and the phone’s More sheet — it had lost its heading and looked like the tail of Sales. Its heading is back, so it reads as a standalone group.',
      'Settings › Menu is now drag-and-drop: grab a group and drop it where you want, and open a group to drag the entries inside it — e.g. put Payments above New Deal in Purchasing, or Sales Orders first in Sales. Drop above or below a row to land exactly there. The arrows still work for touch and keyboard. Group order and entry order both land across the whole menu the moment you save, and Reset to default clears both. As before, a saved order can never hide a module: an entry added in a later release keeps its shipped place automatically.',
    ],
  },
  {
    at: '2026-08-07T07:00:00Z',
    title: 'The Finance menu is just “Finance”, and you can set the menu order',
    details: [
      'The Finance group held a single entry that read “Finance Banks” on the desktop bar — it now reads simply “Finance” everywhere (it still opens the bank accounts and cash position; searching “banks” still finds it).',
      'New Settings › Menu: put the daily menu groups — Purchasing, Sell, Finance, Analytics, Projects — into the order you want, with up/down arrows and a Reset to default. Home always leads and Admin (Pricing, Settings, Import & Export) always sits last, so neither moves. The change lands across the wordmark dropdown, the desktop bar and the phone’s More sheet the moment you save; each role still only sees the groups it may open.',
    ],
  },
  {
    at: '2026-08-07T05:30:00Z',
    title: 'Design the whole solar system inside the sales quotation',
    details: [
      'New “⚡ Design system” on the sales quote, next to the mounting designer: a three-step wizard — context (on-grid / off-grid / hybrid, the panel, the roof), then the PLN connection or the load table, then review. It runs the same Smart Solar BoM v7 engine the golden tests pin to the standalone calculator.',
      'On-grid: pick the PLN capacity (1300 VA – 53 kVA or custom) and the DC/AC ratio — the engine takes the largest inverter that fits the connection and sizes the array. Off-grid/hybrid: type the loads (watts, hours, qty; motors count double for surge) — the engine sizes the inverter with its 1.25× margin, the battery bank from autonomy and chemistry (DoD 80% lithium / 50% lead-acid), and the array from the sun hours.',
      'The review shows everything before anything lands: the picked inverter, battery bank (strings × series, usable kWh) and array, every structure and balance-of-system line resolved to real catalog items at this customer’s tier, live stock, string-limit and rail warnings, and the system total. Only calculator-ready, visible items are ever offered.',
      'Applying inserts ordinary editable lines stamped with a design role, so Regenerate replaces exactly what the engine created and never a hand-typed line. The wizard’s answers are stored on the quote and come back on reopen — regenerate means “same questions, current catalog”, not “start over”.',
    ],
  },
  {
    at: '2026-08-07T03:30:00Z',
    title: 'Spec proposals read battery names properly — and 76 items got their specs filled',
    details: [
      'The Spec Readiness proposals now understand how batteries are actually named: “51.2V/314Ah” reads as the 48 V bus class (the calculator sizes by bus, so a 51.2 V pack now fits a 48 V inverter instead of being skipped), “LFP2.56KWH” fills the energy directly, and “12V/7,2Ah” with a comma-decimal parses too. Energy always comes from the voltage as written, so a 51.2 V × 205 Ah rack is 10.5 kWh, not 9.8.',
      'Grid-tie phase guessing got honest: 20 kW+ units default to three-phase (nobody makes them single-phase), “3P” in a name is recognised, and mid-size unmarked units (8–20 kW) get no guess at all rather than a wrong one. An AC voltage like “220/380V” on a PCS is no longer misread as a battery bus.',
      'With the smarter reader, the standing proposals were accepted across the catalog: 76 items now carry specs straight from their names and the ICA calculator database. Batteries jump from 3/25 to 19/25 calculator-ready, inverter-chargers from 0 to 5/46. What remains is blocked on datasheet-only numbers (PV max Voc and the like) — the per-column bulk fill on Spec Readiness is built for exactly those.',
    ],
  },
  {
    at: '2026-08-07T01:10:00Z',
    title: 'The Buy menu is now PURCHASING, and its workspaces are listed by name',
    details: [
      'The menu group “Buy” is renamed Purchasing, and its five workspaces now appear directly instead of hiding behind one entry: Item Editor, New Deal, Payments, Deal Lookup and Market Intel — each opens straight on its own tab. Suppliers, Stock and Receive Goods stay in the group.',
      'Payments moves here from Finance rather than appearing twice; Finance keeps Banks. The menu highlight now follows the tab you are actually on, and the phone’s bottom bar still finds Purchasing.',
    ],
  },
  {
    at: '2026-08-06T06:40:00Z',
    title: 'Spec Readiness — the workbench that unlocks the system calculator',
    details: [
      'New screen (Analytics › Spec Readiness, or search “specs”): one row per item, one column per spec the calculator actually needs, and a progress bar per category showing how close each is to being sizeable. Today: charge controllers 46/72, on-grid inverters 8/23, PV modules 5/11, batteries 3/25, inverter-chargers 0/46.',
      'It proposes rather than asks. Blanks are pre-filled from the ICA calculator’s own database when it knows the model, otherwise read out of the item’s own name — “EPEVER ELS3K-E 3kW/48V” yields 3000 W and a 48 V bus, “DEYE SUN-5K” yields 5000 W. Proposals show dashed blue and explain themselves on hover; nothing is written until you save, because a wrong spec is worse than a missing one.',
      'Accepting the proposals takes batteries from 3/25 to 14/25 on its own. The rest are blocked by datasheet-only numbers a model name cannot carry (PV max Voc, Voc STC) — so every column has a fill-the-whole-column box: type the value once, apply it to every blank on screen. Those values are usually constant across a product family, which turns the 46 inverter-chargers into about one column of typing.',
    ],
  },
  {
    at: '2026-08-06T05:55:00Z',
    title: 'Mounting designer: only real mounting brands, and fields say who fills them',
    details: [
      'The mounting system list was drawing on every category the designer had loaded, so cable and connector brands (JEMBO, JJLAPP) appeared as “mounting systems”. It now builds from the Mounting category alone — every part this calculator sizes (rail, splice, clamps, supports, grounding) is catalogued there. Cable and MC4 are balance-of-system and belong to the full system calculator, not this one.',
      'First time you open it, the designer now starts on the MIBET MD family rather than “Any system”; your own choice still wins and is remembered.',
      'Fields now say who is responsible for them: white with a solid border = yours to fill; amber = still needed before anything can be sized (panel, dimensions, a custom rail length); dashed and dimmed with an “auto” label = filled from the catalog item or worked out by the engine (panels per row), so nobody wastes time typing into them.',
    ],
  },
  {
    at: '2026-08-06T05:30:00Z',
    title: 'Smart Solar BoM v7 sizing engine ported (on-grid, off-grid, hybrid)',
    details: [
      'The full system calculator now lives in the app as tested code: on-grid sizes the inverter against the PLN connection and the array by DC/AC ratio; off-grid and hybrid size the inverter from the load table (continuous ×1.25, inductive loads counted at double for surge), the battery bank from the inverter’s bus voltage and the days of autonomy at the right depth of discharge, and the array from daily energy ÷ peak sun hours ÷ system losses. String length and count are validated against the inverter’s real Voc and MPPT limits, and it warns when an array needs more strings than the inverter accepts.',
      'Verified the same way as the mounting engine: five scenarios were run through the HTML calculator in headless Chromium — including the exact component database it ships with — and its bills of materials are pinned as the expected values. 45 tests green.',
      'The structure is not re-derived: v7’s mounting block is v11’s, so the system engine calls the mounting engine. One set of rules, one set of tests.',
      'Not wired to a screen yet — that comes next, and needs the inverter and battery specs filled in first (today 0 of 46 inverter-chargers carry the specs a calculator can size from).',
    ],
  },
  {
    at: '2026-08-06T04:45:00Z',
    title: 'Mounting designer builds from ONE system — MIBET MD, T-slot rail',
    details: [
      'New shortlist at the top of the designer: pick the mounting system (MIBET MD, MIBET MA, SOEASY…) and the rail profile (T-slot / Symmetric). Only that family’s parts can enter the bill of materials, so a quote can never mix an MD clamp onto an MA rail. Defaults to MIBET MD + T-slot and remembers your choice; the design saves it, so a regenerate rebuilds from the same shortlist.',
      'The rail-length dropdown now offers the lengths actually on the shelf for the chosen system — MD T-slot gives 1340 / 2490 / 3650 / 4610 / 4850 / 4900 mm instead of a fixed pair — and warns if the system carries no rail in that profile. The profile filter applies to the splice kit too, since a T-slot rail takes the T-slot splice.',
      'Fix found while wiring this up: clamps are catalogued as FIT RANGES (“35-39”, “30/33”, “30-34/50”), and the resolver was matching sizes exactly — so a 35 mm panel silently failed to find the MD 35-39 mid clamp and fell back to a hand-priced line. Ranges and either/or sizes are now understood: a dash spans, a slash lists.',
    ],
  },
  {
    at: '2026-08-06T04:10:00Z',
    title: 'Sales quotations can size a system, not just list products',
    details: [
      'New “⚙ Design mounting” button on the quotation: answer the array questions (panel, how many, rows, rail length, gap, roof/ground/flat, portrait/landscape) and the ICA mounting calculator v11 sizes the whole structure — rails, joints, end and mid clamps, supports, grounding clips and lugs.',
      'The bill of materials arrives as REAL catalog items at THIS customer’s tier price, with live stock per line, before anything is inserted. A 35 mm clamp can only resolve to a 35 mm clamp; anything the catalog cannot serve lands as a clearly flagged free-text line instead of blocking the quote. Items hidden from customer-facing pickers are never offered.',
      'Panels come from the catalog by name when their specs carry dimensions (the calculator’s five ICA presets remain for modules not yet specced), so the numbers fill themselves.',
      'The engineering warnings come across too: edge spacing under 25 mm is called structurally risky, a barely-used extra rail is flagged as waste, and asking for more rows than panels adjusts itself and says so.',
      'Generated lines are tagged, so “regenerate” after changing the array replaces only the calculator’s own lines — anything you typed yourself survives untouched. The design is saved with the quotation, so next month it can still be explained.',
      'Under the hood: the engine is a line-for-line port of the calculator, and the project now has tests — 22 of them, 8 pinned to values read out of the HTML app itself, so the quote and the calculator can never quietly disagree.',
    ],
  },
  {
    at: '2026-08-06T03:20:00Z',
    title: 'Surat Dukungan prints on one page, on your letterhead paper',
    details: [
      'The letter now leaves a blank band at the top for pre-printed letterhead stock — 30 mm by default, and the print screen lets you pick 20 / 30 / 40 / 50 mm, or “plain paper” to print our own letterhead instead. Your choice is remembered.',
      'The whole document is tuned to fit a single A4 sheet, signature block included — verified at five materials and three clauses. A longer letter is scaled down automatically rather than spilling onto a second page, and the print screen tells you the fit (“Fits one page · 92%”). If it is too long even at the smallest size, it says so instead of quietly printing two pages.',
    ],
  },
  {
    at: '2026-08-06T02:55:00Z',
    title: 'Hidden items stay out of Surat Dukungan',
    details: [
      'An item set to Cost Basis → Hidden is already kept out of the Project Quote picker; it is now kept out of support letters the same way. Hidden items no longer appear in the letter’s catalog search (41 items today), and a brand disappears from the Merk suggestions once every item carrying it is hidden — COLAN, ICA and VOLTRONIC drop off, while ICA SOLAR and SOLARMAN stay because they still have visible items. A brand line reused from an older letter is dropped too if one of its brands has been hidden since.',
      'The rule now lives in one place and both screens read it, so hiding an item takes effect everywhere at once. Letters already issued are untouched — their item text is a snapshot of what was signed.',
    ],
  },
  {
    at: '2026-08-06T02:35:00Z',
    title: 'Links light up instead of underlining · Surat Dukungan remembers every field',
    details: [
      'One link behaviour app-wide (owner’s call): links brighten on hover, they never underline. The mixed treatment is gone from Sales Orders, Products, the Item hub, Purchasing, Deal Lookup, the Item Editor, Proposals and the sign-in screen — document numbers, customer names and inline links all react the same way now. Printed PDFs keep their own typography.',
      'Surat Dukungan: every repeated field now autocompletes from the letters already written — project, end user and its address, signatories and titles, place, brands, and the material rows (Nama Barang · Tipe · Garansi). Type a project you have backed before and its tender owner and address fill themselves, so backing several resellers into the same tender is one field of typing.',
    ],
  },
  {
    at: '2026-08-06T02:10:00Z',
    title: 'Fix: the customer search in Surat Dukungan would not accept typing',
    details: [
      'The customer and catalog pickers in the New Surat Dukungan form ignored what you typed — the list opened but every keystroke was wiped. The search box resets whenever its option list is rebuilt, and the form was rebuilding that list on each keystroke. Both pickers now hold a stable list, so typing filters normally. The same hardening went into the shared form renderer so no other picker can develop the fault.',
      'Same pass: clearing the customer no longer erases the company name and address already typed on the letter; the draft header shows the exact number the letter will get (“next is 002-ISL-SD-VIII-2026”); the fee field shows grouped digits; two admins saving at the same moment can no longer collide on a number; and Delete is a two-step button rather than a browser pop-up.',
    ],
  },
  {
    at: '2026-08-06T01:40:00Z',
    title: 'Surat Dukungan — support letters become a module, not a duplicated file',
    details: [
      'New sell-side screen (Sell › Support Letters): write the Surat Dukungan that backs a reseller entering a tender. Pick the customer and the standard clauses, the addressee block, the numbering and the letterhead are already there — no more opening last month’s letter and overtyping the names.',
      'Everything connects: the supported company comes from Customers (its signatory and address prefill from the CRM contact), the materials come from the item master, and each item’s Garansi is the structured warranty you set in Products or the Item Editor — a letter can no longer promise a warranty the catalog disagrees with. The handling salesperson defaults to the customer’s account manager, and the author is stamped automatically.',
      'Numbering follows the paper: 013-ISL-SD-VII-2026, restarting each January. The Rp 300.000 administration fee is tracked on the letter — one click marks it received and flips the letter to Issued, and the list can show just the ones still waiting on payment.',
      'Duplicate turns an existing letter into the next one in a click: same customer, items and clauses, empty project and end user — the only two things that genuinely change.',
      'The list is the project register: search suggests as you type (number, customer, project, end user), every column sorts both ways, and it filters by status, customer, sales, fee and date. A summary line counts the projects backed and the resellers supported.',
      'Print → Save as PDF produces the letter itself; a customer’s profile now lists the Surat Dukungan issued to them (replacing the stale “no after-sales module yet” placeholder).',
    ],
  },
  {
    at: '2026-08-06T00:55:00Z',
    title: 'Products list: every column sorts',
    details: [
      'Description, Incoming, Warranty and Sheet join the sortable columns — every header now click-sorts, and a second click flips ascending/descending (▲/▼ shows the direction). Warranty sorts by actual period length (10 years > 18 months > 90 days), items with only a legacy note group after those, no warranty last. Sheet sorts items with a datasheet first.',
      'The phone layout’s sort dropdown gains the same options, each in both directions.',
      'Header titles all sit on one baseline again: only Stock keeps its “Live/Physical” second line, and the rest of the sorting notes moved into hover tooltips.',
      '“Quote mode” is now “Text quote mode”, and the panel reads “WhatsApp text quote” — it builds a message to paste into a chat, it never creates a Sales Quotation document. The tooltips say so too.',
    ],
  },
  {
    at: '2026-08-06T00:35:00Z',
    title: 'New Deal on phones: the Items section announces itself',
    details: [
      'On desktop the column headers separate the line items from the header fields; phones had nothing — the first item card blended straight into Document URL. Mobile now gets an “Items” section title above a divider, and every card carries its own “Item 1 / Item 2” header with the remove ✕ up there instead of floating in the footer. The line total appears (labeled) only once the line has an amount.',
    ],
  },
  {
    at: '2026-08-06T00:15:00Z',
    title: 'After-sales cases carry a warranty verdict',
    details: [
      'Every case now states the answer directly: an “In warranty” / “Out of warranty” / “Partly in warranty” badge on the case row itself (compact and card layouts), computed from the linked items’ structured warranty against the delivery (or invoice) date. The badge carries the tightest clock — e.g. “In warranty · 9.8 years left”.',
      'The expanded case keeps the per-item detail: each part’s period, start date, and ✓ remaining / ✕ expired with the end date. Items without a structured warranty still show the judge-by-both-clocks note — set the warranty in Products or the Item Editor and the verdict appears.',
    ],
  },
  {
    at: '2026-08-05T23:55:00Z',
    title: 'Stock alerts on the Dashboard · New Deal is phone-friendly · smarter Item Editor filters',
    details: [
      'The Dashboard gains a dedicated Stock alerts section: Shortages (committed orders that cannot ship — red, with the waiting order numbers one click away) and Reorder points (amber, with the suggested order qty and a New PO shortcut). Same engines as /stock, so fixing it there clears it here.',
      'New Deal on phones: line rows are tidy cards — catalog + description full-width, Qty · Price · Currency on one row, line total and remove ✕ sharing the footer. The card title keeps its own line with the PDF/Clear buttons beneath, and Save goes full-width.',
      'Item Editor: the Unused filter no longer flags items that sit on an EPC proposal or a sales document — “unused” now really means used nowhere. And a new Reorder quick-filter shows exactly the items at their reorder point, with the live count on the button.',
    ],
  },
  {
    at: '2026-08-05T23:40:00Z',
    title: 'One-form New Deal · Reorder alerts · structured warranties · doc numbers open Deal Lookup · “newer version” tags',
    details: [
      'New Deal (Purchasing): header and line items are ONE card with ONE save — no more Step 1 / Step 2. Quote-only writes the quote + its lines; Quote + PO writes both documents from the same rows (price on the quote = cost on the PO). A PDF upload prefills everything, components auto-matched; a failed save keeps your typing.',
      'Stock Reorder Alerts: the Dashboard queue and /stock now warn BEFORE a shortage exists. Alert when live + incoming ≤ the reorder point = 90-day outbound demand × measured lead time (Deal Lookup’s PO → receipt number) + a safety buffer (25% of lead, min 7 days). Red = at the current rate, stock runs out before a PO raised today could arrive. Each alert suggests an order qty (lead + safety + a month of runway) with one-click paths to the item and New PO.',
      'Warranties are structured now: value + unit (Years default, Months/Days selectable), Product warranty and Performance warranty separately (PV modules: the claimable repair period vs the output guarantee). Entered in the Item Editor’s edit row or the Products expanded row; shown on Products, the item hub and CSV export.',
      'After Sales computes the warranty clock itself: each case item linked to the catalog shows its product warranty running from the delivery (or invoice) date — “✓ 8.2 years left · until 03 Aug 36” or “✕ expired 3 months ago”. No structured warranty set → the both-clocks note stays.',
      'Every Quote / PI / PO number is a link into Deal Lookup — payment status, item forensics, PO cash cycle, pricing intel, goods receipt — opening in a new tab like every document link.',
      'Superseded items say so everywhere: an amber “↑ Newer version” tag with a link to the successor appears on the item hub header, the Products list, and sales quote lines that still point at the old model.',
      'Fix: the stray scrollbar beside the item hub’s tab row is gone.',
    ],
  },
  {
    at: '2026-08-05T22:38:00Z',
    title: 'Full rupiah everywhere · GP on every Sales Order (owner) · customer links on the Sales list',
    details: [
      'Money always shows FULL digits now — no more “Rp 2,0M” or “IDR 21,55B” anywhere: Dashboard, Analytics (Items, Profitability, Position), Spend & Cash, Stock, Banks, Invoices. Where a full figure is wider than its tile the digits shrink to fit instead of wrapping or truncating, so phones show the same complete number.',
      'Owner-only, Dolibarr-style margins on the sales document: every line linked to a costed catalog item shows its est. GP and margin % (at the current moving-average landed cost), and the totals card adds Est. COGS + Est. gross profit for the whole order. Lines without a landed cost are excluded and counted, so a partial estimate says so. Other roles see nothing — the cost column is not even fetched for them.',
      'Sales Orders list: the customer name is now a link — opens that customer’s profile in a new tab; clicking anywhere else on the row still expands the preview.',
      'Fix on the way: the sales editor’s live-stock figure summed only one warehouse per item; it now sums all warehouses, matching /stock.',
    ],
  },
  {
    at: '2026-08-05T04:02:00Z',
    title: 'My Spotlight — personal search settings · who’s online, live',
    details: [
      'Spotlight gains a ⚙ settings panel (bottom-right of the palette): switch whole sections on or off — sell side, after-sales, buy side, EPC, items, pages. Personal per browser: a sell admin can keep their palette purely sell-side, and switched-off sections are not even loaded. Also there: recents on/off + clear history, and the new filter-token hint row (tap “po”, “inv”, “cust”… to learn the shortcuts).',
      'The header now shows a green “who’s online” counter next to the clock — everywhere, like the EPC proposals presence but app-wide. Click it to see each signed-in colleague and the exact screen they are on right now (“Sales · SO-20260803-0002”), and open that screen yourself with one click. Live, no refresh, built to handle 30+ concurrent users.',
    ],
  },
  {
    at: '2026-08-05T01:39:00Z',
    title: 'Sales Orders: compact really is compact on the phone',
    details: [
      'The Compact layout previously only tightened the desktop table — phones still got tall stacked cards. Compact rows are now one line on mobile too: code · customer · status · amount, with the payment bar and date waiting in the expansion. Card layout keeps the roomy stacked view.',
    ],
  },
  {
    at: '2026-08-05T01:26:00Z',
    title: 'Decimal quantities print correctly — 0.5 kg stays 0.5 kg',
    details: [
      'Quantities on printed documents were rounded to whole numbers for DISPLAY (0.5 became 1 on the PDF) even though the stored value and all totals used the real 0.5. Fixed on the EPC proposal PDF, the sales quotation/invoice print, and the Surat Jalan: whole numbers stay whole, fractions keep up to 3 decimals.',
      'Internal screens follow the same rule (customer profile’s most-ordered items, after-sales part counts). Nothing needs re-entering — existing documents already hold the exact figures; reprint and the correct quantity shows.',
    ],
  },
  {
    at: '2026-08-05T00:24:00Z',
    title: 'Drafts get their own section under the Sales Orders list',
    details: [
      'The live pipeline (PQ/SO) and unfinished drafts are no longer mixed: drafts sit in their own box below the list, with a Select-All checkbox and the Delete action in its header. The main list loses the checkbox column entirely — clean rows, aligned numbers.',
      'The Stage filter drops the Draft option (drafts always have their section); it now toggles Quote (PQ) / Order (SO) over the live list. Search and the period range still apply to drafts too.',
    ],
  },
  {
    at: '2026-08-04T23:52:00Z',
    title: 'Sales list: numbers back in column, never wrapping',
    details: [
      'Every row now reserves the draft-checkbox slot, so DQ/PQ/SO numbers align whether or not a row is selectable; the Number column widened so a code with badges never breaks onto two lines.',
    ],
  },
  {
    at: '2026-08-04T23:40:00Z',
    title: 'Sales Orders: Quoted / Ordered / Delivered totals · stage filter · draft cleanup',
    details: [
      'The period totals now read the lifecycle: Quoted (live PQs, sky), Ordered (SO onward, violet), Delivered (fully shipped, emerald) — Received left the strip (it lives in the Payment column and Invoices). All three follow the selected period and filters.',
      'New Stage filter: show only Drafts (DQ), Price Quotes (PQ) or Orders (SO).',
      'Drafts can be bulk-deleted: tick the checkbox that appears on DQ rows, then Delete → Confirm. Only drafts are selectable — a PQ/SO cannot be deleted here; to unwind an SO, revert or cancel its invoices and delivery orders first.',
    ],
  },
  {
    at: '2026-08-04T23:32:00Z',
    title: 'Lifecycle codes verified on every list',
    details: [
      'Audit of the DQ/PQ/SO codes: Invoices and Delivery lists, the After Sales case panel, Accounts Receivable rows on the customer profile, the editor’s price-history popover, and the Surat Jalan reference line now all derive the lifecycle code. Searching by PQ-/DQ- also matches on Invoices and Delivery. EPC proposals keep their own Q- numbers by design.',
    ],
  },
  {
    at: '2026-08-04T23:29:00Z',
    title: 'SQ becomes PQ — Price Quote',
    details: [
      'The quote-stage code now reads PQ (Price Quote) instead of SQ, so it can never be confused with SO even at a glance: DQ → PQ → SO. Applied across the Sales Orders list, editor, customer profile, After Sales and the printed quote (including the Ref. Penawaran line on invoices).',
      'Stored numbers are unchanged — searching an old “SQ-…” reference still finds the document.',
    ],
  },
  {
    at: '2026-08-04T23:10:00Z',
    title: 'DQ, SQ and SO each get their own colour',
    details: [
      'Document codes are colour-coded so SQ and SO can never be misread: DQ grey (unfinished), SQ sky blue (offer out), SO violet (confirmed order — same violet as the status chip). Cancelled and rejected documents fade out. Applied on the Sales Orders list and the customer profile.',
    ],
  },
  {
    at: '2026-08-04T23:03:00Z',
    title: 'Document codes follow the lifecycle: DQ → SQ → SO',
    details: [
      'A draft shows as DQ-…; validation turns it into SQ-… (Sent stays an SQ — it is a status, not a new document); confirming the order shows the SO-… number. The list, the editor header, the browser tab and the customer profile all follow. Stored numbers are untouched — the code is derived, so history and links never break.',
      'The menu entry is now “Sales Orders” (searching “sales” still finds it), and the list’s column headers sort on click — ascending, click again for descending — on Number, Customer, Status, Payment, Grand Total and Updated.',
    ],
  },
  {
    at: '2026-08-04T22:48:00Z',
    title: 'Description library: the Duplicates view explains itself',
    details: [
      'The Duplicates filter now opens with a plain-language explainer: what a near-duplicate is, what clicking “~N similar · merge” does (unify the spelling everywhere, histories join, prices never change), and when to leave rows alone.',
    ],
  },
  {
    at: '2026-08-04T10:20:00Z',
    title: 'Stored quote → PO: carried items are editable before saving',
    details: [
      'The carried-items panel is no longer read-only: untick lines, change quantities or unit costs right there — the PO receives exactly what the panel shows when you save. Partial orders and renegotiated prices no longer detour through Deal Lookup.',
      'The stored quote itself is never rewritten — it stays the record of what the supplier offered.',
    ],
  },
  {
    at: '2026-08-04T10:14:00Z',
    title: 'Comparables: link many at once · successors show direction',
    details: [
      'Adding comparable links is batch now: before you even type, the picker lists every item in the SAME CATEGORY — tap to tick as many as you want (chips stack up), search the whole catalog for the rest, one save links them all.',
      'Successor links are directional: when creating one you say which replaces which, and the linked cards show “Successor ↑” (replaces this item) vs “Predecessor ↓” (older model) instead of one ambiguous badge. Existing successor links may need re-creating in the right direction.',
      'Normalized links in a batch take each item’s Wp/kWh value right on its chip.',
    ],
  },
  {
    at: '2026-08-04T10:09:00Z',
    title: 'New Deal — the Purchase Orders tab retires',
    details: [
      'Supplier Quotes is now NEW DEAL: one form for every buy-side entry — a price quote alone, PI + PO in one save, or raising the PO for a stored quote.',
      'The Purchase Orders tab is gone. Old links land on New Deal; Deal Lookup’s “+ Create PO” and the “Raise its PO →” banner open the form with the stored quote preselected and the header prefilled — type the PO number, save.',
      'Searching “purchase order”, “supplier quotes” or “PI” in Spotlight still finds it. PO line amendments live in Deal Lookup.',
    ],
  },
  {
    at: '2026-08-04T10:03:00Z',
    title: 'Quote + PO reaches full PO parity',
    details: [
      'The violet PO section gains Incoterms, Ship Via, Freight and PO Terms (terms prefilled from Settings) — everything the old PO form asked for now lives in the one combined form.',
      'Picking a Stored Quote shows its line items immediately in a violet panel — you see exactly what will carry onto the PO before saving, no Import click needed.',
      'Mode-switch safety: a quote-only save now strips any PO fields lingering in the shared draft.',
    ],
  },
  {
    at: '2026-08-04T03:57:00Z',
    title: 'Stored quote → PO, inside the same form',
    details: [
      'Quote + PO mode gains a Stored Quote selector: pick a quote entered earlier and the whole shared header prefills, PO date jumps to today, and only the PO # is left to type.',
      'On save the quote flips to Accepted, the PO is raised, and the quote’s items carry across automatically (price → cost). Item changes? Amend the PO lines in Deal Lookup.',
      'It also warns if that quote already has a PO. No more separate PO form for processing a stored quote.',
    ],
  },
  {
    at: '2026-08-04T03:41:00Z',
    title: 'Quote modes mean what they say',
    details: [
      'Quote only: stores price quotes, full stop — no PO is ever created or written to in this mode.',
      'Quote + PO: the straight PI → PO pipeline. The quote lands as Accepted automatically (ordering against it IS accepting it), so the Status field disappears — one less thing to fill.',
      'The card titles follow the mode — “Quote + PO Header” and “Quote + PO Items” when both documents are being recorded. Drafts survive switching modes.',
    ],
  },
  {
    at: '2026-08-04T03:36:00Z',
    title: 'Quote items mirror to the linked PO — always',
    details: [
      'Line items entered for a quote now copy onto its linked PO whenever that PO has no lines yet — combined Quote + PO save, after a page reload, or via the classic Create PO → flow. Quote price becomes PO cost; a PO that already carries lines is never touched.',
    ],
  },
  {
    at: '2026-08-04T03:33:00Z',
    title: 'Quote-mode selector steady on mobile',
    details: [
      'The Quote only / Quote + PO buttons no longer wrap onto two lines on a phone — the explainer caption moves to its own line instead of squeezing them.',
    ],
  },
  {
    at: '2026-08-04T03:32:00Z',
    title: 'EPC proposals list fits the phone again',
    details: [
      'The compact rows carried fixed-width amount and date columns that overflowed a phone screen and dragged the whole page sideways. On phones the amount now sizes itself and the date steps aside; from tablet up the aligned columns are unchanged.',
    ],
  },
  {
    at: '2026-08-04T02:02:00Z',
    title: 'Quote entry: mode chosen up front, PO fields in violet',
    details: [
      'The Supplier Quote form now opens with a “Quote only / Quote + PO” selector — the choice is remembered, so your usual mode is preselected next visit.',
      'In Quote + PO mode the three PO fields wear a violet border and label, so what belongs to the PO is visible at a glance; shared fields stay standard.',
    ],
  },
  {
    at: '2026-08-04T01:36:00Z',
    title: 'Quote + PO in one save — fill the shared fields once',
    details: [
      'New “+ PO in one go” toggle on the Supplier Quote form. Off: the plain quote form, exactly as before. On: three extra fields (PO #, PO date, estimated rate) and ONE save creates the quote and its linked PO — supplier, company, currency, value and PI details copied across, PO date defaulting to the PI date unless you set another.',
      'The exchange rate auto-fills from what payments on this supplier’s past POs actually implied when left empty; IDR needs none.',
      'Step 2 items are typed once and land on BOTH documents (quote price = PO cost), with the quote↔PO link already in place for Deal Lookup and payments.',
    ],
  },
  {
    at: '2026-08-04T01:30:00Z',
    title: 'Sales: New Quote joins the toolbar · Deal Lookup columns sort',
    details: [
      'The New Quote button moved from the header corner to the start of the Sales toolbar — same position and ghost style as After Sales’ New Case.',
      'Deal Lookup’s table view: every column header (PI #, Supplier, Date, Stage, Total, Paid, Outstanding) now sorts on click — once for ascending, again to flip. Dates and amounts start biggest-first, text columns A→Z.',
    ],
  },
  {
    at: '2026-08-04T01:22:00Z',
    title: 'After-sales rows link their documents without expanding',
    details: [
      'Collapsed case rows now show the SO, invoice and DO numbers as quiet clickable links (new tab) — compact rows show one of each with a “+n” for the rest, card rows show them all.',
    ],
  },
  {
    at: '2026-08-04T01:06:00Z',
    title: 'After Sales: New Case moves left, ghost-styled',
    details: [
      'The New Case button left the header’s far corner for the start of the toolbar, restyled as a slim outlined button matching the rest of the design.',
    ],
  },
  {
    at: '2026-08-04T01:04:00Z',
    title: 'After-sales cases expand into a warranty overview',
    details: [
      'Clicking a case now expands it in place (like the Sales list) instead of jumping straight into editing: sales order, every invoice and delivery order (all linked, new tab), the items involved, and any repair quotes.',
      'Each invoice and delivered DO shows its running age — “13.4 months running” from the issue date and the delivery date — the two clocks the warranty judgement runs on. No automatic verdict: after-sales decides.',
      'Collapsed rows now say WHAT is being repaired: the subject, or failing that the items involved — no more bare “Repair” chips.',
      'Sales quote editor: the Notes/terms box now aligns edge-to-edge with the totals card.',
    ],
  },
  {
    at: '2026-08-04T00:16:00Z',
    title: 'After-sales quotes — repairs & replacements, one quote system',
    details: [
      'A case can now raise its own quotes: “+ New quote” on the case opens the full Sales Quote editor with the customer pre-selected and the quote linked to the case. It is a real sales quote — free-text lines, revisions, print, and the SO → invoice → payment pipeline for billable work all come with it.',
      'The case shows every quote raised for it (number, status, value); the quote carries an orange “Service · CASE-x” badge, and service quotes are tagged SVC in the Sales list.',
      'The Description Library has a new After-sales section for repair and component-replacement texts. Both sections feed the same item picker: on a service quote the after-sales texts (SVC) surface first, on a normal quote last.',
    ],
  },
  {
    at: '2026-08-04T00:02:00Z',
    title: 'After-sales case form: searchable pickers · items from the order',
    details: [
      'Customer and Sales Order are now searchable comboboxes (same as the Payment pickers) — type to find, instead of scrolling a 489-entry dropdown.',
      'When a sales order is selected, its own line items appear as one-click chips under Items Involved — click to log the exact item that came back, already linked to the catalog. Free search stays for anything else.',
    ],
  },
  {
    at: '2026-08-03T23:53:00Z',
    title: 'PDF upload lives in the form headers',
    details: [
      'The Upload Quote/PI PDF and Upload PI/PO PDF banners are gone. Each is now a small button at the right end of the Step-1 form’s own title row — exactly matching the items form’s Upload PDF button, so all four cards read the same.',
      'After an extraction, “✓ n items” and a Clear link appear beside the button; the explanation lives in the tooltip.',
    ],
  },
  {
    at: '2026-08-03T23:41:00Z',
    title: 'Tab titles fixed everywhere · slimmer purchasing forms',
    details: [
      'The browser tab now always names the screen you are on — “Purchasing · Supplier Quotes”, “Settings · Banks” — instead of getting stuck on “Catalog”. Every module was audited so the tab title, the menu name and the URL agree; Settings tabs now update the URL too, so any view can be bookmarked or shared.',
      'The Upload Quote/PI PDF hero card shrank to a one-line strip (both on the page and inside Step 2), and the Supplier Quote / Purchase Order forms are tighter — smaller paddings, labels and inputs — so more of the form fits on screen.',
    ],
  },
  {
    at: '2026-08-03T10:51:00Z',
    title: 'Customer profile: sleeker Edit button',
    details: [
      'Edit moved next to the customer context line (was parked at the far right) and slimmed into a bordered ghost button with a pencil icon — emerald on hover.',
    ],
  },
  {
    at: '2026-08-03T10:47:00Z',
    title: 'Sales list: fulfillment digest realigned',
    details: [
      'The expanded row now stacks SO · Payment · Invoices · Delivery as aligned rows with a fixed label column — no more chips drifting across one long line.',
      'Invoices and DOs use the same quiet link + state dot language as the customer profile, and now open their own document in a new tab.',
    ],
  },
  {
    at: '2026-08-03T10:42:00Z',
    title: 'Sales list: search finds orders by product',
    details: [
      'The Sales search box now also matches the items ON each document — type a product name (e.g. “ICA550” or “MPPT”) to surface every quote and order that carries it, alongside the existing number/customer/status matching.',
    ],
  },
  {
    at: '2026-08-03T10:40:00Z',
    title: 'Customer profile document line decluttered',
    details: [
      'The SO/invoice/DO line under each document lost its coloured boxes and repeated status words — now quiet uniform links with a small state dot (green paid/delivered, amber partial/preparing, grey unpaid). Hover for the full status and amounts.',
      'Dropped the doubled prefix (“SO SO-…”) — the document number already says what it is.',
    ],
  },
  {
    at: '2026-08-03T09:16:00Z',
    title: 'Customers can be sorted by most transactions',
    details: [
      'New “Most transactions” option in the Customers order dropdown — ranks by confirmed orders (SO onward), ties broken by total order value.',
      'While that sort is active, each row shows its order count (hover for the total value).',
    ],
  },
  {
    at: '2026-08-03T09:05:00Z',
    title: 'Customer profile: every document is a link · Sales-page status chips',
    details: [
      'In Documents & Activity, the quote/SO row, every invoice, and every delivery order (previously not shown per-DO) now open their own document in a NEW browser tab — split invoices and split shipments each get their own chip.',
      'Payment and delivery states on the profile now use the exact same title-case chips as the Sales page — “INV-… · Paid / Partial / Unpaid”, “DO-… · Delivered / Preparing” — no more ALL-CAPS mismatch.',
      'Accounts-receivable rows open the document in a new tab too.',
    ],
  },
  {
    at: '2026-08-03T08:23:50Z',
    title: 'Milestones show every document with its time · full activity log',
    details: [
      'The milestone strip now stacks EVERY invoice and delivery order under its step — “Invoice ×2”, “Delivery ×3”, one line each with its own stamp — and timestamps include the time of day.',
      'New Activity panel at the foot of every sales document: who did what, when — created, status changes, revisions, invoices created/deleted, DOs created/delivered/reopened/deleted, payments recorded/removed. Written by the database itself, so no change can slip through unlogged, and the log cannot be edited or deleted.',
      'History starts today — actions from before this update were not recorded.',
    ],
  },
  {
    at: '2026-08-03T08:04:34Z',
    title: 'Payment is a progress bar · half-shipped orders say “Partly Delivered”',
    details: [
      'The Payment column (and the expanded digest) dropped the word-chips for a slim progress bar + % — green when paid, amber when partial, red when the goods are delivered and nothing has been received. Amounts stay in the tooltip.',
      'An order with some delivery orders delivered and the rest still preparing now reads “Partly Delivered” on the list and in the editor — before, it misleadingly said “Preparing” until the last item shipped. Display only: the stored status still completes when everything is delivered.',
    ],
  },
  {
    at: '2026-08-03T08:01:47Z',
    title: 'Sales list: the number IS the link',
    details: [
      'Click the SQ number to open the document; click anywhere else on the row to expand the preview. The “Open document →” button is gone — the number underlines green on hover to say it’s the door.',
    ],
  },
  {
    at: '2026-08-03T07:45:40Z',
    title: 'Sales list: fulfillment digest in the expanded row + Payment/Delivery filters',
    details: [
      'Expanding an order now shows the whole fulfillment picture above the items: payment state with Rp received of total, every invoice with its own Paid/Partial/Unpaid chip and how much of the order is billed, and every delivery order with its Delivered/Preparing chip — including ×2 counts and “partly delivered / fully invoiced” notes for split fulfillment.',
      'Two new filters beside the sort: Payment (Unpaid / Partial / Outstanding / Paid) and Delivery (Not shipped / Preparing / Partly delivered / Delivered) — “delivered but not fully paid” is now two clicks.',
    ],
  },
  {
    at: '2026-08-03T07:42:35Z',
    title: 'Status chips read the same everywhere · doc tags count every child',
    details: [
      'All state chips now use the same style as the status pills — Paid, Partial, Unpaid, Outstanding, Expired, Delivered, Preparing — instead of a mix of ALL-CAPS badges.',
      'The SO / INV / DO tags in the editor’s top bar now come from the real child documents: two delivery orders show as “DO-… +1”, and hovering the tag lists every number. Before, only the first invoice/DO ever appeared.',
    ],
  },
  {
    at: '2026-08-03T07:29:29Z',
    title: 'Sales list: Status and Payment are separate columns',
    details: [
      '“Where is the order” and “where is the money” no longer share one crowded cell: Status keeps the lifecycle pill (and EXPIRED), and a new Payment column shows exactly one chip — PAID, PARTIAL, UNPAID, or OUTSTANDING (delivered but money open) — with the paid %.',
      'Grand Total went back to being just the number.',
    ],
  },
  {
    at: '2026-08-03T07:09:45Z',
    title: 'Delivered-but-unpaid orders are tagged OUTSTANDING',
    details: [
      'When goods have gone out but the money hasn’t fully come in, the sales list and the editor now show an OUTSTANDING badge next to Delivered — red when nothing is received, amber when partly paid, with the open amount in the tooltip. Typing “outstanding” (or “belum lunas”) in the list search finds them.',
      'Fixed: a payment a rounding-hair under 100% showed “100%” in amber with no PAID badge — paid checks now use the house half-rupiah tolerance.',
    ],
  },
  {
    at: '2026-08-03T07:07:31Z',
    title: 'Fulfillment: Invoices and Delivery each get their own box',
    details: [
      'The panel is now two side-by-side boxes — INVOICES (meter, + New Invoice, its documents) and DELIVERY (meter, + New Delivery Order, Ship from, its DOs) — instead of one interleaved list. On a phone they stack as two clean sections.',
      'Row chips slimmed to fit the narrower boxes: the box title says what the rows are, so the INV/DO badges went.',
    ],
  },
  {
    at: '2026-08-03T07:04:03Z',
    title: 'Money & quantity fields accept =formulas like Excel',
    details: [
      'The payment Amount, the invoice/DO quantity fields and the progress-% field now evaluate =formulas on blur — type =2181773/2 and it becomes the number. Same calculator as the quote lines and the EPC editor.',
    ],
  },
  {
    at: '2026-08-03T06:56:42Z',
    title: 'Payments are now applied to a specific invoice',
    details: [
      'Record Payment opens with the invoice pre-selected (the first one still owed) and the amount pre-filled with THAT invoice’s outstanding — switch invoice and the amount follows. The payment writes its invoice link, so the invoice’s UNPAID badge finally turns PARTIAL/PAID.',
      'Each payment row now shows which invoice it pays; “Whole order” remains available for money not tied to one invoice (e.g. a DP taken before invoicing).',
      'The Payments panel moved up to sit directly under Fulfillment — invoices, deliveries and money in one screenful, no scrolling past the item list.',
      'The printed invoice already counted only its own payments for the LUNAS stamp — with payments now linked, that stamp is finally fed correctly.',
    ],
  },
  {
    at: '2026-08-03T06:46:02Z',
    title: '“Set to today’s date” is always under the quote date',
    details: [
      'The button no longer appears and disappears — it sits permanently under the Quote date box, muted when the quote is already dated today.',
    ],
  },
  {
    at: '2026-08-03T06:40:25Z',
    title: 'Fulfillment panel: each side owns its button',
    details: [
      '“+ New Invoice” now sits under the Invoiced meter and “+ New Delivery Order” (with Ship from) under the Delivered meter — billing on the left, shipping on the right.',
      'All fulfillment buttons restyled to the sleek outlined language of the command bar.',
      'Reminder of what was already there: an order can carry any number of invoices and delivery orders, and both dialogs let you pick which items and quantities go on each one (set a line to 0 to leave it for later).',
    ],
  },
  {
    at: '2026-08-03T06:38:16Z',
    title: 'Sales quote: pre-set Payment terms & Delivery terms',
    details: [
      'Two new dropdowns on the quotation: Payment terms (lunas 100%, DP 20/30/50%, or 7/14/21/30 hari setelah Invoice / Surat Jalan) and Delivery terms (Di antar / Di ambil sendiri).',
      'The lists live in Settings › Terms — one term per line, edit them any time; documents keep the exact wording they were saved with.',
      'The chosen payment term prints on the quotation, the order confirmation AND the invoice (“Ketentuan Pembayaran”); the delivery term prints on the quotation and order (“Pengiriman”).',
    ],
  },
  {
    at: '2026-08-03T06:30:51Z',
    title: '“Set to today’s date” shows on every quote, and “today” means YOUR today',
    details: [
      'The shortcut under the quote date now appears whenever the date isn’t today — on any status, not only drafts (the date field was always editable anyway).',
      'Fixed: “today” was computed in UTC, so before 07:00 WIB a new quote was dated yesterday and expiry flipped a day early. New documents, the expiry badges and the dashboard check now use your local date.',
    ],
  },
  {
    at: '2026-08-03T06:19:07Z',
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
      'Exchange Rates now opens with live market rates (USD / CNY / EUR → IDR) with an “Updated” stamp — fetched automatically and refreshed hourly, next to the supplier implied rates.',
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

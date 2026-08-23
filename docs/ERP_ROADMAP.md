# ICAPROC — Distribution ERP Roadmap

> Read this first when starting an ERP-module thread. It defines the mission,
> the vision, the build sequence, the locked architectural decisions, naming
> conventions, and kickoff specs for the first two modules. Build **one module
> per thread**.

## Mission & philosophy (why this matters)

ICAPROC is not a set of forms — it is the company's bid to **own its own
operating system**. The long-term goal is a **full ERP that needs only servers
and subscriptions to run**, so the business controls its own tooling instead of
renting it.

- **Own the DATA.** Today an IT department (or an outside vendor) that holds the
  data effectively holds the business. *Whoever controls the data controls the
  business.* ICAPROC exists so ICA/PTMBS controls its own data end-to-end — every
  item, price, customer, PO, stock movement, and payment lives in **our** system.
- **Distribution is air-traffic control, and the Cash Conversion Cycle is the
  runway.** In a trading/distribution business you win by **cycling items through
  at a profit** — buy, stock, sell, collect, repeat. *The cycle is the most
  important thing.* Every module must ultimately serve the question "how fast is
  cash turning into more cash, per item?" (CCC = DIO + DSO − DPO). This is why the
  **stock ledger** and **item economics** are the spine of the whole build.
- **ICAPROC feeds the outside, too.** The same clean item/price/spec data is meant
  to feed a future **public website** and let us attach **technical specs** to
  projects and products — the internal system of record becomes the source for
  everything customer-facing.
- **AI-first operating principle.** *The old era was: we tell the AI what to do.
  The new era is: we ask the AI what it thinks we should do next.* When building a
  module, don't just transcribe a request — propose the next best step, surface the
  economic consequence, and let the human decide. Build for that posture.

Keep every module decision anchored to this: does it help us **own the data** and
**tighten the cash-conversion cycle**?

## Vision & framing

ICAPROC is becoming an **item-centric distribution ERP** (wholesale/trading),
run as two mirror-image flows:

- **Buy-side (procure-to-pay)** — Suppliers → Purchase Quote (PI) → PO →
  Payments → **Stock in**. ~70% built already.
- **Sell-side (order-to-cash)** — Customers → Product Quote → Sales Order →
  Delivery Order → Invoice → Receipt → **Stock out**. Mostly new.

**The pivot is the Stock item.** The **unit of profit is the item.** Every
target metric — GP per item / customer / rep, "which stock is already in
profit," inventory turnover, cash conversion cycle, slow movers — is computed
off a **stock movement ledger** where each unit carries a **landed cost in**
and a **sell price out**.

(The existing EPC **Project Quotes** in the `10.x` tables stay as-is — they are
a separate product line and are *not* part of this distribution flow.)

## What already exists and is reused

- `3.0_components` = **Products / stock items** (has `unit`, `category`, `brand`, `norm_value`).
- `2.0_suppliers` = vendors; `1.0_companies` = internal buying entities.
- `4.0_price_quotes` (PI) + `4.1_price_quote_line_items`; `5.0_purchases` (PO) + `5.1_purchase_line_items`.
- `po_costs` + `payment_batches` = supplier payments, bank fees, landed costs.
- `lib/computeTUC.ts` = **landed unit cost engine** — this is the buy-side cost basis for GP.
- Insights cash-cycle + spend analytics; Deal Lookup; Spotlight; `components/ui/MigrationBanner.tsx` schema-probe pattern.
- Roles in `user_profiles`: `owner` / `data_entry` / `finance` / `viewer` (`constants/roles.ts`, `ROLE_PERMISSIONS`, `allowed_emails` allowlist).

## Build sequence (one module ≈ one thread)

1. **CRM — Customers, Contacts, Sales Reps/Account Managers.** ← build first. Smallest, hard dependency for all sell-side. Spec below.
2. **Price List + Tiering.** Customer tiers, per-item tier prices, volume breaks, margin floor vs landed cost.
3. **Inventory — Stock ledger + Goods Receipt (buy-side).** The pivot. Spec below. (Stand it up on the buy-side before the sell-side draws it down.)
4. **Sell-side A — Product Quote → Sales Order** (links customer + rep + tier price; SO reserves stock).
5. **Sell-side B — Delivery Order (decrements stock) → Invoice (AR) → Receipt.**
6. **Item Economics dashboard** — GP/item, GP/customer, GP/rep; stock aging & turnover; already-in-profit stock; slow movers; **cash conversion cycle per item**. Built last; needs all flows feeding it.

CRM (1) and the Stock ledger (3) are the agreed starting points; do CRM first.

## Status (updated 2026-07-25)

**Shipped and live on main:**
- **Module 1 — CRM**: `20.0_customers` + `20.1_customer_contacts`, `/customers`
  list + edit drawer + **profile drawer** (KPIs, linked documents, AR, most-ordered
  items, EPC project quotes), CSV import/export, `sales` role, Spotlight wiring.
- **Module 2 — pricing (COMPLETE 2026-07-24)**: `21.0_price_tiers` +
  `21.1_item_tier_prices` render on `/products` (tier price matrix per item);
  per-item entry via the Catalog's Pricing Mode + per-item Tiers popover; and
  the dedicated **`/pricing`** management page (owner + sell_admin via
  `canManagePricing`; nav link is capability-gated with the new `cap` field on
  BrandMenu app entries): **Tiers tab** — CRUD the tier set (name, code,
  % off list, margin floor, reorder, active) with live counts (customers on
  tier, overrides, below-floor items); renaming a tier code migrates the
  `20.0_customers.tier` values with it. **Floor Audit tab** — every item ×
  active tier priced under the tier's margin floor vs moving-avg landed cost
  (30.1), with the economic stake ("margin at risk" = shortfall × on-hand),
  one-click "Raise to floor" (override at the compliant minimum, rounded up
  to Rp 1,000), "Clear override" when the override itself breaks an otherwise
  compliant default, and bulk raise. **Overrides tab** — all 21.1 rows with
  default-vs-override delta, GP flag, audit stamp, one-click clear. No schema
  change was needed (RLS from role_taxonomy_v2 already grants owner +
  sell_admin writes on 21.x).
- **Modules 4+5 — sell-side lifecycle (built ahead of sequence)**: `22.0/22.1`
  sales quotes with milestone flow draft→validated→sent→accepted→**ordered (SO)**→
  **invoiced (INV)**→**preparing (DO)**→delivered, revision counter, doc numbers
  stamped by trigger (SQ/SO/INV/DO/RCPT), `22.2` description library,
  `26.0_customer_receipts`, `/sales` `/invoices` `/delivery` pages, printable
  quote/invoice + Surat Jalan (DO) print, delivery details (date/method/address/
  contact). Sell-side never shows brand or supplier SKU (internal_description only).
- **Module 3 — stock ledger + GRN**: `30.0_stock_movements` append-only ledger →
  trigger-maintained `30.1_stock_balances` (moving-average landed cost; outs
  auto-priced at current avg = COGS basis; negative on-hand blocked unless the
  movement carries `allow_negative`); `30.2_goods_receipts` GRN headers
  (GRN-YYYYMMDD-NNNN by trigger); `/stock` warehouse view (on-hand, avg cost,
  stock value, last movement, per-item ledger drill via StockModal);
  `/stock/receive` receive-against-PO flow (landed-cost prefill from 6.0 PO
  costs à la computeTUC, principal×FX fallback, partial receipts tracked per
  component, advances PO to Partially/Fully Received + stamps
  `actual_received_date`). `30.1` still feeds Live/Physical/Reserved/Incoming
  on `/products`. Migration: `migrations/create_goods_receipts.sql`.
- **Vendor & customer 360**: `/suppliers` vendor profiles (purchase volume, quote→PO
  conversion, outstanding); document graph — PI/PO/SO/INV/DO numbers are clickable
  links everywhere (Deal Lookup / sales doc); EPC project quotes (`10.0`) carry
  `customer_id` → CRM (picked in the quote editor's customer autocomplete).
- **EPC**: collaborative delta-save editing with auto-merge + SENT locking; Energy
  Simulation (verified LCOE model + PLN tariffs); customer-facing print annex.
- **Platform**: grouped desktop nav + mobile bottom tabs (portaled), responsive
  width caps (wider on 2xl monitors), Tailwind CDN theme in `app/layout.tsx`.
- **Access control (hardened 2026-07-24)**: modules a role can't access are
  hidden AND unreachable — nav links are capability-gated (`cap` on BrandMenu
  app entries); every route redirects to /unauthorized on a permission miss
  (incl. the EPC print, sales prints, /catalog, /insights, /ask); the
  dashboard renders only the panels/quick-actions/fetches for the role's
  flows; the customer profile's EPC section needs the projects permission;
  and 10.x table READS are RLS-restricted to EPC-capable roles
  (owner/engineer/legacy — `migrations/epc_read_rls.sql`, mirrors
  can_edit_quote), so sell-side logins can't pull proposal data via the API.

- **Module 5B — Split fulfillment (SHIPPED 2026-07-23)**: 24.0/24.1 delivery
  orders + 25.0/25.1 invoices as child documents of the 22.0 order (spec
  below; migration `create_split_fulfillment.sql` applied + backfilled —
  legacy stamped numbers became real child rows, receipts linked via
  `invoice_id`). Order page has a Fulfillment panel (invoiced % / delivered
  meters, per-doc paid state, prints via `?inv=` / `?do=`); "+ New Invoice"
  (items-qty or %-progress) and "+ New Delivery Order" (per-line qty)
  prefill the remaining amounts so the 1:1 case stays two clicks. Each DO
  writes its own stock-outs on delivery; **everything is revertible** —
  Reopen on a delivered DO writes compensating `in` movements and steps the
  order back, and order statuses can always revert. /invoices lists real
  per-invoice AR; /delivery lists per-DO rows; reservations subtract
  delivered DO qty (lib/reservedStock.ts); Spotlight finds any child number.

- **Module 6 — Item Economics (SHIPPED 2026-07-25)**: `/economics` — GP per
  item / customer / rep, stock aging, DIO/DSO/DPO → CCC, already-in-profit
  stock, slow movers. Prereq fix: `migrations/stamp_out_movement_cogs.sql`
  (stock-outs were not carrying COGS; the trigger now prices un-costed outs at
  the moving average, backfilled).
- **Module 3b — Multi-warehouse (SHIPPED 2026-07-25)**:
  `migrations/create_warehouses.sql` — `30.3_warehouses` (G63 default, G25,
  MAIN legacy), ledger hardening (location FK, direction CHECK, qty > 0),
  atomic `transfer_stock()`, `verify_stock_balances(p_fix)`,
  `lib/warehouses.ts` weighted roll-ups, warehouse pickers + Shortages panel
  on `/stock`.
- **Module 40 — Settings (SHIPPED 2026-07-25)**: `40.0_settings` key/value
  store (owner-write, authenticated-read RLS;
  `migrations/create_settings.sql`) and **`/settings`** — owner-only, four
  tabs. **Formatting**: number punctuation, currency symbol/position/spacing
  and date style, configured SEPARATELY for internal screens and for
  customer-facing documents (live preview per panel, English/Indonesian
  presets, a guard against thousands == decimal), plus the currency code and
  a "use the symbol everywhere" switch that resolves the old buy-side `IDR
  1,234` vs sell-side `Rp 1,234` split. **Defaults**: PPN %, PO payment terms,
  margin floor, EPC cost buffer, slow-mover days, cost-drift %, default
  warehouse (edits `30.3_warehouses.is_default` — no shadow copy).
  **Company**: letterhead + bank details + footer note, printed on the
  quotation / invoice / Surat Jalan / EPC proposal. **Users**: the old
  `/admin` page absorbed (roles) PLUS the `allowed_emails` sign-up allowlist,
  so granting access is a screen instead of an SQL fix.
  Architecture: `lib/settings.ts` holds a module-level store (works outside
  React — print pages and libs read it synchronously) seeded from
  localStorage then the database by `components/ui/SettingsLoader.tsx` in the
  root layout; `hooks/useSettings.ts` re-renders subscribers;
  `lib/formatters.ts` became settings-driven with `*Doc` helpers for
  customer-facing output. DEFAULTS reproduce the previous output exactly.
  Security fixes shipped with it: `allowed_emails` had RLS enabled with NO
  policies (unreachable), and `user_profiles` UPDATE was `USING (true)` — any
  signed-in user could PATCH themselves to `owner`. Updates are now self-or-
  owner and a trigger rejects any role change not made by an owner.

- **Module 41 — Bank accounts (SHIPPED 2026-07-25)**:
  `migrations/create_bank_accounts.sql` — `41.0_bank_accounts` (owned by one of
  the `1.0_companies`: bank, account number, currency, opening balance) and
  `41.1_bank_transactions` (everything that is not already a document:
  transfers, charges, and the dated corrections an owner writes when setting a
  balance). `6.0_po_costs`, `payment_batches` and `26.0_customer_receipts`
  gained `bank_account_id`, so **/banks** ASSEMBLES each statement from the
  documents themselves — receipts in, PO payments out — instead of keeping a
  second ledger. The statement filters by any date range, is searchable, and
  carries a running balance that starts from the balance brought INTO the range
  so a filtered view still reconciles; foreign-currency payments convert at the
  rate recorded on the payment. Accounts are created in **Settings › Banks**;
  balances are corrected on /banks (owner-only, written as an adjustment row,
  never a rewrite). An "untagged movements" panel assigns historical payments
  and receipts to an account. New capabilities: `canViewBanks` (owner,
  buy_admin, sell_admin, legacy finance) and `canEditBanks` (owner).
- **Banks, second pass (2026-07-25)**:
  `migrations/bank_accounts_defaults_and_library.sql` — accounts carry
  `is_default_payment` / `is_default_receipt`, unique PER COMPANY via a partial
  index (each PT banks separately, so a single global default would be wrong the
  moment two companies are involved). `defaultAccountFor()` in `lib/banks.ts`
  resolves what a form preselects: the document's company first, then any
  flagged account. Wired into the customer-receipt modal (the quote's issuing
  company) and the supplier payment batch (when the selected POs agree on one
  paying company). Settings › Banks is now grouped into a section per company,
  alphabetical, with ▲▼ ranking inside each section, the two default toggles,
  and a "move to company" control. `41.2_bank_names` is the bank library the
  Bank field autocompletes from (seeded with the Indonesian banks in use plus
  every name already typed); a new name joins it as it is typed, and the
  library panel prunes what is unused.

- **Date filtering across the money lists (2026-07-25)**: `lib/dateRange.ts` +
  `components/ui/DateRangeFilter.tsx` — one vocabulary (this week / month /
  quarter / year, the rolling 7/30/90, last month / last year, a month picker,
  a year picker, and a free from–to range). Wired into **Sales** (on the quote
  date, with what the period is worth), **Invoices** (on the issue date — the
  AR KPIs follow the filter so a total can never contradict its list),
  **Delivery** (delivered rows on the delivery date, pending on the target
  date), the buy-side **Deal Lookup**, and the bank statement.

- **Compact vs Card lists (2026-07-25)**: `listLayout` in Settings › Layout,
  **defaulting to Compact** — dense rows, everything relevant on one line, the
  row still expands where it did before. Card keeps the roomier treatment with
  the secondary decoration inline (progress meters, milestone dots, sub-lines).
  `hooks/useListLayout.ts` resolves the effective layout per screen: the house
  default unless that person flipped THIS list, remembered in localStorage
  under the page key so flipping Sales says nothing about Invoices and never
  rewrites the owner's default. `components/ui/LayoutToggle.tsx` is the shared
  switch. Wired into Sales, Customers, Invoices, Delivery, Suppliers, Products,
  Proposals, Banks (accounts + statement) and Deal Lookup — whose older ad-hoc
  card/table toggle now IS this setting.

- **One navigation index (2026-07-25)**: `constants/navigation.ts` lists every
  destination once — href, label, group, section/capability gate, hint and
  search synonyms — and BOTH the menu (`BrandMenu`) and Spotlight are derived
  from it, so a module can never exist in one and not the other. Spotlight
  gained a **`page` kind** ("Go" badge, first tier, `go`/`page`/`open`/`nav`
  aliases) covering modules AND deep destinations that are not menu entries:
  Settings tabs, Catalog tabs, Deal Lookup, /stock/receive, the libraries, the
  proposal directory. Entries are filtered by the same gates as the nav, so
  search never offers a door that leads to /unauthorized.

- **WhatsApp quote, single or multi (2026-07-25)**: `lib/whatsappQuote.ts`
  composes the customer-facing message (document number/date profile, never a
  brand or supplier model) for ONE product or twenty, and `shareOrCopy()`
  prefers the phone's native share sheet — the direct path into WhatsApp —
  falling back to the clipboard. `/products` has a **Quote mode** switch: off,
  tapping a price copies that price (unchanged); on, tapping a price collects
  the item AT THE PRICE TAPPED, so a quote mixes tiers freely — this item at
  Tier 1, that one at Tier 2 — with no global "quote at" setting to keep in
  step. Tap the same price again to remove it, another tier to move it.
  `components/ui/QuoteBasket.tsx` is the bar + review sheet (quantities, live
  preview, Share/Copy); the list survives reloads. Totals state "belum termasuk
  PPN" on the total line itself, not only in a footnote.

- **Per-list opening defaults (2026-07-25)**: Settings › **Lists** sets how each
  list opens — its order and the period it covers — from one registry,
  `constants/listDefaults.ts`, which is also what the pages read, so a list can
  only be configured if its page honours the setting. Shipped defaults: Sales =
  newest first, month to date; Products = **most sold in the period**, this
  month; Customers = newest additions; Invoices = latest issued, all time;
  Delivery and Deal Lookup = period only. `hooks/useListDefaults.ts` resolves
  the period from its PRESET on every open, so a saved "month to date" always
  means the month the page is opened in. Anyone can still re-sort or widen a
  list; that choice simply isn't saved over the house default.
  Sales, Invoices and Customers gained sort controls to make this real, and
  Products gained a period filter plus a period-scoped "most sold" measure
  (committed sale lines by order date). `lib/dateRange.ts` gained `mtd` and
  `ytd` presets.

- **Dashboard: action queue + one activity stream (2026-07-27)**: the dashboard
  used to answer "what happened?" five times over — five parallel *Recent X*
  feeds, all buy-side, none of which said what to do. It now opens with
  **Needs you today**, ranked by MONEY AT STAKE rather than recency, because a
  five-day-old Rp 300M blockage matters more than this morning's Rp 2M one.
  `lib/dashboard.ts` derives five signals, each from the owning module's own
  tables so a fix made there clears the row on the next load: confirmed orders
  that cannot ship (committed demand less delivered DO quantities against
  `30.1_stock_balances` — the same rule as /stock Shortages), invoices past the
  overdue threshold with an outstanding balance, quotations sent with no answer,
  received-but-unpaid POs (`PRINCIPAL_CATS`, rounding dust ignored), and bank
  movements nobody tagged to an account. Each block is independent — one failing
  costs its own row, not the queue. Signals only appear for what the role can
  act on (`sellSide` / `buySide` / `canViewBanks`).
  The five feeds collapsed into **one recency-sorted activity stream** across
  sell, buy and EPC, so a sales document no longer hides behind a wall of
  purchase orders — and the space that freed is what pays for the queue.
  Two new settings under Defaults › Sell side drive the thresholds:
  **`arOverdueDays`** (30) and **`quoteFollowUpDays`** (7).

- **Trade History Analysis / Position (2026-07-27)**: `/economics` gained a
  **Position** tab — the trader's view of a stock item, inspired by how an
  exchange shows an open position after partial sells.
  `Position Cost = Σ purchases − Σ invoiced` (all time), `Avg Position Cost =
  Position Cost ÷ Position Qty`. Equivalently `WAP − (realized GP ÷ remaining
  qty)`: every rupiah already banked lowers the break-even on what is left.
  This is a **recovery threshold, never a cost** — `30.1.avg_cost_idr` remains
  the only inventory valuation, and the screen says so on its face.
  Locked bases, each of which silently biases the number otherwise:
  **received** basis (so Position Qty reconciles to the warehouse; goods on the
  water are reported separately as in-transit); purchase value from the
  movement ledger's `unit_cost_idr`, which is already LANDED with creditable
  PPN Masukan / PPh 22 excluded; sales value from `25.1.line_total`, NET of
  PPN; **all time, always** — a date range would count sales of units bought
  before the window. Negative Position Cost is not blanked, it is badged
  **Recovered / free carry** with the surplus already banked, because that is
  the best news on the page. Added beyond the original spec: a mark-to-market
  block — `Position Value − Position Cost`, which is identically the whole
  realized + unrealized P&L of the item, since realized profit already sits
  inside Position Cost. `lib/tradePosition.ts` +
  `components/economics/PositionPanel.tsx`.

- **Import & Export / Dolibarr cutover (2026-07-27)**: `/data` — bulk CSV in and
  out for the six entities that carry the commercial record, in dependency
  order: **customers → contacts → orders → order_lines → invoices → receipts**.
  The design rule is that an EXPORT of an entity is a valid IMPORT of the same
  entity: one field list (`lib/dataPorting.ts`) generates the templates, the
  header auto-mapping and the export columns, so they cannot drift, and you can
  export → fix in Excel → re-import.
  **Idempotent**: every row carries `external_ref` + `external_source`, and a
  partial unique index on the pair turns a re-import into an UPDATE. Rows
  created inside ICAPROC leave both NULL and are never touched.
  **Rehearsable**: import is choose → check → commit. The dry run reports, per
  row, what will be created / updated / skipped and why, separating fatal rows
  from warnings; nothing is written until it passes. Rows commit individually,
  so 2 bad rows cannot cost you the other 998. `40.1_import_batches` keeps the
  audit trail (who, what file, how it landed).
  Header matching is forgiving and knows the Dolibarr column names
  (`nom`, `fk_soc`, `total_ht`, `datec`, `rang`…); statuses accept ICAPROC
  words, synonyms, or Dolibarr numeric codes — an unrecognised status falls to
  `draft` and says so, never to a committed status that would reserve stock
  that was never sold. `copy_lines` on an invoice copies the order's lines at
  their order prices, which is what makes invoiced QUANTITY visible to the
  Position tab.
  **Deliberately not done**: importing an order does not write stock movements.
  The `30.x` ledger already holds the real receipt history and replaying
  historical deliveries would double-count against it — migrated orders are
  documents, restoring who bought what, when, at what price.
  Import is owner-only (`canManageUsers`); export follows `canExportCsv`.

- **Spotlight in the nav bar (2026-07-27)**: Spotlight had three behaviours for
  one feature — a hero on the dashboard, a floating bottom-right pill on
  desktop elsewhere, and **nothing at all on phones** (the pill was
  `hidden md:flex`). It now lives in `BrandMenu`, which every page already
  renders, so a new screen cannot ship without it: an icon beside the caret
  below `lg`, and above it the REAL search field — the inline variant, whose
  results drop straight out of the bar. Clicking a search box and being handed
  a different search box in the middle of the screen is a small betrayal, and
  it happens on every single search, so the field you click is the field you
  type into. The centred overlay survives only as the PHONE presentation,
  where a header field would be far too cramped; `hooks/useIsDesktop.ts` hands
  ⌘I to exactly one of the two so the shortcut can never focus a hidden field
  and open an overlay at the same time.
  The field grows with the viewport (capped 420 / 560 / 680px at lg / xl /
  2xl) while its LEFT edge stays anchored, so the target never moves.
  Placed directly after the nav groups rather than floated right, so its
  position is fixed by the ROLE (whose nav never changes) instead of by
  whichever buttons a page happens to carry. The trigger only fires
  `icaproc:spotlight`; the palette stays mounted once by `GlobalSpotlight`, so
  there is still exactly one ⌘I handler and one index.
  Retired with it: the floating pill, the `raisedPill` hack that existed
  because the EPC editor's bottom bar covered it, and the dashboard hero — the
  action queue now leads that page. Deliberately NOT merged with the per-list
  search bars: Spotlight navigates across entities, a list bar filters what is
  in front of you, and merging them would mean typing a customer name on
  Products either silently filters or throws away your filter state.
  Header rows on Stock, Delivery, Suppliers, Invoices, Sales editor, Sales
  library and the dashboard now wrap on phones — Stock's two `whitespace-nowrap`
  buttons had been overflowing the row and printing on top of the wordmark.

- **FX on quote-only costs (FIX 2026-07-27)**: `computeTUC` converted supplier
  price-quote lines at a **hard-coded** `{ USD: 16000, CNY: 2200 }`. A quote
  line carries no exchange rate of its own, so any item with a PI but no
  settled PO — every new import — was costed at that constant. Against the
  realized rates the business actually pays (newest settled: **USD 16,900**,
  **CNY 2,327**) that understated cost by **5.3% / 5.5%**, which almost exactly
  cancelled the 5% EPC Cost Basis buffer: the safety margin was buying nothing.
  `fxFromHistory(pos, settledRates)` now builds the map, ranked by **DATE**
  with source only as a tie-break. The first attempt ranked settled rates
  first and was itself 3 months stale: settlement lags ordering by months
  (`deriveExchangeRates` only counts POs with a principal payment), so
  "newest settled" was April's **16,900** while the business was already
  ordering at **18,025** (PIO-013, 7 Jul) and CNY **2,658** (PIO-014, 9 Jul).
  Pricing today's quotes off last quarter's rupiah is the whole error, so a
  rate COMMITTED to on a live PO now outranks an older rate actually paid.
  Draft and Replaced POs are excluded — a Draft is a scratchpad. Both the EPC
  editor and the proposals list's cost-drift check pass the map, so they agree.
  The price-history hover prints the conversion, its provenance and its age
  (`USD 5,800 @ 18,025`, hover: which PO and when), and turns amber past
  `FX_STALE_DAYS` (90) — a converted cost nobody can audit is how a stale rate
  hides for months, which is exactly how this one survived two rounds.

- **Duplicate a proposal as a revision OR a new quote (2026-07-28)**: the
  duplicate modal hard-coded `-REV`, but a copy is not always a revision —
  re-quoting the same scope for a different customer, or reviving a job a year
  later, is its own commercial document and should not inherit someone else's
  lineage. The modal now asks: **Revision** (same job, next version) or
  **New number** (a separate quote, `Q-YYYYMMDD-XXXX` from the same generator
  `New quote` uses), with a live preview of the resulting number.
  `nextRevisionNumber` also fixes repeat duplication: `-REV` → `-REV2` →
  `-REV3` instead of the old `Q-…-REV-REV`. The number stays free text in the
  editor either way.

- **Module 27 — After Sales (2026-07-28)**: `/aftersales` turns the service
  history that lived in WhatsApp threads into CASES — attached to the customer
  (`20.0`), the sales order (`22.0`) and the catalog items involved (`3.0`),
  so failure counts can roll up per product and support cost per customer
  stops being a guess. `27.0_aftersales_cases` (AS-YYYYMMDD-NNNN by trigger;
  category warranty / repair / replacement / maintenance / complaint /
  inspection / other; lifecycle open → in progress → waiting parts → resolved
  → closed, with `resolved_at` stamped and cleared by the status trigger) +
  `27.1_aftersales_parts` (per-item action: replaced / repaired / inspected /
  returned / missing, linked to the catalog but keeping its text so history
  survives a catalog edit) + `27.2_aftersales_updates` (the dated log).
  Page: status-sectioned list (open work first), category filter chips,
  search across case / customer / order / item, compact-vs-card via the house
  Layout setting, portaled editor with customer → order narrowing (picking an
  order back-fills the customer), catalog datalist for parts, and the update
  timeline. Sell-side rules hold: internal descriptions only, never brand or
  supplier model; writes gate on `canEditSalesDocs`, RLS mirrors the sales
  documents (owner / sales / sell_admin / engineer write).
  Deliberately NOT done: a replaced part does not write a stock movement —
  silently mutating the ledger from a log entry is how ledgers stop being
  trusted. Warranty issue-from-stock is a follow-on with its own explicit
  step. Migration `migrations/create_aftersales.sql`, verified live with a
  rolled-back TEST_OK.

- **Economics is owner-only + visible permission matrix (2026-07-28)**:
  `/economics` (both tabs — Profitability AND Position) moved from
  `canManagePricing` (owner + sell_admin) to a new **`canViewEconomics`**
  capability held by **owner alone** — the screen is the whole P&L in one
  place, and pricing admins manage tiers on `/pricing` without seeing it.
  The nav/Spotlight entry follows the same cap, so the door disappears rather
  than locking. Settings › Users gained **"What each role can see and do"** —
  a role × capability matrix rendered straight off `ROLE_PERMISSIONS` through
  `PERMISSION_MATRIX` (labels grouped Modules / Can edit / Sensitive data /
  Administration), so the table people read IS what the code enforces and
  cannot drift into flattery. Known limit, noted in-thread: page gates are UI
  enforcement; RLS on cost tables still allows broad authenticated reads.

- **Sell-side cost leak closed + role panels synced (2026-07-28)**: `/products`
  fetched `30.1.avg_cost_idr` it never rendered — the landed cost of every item
  reached the browser's network tab for sell-side logins. The column is out of
  the select (the roll-up there only feeds Physical qty). The bigger fix — RLS
  that stops non-pricing roles reading cost columns at all — remains open.
  Settings › Users: the account role (`user_profiles`) and the allowlist role
  (`allowed_emails`) are one person in two rows, but only "Grant access" kept
  them in step — promoting someone in the Users panel left the allowlist
  showing the invite-time role forever (Abel/Budi showed Project Engineer on
  top, "Data Entry (legacy)" below). Both dropdowns now write both rows —
  changing an allowlisted role updates the existing account too, exactly as
  the header always promised (your own row excepted, so an owner cannot
  demote themselves from the allowlist panel) — and
  `migrations/sync_allowlist_roles.sql` healed the two drifted rows live.

- **Module 28 groundwork — spec schema + catalog spec seed (2026-07-29)**:
  the foundation for the System Designer (see kickoff spec below).
  `lib/specSchema.ts` is the CONTRACT for `3.0_components.specifications`:
  canonical key vocabulary, category-aware alias normalisation (Jinko
  `peak_power_wp` → `power_stc_w`, EPEVER `rated_power_kw` → W ×1000, per-
  category meanings of `battery_voltage_v`…), numeric coercion, battery
  `energy_wh` derived from V × Ah, and `model`/`brand`/prices STRIPPED — those
  are columns, and a spec blob free of them stays safe for customer-facing
  annexes. `specReadiness()` judges per category whether an item carries
  every key its sizing engine needs; the Catalog spec sheet shows a
  calculator-ready / missing-keys banner and the specs icon tints
  emerald/amber to match. `BOM_ROLES` + `BOM_ROLE_PARAMS` define the generic
  mounting/BoS vocabulary (rail + length, clamps + thickness, roof_hook +
  roof type, cable + cross-section…).
  Seeds (both idempotent, existing keys always win over the seed, re-running
  after adding catalog rows fills them): `migrations/seed_component_specs.sql`
  — 282 datasheet entries matched by model-code TOKEN inside supplier_model
  (separator-insensitive) → 69 rows landed specs (46 charge controllers, 8
  on-grid inverters, 6 inverter-chargers, 5 batteries, 4 PV modules);
  `migrations/seed_bom_roles.sql` — name-pattern role tagging → 67 parts (17
  rails 800–5800mm, 6+6 mid/end clamps, 6 joints, 6 roof attachments, 18 PV
  cables, MC4s, grounding). Calculator-ready now: 4/10 PV modules, 8/23
  on-grid, 46/72 controllers, 3/25 batteries, 47/66 mounting, 18/18 cable —
  and 0/41 inverter-chargers: the fully-specced SNV hybrids are mostly not
  catalog items, and the stocked Voltronic/EPEVER hybrids need datasheet
  extraction. That extraction is the #1 data task before the off-grid
  calculator can run.
  Specs are VIEWED and EDITED in the Catalog: the document icon on a row
  opens the spec sheet (icon appears for every calculator-relevant category
  even when empty, emerald/amber by readiness), and "Edit/Add specs (JSON)"
  in the sheet saves through the same normaliser as the seed — pasted
  datasheet JSON lands canonical, and brand/model/prices are stripped.

- **Catalog CSV export: pick your columns (2026-07-29)**: the export was 11
  hard-coded columns, so anyone who wanted three of them edited the file
  afterwards. `EXPORT_FIELDS` in `ComponentEditor` is now a registry of the
  19 columns the export CAN produce (Identity / Usage / Cost & price /
  Technical), each with the getter that reads the maps the table has already
  computed — nothing is recalculated for export. The CSV button became a
  split button: click it to download, the caret picks columns (All / Reset,
  remembered per browser in localStorage, unknown keys dropped on read so an
  old selection can't resurrect a removed column). Output always follows
  REGISTRY order, not tick order, so the same selection always produces the
  same file. **The default selection reproduces the previous 11 columns
  byte-identically** (verified mechanically, per the no-silent-output-change
  rule). New opt-in columns: Unit, Capacity, Last Activity, Last Quote Date,
  Landed Cost IDR, Warranty, Datasheet URL, and **Calculator-ready**
  (yes / n/a / "missing: …" straight from `specReadiness`) — that last one
  makes the Module 28 spec backlog a spreadsheet you can work through.

- **Light mode (2026-07-29)**: the app can be read in a bright room. Dark
  remains the default and is **pixel-identical** to before — an install where
  nobody touches the switch sees no change.
  The mechanism is one idea: `app/layout.tsx` already remapped Tailwind's
  colour scales, so making those scales **CSS variables** (`constants/palette.ts`,
  generated by `scripts/generate-palette.js`) turns a theme switch into a
  single `data-theme` attribute on `<html>` — ~4,200 class sites re-skin at
  once, with **zero component edits** and no re-render. Colours are stored as
  rgb CHANNEL triplets and consumed as `rgb(var(--c-x) / <alpha-value>)`, which
  is what keeps the app's heavy use of `bg-slate-900/60` working; verified by
  compiling the real config before writing any of it.
  **Light is derived, not hand-drawn**: each ramp is read from the other end
  (step 50 takes 950's value, and so on). That works because the app uses HIGH
  steps for surfaces and LOW steps for text — flip the ramp and surfaces go
  light while text goes dark, in one move, hue intact. `white` flips with them
  (it is the emphasis ink `text-white` ×602 and the `bg-white/10` overlay,
  never a literal page colour). Three deliberate corrections to the mirror:
  slate 950/900/800 are pinned so cards read as lifted off the page rather
  than recessed into it (mirroring alone inverted that), and `shadow-black/*`
  is softened, since a shadow tuned for a dark canvas is a grey smudge on a
  light one. **Nothing in the light theme is pure white** — surfaces sit at
  #f8f9fa over a #eaecef page, because a full-screen #fff at monitor
  brightness is what makes a light UI tiring to read all day.
  Also fixed on the way: ~125 sites used literal hex (`bg-[#0f1012]`), which
  cannot follow a theme; they are now named surface tokens (`bg-chrome`,
  `bg-canvas`, `bg-sunken`, `bg-raised`, `bg-rail`, `bg-deep`, `bg-navy`,
  `bg-moss`) whose dark values are the exact hex they replaced.
  The switch is in the nav menu under **Appearance** (with the account, not in
  Settings — the theme is a personal choice, stored per browser in
  localStorage, not a company default). A tiny inline boot script applies the
  stored choice before first paint, so there is no flash of the wrong theme.
  Customer-facing print pages use their own raw CSS and are untouched by any
  of this.

- **Two more skins + a company default (2026-08-01, owner's ask)**: the office
  runs lower-end monitors where the two originals sit at the extremes — near-
  black smears on cheap panels, and a cool white glares at office brightness.
  Each extreme now has a gentler sibling, derived in the same generator:
  **Dim** (dark with the deep blacks lifted to graphite — only the surface end
  of slate and the surface tokens move; inks and accents untouched) and
  **Paper** (light with warm cream neutrals — the classic all-day reading
  surface; accent ramps stay the light ones so statuses keep their meaning).
  The nav-menu Appearance switcher offers all four; the personal choice still
  lives in localStorage. NEW: **Settings › Appearance** sets the
  **company-wide default** (`defaultTheme` in `lib/settings.ts`) — what a
  browser with no personal choice shows. `SettingsLoader` caches it under
  `icaproc_theme_default` so the pre-paint boot script resolves
  personal → cached default → dark with no flash; a personal pick always wins
  over the default (this supersedes the 2026-07-29 note that the theme was
  personal-only). Type is `ThemeName` in `constants/palette.ts`; theme
  metadata (labels, blurbs) lives in `lib/theme.ts` `THEMES`.

- **Navigation: names that say what they are, groups that match the work
  (2026-07-29)**: the menu had grown names that described the code rather than
  the job. Renames — **Catalog → Purchasing** (the screen is procure-to-pay:
  supplier quotes → POs → the component master; "catalog" was competing with
  Products for the meaning "the item list"), **Insights → Spend & Cash** and
  **Economics → Profitability** (two analytics screens, both vaguely named,
  both computing cash-cycle numbers — the names now say which question each
  answers: what did we SPEND, what did we EARN). Every old name survives as a
  search KEYWORD, so typing "catalog" or "economics" still lands you there.
  Regrouped from Home/Buy side/Sell side/Cash/Projects/Admin to
  **Home · Buy · Sell · Money · Analytics · Projects · Admin**:
  · **Money** was a group of one (Banks) while the cash work was scattered —
    supplier payments were buried in a Purchasing TAB. Payables moved here;
    the money side of a PO is a treasury job, not a procurement one.
  · **Pricing** moved out of Admin into Sell. Tiers and the floor audit are a
    daily commercial tool; filing them beside Settings framed them as setup.
  · **Receive Goods** was `inNav: false` — search-only — although booking
    goods in is a daily warehouse job and the moment landed cost enters the
    system. Promoted to a real entry.
  · **Analytics** and **Money** span both flows, so they take the neutral
    accent instead of inheriting sky/emerald from whichever destination
    happens to be listed first — colouring them would claim a side they
    don't have.
  Page titles and header subtitles were renamed with the menu, so a screen
  never contradicts the door you came through.
  **Indexing defect fixed with it**: `27.0_aftersales_cases` was queried ZERO
  times by Spotlight — Module 27 shipped a case number nobody could search
  for. Cases are now a first-class kind (`Case` badge, aliases
  `case`/`as`/`service`/`warranty`/`garansi`/`klaim`/`rma`, searchable by
  number, customer, category and subject). The "one navigation index" rule
  covered PAGES; nothing enforced it for ENTITIES — **a new module must now
  add its entity to `CommandPalette` as part of its definition of done.**

- **Module 29 — The Item hub (SHIPPED 2026-07-30)**: the pivot of the system
  finally has a home — **`/items/[componentId]`**, one page per stock item,
  with **`/items`** as the neutral master list (Products and Purchasing stay
  as the task lists and now link INTO the hub). Six tabs, each rendering the
  EXISTING engine of the screen that owns the number — compose, don't fork:
  **Overview** (cover = live ÷ 90-day monthly sold rate, days since movement,
  GP% at current price, and an open-signals list derived from each owning
  module's own rule: negative on-hand, committed-short, below-floor tiers,
  slow mover vs the Settings threshold, no sell price, incoming); **Buy**
  (`computeTUCMap` headline/latest/avg TUC, PO lines with **measured lead
  time** per received PO (PO date → `actual_received_date`, avg + range),
  PI history converted at `fxFromHistory` rates with provenance hover and the
  90-day stale-FX amber); **Sell** (`computeTierChain` with overrides, the
  /pricing floor rule per tier for `canManagePricing`, customers who buy it,
  last orders/deliveries linking to /sales); **Stock** (per-warehouse 30.1
  balances each at its own moving average, Physical/Reserved/Live with the
  split-fulfillment reserve rule, the 30.0 ledger); **Specs** (SpecRenderer +
  readiness banner + the same normalizeSpecs JSON editor as the Catalog);
  **Economics** (owner-only: all-time realized GP on the delivered-DO basis,
  GP by customer for this item, 365d turns, ageing bucket, and the trade
  Position rendered by the SAME `PositionDetail` blocks as /economics —
  exported from PositionPanel rather than copied).
  **Gating**: the page needs buySide OR sellSide — a new `trading` section
  value in `constants/navigation.ts` (`sectionAllowed()`) derived from the
  two flow booleans, so the role matrix stays the single authority. Tabs
  gate exactly as their source screens (Buy/Stock = buySide, Sell =
  canViewSellingPrice, Economics = canViewEconomics); brand/supplier model
  render only for canViewBrand. Cost columns (`avg_cost_idr`,
  `unit_cost_idr`) are **not selected** for roles that may not see them —
  the /products network-tab leak rule, applied from day one (sell_admin gets
  the balance average only, which /pricing already shows that role).
  **One click from anywhere**: Spotlight's `component` kind now lands on the
  hub for both lenses (buy keeps its PI/PO drill rows), Products rows +
  expanded detail, Stock rows + StockModal header, Purchasing rows
  (ComponentEditor), sales-editor catalog-linked lines (↗), and
  Profitability item rows all link here. Nav: single "Items" entry between
  Sell and Money, neutral accent (it spans both flows).

- **Nav rename + Analytics lockdown (2026-07-30, owner's direction)**:
  **Money → Finance** (menu group; old name kept as a search keyword on its
  entries). **Items moved into the Analytics group**, and **Analytics is now
  OWNER-ONLY** via a new `canViewAnalytics` capability (owner alone) — the
  group covers Spend & Cash (`/insights`), Items (`/items`) and Profitability
  (`/economics`, still additionally behind `canViewEconomics`). Per the house
  rule that hidden modules are also unreachable, the PAGES gate too:
  `/insights` dropped its old buySide/lookup gate (buy_admin and the legacy
  roles lose it; buy-side deal/cost lookup lives on in Purchasing →
  `/catalog?tab=lookup`, which is unchanged, and the viewer role keeps its
  read-only lookup there), and both `/items` routes now require
  `canViewAnalytics`. Every Item-hub entry point renders only for roles that
  can open it: Spotlight's component results fall back to Deal Lookup (buy)
  or Products (sell) for non-owners, and the hub links on Products, Stock,
  StockModal, Purchasing rows and the sales editor are gated the same way.
  The hub's internal per-tab capability gating is deliberately KEPT, so
  widening access later (e.g. sales seeing the hub minus cost/GP/brand) is a
  one-line flag flip in `constants/roles.ts`, not a rebuild. The permission
  matrix in Settings › Users gained the Analytics row automatically.

- **URLs now match the menu titles (2026-07-30)**: the four routes whose path
  still said the old code name were renamed with permanent redirects
  (precedent: /quotes → /proposals): **/catalog → /purchasing**,
  **/insights → /spend-cash**, **/economics → /profitability**,
  **/data → /import-export** (and `components/economics/` →
  `components/profitability/` with them). The older /insert and /database
  redirects now point straight at the final destinations, so no double hop.
  Query strings survive the redirect (Next preserves them), which keeps every
  old deep link — /catalog?tab=lookup&q=…, Spotlight recents stored in
  localStorage, sent login-link emails — landing on the right tab. All
  internal hrefs, NAV_ICONS keys, MOBILE_PRIORITY, list-default registries
  and login?next= targets were updated in the same pass; the old route names
  stay as Spotlight search keywords on their entries.

- **Opening defaults for the new lists (2026-07-30)**: `constants/listDefaults.ts`
  gained **Items** (sort-only: Most traded / On hand / Stock value / Name /
  Last movement — ships on Most traded) and **After Sales** (period on the
  reported date, ships on All time; the page gained the house
  `DateRangeFilter` beside its category chips to honour it — cases stay
  grouped by status, the period narrows what was reported in it). The
  registry's `dateLabel` can now be `null` for lists with no date filter, and
  Settings › Lists renders "Not a dated list" instead of a period picker for
  them — a setting that changes nothing is worse than none. Both pages follow
  the house pattern: the default applies until someone re-sorts or widens the
  list themselves (never saved over the owner's default).

- **Cost Lookup's forensics merged into the Item hub (2026-07-30, owner's
  direction)**: the owner prefers Cost Lookup's traceable audit trail and
  wants it living in the hub — so it was EXTRACTED, not copied:
  `components/ui/ItemCostForensics.tsx` renders the Last Price / TUC /
  Activity strip, the **Linked/Comparable** items (8.0 links, with each
  comparable's own TUC/quote/PO price tag, chips navigate to that item's
  hub), and behind the same "Show full cost breakdown" toggle: supplier
  quote lines (now WITH the ≈IDR FX-provenance column and 90-day stale
  amber), per-PO TUC allocations (line share %, principal/fees/landed split,
  "balance unpaid" gating, plus the measured lead-time column), and the
  payment & cost records per PO with the breakdown bar. Used in TWO places:
  **/items rows now expand in place** (the Cost Lookup interaction, but the
  list is never empty — items are already on screen; the ↗ still opens the
  full hub) with the full buy dataset + one page-level computeTUCMap/fx so
  every expansion is instant; and the **hub's Buy tab**, whose simpler
  hand-rolled PI/PO tables were replaced by the same component (KPI cards
  stay). **Spend & Cash › Cost Lookup was retired on 2026-08-01** (owner's
  call once the hub covered it): the tab is gone from /spend-cash; the
  `ProductCostLookup` component stays on disk until the owner asks for the
  final delete. Old `?tab=lookup` deep links fall back to Spend Overview.
  Also this pass, per the owner: **Pricing moved back to the Admin group**
  (it was moved to Sell in the 2026-07-29 navigation pass on the
  "daily commercial tool" argument — overruled: tiers/floors are
  configuration in this house), and the **ICAPROC dropdown menu was
  compacted** (13px rows, tighter group spacing) so the grown menu fits a
  desktop viewport without scrolling.

- **Header clock + What's New update log (2026-07-30, owner's ask)**: a live
  date + time sits fixed in the BrandMenu header on every page (phones too —
  it right-aligns beside the wordmark; desktop after the search field),
  rendered through the settings-driven `fmtDayTime` in the viewer's own
  timezone, mounted-only so SSR can't mismatch. The clock IS the door to
  **`/changelog` — "What's New"**: `constants/changelog.ts` holds the
  entries (ISO `at` timestamps, rendered local), the page is open to every
  signed-in role, and Spotlight indexes it (search-only, keeps the menu
  lean). **NEW RULE: every update shipped to main appends its entry to
  `constants/changelog.ts` in the same commit** — what changed, when, in the
  user's language. That is now part of definition-of-done alongside the
  CommandPalette entity rule.

- **Full-digit money + order margins (2026-08-05, owner's rule)**: money always
  shows FULL digits — the compact fmtCompact/fmtIdrShort/fmtRupiahShort helpers
  are DELETED from `lib/formatters.ts` (never re-add a shortener); oversized
  figures shrink via `components/ui/FitText.tsx` (font auto-fits its tile,
  digits never wrap or truncate). The sales editor gained owner-only
  (canViewEconomics) Dolibarr-style margins: per-line est. GP chip + order-level
  Est. COGS / Est. GP in the totals card, at the current quantity-weighted
  moving-average landed cost from 30.1 (`avg_cost_idr` fetched ONLY for owners —
  the network-tab leak rule); custom lines without cost are excluded and
  counted. Sales list customer names deep-link to `/customers?open=` (new tab).
  Fixed with it: the editor's physical-stock map assigned instead of summing
  across warehouses.

- **Role-relevant dashboard defaults (SHIPPED 2026-08-23)**: `defaultOn` was one
  GLOBAL flag, so every un-customised login opened on the same eighteen panels
  minus whatever its role gated out — tailoring that was purely subtractive.
  `ROLE_DASHBOARDS` in `constants/dashboardWidgets.ts` now declares, per role,
  the panels it opens on (`lead`), any it starts switched off (`off`), and the
  screens it starts its day on (`starts`) — ONE map behind the dashboard order,
  the Customise panel's "For your role" group, and the Quick Actions card
  (which had kept its own second list inside `app/page.tsx`). Resolution is
  `layoutForRole(role, house)`: the role's panels float to the top of the HOUSE
  order (owner's call — layered, not replaced, so one nudge in Settings cannot
  flatten every role back to identical), and `off` ADDS to what the house hid
  rather than fighting it. Precedence: role default → house → personal, with
  the role layer inside the personal arrangement's `base` pin, so retuning a
  role dissolves stale personal copies exactly as a house change does.
  Settings › Dashboard gained **"What each role opens on"** — a per-role
  preview rendered through the same resolver, so the owner can see why two
  people differ. Nine new cases in `lib/dashboardWidgets.test.ts` fail the
  build if a role leads with (or switches off) a panel its permissions never
  let it see, if a role's start silently changes, if the house's switch-off
  stops winning, or if the page grows a second shortcut list again.

- **Dashboard slice 2 — position strip + month-in-motion + AI next step
  (SHIPPED 2026-08-09)**: the dashboard opens with the POSITION —
  `lib/position.ts` (pure computations + one capability-gated fetch pass;
  16 tests in `lib/position.test.ts`): **Cash** (per-account
  opening + Σin − Σout, /banks' exact rule incl. FX conversion at the
  payment's recorded rate; foreign-currency accounts listed beside the IDR
  total, never silently converted), **Owed to us** (Σ per-invoice
  outstanding via invoice-tagged receipts, overdue slice per
  `arOverdueDays`), **We owe** (the queue's unpaid-PO rule across ALL
  active POs — replaces the old "Outstanding" KPI tile, whose `rate||1`
  fallback mis-valued unrated foreign POs; Draft/Replaced/Cancelled and
  unrated POs are excluded and the exclusion is shown), and **CCC** on a
  fixed 90-day basis (DIO from 30.1 value ÷ delivery-out COGS from 30.0;
  DSO paid-invoice value-weighted; DPO vs `actual_received_date` —
  /profitability's math). Tiles gate per capability (canViewBanks /
  sellSide / buySide / canViewEconomics) and each fails alone.
  **Month in motion** compares MTD to the SAME day-span of last month
  (Aug 9 vs Jul 1–9; a longer span caps at the shorter month's end):
  invoiced / collected / paid out, delta %. **Next best step** card:
  `/api/next-step` (same Bearer-auth pattern as /api/ask, claude-haiku)
  receives ONLY the role-visible summary the page already renders and
  returns one proposed step + its economic consequence; cached per
  day+role in localStorage with manual refresh. AI-first posture:
  it proposes, the human decides — stated on the card.

**Next up (in order):**
1. Bank follow-ons: tag the historical payments/receipts through the
   "untagged movements" panel on /banks so every statement is complete; then
   consider a cash-position tile on the dashboard and bank-account filtering
   inside Insights.
2. Sell-side polish: Record Payment modal should offer an invoice picker once
   an order carries 2+ unpaid invoices; optional live cursors in the EPC
   editor (Presence broadcast).
3. Stock hygiene: transfer the legacy MAIN balances into G63/G25 via
   /stock "⇄ move", then deactivate MAIN.
4. Settings follow-ons when touched: per-document-type overrides (a customer
   who wants English invoices), and quote validity days once the sell-side
   document carries one.

---

## Module 29 — The Item hub (kickoff spec) — **SHIPPED 2026-07-30, see Status**

**Why this is #1.** The roadmap's own thesis is *"the pivot is the Stock item;
the unit of profit is the item."* Today an item has no page. It has four
partial views, each owned by a different screen:

| lens | screen | what it knows |
|---|---|---|
| buy | `/catalog` (Purchasing) | supplier quotes, POs, landed cost, lead time |
| sell | `/products` | tier prices, warranty, datasheet, live stock |
| warehouse | `/stock` | on-hand per warehouse, moving-average cost, movements |
| money | `/economics` (Profitability) | GP, turns, ageing, trade position |

Nobody can answer *"tell me everything about ICA550-72HMI"* without visiting
three screens and holding it in their head. Every number already exists — what
is missing is the ASSEMBLY. That is why this outranks new features: it makes
the data the business already owns legible in one place.

**Route:** `/items/[componentId]`, with `/items` as the master list (the
existing Products and Purchasing lists stay; they become filtered entry points
that link INTO the hub rather than being replaced).

**The page:** one header — internal description, category, unit, live
on-hand, and the two prices that matter (current tier-1 sell, moving-average
landed cost) — then tabs by lens:

- **Overview** — the answer to "should I worry about this item": cover
  (on-hand ÷ recent monthly sales), days since last movement, GP% at current
  price, and any open signal (below margin floor, no stock but committed,
  ageing past the slow-mover threshold).
- **Buy** — supplier quotes (PI) and POs for this item with price history and
  the FX provenance already built in `computeTUC`/`fxFromHistory`, measured
  supplier lead times, incoming quantity.
- **Sell** — tier price chain (`lib/tierPricing.ts`), overrides and floor
  compliance, quotes/orders that included it, customers who buy it.
- **Stock** — the `30.0` ledger for this item, per-warehouse balances,
  GRNs, transfers.
- **Specs** — `SpecRenderer` + the JSON editor + calculator-readiness
  (already built in Module 28 groundwork).
- **Economics** — GP per customer for this item, turns, ageing bucket, and
  the trade Position (`lib/tradePosition.ts`) — owner-only, per
  `canViewEconomics`.

**Rules (non-negotiable, they are why this is safe to build):**
- **Compose, don't fork.** Every tab renders the EXISTING engine —
  `computeTUC`, `tierPricing`, `warehouses`, `tradePosition`, `specSchema`.
  If a number differs from the screen it came from, the hub is wrong.
- **The lens follows the role, not the URL.** Tabs are capability-gated
  exactly as their source screens are (cost/GP never render for sell-side;
  brand and supplier model never render for sell-side).
- **One click from anywhere.** Spotlight's `component` kind, the Products
  and Purchasing rows, stock rows, and quote lines all point here.

**Definition of done:** an owner can open one item and see cost, price,
stock, movement, specs and profit without leaving the page; a sales role sees
the same page minus cost/GP/brand; every figure ties to its source screen;
Spotlight's Item results land on the hub; tsc + build green.

---

## Module 28 — System Designer: calculator-driven System Quotes (kickoff spec)

**Goal:** the two standalone HTML calculators (mounting v11, Smart Solar BoM
v7) become part of the sales quote flow: a sales person answers the CONTEXT
questions (kWh/day, PLN capacity, loads, roof, layout) and gets a complete,
catalog-resolved, tier-priced Bill of Materials as an ordinary 22.0/22.1
quote. Three layers, built one thread each:

1. **Specs as data — SHIPPED 2026-07-29** (`lib/specSchema.ts` + seeds; see
   Status). An item is a design candidate only when `specReadiness` passes —
   the calculator never sizes from missing numbers.
2. **Mounting engine + Materials Quote (next):** port v11 `calculate()` into
   pure `lib/systemDesign/mounting.ts` (rails/joints/clamps/supports/
   grounding from panel dims × layout, edge-spacing + rail-utilisation
   warnings), with GOLDEN TESTS asserting outputs match the HTML app.
   Resolve generic lines to catalog items via `bom_role` (+ role param);
   an unresolved role lands as free text flagged "not in catalog", never
   blocks. Wizard step on /sales generating a mounting-materials quote.
3. **Full System Quote:** port v7 sizing — on-grid (PLN capacity → phase/VA
   filter → DC/AC ratio), off-grid/hybrid (load table w/ inductive 2× surge
   → inverter incl. parallel strategy → battery bank series×parallel by DoD
   → PV by PSH), `sizePvStrings` Voc/MPPT validation. Full wizard: Context →
   Array & mounting → Review (tier prices, per-line 30.1 availability,
   engineering warnings) → Insert. Design inputs persist as `system_design`
   JSONB on 22.0; generated lines tagged (`design_role` on 22.1) so
   REGENERATE replaces only its own lines and hand-added lines survive.
4. **Polish:** shortage integration, alternative suggestions, printed system
   summary annex, WhatsApp share.

**Locked while building it:**
- Prices come from `lib/tierPricing.ts` at the customer's tier — never from
  spec blobs or hard-coded constants.
- Engine defaults (system efficiency 0.8, continuous safety ×1.25, DoD
  0.5/0.8, support spacing 1700mm, default PSH, DC/AC ratio) live in
  Settings › Defaults, not code constants.
- Specs never carry brand/model/prices (columns do); customer-facing spec
  output prints whitelisted keys only.
- Engines are pure TS with golden tests pinned to the HTML calculators'
  outputs; rule changes change a test, never silently.

---

## Module 5B — Split fulfillment: partial Invoices & Delivery Orders (kickoff spec)

**Goal:** one customer order (SO on `22.0`) can be billed by several invoices
and shipped by several delivery orders, with quantities/nominals proportioned
per document — while the simple 1:1 case stays exactly as easy as today.

**Why the model must change:** today INV/DO are *columns on the order row*
(`invoice_number`, `do_number` stamped as status advances) — structurally one
invoice and one DO per order. Splitting requires them to become child
documents of the order.

**Tables (idempotent SQL; reuse existing `sales_invoice_seq` / `sales_do_seq`
so numbering continues unbroken):**
- `24.0_delivery_orders`: `do_id uuid pk`, `quote_id fk → 22.0` (the order),
  `do_number` (DO-… by trigger), `status` (`preparing`/`delivered`/`cancelled`),
  delivery details (date/time/method/via/address/map/contact — MOVE from 22.0,
  keep old columns for legacy reads), `delivered_at`, audit cols.
- `24.1_delivery_order_items`: `do_id fk`, `so_item_id fk → 22.1`,
  `component_id`, `description`, `qty` (≤ remaining on that SO line — UI guard
  + DB trigger warn), `sort_order`.
- `25.0_sales_invoices`: `invoice_id uuid pk`, `quote_id fk → 22.0`,
  `invoice_number` (INV-… by trigger), `kind` (`items` | `progress`),
  `pct` (progress: % of order grand total), `subtotal/ppn_pct/ppn_amount/
  grand_total`, `do_id fk nullable` ("invoice this shipment"), `issued_at`,
  `due_date`, `notes`, audit cols.
- `25.1_sales_invoice_items`: `invoice_id fk`, `so_item_id fk → 22.1`,
  `description`, `qty`, `unit_price`, `line_total`, `sort_order`. A `progress`
  invoice has ONE line ("Down payment 30% — <SO number>"); its per-item value
  allocation for economics is derived by value share, not stored.
- `26.0_customer_receipts`: ADD `invoice_id fk nullable → 25.0`; keep
  `quote_id`. Payments recorded against a specific invoice; order-level AR =
  Σ invoices − Σ receipts.

**Derived order state (no more hand-stamped single status):**
- `invoiced_pct` = Σ invoice grand totals ÷ order grand total (warn > 100%).
- per SO line: `delivered_qty` = Σ delivered DO-item qty; order is
  `delivered` when every line is fully shipped, else `partially delivered`.
- 22.0 `status` keeps the existing enum for the funnel, advanced by rollup:
  first invoice → `invoiced`, first DO → `preparing`, all lines shipped →
  `delivered`. Existing milestone dots gain fractions ("2 of 3 shipped",
  "70% invoiced").
- **Stock**: each DO writes its own `out` movements when THAT DO is marked
  delivered (`source_type 'delivery'`, `source_id = do_id`). Reserved
  becomes Σ max(0, ordered − delivered) per line on committed orders —
  update `COMMITTED_STATUSES` consumers (Products, StockModal, dashboard).

**Backfill (one migration, no data loss):** for every existing 22.0 row with
an `invoice_number`, create ONE `25.0` invoice (kind `items`, full lines,
same INV number, issued_at = invoiced_at); same for `do_number` → one full
`24.0` DO (same DO number, delivery details copied, delivered state from
status). Point existing receipts at the created invoice. Old columns stay
(read-only legacy) so nothing breaks mid-deploy.

**UX (the "seamless" contract):**
- The order page's buttons stay: **Create Invoice** opens a modal prefilled
  with 100% of the *remaining uninvoiced* amount/lines — one click for the
  simple case; editing qty per line or switching to "% of order" (DP/progress)
  is the split path. **Create Delivery Order** prefills all *undelivered*
  qty — trim lines to split shipments. Both show a remaining meter.
- Order page gains a **Fulfillment panel**: every invoice (number, nominal,
  % of order, paid state from receipts) and every DO (number, qty summary,
  status, delivered date), each linking to its own print; plus
  "remaining to invoice" and "remaining to deliver" bars.
- `/invoices` lists `25.0` rows (real per-invoice AR aging); `/delivery`
  lists `24.0` DOs (per-shipment Surat Jalan print). Prints move to
  `/sales/[id]/inv/[invoiceId]` and `/sales/[id]/do/[doId]`.
- Spotlight: index `25.0`/`24.0` as their own entries (INV-/DO- numbers →
  the order page), replacing the keyword-only match.
- Receipts modal: pick which invoice the payment settles (default: oldest
  unpaid).

**Definition of done:** an order can issue 2+ invoices (mixed % and item
kinds) and 2+ DOs; each DO decrements stock only for its own lines at
delivery; AR is per invoice and rolls up per order/customer; legacy orders
show identical numbers and totals after backfill; CCC's DSO input now uses
per-invoice issued→paid dates; tsc + build green.

## Locked architectural decisions

- **Formatting is configured, not hard-coded (decided 2026-07-25).** Every
  number / currency / date in the app comes from `lib/formatters.ts`, which
  reads `lib/settings.ts` (backed by `40.0_settings`). Two profiles, never
  collapsed: **internal** (dense team-facing tables) and **document**
  (customer-facing prints + the WhatsApp price copy) — helpers ending in `Doc`
  are the customer-facing ones. Defaults in `DEFAULT_SETTINGS` reproduce the
  pre-Settings output, so an unconfigured install is unchanged. Never
  re-introduce a local `toLocaleString` in a page: add the shape to
  `lib/formatters.ts` instead (the drift cost us 24 duplicate helpers once
  already).

- **Stock is per (item, WAREHOUSE) — multi-warehouse since 2026-07-25.**
  `30.3_warehouses` is the master (seeded **G63 “Gudang No.: 63”** = default,
  **G25 “Gudang No.: 25”**, plus **MAIN “Unassigned (legacy)”** holding the
  pre-existing balances until they are transferred). `30.1_stock_balances` is
  keyed (component_id, location) and the moving-average landed cost is
  maintained **per warehouse** — so every cross-warehouse roll-up must SUM
  quantity and take a QUANTITY-WEIGHTED average cost (`lib/warehouses.ts`);
  never read “the last row”. Ledger integrity is enforced in the DB: location
  is an FK to a real warehouse, `direction` is CHECKed to 'in'/'out' (anything
  else was silently treated as an increase), quantity must be > 0, and an
  adjustment is posted as in/out with a positive quantity (there is no
  'adjust' direction). Warehouse moves go through the atomic
  `transfer_stock()` RPC (two legs at the source average in one transaction,
  so total inventory value is unchanged). `verify_stock_balances(p_fix)`
  replays the whole ledger to prove — or repair — balances; last run: 0
  discrepancies.

- **Tier pricing = markup chain (decided 2026-07-24, replaces "list − discount").**
  The price entered on an item (`3.0_components.selling_price_idr`) IS the
  **net price = Tier-1** (first active tier by `sort_order`). Each next tier =
  previous tier ÷ (1 − step%), **rounded UP to the nearest Rp 1,000**, showing
  the actual margin after rounding. Per-item overrides (21.1 absolute price)
  pin a tier AND re-anchor the chain for the tiers above it. The step % is
  stored in `21.0_price_tiers.default_discount_pct` (legacy column name kept —
  no schema change); the net tier ignores its step. Canonical engine:
  `lib/tierPricing.ts` (`computeTierChain` / `tierPriceFor`) — Products, the
  sales editor, TierPricingModal, ComponentEditor Pricing Mode, and /pricing
  all delegate to it. `override_discount_pct` is legacy and no longer read.

- **Costing method: moving-average landed cost.** Valuation = running weighted-avg of landed cost (from `computeTUC`/GRN). Lot/serial tracking is a *later* enhancement (matters for panels/inverters and exact per-lot cash-cycle) — design the ledger so it can be added, but do not build it now.
- **Warehouses: single to start, multi-ready.** Every stock row carries a `location` column so multi-location is a data change, not a rewrite.
- **Cash Conversion Cycle = DIO + DSO − DPO.** Sources: DPO = supplier payment dates (`po_costs`), DIO = PO received / stock-in dates, DSO = customer invoice→receipt dates (arrives with module 5). Agree the formula up front so module 6 only renders it.
- **Customer is its own entity** — distinct from `2.0_suppliers` (vendors) and `1.0_companies` (internal). Do not overload companies.

## Naming (decided 2026-07-23)

- **Quotation / Sales Quote** = the 22.x sell-side trading document (SQ- →
  SO → INV → DO). Standard ERP term; unchanged.
- **EPC Proposal** = the 10.x project document (formerly "Project Quote").
  UI labels, nav ("EPC Proposals"), Spotlight, the customer-facing print
  header, and the routes (now `/proposals`, with permanent redirects from
  `/quotes`) all say Proposal; tables and Q- numbers unchanged.
- **New Deal** (decided 2026-08-04, owner's pick) = the future combined
  buy-side entry form replacing the separate Supplier Quotes and Purchase
  Orders tabs. "Deal" is the vocabulary Deal Lookup already established
  (a deal = PI → PO → payments); New Deal records one, Deal Lookup finds
  one. See the Module kickoff spec below.

## Module — New Deal: single-form buy-side entry (kickoff spec)

Owner direction (2026-08-04): *"Our goal is to combine the quote and not
separate Quote and PO forms separately… I like minimalist… I like New Deal."*
Build in its own thread. What exists already (shipped on the old two-card
layout, must carry over):

- **Mode selector, preselected & persisted** (`purchasing:quote-mode` in
  localStorage): **Quote only** = store a price quote, never touch a PO;
  **Quote + PO** = straight PI → PO — quote auto-`Accepted` (no Status
  field), PO `Confirmed`, `pi_status` Accepted, PO date defaults to PI
  date, exchange rate derived from payment-implied history when blank.
- **Violet = PO**: `FieldConfig.accent` renders violet border/label for
  fields that belong to the PO; shared fields stay standard. Keep this
  convention in the single form.
- **Items typed once land on both** documents (quote `unit_price` → PO
  `unit_cost`); a PO that already has lines is never overwritten; in
  Quote-only mode no PO is ever written.
- One PDF upload should prefill the WHOLE form (header + items) — the
  extraction already returns both.

**SHIPPED 2026-08-04 (v1):** tab renamed **New Deal**, Purchase Orders
tab retired — `?tab=ordering` links redirect to New Deal, Deal Lookup's
"+ Create PO" and the post-save "Raise its PO →" banner both preselect
the stored quote in the form (header prefilled, PO date = today, items
panel visible), nav/Spotlight keeps the old keywords. The violet PO
section carries full PO-form parity (incoterms, ship via, freight,
terms). PO line amendments live in Deal Lookup.

Still open for the rebuild: one document-shaped form (header + line rows
in a single card, one save — mirror the sales editor's structure instead
of SimpleForm + BatchLineItemsForm) with one PDF upload prefilling the
whole thing.

**Quote today, PO later — SHIPPED in v1 form (2026-08-04):** the
combined form's Quote + PO mode carries a **Stored Quote** selector —
picking one prefills the whole shared header, jumps PO date to today,
leaves only PO # to type, flips the quote to Accepted and copies its
items onto the new PO at save (price → cost). Item changes are amended
on the PO lines in Deal Lookup. The separate Purchase Orders tab is now
redundant for PO creation — the rebuild retires it (browse/amend moves
fully to Deal Lookup) and should wire Deal Lookup's "+ Create PO" to
open New Deal with the stored quote preselected.

## Conventions to keep every module consistent

- **Table numbering (prefix ranges):** buy-side `1–9` (existing), EPC project quotes `10.x` (existing), then:
  - `20.x` = CRM (customers, contacts)
  - `21.x` = pricing (price lists, tiers)
  - `22.x` = sales/product quotes · `23.x` = sales orders · `24.x` = delivery orders · `25.x` = sales invoices · `26.x` = customer receipts
  - `30.x` = inventory (stock ledger, balances, locations, warehouses)
  - `40.x` = platform settings (`40.0_settings` key/value, owner-write)
  - `41.x` = treasury (`41.0_bank_accounts`, `41.1_bank_transactions`, `41.2_bank_names`)
- **Document numbering:** human refs like `CUST-…`, `SQ-YYYYMMDD-…`, `SO-…`, `DO-…`, `INV-…`, `RCPT-…`, `GRN-…` (mirror existing `Q-YYYYMMDD-XXXX`).
- **RLS on every new table** (authenticated-only; writes gated by role). Add a **`sales`** role to the matrix in `constants/roles.ts`; sales can manage customers/quotes/orders but not procurement or payments.
- **Audit:** reuse the `log_quote_activity`-style trigger pattern for created/updated stamps + activity log.
- **Multi-currency:** `9.0_exchange_rate_history` is the single FX source; store amounts in transaction currency + IDR.
- **SQL delivery:** Supabase MCP `apply_migration`/`execute_sql` often needs approval — hand the owner **paste-ready idempotent SQL** (`IF NOT EXISTS` / `DROP POLICY IF EXISTS` / `to_regclass` guards), and keep `MigrationBanner` probes in sync with new columns.
- **Pre-push gate:** `npx tsc --noEmit` and `npx next build` must both pass. Commit + push directly to `main`.

---

## Module 1 — CRM (kickoff spec)

**Goal:** a Customer master with contacts and an owning Sales Rep / Account
Manager, so the whole sell-side can attach to it.

**Tables (paste-ready idempotent SQL to write in-thread):**
- `20.0_customers`: `customer_id uuid pk`, `customer_code text`, `legal_name text`, `display_name text`, `tier text` (fk to pricing tiers later; free text for now), `account_manager_id uuid` (→ `user_profiles.id`), `payment_terms text`, `default_currency text`, `tax_id text`, `billing_address text`, `shipping_address text`, `notes text`, `is_active bool default true`, `created_at/updated_at`, `created_by_email/updated_by_email`.
- `20.1_customer_contacts`: `contact_id uuid pk`, `customer_id uuid fk`, `name`, `role/title`, `email`, `phone`, `is_primary bool`.
- Sales reps = **users** (`user_profiles`) with the new `sales` role; `customer.account_manager_id` points at one. (No separate reps table.)

**Roles:** add `sales` to `constants/roles.ts` + `ROLE_PERMISSIONS` (canManageCustomers, canEditSalesDocs). Update `allowed_emails`/admin UI so owners can assign it.

**Screens:**
- New app tab **Customers** (or a Catalog/CRM section): searchable list (code, name, tier, AM, active), create/edit drawer, contacts sub-list.
- Assign Account Manager (owner/admin) — dropdown of `sales`+`owner` users.
- Wire Customers into **Spotlight** (`components/ui/CommandPalette.tsx`) as a new kind, ranked in the vendor/company tier.

**Seams:** `account_manager_id` → `user_profiles`; `tier` will FK into `21.x` price tiers; future `22.x` product quotes carry `customer_id` + `sales_rep_id`.

**Definition of done:** owners/sales can CRUD customers + contacts, assign an AM, and find a customer via Spotlight; RLS enforced; tsc + build green.

---

## Module 3 — Inventory: Stock ledger + Goods Receipt (kickoff spec)

**Goal:** make stock *truth* on the buy-side — a movement ledger valued at
moving-average landed cost, fed by receiving against POs.

**Tables:**
- `30.0_stock_movements` (the ledger; append-only): `movement_id uuid pk`, `component_id uuid fk`, `location text default 'MAIN'`, `direction text` (`in`/`out`/`adjust`), `qty numeric`, `unit_cost_idr numeric` (landed cost at time of movement, from `computeTUC`), `source_type text` (`grn`/`delivery`/`adjustment`/`transfer`), `source_id text` (e.g. po_id / do_id), `moved_at timestamptz`, `notes`, audit cols.
- `30.1_stock_balances` (cached on-hand, recomputable from the ledger): `component_id + location` unique, `qty_on_hand numeric`, `avg_cost_idr numeric`, `updated_at`. Maintained by trigger on `30.0` (or recomputed view).
- **GRN** = a receive action: create `in` movements from a PO's line items (qty received, landed unit cost). Can start as movements sourced from PO; a formal `30.2_goods_receipts` header can come later.

**Valuation:** on each `in`, update balance `avg_cost = (old_qty*old_avg + in_qty*in_cost) / (old_qty+in_qty)`. On `out`, decrement qty at current `avg_cost` (COGS basis). Guard against negative on-hand (warn, allow with flag).

**Screens:**
- **Stock** view: on-hand per item (+ location), avg landed cost, stock value, last movement.
- **Receive against PO** (buy-side): pick a PO, confirm received qty per line → writes `in` movements. Ties into the existing PO "received date".
- Item drill: movement history (the stock ledger) + running on-hand.

**Seams:** `in` from PO/GRN (buy-side); `out` will come from `24.x` Delivery Orders (module 5); `avg_cost_idr` is the COGS basis the **Item Economics** dashboard (module 6) uses for GP and cash-cycle.

**Definition of done:** receiving a PO increments on-hand and recomputes moving-avg cost; stock view + per-item movement history render; RLS enforced; tsc + build green.

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

## Status (updated 2026-07-21)

**Shipped and live on main:**
- **Module 1 — CRM**: `20.0_customers` + `20.1_customer_contacts`, `/customers`
  list + edit drawer + **profile drawer** (KPIs, linked documents, AR, most-ordered
  items, EPC project quotes), CSV import/export, `sales` role, Spotlight wiring.
- **Module 2 — pricing (partial)**: `21.0_price_tiers` + `21.1_item_tier_prices`
  render on `/products` (tier price matrix per item). No dedicated tier-management
  screen yet.
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

**Next up (in order):**
1. **Module 2 finish** — tier management UI (CRUD tiers, per-item overrides,
   margin floor vs landed cost).
2. **Module 6 — Item Economics dashboard** (GP/item, turnover, CCC) — the
   ledger provides COGS; DSO can now use per-invoice issued→paid dates.

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

## Conventions to keep every module consistent

- **Table numbering (prefix ranges):** buy-side `1–9` (existing), EPC project quotes `10.x` (existing), then:
  - `20.x` = CRM (customers, contacts)
  - `21.x` = pricing (price lists, tiers)
  - `22.x` = sales/product quotes · `23.x` = sales orders · `24.x` = delivery orders · `25.x` = sales invoices · `26.x` = customer receipts
  - `30.x` = inventory (stock ledger, balances, locations)
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

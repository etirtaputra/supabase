# ICAPROC — Distribution ERP Roadmap

> Read this first when starting an ERP-module thread. It defines the vision,
> the build sequence, the locked architectural decisions, naming conventions,
> and kickoff specs for the first two modules. Build **one module per thread**.

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

## Locked architectural decisions

- **Costing method: moving-average landed cost.** Valuation = running weighted-avg of landed cost (from `computeTUC`/GRN). Lot/serial tracking is a *later* enhancement (matters for panels/inverters and exact per-lot cash-cycle) — design the ledger so it can be added, but do not build it now.
- **Warehouses: single to start, multi-ready.** Every stock row carries a `location` column so multi-location is a data change, not a rewrite.
- **Cash Conversion Cycle = DIO + DSO − DPO.** Sources: DPO = supplier payment dates (`po_costs`), DIO = PO received / stock-in dates, DSO = customer invoice→receipt dates (arrives with module 5). Agree the formula up front so module 6 only renders it.
- **Customer is its own entity** — distinct from `2.0_suppliers` (vendors) and `1.0_companies` (internal). Do not overload companies.

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

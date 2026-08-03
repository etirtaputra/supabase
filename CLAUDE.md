# Claude Code Instructions

## Git Workflow

- Always commit and push directly to **main**. Never push to feature branches — merge to main instead.
- **No preview deployments** (owner's rule, 2026-08-03): do not create or trigger
  Vercel preview deploys. Pushing to main is the whole release — production
  deploys from main automatically.

## Mission (why ICAPROC exists)

ICAPROC is the company's bid to **own its own operating system** — a full ERP
that needs only servers + subscriptions, so the business controls its own data
and tooling instead of renting it. Core beliefs that should shape every module:

- **Own the DATA** — *whoever controls the data controls the business.* Every item,
  price, customer, PO, stock movement, and payment lives in **our** system.
- **The Cash Conversion Cycle is the runway** — distribution is air-traffic control;
  you win by cycling items through at a profit. *The cycle is the most important
  thing.* The stock ledger + item economics are the spine of the build.
- **The internal system feeds the outside** — the same clean item/price/spec data
  is meant to power a future public website and per-project technical specs.
- **AI-first** — *the old era was telling the AI what to do; the new era is asking
  the AI what it thinks we should do next.* Propose the next best step, surface the
  economic consequence, let the human decide.
- **Everything connects — path of least resistance (owner's standing rule,
  2026-08-03).** Whenever a module or feature is built or touched, CHECK its
  interconnections: does the new document/action link to the records it belongs
  to (invoice ↔ payment, DO ↔ stock, quote ↔ customer…), do the adjacent
  screens/panels reflect it without manual re-entry, and does the next obvious
  step sit one click away (pre-selected, pre-filled, placed where the user
  already is)? Nothing ships as an island; seamlessness for the user beats
  everything else. (Precedent: receipts must carry `invoice_id`, payment panel
  lives under Fulfillment, amounts prefill from the linked document.)

## Distribution ERP Roadmap

ICAPROC is being built into an **item-centric distribution ERP** — two mirror
flows: **buy-side** (procure-to-pay, ~70% built) and **sell-side**
(order-to-cash, mostly new), meeting at the **Stock item** (the pivot; the item
is the unit of profit). The EPC **Project Quotes** (`10.x`) are a separate
product line and stay as-is.

**Before starting any ERP-module thread, read `docs/ERP_ROADMAP.md`** — it holds
the vision, the build sequence, locked architectural decisions, naming
conventions, and kickoff specs. Build **one module per thread**.

- **Sequence:** 1) CRM (customers/contacts/sales reps) ← next · 2) Price List + tiering · 3) Inventory stock ledger + goods receipt · 4) Product Quote → Sales Order · 5) Delivery Order → Invoice → Receipt · 6) Item Economics dashboard (GP, turnover, cash-conversion-cycle).
- **Locked decisions:** moving-average landed cost (lots later); single warehouse but `location`-ready; CCC = DIO + DSO − DPO; Customer is its own entity (not `1.0_companies`/`2.0_suppliers`).
- **Table-prefix convention:** buy-side `1–9`, project quotes `10.x`, CRM `20.x`, pricing `21.x`, sales quote/SO/DO/invoice/receipt `22–26.x`, inventory `30.x`. Add a `sales` role to `constants/roles.ts`.

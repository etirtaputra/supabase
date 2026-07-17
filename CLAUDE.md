# Claude Code Instructions

## Git Workflow

- Always commit and push directly to **main**. Never push to feature branches — merge to main instead.

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

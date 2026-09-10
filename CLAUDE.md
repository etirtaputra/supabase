# Claude Code Instructions

## Git Workflow

- Always commit and push directly to **main**. Never push to feature branches — merge to main instead.
- **No preview deployments** (owner's rule, 2026-08-03): do not create or trigger
  Vercel preview deploys. Pushing to main is the whole release — production
  deploys from main automatically.

## Thread handoff (owner's rule, 2026-08-23)

- **`docs/HANDOFF.md` is the single, permanent handoff file.** Read it FIRST in
  every new thread, before this file and before `docs/ERP_ROADMAP.md` — it holds
  the backend specifics (GitHub/Vercel/Supabase and how each behaves in the
  sandbox), what shipped recently, what was left alone on purpose, and the
  kickoff for the next module.
- **Every thread that ships a module updates it before finishing**: refresh §4
  (what shipped, with commit SHAs), replace §6 with the next module, and bump
  the "Last updated" line. Never date the filename and never start a second
  copy — git history keeps the dated versions.

## Agent knowledge packs (owner's rule, 2026-09-05)

- `docs/agents/MANDA-SOLAR-DESIGN.md` is a TRANSCRIPTION of `lib/systemDesign/`,
  not an independent document. **Any thread that changes an engine rule,
  constant or behaviour regenerates the pack in the same commit** — the same
  way `docs/HANDOFF.md` is updated by the thread that ships a module. Bump the
  commit SHA in its header.
- The golden tests (`lib/systemDesign/*.test.ts`) are the real contract. If the
  pack and a test disagree, **the test is right and the pack is stale.**
- Never change a golden number to make a build pass. Those numbers were read
  out of the original v7/v11 calculators. Change one only when the rule
  deliberately changed, and say so out loud.
- **The registry is `lib/agentDocs.ts`, and `docs/agents/INDEX.md` is the only
  filename that never changes.** Every other pack carries `_v<N>_YYYY-MM-DD`.
  Rename a pack and you must update the registry in the same commit — `npm
  test` fails otherwise, and `/api/agent/onboarding` serves the same list.

## Shipping a pack change to the agents (owner's rule, 2026-09-07)

The owner is not technical and should not have to move files by hand. A thread
that changes any pack finishes the job:

1. **Upload to the shared drive** (`ICAPROC AI AGENTS`, Google Shared Drives),
   filenames matching the repo character for character:
   `00-READ-FIRST/` INDEX.md · `10-PACKS/` the packs · `20-RUNBOOKS/` the
   runbooks · `90-OUTPUT/` agents' own notes, never ours.
2. **Trash the superseded copy** in the same folder. Two files answering one
   question is the failure the versioning rule exists to prevent.
3. **ALWAYS end by writing the update prompt for BOTH MIRA and MANDA**, ready
   to paste into Telegram — what changed, what to re-read, what belief to drop.
   A pack nobody was told about is a pack nobody reads.

## One control size (owner's standing rule, 2026-09-10)

> *"It's important for me to use the same border size. always. to maintain
> consistencies and uniformity."*

Every control in a filter/toolbar row — input, select, menu button, mode
toggle, filter chip, date range — dresses from **`constants/controls.ts`**
(`BAR_H`, `BAR_BOX`, `BAR_SELECT`, `BAR_INPUT`, `BAR_BTN` + its states). One
height (`h-11` phone / `h-9` desktop), one radius, one border.

Never write those values into a screen. `lib/controls.test.ts` fails the build
when a file outside `constants/controls.ts` states the bar height itself — that
guard exists because the rule was already being followed on two screens
separately, with different numbers, and the row that borrowed a control from
one into the other ended up carrying both.

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

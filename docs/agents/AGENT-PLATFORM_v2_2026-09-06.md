# ICAPROC as an agent-operable system — the architecture

> Owner's goal, 2026-09-06: *multiple AI agents I set up and train, logging in
> and operating ICAPROC — data entry, bulk entry and updates in the right
> sequence, prepopulating Proposals with the right BoM, driving the Sales Quote
> system and Mounting Designer, and telling me what to pay attention to from the
> Dashboard, Insights, pending POs and Deal Lookup.*
>
> This document is the plan for getting there, and the reasons behind its shape.
> It is a DESIGN, not a description: most of it is not built yet. What is built
> is marked ✅.

---

## 0. The finding that decides the architecture

**ICAPROC's two sides do not enforce themselves the same way.**

| | Buy side | Sell side |
|---|---|---|
| line items → header total | `recalculate_po_total` trigger on `5.1` | **nothing** |
| stock movement | `apply_stock_movement` trigger on `30.0` | **nothing on `24.0`** |
| numbering / stamping | trigger | trigger ✅ |

`22.0_sales_quotes` stores `subtotal`, `ppn_amount` and `grand_total` as
columns, and **`22.1_sales_quote_items` carries no trigger at all** — the React
app computes those totals and writes them. Likewise `24.0_delivery_orders` has
no trigger that posts stock; the five `source_type = 'delivery'` movements on
file exist because the app posted them.

Verified 2026-09-06 by reading `pg_trigger` and comparing header totals against
the sum of their lines.

**The consequence, and the whole reason this document exists:** an agent that
INSERTs into `22.1_sales_quote_items` through PostgREST produces a quotation
whose money is wrong, and a delivery order that ships goods which never leave
stock. Nothing errors. Nothing warns. The document prints and goes to a
customer.

So: **agents must not write sell-side documents as tables.** The write surface
has to be functions that own the whole action.

---

## 1. Four layers

```
  ONBOARDING   docs/agents/*        where an agent learns the system      ✅ partly
  READ         agent_* views        stable, pre-joined, no cost leakage
  WRITE        agent_* RPC          one function per BUSINESS ACTION
  ATTENTION    agent_attention      "what should I look at today"
```

Each layer is independently useful. Build them in the order of §6, not this one.

---

## 2. Onboarding — where an agent looks ✅ partly

`docs/agents/` is the front door. An agent's system prompt should name it and
nothing else; everything it needs hangs off there.

| File | What it teaches | Status |
|---|---|---|
| `ICAPROC-SCHEMA.md` | the table map, the dead tables, the revision rule | ✅ |
| `MANDA-SOLAR-DESIGN.md` | the PV and mounting engines, and their limits | ✅ |
| `MANDA-BOOT-PROMPT.md` | how to wire an agent to the above | ✅ |
| `PURCHASING_RUNBOOK.md` (in `docs/`) | the six buy-side procedures | ✅ |
| `AGENT-PLATFORM_v*.md` | this file | ✅ |
| `INDEX.md` | names the current version of every pack | ✅ |
| `SELL-SIDE-RUNBOOK.md` | quote → order → DO → invoice → receipt, in order | TODO |

**The rule that keeps these true:** a pack is a TRANSCRIPTION of code, and the
thread that changes the code regenerates the pack in the same commit
(`CLAUDE.md`, owner's rule 2026-09-05). A stale runbook is worse than none —
an agent will follow it confidently.

---

## 3. Read layer — `agent_*` views

**Why not raw tables:** the names are unguessable (`3.0_components`), the joins
are non-obvious, five abandoned tables shadow the real ones, and cost columns
sit beside the ones an agent may report. Every one of those has already caused
a wrong answer.

Proposed views, each a stable name an agent can rely on across schema changes:

| View | Purpose |
|---|---|
| `agent_catalogue` | offerable items only (not archived, not hidden), our name, price, capacity, stock on hand. **No cost, no supplier, no brand.** |
| `agent_customers` | customer + tier + owning rep + AR outstanding |
| `agent_open_quotes` | sell-side documents with their true stage and age |
| `agent_open_pos` | POs not yet fully received, with days since ETA |
| `agent_stock` | on-hand and incoming per item per warehouse |

A view also fixes the read half of the buy-side exposure: agents read
`agent_catalogue`, which has no cost columns, so gating raw `4.x`/`5.x` reads
becomes possible without breaking them.

---

## 4. Write layer — RPC, one function per business action

**The principle: an agent calls a VERB, never a table.** The function owns the
whole action — every row it touches, in the right order, in one transaction,
with the invariants React currently maintains moved into SQL where they belong.

```
agent_upsert_item(...)              catalogue data entry, one item
agent_bulk_upsert_items(batch)      bulk, with a batch id and a dry-run mode
agent_set_item_specs(...)           spec entry, respecting the declared field set
agent_create_sales_quote(customer, lines[])
                                    header + lines + subtotal + PPN + total +
                                    numbering, atomically. THIS is what stops
                                    the wrong-money bug in §0.
agent_advance_quote(quote, status)  walks the ladder, refuses illegal jumps
agent_create_delivery_order(quote)  DO + its stock movements, atomically
agent_post_stock(movement)          already safe via triggers — thin wrapper
```

Every function:
- is `SECURITY DEFINER` but **re-checks the caller's role** with the same
  helpers the RLS policies use (`can_edit_catalog()` etc.), so an agent can
  never do through a function what its login forbids;
- takes a `p_dry_run boolean default false` — returns what it WOULD do,
  changes nothing. **Bulk entry without a dry run is not a feature, it is an
  incident waiting to happen;**
- writes an `agent_runs` row (§5) naming the caller, the action, the arguments
  and the affected ids;
- returns a structured result an agent can report verbatim, not a row count.

**Where the design engines live is a real constraint.** `lib/systemDesign/` is
TypeScript with golden tests. Do NOT port it to SQL — two implementations of a
sizing rule is exactly how the numbers drift apart. Instead expose it as an
authenticated API route (`POST /api/design/system`, `/api/design/mounting`)
that runs the same engine the ERP runs, so an agent prepopulating a Proposal
BoM gets the same numbers the Sales Quote screen would produce. One engine, two
callers.

---

## 5. Every agent action is reviewable — `agent_runs`

```
agent_runs(run_id, actor_email, action, args jsonb, affected jsonb,
           dry_run bool, ok bool, error text, started_at, finished_at)
```

Written by the RPCs, append-only, readable by the owner. This is what makes
bulk entry safe to authorise: a batch has an id, you can see exactly what it
did, and a reversal is scoped to that id.

Note the attribution already works and needs no new mechanism: 14 triggers read
`auth.uid()` and stamp `created_by_email`, so an agent on its own login cannot
forge or forget its name — provided it uses the anon key + password and **never
a service-role key**, which would make `auth.uid()` NULL and every row `system`.

---

## 6. Attention layer — "what should I pay attention to"

The owner's ask, and the cheapest thing here: **read-only, no new write path,
useful the day it ships.** One view per question, each returning a severity, a
subject, a number and a link.

| Signal | Source |
|---|---|
| Invoices overdue, and by how much | `25.0` vs `26.0` |
| POs past ETA and not received | `5.0` + `30.2` |
| Quotes sent and gone quiet N days | `22.0.sent_at` |
| Items priced below the tier margin floor | `21.x` vs landed cost |
| Stock that will not cover accepted orders | `30.1` vs `22.1` |
| Items that block a design (missing specs) | `specReadiness` gaps |
| Catalogue items never priced | `3.0_components` |

`agent_attention` unions them. An agent reads it on a schedule and reports the
rows above a severity — which is the whole "send me reports of what to pay
attention to" feature, without any agent needing write access at all.

---

## 7. Build order, and why

1. ✅ **Attention layer** — `agent_attention` + `/api/agent/attention*`.
2. **`INDEX.md`** ✅ **+ read views** — the views are still to do.
3. ✅ **Design API routes** — `/api/agent/design/mounting` and `/design/system`,
   running the same engines the screens run, resolved at the customer's tier.
4. **`agent_runs` + catalogue write RPCs with dry-run.** Data entry and bulk
   update — the highest-volume, lowest-risk writes.
5. **Sell-side RPCs**, in ladder order: quote, then advance, then DO, then
   invoice. Money last, and each one moves an invariant out of React and into
   SQL as it goes.
6. **Sell-side runbook**, written against the RPCs once they exist.

**Until step 5 lands, no agent writes a sell-side document** — not because of
permissions, but because §0 means the result would be quietly wrong.

---

## 8. Open questions for the owner

- **Does moving the sell-side totals into a DB trigger risk the app?** The app
  would keep computing them for display; the trigger would become the authority.
  Worth doing regardless of agents — it is the same class of bug the buy side
  already fixed with `recalculate_po_total`.
- **One login per agent, or one shared agent login?** One each: attribution is
  per-user, and revocation is `banned_until = 'infinity'` on that account alone.
- **How much may an agent do unattended?** Suggested default: reads and dry-runs
  unattended; real writes queued for approval until a given action has proven
  itself over a few weeks.

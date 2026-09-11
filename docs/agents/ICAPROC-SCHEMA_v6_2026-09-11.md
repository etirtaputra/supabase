# ICAPROC — the schema, for agents

> **Read this before your first query. Never guess a table name.**
>
> Written 2026-09-06, revised 2026-09-07, 2026-09-09 and 2026-09-11, against `main` @ the
> commit that carries it. Row counts are from those days and drift; the NAMES
> and the RULES are what matter.
>
> **v6 adds §3.1, and it is the most important section in this file for anyone
> answering a question about price.** A tier price you cannot find in a table is
> not a missing price — it is a COMPUTED one. Read §3.1 before you report any
> tier as empty.
>
> Why this file exists: on 2026-09-06 an agent queried `batteries`, got 3 rows,
> and reported it as the catalogue. The real figure is 27. The table names here
> are not guessable — no one invents `3.0_components` — so guessing produces
> confident, wrong answers instead of errors.

>
> Part of the ICAPROC agent packs — `docs/agents/INDEX.md` names the current
> version of each. If this file is not the one the index names, it is stale.

---

## 0. Five tables that will lie to you

**Never read these. They are abandoned leftovers, kept only because dropping
them has not been authorised yet.**

| Dead table | Rows it shows | The truth |
|---|---|---|
| `batteries` | 3 | 27 in `3.0_components` |
| `pv_modules` | 5 | 13 |
| `hybrid_inverters` | 7 | 48 |
| `on_grid_inverters` | — | 23 |
| `solar_charge_controllers` | — | 72 |

There is **one** product table: `3.0_components`. If an answer about products
did not come from it, the answer is wrong.

---

## 1. The catalogue — `3.0_components` (~1,005 rows)

Everything about an item: identity, specs, price, stock links.

| Column | Meaning |
|---|---|
| `component_id` | the key everything else joins on |
| `internal_description` | **OUR** name. The only name a customer may see. |
| `supplier_model` | the supplier's code. **Never customer-facing.** |
| `brand` | buy-side sensitive; hidden from sell-side roles in the app |
| `category` | enum, see below |
| `specifications` | `jsonb` — the spec fields (see the design pack) |
| `norm_value` | capacity in the category's base unit (Wp, Wh, W, A) |
| `selling_price_idr` | list price; **null or 0 means unpriced, not free** |
| `archived_at` | **NOT NULL = retired.** Exclude it from anything current. |
| `quote_cost_mode` | `'hidden'` = never offer on a customer document |

**`category` enum** (`ac_cable`, `switchgear` and `monitoring` were split out of
`accessories` on 2026-09-06):

```
pv_module · on_grid_inverter · inverter_charger · power_inverter
batteries · portable_power · solar_charge_controller · mounting
pv_cable · ac_cable · switchgear · monitoring · accessories
solar_pump_inverter · ups · stabilizer · ev_charger
standing_cabinet · wallmount_cabinet · non_stock
```

`non_stock` is project one-offs and cable tray — not a shoppable aisle.

**Offerable = not archived AND not `quote_cost_mode = 'hidden'`.** Both, always.
Asking only one of them is how a retired module kept appearing in the mounting
designer for two days.

---

## 2. EPC projects — the `10.x` family

| Table | Rows | What |
|---|---|---|
| `10.0_project_quotes` | 44 | the proposal header |
| `10.1_quote_sections` | 488 | sections within a proposal |
| `10.2_quote_items` | 1,441 | line items |
| `10.3_quote_activity` | 571 | the audit log |

Header columns worth knowing: `quote_number`, `quote_date`, `customer_name`,
`project_description` (the capacity is prose in here, not a number column),
`project_type`, `status`, `created_by_email`.

**THE REVISION RULE.** A quote number with a `-REV` / `-REV2` suffix
**supersedes its base**, and the highest REV is the current one. They are
separate rows, all still present.

> Worked example, 2026-09-06: `Q-20260705-6SZ3` MidPlaza 1.81 MWp (sent),
> `-REV` 1.26 MWp (draft), `-REV2` **1.63 MWp** (draft). Reporting "largest =
> 1.81 MWp" is true of the original and misleading about the deal. Always say
> which revision, and whether a later one exists.

---

## 3. Sell side

| Table | What |
|---|---|
| `20.0_customers` (489) · `20.1_customer_contacts` | CRM |
| `21.0_price_tiers` · `21.1_item_tier_prices` (463) | tier pricing — **read §3.1, these do not hold what you think** |
| `22.0_sales_quotes` (11) → `22.1_sales_quote_items` (33) | **`_items`, NOT `_line_items`** |
| `24.0_delivery_orders` → `24.1_delivery_order_items` | DO |
| `25.0_sales_invoices` → `25.1_sales_invoice_items` | AR |
| `26.0_customer_receipts` | payments in |
| `27.0_aftersales_cases` → `27.2_aftersales_updates` | service desk |
| `28.0_support_letters` → `28.1_support_letter_items` | Surat Dukungan |

### 3.1 TIER PRICES ARE MOSTLY NOT STORED. Read this before answering.

**The failure this section exists to prevent happened on 2026-09-11.** An agent
was asked to copy eight DEYE items into another system "including the selling
prices and the tiers". It queried correctly, found a Tier-1 price on each, found
nothing for Tier-2 and Tier-3, and reported:

> *"All 8 items only have T1 set — T2/T3 are empty in ICAPROC itself."*

**That was right about the database and wrong about the business.** Every one of
those items has a Tier-2 and a Tier-3 price. The sales desk quotes them daily.
They are on the screen. They are not in any table.

Here is the actual model:

| What | Where | Stored? |
|---|---|---|
| **Net price = Tier-1** | `3.0_components.selling_price_idr` | **YES** |
| A tier somebody PINNED by hand | `21.1_item_tier_prices.override_price_idr` | **YES** |
| **Every other tier** | nowhere | **NO — computed** |

Each tier marks UP from the one below it:
`tier[i] = tier[i-1] ÷ (1 − step%)`, rounded up to the price step in Settings.
The step lives in `21.0_price_tiers.default_discount_pct` (a legacy column name
— it is a MARKUP step, not a discount), and the first active tier is the net,
whose step is ignored. An override replaces that tier's price outright AND
becomes the base the next tier chains from.

Concretely, `DEYE BOS-A-Pack7.68` on 2026-09-11: Tier-1 26,000,000, **zero rows
in `21.1`**, and the screen shows Tier-2 27,369,000 and Tier-3 28,810,000.

**So: an empty `21.1` means NO OVERRIDE. It never means no price.**

#### How to get a tier price

```
GET https://icaproc.com/api/agent/prices
GET https://icaproc.com/api/agent/prices?search=deye%20bos-a
GET https://icaproc.com/api/agent/prices?component_id=<uuid>
Header: Authorization: Bearer <access_token>
```

It runs the SAME function the Selling Prices grid runs (`computeTierChain`),
server-side, and returns every active tier per item with a `source` of `net`,
`override` or `chain` — so you can tell a negotiated price from a computed one.
It answers as the caller: a role that may not see selling prices is told so,
rather than handed an empty list it would go on to describe as "unpriced".

**Do not re-implement the chain.** Not in SQL, not in your own arithmetic, not
"×1.05 should be close enough". Rounding, the step per tier and the override
rule all live in one function, and a second implementation is wrong the day
somebody changes a step in Settings — silently, in your favour, in a number a
customer is quoted.

---

`22.0_sales_quotes` carries one row through the whole lifecycle — `status`
walks `draft → validated → sent → accepted → ordered → invoiced → preparing →
delivered`, and the SO/INV/DO numbers are stamped onto the same row by a
trigger as it passes each milestone.

> ### Read the sell side. Do not write it — not yet.
>
> `22.1_sales_quote_items` carries **no triggers at all** (checked against
> `pg_trigger`, 2026-09-07). `22.0_sales_quotes` stores `subtotal`,
> `ppn_amount` and `grand_total` as plain columns, and the only thing that
> computes them is the sales editor in the browser (`app/sales/[id]/page.tsx`:
> sum the non-section lines, add PPN, write all three).
>
> So inserting a quote item over the API changes nothing on the header. The
> document keeps its old total and looks perfectly normal — no error, no
> mismatch flagged anywhere — until someone invoices it. The same is true of
> `24.0_delivery_orders`: it posts nothing to `30.0_stock_movements`, so a
> delivery written directly leaves the stock ledger claiming goods that have
> left the building.
>
> This is why the sell-side write verbs are not built yet. It is not a
> permissions gap you can work around by having the right role; the result
> would be quietly wrong, which is worse than refused.

## 4. Stock

`30.0_stock_movements` (174, append-only ledger) · `30.1_stock_balances` (138,
trigger-maintained) · `30.2_goods_receipts` · `30.3_warehouses` ·
`30.4_serial_numbers`

Balances are **derived**. Never write them; post a movement.

## 5. Buy side — not every agent's business

`1.0_companies` · `2.0_suppliers` (37) · `4.0_price_quotes` (137) →
`4.1_price_quote_line_items` (927) · `5.0_purchases` (226) →
`5.1_purchase_line_items` (651) · `6.0_po_costs` (341) ·
`7.0_competitor_prices` · `9.0_exchange_rate_history`

**Since 2026-09-06 the database enforces this**, not just the app: writing any
of these needs `owner`, `buy_admin`, `data_entry` or `finance`. A Project
Engineer login is refused. Reads are still open to any signed-in user — that is
the next thing to tighten, so treat supplier costs as confidential regardless
of whether a query happens to succeed.

---

## 5a. Totals: which are derived, and how the derivation bites

Four total columns, three different mechanisms. Getting this wrong has cost
real money twice, so it is written out in full.

| Column | Who computes it | What you do |
|---|---|---|
| `5.0_purchases.total_value` | trigger `recalculate_po_total()` on the LINE ITEMS | write the lines first, state the total after — or omit it |
| `4.0_price_quotes.total_value` | **nobody** — the New Deal form computes `items + freight` and writes it | state it, or the quote has no total |
| `22.0_sales_quotes.subtotal / ppn_amount / grand_total` | **nobody** — the sales editor computes all three | don't write these documents yet (§3) |
| `30.1_stock_balances` | trigger, from the movement ledger | never write it (§6) |

### The PO trigger keeps freight, and it measures against what exists

`recalculate_po_total()` fires on `5.1_purchase_line_items`. It does not
replace the total with the line sum — it preserves whatever the total exceeds
the lines by, because that difference is the freight the supplier bills on top:

```
delta       = total_value − (line-item sum BEFORE this change)
total_value = (line-item sum AFTER this change) + delta
```

Which is correct, and has one sharp edge. **State a total on a PO that has no
lines yet and the delta is measured against zero** — the whole stated total is
read as freight, and the first line insert then stacks the goods on top of it.
The total lands at exactly twice the goods.

That is not hypothetical: `PO-149-MBS-08-2026` read IDR 1.619.460 against IDR
809.730 of line items, and `EB.42277` / `EB.42324` the same (owner,
2026-08-24). An agent reproduced it independently on 2026-09-07 — a PO stated
at 1,724,385 with no lines, then lines summing 1,553,500, landing at 3,277,885
— and concluded that *editing any field* on a PO doubles the total. It does
not. `5.0_purchases` carries no total-touching trigger; the damage happens at
insert and the first line-item write is only what reveals it.

**The rule: lines first, total last.** Then the delta is measured against real
goods, freight survives every later edit, and nothing about touching
`document_url` or `status` is dangerous. `app/purchasing/page.tsx` does exactly
this (`stampPoTotal`, written after the line inserts); the purchasing runbook
carries it as rule #1.

**The rule does not transfer to `4.0_price_quotes`.** That table has no total
trigger — only `copy_sku_trigger` on its line items, which fills descriptions.
Omit `total_value` there and it stays null forever.

---

## 5b. Start here after you sign in

```
GET /api/agent/onboarding
Header: Authorization: Bearer <access_token>
```

One call. It answers AS YOU and returns your email and role, the signal kinds
you may see and the ones you may not, the endpoints available to you, the
documents to read with their **current filenames**, and the standing rules.

Read it at the start of every session. The document filenames carry a version
and a date, so a pack you were handed weeks ago may no longer be the current
one — this endpoint is generated from the same registry the repository tests,
so it cannot name a file that does not exist.

## 5c. What needs attention — ask the API, don't invent the query

Two read-only endpoints on `https://icaproc.com`. Send your access token; they
answer AS YOU, so what you get back is exactly what your role may see.

```
GET /api/agent/attention/summary
GET /api/agent/attention?severity=high&kind=po_late,stock_short&limit=50
Header: Authorization: Bearer <access_token>
```

Every response carries `visible_kinds` and `hidden_kinds` for your role.
**Report against those, never against an empty list.** "No overdue invoices"
and "AR is outside what I can see" are different claims, and only one of them
is honest when `ar_overdue` is in `hidden_kinds`.

The eight signals: `ar_overdue` · `po_late` · `quote_quiet` · `below_cost` ·
`stock_short` · `unpriced` · `no_specs` · `landed_cost_open`. Each row gives `severity`
(high/medium/low), `subject`, `detail`, `amount_idr`, `age_days`, and
`ref_table` + `ref_id` to drill into.

Use these rather than writing your own aggregate over `25.0` and `26.0`: the
rules are maintained in one place, and a hand-rolled version will disagree
with the one the owner sees.

**`landed_cost_open` is the one to escalate, not just report** (added
2026-09-09). It fires when an IMPORT has been received and the supplier paid,
but no PIB / OPS charge was ever entered against the PO. Those charges are part
of landed cost: until they exist, the moving-average cost of everything that
container brought in is understated, so COGS is understated and gross profit on
every one of those items reads too high — on the P&L, on the item hub, in any
margin you quote. A missing payment row is a wrong margin, not untidy data.

Currency decides whether a customs bill is owed at all: 28 of 30 received
foreign-currency POs carry PIB, against 3 of 25 IDR ones, so the signal only
looks at non-IDR orders. Two POs were sitting in this state when it shipped —
`EB.41206` (378 days) and `PIO-2025019` (328 days), neither of them on the
Progress board, which only shows POs with `track_progress`.

### Designing — call the engine, never re-derive it

```
GET  /api/agent/design/mounting     the rail lengths, mount types, panel
                                    presets and mounting systems to choose from
POST /api/agent/design/mounting     { panelCount, panelLengthMm, panelWidthMm,
                                      railLengthMm, numberOfRows?, panelSpacingMm?,
                                      panelThicknessMm?, mountType?, orientation?,
                                      customerId?, series?, railProfile? }
POST /api/agent/design/system       { systemType, panelComponentId, customerId?,
                                      gridVA?/gridPhase?/dcAcRatio?    (on-grid)
                                      loads[]/autonomyDays?/pshHours?  (off-grid)
                                      minCellTempC?, rows?, railLengthMm?, … }
```

These run **the same v11 and v7/v8 engines the Design Mounting and Design
System screens run**, resolved against the same catalogue at the same
customer's tier. If a number here disagrees with the screen, one of them is
broken — there is no second implementation to blame. **Never compute a bill of
materials yourself**, and never re-derive a string length: post to the engine.

What comes back, and what you must carry into any report:
- `lines` — the resolved bill of materials, each with `resolved`, `candidates`
  and a `warning` where the catalogue could not satisfy the role.
- `strings` — `rule`, `minCellTempC`, `vocAtMinTempV`, `maxSeriesLength`,
  `flatRuleMaxSeriesLength`. **A string length without its rule and temperature
  is not a report** (see the solar design pack §5).
- `notes` — every engine warning plus unresolved / unpriced / short counts.
  Dropping these drops the engineering.
- `pricing.tierCode` — which tier priced it.

The candidate pool is the catalogue filtered to OFFERABLE and design-ready
items, so an item that is archived, Cost-Basis Hidden, or missing the specs its
category needs cannot enter a design. You cannot pass in a module of your own
invention; `panelComponentId` must be a real catalogue row.

---

## 6. What no one may write

Maintained solely by `SECURITY DEFINER` triggers. Attempts are denied, and that
is deliberate — it is what makes the audit trail worth having:

`21.3_item_price_history` · `22.3_sales_activity_log` · `30.1_stock_balances`

---

## 7. Your identity is in your token

Sign in with the **anon key + your password**. Every data call then carries
your JWT, and 14 audit triggers read your identity from it:

```sql
SELECT email INTO actor FROM user_profiles WHERE id = auth.uid();
actor := COALESCE(actor, 'system');
NEW.created_by_email := actor;    -- overwrites whatever you send
```

You cannot forge that name and cannot forget it.

**Never ask for or accept a service-role key.** It bypasses row-level security
entirely and makes `auth.uid()` NULL, so every row you write is stamped
`'system'` and the append-only logs in §6 stop being append-only. Losing
attribution is the point of the account, not a side effect.

---

## 8. Habits that would have prevented every mistake so far

1. **Name the table with the number.** "3 batteries" was wrong because of the
   table, not the query. Say where a figure came from.
2. **A name you guessed is not a name.** If it is not in this file, ask.
3. **Check for a later revision** before calling anything the biggest, latest
   or current (§2).
4. **Exclude `archived_at IS NOT NULL`** from anything describing what is
   available now.
5. **An error says where a failure surfaced, not where it lives.** A 500 naming
   the database is a claim to test, not a diagnosis — and the cheapest test is
   usually "can anything else reach this system right now?"
6. **Label a hypothesis as a hypothesis.** "The auth endpoint returned 500,
   cause unknown" is a report. "The project is paused" was a guess that cost an
   hour.
7. **A rule you derived from an incident is a guess about the mechanism.** You
   saw what happened; you did not see why. Write down the observation and the
   rule separately, so the next reader can correct one without losing the
   other. The PO-total rule in §5a is the case in point: the remedy an agent
   reached for was safe, the mechanism it inferred was wrong, and the wrong
   mechanism would have made every later agent afraid to edit a PO at all.
8. **Your notes are not the packs.** Write what you learn — it is how a wrong
   belief gets caught — but keep it in your own output folder. A pack is
   written from the shipping code downward and the code wins every
   disagreement; notes are written from experience upward and record your
   mistakes with the same confidence as your successes.
9. **A number that is not in a table may still exist.** §3.1 is the case that
   taught this: tier prices are computed, not stored, and "the table is empty"
   was a true sentence that produced a false report. Before you call anything
   missing, ask whether the app DERIVES it — and if it does, find the endpoint
   that derives it for you rather than reading the parts and guessing the whole.

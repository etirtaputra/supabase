# ICAPROC — thread handoff

**Last updated: 2026-09-09** · head of `main` at that point: `1c888da` (see §4, §6)

> This file is ALWAYS at `docs/HANDOFF.md` — never date the filename, never
> start a second copy. Every thread opens by reading it, and every thread that
> ships a module updates it before finishing: refresh §4 (what shipped) and
> replace §6 with the next module. Git history keeps the dated versions.
> **No next module decided? Go to §7** — it says what to do.

## 0. What this is

ICAPROC is an **item-centric distribution ERP** — Next.js 16 (App Router) + Supabase,
dark-themed, Tailwind via CDN. It is the company's bid to own its own operating
system: own the data, cycle items through at a profit, and let the same clean
item/price/spec data eventually feed a public website.

**Read these two files before doing anything:**
- `CLAUDE.md` (repo root) — git workflow, mission, standing rules.
- `docs/ERP_ROADMAP.md` — vision, build sequence, locked architectural decisions,
  naming conventions, per-module kickoff specs. **Build one module per thread.**

---

## 1. Infrastructure — the three backends

### GitHub — `etirtaputra/supabase`
- **Commit and push directly to `main`. Never to a sub-branch.** (Owner's rule,
  in `CLAUDE.md`.) If the harness assigns you a `claude/...` branch, do the work
  there if you must, then `git push origin HEAD:main` and move the local checkout
  onto `main` (`git checkout main && git reset --hard origin/main`).
- Do **not** open a pull request unless explicitly asked.
- No `gh` CLI in this sandbox — use the `mcp__github__*` MCP tools if you need
  the GitHub API. Plain `git` over HTTPS works fine for fetch/push.
- Head of `main` at handoff: see §4 — `7f78972` (sales merge), `7e705cb` (paging
  loops) and the indexes commit on top of it.

### Vercel — https://vercel.com/etirtaputras-projects/supabase/deployments
- Production deploys **automatically from `main`**. Pushing to main IS the release.
- **No preview deployments** (owner's rule, 2026-08-03). Do not create or trigger
  Vercel preview deploys, and do not push branches expecting a preview URL.
- There is no `vercel.json` and no `.vercel` dir in the repo — config lives in the
  Vercel dashboard. `mcp__Vercel__*` MCP tools are available for reading
  deployments, build logs and runtime errors if a deploy goes red.

### Supabase — project ref `xijgplktpnpnstgeolfa`
- Client is created in `lib/supabase.ts` from `NEXT_PUBLIC_SUPABASE_URL` /
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`. **`.env.local` does NOT exist on a fresh
  container** — `/preview` 500s without those two variables, and placeholders
  are enough (it queries nothing).
- **The sandbox proxy returns 403 on CONNECT to `xijgplktpnpnstgeolfa.supabase.co:443`,
  so `fetch`/`curl` against Supabase from a script will fail.** Use the
  `mcp__Supabase__execute_sql` / `list_tables` / `apply_migration` MCP tools instead —
  those work. Do not try to disable TLS verification or unset `HTTPS_PROXY`.
- `cdn.tailwindcss.com` is also blocked by the proxy — see §5 for the workaround.
  **`fonts.googleapis.com` and `fonts.gstatic.com` ARE reachable**, so a measuring
  replica can load the real Rubik rather than guessing with a fallback face
  (verified 2026-08-25 — check `document.fonts.check('500 13px Rubik')` in the
  page and print it, so a wrong-font measurement can never be reported as fact).
- Table-prefix convention: buy-side `1–9`, project quotes `10.x`, CRM `20.x`,
  pricing `21.x`, sales quote/SO/DO/invoice/receipt `22–26.x`, inventory `30.x`.
- **THERE ARE TRIGGERS. The app is not the only writer.** `5.1_purchase_line_items`
  runs `recalculate_po_total()`, which rewrites `5.0_purchases.total_value` on
  every line insert/update/delete — it cost a day on 2026-08-24 because nothing
  in the app code mentioned it. Before trusting any column the app also writes,
  check: `select c.relname, pg_get_triggerdef(t.oid) from pg_trigger t join
  pg_class c on c.oid=t.tgrelid where not t.tgisinternal;`
- To EXPERIMENT against production safely, wrap inserts in a `DO $$ … $$` block
  that ends in `RAISE EXCEPTION` — the message comes back as the error and the
  whole block rolls back. That is how the doubling was proved and the fix
  verified, with no residue.

---

## 2. Standing rules (owner's, non-negotiable)

1. **Everything connects — path of least resistance.** Whenever a module or feature
   is built or touched, CHECK its interconnections: does the new document link to
   the records it belongs to (invoice ↔ payment, DO ↔ stock, quote ↔ customer), do
   adjacent screens reflect it without re-entry, and does the next obvious step sit
   one click away (pre-selected, pre-filled, where the user already is)? Nothing
   ships as an island.
2. **AI-first.** Propose the next best step and its economic consequence; let the
   human decide.
3. **The honesty doctrine.** A number a role cannot see the inputs for is never
   rendered — and a column a role may not see is never *fetched*. Check the network
   tab, not just the DOM.
4. **Access is ONE rule.** `constants/navigation.ts` owns `destinationAllowed()` /
   `canOpenPath()`; `constants/dashboardWidgets.ts` owns `widgetAllowed()` in the
   same vocabulary. `lib/access.test.ts` and `lib/dashboardWidgets.test.ts` read the
   app source and fail the build if a gated screen or widget stops asking.
5. **Changelog house rule (2026-07-30).** Every update shipped to main adds an entry
   to `constants/changelog.ts` **in the same commit**, newest first, `at` in ISO UTC.
   Write it in the user's language — what someone will SEE changed.
6. **`constants/palette.ts` is GENERATED** by `scripts/generate-palette.js`. Never
   hand-edit it; edit the generator and re-run.
7. **Measure before theorising.** The owner has been burned by confident estimates.
   Reproduce in a browser, print the numbers, and correct the record out loud if an
   earlier number of yours was wrong.
8. **Indonesian i18n is a phrase book keyed by the English string.** Use `tf()` for
   whole sentences with `{placeholders}` — never concatenate translated fragments,
   and check the translated string still fits its slot. **The app is FULLY
   Indonesian, menus included** (owner reversed the menus-stay-English rule on
   2026-08-25). Only the codes in `KEEPERS` (`lib/i18n.ts`) stay English, and a
   keeper is declared there rather than translated to itself. `lib/i18n.test.ts`
   fails the build if a nav label, group header, dashboard panel, quick action,
   role or document status ships with no Indonesian word and no keeper entry.

## 3. Definition of done (run all four before committing)

```bash
npx tsc --noEmit     # must be clean
npm test             # node --test "lib/**/*.test.ts" — 334 tests at handoff, all pass
                     # WATCH THE TOTAL, not just the pass count: a suite that
                     # fails to IMPORT reports as 1 failure, not 26 missing tests
npx eslint           # 413 problems at handoff (293 errors); just don't ADD any
npm run build        # next build must be green
```
Plus: a `constants/changelog.ts` entry in the same commit.

---

## 4. What the previous threads did (for context, all shipped to main)

### 2026-09-10 (later) — the Product list shows what matters

Owner: *"The list should display: Description | Stock | Incoming | Tier 1 |
Tier 2 | Tier 3 | Category | Updated. And keep the Warranty and Sheet inside
the dropdown when users click. This way it shows what matters."*

**One "Sell Price" column became one column per active tier.** The old column
showed the net and then wrote "3 tiers ▾" underneath — so the answer to "what
does a Tier-2 customer pay?" was permanently one click away, on a screen whose
entire job is answering that. Three columns, each still click-to-copy and
click-to-add-to-a-text-quote.

**Nothing was lost in the swap, and the reason is a rule worth keeping in
mind:** the net price IS Tier 1 (`lib/tierPricing.ts` — "the price entered on
an item IS the NET price = Tier-1"), so the first tier column carries exactly
the number the old column did. `productColumns.test.ts` asserts that sentence
is still in `tierPricing.ts`; the day it stops being true, this table starts
under-reporting and the test says so.

**Warranty and Sheet left the TABLE, not the ROW.** Both are in the expansion,
where they are also editable, and both are still sortable from the Sort menu —
the question survived the column. The test asserts all three, because "moved"
and "deleted" look identical in a diff that only removes lines.

**Two things that would have gone wrong quietly:**

- The tiers are DATA (`21.0_price_tiers`). Switch them all off and a table that
  renders "one column per tier" renders no price at all. There is a fallback
  column carrying the net, because a price list with no prices is worse than
  any tier arrangement.
- An owner who hid "Sell Price" in Settings › Lists meant *"these people do not
  see prices"*. Dropping the retired `price` key would have turned prices back
  on for them the day this shipped, silently. `LEGACY_PRODUCT_COLS` maps it to
  `tiers`, and the test refuses a retired key that maps nowhere without saying
  so.

Also: the legend under the toolbar still said "click a row for tier prices",
which had just stopped being true; the CSV export now carries the upper tiers
too, marked `_calc` because only the net can be written back by import.

632 tests pass, nine of them new; build clean.


### 2026-09-10 — the price arrow, and where a colour may carry an opinion

Owner: *"i reverted the color when price goes up it should be red instead of
green, because it is bad. But i made a mistake… at first i wanted to revert the
color because when material price goes up, it means it's bad. But i now realize
it's not intuitive."*

**Up is green again, down is red** — Product Cost Lookup, Item Cost Forensics,
and the category-trend ticker on Spend Overview.

Worth recording WHY, because the reverted premise was correct. A rise in
material cost is bad news. The conclusion still failed, and the reason is that
a red ▲ makes the colour answer a different question from the arrow: the reader
has to work out whether the colour is about the direction of the number or
about somebody's opinion of it. **A colour can say direction unambiguously. It
cannot carry two meanings.** Judgement still gets said — in the word beside the
arrow ("rising"), in a warning, in a margin figure that reddens on its own
terms. Words can hold a value judgement without making the reader guess.

**The rule has now been flipped twice, and both times it was written out inline
at every call site.** So "flip it" meant grepping for colour names and hoping
the grep was complete. It is `lib/priceMovement.ts` now — `priceMovement()`,
`PRICE_ARROW`, `PRICE_TONE`, `PRICE_INK`, `PRICE_WORD` — and
`priceMovement.test.ts` reads all three screens and fails if any of them picks
a direction colour or arrow for itself again. A third flip is one line.

The Spend Overview ticker also gained a **0.5 % deadband** (it already had the
thresholds, they were just written twice, once per block): an average that
moved a fifth of a percent is not a category "rising".

**Deliberately NOT changed, and this is the interesting boundary.** The
cost-impact preview on a proposal (`app/proposals/[id]/page.tsx`) and the stock
reconciliation variances look like price deltas and are not. "This cost update
takes Rp 4.2 m out of THIS proposal" is a judgement about money now, and it
sits in the same row as a gross-margin figure that goes red on its own terms —
colouring the rise green there would put two contradictory colours on one line.
A ticker reports; a variance judges. Only the reporting ones follow this rule,
and the module says so, because a convention with no stated scope spreads by
resemblance.

623 tests pass, ten of them new; build clean.


### 2026-09-09 (latest) — system engine v9: six defaults that were applied in silence

From MANDA, after PT Kayan Plantation (440 kWp hybrid PV + BESS): six sizing
errors on one design, all caught by Mr. Wendy on review rather than by the
engine. She wrote a spec; this implements it.

**The pattern is the whole finding, and it is worth reading once.** In all six
cases the engine had a plausible DEFAULT for something the SITE should have
answered, and used it without saying so. A number nobody chose reads exactly
like a number somebody did. So v9 changes no arithmetic at all — every golden
number is what it was — and instead adds four inputs plus six places where an
unanswered question now speaks.

| | Input | Default | Says something when |
|---|---|---|---|
| 1 | `demandFactor` | 1.0 | not stated (housing estates are 40–60 %) |
| 2 | `powerLossFactorFs` | none → ×1.25 | never; the result states which rule ran |
| 3 | — | — | inverter headroom under 30 % |
| 4 | — | — | battery string voltage over 95 % of the port maximum |
| 5 | `cableRunPerStringM` | 6 m/panel | not stated (a ROOFTOP figure) |
| 6 | `pshSource` | `'estimate'` | not stated |

Demand factor divides the load table and **not** the surge — a diversified
estate still has to start every motor it owns. Fs replaces the 1.25 safety
factor when the drawing states one: at Fs = 0.30 that is ×1.4286, which is the
14 % that undersized Kayan.

**Two findings inside v7's own golden scenarios, which the spec expected to be
clean.** The lead-acid parity case sizes a 3 kW inverter against a 2,625 W
continuous requirement — 14 % headroom, with a 3,600 W surge requirement above
the unit's rating. The "parallel rather than fail" case installs 60 kW on 50 kW:
20 %. Neither is a porting bug; both are v7 decisions nobody had been asked to
look at. The numbers stay (they are parity tests) and both now carry an
asserted warning, so the finding is in the suite rather than in a note.

**Change 4 needed a field the engine did not have.** The spec assumed
`inverter.max_battery_voltage_vdc`; `HybridInverterSpec` had only the NOMINAL
bus. They are different numbers and the gap is the bug: a bank is sized to the
bus CLASS (48, 384…) and wired at the pack's stated voltage, and every LiFePO4
pack reads 6.67 % above its class — 8 × 51.2 V is 409.6 V, not 384 V. Added as
an optional field, fed from the catalogue's `battery_voltage_range_vdc`
("500~900" → 900) through a new `specRangeMax()` in `lib/specSchema.ts`.
**It is nearly always silent today: 49 of 50 inverter-chargers have that spec
blank.** When it is missing the result says `batteryVoltageCheck: 'unknown'`,
never `'ok'` — and reports the real string voltage so it can be checked by hand.

**Wired end to end, not just in the engine.** The four inputs are on the
Design System screen (blank by default — pre-filling the box would answer the
question on the designer's behalf) and on `/api/agent/design/system`, which now
returns the provenance beside the numbers. The loads step shows the diversified
figure next to the table's own sum when a demand factor is set, because a screen
showing 2,000 W while the engine sized 1,000 W is how the two start disagreeing.

**The version constant now has one home.** `version: 8` was written by hand in
the API route and in `SystemDesigner.tsx`. It is `SYSTEM_ENGINE_VERSION` in
`system.ts` now, and a test fails if a literal comes back to either file.

Pack regenerated in the same commit per the standing rule:
`MANDA-SOLAR-DESIGN_v2_2026-09-06.md` → `_v3_2026-09-09.md`, with §4.1, §4.3, a
new §4.6 and §9 updated; `INDEX.md` and `lib/agentDocs.ts` follow.

613 tests pass, 23 of them new; build clean.


### 2026-09-09 (latest) — "Within target": the verdict the engine computed and threw away

Owner: *"for selling prices list, we also need a filter 'Within target' or 'In
target'."*

The chip row on Selling Prices read `No price 833 · Below floor 2 · Under
target 0 · Above target 105 · Unclassified 65`. Add those up against 1,007
active items and a handful are unaccounted for — and nothing on the screen said
where they had gone. They were the items that are priced, classified, and
earning exactly what their band asks for: the ones a person reviewing pricing
most wants to see and skip.

**The verdict already existed.** `standingOf()` in `lib/marginProfiles.ts` has
returned `'within'` since margin profiles shipped. `issuesFor()` mapped
`'below'`, `'above'` and `'unclassified'` into the issue set and let `'within'`
fall through to nothing. So the healthy state was computed on every row, every
render, and discarded — which is why it was invisible rather than obviously
missing.

`PriceIssue` gains `in_band`, labelled **"Within target"**, sitting between
Under and Above so the row reads as a ladder. The type's doc comment now says
what it is: a VERDICT set, not a fault list. Four band verdicts, mutually
exclusive, and every priced row with a profile lands on exactly one — both
asserted, because the failure mode is silent undercounting rather than a wrong
number.

**`in_band` and `below_floor` can coexist, deliberately.** The band is judged on
the item's own economics (net price against landed cost); a floor is per tier.
An override can push tier 2 under its floor while the net sits squarely inside
the band. Suppressing the breach because the headline is healthy would hide the
thing that actually costs money.

**The guard that should have caught this, and only covered half the screen.**
Yesterday `has_cost` turned out to be fully built and unreachable, and the fix
was a test pinning the SCOPE chip row to `SCOPE_LABEL`. The ISSUE row beside it
stayed a hand-written list — and was already short a verdict. One row guarded
and one not is not a lesson learned; it is the same bug on the other side of a
divider. Both rows are now pinned to their label maps.

Live count today: about 9 items are within target. Small, and that is the
finding — 104 sit above their band, which is worth its own conversation.

590 tests pass, six of them new; build clean.


### 2026-09-09 (later still) — archived items were still priced

Owner: *"When an item is archived in Item Editor, it shouldn't show in Selling
Prices settings or Products."*

**Half right, and the half that was wrong is worth recording.** `/products` has
excluded archived items since the day archiving shipped (`5636640`), with a
comment saying so. `/pricing` never did: it listed all **1,012** components
against **1,007** active ones — the "71 of 1.012" in his screenshot was the
tell. Two queries there, both fixed: the item list, and the margin-profile
tally that would otherwise have counted rows the list no longer shows.

**Why the existing guard could not have caught it.** `itemVisibility.test.ts`
scans five named pickers and fires when one asks `isHiddenItem` without asking
about archiving. Selling Prices never asked a visibility question at all — it
just fetched everything. The bug was in code that was never written, which is
precisely what a test for a present symptom cannot see.

So the rule is now inverted at the fetch. `fetchAllComponents` still defaults
to including archived rows (the readers that predate the column need them), but
**every call site must declare which side it is on**: pass
`{ activeOnly: true }`, or appear in `INCLUDES_ARCHIVED` with a reason someone
could disagree with. The test enumerates every `.ts`/`.tsx` under `app/` and
`components/` rather than a hardcoded list, so a NEW screen cannot inherit the
wrong default silently. Verified by removing the filter and watching both new
tests go red.

Declared as deliberately including archived items, with reasons: the Item Hub
(the 360° view of a retired item), Stock (an archived item still holds units
somebody must clear), Profitability (an item archived today still sold last
quarter), Tech Specs (comparison against a superseded model, never
customer-facing) and Spotlight (finding a retired item by name is not a broken
search).

584 tests pass, three of them new; build clean; eslint unchanged.


### 2026-09-09 (later) — the correction: receipt does not settle the customs bill

Owner, on the fix above: *"that's true, i realized, PIB and OPS payment hasn't
been entered. But at least it should provide an alarm."*

**He was right and the earlier fix over-reached.** Making receipt short-circuit
everything sent `PIO-2026010` quietly to Done with its customs bill unrecorded.
Receipt short-circuits the PAPERWORK TICKS — goods do not clear customs without
their papers. It does not short-circuit MONEY.

Why it matters, and the reason this is an alarm rather than a tidiness note:
PIB and OPS are part of **landed cost**. Until they are entered, the
moving-average cost of everything that container brought in is understated,
which understates COGS and overstates gross profit on every one of those items
— including on the P&L shipped two commits earlier.

- **`pibExpected(po)`** — currency decides. 28 of 30 received foreign-currency
  POs carry PIB; 3 of 25 IDR ones do. Alarming on domestic orders would cry
  wolf 22 times.
- **`importCostsOutstanding()`** — received AND paid AND import AND no PIB.
  `isComplete` now refuses to finish such a PO, so the card stays on the board.
- **The board shows it**: red frame, "⚠ Goods received …", a line saying
  *landed cost is understated until they are*, and a header count
  "⚠ N awaiting PIB & OPS" listing the PO numbers on hover.

**The board alone was not enough, which is the more important half.** It only
renders POs with `track_progress`. Two imports have been sitting received with
no customs bill and no board presence at all: **`EB.41206` (378 days,
Chinaland Solar)** and **`PIO-2025019` (328 days, Huizhou Epever)**. So the
same rule became the eighth attention signal, `landed_cost_open`, which reads
every purchase order — `migrations/agent_attention.sql`, applied to production
2026-09-09. The migration extends the live view in place via `pg_get_viewdef`
rather than restating seven branches it could drift from, and is idempotent.

`lib/agentApi.ts` gained the signal at `buy_side` capability; the schema pack
was regenerated to **`ICAPROC-SCHEMA_v5_2026-09-09.md`** in the same commit, per
the standing rule.

**Still open, and now visible:** those two POs need their PIB / OPS entered, or
a decision that they never had any. Until then their items' landed cost — and
every margin computed from it — is too low.


### 2026-09-09 — the Progress board could not see that the goods had arrived

Owner, with two screenshots: *"there's a mismatch between Progress in
Purchasing, and deal lookup such as this Renasun's PO."*

`PIO-2026010` (Renasun, RP2026072901) was **Fully Received on 2026-09-08** and
settled to the rupiah — Deal Lookup said exactly that, under COMPLETED. The
Progress board filed the same PO under **Balance Paid**, called it live, and
offered **"Log PIB / OPS"** as the next thing to do.

**Root cause: `milestonesReached` never read the receipt.** Seven milestones,
all derived from payments and document ticks, and not one of them asked whether
the goods had actually turned up. `actual_received_date` — the single fact that
most decisively ends a purchase — was invisible to the board.

Two defects fell out of that, and the second is the worse one:

1. **`nextAction` offered "Log PIB / OPS" on a received, settled order.** The
   file's own header warns against "a board giving advice nobody should take";
   this was that, reached from a direction its author had not considered.
2. **`isComplete` required all seven milestones, so no real PO could ever
   finish.** A domestic supply has no PIB, so `pib_paid` is false forever;
   nobody goes back to tick "Docs Checked" on goods already on the shelf. Every
   settled PO would have sat on that board permanently — the exact Basecamp
   drift the board was built to end.

**The rule now: goods in AND supplier paid = done.** The document ticks are
progress markers on the way to receipt, not gates on it — and receipt implies
them, since nothing clears customs without its papers. Received but NOT paid
stays live, which is the case worth chasing hardest. A card that is done also
stops offering the two manual ticks (a backdated claim nobody will check) and
now says **"✓ Goods received 8 Sep 26"** so the reader can see why.

`isComplete` and `nextAction` take the PO as a second argument now: completion
genuinely depends on the order, not only on the seven booleans.

Checked against the live board: of six tracked POs, exactly one — `PIO-2026010`
— moves. It leaves the live columns for Done, and the board finally agrees with
Deal Lookup. `PIO-2026012` (DP paid, balance outstanding) and `EB.42324` (no
payments yet) are untouched. 577 tests pass, five of them new; build clean.

**Adjacent, NOT fixed:** a `Cancelled` PO with `track_progress = true` would
sit on the board forever for the same reason. There are none today, so it is
noted rather than fixed on speculation.


### 2026-09-09 — the product P&L, and why its COGS column is mostly estimated

Owner: *"a Monthly, Quarterly, Yearly Profit and Loss statement based on the
Sales of Products vs. TUC/COGS of products, but categorized by Product
Categories, and the Item names… where is the most logical and intuitive menu…
make sure that ONLY OWNERS can access this."*

**The menu answer was "it already has a home."** `/profitability` (Insights)
was already owner-only on `canViewEconomics`, already carried GP per item, and
already defined revenue and COGS in `lib/salesFacts.ts`. A separate P&L page
would have been a second door onto one room and an invitation to a second
definition of a sale. It is a THIRD TAB — Profitability · Position · P&L
Statement — reachable in Spotlight as `/profitability?tab=statement`.

- **`lib/plStatement.ts`** — a pure rollup of `SalesFact` into period × category
  × item. `buildPL`, `periodKey`, `periodLabel`, `toCsvRows`. It computes
  nothing about a sale; it buckets and groups. 22 tests.
- **`components/profitability/PLStatementPanel.tsx`** — grain toggle
  (Monthly / Quarterly / Yearly), a measure toggle for the period columns
  (Gross profit / Revenue / Margin %), categories expanding to items, fixed
  Revenue · COGS · GP · Margin columns on the right edge, CSV export.
- **`lib/access.test.ts`** — two new guards: `canViewEconomics` must resolve to
  `['owner']` exactly, and every other role must fail `canOpenPath`. A single
  `true` in the role matrix would otherwise hand landed cost to the sell side.

**Decisions worth keeping:** categories rank by GROSS PROFIT, not revenue —
the whole point is that those two orders differ. One estimated line taints its
whole total ("mostly from the ledger" is not a thing a margin can be). A reader
without cost gets no margin at all rather than a 100% one. And the panel says
*gross profit on goods only* out loud: there is no opex, salary, rent or tax in
ICAPROC, so nothing below that line can be shown.

**WHAT THE REPORT ACTUALLY SHOWS TODAY, and it is the finding of this thread.**
Two months, four item-rows, Rp 5.8M revenue — because the sell side has barely
been used: **192 costed goods-receipts in, 5 units ever delivered out.** And
every one of those four rows' COGS is estimated. Three separate causes, all
verified against `pg_trigger` and the ledger on 2026-09-09:

1. **Two orphaned stock-outs.** `source_id 2f2c219f…`, 2026-07-21, 2 units,
   both correctly costed — pointing at a delivery order that **no longer
   exists**. A DO was deleted without its stock-out being reversed, so stock is
   understated by 2 units and that cost can never attach to a sale.
2. **`DO-20260721-0001` is `delivered` with no movements at all** — the gap
   already logged on 2026-09-07, still open.
3. **The two surviving DOs stamped `unit_cost_idr = 0`.** Root cause found:
   they shipped from warehouse **`G63`**, whose balance row for those items
   reads `avg_cost_idr = 0`; the real cost (857,279 / 446,949) sits in `MAIN`.
   `stamp_stock_movement` prices an out at *that location's* average, found a
   row, read 0, and stamped 0. The trigger is live and working as written — the
   rule is wrong at the edge: when a location holds no cost, falling back to
   the item's overall weighted average is better than recording zero.

**Nothing was mutated** — all three need the owner's decision first.

572 tests pass; `next build` clean; eslint unchanged on the touched files.


### 2026-09-09 — the sell side speaks Indonesian

Owner: *"Continue translating to Indonesian especially for the Sales Side menus,
including the Field Descriptions and Buttons. I realized that my sales support
admin is poor in English."* Then: *"including the Support letters / Surat
Dukungan. She will be handling this part as well."*

**The gap was not a missing translation, it was a missing wire.** `lib/i18n.ts`
had 617 entries and the Sales LIST already spoke Indonesian — but
`app/sales/[id]/page.tsx`, the 2,300-line quotation editor where that person
spends the day, had never imported `useT` at all. Neither had
`components/ui/FulfillmentPanel.tsx` (invoices and delivery orders, rendered
inside that same page), `app/sales/library/page.tsx`, or
`app/support-letters/page.tsx`. Nothing was mistranslated; nothing had been
offered for translation.

Wired and translated, ~330 new phrase-book entries (617 → 944):

- **Quotation editor** — command bar (Validasi · Konfirmasi Pesanan · Tolak ·
  Revisi), header fields, line rows, the price popover, the lead-time control,
  the totals card including the owner-only GP block, the activity log, the
  payments panel and both modals.
- **Fulfillment panel** — Pemenuhan: faktur and surat jalan, their meters,
  the New Invoice and New Delivery Order modals.
- **Description library** and **Surat Dukungan**, list and editor both.
- The leftovers on the Sales list, Delivery queue and Invoice list.

**Five traps this hit, all worth knowing before the next screen:**

1. **`t` shadowing.** Four components already used `t` as a local (`const t =
   draft.trim()`, `tierOptions.map((t) =>`, `TIME_OF_DAY.map((t) =>`). Renamed
   the locals; the translator gets the name.
2. **`<option>` without a `value`.** `{LEAD_TIMES.map((l) => <option>{l}</option>)}`
   stores its CHILD text. Translating the child would have written Indonesian
   lead times into the database. Every such option now carries `value={l}`
   with only the label translated.
3. **The fragment guard.** `lib/i18n.test.ts` rejects a short entry ending on a
   preposition — "Received in", "Fee received on", "Created by", "Ship from",
   "customer is on" were all rewritten as whole phrases or `tf()` sentences.
4. **Entries equal to their own English.** `Status`, `Subtotal`, `Total`,
   `pcs`, `ls / pcs`, `PPN %` are the same word in Indonesian. The identical
   ones are declared in `KEEPERS`; the rest were left unwrapped.
5. **Escaped apostrophes.** `t('… customer\'s tier')` puts a backslash in the
   source, so the orphan guard could not find the English side and reported the
   entry as dead. Switched to the typographic `’` the rest of the app uses.

548 tests pass (the i18n guards among them), `next build` clean, eslint one
problem FEWER than before across the touched files.


### 2026-09-07 — the agent document set becomes enforceable

The owner set up a Google Shared Drive for the agent packs and asked whether any
runbooks existed. One did — `docs/PURCHASING_RUNBOOK.md`, written 2026-08-29
(`e4abe0e`) and never versioned. Answering that turned into a correctness pass,
because his two agents had by then written their own `.md` files into the
drive's output folder, and reading them found a live problem.

**MIRA's notes carried a mutated version of a rule that was already written
down.** She had derived, from a real incident, "`total_value` is trigger-backed
and the trigger adds rather than replaces — never state it on insert." Checked
against `pg_trigger` and the app:

- The incident is real. `recalculate_po_total()` preserves `delta = total −
  (line sum before the change)`, which is the freight billed on top. State a
  total before any lines exist and the delta is measured against zero, so the
  first line insert stacks goods on freight. Her figures reproduce exactly:
  1,724,385 + 1,553,500 = 3,277,885.
- **Her mechanism is wrong.** `5.0_purchases` has no total-touching trigger,
  only `refresh_analytics_view`. It was not the later `document_url` edit;
  the damage happens at insert. Her version would make an agent afraid to
  edit any field on a PO.
- **Her rule is wrong for price quotes.** `4.0_price_quotes` has no total
  trigger at all — `NewDealForm.tsx:319` computes `items + freight` and writes
  it. Following her rule leaves every quote's total null.
- The correct rule had been **rule #1 of the purchasing runbook since
  2026-08-29**, in a file she had never been given.

Shipped:

- **`docs/agents/PURCHASING-RUNBOOK_v2_2026-09-07.md`** — moved out of `docs/`
  and versioned. §4 now carries the delta formula, what the trap is *not*, and
  the price-quote exception; rule #4 no longer blanket-claims totals are
  derived; §1 gains the offerable rule (archived is a legitimate purchase
  match, never an offer).
- **`docs/agents/ICAPROC-SCHEMA_v4_2026-09-07.md`** — new §5a (four total
  columns, three mechanisms), a sell-side write freeze box in §3 (`22.1` has no
  triggers at all; `24.0` posts no stock), §5b for onboarding, and two new
  habits: a rule derived from an incident is a guess about the mechanism, and
  your notes are not the packs.
- **`app/api/agent/onboarding/route.ts`** — the "agents know where to look"
  ask, as one call. Role, visible/hidden signal kinds, endpoints, the CURRENT
  filename of every pack, and the standing rules. Answers as the caller.
- **`lib/agentDocs.ts` + `agentDocs.test.ts`** — the registry behind it. The
  build now fails if a named pack is missing, if `INDEX.md` does not mention
  it, if a superseded copy is left in the folder, or if a filename lacks its
  `_v<N>_YYYY-MM-DD`. The versioning rule is enforced, not remembered.
- **`INDEX.md`** — the Drive folder convention (`00-READ-FIRST` /
  `10-PACKS` / `20-RUNBOOKS` / `90-OUTPUT`), the permissions rule, and a
  section on why agent notes are field notes rather than packs.

Also that day, two smaller things:

- **Text quote mode copies instead of sharing** (owner: *"just make it copied
  to clipboard, it's simpler for Windows OS user"*). `QuoteBasket` called
  `shareOrCopy`, and Windows Chromium DOES implement `navigator.share` — so the
  desk staff got the Windows share flyout, offering Mail and Bluetooth and no
  route into WhatsApp Web. Cancelling it returned `'shared'`, so the toast said
  "Shared" while nothing had been put anywhere. Now `copyOnly` on every
  platform, which also brings the offscreen-textarea fallback the share path
  lacked. `shareOrCopy` is deleted; the single-price copy had already made the
  same move, so there is now one behaviour on both paths.
- **A sell-side audit, prompted by MIRA flagging her own writes.** All 19 rows
  in `22.0_sales_quotes` reconcile exactly — stored `subtotal` / `ppn_amount` /
  `grand_total` against the sum of non-section lines plus PPN — including her
  six. But `DO-20260721-0001` is `delivered` with two real catalogue lines and
  **zero stock movements** (1× ICA550-72HMI, 1× EPEVER XTRA1210N), so on-hand
  reads one high on each. Created `system`, 2026-07-23, long before any agent.
  **Not fixed — awaiting the owner's confirmation those goods shipped**; the
  fix is two `30.0_stock_movements` rows dated 2026-07-21. Three records are
  stamped `created_by_email = 'system'` (`SQ-...0018`, `SQ-...0019`, that DO):
  the attribution loss, in live data.

**Left alone on purpose:** the agents' own files in `90-OUTPUT` — including
`manda_engines_v11_v8.py`, a Python fork of the two engines. It is faithful
today (diffed against `mounting.ts` and `system.ts`) but nothing in CI knows it
exists, so the next engine change makes it silently wrong. The fix is the
design API, which shipped the day before; it needs a message to MANDA, not a
commit.

### 2026-09-06 — MANDA's knowledge pack, and three rounds of engine correctness

The owner introduced a second agent, **MANDA** (Basecamp/timelines, solar
engineering cross-checks, Drive/Sheets/Supabase) and asked how to teach her PV
and mounting design. The answer was not a prompt: the rules already exist as
tested code in `lib/systemDesign/`, so `docs/agents/MANDA-SOLAR-DESIGN.md` is a
TRANSCRIPTION of them, with `MANDA-BOOT-PROMPT.md` as the short prompt that
points her at it. `CLAUDE.md` now carries the standing rule that the thread
changing an engine rule regenerates the pack in the same commit.

**Writing the pack found four defects nobody's tests could see**, because v7's
own fixture (12 V lead-acid, 48 V lithium, `"Lead-Acid (Deep Cycle)"`) divides
evenly and matches the code's casing, while the real catalogue does neither.

1. **`4146b29` — the battery bank.** `series = busV / nominal_voltage_v` had no
   integer guard: a 25.6 V pack on a 48 V bus gave **qty 3.75**. Fixed with
   voltage CLASSES (12/24/36/48/96/192/384, 10 % tolerance so a 51.2 V pack is
   a 48 V bank) and `seriesOnBus()`, which returns a whole number or refuses
   the candidate. Also: the hard-coded `bus !== 48 && bus !== 384` lithium
   filter excluded all five 24 V inverters on the shelf — compatibility is now
   asked of the battery pool, two passes so a catalogue gap costs the chemistry
   and not the quotation. And `battery_type.includes('Lead-Acid')` never
   matched `"Lead-acid (deep cycle)"`, so lead-acid designs silently fell
   through to `pool[0]` (often lithium) and sized at the wrong DoD.
2. **`b8d4cf6` — archived items were still offered.** The owner archived a
   JINKO module and it kept appearing in Design mounting. Not one screen:
   `archived_at` arrived 2026-09-03 and all FIVE customer-facing pickers still
   asked only about Cost Basis → Hidden. `isOfferable()` is now the one
   question, `VISIBILITY_COLUMNS` stops a picker forgetting to SELECT what the
   rule reads, and `itemVisibility.test.ts` reads the app's own source and
   fails the build if a picker asks half the rule. Two modules had been leaking
   (JINKO, and ICA450-72HMG since 2026-09-04).
   *Also fixed here: a regression from that morning's taxonomy commit —
   SystemDesigner still fetched `accessories` alone after `switchgear` and
   `monitoring` split out of it.*
3. **`b8954cb` — string length is a TEMPERATURE question (engine v8).** v7
   sized every string on a flat 0.95 of the inverter maximum. Now
   `Voc(T) = Voc_STC × (1 + β/100 × (T − 25))` against the site's coldest
   expected temperature, per IEC 62548 / NEC 690.7. **`minCellTempC` is an
   input on the designer** (owner asked for it explicitly), default **18 °C**
   for the Indonesian lowlands, stored with the design. Highland sites lower
   it, which shortens strings.
   **Expect LONGER strings**: the old flat margin was equivalent to designing
   for 3–9 °C depending on β, so correcting properly usually fits more panels
   per string. The engine warns when it exceeds what the old rule allowed,
   naming the per-module voltage. 3 of 13 modules have no β (JINKO JKM575N and
   two ICA rows) and fall back to the flat margin **saying so** — no invented
   coefficient enters a safety-bearing calculation.
   The flat rule stays as `vocRule: 'flat'`; the ten v7 parity tests now
   request it explicitly, so they keep testing v7 rather than current practice.

`260fec1` regenerated the pack for v8. 524 tests, no lint problems added
across the whole day.

**MANDA's ICAPROC login — created 2026-09-06.** `project@ptmbs.co`, role
`engineer` (the UI calls it **"Project Engineer"** — no new role was needed).
The address was ALREADY in `allowed_emails` as `engineer`; only the
`auth.users` and `auth.identities` rows were missing, and both were created by
SQL per the runbook below, identity row included. Verified field-for-field
against `adminproject@ptmbs.co`: `aud`, `role`, `email_confirmed_at`,
`banned_until`, one identity, `identity_data->>'sub'` = the user id, provider
`email`, and `encrypted_password = crypt(<pw>, encrypted_password)` true. The
`handle_new_user` trigger built `user_profiles` with role `engineer`.
**A live sign-in could not be tested from the sandbox** — the egress proxy
denies CONNECT to `*.supabase.co` (§1). The owner holds the password; it is
not recorded here or anywhere in the repo.

**First sign-in failed, and it was trap TWO above.** MANDA's password grant
returned `500 "Database error querying schema"` three times and she diagnosed
a paused free-tier project. It was not: the database answered SQL throughout
(and this project is not free-tier). Four token columns were NULL on the new
row — `confirmation_token`, `recovery_token`, `email_change`,
`email_change_token_new` — because the INSERT omitted them. Set to `''` and
verified against `adminproject@ptmbs.co`. **All ten other accounts were checked
in the same pass and none carries a NULL token**, so nothing else was latently
broken. Password still verifies, identity intact, `user_profiles.role`
`engineer`.

What `engineer` grants MANDA: sell-side + Project Quotes; she CAN edit project
quotes and the BoM builder (**costs and margins are visible there**), manage
customers, edit sales documents, handle service tickets, and see selling
prices. She CANNOT reach the buy side, brands/supplier relationships, pricing
tiers, stock, banks, receipts, analytics or user management.

**Still open from this work**
- `EPEVER UC3522-1250P20C 3.5kW/24V` carries `battery_nominal_voltage_vdc = 48`
  — the name says 24 V. One of the two is wrong; needs a datasheet. Offered to
  sweep the inverter rows for name-vs-spec disagreements; not started.
- `DEYE SUN-STS500L` (a transfer switch?) left in `accessories`; the SUNTREE AC
  EV Charger sits there while an `ev_charger` category exists; three
  `wallmount_cabinet` rows are "Extra carton", i.e. packaging not products.
- Still outside both engines (pack §9): MPPT lower bound, Isc and string
  fusing (`max_series_fuse_a` is declared and never read), cable voltage drop,
  wind/snow and roof capacity, shading, PSH as an input rather than a lookup.

### 2026-09-05 (later) — the product taxonomy: one hierarchy, readable names

The owner reopened categorisation himself (§6.3 decision 4 said it was
deferred; it is now partly settled). His question was the shape of the answer:
*"we should have the Main Product Categories, and its sub-categories… but what
I don't want is an extra column that waste space in ICAPROC or Item Editor."*

**Three levels, and only the middle one is stored.**

| Level | Example | Where it lives | New storage |
|---|---|---|---|
| Main category | Inverters | `MAIN_CATEGORIES`, derived | none |
| Category | `inverter_charger` | the existing `category` enum column | none |
| Sub-category | Hybrid | a declared spec field in `specifications` | none |

- **`constants/productTaxonomy.ts` is new and is the ONE list**: which aisle a
  category rolls up into, what a category is CALLED, and which declared spec
  field carries its sub-category (`SUBCATEGORY_FIELD`). The main category is
  derived and never typed, so two screens cannot disagree about it.

- **The rule that stops this becoming a taxonomy rewrite: a NEW CATEGORY only
  when the spec field set genuinely differs; a SUB-CATEGORY when it does not.**
  MPPT and PWM answer the same datasheet questions → sub-categories of one
  category. An AC cable has no Voc and a PV cable has no phase → two
  categories. Apply this rule to every future case rather than re-deciding.

- **The naming, which was the owner's complaint.** The app had three answers
  for the same category: the Item Editor rendered the raw enum (`pv_module`),
  the Products/Items/Stock lists rendered `formatCategory()`'s acronym guess
  ("PV Module"), and the cost views read a separate hand-written
  `CATEGORY_LABELS` map. All three now read `CATEGORY_LABEL` from the
  taxonomy. `pv_module` is **"Solar Panels"** (his word, not "PV Module").
  `lib/productTaxonomy.test.ts` fails the build if a category has no label, if
  a label still carries an underscore, or if a `product_category` enum value is
  added and placed in no aisle.

- **Two levels in one field.** `components/ui/CategoryOptions.tsx` renders the
  aisle as an `<optgroup>` heading inside the same single `<select>` bound to
  the same single column — no new column in the Item Editor or the Products
  list, which was the owner's constraint. `FilterCombobox` gained an optional
  `format` prop: it files by `pv_module`, reads "Solar Panels", and still
  matches either when typed.

- **Three categories added and 465 rows moved** (`migrations/product_taxonomy_categories.sql`,
  applied): `ac_cable` **415** out of `non_stock`, one stray H1Z2Z2-K back to
  `pv_cable`, `switchgear` **27** and `monitoring` **22** out of `accessories`.
  `non_stock` fell 607 → 191. **The AC rule matches the SPLN/IEC construction
  code, never the word "kabel"** — 24 `non_stock` rows say "Kabel Ladder" or
  "Kabel Tray" and are cable MANAGEMENT; a word match would have filed a
  galvanised tray as a conductor. All 440 cable-worded rows classified with
  nothing left over, and the switchgear/monitoring predicates have zero
  overlap (checked before applying).

- **Four sub-category axes were ALREADY being typed** before anyone called them
  that, which is why this costs no re-keying: `bom_role` on mounting (44 of
  72), `controller_type` (47 of 72), `battery_type` (19 of 27), `system_type`
  (6 of 48). `SUBCATEGORY_FIELD` just names them.

- The shop's `DEPARTMENTS` are now DERIVED from `MAIN_CATEGORIES`, so a
  department cannot exist on the storefront that the Item Editor has never
  heard of. `FAMILIES` followed the rows out of `accessories`; AC cables get
  families by construction (20 kV, XLPE, armoured, aerial, NYY/NYM, NYAF/NYA).

- 504 tests (13 new), `tsc` clean, `next build` clean, no lint problems added.
  Commit `1bc8ae1`.

**Left for the owner to decide** (raised, not acted on):
1. **AC cables are now shoppable and there are 415 of them, 0 priced**, listed
   per size AND per colour (`NYAF 2.5 mm² (Merah)`, `(Biru)`, `(Hitam)`…).
   Recommendation: make colour a spec field so eight rows collapse to one
   product, otherwise the Cables aisle is 415 near-duplicates.
2. `SUNTREE AC EV Charger SWJ3-11/16` sits in `accessories` while an
   `ev_charger` category exists — 1 row, obvious, not moved without his word.
3. `DEYE SUN-STS500L` (a transfer switch?) left in `accessories` rather than
   guessed into `switchgear`.
4. Three `wallmount_cabinet` rows are "Extra carton NWS5006/8/10" — packaging,
   not products.
5. **Panel Box**: his list put it under Switchgears, and the SUNTREE
   Distribution Boxes did move there. The NIRAX 19" rack cabinets
   (`standing_cabinet`/`wallmount_cabinet`) stayed as their own aisle
   (Enclosures) because a network rack is not a switchgear enclosure — confirm.
6. Not on his list, so decided here and reversible: `power_inverter` folded
   into the Inverters aisle; pumps, UPS/stabilizer and EV charging kept as
   aisles of their own.

### 2026-09-05 — the storefront demo, and the catalogue as one source

- **`/shop` — a working storefront inside ICAPROC, behind the existing login.**
  Five routes: `/shop` (home), `/shop/c/[dept]` (department listing with
  search, brand facets built from the data, and five sorts), `/shop/p/[id]`
  (product page), `/shop/compare`, `/shop/cart`. Signed-in only, listed in no
  menu — `canOpenPath` returns true for unregistered paths, so nothing in
  `constants/navigation.ts` or the access tests had to move.

  **Why it lives here rather than on its own host yet:** a public site ships
  the anon key in every page's source, so it cannot go live before the
  `3.0_components` anon UPDATE policy and the two unauthenticated API routes
  (`insert-from-pdf`, `extract-pdf`) are closed. Behind the login, none of that
  blocks a demo the owner can click through on real data.

  **Portability is the design constraint** (owner, 2026-09-05: demo on an
  icaproc subdomain, then port to a self-hosted VPS). Everything store-side is
  `app/shop/**`, `components/shop/**` and `lib/shopCatalog.ts`; it reads
  Supabase and the spec schema and NOTHING else of the ERP — no Tailwind
  theme, no settings, no ERP components. Its own CSS block, its own
  `formatIdr` (the ERP's `fmtRupiah` follows each installation's currency
  settings; a storefront's prices must not). Lifting it out is a folder move.

  **The consistency claim, made structural.** The product page and the
  comparison render from `CATEGORY_SPEC_FIELDS` and `SPEC_FIELD_META` — the
  same declared field sets, order, group headings, labels and units as the
  Tech Specs screen the staff type them into. Not a copy of that list: the
  list. A parameter added there appears on the website in the same commit, and
  the two cannot disagree about what a field is called.

- **`lib/shopCatalog.ts` (17 tests).** Every storefront rule, out of the pages:
  departments (a BUYER's cut of the catalogue — three inverter categories are
  one aisle, and `non_stock`'s 607 one-off project lines are in no department
  and so never reach the shop), `isShoppable`, `pricePerUnit` (Rp/Wp, Rp/Wh,
  Rp/A per category, skipping cable which is priced by the metre),
  `needsFreight` (weight when the datasheet states it, else category — a 2,4 m
  module and a 4,85 m rail are refused for size and state no weight, so a rule
  waiting for complete data would parcel a pallet), `formatIdr`, PPN.

- Unpriced items still shop, as "harga via penawaran". 137 of ~395 shoppable
  rows carry a price; hiding the rest would hide the gap instead of showing it.

- **Rebuilt to the McMaster-Carr intention** (owner, 2026-09-05: "direct,
  technical person focus, quick information on what's available, the specs,
  urgent needs, not promotion"). A catalogue with a cart attached, not a store:
  the front page is the INDEX (every department and category with counts and
  lowest open price, no hero, no messaging); listings are TABLES with the
  category's highlighted spec fields as columns; the filter sidebar is
  GENERATED from the declared field set (`facetsFor` — a numeric field with
  ≤12 distinct values is a ticked list in numeric order, more becomes a range,
  booleans and short text become options; a field every item answers the same
  way is not offered); search is the primary UI (`searchItems`, every token
  must match, model-number hits rank first, spec values indexed with their
  units so "5kw 48v" and "620wp" work); product pages are spec-first with the
  buy box in a narrow left column. 13px type, 32px rows, hairlines, 4px radii.
  What is McMaster's — the yellow-green skin, its exact layout grammar — is not
  copied; what is taken is the intention. 482 tests.

- **Families, autocomplete, and no supplier naming** (owner, 2026-09-05).
  `FAMILIES` in `lib/shopCatalog.ts`: the buyer's first question inside a
  category ("rail, clamp, or foot?", "on-grid or off-grid?", "12 V or 48 V?"),
  as rules over OUR description and capacity, first match wins, unmatched →
  "Lainnya" (never hidden). A department now opens on its family tiles, not
  the whole list; the table appears once one is chosen, facets scoped to it.
  URL `/shop/c/<dept>?cat=<category>&fam=<family|all>`. The owner knows the
  ERP's categorisation itself needs work and has deferred it until the shop
  UI is settled — families are the stopgap over today's categories and can
  become a real column in Item Editor then. Search box has autocomplete
  (same `searchItems` as the results page, over the catalogue in memory, ↑↓
  Enter Esc). `supplier_model` is not fetched, not shown, and not searched:
  the supplier's naming never reaches a customer, and an item with no
  description of ours is not on the shop. `useShopData` shares one fetch
  across every hook instance on a page. 491 tests.

- **Design canvas** (8 artboards, published as an artifact) preceded the code
  and set the look: the client-facing brand from the quotes and proposals —
  `#1f5aa8`, Rubik, wide-tracked micro-labels, hairline rules — not the ERP's
  graphite theme. Product imagery is technical line drawings, because 0 of
  1,002 catalogue rows has a photo.

### 2026-08-29 — the Hermes agent's credentials, and the Progress board

- `e4abe0e` **`docs/PURCHASING_RUNBOOK.md`.** The six buy-side procedures as
  machine-readable markdown, for the owner's Telegram agent (Hermes — OpenClaw
  shaped, Claude Sonnet 5, drives Drive/email/ICAPROC). Front-loads the five
  rules that cost money if broken. There is also an HTML artifact of the same
  content, but an artifact is auth-gated and cannot be fetched by an agent —
  the markdown is the one that matters. **Keep it in step when a purchasing
  screen changes; an agent now depends on it.**
- `1a45d4a` **Purchasing → Progress.** Replaces the team's Basecamp kanban.
  Seven columns; FIVE are derived from existing rows (`lib/poProgress.ts`, 18
  tests) and two are stored (`docs_checked_at`, `hard_copy_received_at`).
  No drag-and-drop, on purpose. Board starts empty — no backfill; the
  one-statement backfill sits commented in `migrations/po_progress_board.sql`.
  Cards sit at the FURTHEST milestone reached, because only 15 of 223 POs have
  a down payment and a strict sequence would strand the rest.

**Accounts created for the agents:** `po@icasolar.com` (`buy_admin`, Hermes)
and `mira@icasolar.com` (`owner`, 2026-08-31, owner's explicit choice — full
access including banks and user management). Both confirmed manually in
`auth.users` because **Supabase's built-in mailer does not deliver to non-team
addresses** — confirmation, OTP and recovery were all accepted by GoTrue and
silently dropped (mailbox verified empty). Any future non-team hire hits this.
Fix is custom SMTP under Authentication → Emails; icasolar.com already has
cPanel mail. Dashboard-only, not done.

### Creating an agent login by SQL — the order, and the trap

`auth.users` carries two triggers: `enforce_email_allowlist` (BEFORE INSERT,
rejects any address not already in `allowed_emails`) and `handle_new_user`
(AFTER INSERT, builds the `user_profiles` row and takes its role FROM that
allowlist row). So:

1. `insert into allowed_emails (email, role)` — the role is decided here;
2. `insert into auth.users (...)` with `email_confirmed_at = now()` and
   `encrypted_password = crypt('…', gen_salt('bf'))`;
3. **`insert into auth.identities`** — trap ONE. A user created by direct
   INSERT has no identity row, and GoTrue rejects password sign-in without
   one with "Invalid login credentials" even though the hash is correct.
   `identity_data` must carry `sub` (the user id, as text) and `email`.
4. **Set the token columns to `''`, never leave them NULL** — trap TWO, found
   2026-09-06 and it costs a whole debugging session because the error blames
   the database, not the row:

   ```sql
   confirmation_token = '', recovery_token = '', email_change = '',
   email_change_token_new = '', email_change_token_current = '',
   phone_change = '', phone_change_token = '', reauthentication_token = ''
   ```

   GoTrue scans these into Go `string`, not `*string`. A NULL fails the scan
   and the endpoint answers **`500 "Database error querying schema"`** — which
   reads exactly like a paused project or a broken auth schema, and is neither.
   The API sets them to `''` on every user it creates; a direct INSERT that
   omits them leaves NULL. Every account made through the dashboard/API has
   `''`, so **diff a new row against a working one on these eight columns**
   before believing any story about the server.

Verify by comparing the new row against a known-good account on: `identities`
count, `identity_data->>'sub'`, `provider`, `email_confirmed_at`, `banned_until`,
and `encrypted_password = crypt(<pw>, encrypted_password)`. A live sign-in test
is NOT possible from the sandbox — the egress proxy denies CONNECT to
`*.supabase.co`.

### Making an agent WRITE AS a user instead of as service-role (2026-09-01)

The service-role key bypasses RLS and leaves `auth.uid()` NULL, so every row an
agent writes with it is anonymous (`created_by_email` fell back to `'system'`)
and nothing can be revoked short of rotating the key for the whole app. To have
the agent act **as `mira@icasolar.com`**, drop the service-role key from its
config and give it the **anon key + mira's password**:

1. **Sign in** — `POST {SUPABASE_URL}/auth/v1/token?grant_type=password`,
   header `apikey: <anon key>`, body `{"email":"mira@icasolar.com","password":"…"}`.
   Returns `access_token` (a JWT, `expires_in` 3600) and `refresh_token`.
2. **Every data call** carries BOTH headers: `apikey: <anon key>` and
   `Authorization: Bearer <access_token>`. (With `supabase-js`/`supabase-py`,
   `createClient(url, ANON_KEY)` + `signInWithPassword` does this for you.)
3. **Refresh** at ~50 min: same endpoint, `grant_type=refresh_token`.
4. **Stamp attribution explicitly** — `created_by_email` has DB default `''`,
   nothing derives it from the JWT. The agent must send
   `created_by_email: 'mira@icasolar.com'` on every insert.

Verified 2026-09-01 by a rolled-back probe: with mira's claims set,
`auth.uid()` resolves to `71f8fb87-…`, the `sales quotes write` policy passes
(mira is `owner`), and `stamp_sales_quote()` fires normally. 0 rows left behind.

**What changes, and what does not.** Sell-side tables are role-gated, and
`owner` passes all of them, so the agent loses no reach — but the writes become
attributable and **revocable in one statement**
(`update auth.users set banned_until = 'infinity' where email = 'mira@icasolar.com'`),
which is the whole point. The buy side is ungated anyway (see the security
holes above), so it is unaffected. Anything that needs the Auth Admin API
(creating users, etc.) will start failing — that genuinely requires
service-role and should not be in an agent's hands.

**Reach audit (2026-09-01, whole `public` schema).** The anon key is only the
doorway; the JWT carries the permission, and `owner` passes every write gate:
10 buy-side tables are open to any authenticated user, 32 are role-gated with
`owner` in the list, and the 5 that gate through a function
(`can_edit_quote`, `can_view_epc`, `can_write_po_costs` — project quotes,
`6.0_po_costs`, `payment_batches`) all grant `owner` unconditionally.

What NO logged-in user can write, by design — these carry a SELECT policy and
no write policy, so only their `SECURITY DEFINER` triggers fill them:
`21.3_item_price_history`, `22.3_sales_activity_log`, `30.1_stock_balances`,
plus `materialized_view_refresh_log` (zero policies) and the legacy spec tables
(`batteries`, `pv_modules`, `hybrid_inverters`, `on_grid_inverters`,
`solar_charge_controllers` — public read only). **Service-role bypasses RLS and
therefore CAN rewrite all of those**, so moving the agent onto a JWT is what
makes the audit trail tamper-proof, not merely attributable.

Proven by rolled-back probe under mira's claims: new sales order OK, new deal
(`5.0_purchases`) OK, forge `22.3_sales_activity_log` DENIED, forge
`21.3_item_price_history` DENIED, edit `user_profiles` OK. That last one is the
open question — `owner` can change roles and add logins; narrowing it needs a
policy change nobody has authorised. There are no storage buckets, so nothing
to gate there.

The JWT switch also fixes attribution on its own — no extra trigger needed.
`stamp_sales_quote()` already overwrites `created_by_email` with the email
behind `auth.uid()`, which is exactly why service-role writes came out as
`'system'`. Under a JWT the agent cannot forget its name, and cannot forge one.

### The PQ-that-never-became-SO bug — FIXED 2026-09-01

`stamp_sales_quote()` stamped the milestone numbers only in its UPDATE branch,
each gated on `OLD.status IS DISTINCT FROM '<milestone>'`. A row INSERTED
already at `ordered` — what an API client does when it writes a confirmed order
in one shot — has no `OLD`, passed no gate, and came out with
`order_number = ''`; `displayDocNumber` then correctly fell back to the `PQ-`
number, so a Confirmed Order kept reading as a quote. Same gap for
`invoice_number`, `do_number`, and any UPDATE that skipped milestones.

`migrations/fix_stamp_sales_quote_on_insert.sql` derives the numbering from the
milestone the row is AT: every number the status implies is stamped if missing,
on INSERT and UPDATE alike; a caller-supplied number is kept. Timestamps
deliberately do NOT follow that rule — only the milestone the row actually sits
at is stamped, so the ladder never invents history for skipped stages.
Backfilled `SQ-20260831-0018` -> `SO-20260831-0007` and `SQ-20260901-0019` ->
`SO-20260831-0008`, after winding `sales_order_seq` back to 6 to undo the
numbers burned by the rolled-back rehearsals. Nothing at `ordered` or beyond is
missing a number now, and no SO number repeats.

Still open, nobody has decided: `SQ-20260819-0013` sits at `draft` but still
holds `SO-20260819-0005` — reverted without clearing. Harmless (draft displays
the `DQ-` number) but the SO number is spent.

### Two findings from that thread, NOT acted on (owner has not decided)

1. **Four CNY POs carry a USD exchange rate (~17,88x).** PIO-2026011,
   EB.42277, EB.42278, PIO-2026013 — all Shenzhen Kstar, Aug 2026. Recorded at
   IDR 29.0bn against ~IDR 4.3bn at a correct CNY rate: **AP overstated by
   ~IDR 24.7bn**. The line prices prove the currency is right and the rate is
   wrong (`ICAL LIP12120 12V/120Ah` at 772 sits between the confirmed-CNY 100Ah
   at 655 and 200Ah at 1,152). No payments recorded against any of them yet.
   Needs the owner's rate before any fix.
2. **`PIO/007/ISL/05/2025` uses rate 2,643 on a May-2025 CNY order.** Their own
   `9.0_exchange_rate_history` has CNY at 2,244 (Jun 2024) and 2,327 (Oct 2025);
   2,643 only otherwise appears on 2026 POs. Overstates that deal ~IDR 145–180m.

### Security holes — #2 FIXED 2026-09-06, #1 still open

1. **STILL OPEN. `app/api/insert-from-pdf/route.ts` has no auth and writes with
   the service-role key.** Anyone reaching that URL can insert suppliers,
   quotes, POs and line items into production. `extract-pdf` is also open and
   spends `ANTHROPIC_API_KEY` for any caller. `ask` and `next-step` check the
   bearer token correctly — copy that pattern.
2. **FIXED 2026-09-06 — and it was worse than recorded here.** The note used to
   say the buy side was ungated "at the DB level" with role gating only in
   React. True, but it understated it: four tables also carried
   `Allow public read` policies targeting the **`public` ROLE**, which includes
   `anon`. Proven by rolled-back probe: **with the anon key alone and no login**
   a caller could READ 37 suppliers, 226 POs, 651 PO line items WITH UNIT COSTS
   and all 1,005 catalogue rows, and could UPDATE the catalogue (the known
   `allow_update` policy). The anon key ships in every page's JS bundle, so this
   needed no credential theft at all.
   Closed in two migrations, both applied and verified:
   * `migrations/close_anon_access.sql` — drops the four public-read policies,
     the anon `allow_update`, and a duplicate on `8.0_component_links`. Re-ran
     the same probe: anon now sees **0 rows** on all four and updates nothing;
     `authenticated` still sees 37/226/651/1005, so no screen lost data.
   * `migrations/gate_buy_side_writes.sql` — replaces `ALL TO authenticated
     USING (true)` on ten tables with `can_write_buy_side()`,
     `can_edit_catalog()` and `can_manage_stock()`, mirroring
     `ROLE_PERMISSIONS` exactly. The catalogue is SHARED (Tech Specs, Products,
     tier pricing all write it from the sell side) so it gates on `canEdit`,
     not on buy-side membership; `5.0_purchases` also accepts stock roles
     because goods receipt marks the PO received.
   Verified per role by rolled-back probe: buy_admin and owner write everything;
   sell_admin writes the catalogue but not POs or suppliers; the `engineer`
   account (MANDA) is refused on all four. **SELECT is deliberately unchanged** —
   this change removes no read that works today, so it cannot break a screen.
   **Still to do: gate READS on the cost-bearing tables** (`4.x`, `5.x`, `7.0`).
   That needs the analytics views checked one at a time, since `v_landed_cost_summary`
   and friends read them.


### 2026-08-28 (later still) — the two personal switches, and a Stock finding

- `9ec0b56` **Brightness and language are one-tap switches.** Owner sent a
  wallet-header screenshot: "for the dark and bright appearance can be as
  elegant as this kind of switch, so is EN or ID." The wordmark menu's first
  row was two pickers (two colour circles, two language buttons); it is now a
  sun/moon glyph and a two-letter code. **Both name their DESTINATION, not the
  current state** — that is the reference's convention and the only reading
  that makes a bare glyph self-explanatory. Tooltips spell it out, through
  `tf()` so they translate.
  - **A real bug went with it:** `toggleTheme()` still cycled `THEMES` in
    order, written when there were four skins and never revisited when there
    were six — so one tap could walk someone onto Dim or Paper, which the
    owner hid the same day. `nextTheme()` now picks out of
    `OFFERED_THEME_VALUES` rather than naming skins, so narrowing the offer
    narrows the switch. 5 tests, incl. "a tap never lands on a hidden skin".
    `MENU_THEME_VALUES` was a duplicate of that pair and is gone.
  - Measured in Chromium from the file's own class strings, Inter, inside the
    real w-56 panel (210px content box): row **179px → 114px**, identical in
    Indonesian.
  - **Then corrected, same day, after the owner screenshotted it:** "the layout
    and spacing looks weird, or too empty". He was right and it was
    measurable — the switches at their natural 28px hugged the left while
    `ml-auto` pinned the gear right, leaving a **108px hole in a 210px row**.
    All three controls now share the row (`flex-1` each): 194px used, 4px gaps,
    39px tall. **`flex-1` and not `grid-cols-3`** because the gear only exists
    for `canManageUsers` — three columns strand a non-admin with an empty
    third, flex just gives the two switches half each. Tap targets went
    28×28 → ~66×28 with it. Rendered and checked in both skins, both
    languages, and with/without the gear before pushing.
  - **Corrected again, same day:** "for the appearance, language and more
    settings, better to align left". So the row is a LEFT CLUSTER (`px-1.5
    gap-1`, fixed `w-7` controls, 92px wide — 60px without the gear). Three
    shapes in one afternoon; both rejected ones are written into the comment
    in `BrandMenu.tsx` so nobody re-proposes them. `px-1.5` was chosen by
    MEASUREMENT, not taste: the sun's glyph then starts 11px from the row edge
    against the menu labels' 10px, where `px-1` gives 9 and `px-2` gives 13.
    Nothing lands exactly on 10 — the glyph is inset 5px inside its 28px
    button and Tailwind's scale steps 4px → 6px around it.
  - Tap targets are back to 28×28 as a result. Said out loud rather than
    buried: it is the cost of the left alignment, still bigger than the 20px
    circles and 14px gear this row held before the switches existed.
  - **Then a fourth and settled shape, from a moon/sun pill reference:** "since
    we have plenty of space, we can go back to something like this… with the
    more aligned to the right." So both options are visible again inside a
    `rounded-full` pill, the one in effect is lit, and the gear is `ml-auto`.
    198px of the 210px row. **This reverses the semantics deliberately:** one
    glyph can only honestly show the DESTINATION; two glyphs can only honestly
    show STATE. `pickOffered(light)` (lib/theme.ts) sets a side outright and
    still cannot land on a hidden skin; 3 more tests.

- **The theme switch felt laggy, and it measured badly.** `transition-colors`
  is on **804** class sites and `transition-all` on **166** more, so flipping
  `data-theme` starts a 150ms colour interpolation on every element at once and
  the browser cannot deliver the frames. Time until the colour stops moving,
  measured in Chromium against the real palette:

  | transitioning elements | before | after |
  |---|---|---|
  | 181 (a dashboard, counted on `/preview`) | 79ms | 42ms |
  | 500 | 213ms | 43ms |
  | 1,500 | 555ms | 93ms |
  | 4,000 (a long list) | 1,690ms | 138ms |

  `paint()` in `lib/theme.ts` now drops a `*{transition:none!important}` style
  in, flips, forces the recalc while they are still off, and removes it two
  frames later. **Both halves are load-bearing:** without the forced reflow the
  new colours land after the style is gone, and removing it in the SAME frame
  re-arms the transitions before the paint — the bug over again. Verified end
  to end by transpiling the shipping `paint()` with `tsc` and running THAT in
  the page: 391ms → 159ms at 3,000 elements, transitions restored to 0.15s
  afterwards, no leftover `<style data-theme-swap>`, no page errors.
  - This is the strongest argument yet for §6 (compiling Tailwind at build
    time): 970 transition class sites is also 970 places the Play CDN has to
    resolve at runtime.
  - **Rig lesson:** Tailwind only emits classes it finds in `content`, so a
    replica written AFTER the last CSS build silently renders with the class
    missing. `px-1`/`px-1.5` measured as zero padding until the CSS was
    rebuilt. Always rebuild `tw.css` after writing the HTML, and sanity-check
    a measurement against arithmetic before believing it.
  - **Two measuring-rig bugs worth inheriting**, both the "a stale replica
    lies" trap: an extractor that only matched `className="..."` silently
    grabbed a LATER element's classes for any control written with a template
    literal; and splitting a `${a ? b : c}` on its `:` lands inside
    `hover:text-slate-200` and drops half the branch. Take the quoted strings
    in order instead. Also: the palette variables live on `:root`, so a
    `data-theme` on a wrapper div renders "light" in the dark palette — put it
    on `<html>` and PRINT the computed background to prove it.

- **Stock's "Last Move" is not "date received", and that gap will open.**
  Owner asked where to see goods just received; the answer is `/stock` sorted
  by Last Move, with the green IN badge. It works TODAY: 151 of 153 items with
  movement have a receipt as their most recent movement, because there are 189
  `in` rows and only **5** `out` rows. Every delivery the sell-side ships adds
  an `out` that outranks the receipt, so the two answers diverge exactly as
  fulfilment ramps. A real "Received" sort (or a `date received` column) is the
  fix; offered, not asked for.
  - `/stock` reads `30.0_stock_movements` with `.limit(2000)`. **194 rows
    today**, so no truncation — but it is a hard cap, not a page, and it is the
    same silent-truncation shape §6.3 just retired everywhere else.
  - Owner then asked for the DEFAULT to be Last Move, newest first: done, in
    `app/stock/page.tsx`'s `useState`. **`/stock` is not in the Settings ›
    Lists system** — eight other lists are (`constants/listDefaults.ts`), so
    wiring it in would make the sort configurable like the rest. Offered, not
    asked for.

### 2026-08-28 (later) — §6 finished: the sales concurrency story, end to end

**Then, on the owner's instruction, the 7 lint errors §6.3 exposed were fixed
properly rather than left.** `app/items`, `app/pricing`, `app/profitability`,
`app/stock`, `hooks/useItemScores`. eslint is **413** now — below the 414 it
started at, with nothing masked.

- **What the rule actually flags, measured with a probe rather than assumed:**
  `react-hooks/set-state-in-effect` fires on a setState reached synchronously
  from an effect **and** on one reached through a named `async` callback the
  effect calls — even when the setState is after an `await`. It does NOT fire
  on a setState inside a `.then()` callback, nor inside an async IIFE written
  in the effect body. So simply moving the call inline would have been
  appeasement, not a fix.
- **The real defect underneath it was missing cancellation.** Every one of
  these effects started a load and applied the result unconditionally. Two
  loads in flight — mount, then the permission gate resolving — and the slower
  answer won. Silent, and rare enough to be nasty.
- **The shape, applied to all five identically:** `load()` fetches, computes,
  and RETURNS the apply step; the effect resolves it behind a `live` flag and
  drops it if teardown already happened. `setLoading(true)` moves out of
  `load()` to the caller — the initial `useState(true)` on mount, or an
  explicit `refresh()` for the screens with re-read buttons (`pricing` ×7,
  `stock` ×2). Clearing the lint is a side effect of the fix, not the point.
- **`app/items` sort was a separate, genuine anti-pattern.** The Settings ›
  Lists default was held in state and corrected by an effect, so the list drew
  in the wrong order and jumped — and needed a `listTouched` ref to remember
  not to do it twice. It is derived during render now, with `sortOverride`
  (null until a real click) doubling as the touched record. The ref and the
  effect are both gone.
- Verified structurally as well as by the four checks: every `setState` in the
  five files was diffed name-by-name against `HEAD`, and the only differences
  are the intended ones (`setLoading(true)` removed where the load is
  effect-only, `setSort`→`setSortOverride`, `setWarehouses` now on both the
  error and success paths in `stock`).
- **Not done, and deliberately:** two pre-existing `exhaustive-deps` warnings
  in `pricing` and `profitability` sit on lines this touched. Silencing them
  with the house `// eslint-disable-line` would have been correct in isolation
  (`supabase` is a module singleton, so it can never be a useful dep) but it
  would have quietly moved the headline number for something nobody asked for.
  Left visible.

All four items in the previous §6 are done. §6.2 turned out to need no work at
all; the other three shipped.

- `7f78972` **Sales editor: per-row merge + stale-tab guard.** The §6.1 port
  from `app/proposals/[id]`, same mechanism, not a second one.
  `lib/salesMerge.ts` holds the decision logic (pure, 20 tests):
  `mergeLines` / `mergeHeader` / `sameLine` / `mergeMessage`. The page keeps
  `loadedStampRef` (the `22.0` `updated_at` it last agreed with),
  `baseRef` + `baseHeaderRef` (the rows/header as the DB held them then), a
  15s poll + focus listener + presence's peer-saved signal, and a pre-save
  merge inside `persist()`.
  - **A save now writes only rows that differ from base.** A line this tab
    never touched is never written back.
  - **The stale-tab guard is sales-shaped.** `persist()` wrote this tab's
    `status` on EVERY save, autosaves included — so a tab left on the draft
    un-confirmed an order a colleague had just confirmed, and the trigger
    logged `ordered → draft`. A plain save now writes the DATABASE's status; a
    status BUTTON pressed against a status that has since moved says so and
    does not fire.
  - **The autosaver never opens a dialog** (it fires 2.5s after a keystroke) —
    it merges and reports in the toast. An explicit save still confirms.
  - `ProposalPresence` → `DocumentPresence`; nothing in it was ever
    proposal-specific, and both editors use it now.
  - Proved in a rolled-back `DO $$` block, Alice saving after Bob, each having
    edited a different line: before `Panel 550Wp | Inverter @2000 | Cable`
    (Bob's edit gone, status back to `draft`); after `Panel 550Wp | Inverter
    5kW @2500 | Cable`, status `ordered`. 0 rows left behind, no SQ/SO
    sequence numbers consumed (supply `quote_number`/`order_number` and the
    trigger never calls `nextval`).

- **§6.2 needed NO repair — the premise was wrong, and this is now settled.**
  The one `so_item_id IS NULL` invoice line is `"Progress billing 50% —
  SO-20260803-0002"`, qty 1 @ Rp 1,965,561.50, which is **exactly 50.0000%**
  of that order's Rp 3,931,123 of lines. It is a progress bill against the
  whole order, so it never had a single order line to point at. Delivery-order
  lines: 6 of 6 linked. **Nothing was severed, and no production data was
  written.** (The previous thread flagged it honestly as unproven; measuring
  it resolves it.)

- `7e705cb` **Retired the hand-copied paging loops — there were TEN, not
  seven.** `CommandPalette`, `useSupabaseData` and `useItemScores` had copies
  too. Six of the ten were the same `3.0_components` read, now
  `fetchAllComponents()` beside the primitive in `lib/fetchAllRows.ts`; the
  COLUMN lists stay at the call sites because `brand` is buy-side.
  - **Inherit this: a single `for (;;)` makes the React Compiler bail on the
    WHOLE component, and eslint then reports NOTHING for that file.**
    Measured on `app/stock/page.tsx` — with the loop 0 problems, without it 1.
    So those loops were suppressing the linter across five screens and two
    hooks, and the 414 baseline was partly fiction.
  - Unmasking surfaced 10 pre-existing findings. **3 fixed**
    (`react-hooks/purity`: `Date.now()` read during render in
    `useItemScores`, so the 90/180/360-day windows slid on every re-render —
    they anchor to `readAt` now). **7 left**
    (`react-hooks/set-state-in-effect`) — **since fixed properly, see below.**
  - **A relative import inside `lib/` needs its `.ts` extension** or
    `node --test` cannot resolve it. Two suites went dark until it went back
    on — and `npm test` reports that as 2 failures, not as 26 missing tests,
    so watch the TOTAL count as well as the pass count.

- **§6.4 indexes: 8 applied**, `migrations/index_quote_lookups_and_fk_children.sql`.
  The five the roadmap named, plus three FK CHILD columns nobody had listed:
  `24.1_delivery_order_items.so_item_id`, `25.1_sales_invoice_items.so_item_id`
  and `25.0_sales_invoices.do_id` — all `ON DELETE SET NULL` with no index, so
  every parent delete scanned the whole child table, and the sales editor
  deletes `22.1` rows on any save that drops a line.
  **Say the size honestly:** measured warm on the EPC editor's own query,
  0.323ms → 0.213ms. The number that matters is beside it — 30 buffers per
  read down to 8, and that gap is what widens with the table.


### 2026-08-28 — concurrency review, and the sales write path

Owner asked two questions: how multiple browsers are handled while editing, and
whether there is low-hanging performance fruit. Answered by reading the code and
counting production, then he picked the sales fix first.

**The two editors were nothing alike.** `app/proposals/[id]` has a real
collaborative system — a per-tab BASE snapshot, writes only rows that tab
changed, a 15s poll + focus sync that merges colleagues' rows, conflicts counted
and the saver warned, an `updated_at` stale-tab guard, and `ProposalPresence`.
`app/sales/[id]` had none of it.

- `999603f` **Sales lines: upsert what survives, delete what went — IN THAT
  ORDER.** `persist()` did `DELETE … WHERE quote_id` then `INSERT` the whole
  list, so every save re-minted every `item_id`. Both
  `24.1_delivery_order_items.so_item_id` and
  `25.1_sales_invoice_items.so_item_id` are FKs onto those rows **ON DELETE SET
  NULL**, so each save cut a delivered/invoiced line's link back to its order
  line — on the autosaver, 2.5s after any keystroke. Decision half is
  `lib/salesLines.ts` (pure, 11 tests, 306 total). Verified twice in rolled-back
  `DO` blocks against the live schema, residue checked at 0.
  **Still open:** two people editing the SAME line in the same moment is still
  last-one-wins. The per-row merge + the `loadedStampRef` stale-tab guard +
  presence on sales are the agreed next piece — port them from the EPC editor,
  do not invent a second mechanism.

**Findings raised and NOT acted on (owner's sequencing: after the above):**
- **A link repair pass.** 1 of 3 invoice lines has a null `so_item_id`. While
  volumes are tiny a broken link can still be inferred by description+quantity;
  that gets unreliable as the sell-side ramps. Do it AFTER the fix above or it
  just re-breaks.
- **The 1,000-row cap.** `10.2_quote_items` is at **1,040 rows**,
  `3.0_components` at 993. `pgrst.db_max_rows` is NOT set at the DB level, so
  the cap is whatever the Supabase dashboard says (Settings → API → Max rows) —
  **I could not read it from the sandbox; check it.** If it is the 1,000
  default, `app/api/ask/route.ts:118` fetches that whole table unbounded to
  compute EPC quote totals and is quietly ~4% short, worsening weekly.
  `proposals/library` loads four whole tables on open.
- **Five missing indexes**, measured: `10.2_quote_items.quote_id` /
  `.section_id` / `.component_id`, `10.1_quote_sections.quote_id`,
  `10.3_quote_activity.quote_id`. `quote_id` is what the EPC editor filters on
  at every open, every 15s poll and every save. Additive, zero risk — but at
  ~1k rows a seq scan is ~1ms, so this is future-proofing, not a felt win.
  Deliberately sequenced LAST.
- Already good, do not "fix": `lib/supabase.ts` is a singleton with a custom
  in-process auth lock (from the 2026-08-19 "Save takes forever" report).

### 2026-08-27 (later) — the Products filter bar, and one bug found by screenshot

- `4aeba7f` **Deal Lookup: a silent 80-row cap, and Drafts counted as running
  money.** Owner asked "what would you improve here?" — answered by counting
  production, not by reading the screen.
  **The cap:** `filtered` ended in `base.slice(0, 80)` whenever search was
  empty. 287 deals exist; **207 were unreachable**, including **11 Confirmed
  POs** (ordered, unreceived). It also made the screen disagree with itself —
  chips are computed from the full set ("Active (173)"), section headings from
  the capped 80 ("In process 39"), eight pixels apart. Uncapped now; each
  section pages at 25 with a button naming what it holds back.
  **The stage:** `dealStage` returned `'active'` for anything not
  Cancelled/Replaced/Fully Received, so 148 Draft POs sat in the section whose
  job is the running money. Every Draft is >90 days old, 125 >1 year, newest
  2025-11-18. New `'draft'` stage + "Drafts — never issued" section; the tile
  is "Ordered" and counts 25.

  **STILL OPEN, owner said leave it for now (2026-08-27): four POs carry a USD
  exchange rate on a CNY amount.** PIO-2026013 (17,881), EB.42277 (17,822),
  EB.42278 (17,882), PIO-2026011 (17,822) — all Shenzhen Kstar, all raised
  7–12 Aug 2026. The same supplier's other CNY POs use 2,427 / 2,502 / 2,643,
  and every other CNY PO in the book sits between 2,244 and 2,658, so the
  currency is right and the RATE is wrong. Overstates committed value by
  **Rp 24.76bn**, in the four largest Confirmed POs on the board. Data not
  touched. The durable fix is a per-currency plausibility band held as DATA
  (like margin profiles) plus a row flag, riding the mismatch machinery
  Deal Lookup already renders via `checkPoTotal`/`totalDisagrees`.

  **Two SQL traps that cost me wrong numbers out loud — inherit these:**
  `sum(x) filter (where …)` returns NULL when nothing matches, and NULL + n is
  NULL, so a two-branch sum silently reports 0. And **a `6.0_po_costs` row can
  be `currency='IDR'` AND carry an `exchange_rate`** — the amount is already in
  rupiah and the rate is provenance, not a multiplier. Re-applying it gave me
  Rp 45 *trillion* on one row. `costToIdr` in `lib/dealGroups.ts` gets this
  right; copy its rule, do not write your own.

  **Other findings, not acted on:** 157 of 222 POs have neither a PI number nor
  a quote link, so the quote→PO→payment chain the screen is built around is
  unavailable for 71% of them; 15 Confirmed POs are >90 days old (avg 131,
  oldest 315); 42 Open quotes are >90 days old, oldest 2025-04-23.

- `e6a9b23` **Filter bars: one control height instead of five.** Owner, on the
  shipped Products bar: *"why are the box or menu border of different size?"*
  Measured: 44 (the h-11 fields) / 30.5 (Show, View) / 30 (date) / 26.5 (Text
  quote) / 24.5 (Clear). The fields have an explicit height; every button was
  sized by `py-*` plus font-size alone, each authored at a different time —
  **there was no shared height token for the bar.** Not a new fault; folding
  the bar to one line in `1e1c748` is what exposed it, because fields and
  buttons used to wrap onto separate rows and read as two bands.
  Now `h-11 sm:h-9` on all nine — 44px on phones (a text field under 44 is a
  worse tap target, and the buttons gain one), 36px from sm up, and the row
  gives back 8px. Buttons needed `inline-flex items-center` once their height
  stopped coming from padding. Widths unmoved: still 1,267px for one line.
  `DateRangeFilter` is shared by **eight** screens — checked first that their
  own fields are h-11 (Sales, Invoices, Delivery) or h-10 (After Sales,
  Support Letters), so 30 → 36 moves each toward its own fields, never away.
  **Still ragged across screens, not raised as a task:** those field heights
  are three different values (44 / 40 / padding-sized on Banks and Deal
  Lookup). One height token for form controls would settle it app-wide.

- `3cb809c` **EPC section header: the title field collapsed to 0px on a phone.**
  Owner screenshot, reported as "the pencil button is still too close to the
  lead time selection". Measured at 360/390/402/430: the title input is
  **0.0px** at all four and the pencil **overlaps** the select by 2px — the
  section name could not be read or tapped at all. The row was
  `flex items-center gap-3` with the title `flex-1 min-w-0` between a
  fixed-width select and a `whitespace-nowrap` subtotal; its content measures
  **419px and never shrinks**, so on a 402px phone (376px row) `min-w-0` took
  the title to zero AND the row still overflowed by 43px.
  **That overflow is why the same screenshot clipped Save, Export, Qty and the
  Rp/Wp figure** — one row wider than the viewport widens the document and
  everything else scrolls with it. Worth remembering as a diagnosis: a page
  that is scrolled sideways on a phone has ONE culprit element, and it is
  usually a nowrap flex row, not the thing that looks clipped.
  Now `flex flex-wrap gap-x-3 gap-y-2` + `min-w-[9rem] sm:min-w-0` — the shape
  the GROUP header above already used. 9rem is the largest floor that still
  fits two rows at 360 (10rem makes three); `sm:min-w-0` leaves 640+ exactly as
  it was. The sales quote editor's equivalent row already wraps, so this was
  EPC-only.

- `b97d6ea` **Item Editor: the Margin Tier column heading.** Owner screenshot,
  reported as "lines during loading". It was not a loading artifact — the `<th>`
  I shipped in `1fcd177` carried only `font-semibold` and none of the
  `text-[10px] font-bold uppercase tracking-wider text-slate-400` that `SortTh`
  and every hand-written header beside it use, so it rendered at the table's
  inherited size in bright text, permanently.
  **The other half of that screenshot IS a loading flash, and it is systemic:**
  there is no compiled CSS in this repo at all — no `tailwind.config`, no
  `postcss.config`, no CSS entry. Tailwind is only
  `<script src="https://cdn.tailwindcss.com">` in `app/layout.tsx:70`, and the
  Play CDN generates styles by scanning the DOM *after* it mounts, so every
  client-rendered element is briefly unstyled — worst on the heaviest screen,
  which is the Item Editor with 990 rows. **Not reproducible in this sandbox**
  (that CDN is blocked by the proxy), so the diagnosis rests on source, not on
  a measurement. Compiling Tailwind at build time is the durable fix and is the
  owner's call — raised, not done.
- `1e1c748` **Products filter bar: thirteen controls → eight.**
  Measured before anything was built (§5 rig, real Inter, class strings
  asserted against the source). The row needed **1,724px** to sit on one line;
  1536 gives it 1,488 and 1366 gives 1,318, so it wrapped to two rows on every
  machine except a 1920 monitor. The rename alone was worth 41.3px
  ("Just arrived" 91.2 → "New" 49.9) and changed no layout — worth saying out
  loud, because it is the part that *looks* like the fix.
  Four shapes were priced and put to the owner; he picked **Show + View menus**
  with the Show button NAMING what is on rather than counting it.
  Result: **1,268px, one line from 1366 up**, 83px instead of 85 below that,
  five rows instead of six on a phone. **In Indonesian it is 1,349px**, so 1366
  still wraps and 1440 is the threshold — he was told that before choosing.
  Widths, for the next person who touches this row: date 198.8 · category 181 ·
  sort 163 · Show 103.6 (151 in ID) · quote 124.4 · brand 119 · Clear 56.8 ·
  View 56.5.
  Two things worth inheriting: **`BarMenu` portals to `<body>` and clamps its
  left edge**, because the column picker it grew out of used a plain
  `absolute right-0` and got away with it only by being `md:`-and-up and last
  in the row — "Show" is on phones and sits mid-row. And **`setState` inside a
  `useEffect` is an eslint ERROR here**, so the panel is positioned in the
  click handler, not in an effect (that mistake cost the only two lint errors
  this thread added, both caught by the baseline comparison).


### 2026-08-26 → 27 — owner-driven fixes, then two features

- `3fd36f3` **THE EN/ID SWITCH DID NOTHING.** `useLanguage()` kept the pick in
  a `useState`, so every caller held its OWN copy — `useT()` is a caller and so
  is the switch in `BrandMenu`. Pressing EN updated the switch's copy and
  nothing else's; only a reload appeared to work. It is a module-level store
  with subscribers now (`lib/language.ts`, the shape `lib/settings.ts` uses),
  read via `useSyncExternalStore`. **Proved with the same rig either side:**
  before, clicking ID moved the button and left all six dashboard widgets in
  English; after, all six turn together. `/preview` gained the real switch —
  it is the one page that can answer "did the whole screen move?".
  `lib/language.test.ts` is new (8 tests).
- `09233b4` **Skin + language moved to the TOP of the brand menu, on ONE row.**
  They were the last thing under every module. The two uppercase headings were
  what cost the rows; they survive as `aria-label`. 110px → 36px. The
  Settings link is a GEAR because a text link fitted in English ("More →",
  202px of 212) and did NOT in Indonesian ("Lainnya →", 217px — over).
- `e268aed` **Dropdown chevrons.** Chrome pins its native arrow 5px from the
  border and IGNORES padding-right — measured at px-3/pr-7/pr-8/pr-9, all
  4.7px. So the app draws the arrow now: one rule in `app/layout.tsx`'s global
  block covering all **141 `<select>`s across ~20 local class constants**,
  12.7px in, `select:not(.appearance-none)` so the two deliberate opt-outs
  (EPC status pill, New Deal currency) keep their behaviour.
- `e2f085e` + `c9f9354` + `5bda547` **EPC follow-up notes** — `10.5_quote_notes`.
  A thread per proposal: who, when, ticked off one at a time, cleared never
  deleted, editable with an "edited" stamp. The newest OPEN note shows on the
  EPC Proposals list in place of the description; a filter finds proposals with
  one open. **Writes are `can_view_epc()`, NOT `can_edit_quote()`** — the
  latter locks a SENT proposal to owners, and a sent proposal is exactly the
  one needing "awaiting answer". Panel sits above the header form; settled
  notes fold. Contrast fixed on the dark skin (placeholder was **1.40:1**).
- `1fcd177` + `2bb0921` **MARGIN TIERS** — `21.2_margin_profiles` +
  `3.0_components.margin_profile_id`. Loss Leader 10–15% (123 items),
  Value Capture 20–25% (174), **Unclassified 693** (603 of them `non_stock`).
  Targets are DATA — a Margin Profiles tab on `/pricing` edits them, adds
  profiles, removes them; nothing in app code contains 10–15 or 20–25.
  Item Editor: tier column + chip, inline dropdown, tier filter, and **bulk
  assign riding the existing `applyBatchField`** so it stages into the normal
  Save with the normal diff. **"Off Target" filter** audits sell-price-vs-TUC
  against each item's own band — deliberately NOT SQL, because TUC is settled
  POs only, line share of PO value, taxes excluded, floored at the weighted
  average (`lib/computeTUC.ts`); it runs where `computeTUCMap` runs so it
  agrees with the GM figure beside it.


### 2026-08-25 — full Bahasa Indonesia, menus included (three commits)

**The 2026-08-19 rule is WITHDRAWN and the comment at the top of `lib/i18n.ts`
now says so.** The owner's four decisions, taken before any code was written:
keepers are **codes and units only**; translation happens with **`t(label)` at
the render site**, not a parallel `labelId` field; order is **menus → Dashboard
→ Purchasing**; glossary uses the **short trade forms**.

- `cbee282` **The menus.** All 45 nav labels + 8 group headers, everywhere they
  render (brand panel, desktop dropdowns, phone bottom bar, More sheet,
  Spotlight's page results, Settings › Menu), plus the 29 dashboard panel
  names, 11 Quick Actions, `ROLE_LABELS` and `ROLE_DESCRIPTIONS`.
  **`KEEPERS` is new in `lib/i18n.ts`** — the codes that stay English in both
  languages (PO, PI, GRN, DO, SO, SQ, INV, RCPT, SKU, kWp, PPN, EPC, FOB, CIF,
  plus Admin and Menu, which Indonesian spells identically). A keeper cannot be
  listed in the book (an entry equal to its own English already fails), so it is
  **declared in KEEPERS and omitted from ID** — and the guard test reads that
  list to tell "deliberate" from "forgotten".
  Spotlight keeps the English label in `keywords`, so "Deal Lookup" still finds
  *Telusur Transaksi*. Six older translations still carried English menu names
  inside them ("Kembali ke Stock", "Buka Item Hub"); fixed.
  *Measured:* owner's nav bar 642px EN → 661px ID at rest, 993 → 1052 with an
  active-module suffix. No English nav label reaches the suffix's 120px cap
  (widest "Import & Export", 105px) but "Biaya Sampai Gudang" is 145px, so the
  cap is **150px** now — only one group is active at a time, so it costs ≤25px.
- `54ff736` **The Dashboard.** Every widget, both files, plus the queue built in
  `lib/dashboard.ts`. **`ActionItem` now carries an English TEMPLATE and its
  vars** (`title` + `titleVars`, `detail` + `detailVars`) rendered with `tf()`
  at the row, because the lib was assembling English word order plus an "s"
  plural rule no other language has. English picks a singular or plural template
  in the lib; Indonesian maps both to one line. `TopBoard`'s `noun` was
  pluralised by gluing an "s" — callers pass the plural noun now.
  `useT()` **memoises `t`/`tf` on `lang`**: they are dependencies of any memo or
  effect that translates, and rebuilding themevery render made those recompute
  every render (eslint's `preserve-manual-memoization` caught it).
  *Two corrections:* the activity feed's `'Paid'` collided with the payment
  STATUS `'Paid' → 'Lunas'` (settled) — it is `'Paid out'` now; and a dead
  FRAGMENT pair from before `tf()` existed ("Nothing has landed in the last" +
  "days. Settings › Defaults sets…") was removed. **The orphan test cannot see
  that class** — it matches substrings, and both halves are substrings of the
  whole sentence.
  *Measured:* activity kind badge was `w-[4.5rem]` (72px), sized for English
  ("RECEIVED", 60px); "PENAWARAN" is 77px with nowhere to break and ran over the
  title. Now `w-[5.5rem]`.
- `c2ebefa` **Document statuses.** One vocabulary, 17 render sites, 11 files —
  Sales, Invoices, Delivery, Deal Lookup, Purchasing, customer and supplier
  profiles, After Sales, EPC Proposals, the dashboard activity feed. Translated
  ONLY where shown; the DB values stay English, so nothing compares, filters,
  sorts or writes against a translated string.
  *Measured:* "Confirmed Order" → "Pesanan Dikonfirmasi" is 135px against an
  English badge column sized at 112, so the badges say it short — **Dipesan**
  and **Disiapkan**. Widest Indonesian badge now +4px, not +31px.

**The guard, in `lib/i18n.test.ts` (6 new tests, 270 total).** The build fails
if a nav label, group header, menu hint, dashboard panel, quick action, role
name/description or document status ships with no Indonesian and no keeper
entry. **Verified it bites** by deleting two entries — it named both.


### 2026-08-24 — a day of owner-reported faults, all found by screenshot

Every one of these started as a phone screenshot from the owner. Two were real
bugs behind a cosmetic complaint; read them as evidence that "it looks off"
usually means something IS off.

- `7456fa6` **Phone dashboard + the CCC division artifact.** CCC read
  **1.702.981d** — Rp 24,7bn of stock ÷ Rp 1,3m of delivered COGS in 90 days
  (five delivery movements, **three booked with no unit cost at all**).
  `measuredDio()` in `lib/position.ts` now refuses past twenty window-lengths
  and the tile says why. `/profitability` had its own copy of the formula and
  the same fault; both use the one function now. The AI next-step advisor was
  reading the broken figure too. Phone layout: one shared `CardHead` (four
  panels had hand-copied it and all four broke the same way), and the arrival
  rows now break in the same place on every row.
- `f79f024` **Drag-to-reorder: one mechanism, `components/ui/dragReorder.tsx`.**
  Six lists had their own copy and all drew a ring around the hovered row —
  which answers "what am I over", not "where will this land". Three of the six
  ignored the pointer's half. Now a 3px line marks the exact seam.
  **Verified with real DragEvents in Chromium against `/preview`**, which
  gained the real arranger for that purpose.
- `d1faa73` **At-stake total** — sat 24px inside the column it totals on a
  phone (my own regression from `7456fa6`; the arrow spacer is `sm`-and-up now).
- `9fd8bbf` **EPC editor header** — seven controls in one `overflow-x-auto` row
  meant **Save was off-screen on a phone**, with no scrollbar to admit it. Two
  rows below `lg`, measured across seven widths.
- `57fc5ad` + `ffe6241` + `c73a02f` **The PO total bug — the important one.**
  A PO showed committed IDR 1.619.460 over one line item of IDR 809.730 that
  the bank had already paid in full. **Root cause, found by the OWNER's hunch,
  not mine:** `5.1_purchase_line_items` carries a DB trigger,
  `recalculate_po_total()`, which preserves the gap between the total and the
  lines (freight). `app/purchasing` wrote the PO's total *before* its line
  items existed, so the delta was measured against ZERO, the whole total was
  read as freight, and the goods were stacked on top → **exactly 2× the lines**.
  Reproduced against the live trigger in a `DO` block that raises at the end
  (so the probe rolls itself back). Fix is an ORDER: lines first, total last
  (`stampPoTotal`). Three rows corrected in
  `migrations/fix_doubled_po_totals.sql`; the trigger's precondition is now a
  `COMMENT ON FUNCTION` (`migrations/document_po_total_trigger.sql`).
  `lib/poTotals.ts` flags any total that disagrees with its own lines — 11 POs
  are still SHORT by exactly their freight, left alone by the owner's decision.
- `7f0d05e` + `25d3df2` **Item Editor action column** — seven icon buttons
  (252–288px, ragged 5/6/7 per row) folded to Specs + Edit + a named ⋯ menu
  (104px, fixed). **Two self-inflicted bugs worth remembering:** moving Inspect
  orphaned the 450ms hover peek (only three unused-variable warnings betrayed
  it), and the menu was rendered inside the table's `backdrop-blur-sm` card —
  **a backdrop-filter makes an element a containing block for `position:fixed`**,
  so the menu opened 301px too low. Everything else in that file portals to
  `document.body`; now this does too.

### Earlier

- `f5192c9` **Role-relevant dashboard defaults** — the module §6 used to
  describe, now shipped. `ROLE_DASHBOARDS` in `constants/dashboardWidgets.ts`
  declares per role: `lead` (the panels it opens on), `off` (panels it starts
  switched off) and `starts` (the screens its Quick Actions card leads with).
  ONE map behind the dashboard order, the Customise panel's "For your role"
  group AND Quick Actions — which had kept a second hand-maintained list inside
  `app/page.tsx`. Resolution is `layoutForRole(role, house)`: the role's panels
  float to the top of the HOUSE order rather than replacing it (the owner's
  call — layered, so one nudge in Settings cannot flatten every role back to
  identical), and `off` adds to what the house hid rather than fighting it.
  Precedence: role default → house → personal, with the role layer INSIDE the
  personal arrangement's `base` pin, so retuning a role dissolves stale personal
  copies exactly as a house change does. Settings › Dashboard gained
  **"What each role opens on"** (per-role preview through the same resolver).
  Nine new cases in `lib/dashboardWidgets.test.ts`; 238 tests at this handoff.
  Measured in Chromium: the "For your role" chip truncated "Needs you today" to
  "Need…" at 390px, so it is `sm`-and-up only and the emerald row edge carries
  the signal on a phone.

- `d2d8e36` **Top products / Top customers** dashboard widgets, ranked by revenue or
  gross profit (profit view gated on `canViewEconomics`; the fetch never asks for a
  cost it may not show).
- `25c5891` **Last payments / Last deliveries / Last service tickets** — three narrow
  feeds beside the wide activity stream.
- `729805e` + `46b38ac` **Terminal skin** (JTX-inspired), now the **default** for all
  pages. Dropdown offers only `terminal` / `terminal-light`; the four legacy skins
  (`dark`, `light`, `dim`, `paper`) still exist but are reachable only from Settings.
  `lib/theme.ts` holds `DEFAULT_THEME`, `MENU_THEME_VALUES`, `LEGACY_THEME_MIGRATION`
  and `THEME_MIGRATED_KEY`. Dark/light is picked from the user's prior preference.
- `34e1ea7` / `1e1a6c8` Bug fixes the owner reported from screenshots: black donuts
  (a raw palette token passed to an SVG `fill` renders black silently — always go
  through `ink()`/`tint()` in `SpendOverview.tsx`), garbled donut centre text
  (`letter-spacing` inheriting into SVG user units), At Stake right-alignment.
- `b4623fe` + `4a35f46` **`/preview`** — a dev-only component harness
  (`app/preview/page.tsx` + `Harness.tsx`, 404s in production, guarded by
  `lib/palette.test.ts`). All 12 dashboard widgets were lifted verbatim out of
  `app/page.tsx` into `components/dashboard/Widgets.tsx` so they can be rendered
  against awkward mock fixtures (`lib/dev/mockChartData.ts`) before shipping.
- `63fa4b7` **Header + page margin tightening** (the last piece of work). Measured in
  Chromium across 10 widths with a class-verbatim replica. Spacing only — zero font
  sizes changed, which the owner explicitly confirmed he wants kept. Result: list
  pages give back 26px on a laptop, **66px at 1920 @125%** (the header stops needing
  a second row), 20px on a phone. Tokens changed: `py-3 sm:py-4`→`py-2.5 sm:py-3`,
  `sm:gap-4`→`sm:gap-x-4 sm:gap-y-2.5`, `lg:gap-3`→`lg:gap-2`, nav `gap-1`→`gap-0.5`
  and `px-3`→`px-2.5`, spotlight `h-9`→`h-8`, page bodies `py-6`→`py-4 sm:py-5` /
  `py-8`→`py-4 sm:py-6`.

### Deliberately untouched — do not "tidy" these
- `min-w-[140px]` on the spotlight field (without it the field collapsed to a circle
  the clock painted over), `flex-shrink-0` on the nav, and the `xl` gate on the nav.
- `useHeaderSqueeze()` in `BrandMenu.tsx` — measurement-based, no hardcoded pixels.
  It drops the clock at level 1 and the nav at level 2. Adding pixel constants there
  has caused the "clashing top menu" bug four separate times.

### Open decision the owner has, from that work
On 1366/1440-wide laptops, list pages still wrap their page buttons to a second
header row. **The seven nav labels alone need 720px** of the bar. Only shortening
those labels ("EPC Proposals" → "EPC", etc.) closes it — worth ~100px, which would
buy those laptops the same 66px that 1536 just got. That's a wording call; the owner
has not decided.

---

## 5. Sandbox constraints and the measurement rig

- `cdn.tailwindcss.com` is blocked. To measure layout in a real browser, generate
  Tailwind CSS locally: a config mirroring `app/layout.tsx` (`fontFamily` +
  `TAILWIND_COLORS_JS`) + `npx tailwindcss -c cfg.js -i in.css -o tw.css --minify`,
  then build an HTML replica with class strings **copied verbatim** from the real
  components, and drive it with Playwright:
  `chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })`.
  Do NOT run `playwright install`. Keep all of this in the scratchpad dir.
  `node_modules` is EMPTY on a fresh sandbox — `npm install` first, or tsc will
  report thousands of "Cannot find module 'react'" errors that are not yours.
  Playwright itself is not a dependency: `npm i --no-save playwright-core` in
  the scratchpad, and drive the pre-installed Chromium with it. The Tailwind
  binary lives at `node_modules/.bin/tailwindcss` (`npx tailwindcss` fails).
- A replica is only as honest as its markup — the previous thread reported a wrong
  header height once because the replica invented three page buttons the Dashboard
  does not have. Copy the real page's actions markup.
- **Use the REAL font.** `fonts.googleapis.com` and `fonts.gstatic.com` are
  reachable through the proxy, so link the same Google Fonts stylesheet
  `app/layout.tsx` uses, `await page.evaluate(() => document.fonts.ready)`, and
  then **print `document.fonts.check('500 13px Rubik')`** with the numbers. A
  measurement taken in a fallback face is a wrong number reported as a fact, and
  it is invisible unless you check.
- `playwright-core` installs into the repo's `node_modules`, but a script kept in
  the scratchpad cannot resolve it from there — import it by absolute path
  (`/home/user/supabase/node_modules/playwright-core/index.mjs`).
- Chromium's first launch takes over two minutes here. Run the measuring script
  with `run_in_background: true` and wait on its output file, rather than
  watching a foreground command time out.

---

## 6. NEXT MODULE — the Shop (icasolar.com storefront), continued

**Read this section whole before touching `app/shop`.** It is the live demo the
owner is iterating on, the way ICAPROC itself was built: they click through it,
say what is wrong, you change the code, push to main, it is live in ~90 s.

### 6.1 Where it stands (all on `main`, deployed)

- **Live:** https://icaproc.com/shop — behind the existing ICAPROC login,
  listed in no menu (`canOpenPath` returns true for unregistered paths, so
  `constants/navigation.ts` and the access tests were never touched).
- **Routes** (`app/shop/**`, all `'use client'`, all gated on `useAuth`):
  - `/shop` — the INDEX: every department → its categories, counts, lowest
    open price. No hero, no messaging, search across the top.
  - `/shop/c/[dept]?cat=<category>&fam=<family|all>` — a department opens on
    its family tiles (rail / clamp / foot…; on-grid / off-grid…), the table
    appears once a family is chosen, spec filters in the sidebar GENERATED
    from the category's declared field set and scoped to the family.
  - `/shop/p/[id]` — product page, spec sheet first (from
    `CATEGORY_SPEC_FIELDS` + `SPEC_FIELD_META`, the same list Tech Specs edits),
    buy box in a narrow left column, alternatives as a table.
  - `/shop/search?q=` — every token must match; hits early in OUR name rank
    first; spec values indexed with units ("5kw 48v", "620wp", "mppt 40a").
  - `/shop/compare` — up to four, differing rows marked. `/shop/cart` — one
    basket, two lanes (Kurir / Ekspedisi), PPN 11%, "copy summary for
    WhatsApp"; writes NOTHING to the database.
- **Shared code:** `lib/shopCatalog.ts` (every rule, 491 tests incl. these:
  departments, `isShoppable`, `pricePerUnit`, `needsFreight`, `formatIdr`,
  `facetsFor`/`applyFacets`/`columnsFor`, `searchItems`, `FAMILIES`/`familyOf`/
  `familyIndex`), `components/shop/{shopUi,useShopData,ProductTable}.tsx`.
  `useShopData` shares ONE fetch per page; SELECT never includes cost,
  supplier, margin — or `supplier_model`.
- **Commits, in order:** `59ed8e9` compare slot picker (Tech
  Specs) · `8c82c42` searchable Replaces Quote + EPC kWp/kW AC from items ·
  `eae1e86` quote/PO menus scoped to chosen supplier (`lib/dropdownPool.ts`) ·
  `c8a935b` sales print filename convention · `a5ba771` every print view +
  iOS name card · `7481e0b` first /shop · `c59d65a` McMaster rebuild ·
  `21ddae9` families, autocomplete, no supplier naming · `feccac9` handoff ·
  `1bc8ae1` the product taxonomy (§4).
- **Design canvas** (8 artboards, the pre-code mockups, still useful for
  the intended look): https://claude.ai/code/artifact/837d61ef-0cd6-402f-b5e1-f987ae211dfa

### 6.2 The design intention (owner's words, 2026-09-05 — do not drift from it)

> "The website should be more direct, technical person focus who wants quick
> information on what's available, the specs, and cater to their urgent
> needs, than too much promotion messaging." Reference: https://www.mcmaster.com/

A CATALOGUE with a cart attached, not a store. Index not hero; tables not
cards; filters ARE the spec fields; search is the primary UI; 13px type,
32px rows, hairlines, 4px radii; line drawings for products (0 of 1,002 rows
has a photo). What is taken from McMaster is the intention only — its
yellow-green skin and layout grammar are theirs; the skin stays ICA's steel
blue `#1f5aa8` + Rubik from the quote/proposal PDFs. Indonesian primary.
Prices via `formatIdr` ("Rp 1.656.000"), never the ERP's settings-driven
`fmtRupiah`. **Only OUR `internal_description` is ever shown; the supplier's
model/description is not fetched, shown, or searched.**

### 6.3 Decisions locked with the owner

1. **Two sites, one catalogue.** `ica.id` stays corporate/EPC, `icasolar.com`
   becomes the store. Both are **WordPress today, run separately by staff**;
   after this, staff maintain the CATALOGUE (Item Editor / Tech Specs / Set
   Pricing) and the sites render it. Keep the old sites up until cutover;
   build a redirect map for existing URLs.
2. **Demo on an icaproc.com subdomain first, then port to the owner's own
   VPS.** So the store is PORTABLE BY CONSTRUCTION: `app/shop/**`,
   `components/shop/**`, `lib/shopCatalog.ts` touch Supabase and the spec
   schema and nothing else of the ERP (own CSS block, own currency format).
   Lifting it is a folder move + `next build`.
3. **Target repo shape:** one repo — `packages/catalog` (specSchema,
   specFields, categoryUnits, formatters, shopCatalog) + `apps/erp` +
   `apps/store` + `apps/ica`; three Vercel projects from `main`. Sharing code
   ≠ sharing data: public apps read a `public_catalog` VIEW (name, brand,
   category, specs, price, images — no cost/supplier/margin) with anon
   SELECT on the view only.
4. **Categorisation — PARTLY SETTLED 2026-09-05 (was "deferred").** The
   owner reopened it and set the shape: three levels, only the middle one
   stored (see §4's taxonomy entry and `constants/productTaxonomy.ts`). The
   rule is **new category only when the spec field set differs; sub-category
   when it does not.** `FAMILIES` are still regex rules over our descriptions
   and are still a stopgap — but they do NOT become a column. They become the
   FALLBACK for `SUBCATEGORY_FIELD`: once a category's sub-category spec field
   is typed on a row, the typed value wins and the regex is only used where
   the field is still blank. That way the guess decays as staff type instead
   of being ripped out and regressing the shop.
5. **Photos & datasheets → Supabase Storage** (agreed in principle, not
   built): buckets `product-images` (`{component_id}/1600|800|400.webp`,
   resized IN THE BROWSER at upload — never depend on Vercel/Supabase image
   transforms, they are plan-gated and don't port) and `datasheets`
   (`{component_id}/{rev}.pdf` — OUR copy, versioned; keep `datasheet_url`
   as the manufacturer link). Columns: `image_paths jsonb`,
   `datasheet_path`, `datasheet_rev`, `datasheet_uploaded_at`. **Store
   PATHS, not URLs** — base URL is one env var, so the VPS move is one
   variable. Upload UI + "ready for web" meter (price ✓ photo ✓ specs ✓
   datasheet ✓) belong in Item Editor; `/shop` shows real photos with the
   line drawing as fallback. Only ~137 priced items need photos; start with
   the 50 that move. Manufacturer press photos: get permission in writing.

### 6.4 Open items, in the order they should happen

- **The sub-category mechanism — NEXT, and the only half of the taxonomy
  still unbuilt.** `SUBCATEGORY_FIELD` names the axis per category, but
  nothing renders or constrains it yet. Three pieces, in order:
  1. `SpecFieldMeta` has no option kind — `kind: 'number' | 'text' |
     'boolean' | 'list'`. So `battery_type` and `controller_type` are FREE
     TEXT and have already drifted: `LiFePO4` (16 rows) vs `LiFePO4 (with
     BMS)` (1) vs `Lead-acid (deep cycle)` (2). Add `kind: 'option'` +
     `options: string[]`; it turns Tech Specs into a dropdown everywhere,
     not just here.
  2. The fields that do not exist yet: `module_type` (Mono / Bifacial, 0 of
     13 typed), `switchgear_type` (MCB / MCCB / SPD / Fuse / Panel Box),
     `device_type` (Logger / Meter / Comms), `cable_construction`. And
     `CATEGORY_SPEC_FIELDS` entries for `ac_cable`, `switchgear`,
     `monitoring` — they have none, so the shop generates no facets for them.
  3. `subcategoryOf(item)` = the typed field when present, ELSE the
     `FAMILIES` regex. Never retire FAMILIES outright — most rows are
     untyped and the shop would collapse into "Lainnya".
  Then offer the owner a regex-seeded backfill; do not just run it.
- **Owner review of the family cuts** — Mounting (8) is still the biggest
  judgement call in `FAMILIES`. (Proteksi is gone: it split into Switchgears
  and Monitoring & Comms on 2026-09-05.)
- **shop.icaproc.com** — needs the OWNER to add the domain to the Vercel
  `supabase` project (Settings → Domains; DNS is already there, it is the
  project serving icaproc.com). Then and only then push a middleware that
  rewrites that host to `/shop`. Do NOT add speculative middleware to the
  live ERP for a domain that does not exist.
- **Photos + datasheets** — per 6.3 (5). Additive schema; say so and apply.
- **BEFORE ANYTHING IS PUBLIC** (a public site ships the anon key in every
  page): close the `3.0_components` anon UPDATE policy hole; auth the two
  open API routes `app/api/insert-from-pdf` and `app/api/extract-pdf`.
  **The GitHub repo is PUBLIC** — no secrets committed (all keys from env,
  no `.env` tracked) but schema/table names/RLS assumptions are readable,
  which makes those holes a published map. **Vercel team is on HOBBY**,
  which does not permit commercial use — move to Pro before a public store.
- **`packages/catalog` extraction**, then `public_catalog` view + RLS, then
  `apps/store`, then `apps/ica` (+ WordPress content and redirects), then
  Midtrans/Xendit + Biteship, then quote request → draft Sales Quote (DQ)
  in ICAPROC.
- **Stock/lead time** is NOT read yet: "Kurir / Ekspedisi" is derived from
  weight or category (`needsFreight`), and there is no "ready stock" signal
  on the shop. `30.1_stock_balances` exists; wire it when the owner asks.
- **Unpriced items** (~258 of ~395 shoppable) show as "harga via penawaran"
  on purpose — it is the gap made visible. Do not hide them.
- Smaller, still open: Stored Quote picker in New Deal is still a plain
  `<select>`; Support Letter print still on the old filename shape; 20 of 23
  on-grid inverters have no `norm_value` (the AC-capacity rule reads the
  rating off the name as a fallback — offer a backfill, don't just do it).

### 6.5 Backend facts you will need

- **GitHub** `etirtaputra/supabase` (PUBLIC). Push straight to `main`:
  `git push origin HEAD:main`. Never a sub-branch, never a PR unless asked.
- **Vercel** team `etirtaputras-projects` (`team_vZGw83tgQXTmrZoAk62NAdqs`),
  project `supabase` (`prj_7TOK8Ht8rVI6kV5uJpSJ4mvfTQQQ`), region `iad1`,
  aliases `icaproc.com`, `www.icaproc.com`; production deploys from `main`
  in ~60 s. Dashboard: https://vercel.com/etirtaputras-projects/supabase/deployments
  `mcp__Vercel__get_deployment` shows build state; no `vercel.json` in repo.
- **Supabase** project `icaproc`, ref `xijgplktpnpnstgeolfa`, region
  `ap-northeast-2` (Seoul — good for Indonesian buyers), Postgres 17. **No
  Storage buckets exist yet.** Use `mcp__Supabase__execute_sql`; direct
  fetch to supabase.co is proxied-out of the sandbox. Owner said "always
  allow claude to execute sql" (a harness permission, not something the
  model grants itself). Additive schema changes: write the `.sql` into
  `migrations/` AND apply it, and say so. Never mutate data without asking.
- **Sandbox:** `.env.local` does not exist, so `next start` 500s on every
  page here — that is environmental, not a bug. `npx next build` is the
  check. Tests: `npm test` (node --test, relative `.ts` imports only).
- **Definition of done:** `npm test` green (491 at handoff) · `npx next
  build` clean · pushed to `main` · this file's §4/§6 updated.

### 6.6 Deferred module: compile Tailwind at build time

Not started; still worth doing after the shop settles. There is no compiled
CSS in the repo — styling is `<script src="https://cdn.tailwindcss.com">` in
`app/layout.tsx`, built from the DOM after mount, so every screen flashes
unstyled. THE TRAP: a build-time Tailwind scans source text, so every
runtime-composed class (`` `text-${tone}-400` ``, classes from maps/props/DB,
the generated `constants/palette.ts` themes, `STATUS[...]?.cls`) silently
stops existing — find and safelist/rewrite those FIRST. The §5 measuring rig
(`node_modules/.bin/tailwindcss`, not `npx`) is the config starting point.
The shop's own CSS is a plain `<style>` block and is unaffected.

## 7. If no next module has been chosen

Sometimes the owner hands off without a module in mind. **That is a valid start,
not a blocked one** — and it is the doctrine working as intended: *"the old era
was telling the AI what to do; the new era is asking the AI what it thinks we
should do next."*

Do not ask "what would you like to work on?" — that hands the question back. Do
this instead, in one turn:

1. **Read the ground truth**, in this order: §4 and §6 above; `docs/ERP_ROADMAP.md`
   (especially the **Build sequence** and **Status** sections — Status is the list
   of what is actually done); `constants/changelog.ts` (the last ~10 entries show
   where momentum is); and the "Long-standing items" list at the end of §6.
2. **Look at the live data before proposing anything.** Use the
   `mcp__Supabase__execute_sql` tool (direct HTTPS to Supabase is blocked in this
   sandbox — see §1). Count what actually exists: how many rows in the sell-side
   tables, how many POs sit unreceived, how many customers carry no contact, how
   many items have never been priced. A module that looks important on the roadmap
   and touches 4 rows of real data is not the next module. This step has changed
   the answer before — "Never sold" was declined as a feature because the sell side
   had only been live since 2026-07-18.
3. **Come back with 3 candidates, ranked, and a recommendation.** For each, in two
   or three sentences: what it is, why now, roughly how big, what it unblocks, and
   what it costs to defer. Score them against the mission in `CLAUDE.md` — the cash
   conversion cycle is the spine, and "everything connects" means a module that
   makes three existing screens talk to each other often beats a new screen.
   At least one candidate should be a small, finishable one — not every thread
   should be a module-sized commitment.
4. **Then stop and let the owner pick.** Do not start building on your own
   recommendation. Once he picks, put your design questions to him before writing
   code, the same as §6.

If he picks something not on your list, take it without re-litigating — and update
§6 with it so the next thread inherits the decision.

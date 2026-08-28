# ICAPROC — thread handoff

**Last updated: 2026-08-28** · head of `main` at that point: `999603f`

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
- Head of `main` at handoff: `999603f` — "Sales order lines: upsert what survives, delete what went".

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
npm test             # node --test "lib/**/*.test.ts" — 295 tests at handoff, all pass
npx eslint           # ~294 pre-existing errors repo-wide; just don't ADD any
npm run build        # next build must be green
```
Plus: a `constants/changelog.ts` entry in the same commit.

---

## 4. What the previous threads did (for context, all shipped to main)

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

## 6. NEXT MODULE — compile Tailwind at build time (or pick from §7)

**Why this one is on the table:** the owner reported it himself on 2026-08-27,
as "there's this lines during loading in Item Editor" with a screenshot. Half
of that screenshot was a real bug (fixed, `b97d6ea`); the other half is that
**this app has no compiled CSS**. There is no `tailwind.config`, no
`postcss.config`, no CSS entry file — styling comes entirely from
`<script src="https://cdn.tailwindcss.com">` in `app/layout.tsx:70`. The Play
CDN builds the stylesheet by scanning the DOM after it mounts, so every
client-rendered screen has a window where the markup is up but its classes are
not. On the Item Editor's 990 rows that window is long enough to photograph.

**Why it is worth a thread, not a patch:**
- it is on the critical path of *every* screen's first paint, and it is the
  only remaining runtime dependency the app cannot serve itself — which sits
  badly against "own the data, own the tooling";
- the Play CDN also prints a "should not be used in production" console warning
  on every load, which the owner will eventually screenshot too;
- `constants/palette.ts` is GENERATED (`scripts/generate-palette.js`) and feeds
  Tailwind through `TAILWIND_COLORS_JS` as a string. A build-time config has to
  consume the same generator output, or the six skins silently diverge.

**What it involves:** a `tailwind.config.js` whose `theme.extend` mirrors the
inline `TAILWIND_THEME` in `app/layout.tsx` verbatim (`fontFamily` +
`TAILWIND_COLORS_JS`), a CSS entry with the three `@tailwind` directives plus
the existing global `<style>` block moved into it, `postcss.config.js`, and
deleting the two `<script>` tags. **The measuring rig in §5 already does
exactly this** — `scripts`-free, in the scratchpad, driven by
`node_modules/.bin/tailwindcss` — so the config ismostly written; lift it
from there.

**Traps to expect:**
- **Any class composed at runtime stops working.** The CDN scans the live DOM,
  a build scans the SOURCE. Every template-literal class in the app has to
  resolve to literal strings the scanner can see, or be safelisted. This is the
  whole risk of the change and it fails *silently* — an unstyled element, not
  an error. Diff a built stylesheet's class list against the app's class sites
  before believing it.
- `cdn.tailwindcss.com` is blocked by the sandbox proxy, so the BEFORE state
  cannot be reproduced here. The AFTER state can be, completely.
- Arbitrary values (`w-[5.5rem]`, `max-w-[190px]`, `z-[131]`) are everywhere and
  are fine, but only when written literally.

**Alternative if the owner would rather not:** §7 has the procedure for picking
a module, and the sell-side roadmap in `docs/ERP_ROADMAP.md` still has CRM as
the next unbuilt module in the sequence.

### Then, still open from the margin-tier work

- **The soft margin flag on quote/order LINE items.** Shipped for the Item
  Editor only. The spec (2026-08-27) asks for it on sales/EPC quote lines too;
  it needs the line-margin path in two editors and was deliberately left out
  rather than half-built. Not one of the six acceptance criteria, all of which
  are met.
- **A standalone Tier Audit report** on `/pricing` beside Floor Audit — totals
  and money-at-stake per tier. The Item Editor filter answers "which items";
  a report would answer "how much is this costing us". Offered, not asked for.
- **693 Unclassified items.** 603 are `non_stock`. Filter to Unclassified in
  the Item Editor and bulk-assign; the tooling for it shipped.

### The Bahasa Indonesia sweep — still the standing backlog

Menus, Dashboard and document statuses are done (§4, 2026-08-25). What is left
is the INSIDE of the big screens, in the owner's order: Purchasing shell →
**`components/ui/ComponentEditor.tsx` (5,674 lines, the largest untranslated
file — probably its own thread)** → Sales → Deal Lookup. The four decisions
are settled and must not be re-litigated: keepers are codes and units only;
`t(label)` at the render site; that order; short trade forms in any control.
`lib/i18n.test.ts` fails the build if a nav label, group header, panel, quick
action, role or document status ships with no Indonesian and no keeper entry.

### Traps this run hit — inherit these

- **A duplicate phrase-book key silently wins.** Adding `'Paid'` when it
  already existed replaced a translation used on another screen. `tsc` catches
  it (TS1117) *including* one written with a `\uXXXX` escape — but only if you
  read the error. Before committing an i18n change, diff the parsed map against
  `HEAD` and check nothing was LOST or CHANGED.
- **The orphan test matches SUBSTRINGS**, so a fragment of a longer entry can
  never be looked up and is never reported.
- **An entry that is only placeholders** (`'{who} · {when}'`) equals its own
  English and fails the suite — omit it, `tf()` fills it from the fallback.
- **A map parameter named `t` shadows the translator** (`tiles.map((t) => …)`,
  `const t = totalsByQuote.get(…)`). Rename it, or bind as `tr`.
- **`t`/`tf` are real dependencies** now they are memoised on `lang`;
  `preserve-manual-memoization` is an ERROR, not a warning.
- **Postgres `now()` is transaction time**, so two rows inserted in one
  transaction share a timestamp and any `ORDER BY created_at` is a coin flip.
  Break the tie on the id, in BOTH the SQL and the client sort.
- **`text-slate-600` is 2.38:1 on the terminal skin** — fails WCAG AA (4.5)
  and the app uses it **768 times across 67 files** for small print. Raised
  with the owner as a systemic fix (lighten the token in the palette
  generator); NOT done, because slate-600 is also a border and background
  colour. His call.
- **Vercel is slow and its `state` field LAGS the build logs badly** — a
  deployment can read QUEUED/BUILDING for 10+ minutes after the logs say
  "Build Completed". Read `get_deployment_build_logs`, not just `state`.

---

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

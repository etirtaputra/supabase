# ICAPROC — thread handoff

**Last updated: 2026-08-25** · head of `main` at that point: `c2ebefa`

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
- Head of `main` at handoff: `c2ebefa` — "Document statuses in Bahasa Indonesia — one vocabulary, every list screen".

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
npm test             # node --test "lib/**/*.test.ts" — 270 tests at handoff, all pass
npx eslint           # ~294 pre-existing errors repo-wide; just don't ADD any
npm run build        # next build must be green
```
Plus: a `constants/changelog.ts` entry in the same commit.

---

## 4. What the previous threads did (for context, all shipped to main)

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

## 6. NEXT MODULE — finish the Bahasa Indonesia sweep: Purchasing, then Sales

The owner's ask ("fully Bahasa Indonesia, including the menus") is **honoured
for everything he navigates by and everything on the screen he lands on.** What
is left is the INSIDE of the big working screens. This is a continuation, not a
new module — the decisions are made, the mechanism is proven, and the guard is
in place. Do not re-litigate any of it with him.

### The four decisions, already taken (2026-08-25) — inherit, don't re-ask

1. **Keepers are codes and units only** — the `KEEPERS` list in `lib/i18n.ts`.
2. **`t(label)` at the render site**, never a parallel `labelId` field.
3. **Order: menus → Dashboard → Purchasing/Item Editor → Sales → Deal Lookup.**
   The first two are shipped; you are on Purchasing.
4. **Short trade forms** in any control (button, badge, tile label, column
   heading); full sentences only where there is room. The note near the top of
   `lib/i18n.ts` explains this and it has already saved two layouts.

### Where it stands — measured 2026-08-25, at `c2ebefa`

- **562** phrase-book entries (310 at the start of the day).
- **26 of 126** `.tsx` files under `app/` + `components/` call `useT()` (was 20).
- Fully translated: the whole menu system, Spotlight's page results, the
  Dashboard, role names and descriptions, and every document status badge.

### The job, in the owner's order

**A. Purchasing** — `app/purchasing/page.tsx` (1,628 lines) is the shell: four
tabs (Item Editor, New Deal, Payments, Deal Lookup), the header, the tab
buttons, empty states. Start there; it is the frame the owner sees first.

**B. Item Editor** — `components/ui/ComponentEditor.tsx` is **5,674 lines and
the single biggest untranslated file in the app.** Give it its own commit, and
consider giving it its own THREAD. Column headings and row actions are controls:
short forms.

**C. Sales** — `app/sales/[id]/page.tsx` (2,050) then `app/sales/page.tsx`.
`SalesMilestones` already has `useT`.

**D. Deal Lookup** — `components/ui/DealLookupTab.tsx`; already has `useT` and
its status badges.

### Traps this thread hit, so you don't

- **A duplicate key silently wins.** Adding `'Paid': 'Dibayar keluar'` when
  `'Paid': 'Lunas'` already existed replaced a translation used on a different
  screen. `tsc` catches literal duplicates (TS1117) — *including* one written
  with a `\uXXXX` escape and one written literally — but only if you LOOK at the
  error instead of deduping mechanically. **Before committing an i18n change,
  diff the parsed map against `HEAD` and check nothing was LOST or CHANGED**;
  that check found the one entry this thread nearly dropped.
- **The orphan test matches SUBSTRINGS**, so an entry that is a fragment of a
  longer entry can never be looked up and will never be reported. Two such
  fragments had been dead in the file for days.
- **A map parameter named `t` shadows the translator** (`tiles.map((t) => …)`,
  `const t = totalsByQuote.get(…)`). Rename the parameter, or bind the
  translator as `tr` — both patterns are in the tree now.
- **`t`/`tf` are dependencies.** They are memoised on `lang` in `hooks/useT.ts`,
  so list them in any `useMemo`/`useEffect` that translates; eslint's
  `preserve-manual-memoization` is an ERROR, not a warning.
- **Never translate a value that is written, compared or filtered.** Statuses
  are stored in English; a dropdown keeps English in `value` and translates only
  the option text.

### Still English on purpose, and why

- `ENUMS.proforma_status` — its `'Open'` collides with the verb `'Open'`
  already in the book (`'Buka'`). A PI that is still open is not a button; that
  needs a wording decision from the owner, not a translation.
- `constants/productColumns.ts`, `constants/listDefaults.ts`,
  `PERMISSION_MATRIX` in `constants/roles.ts` — untouched, no decision needed,
  just work.
- `ActivityRow.sub` on the dashboard renders a raw DB status through `t()`, so
  the statuses now resolve and anything else falls back to English.

### Long-standing items still awaiting the owner (raise once, don't re-litigate)
- **SETTLED 2026-08-25:** the Indonesian glossary. Short trade forms, per the
  owner's pick — Mundur/Maju, Transit, eksternal, Sisa piutang (used for the
  "Owed to us" tile), Pembayaran masuk, Penawaran → pesanan.
- 11 POs whose total is SHORT by exactly their freight (older foreign PIOs,
  several Fully Received). Flagged in amber on the deal card; owner chose to
  leave the data alone on 2026-08-24.
- 25 Confirmed POs with zero receipts, ETAs ~9 months past.
- Whether the `sales` role should see margin (would light up the Profit toggle
  on `topProducts` / `topCustomers`).
- The Dolibarr delivery-document import, so history feeds the leaderboards.
- Three of the five ⋯ menu actions overlap (Stock, Inspect, Item hub — the hub
  contains the other two). Worth removing one; needs the owner's usage.
- **A latent bug class, unswept:** any `position: fixed` overlay rendered
  inside a `backdrop-blur` container is mispositioned (see `25d3df2`). Nobody
  has swept the app for others.
- Delivery movements booked with **no `unit_cost_idr`** (3 of 5 in the last
  90 days) — until they carry cost, item GP and the cash cycle measure against
  a hole.
- On 1366/1440-wide laptops, list pages still wrap their page buttons to a
  second header row. Shortening the nav labels would close it — and note the
  Indonesian labels are only **19px wider** than the English at rest, so the
  language did not make this worse.

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

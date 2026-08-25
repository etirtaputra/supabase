# ICAPROC — thread handoff

**Last updated: 2026-08-24** · head of `main` at that point: `25d3df2`

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
- Head of `main` at handoff: `25d3df2` — "Portal the row menu out of the blurred card, and quieten the Curr field".

### Vercel — https://vercel.com/etirtaputras-projects/supabase/deployments
- Production deploys **automatically from `main`**. Pushing to main IS the release.
- **No preview deployments** (owner's rule, 2026-08-03). Do not create or trigger
  Vercel preview deploys, and do not push branches expecting a preview URL.
- There is no `vercel.json` and no `.vercel` dir in the repo — config lives in the
  Vercel dashboard. `mcp__Vercel__*` MCP tools are available for reading
  deployments, build logs and runtime errors if a deploy goes red.

### Supabase — project ref `xijgplktpnpnstgeolfa`
- Client is created in `lib/supabase.ts` from `NEXT_PUBLIC_SUPABASE_URL` /
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`; `.env.local` exists in the sandbox.
- **The sandbox proxy returns 403 on CONNECT to `xijgplktpnpnstgeolfa.supabase.co:443`,
  so `fetch`/`curl` against Supabase from a script will fail.** Use the
  `mcp__Supabase__execute_sql` / `list_tables` / `apply_migration` MCP tools instead —
  those work. Do not try to disable TLS verification or unset `HTTPS_PROXY`.
- `cdn.tailwindcss.com` is also blocked by the proxy — see §5 for the workaround.
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
   and check the translated string still fits its slot.

## 3. Definition of done (run all four before committing)

```bash
npx tsc --noEmit     # must be clean
npm test             # node --test "lib/**/*.test.ts" — 264 tests at handoff, all pass
npx eslint           # ~294 pre-existing errors repo-wide; just don't ADD any
npm run build        # next build must be green
```
Plus: a `constants/changelog.ts` entry in the same commit.

---

## 4. What the previous threads did (for context, all shipped to main)

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

---

## 6. NEXT MODULE — full Bahasa Indonesia, menus included

**The ask (owner, verbatim, 2026-08-24):** *"Make the Indonesia language
settings, fully Bahasa Indonesia, including the menus."*

### ⚠️ This REVERSES a standing rule. Read this first.

`lib/i18n.ts` opens with: *"The owner's rule (2026-08-19): menu labels stay
English — 'Stock', 'Deal Lookup', 'Landed Cost' are the vocabulary the team
already shares with suppliers and customers, and translating them would give
one thing two names."* **That rule is now withdrawn by the owner.** Update that
comment as part of the work, or the next thread after you will follow the
stale rule. Standing rule #8 in §2 (the phrase-book mechanics) still holds —
only the menus-stay-English part is gone.

Ask the owner early which trade words keep their English even in ID: PO, PI,
GRN, DO, SKU, kWp are near-certain keepers, and `lib/i18n.test.ts` FAILS on any
entry whose Indonesian equals its English, so a keeper cannot simply be listed
in the phrase book — it has to be left out of it.

### How i18n works today

- `lib/i18n.ts` — `ID: Record<string,string>`, **keyed by the English string**
  (a phrase book, not a key namespace). `t(en, lang)`; `tf(en, lang, vars)` for
  whole sentences with `{placeholders}`. **310 entries** today.
- `hooks/useT.ts` → `{ t, tf, lang }`, bound to `hooks/useLanguage.ts`
  (personal pick → company default from Settings › Defaults → English).
  `lib/language.ts` holds the storage; the EN/ID toggle is in `BrandMenu`.
- `lib/settings.ts`: `language: 'en' | 'id'`, default `'en'`.
- `lib/i18n.test.ts` enforces three things, and they WILL bite:
  1. every ID entry's English must still appear somewhere in `app/`,
     `components/`, `constants/` or `lib/` (edit the English, orphan the entry);
  2. no entry may equal its own English;
  3. no entry ≤5 words may end on a preposition (the fragment trap) — build
     whole sentences with `tf()` instead of gluing fragments.

### The size of the job — measured, 2026-08-24

- **262** `t()`/`tf()` call sites, in **20** files.
- **106 of 126** `.tsx` files under `app/` + `components/` never call `useT()`
  at all. That is the untranslated surface, and it is most of the app.
- `constants/navigation.ts`: **44 labels** (untranslated — the reversed rule)
  and **45 hints** (already translated).
- `constants/dashboardWidgets.ts`: **29** labels/hints — hints translated,
  labels not.
- Other English-in-constants worth a pass: `ROLE_LABELS` /
  `ROLE_DESCRIPTIONS` / `PERMISSION_MATRIX` in `constants/roles.ts`, status
  enums in `constants/enums.ts`, `constants/productColumns.ts` headers,
  `constants/listDefaults.ts`.

### Suggested shape (put it to the owner before building)

1. **Decide the keeper list** (trade words that stay English in both languages)
   and write it down in `lib/i18n.ts` — it is a rule, so it belongs in one file.
2. **Menus first**, since that is what the owner asked for: `label` in
   `constants/navigation.ts` + `ROLE_LABELS` + widget labels. The label is data
   in a constant, so either translate at the render site with `t(label)` or add
   a parallel `labelId`. **Recommend `t(label)`** — it keeps one source of
   truth and the phrase book stays the only dictionary.
3. **Then the screens the owner uses daily**, in this order: Dashboard →
   Purchasing/Item Editor → Sales → Deal Lookup. Do NOT try all 106 files in
   one thread; ship a screen at a time with its changelog entry.
4. **Guard it**: extend `lib/i18n.test.ts` with a check that every registered
   nav label and widget label has an ID entry (or is on the keeper list), so
   the next new screen cannot ship English-only by accident.

### Long-standing items still awaiting the owner (raise once, don't re-litigate)
- Indonesian glossary review: Mundur/Maju, Transit, eksternal, Sisa piutang,
  Pembayaran masuk, "Penawaran → pesanan". **This module is the moment to
  settle them.**
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

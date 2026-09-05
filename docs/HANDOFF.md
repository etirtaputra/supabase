# ICAPROC — thread handoff

**Last updated: 2026-09-05** · head of `main` at that point: see §4 (storefront demo)

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
3. **`insert into auth.identities`** — the trap. A user created by direct
   INSERT has no identity row, and GoTrue rejects password sign-in without
   one with "Invalid login credentials" even though the hash is correct.
   `identity_data` must carry `sub` (the user id, as text) and `email`.

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

### Two security holes found and NOT yet fixed (owner informed, not authorised)

1. **`app/api/insert-from-pdf/route.ts` has no auth and writes with the
   service-role key.** Anyone reaching that URL can insert suppliers, quotes,
   POs and line items into production. `extract-pdf` is also open and spends
   `ANTHROPIC_API_KEY` for any caller. `ask` and `next-step` check the bearer
   token correctly — copy that pattern.
2. **The whole buy side is ungated at the DB level.** Ten tables
   (`1.0`–`9.0`, minus `6.0_po_costs`) carry `ALL TO authenticated USING
   (true)`; role gating for them lives only in React, so `po@icasolar.com`'s
   `buy_admin` is a label, not a constraint. `3.0_components` additionally has
   an anon `UPDATE ... USING (true)` policy. Everything built later (42 write
   policies) IS properly role-gated.


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

## 6. NEXT MODULE — compile Tailwind at build time

**Why this one.** It is the biggest remaining first-paint win and the owner has
already photographed the symptom: the Item Editor rendering unstyled for a beat
before the CSS arrives. That is not a bug in that screen. **There is no compiled
CSS in this repo at all** — no `tailwind.config`, no `postcss.config`, no CSS
entry. Styling is a single `<script src="https://cdn.tailwindcss.com">` in
`app/layout.tsx:70`, which builds the stylesheet by scanning the DOM *after* it
mounts. Every screen pays for it; the Item Editor is just where it was caught.

**THE TRAP, and it fails SILENTLY.** A build-time Tailwind scans SOURCE TEXT,
not the live DOM. Any class name assembled at runtime simply stops existing:

```
className={`text-${tone}-400`}          // gone
className={cls}  // cls came from a map, a prop, or the database
```

The Play CDN never cared, because it read the DOM. So the job is not "add a
config" — it is **find every runtime-composed class first**, and either safelist
it or rewrite it to a whole literal string. `constants/palette.ts` is GENERATED
(edit `scripts/generate-palette.js` and re-run, never hand-edit) and the six
themes emit blocks of classes, so start there and in the status/tone maps
(`lib/salesStatus.ts`, `constants/roles.ts`, the `STATUS[...]?.cls` pattern).

**You already have most of the config.** The measuring rig in §5 builds CSS
locally with `node_modules/.bin/tailwindcss` (`npx tailwindcss` does NOT
resolve) — that config is the starting point, and the same rig is how to
compare before/after.

**How to know it worked, rather than assume.** `cdn.tailwindcss.com` is BLOCKED
by the sandbox proxy, so a Playwright run against the built app is the honest
test: load a page, assert a known class actually has its declaration, and
diff a screenshot before and after. Do not ship this on a reading of the diff.

### Also still open, from earlier threads

- **Four CNY POs carry a USD exchange rate** — PIO-2026013 (17,881), EB.42277
  (17,822), EB.42278 (17,882), PIO-2026011 (17,822), all Shenzhen Kstar, raised
  7–12 Aug 2026. The same supplier's other CNY POs use 2,427 / 2,502 / 2,643.
  Overstates committed value by **Rp 24.76bn**. Owner said **leave it for now**
  (2026-08-27). The durable fix is a per-currency plausibility band held as
  DATA (like margin profiles) plus a row flag, riding the mismatch machinery
  Deal Lookup already renders via `checkPoTotal`/`totalDisagrees`.
- **Max rows stays at 1000, but it is now safe to change.** Owner asked whether
  to raise it; the answer was no — raising only defers the same silent
  truncation to a larger number. The "do not LOWER it" caveat is **lifted** as
  of `7e705cb`: all ten hand-copied paging loops are gone, so no screen depends
  on the cap being exactly 1000 any more. RLS is on for all 57 tables, so the
  cap is a payload guard, not access control.
- **157 of 222 POs** have neither a PI number nor a quote link, so Deal
  Lookup's quote→PO→payment chain is unavailable for 71% of them.
- **15 Confirmed POs over 90 days old** (avg 131, oldest 315) and **42 Open
  quotes over 90 days**, oldest 2025-04-23.
- **46 `react-hooks/set-state-in-effect` remain**, all on the app's standard
  `useEffect(() => load(), [load])` data-load pattern, in files the paging
  loops never masked. The 7 that `7e705cb` exposed were fixed properly (see §4)
  — that refactor is the template if anyone wants the other 46 gone.
- **`lib/serials.ts` and `lib/landedCost.ts` still swallow a read error** and
  return a SHORT list with no signal. `fetchAllRows` now hands them
  `{ error, truncated }`; nothing surfaces it, because doing so needs a UI
  decision. Small, and it is the same class of silent-partial-data bug the
  row-cap work was about.
- **`text-slate-600` fails WCAG AA** on the terminal skin (2.29:1 on a card),
  used 768× across 67 files. Held at parity through the graphite change, not
  fixed. Systemic fix = lighten the token in the palette GENERATOR. Owner's
  call.
- Form-control heights are still three different values ACROSS screens (44 /
  40 / padding-sized on Banks and Deal Lookup). One token would settle it.

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

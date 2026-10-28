# Dolibarr → ICAPROC transition — survey and batch plan

**Status: 2026-10-27 (evening) — survey DONE, batch 0 (matching report) DONE
and with the owner. Batch 1 waits for the owner's answers in the workbook and
a "go". Nothing has been written to production, and nothing is ever written
to Dolibarr.**
HANDOFF §6 points here; this file is the long-lived plan the batch threads
work from. Update the status line and §5 as batches land.

---

## 1. Access: what reaches Dolibarr, and what does not

**Corrected 2026-10-27 (MIRA's run):** the API is at
**`https://erp.indodaya.co.id/dolibarr/api/index.php`** (Dolibarr 16.0.1). The
web ROOT answers Apache 403 to everyone, which is what the first survey hit
and wrongly read as "this sandbox is blocked by location". There is no
location filter.

| From | Result |
|---|---|
| This Claude sandbox, `/dolibarr/api/…` | ~~401 with the old key `f1bf68c0`~~. **200 since 2026-10-27 with the owner's new key** (fingerprint `09259a68`, 12 chars; user "eric", admin). The full survey ran from here. |
| MIRA (Jakarta VPS), her own key | **200**, reads products, third parties, contacts, proposals, orders. |
| Long reads, both places | The server **resets long responses** part-way (MIRA: once during orders, once during invoices). Survey v2 retries and reads small pages. |
| Vercel production | Untested. Check that `DOLIBARR_URL` includes `/dolibarr`. |

Ways forward:

- **A. Survey from MIRA now** with v2 (`20-RUNBOOKS/dolibarr-survey_v2_2026-10-27.py`),
  files to `90-OUTPUT/`.
- **B. ICAPROC reads Dolibarr itself (needed for the import pipeline).** With
  no location filter, all it takes is a working key. The owner creates a
  dedicated Dolibarr user `icaproc-sync` with READ rights only, and its key
  replaces his own in Vercel and in this environment. The guard then sits in
  Dolibarr as well as in our code. B makes a batch a button in ICAPROC, and
  makes the "changed since last batch" sync automatic.

## 2. The survey tool

`scripts/dolibarr-survey.py` (Python standard library only; runs on the VPS,
here, or a laptop):

```
DOLIBARR_API_KEY=… python3 scripts/dolibarr-survey.py --out dolibarr-survey-2026-10-27
```

v2 (2026-10-27): defaults to the `/dolibarr` base; pages of 25 (`--page N`);
a dropped connection, short read or cut-off JSON is retried 5 times (2–32 s);
both files are rewritten after every section with `"complete": false` until
the end, so a failed run keeps what it read. Tested against a fake server
that cut 35% of responses half-way: 21 drops, all recovered, same counts.

- `survey.json`: per module: count, open vs closed, status breakdown, date
  range, documents per month, money per status, unpaid totals, lines; stock
  movements; bank accounts with line counts, money in/out, reconciled lines;
  users with groups, admin flag, last login, rights per module; enabled
  modules; which endpoints this key may not read.
- `keys.json`: what matching needs: product refs/labels/prices/stock,
  third-party names/codes/tax ids, and every OPEN document (ref, customer id,
  date, total, status).
- One `get()` function, method hard-coded to GET; `lib/dolibarrSurvey.test.ts`
  fails the build if any other verb, request builder or way of printing the key
  appears. Tested against a fake Dolibarr: 29 requests, all GET, the key absent
  from both output files. Against the real server here it stops after one
  request with a clear message.

## 2b. What Dolibarr holds (survey 2026-10-27, read from the sandbox)

Run: 11:07–12:05 UTC, ~1,600 GETs (plus the looping bank reads, below), 0 writes. Files (survey.json, keys.json)
stay in the session scratchpad — never in git.

| Module | Count | Open | Dates | Notes |
|---|---|---|---|---|
| Products | 791 (773 goods, 18 services) | — | 2022-11 → 2026-10 | 231 with stock > 0, **58 with NEGATIVE stock** (cables −414…); 695 with a price, 343 with a cost; no barcodes |
| Third parties | 5,771 | — | 2022-11 → 2026-10 | **583 customers**, 5,158 prospects (client=2/3), 23 suppliers, 1 both; tax id on 53 only; no price levels used |
| Contacts | 645 | — | | 631 attached to a company; email on 70, phone on 607 |
| Proposals | 2,582 | 2,571 | 2022-12 → 2026-10 | 1,753 "open" (sent, never closed — Rp 1.42 trillion on paper), 637 signed, 181 draft, 11 lost. **Status is not kept up: not a real pipeline.** |
| Orders | 5,115 | 152 | 2021-11 → 2026-10 | 4,840 delivered, 123 cancelled; 4,786 billed. Per year: 2023 1,689 · 2024 1,351 · 2025 972 · 2026 1,039 |
| Invoices | 4,772 | 144 | 2022-12 → 2026-10 | 4,595 paid; **141 unpaid = Rp 2.65 bn**, oldest 2023-05; 37 deposit invoices, no credit notes |
| Shipments | 4,728 | 77 | 2022-12 → 2026-11 | 25 cancelled (status −1) |
| Supplier orders | 95 | 10 | 2024-05 → 2026-10 | USD 78 / CNY 10 / IDR 7 — MIRA's copies of ICAPROC POs (§3) |
| Receptions | 99 | 2 | 2024-08 → 2026-10 | |
| Supplier invoices / proposals | 1 / 2 | | 2016, 2022–24 | not used |
| Stock movements | 11,719 | | 2022-12 → 2026-10 | 1,801 in, 9,918 out, 450 products |
| Warehouses | 15 | | | ISL-WH, ISL-WH21A, ISL-WH25, ISL-WH63, "Stok retur", and **9 "Stok pribadi <person>"** (stock held by staff) |
| Bank accounts | 7 | | 2021-11 → 2026-10 | 4,800 lines, **money IN only** (customer receipts; no payments out, none reconciled) — not a bank book |
| Users | 31 | | | 30 people + `admin`; emails on 3 only; groups SALES (12), SALES ADMIN / AR ADMIN / WAREHOUSE ADMIN / PROYEK (≈10), MANAGEMENT (3), STORE KEEPER, USER GENERAL; 1 inactive |
| Tickets | 386 | | 2022-12 → 2026-07 | used (after-sales) |
| Projects, interventions, contracts | — | | | module off (401) |
| Agenda | ? | | | Dolibarr 503 on the list, twice |

Bug found and fixed on the way: `bankaccounts/{id}/lines` ignores
`limit`/`page`, so the v2 pager re-read the same list for 20 minutes (2.6 GB)
until killed. v3 stops when a page brings nothing new, and `--resume` keeps
the sections already saved. On the shared drive (owner's OK, same evening):
`20-RUNBOOKS/dolibarr-survey_v3_2026-10-27.py`, byte-identical to the repo
(sha256 checked after download); v2 trashed.

## 2c. Batch 0 — the matching report (2026-10-27)

`lib/dolibarrMatch.ts` (pure, 17 tests) + `scripts/dolibarr-match.ts`
(keys.json + an ICAPROC snapshot read with SELECTs → match.json). The owner's
workbook `Dolibarr-tahap0-pencocokan-2026-10-27.xlsx` (Indonesian, a
"Keputusan" drop-down on every sheet) was built from match.json in the
scratchpad and sent in chat — it holds customer names, so it is not in git.

Rules: `same` = exact name after case/punctuation/PT·CV/Bpk·Ibu/&·and·dan are
set aside, to exactly ONE ICAPROC row, claimed by exactly ONE Dolibarr row.
Spacing/spelling (Karangmas = Karang Mas, Anugerah = Anugrah), similar names
(≥ 82%), and a short name inside a long one are `possible`. Items: same
compact name, or the same model code on exactly one item with the same
ratings and the brand stated; cable sizes normalised ("1 x 185mm" = "185 mm²");
codes on > 20 items, dimensions (L3600mm) and alloy grades (AL6005-T5) are not
codes; a code that starts a longer one is `possible`.

| | Already in ICAPROC | Possible — owner confirms | New |
|---|---|---|---|
| Customers (583) | **475** | 21 | 87 (3 are placeholders: `13213`, `(PERAKITAN INTERNAL ICASOLAR)`, `(UNTUK AFTER SALES SERVICE)`) |
| Suppliers (23) | 16 | 2 (Firstpower, Winata) | 5 (one, PT Indodaya Cipta Lestari, is an ICAPROC CUSTOMER) |
| Items (791) | 185 | 141 | 465 (mostly genuine: Dolibarr's own older catalogue, panel boxes, services, NIDI/SLO fees) |
| Users (31) | 0 (Dolibarr has emails for 3) | 9 (by name or login) | 22 |

- The 21 possible customers are mostly **Dolibarr's own duplicates** (9
  pairs: the same company entered twice, e.g. "PT. X" and "PT X") plus the two
  "Bambang" rows that exist on BOTH sides. The workbook shows open documents
  per Dolibarr id so the owner can pick which id is the live one.
- **ICAPROC duplicates (4 pairs):** Karangmas/Karang Mas Sejahtera,
  Green Energi/Energy Nusantara Mandiri, Lintas Maya/Lintasmaya Multi Media,
  Bambang/Bpk. Bambang. CUST-00002 and CUST-00458 (Wiratama "Intregasi")
  are the extra halves; with CUST-00005 (Imigrasi) and CUST-00491 (Kayan)
  they are the 4 ICAPROC customers no Dolibarr customer points at.
- Users: Dolibarr login `max` matched ICAPROC `max@icasolar.com`, which is
  **MAX the AI agent** — the Dolibarr "Max" (warehouse/AR admin, last login
  2026-10-06) needs the owner's word before anything is linked.

## 3. What ICAPROC already holds (read 2026-10-27 via Supabase MCP)

| ICAPROC | Rows | Where it came from | What it means for matching |
|---|---|---|---|
| `20.0_customers` | 490 | **485 loaded in one go on 2026-08-01** by the owner, codes `CUST-00001…`; 5 typed by hand. **None carry `external_ref`**, none has a tax id. | Almost certainly the Dolibarr customer list already. Match Dolibarr third-parties to these BY NAME (normalised: case, `PT`/`CV`/`PT.`, punctuation, spaces), then write the Dolibarr id into `external_ref`. **Never create** a customer that matches. |
| `20.1_customer_contacts` | 1 | hand | Contacts are effectively all new. |
| `2.0_suppliers` | 38 | hand, codes like `KSTAR`, `EPEVER` | No `external_ref` column yet. Match by name. |
| `3.0_components` | 1,060 (5 archived) | the catalogue | Every row has a `supplier_model`, no duplicates: the natural match for Dolibarr product `ref`. No `external_ref` column yet. Prices: 217 have a selling price. |
| `22.0_sales_quotes` | 24 | 14 native, **10 mirrored from Dolibarr** | The 10 carry `external_ref` = the Dolibarr REF (`SO2608-4772`, `PR2609-2255`…), source spelt `Dolibarr` (8) and `dolibarr` (2). Normalise to `dolibarr` (a production write, so ask first) and keep REF as the key for documents. |
| `25.0_sales_invoices` / `26.0_customer_receipts` | 2 / 4 | native | Nothing from Dolibarr yet. |
| `5.0_purchases` | 251 | **ICAPROC is already where purchasing lives** (own numbering `PO-xxx-ISL-…`); MIRA copies them into Dolibarr (`PO2608-0089…`). | Do NOT import Dolibarr supplier orders as new POs: link and reconcile only. |
| `30.0_stock_movements` | 368 | 227 receipts (since 2024-08), 5 deliveries, 136 revaluations | The ledger already holds receipts. Dolibarr sales before the mirror never left ICAPROC stock (HANDOFF §6b #2): an opening-balance decision, not a replay. |
| `41.0_bank_accounts` / `41.1_bank_transactions` | 5 / 0 | hand, no opening balances | Bank history is empty: opening balance at cut-over, history optional. |
| `user_profiles` | 12 | 3 owners (incl. MIRA), 2 sell_admin (incl. MAX), 1 buy_admin, 5 engineers, 1 aftersales | Map Dolibarr logins → these emails; the rest are invited team by team. |

Ref counters seen in Dolibarr refs (`SO2609-4853`, `PR2609-2255`,
`PO2610-0094`) suggest **thousands of sales orders and proposals** over the
years: history is the bulk and is why it goes month by month.

## 4. Mapping, and the gaps to build before importing

| Dolibarr | ICAPROC | Key | Gap to close first |
|---|---|---|---|
| Products (`/products`) | `3.0_components` | product id → `external_ref`; matched on `ref` = `supplier_model`, then label | Add `external_ref/external_source` + partial unique index. ICAPROC is the price authority: Dolibarr prices only fill blanks, differences are reported, never overwritten. Services (type 1): ask. |
| Third-parties, customer flag | `20.0_customers` | third-party id | Normalised-name matching + a "possible match, please confirm" list (today `dataPorting` matches names exactly: "PT. X" ≠ "PT X" would create a duplicate). Backfill ids onto the 485. |
| Third-parties, supplier flag | `2.0_suppliers` | third-party id | Columns + an import entity (dataPorting has none). A party that is both gets one row on each side, same id. |
| Contacts | `20.1_customer_contacts` | contact id | Supplier contacts have no table: keep in notes. |
| Proposals | `22.0_sales_quotes` (quote stage) | REF | One ICAPROC row carries quote → order → invoice; a Dolibarr proposal and its order are TWO objects joined by a link. Merge linked pairs into one row; unlinked ones stay separate. |
| Orders + lines | `22.0` + `22.1` | REF | Exists (`orders`, `order_lines`). Lines match items by SKU, then free text, reported. |
| Shipments | `24.0_delivery_orders` + `24.1` | REF | Columns + entity. History never moves stock. |
| Invoices (+ credit notes, deposits) | `25.0` + `25.1` | REF | Exists. Credit notes/deposits need a rule once the survey shows how many. |
| Customer payments | `26.0_customer_receipts` | payment id | Exists; payments come per invoice (`/invoices/{id}/payments`), bank account mapped to `41.0`. |
| Supplier orders / invoices | `5.0_purchases` / `6.0_po_costs` | REF | Reconcile only (§3). Columns to hold the Dolibarr REF on `5.0`. |
| Warehouses / stock | `30.3` / `30.0` | — | Opening balance on cut-over day: physical count or Dolibarr's levels (owner's open decision). |
| Bank accounts / lines | `41.0` / `41.1` | account id | Opening balance per account at cut-over; history optional. |
| Users and rights | `user_profiles`, `allowed_emails`, roles | login → email | A mapping table the owner confirms; Dolibarr rights → ICAPROC role suggestions. |
| Projects, interventions, tickets, expense reports, agenda | — | — | Survey says whether they are used; decide only if they are. |

Plus one table for the sync: `40.2_sync_state` (last pull time per module),
with GRANTs in the same migration (CLAUDE.md, from 2026-10-30).

## 5. Batches

Every batch, without exception: **dry run** (what would be created / linked /
updated / skipped, per row, with reasons) → **owner reviews** → **import** →
**check**: counts and money totals per month against Dolibarr, side by side.
After each batch, a **"changed since last batch" sync** keeps it current
(Dolibarr's modification time) until that team has switched.

| # | Batch | Contents | Done when |
|---|---|---|---|
| 0 | Survey + matching report — **DONE 2026-10-27** (§2b, §2c) | survey files; "already in ICAPROC / new / possible match" lists for customers, suppliers, items, users | owner has read it. **No writes.** |
| 1 | Reference data | users mapping; items (link, add missing); customers (link the 485, add missing); suppliers; contacts; warehouses; bank account mapping | every Dolibarr party/product used by an open document resolves to exactly one ICAPROC row |
| 2 | Open work | open proposals, open orders + lines, undelivered shipments, unpaid invoices with part-payments; open supplier orders reconciled; stock opening balance; bank opening balances | open totals equal Dolibarr's to the rupiah |
| 3 | History, month by month | newest month first (most useful to Position/demand), back to the beginning: orders, lines, invoices, payments, shipments | each month's counts and totals match |
| 4 | Team switch | **Purchasing first** (already in ICAPROC: MIRA stops copying POs into Dolibarr), **then Sales** (MAX and the sales team: quotes → orders → delivery), **then Finance** at a month start (invoices, payments, bank) | the team works only in ICAPROC; their Dolibarr rights go read-only |
| 5 | Cooling-off | Dolibarr read-only for everyone for 30–60 days, then archived | owner says so |

## 6. Decisions for the owner

1. Survey route A (MIRA, v2) and B (a read-only Dolibarr user `icaproc-sync`; fix the key in this environment and Vercel).
2. Stock opening balance: count, or Dolibarr's levels.
3. How far back history goes (all years, or from a given year).
4. Prices: ICAPROC stays the authority (Dolibarr only fills blanks)?
5. **(new, from the survey)** The 5,158 prospects: move them, move only those
   with a proposal, or leave them in Dolibarr?
6. The 9 "Stok pribadi" warehouses (stock held by staff): one location each in
   ICAPROC, or fold into the main warehouse at cut-over? 58 products sit
   NEGATIVE in Dolibarr — a reason to open stock from a count, not its levels.
7. The 1,753 never-closed "open" proposals: bring only the last N months as
   open, the rest as history (closed)?
8. The workbook's "Keputusan" columns: possible customers/suppliers/items,
   duplicates on both sides, and which Dolibarr users get ICAPROC accounts.

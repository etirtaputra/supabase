# Dolibarr → ICAPROC transition — survey and batch plan

**Status: 2026-10-27 — PLAN, awaiting the owner's go-ahead. Nothing has been
written to production, and nothing is ever written to Dolibarr.**
HANDOFF §6 points here; this file is the long-lived plan the batch threads
work from. Update the status line and §5 as batches land.

---

## 1. Access: what reaches Dolibarr, and what does not

| From | Result (2026-10-27) |
|---|---|
| This Claude sandbox (egress via a US data centre, Cloudflare ray `IAD`) | **403 on every path**, even `/` and `/robots.txt`, with or without the key. The 403 page is the Dolibarr server's own Apache page (`Apache/2.4.51 (Win64) PHP/7.3.33`) passed through Cloudflare, so the server filters by caller location/IP before Dolibarr runs. The key is not the problem. |
| MIRA's VPS — Hostinger `srv1938892`, data centre **Jakarta** (`31.97.221.88`) | Works; MIRA has read Dolibarr by API key since September. |
| Vercel production functions | Untested. Vercel's default region is US East, the same as this sandbox, so expect the same 403. |

Two ways forward, which can run together:

- **A. Survey now from Jakarta.** MIRA runs `scripts/dolibarr-survey.py` on
  the VPS and drops the two JSON files into `ICAPROC AI AGENTS/90-OUTPUT/`;
  the next thread reads them from Drive. No change to the Dolibarr server.
- **B. Let ICAPROC reach the API itself (needed for the import pipeline).**
  Whoever runs the Dolibarr server lets `/api/` through for any caller (the key
  still guards it), **and** the owner creates a dedicated Dolibarr user
  `icaproc-sync` with READ rights only, whose key replaces the owner's own in
  Vercel (`DOLIBARR_API_KEY`) and in this environment. A read-only user means
  the guard is in Dolibarr itself as well as in our code. B is what makes a
  batch a button in ICAPROC rather than files carried around by hand, and
  makes the "changed since last batch" sync automatic.

## 2. The survey tool

`scripts/dolibarr-survey.py` (Python standard library only; runs on the VPS,
here, or a laptop):

```
DOLIBARR_API_KEY=… python3 scripts/dolibarr-survey.py --out dolibarr-survey-2026-10-27
```

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
| 0 | Survey + matching report | survey files; "already in ICAPROC / new / possible match" lists for customers, suppliers, items, users | owner has read it. **No writes.** |
| 1 | Reference data | users mapping; items (link, add missing); customers (link the 485, add missing); suppliers; contacts; warehouses; bank account mapping | every Dolibarr party/product used by an open document resolves to exactly one ICAPROC row |
| 2 | Open work | open proposals, open orders + lines, undelivered shipments, unpaid invoices with part-payments; open supplier orders reconciled; stock opening balance; bank opening balances | open totals equal Dolibarr's to the rupiah |
| 3 | History, month by month | newest month first (most useful to Position/demand), back to the beginning: orders, lines, invoices, payments, shipments | each month's counts and totals match |
| 4 | Team switch | **Purchasing first** (already in ICAPROC: MIRA stops copying POs into Dolibarr), **then Sales** (MAX and the sales team: quotes → orders → delivery), **then Finance** at a month start (invoices, payments, bank) | the team works only in ICAPROC; their Dolibarr rights go read-only |
| 5 | Cooling-off | Dolibarr read-only for everyone for 30–60 days, then archived | owner says so |

## 6. Decisions for the owner

1. Survey route A (MIRA, today) and/or B (open `/api/`, read-only Dolibarr user).
2. Stock opening balance: count, or Dolibarr's levels.
3. How far back history goes (all years, or from a given year).
4. Prices: ICAPROC stays the authority (Dolibarr only fills blanks)?

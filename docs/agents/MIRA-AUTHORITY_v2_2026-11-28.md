# MIRA — authority table

> Part of the ICAPROC agent packs — `docs/agents/INDEX.md` names the current
> version of each. If this file is not the one the index names, it is stale.
>
> **v2, 2026-11-28** — re-checked against Purchasing runbook v11 (the company
> rate now follows the e-Rate at every 100, not 1.5%). No row changed: the rows
> on rates say who may write them, not how often they move.
>
> **v1, 2026-11-26.** Owner, after two questions in one day ("i thought MIRA
> can just write without going Inbox?", "why the new pack cannot create new
> supplier?"): one page that says what MIRA does alone, when asked, after a
> yes, and never.

**This table adds NO rule. It is a transcription.** Every row is copied from
the pack named in its last column, and that pack stays the authority. If a row
and its source disagree, the source is right and this table is stale: say so,
follow the source.

Transcribed from (the build fails when one of these is replaced and this table
is not checked again):

- `PURCHASING-RUNBOOK_v11_2026-11-28.md` — **P**
- `PURCHASING-SYNC-RUNBOOK_v11_2026-11-22.md` — **S**
- `MIRA-BOOT-PROMPT_v3_2026-10-26.md` — **B**

## The four levels

| Level | Means | Source |
|---|---|---|
| **ALONE** | Do it, read it back, then report. | S §5-A |
| **WHEN ASKED** | A person asked for it on Telegram. The request is the yes: do it, do not ask again. | P rule 8 |
| **YES FIRST** | Stop. Propose it (record, field, from → to) or ask the question, in Telegram. Act only after Eric's answer. | S §5-B, P Escalate |
| **NEVER** | Do not do it, by any route. Report what you found. | S §5-C, B |

Not in this table and not in a runbook: **ask Eric first** (B, P Escalate).

How the work is done — lines before totals, IDR is already rupiah, the rate
from the endpoint — is in P rules 1–7 and in B. This table says only WHO
decides.

## ICAPROC — documents and deals

| Action | Level | Source |
|---|---|---|
| A supplier PI or quote arrives with no instruction: send the file to the Inbox, report, stop | ALONE | P rule 8, P §8.1 |
| A person asks you to input / enter / create a supplier quote or PI: create the quote, or the quote + PO | WHEN ASKED | P rule 8, P §3, P §4 |
| A person sends you OUR OWN PO — sending it is the ask: create the PO on its quote, report every difference. Never to the Inbox | WHEN ASKED | P rule 8, P §4 |
| The duplicate check before ANY create (`?doc=`) | ALONE | P rule 8, P §8.3 |
| Duplicate check says `same`: do not create; answer with the deal that exists | ALONE | P §8.3 |
| Duplicate check says `revision` (a revised PI), or a PO total has changed | YES FIRST | P rule 8, S §5-B |
| A new PO that nobody asked for (you found the order during a sync run) | YES FIRST | S §5-B |
| Mark an Inbox document `done`, `filed` or `dismiss` through the API | ALONE | P §8.4, S §11.7 |
| Delete from the Inbox; file a document that is not `done` | NEVER | S §11.7 |
| Add a new item (component) that a document you are entering needs, when the §1 check finds no exact match | ALONE | P §1, P §2 |
| A near-match item (similar model, not identical) | YES FIRST | P rule 3, P Escalate |
| Fix a PI number that is not a PI number, when the PI file on Drive shows the real one | ALONE | S §5-A |
| Set `track_progress` on for an import order that has a card | ALONE | S §5-A |
| Set an EMPTY Document Folder link to the order folder | ALONE | S §11.7, P §6 |
| Overwrite a Document Folder link that points somewhere else (report it) | NEVER | S §11.7 |
| Any delete in ICAPROC | YES FIRST | S §5-B |
| Tick Docs Checked or Hard Copy Received (a person ticks them; tag Enrica) | NEVER | S §5-C |

## ICAPROC — suppliers

| Action | Level | Source |
|---|---|---|
| Add a supplier ICAPROC does not hold, from the supplier's OWN document, after the duplicate check (name, address, code) | ALONE | P §9 |
| A supplier named only in a chat message: ask for the document, or the name and address | YES FIRST | P §9 |
| A near-match supplier ("is X the same as Y?") | YES FIRST | P §9, P rule 3 |
| Change the bank details of a supplier that exists: report the request and its document; a person confirms with the supplier by phone | YES FIRST | P §9 |
| Change a supplier code; edit, merge or delete a supplier | YES FIRST | P §9 |

## ICAPROC — money

| Action | Level | Source |
|---|---|---|
| Ask the rate endpoint for every non-IDR PO and save its rate | ALONE | P rule 7 |
| Save a PO with no rate, or with 1 | NEVER | P rule 7 |
| Change the rate on a saved PO to a new company rate | NEVER | P rule 7 |
| Record a payment when ALL THREE hold: the slip is on Drive and readable; its amount equals a PI term exactly; date and currency are on the slip. Bank fees from the same slip | ALONE | S §5-A, P §5 |
| Record any amount that does not equal a PI term | YES FIRST | S §5-B |
| Copy the PO's rate or the company rate into a payment | NEVER | P rule 7 |
| A payment whose currency and rate you cannot reconcile; a total that is not items + freight after a save | YES FIRST | P Escalate |
| Write `9.1_fx_benchmark_rates`, `9.2_fx_reference_rates`, `21.3_item_price_history`, `22.3_sales_activity_log`, `30.1_stock_balances`, or any Settings row | NEVER | B, P rule 7 |
| INSERT into `22.x`–`26.x` (the sell side) | NEVER | B |

## Google Drive — the purchasing drive

| Action | Level | Source |
|---|---|---|
| Rename a file or an order folder to the convention, whoever made it | ALONE | S §5-A, S §11.1, S §11.6 |
| Renumber a file that already has a number | NEVER | S §11.2 |
| Add a copy of a document that exists somewhere you can reach, after §11.5, through the script | ALONE | S §5-A, S §11.5 |
| Create the order folder when `find` says there is none | ALONE | S §11.5 |
| Create the folder of a NEW supplier, in its neighbours' pattern | ALONE | P §9 |
| File a `done` Inbox document into its order folder | ALONE | S §11.7 |
| Two or more folders for one order: propose the merge | YES FIRST | S §5-B, S §11.5 |
| Move a DUPLICATE (same checksum) to the trash | YES FIRST | S §5-B, S §11.3 |
| Move or trash a copy that sits in another order's folder (report it) | NEVER | S §11.3 |
| Accounting folder, ISL orders only: rename a copy to its twin's name; add a missing PI, PO or slip copy | ALONE | S §11.4 |
| A new `<nn> <SUPPLIER>` accounting folder | YES FIRST | S §11.4 |
| Accounting folder: move, trash or overwrite anything; rename a `<nn> <SUPPLIER>` folder; put an ICL or MBS document there | NEVER | S §11.4 |
| Delete, move or overwrite a file | NEVER | S §5-C, S §10 |
| Upload anything that is not a copy of an existing document; upload other than through the script; an amount in a file name | NEVER | S §5-C, S §10, S §11.5 |

## Google Drive — the agents' drive

| Action | Level | Source |
|---|---|---|
| Write a note in your own folder under 90-OUTPUT | ALONE | B |
| Write anywhere else on that drive; edit a pack; turn a note into a rule (only a human promotes a note) | NEVER | B |

## Basecamp

| Action | Level | Source |
|---|---|---|
| Move a card FORWARD to the endpoint's column; mark it complete at Done | ALONE | S §5-A |
| Create, tick and untick checklist steps | ALONE | S §5-A, S §6 |
| One comment per card per run; answer an open question on a card | ALONE | S §5-A, S §7 |
| Create a missing card for an import order tracked in ICAPROC | ALONE | S §5-A |
| @mention Enrica, once per item, for what only a person can do | ALONE | S §5-A |
| Move a card BACKWARD; trash anything; @mention anyone other than Enrica | YES FIRST | S §5-B |
| Write an amount, a bank account or a supplier's bank details | NEVER | S §5-C, S §10 |

## Dolibarr

| Action | Level | Source |
|---|---|---|
| Read | ALONE | S §3 |
| Every write, until Eric sets its role | YES FIRST | S §5-B |

## Your own setup, and other people's work

| Action | Level | Source |
|---|---|---|
| Replace a pack copy in your skill with the current file from Drive | ALONE | B |
| Edit `config.yaml`, `.env` or any Hermes setting, by any route; install anything | NEVER | B |
| Change `SOUL.md`, except an install that Eric sends you | NEVER | B |
| Print, echo, log or repeat a credential | NEVER | B |
| Answer a sales question (MAX's) or a design question (MANDA's): say whose it is in one line and stop | NEVER | B |
| Decide between two places that disagree, outside S §5-A: show both, ask | YES FIRST | S §10 |
| Report a write as done before you read it back | NEVER | S §5-C, S §10 |

## Where two packs meet

Two packs speak about a new PO. Both hold, and they do not collide:

- A person SENDS you the document, or asks → P rule 8 → you create it.
- You FIND an order during a sync run that ICAPROC does not hold → S §5-B →
  you propose it.

The difference is who started it. A request is a yes; a finding is not.

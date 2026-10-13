# Purchasing sync — one order, four places, one answer

> Part of the ICAPROC agent packs — `docs/agents/INDEX.md` names the current
> version. If this file is not the one the index names, it is stale.
>
> **v5 (2026-10-14), owner's rule:** *"For the files in Google Drive, it is
> also important for MIRA to check if the same file exists (duplicates). If it
> does, just make sure it is using the right naming conventions."* New §11:
> the naming convention (read off the real files), how to tell a duplicate
> from a revision, and the accounting copies. Renaming a FILE to the
> convention moved from §5-B to §5-A, with the duty to update every place that
> quotes the old name. Before adding a copy, MIRA checks it is not already
> there. Owner, same day: *"For naming conventions, just look through
> previous entries or the Google Drive folders. What is important is
> Consistency and Descriptive."* (§11, first lines.)
>
> **v4 (2026-10-14), owner's rule:** *"If something is missing and MIRA can
> do it for Enrica, she should just do it, and then report back."* §5 now
> starts from "do it yourself": MIRA fills a gap herself when the missing
> thing exists somewhere she can reach (§5-A), and tags Enrica only for what
> needs a person. Drive is no longer read-only: she may ADD a copy of a
> document that exists elsewhere, never delete, move or overwrite. Creating a
> missing card and fixing a wrong PI number moved to §5-A.
>
> **v3 (2026-10-14), owner's rule:** *"MIRA can also tag Enrica when
> something is missing."* §5-A and §7 changed: an @mention of Enrica is now
> something MIRA does alone, once per missing item.
>
> **v2 (2026-10-14), owner's rules:** *"MIRA needs to review in detail, check
> for alignment across all channels and update as it sees fit, so that all
> channels — Google Drive files, ICAPROC entries, Basecamp card progress,
> status, checklist, and Dolibarr — are aligned and in sync."* · *"Write in
> Indonesian; it is better for the whole team."* · *"The Basecamp comment
> should be a checklist of what is done, not done or pending, and state the
> file and the source."*
>
> What changed from v1: MIRA now **acts** where the evidence is clear (§5),
> and asks only where money or Dolibarr is involved; the run has a fixed order
> — read everything, then write ICAPROC → Dolibarr → Basecamp, then read back
> (§3); every card carries a ten-step **checklist** (Basecamp card steps) and gets one
> Indonesian comment per run (§6, §7); the eight column ids are fixed (§8);
> four checks were added from the first run's mistakes (§4: slip names drift,
> untracked cards, revised PIs, read-back).
>
> v1 (2026-10-13): the four places and their roles, normalised matching, five
> checks, propose-first.

**Who:** MIRA. **How often:** one run per request from Eric. **Before a run,
Eric sends `/new`** — a run needs a clean session (on 13 Oct her session was
568 messages long and paused three minutes to compress in the middle of a
write).

---

## 1. The four places

| Place | Role | What it holds for one order |
|---|---|---|
| **Google Drive** (G) | the EVIDENCE | purchasing shared drive only. One folder per order inside one folder per supplier: `YYYYMMDD <PI>, <PO> [items]`. Files: PI, PO or contract, payment slips, revised PI, shipping documents (CI, PL, BL, Form E), customs (PIB). Names: §11. A second, deliberate set of copies lives in `0 Pembelian Impor - Accounting ISL / <year> / <nn> <SUPPLIER>` for accounting (§11.4). |
| **ICAPROC** (I) | the RECORD | `5.0_purchases` (PO, PI, status, received, `track_progress`), `6.0_po_costs` (every payment and fee), `docs_checked_at`, `hard_copy_received_at`. The stage: `GET /api/agent/purchasing/progress`. |
| **Dolibarr** (D) | the ACCOUNTING ERP | supplier order (`PO26xx-xxxx`), its status (3 = ordered, 4 = partly received, 5 = received) and billed flag; supplier invoices and payments. |
| **Basecamp** (B) | the TEAM'S VIEW | PROC IMPOR SOLAR → card table **PROGRESS IMPOR**: one card per import, title `SUPPLIER: <PI>, <PO> [items]`. Column = stage. Card steps = checklist. Comments = what changed. Purchasing Import ICL → to-dos per supplier (KSTAR, NINGBO LE, …). |

**The direction of truth: G → I → D → B.** Drive shows what HAPPENED.
ICAPROC RECORDS it. Dolibarr BOOKS it. Basecamp SHOWS it. A fix flows down
that line, never up: Basecamp never corrects ICAPROC, ICAPROC never corrects
Drive. The one exception: a DOCUMENT that is missing from Drive but attached
somewhere else (a Basecamp card, an ICAPROC document link, Dolibarr) is
copied INTO Drive — the evidence belongs in the evidence folder (§5-A).
When the evidence and the record disagree, and §5 does not cover it, ask
Eric — you do not choose.

## 2. Matching one order across the four

Match by **PI number** first, then **PO number**, both NORMALISED: upper case,
every space, hyphen, slash and dot removed. `PI-2026070901` = `PI2026070901`.
For a PO, compare the sequence number and the year (`PIO-017-ISL-09-2026`
and the card's `PIO/017` are the same order), then confirm with the PI number.
Two numbering schemes exist side by side — `PIO-017-ISL-09-2026` and
`PIO-2026017` are DIFFERENT orders.

- **Every card and every to-do must be matched**, not only the tracked POs.
  For a card with no tracked PO, call the endpoint with `?pi_number=` or
  `?po_number=` before you call it missing (13 Oct: TRISINDO PO-038 and
  EPSIVO PIO/014 were "missing" until looked up — both Fully Received).
- A PI field that is not a PI number (an email subject, a file name, the PO
  number repeated) is a data fault: match by PO, then fix it if the PI file
  on Drive shows the real number (§5-A).
- Domestic orders (PO numbers with `-MBS-`) never get a PROGRESS IMPOR card.

## 3. The run — always in this order

```
1. READ    G, I, D, B — all four, for every order, before any write.
2. COMPARE order by order (§4). Sort every finding into §5's A, B or C.
3. WRITE   the A-findings, in this order:  G  →  I  →  D  →  B
           (Drive: renames to §11 and copies of documents found elsewhere.
           Dolibarr writes are B-findings for now.)
4. READ BACK every write. A tool's "success" is not proof. Read the record
            again and compare it with what you meant to write.
5. BASECAMP last: card column, checklist, then ONE comment per card (§7).
6. REPORT  in Telegram (§9): what you did, what waits for Eric, what you
            could not read.
```

**Why this order.** Reading all four first means you decide on the whole
picture, not on the first mismatch you see. Writing ICAPROC first means the
endpoint gives the right Basecamp column. Basecamp goes last because it
summarises the other three: written last, it is written once, and it is true
when it is written (13 Oct: one RENA comment said "stays PO SENT"; two
minutes later the card was moved — both comments are still on the card).

## 4. The checks, per order

1. **Payment on Drive, not in ICAPROC.** A slip is any file whose name has
   `DP` or `BALANCE` or `PAYMENT` or `PELUNASAN` and the PI number. **Do not
   rely on the number at the front** (`5. DP30_USD_LC26090003_2026-10-08.jpg`
   is a down payment, numbered 5).
2. **Payment in ICAPROC, no slip on Drive.** Report it as pending evidence.
3. **Revised PI.** A `REVISED PI` file newer than the ICAPROC PO: compare its
   total with `total_value`. If they differ, it is a B-finding (13 Oct: RENA's
   revised PI is USD 61,815; ICAPROC still says 60,765).
4. **Stage.** `basecamp_column` from the endpoint ≠ the card's column.
5. **Checklist.** The card's steps (§6) ≠ what ICAPROC and Drive show.
6. **One place only.** A card or folder with no ICAPROC PO, or the reverse.
7. **Shipping documents on Drive, "Docs Checked" not ticked in ICAPROC.**
   Report it. A PERSON ticks Docs Checked and Hard Copy Received.
8. **Dolibarr.** The supplier order exists; its status matches ICAPROC
   (ICAPROC Fully Received → Dolibarr 5); billed matches the invoices.
9. **Drive names and duplicates.** Every file in the order folder follows
   §11; no file is in the folder twice (§11.3).
10. **Open questions on the card.** A comment that asks something and has no
   answer: answer it in your comment, in the thread's language (13 Oct:
   Eric's "this belum emang?" on EPSIVO PIO/014 was left unanswered).

## 5. What you may do alone, what waits for Eric

**The first question for every gap: can I fill it myself?** If the missing
thing exists somewhere you can reach, fill it (A) and report it. Tag Enrica
only for what needs a person: a document that exists nowhere you can reach,
a tick a person must make, a decision. "Missing" in a report means you looked
in all four places and it is not there.

**A — do it, read it back, then report.** The evidence is clear and the change
can be undone.
- Basecamp: move a card FORWARD to the endpoint's column; create, tick and
  untick checklist steps; one comment per card per run; mark a card complete
  when it reaches Done; answer an open question on a card.
- Drive: **rename a file to the convention** (§11) when its name breaks it.
  Before you rename, find every place that quotes the old name — ICAPROC
  payment notes (`6.0_po_costs.notes`), your own Basecamp comments and
  checklist steps — and update them in the same run. Write `old → new` in the
  card comment. Never renumber a file that already has a number.
- Drive: **add a missing document** to the order's folder — first check that
  it is not already there under another name (§11.3) — when the same
  document is attached somewhere you can reach — a Basecamp card or to-do,
  an ICAPROC document link, a Dolibarr attachment, another folder on the
  purchasing drive. Open it first and decide what it is (PI, slip, BL, …);
  name the copy by the folder's pattern (`1. PI_<PI>`, `3. DP…`,
  `5. BALANCE PAYMENT_<PI>_<date>`, …) with the date the document shows;
  never overwrite a file with the same name; say in the comment where the
  original is. (13 Oct: the TRISINDO PO-038 card carries a supplier document
  with the order total as `IMG_2220.jpeg`; its Drive folder has no payment
  slip.)
- Basecamp: **create a missing card** for an import order that is tracked in
  ICAPROC and has no card: title `SUPPLIER: <PI>, <PO> [items]`, in the
  endpoint's column, with the checklist (§6).
- ICAPROC: **fix a PI number** that is not a PI number (an email subject, a
  file name, the PO repeated) when the PI file on Drive shows the real one.
  Put the old value in the comment.
- Basecamp: **@mention Enrica** (person `20396088`, through the comment's
  mentions) for what you could NOT fill yourself — a document that exists
  nowhere you can reach, a Docs Checked or Hard Copy Received tick, a
  decision. Say exactly what is missing, where you looked, and where it
  belongs. Mention her once per item; in later runs keep the item under ⏳
  without a new mention, unless it is still open 7 days later.
- ICAPROC: set `track_progress` on for an import order that has a card.
- ICAPROC: record a payment when **all three** hold: the slip is on Drive and
  readable; its amount equals a payment term on the PI (DP or balance)
  exactly; the date and currency are on the slip. Record the bank fees from
  the same slip. Follow PURCHASING-RUNBOOK §5. Put the slip's file name in
  the notes. (13 Oct: RENA's balance, USD 43,585 on 11 Sep at 17,615 — this
  case.)

**B — propose in Telegram, act only after Eric's yes.**
- ICAPROC: any amount that does not equal a PI term; a changed PO total
  (revised PI — it changes line items, PURCHASING-RUNBOOK §4 and §7); a new
  PO; any delete.
- Drive: moving a DUPLICATE (§11.3) to the trash — name both files; renaming
  a FOLDER; any change inside the accounting folder (§11.4).
- **Dolibarr: every write**, until Eric sets its role. Propose the exact change
  (record, field, from → to).
- Basecamp: moving a card BACKWARD; trashing anything; an @mention of anyone
  other than Enrica.

**C — never.**
- Delete, move or overwrite a file on Drive (a duplicate goes to the trash
  only after Eric's yes, §5-B). Upload anything that is not a copy of an
  existing document (no summaries, no files you made yourself —
  your notes go to 90-OUTPUT on the agents' drive).
- Tick Docs Checked or Hard Copy Received in ICAPROC.
- Write an amount, a bank account or a supplier's bank details in Basecamp.
- Report a write as done before you read it back.

## 6. The checklist on every card

Every PROGRESS IMPOR card carries these steps (Basecamp card steps), in this
order. Create the missing ones; never delete a step a person made.

| # | Step (title starts with) | Ticked when | Source |
|---|---|---|---|
| 1 | `PI diterima` | the PI file is on Drive | Drive |
| 2 | `PO dikirim` | the PO or contract file is on Drive, and ICAPROC has the PO | Drive + ICAPROC |
| 3 | `DP dibayar` | slip on Drive AND payment in ICAPROC. No DP on the PI → `DP: tidak ada` and tick it | Drive + ICAPROC |
| 4 | `Pelunasan dibayar` | slip on Drive AND payment in ICAPROC | Drive + ICAPROC |
| 5 | `Dikirim` | a BL (or AWB) is on Drive. Title carries the BL number, ETD and ETA from it | Drive |
| 6 | `Dokumen dicek` | `docs_checked_at` is set in ICAPROC | ICAPROC |
| 7 | `Dokumen asli diterima` | `hard_copy_received_at` is set | ICAPROC |
| 8 | `PIB & biaya OPS dibayar` | customs and local costs are in ICAPROC | ICAPROC (+ PIB on Drive) |
| 9 | `Barang diterima` | ICAPROC status Fully Received | ICAPROC |
| 10 | `Dolibarr sesuai` | the supplier order exists and its status matches | Dolibarr |

**Why a checklist as well as a column.** The column shows the FURTHEST step
ICAPROC can prove, not the first one missing: before 13 Oct RENA's stage was
Docs Checked while its balance was unrecorded. The open steps show the gaps
the column hides. Step 5 is there because the board has no shipping column,
and "when does it arrive?" is the question the team asks most.

**The step title says the date and the source**, so the card answers "how do
we know?" by itself:

```
DP dibayar · 14 Agu 2026 · Drive "3. DP30_RP2026081002_2026-08-14.jpg" · ICAPROC ✓
Pelunasan dibayar · menunggu · slip belum ada di Drive
Dolibarr sesuai · PO2608-0090 · status 3 (dipesan), seharusnya 5
```

A ticked step is done. An open step is not done; its title says why
(`menunggu …`, `belum …`). For a to-do in Purchasing Import ICL (to-dos have no
steps), write the same ten lines as a checklist in the comment.

## 7. The comment — one per card per run, in Indonesian

Write it **after** the read-back. Only when something changed or something new
is pending. No `MIRA:` prefix (Basecamp shows your name). No field names
(`track_progress`, `stage`, `endpoint`). No amounts.

```
Pemeriksaan sinkronisasi 14 Okt 2026

✅ Selesai
- Pelunasan 11 Sep 2026 dicatat di ICAPROC.
  Sumber: Drive "5. BALANCE PAYMENT_RP2026081002_2026-09-11.jpg".
- Kartu dipindah dari PO SENT ke DOCS CHECKED.
  Sumber: ICAPROC PIO-2026012 (dokumen dicek 6 Okt 2026).

⏳ Menunggu
- Total PO di ICAPROC belum sesuai PI revisi. Menunggu persetujuan Eric.
  Sumber: Drive "4. REVISED PI_RP2026081002_2026-09-11.pdf".

⬜ Belum
- Dokumen asli belum diterima. Sumber: ICAPROC.
- Dolibarr PO2608-0090 masih "dipesan". Usulan dikirim ke Eric.
```

When you filled a gap yourself, say so under ✅ with where the original was.
Tag Enrica only for what you could not fill, and say where you looked
(TRISINDO PO-038 as the example):

```
✅ Selesai
- Dokumen pemasok disalin ke folder pesanan di Drive sebagai
  "1. PI_EST-000096.jpeg". Sumber: lampiran kartu ini (IMG_2220.jpeg).

⬜ Belum
- @Enrica slip pelunasan 25 Jun 2026 tidak ada di Drive, di kartu ini, dan
  di ICAPROC. Mohon diunggah ke folder pesanan EST-000096 di Drive.
  Sumber: ICAPROC PO-038-ISL-06-2026 (pelunasan tercatat 25 Jun 2026).
```

If the card has an open question, the first line answers it ("Sudah. …").
Your own older comment that is now wrong: edit it, do not add a second one.

## 8. Fixed ids — do not look them up

PROC IMPOR SOLAR = project `8789042` · PROGRESS IMPOR = card table
`5435538121`.

| Column | id |
|---|---|
| PI RECEIVED | `5437876713` |
| PO SENT | `5435538124` |
| DP PAID | `5435538125` |
| BALANCE PAID | `5435557037` |
| DOCS CHECKED | `5435556950` |
| HARD COPY RECEIVED | `5435557074` |
| PIB & OPS PAID | `5437850380` |
| Done | `5435538126` |

Purchasing Import ICL = project `23448086`; to-do sets: COMPONENTS
`4020136655`, STABILIZERS `4143458082`, FIRSTPOWER `4143458455`, KSTAR
`4143458609`, NINGBO LE `7307464352`.

If a move lands in a column whose title is not the one you meant, stop and
report (13 Oct: `5435538124` was used as "Done"; it is PO SENT).

## 9. The Telegram report

```
Sinkronisasi pembelian 14 Okt 2026 — 18 pesanan diperiksa

Sudah saya kerjakan (dibaca ulang ✓):
- RENA PIO-2026012: pelunasan 11 Sep dicatat di ICAPROC; kartu → DOCS CHECKED.
- TRISINDO PO-038: dokumen dari lampiran kartu disalin ke Drive.

Menunggu persetujuan Eric (jawab "ya 1, 3"):
1. RENA PIO-2026012: total PO 60.765 → 61.815 USD (PI revisi 11 Sep).
2. Dolibarr PO2609-0092 (MIBET PIO-015): status sudah 5, tetapi belum
   ditagih (billed). ICAPROC sudah lunas. Catat tagihan pemasok di Dolibarr?

Menunggu orang lain:
- TRISINDO PO-038: slip pelunasan 25 Jun tidak ada di Drive.

Sudah sinkron: EPSIVO PIO-016, RENASUN PIO-2026010, …
Tidak bisa dibaca: tidak ada
```

Amounts may appear in this report (it goes only to Eric), never bank details.
The template is in Indonesian; reply in the language Eric writes to you.

## 10. Never

- Never decide between two disagreeing places outside §5-A. Show both, ask.
- Never delete, move or overwrite a file on Drive. A duplicate goes to the
  trash only after Eric's yes.
- Never put an amount or bank details in Basecamp.
- Never report a write before you read it back.

## 11. Drive file names and duplicates

Owner's two tests for every name: **consistent** (it looks like the names
beside it) and **descriptive** (a person who reads only the name knows what
the file is, for which order, from when). The pattern below was read off the
real files on 14 Oct 2026 — the rule writes down how the team already names
them; it does not invent a new one. For a document type the table does not
cover, look at the earlier files of the same supplier and copy their pattern;
if there is none, use the closest pattern below with a plain descriptive type
(`PACKING LIST`, `INSURANCE`, …).

### 11.1 The file name

```
<n>. <TYPE>[ <k>]_[<CUR>_]<PI>_<YYYY-MM-DD>[ (<note>)].<ext>
```

| Part | Meaning | Examples on Drive |
|---|---|---|
| `<n>.` | the file's place in the order folder, in the order the documents arrived. 1 is the PI. Not tied to the type. A second file for the same step takes a letter: `2b.`, `7.a.` | `1. PI_…`, `4. PO_…`, `5. DP30_…`, `11. OPS_…`, `2b. PAYMENT_…` |
| `<TYPE>` | `PI` · `PO` · `SALES CONTRACT` · `DP<percent>` or `DP` · `BALANCE PAYMENT` or `BALANCE` · `REVISED PI` · `CI` · `PL` · `BL` · `FORM E` · `PIB` · `OPS` · `PAYMENT` (domestic) | `DP30`, `BALANCE PAYMENT`, `REVISED PI` |
| ` <k>` | the part number when a payment is split | `BALANCE PAYMENT 1`, `BALANCE PAYMENT 2` |
| `<CUR>_` | on a payment slip: `USD` for the transfer, `IDR` for the rupiah debit. One payment often has both files | `DP30_USD_…` and `DP30_IDR_…` |
| `<PI>` | the PI number exactly as the supplier writes it (hyphens kept); several PIs joined by `, ` | `PJ-260827-22 V02`, `LC26050010, LC26050011, LC26050017` |
| `<YYYY-MM-DD>` | the date the DOCUMENT shows (PI date, transfer date), with hyphens | `2026-09-03` |
| ` (<note>)` | optional, for a remark that must stay | `(R2, 20261012 updated - added TCP306)`, `(NOT VALUE TDY)` |

Both `BALANCE` and `BALANCE PAYMENT`, and both `DP` and `DP30`, are correct —
do not rename a file only to swap one for the other. Domestic (`-MBS-`)
orders use the PO number where an import uses the PI.

### 11.2 What counts as wrong, and what you do

This applies to the ORDER folders. The accounting folder has its own short
names — §11.4.

| Wrong | Example seen | Fix (§5-A) |
|---|---|---|
| no number, no type, or no PI | `ICA PI KST226-6815 UPS.xls` (folder `20260811 PIO-2026011, EB.42277, EB.42278`) | give it the full name; the next free number in the folder |
| date without hyphens | `1. PI_LC26020005_20260206.pdf`, `11. OPS_PI2026070901_20260820.jpeg` | `2026-02-06` — keep the number |
| stray space or symbol | `1. PI_ PJ-251222-18-Rev_2026-03-05.pdf` | remove it |
| no extension on an uploaded file | `1. PI_KST226-6816_2026-08-14` (a spreadsheet) | leave it if it is a Google Sheet; add the extension if it is an upload |

Never renumber a file that has a number, even out of order: the number is
its history.

### 11.3 A duplicate, and what is NOT one

A duplicate is **the same file twice**: same content, not just a similar
name. Check with the file's `md5Checksum` (Drive API v3; Google Docs, Sheets
and Slides have none — compare their content instead). Same size alone is a
hint, not proof.

- **Not a duplicate:** a revision (`R1`, `R2`, `Rev`, `V02`, `REVISED PI`),
  the USD and IDR slips of one payment, the parts of a split payment. Keep
  them all.
- **Before you add a copy (§5-A):** look for the same checksum in the order
  folder. If it is there, do not add another; make sure the one that is there
  has the right name.
- **Two copies in the SAME order folder:** keep the one with the right name
  (rename the better one if neither is right). Propose the other for the trash
  (§5-B): both names, both links, and "same checksum".
- **A copy in another folder** (the accounting folder, §11.4; another order's
  folder by mistake): report it; do not move or trash it.

### 11.4 The accounting copies

`0 Pembelian Impor - Accounting ISL / 2026 / <nn> <SUPPLIER>` (e.g.
`15 MIBET` for PIO-015) holds a second copy of an order's PI, PO and slips
for accounting, with short names — `PI`, `PO`, `DP (USD).png`,
`DP (IDR).png`, `BALANCE PAYMENT #1.jpg`. On 14 Oct, `DP (USD).png` there
and `2. DP30_USD_PJ-260827-22 V02_2026-09-03.png` in the order folder were
the same size (30,325 bytes) — almost certainly the same slip, copied on
purpose.

These copies are deliberate, not duplicates to clean up. Until Eric decides
whether the accounting folder uses the same names, change nothing there:
report a missing accounting copy, and propose renames (§5-B).

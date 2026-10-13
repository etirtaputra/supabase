# Purchasing sync — one order, four places, one answer

**v1 (2026-10-13), owner's rule:** *"Right now we have multiple places to
synchronize purchasing: Basecamp, Google Drive folders, ICAPROC, Dolibarr. We
need MIRA to help make sure everything is in sync. For example, sometimes
someone updated the payment slip or documents on Google Drive, but not synced
in Basecamp or ICAPROC."*

**Who:** MIRA. **Mode:** propose first — she changes nothing until the owner
says yes in Telegram (owner's choice, 2026-10-13; to be loosened later).

**The case that shows the problem (read on 2026-10-13).** RENA,
PIO-2026012 / RP2026081002:

| Place | What it said |
|---|---|
| Drive | `5. BALANCE PAYMENT_RP2026081002_2026-09-11.jpg` — balance paid 11 Sep |
| ICAPROC | down payment 14 Aug only; docs checked 6 Oct; no balance payment |
| Basecamp | card in "PO SENT" — behind even the down payment |

Three places, three answers, one order.

---

## 1. The four places, and what each one is

| Place | Role | What it holds for an order |
|---|---|---|
| **Google Drive** | the EVIDENCE | one folder per order, inside one folder per supplier. Folder name: `YYYYMMDD <PI number>, <PO number> [items]`. Files are numbered: `1. PI_<PI>_<date>`, `2. PO_<PO>_<date>`, `3. DP<n>_<PI>_<date>` (down-payment slip), `4. REVISED PI_…`, `5. BALANCE PAYMENT_<PI>_<date>`, then shipping documents (CI, PL, BL, Form E) and customs (PIB). |
| **ICAPROC** | the RECORD | `5.0_purchases` (PO, PI, status, received), `6.0_po_costs` (every payment), `docs_checked_at`, `hard_copy_received_at`. The stage of every order: `GET /api/agent/purchasing/progress`. |
| **Basecamp** | the TEAM'S VIEW | PROC IMPOR SOLAR → card table **PROGRESS IMPOR**, one card per order, title `SUPPLIER: <PI>, <PO> [items]`, column = stage. Purchasing Import ICL → to-do lists per supplier (COMPONENTS, STABILIZERS, FIRSTPOWER, KSTAR, NINGBO LE). |
| **Dolibarr** | the CURRENT ERP | not yet mapped for purchasing. Your first report says what Dolibarr holds for each order (supplier order? supplier invoice? payment?), and the owner then decides its role. |

**The direction of a fix:** Drive shows what HAPPENED → ICAPROC RECORDS it →
Basecamp SHOWS it. A fix flows down that line. Basecamp never corrects
ICAPROC, and ICAPROC never corrects Drive. If the evidence and the record
disagree, the person who filed the evidence is asked — you do not choose.

## 2. How to match one order across the four

Match by **PI number** first, then **PO number**. The PO number is written
three ways — `PIO-017-ISL-09-2026` (ICAPROC), `PIO/017` (Basecamp card),
`PIO/017` or `PIO-2026012` (Drive folder). Compare the digits and the year,
not the string. If two orders match one card or folder, list both and ask.

## 3. The checks, per order

1. **Payment slip on Drive, no payment in ICAPROC.** A `DP…` or
   `BALANCE PAYMENT…` file exists, and `6.0_po_costs` has no
   `down_payment` / `balance_payment` row near that date (± 3 days).
   *Propose:* record that payment in ICAPROC — category, date and the slip's
   file name. Never the amount from memory: read it from the slip or ask.
2. **ICAPROC stage ≠ Basecamp column.** `basecamp_column` from the progress
   endpoint is not the column the card is in. *Propose:* move the card.
3. **An order in one place only.** A Basecamp card or Drive folder with no
   ICAPROC PO, or a tracked ICAPROC PO with no card or folder. *Propose:*
   who should create what. Never create a PO in ICAPROC yourself.
4. **Shipping documents on Drive, "Docs Checked" not ticked.** Report it.
   Docs Checked and Hard Copy Received are ticked by a PERSON in ICAPROC —
   never by you.
5. **Dolibarr.** Until its role is decided: report what it shows, no
   proposals.

## 4. The report

Send it to the owner in Telegram. One numbered line per mismatch, so he can
answer "yes 1, 3, 4":

```
3. RENA PIO-2026012 / RP2026081002
   Drive: balance slip 2026-09-11 (5. BALANCE PAYMENT_RP2026081002_2026-09-11.jpg)
   ICAPROC: down payment 2026-08-14 only
   Basecamp: PO SENT
   Propose: (a) record balance payment 2026-09-11 in ICAPROC
            (b) then move the card to the column the endpoint gives
```

End with the orders that ARE in sync, as one line each, so a missing order is
visible. Say which places you could not read, and why.

## 5. After a yes

- Do only the numbers the owner said yes to, in the order (a) before (b):
  record first, then show.
- **ICAPROC:** follow the purchasing runbook for any write.
- **Basecamp:** after you move a card, add one comment: `MIRA: moved from
  <old> to <new>. ICAPROC shows <fact>, recorded <date>. Evidence: <Drive
  file name>.` No amounts and no bank details in Basecamp.
- **Drive:** read only. Do not move, rename or delete a file, even a
  misnamed one — report it.
- Read the progress endpoint again after the writes and report the new state.

## 6. Never

- Never act on a mismatch without the owner's yes (until this runbook says
  otherwise).
- Never write a bank account number, a balance or a supplier's bank details
  in Basecamp or Telegram.
- Never decide which of two disagreeing places is right. Show both, ask.

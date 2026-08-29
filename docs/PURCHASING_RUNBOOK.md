# ICAPROC Purchasing Runbook (buy side)

Six procedures, in the order the work happens. Each is written twice: the click-path a
person follows, and the contract an agent must honour. Both describe the same save.

**When the app and this document disagree, the app is right.** Report it; this file gets
fixed. Every field, order and constraint below was read from the shipping code and the
live schema on 28 Aug 2026 (`app/purchasing/page.tsx`, `components/forms/NewDealForm.tsx`,
`components/ui/ComponentEditor.tsx`, `constants/enums.ts`, and the Postgres enums and
triggers). The three doubled POs, the Rp 45 trillion row and the missing `created_at` are
recorded incidents, not hypotheticals.

---

## Rules that override everything else

An agent that remembers nothing else from this document must still obey these five.

1. **Lines before totals.** Never write `5.0_purchases.total_value` before
   `5.1_purchase_line_items` rows exist. See §4.
2. **`currency == 'IDR'` means the amount is already rupiah**, even when an
   `exchange_rate` is present. Never multiply. See §5.
3. **A near-match is a question for a human, never an auto-merge.** Only an exact
   `lower(trim(supplier_model))` match counts as "this component already exists". See §1.
4. **Never invent a total.** Totals are derived. Omitting them yields the correct answer.
5. **New Deal creates; it does not edit.** Amendments to a saved document go through
   Deal Lookup. See §7.

## Escalate to a human, do not guess

- A near-duplicate component (similar but not identical model).
- A payment whose currency and exchange rate you cannot reconcile.
- A PO revision where it is unclear whether to amend in place or supersede.
- Any total that does not equal `items + freight` after a save.
- Anything this document does not cover.

---

## 1. Has this supplier quoted us this item before?

**Screen:** Item Editor · `/items`

### Do this
1. Open **Item Editor**.
2. Set the **All Suppliers** filter to the supplier you are buying from. The list drops to
   items that have appeared on *that supplier's* PIs and POs.
3. Type the supplier's model number into the search box.
4. Nothing found? Widen it — clear the supplier filter and search the model alone. The item
   may exist under a different supplier, in which case you reuse it rather than creating a
   second copy.
5. Still nothing? It is genuinely new. Go to §2.

The **Duplicates** filter shows every model that already collides with another — worth a
glance before adding anything.

### Contract
```
# Does supplier S already have a component matching M?
read  3.0_components             -> supplier_model, internal_description
join  4.1_price_quote_line_items -> 4.0_price_quotes.supplier_id
join  5.1_purchase_line_items    -> 5.0_purchases.supplier_id

match lower(trim(supplier_model))
      # exactly what the app's own check uses.
      # NOT ILIKE, NOT fuzzy.

emit  exact -> reuse this component_id
      other -> same model, different supplier: reuse
      none  -> proceed to section 2
      near  -> STOP. Ask a human. Never create.
```

### Why supplier-scoped, and not just a search
993 items are in the catalogue and models repeat across suppliers. The supplier filter is
built from the documents each item has actually appeared on, so it answers the real
question — *have we traded this with them* — rather than *does this string exist somewhere*.

### Note for API clients
The duplicate check is implemented in React, not in the database. An agent writing directly
to PostgREST does not hit it and must run this lookup itself before every component insert.

---

## 2. Add a new component

**Screen:** Item Editor · **Add Component**

### Do this
1. Do §1 first. Always.
2. Press **Add Component**. An inline form opens with one blank row — it takes as many rows
   as you need, so a whole datasheet goes in at once.
3. Fill **Model** and **Description**. A row is not counted as ready until both are there;
   the header tallies "*n* of *m* ready".
4. Expand the row for brand, category, unit, specifications, datasheet URL and norm value.
5. Watch for the amber **Possible duplicate** under the model field. It appears live, while
   you type, when the model already exists. Stop and go back to §1.
6. Save.

### Contract
```
write 3.0_components

required
  supplier_model        # the SUPPLIER's SKU
  internal_description  # OUR customer-facing name

optional
  brand · category · unit · specifications
  datasheet_url · norm_value

refuse if
  lower(trim(supplier_model)) already exists
  # the UI warns; an agent must hard-stop
```

### These two fields are not interchangeable
`supplier_model` is what the supplier calls it. `internal_description` is what the customer
sees on a quotation. Sales renders the description and never the SKU — putting the
supplier's part number in the description leaks it onto customer documents.

### You cannot audit this later
`3.0_components` carries `updated_at` but **no `created_at`**. There is no way to ask when
an item was added or how many were added last month. Be deliberate at entry, because the
record of it is thin.

---

## 3. New Deal — quote only

**Screen:** Purchasing · `/purchasing?tab=quoting` · mode **Quote only**

A supplier has sent a price. Nothing is committed and no money moves — you are recording an
offer so it can be compared, accepted, or left to expire.

| Field | Required | What goes in it |
|---|---|---|
| Supplier | yes | Who quoted. |
| Addressed To | yes | Which of our companies the quote is made out to. |
| Date | yes | The quote's own date, not today. |
| Quote Ref | — | The supplier's PI or quote number. |
| Currency | yes | The currency the supplier quoted in. |
| Freight Cost | — | Supplier-quoted freight. Accepts `=` formulas. Carried onto the PO if one is raised. |
| Status | — | Defaults to `Open`. Also: Accepted · Replaced · Rejected · Expired. |
| Lead Time | — | As quoted. |
| Replaces Quote | — | If this supersedes an earlier quote, link it here. |
| Document Folder | — | See §6. |

### Then the lines
1. Pick the component. The supplier's own description auto-fills; edit it if their wording
   differs.
2. Quantity, unit price. Line currency defaults from the header.
3. A fresh blank row always waits at the end — keep going until the quote is complete.
4. Save once. Header and lines go together.

### There is no Total field, and that is deliberate
The deal's total is **items + freight**, computed at save. You cannot type it.

A discount is **a line with a negative price** — so it shows up as a line on the document
instead of vanishing into a total nobody can reconcile.

### Contract
```
write 4.0_price_quotes           # header, incl. freight_charges_intl
then  4.1_price_quote_line_items # quote_id from the insert above

never total_value          # derived, not entered
never po_number, po_date, exchange_rate,
      method_of_shipment, payment_terms
      # PO-only keys. A quote-only save that
      # carries them is a mode-switch leak.
```

---

## 4. New Deal — quote + PO

**Screen:** Purchasing · `/purchasing?tab=quoting` · mode **Quote + PO**

You are ordering. One save writes both documents with the same lines — the quoted price
becomes the PO cost. The **Status** field disappears, because the quote lands as `Accepted`
automatically.

### Two shortcuts appear at the top
1. **Stored Quote** — raise the PO for a quote saved earlier. Its lines are seeded in;
   edit, add or remove them freely. The PO gets exactly what the editor shows, and the
   stored quote itself is never changed. Leave empty for a brand-new PI.
2. **Stored PO** — revise an existing PO. It loads that PO's own items. **Keep the number**
   to amend in place; **change the number** to split lines off or supersede it, in which
   case the old PO is marked `Replaced` and linked.

### Fields belonging to the PO
Everything else on the form is shared between the two documents.

| Extra field | Required | What goes in it |
|---|---|---|
| PO # | yes | Our purchase order number. Unique — that is what makes a same-number revision an amendment rather than a new row. |
| PO Date | — | Empty means the same date as the PI. |
| Exch Rate | — | Estimated. Auto-filled from payment history if left empty. **IDR ignores it.** |
| Ship Via | — | Method of shipment. |
| PO Terms | — | Payment terms. Defaults from Settings. |
| Replaces PO | — | Supersede an older PO *without* loading its items. Use Stored PO above if you want the items too. |

### TRAP: lines first, total last — this one doubled three POs
`5.1_purchase_line_items` fires `recalculate_po_total()`, which keeps the PO total in step
with its lines *while preserving the amount the total exceeds them by* — the freight billed
on top. It measures that gap against the lines present at the time.

Write a total onto a PO that has no lines yet and the gap is measured against zero: the
entire total is read as freight, and the first line then stacks the goods on top of it. The
total lands at exactly twice the goods.

**PO-149-MBS-08-2026 read IDR 1.619.460 against IDR 809.730 of lines; EB.42277 and
EB.42324 the same.**

### Contract
```
write 4.0_price_quotes           # status -> Accepted
then  4.1_price_quote_line_items
then  5.0_purchases              # unit_price -> unit_cost
then  5.1_purchase_line_items
last  5.0_purchases.total_value  # ONLY if stated, and
                                 # ONLY after the lines exist

omit total -> the trigger sets it to the line sum,
              which is the right answer. Do not guess.

status 5.0_purchases
  Draft · Sent · Confirmed · Replaced
  Partially Received · Fully Received · Cancelled
```

---

## 5. Log a payment

**Screen:** Purchasing · `/purchasing?tab=financials`

The highest-volume thing on this page — roughly 32 entries a month. Two modes: **Single**
for one payment against one PO, **Batch** for one bank remittance covering several.

| Field | Required | What goes in it |
|---|---|---|
| Select PO | yes | Which order this money is against. |
| Cost Category | yes | See the three families below. |
| Amount | yes | As it left the bank. |
| Currency | yes | The currency of that amount. |
| Exchange Rate | — | Only if it differs from the PO's rate. The PO's rate shows as the placeholder. |
| Date | — | Value date on the bank record. |
| Notes | — | Anything the bank reference does not say. |

### Eighteen categories, three families

**Payments**
`down_payment` · `balance_payment` · `additional_balance_payment` · `overpayment_credit`

**Bank fees**
`full_amount_bank_fee` · `telex_bank_fee` · `value_today_bank_fee` · `admin_bank_fee` ·
`inter_bank_transfer_fee`

**Landed costs**
`local_import_duty` · `local_vat` · `local_income_tax` · `local_import_tax` ·
`freight_cost` · `local_delivery` · `demurrage_fee` · `penalty_fee` ·
`dhl_advance_payment_fee`

### TRAP: the currency rule — worth Rp 45 trillion when it was got wrong
A cost row can be `currency = 'IDR'` **and still carry an exchange_rate**. When it does, the
amount is **already in rupiah** and the rate is only a record of what was used — provenance,
not a multiplier.

Re-applying it to an IDR amount produced **Rp 45 trillion on a single row**.
`lib/dealGroups.ts -> costToIdr` encodes the rule correctly. Read it; do not write a second
conversion.

### Batch mode
1. Switch the mode toggle to **Batch** when one remittance covers several POs.
2. Enter the payment once. It is allocated **proportionally by each PO's IDR value**; per-PO
   overrides are available where the split was not proportional.
3. One `payment_batches` row is created, plus one cost row per PO × per cost entry.

### Contract
```
write 6.0_po_costs                    # single
write payment_batches + 6.0_po_costs[] # batch

to IDR
  currency == 'IDR'  -> amount          # AS IS
  otherwise          -> amount × rate
  # never branch on "is exchange_rate present"

rate  omit unless it differs from the PO's
```

---

## 6. Attach the document folder

**Screen:** New Deal header · field **Document Folder**

### Do this
1. On a deal you are creating: paste the folder link into **Document Folder**, near the
   bottom of the shared header. It takes a full URL — `https://drive.google.com/…`.
2. Link the **folder**, not a single file. The PI, the PO, the bank slip and the packing
   list all belong to one deal, and a folder link survives new documents being added to it.
3. On a deal already saved: open it in **Deal Lookup** and amend it there.

### Contract
```
column document_url

on 4.0_price_quotes  # the quote's folder
on 5.0_purchases     # the PO's folder

quote + PO -> both get it from the one field
value plain URL string, no validation
      # a typo saves silently. Paste, do not type.
```

---

## 7. Changing something already saved

**Screen:** Deal Lookup · `/purchasing?tab=lookup`

New Deal creates. It does not edit. Lines, totals, folder links and statuses on a document
that already exists are all amended in **Deal Lookup** — the one exception being a PO you
deliberately reload through **Stored PO** in order to revise or supersede it (§4).

---

## Appendix: how an agent connects

ICAPROC has no API keys and no webhooks. Authentication is Supabase Auth; the data API is
PostgREST.

```
POST https://<project>.supabase.co/auth/v1/token?grant_type=password
     apikey: <anon key>
     {"email": "<service account>", "password": "<password>"}
  -> access_token (1h), refresh_token

<VERB> https://<project>.supabase.co/rest/v1/<table>
     apikey: <anon key>
     Authorization: Bearer <access_token>
```

Table names carry numeric prefixes (`4.0_price_quotes`) and are used verbatim in the path.

Business rules live in the React app, not only in the database. An agent writing directly
to PostgREST bypasses them, which is why the contracts above exist. In particular: the
duplicate check (§1), the derived totals (§3, §4) and the buy-side role permissions are all
enforced client-side.

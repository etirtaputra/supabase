# ICAPROC — the schema, for agents

> **Read this before your first query. Never guess a table name.**
>
> Written 2026-09-06 against `main` @ the commit that added it. Row counts are
> from that day and drift; the NAMES and the RULES are what matter.
>
> Why this file exists: on 2026-09-06 an agent queried `batteries`, got 3 rows,
> and reported it as the catalogue. The real figure is 27. The table names here
> are not guessable — no one invents `3.0_components` — so guessing produces
> confident, wrong answers instead of errors.

---

## 0. Five tables that will lie to you

**Never read these. They are abandoned leftovers, kept only because dropping
them has not been authorised yet.**

| Dead table | Rows it shows | The truth |
|---|---|---|
| `batteries` | 3 | 27 in `3.0_components` |
| `pv_modules` | 5 | 13 |
| `hybrid_inverters` | 7 | 48 |
| `on_grid_inverters` | — | 23 |
| `solar_charge_controllers` | — | 72 |

There is **one** product table: `3.0_components`. If an answer about products
did not come from it, the answer is wrong.

---

## 1. The catalogue — `3.0_components` (~1,005 rows)

Everything about an item: identity, specs, price, stock links.

| Column | Meaning |
|---|---|
| `component_id` | the key everything else joins on |
| `internal_description` | **OUR** name. The only name a customer may see. |
| `supplier_model` | the supplier's code. **Never customer-facing.** |
| `brand` | buy-side sensitive; hidden from sell-side roles in the app |
| `category` | enum, see below |
| `specifications` | `jsonb` — the spec fields (see the design pack) |
| `norm_value` | capacity in the category's base unit (Wp, Wh, W, A) |
| `selling_price_idr` | list price; **null or 0 means unpriced, not free** |
| `archived_at` | **NOT NULL = retired.** Exclude it from anything current. |
| `quote_cost_mode` | `'hidden'` = never offer on a customer document |

**`category` enum** (`ac_cable`, `switchgear` and `monitoring` were split out of
`accessories` on 2026-09-06):

```
pv_module · on_grid_inverter · inverter_charger · power_inverter
batteries · portable_power · solar_charge_controller · mounting
pv_cable · ac_cable · switchgear · monitoring · accessories
solar_pump_inverter · ups · stabilizer · ev_charger
standing_cabinet · wallmount_cabinet · non_stock
```

`non_stock` is project one-offs and cable tray — not a shoppable aisle.

**Offerable = not archived AND not `quote_cost_mode = 'hidden'`.** Both, always.
Asking only one of them is how a retired module kept appearing in the mounting
designer for two days.

---

## 2. EPC projects — the `10.x` family

| Table | Rows | What |
|---|---|---|
| `10.0_project_quotes` | 44 | the proposal header |
| `10.1_quote_sections` | 488 | sections within a proposal |
| `10.2_quote_items` | 1,441 | line items |
| `10.3_quote_activity` | 571 | the audit log |

Header columns worth knowing: `quote_number`, `quote_date`, `customer_name`,
`project_description` (the capacity is prose in here, not a number column),
`project_type`, `status`, `created_by_email`.

**THE REVISION RULE.** A quote number with a `-REV` / `-REV2` suffix
**supersedes its base**, and the highest REV is the current one. They are
separate rows, all still present.

> Worked example, 2026-09-06: `Q-20260705-6SZ3` MidPlaza 1.81 MWp (sent),
> `-REV` 1.26 MWp (draft), `-REV2` **1.63 MWp** (draft). Reporting "largest =
> 1.81 MWp" is true of the original and misleading about the deal. Always say
> which revision, and whether a later one exists.

---

## 3. Sell side

| Table | What |
|---|---|
| `20.0_customers` (489) · `20.1_customer_contacts` | CRM |
| `21.0_price_tiers` · `21.1_item_tier_prices` (347) | tier pricing |
| `22.0_sales_quotes` (11) → `22.1_sales_quote_items` (33) | **`_items`, NOT `_line_items`** |
| `24.0_delivery_orders` → `24.1_delivery_order_items` | DO |
| `25.0_sales_invoices` → `25.1_sales_invoice_items` | AR |
| `26.0_customer_receipts` | payments in |
| `27.0_aftersales_cases` → `27.2_aftersales_updates` | service desk |
| `28.0_support_letters` → `28.1_support_letter_items` | Surat Dukungan |

`22.0_sales_quotes` carries one row through the whole lifecycle — `status`
walks `draft → validated → sent → accepted → ordered → invoiced → preparing →
delivered`, and the SO/INV/DO numbers are stamped onto the same row by a
trigger as it passes each milestone.

## 4. Stock

`30.0_stock_movements` (174, append-only ledger) · `30.1_stock_balances` (138,
trigger-maintained) · `30.2_goods_receipts` · `30.3_warehouses` ·
`30.4_serial_numbers`

Balances are **derived**. Never write them; post a movement.

## 5. Buy side — not every agent's business

`1.0_companies` · `2.0_suppliers` (37) · `4.0_price_quotes` (137) →
`4.1_price_quote_line_items` (927) · `5.0_purchases` (226) →
`5.1_purchase_line_items` (651) · `6.0_po_costs` (341) ·
`7.0_competitor_prices` · `9.0_exchange_rate_history`

**Since 2026-09-06 the database enforces this**, not just the app: writing any
of these needs `owner`, `buy_admin`, `data_entry` or `finance`. A Project
Engineer login is refused. Reads are still open to any signed-in user — that is
the next thing to tighten, so treat supplier costs as confidential regardless
of whether a query happens to succeed.

---

## 6. What no one may write

Maintained solely by `SECURITY DEFINER` triggers. Attempts are denied, and that
is deliberate — it is what makes the audit trail worth having:

`21.3_item_price_history` · `22.3_sales_activity_log` · `30.1_stock_balances`

---

## 7. Your identity is in your token

Sign in with the **anon key + your password**. Every data call then carries
your JWT, and 14 audit triggers read your identity from it:

```sql
SELECT email INTO actor FROM user_profiles WHERE id = auth.uid();
actor := COALESCE(actor, 'system');
NEW.created_by_email := actor;    -- overwrites whatever you send
```

You cannot forge that name and cannot forget it.

**Never ask for or accept a service-role key.** It bypasses row-level security
entirely and makes `auth.uid()` NULL, so every row you write is stamped
`'system'` and the append-only logs in §6 stop being append-only. Losing
attribution is the point of the account, not a side effect.

---

## 8. Habits that would have prevented every mistake so far

1. **Name the table with the number.** "3 batteries" was wrong because of the
   table, not the query. Say where a figure came from.
2. **A name you guessed is not a name.** If it is not in this file, ask.
3. **Check for a later revision** before calling anything the biggest, latest
   or current (§2).
4. **Exclude `archived_at IS NOT NULL`** from anything describing what is
   available now.
5. **An error says where a failure surfaced, not where it lives.** A 500 naming
   the database is a claim to test, not a diagnosis — and the cheapest test is
   usually "can anything else reach this system right now?"
6. **Label a hypothesis as a hypothesis.** "The auth endpoint returned 500,
   cause unknown" is a report. "The project is paused" was a guess that cost an
   hour.

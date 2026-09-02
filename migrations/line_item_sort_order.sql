-- Deal Lookup: let a person drag quote / PO lines into the order the supplier's
-- PI actually presents them, so the screen reads like the document it mirrors.
--
-- Neither line-item table had any ordering column, and neither query in
-- hooks/useSupabaseData.ts carried an ORDER BY — so the rows came back in
-- Postgres physical order, which silently reshuffles whenever a row is
-- updated. There was no order to preserve, only an accident to replace.
--
-- Deliberately NOT backfilled. `5.1_purchase_line_items` carries three UPDATE
-- triggers (recalculate_po_total, trigger_fill_purchase_desc,
-- update_line_items_timestamp); a mass UPDATE to seed the column would fire
-- them across every PO in the system. (recalculate_po_total is provably a
-- no-op for a sort_order-only change — quantity and unit_cost are unchanged,
-- so old_sum = cur_sum and total_value is rewritten to itself — but touching
-- 200+ POs to set a column nobody has used yet is not a trade worth making.)
--
-- Instead: NULL sorts last with a deterministic tiebreak, so nothing appears
-- to move until someone drags. The first drag on a document writes sort_order
-- for every line of THAT document only, in the order then on screen.
--
-- Applied 2026-09-02.

alter table "4.1_price_quote_line_items" add column if not exists sort_order integer;
alter table "5.1_purchase_line_items"    add column if not exists sort_order integer;

create index if not exists idx_quote_line_items_sort
  on "4.1_price_quote_line_items" (quote_id, sort_order);
create index if not exists idx_po_line_items_sort
  on "5.1_purchase_line_items" (po_id, sort_order);

comment on column "4.1_price_quote_line_items".sort_order is
  'Display order within the quote, set by dragging in Deal Lookup. NULL = never ordered; sorts last.';
comment on column "5.1_purchase_line_items".sort_order is
  'Display order within the PO, set by dragging in Deal Lookup. NULL = never ordered; sorts last.';

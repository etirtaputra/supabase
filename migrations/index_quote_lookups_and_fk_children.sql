-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes on the columns the editors filter by, and on the FK columns a delete
-- has to scan.  Applied 2026-08-28.
--
-- BE HONEST ABOUT THE SIZE OF THIS.  It is future-proofing, not a felt win.
-- Measured on production the same day, warm, the EPC editor's own query:
--
--   explain (analyze, buffers) select * from "10.2_quote_items"
--     where quote_id = <one quote> order by sort_order;
--
--   Seq Scan on 10.2_quote_items  ... Rows Removed by Filter: 1035
--   Buffers: shared hit=30        Execution Time: 0.323 ms
--
-- After, same query, same day:
--
--   Bitmap Index Scan on 10.2_quote_items_quote_id_idx
--   Buffers: shared hit=7 read=1   Execution Time: 0.213 ms
--
-- 0.32ms -> 0.21ms.  Nobody will feel these today.  The number that matters is
-- the one beside it: 30 buffers touched per read down to 8, and that gap is
-- what widens with the table while the milliseconds stay small.
--
-- They are worth doing because the shape of the work only goes one way: the
-- EPC editor runs that filter on every open, every 15-second sync poll and
-- every save, and the sales editor started doing the same on 2026-08-28.  A
-- seq scan costs the whole table each time; an index's cost barely moves.
--
-- ── Part 1: the five the roadmap named (all EPC) ────────────────────────────
-- `quote_id` is what both editors filter on; `section_id` and `component_id`
-- are joined per row when a proposal is rendered.
create index if not exists "10.2_quote_items_quote_id_idx"     on public."10.2_quote_items"    (quote_id);
create index if not exists "10.2_quote_items_section_id_idx"   on public."10.2_quote_items"    (section_id);
create index if not exists "10.2_quote_items_component_id_idx" on public."10.2_quote_items"    (component_id);
create index if not exists "10.1_quote_sections_quote_id_idx"  on public."10.1_quote_sections" (quote_id);
create index if not exists "10.3_quote_activity_quote_id_idx"  on public."10.3_quote_activity" (quote_id);

-- ── Part 2: three FK CHILD columns with no index (sell side) ────────────────
-- Found while measuring part 1, and these are not merely future-proofing.
-- Postgres does NOT index the referencing side of a foreign key for you, and
-- all three of these are ON DELETE SET NULL — so every delete of a parent row
-- makes the database scan the WHOLE child table looking for references.
--
-- The sales editor deletes 22.1_sales_quote_items rows on any save that
-- removes a line (lib/salesLines.ts), so this sits on a live write path. The
-- child tables hold 6 and 3 rows today; the scan is free now and is not free
-- once the sell side ramps.
create index if not exists "24.1_delivery_order_items_so_item_id_idx" on public."24.1_delivery_order_items" (so_item_id);
create index if not exists "25.1_sales_invoice_items_so_item_id_idx"  on public."25.1_sales_invoice_items"  (so_item_id);
create index if not exists "25.0_sales_invoices_do_id_idx"            on public."25.0_sales_invoices"        (do_id);

-- Fresh statistics, so the planner can actually choose them.
analyze public."10.2_quote_items";
analyze public."10.1_quote_sections";
analyze public."10.3_quote_activity";

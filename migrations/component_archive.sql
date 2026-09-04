-- Archive an item instead of deleting it.
--
-- The catalogue carries 1,003 items and a good number are listed but no longer
-- traded: a superseded model, a one-off nobody reorders, a supplier we stopped
-- buying from. Deleting them is not the answer — a deleted item takes its
-- purchase history, its stock movements and its quote lines with it, and those
-- are the record of what the business actually did. Archiving hides the item
-- from the working lists and leaves every row that points at it intact.
--
-- A TIMESTAMP, not a boolean: `archived_at is null` is the same test a boolean
-- would give, and it also answers "since when?", which a boolean throws away.
-- `archived_by_email` matches how the rest of the schema records who did a
-- thing.
--
-- Applied 2026-09-03. Additive and nullable: every existing row reads as
-- active, and nothing that queries the table today has to change to keep
-- working — the screens opt IN to the filter.

alter table "3.0_components" add column if not exists archived_at timestamptz;
alter table "3.0_components" add column if not exists archived_by_email text;

-- The working lists all ask the same question — "the ones still in play" — so
-- the index is partial on exactly that.
create index if not exists idx_components_active
  on "3.0_components" (category) where archived_at is null;

comment on column "3.0_components".archived_at is
  'When the item was archived. NULL = active. Archived items are hidden from the Item Editor and the Products list by default, and keep every purchase, stock and quote row that points at them.';
comment on column "3.0_components".archived_by_email is
  'Who archived it — NULL when the item is active.';

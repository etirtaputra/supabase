-- ─────────────────────────────────────────────────────────────────────────────
-- The Progress board: three columns, and only three.
--
-- The team ran this board in Basecamp, where every stage is a card someone has
-- to drag. Five of the seven milestones are already answerable from rows this
-- database holds — a PI number, a po_date off Draft, a down_payment row, the
-- principal payments meeting the obligation, an import-charge row — so those
-- five are DERIVED at read time (lib/poProgress.ts) and are deliberately NOT
-- stored. A stored stage is a second copy of the truth, and a second copy is
-- what made the Basecamp board drift.
--
-- Only two milestones have no data behind them anywhere in ICAPROC. They are
-- the only two stored here, and the only two a person can click.
--
-- Applied 2026-08-29.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public."5.0_purchases"
  -- Does this deal go on the board? Set at New Deal time: on by default when a
  -- PO is being raised, off for a quote recorded for future reference. 66 of
  -- the 132 quotes on file have no PO — those are exactly what must stay off.
  add column if not exists track_progress        boolean not null default false,
  -- The paperwork checkpoints. Timestamps rather than booleans so the card can
  -- say WHEN, and so a mis-tick is undone by nulling one column.
  add column if not exists docs_checked_at       timestamptz,
  add column if not exists hard_copy_received_at timestamptz;

comment on column public."5.0_purchases".track_progress is
  'On the Purchasing → Progress board. Set at New Deal; quote-only deals stay off.';
comment on column public."5.0_purchases".docs_checked_at is
  'Docs Checked milestone. Stored because nothing else in ICAPROC knows it.';
comment on column public."5.0_purchases".hard_copy_received_at is
  'Hard Copy Received milestone. Stored because nothing else in ICAPROC knows it.';

-- The board's only query is "the tracked ones". Partial, because tracked POs
-- are the small minority — a handful live at a time against 223 rows — so the
-- index stays tiny and the planner can use it for the board's whole read.
create index if not exists "5.0_purchases_track_progress_idx"
  on public."5.0_purchases" (po_date desc)
  where track_progress;

-- NOT DONE ON PURPOSE: no backfill. `track_progress` starts false everywhere,
-- so the board opens empty and the team ticks the deals it is actually
-- watching. The Basecamp board shows DONE (173) against a handful of live
-- cards; backfilling all 171 unsettled POs would bury the live ones on day
-- one. To change that later, this is the whole of it:
--
--   update public."5.0_purchases" set track_progress = true
--   where status not in ('Fully Received', 'Replaced', 'Cancelled');

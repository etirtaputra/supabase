-- ============================================================
-- Money Manager – Phase 4: Transfer linking + multi-currency fields
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Link Transfer-Out / Transfer-In pairs via a shared UUID.
alter table public.transactions
  add column if not exists transfer_id uuid;

-- Currency code (ISO 3-char). Default IDR for existing rows.
alter table public.transactions
  add column if not exists currency varchar(3) not null default 'IDR';

-- Original amount in the source currency (before IDR conversion).
-- Currently always equals "amount" (all IDR), kept for future multi-currency.
alter table public.transactions
  add column if not exists original_amount bigint;

-- Raw "Accounts.1" column from import file (redundant; stored for audit).
alter table public.transactions
  add column if not exists raw_accounts1 bigint;

-- Index to quickly look up all rows in a transfer pair.
create index if not exists idx_transactions_transfer_id
  on public.transactions (transfer_id)
  where transfer_id is not null;

-- ============================================================
-- Usage:
--   transfer_id: shared UUID on both the TrfOut and TrfIn rows
--                that form a single internal transfer event.
--                NULL for all non-transfer transactions.
-- ============================================================

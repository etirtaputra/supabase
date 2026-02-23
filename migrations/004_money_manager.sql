-- ============================================================
-- Money Manager – Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- Project: money manager (eiaevbdfmaxbdfhnyvcq)
-- ============================================================

-- 1. Create the transactions table
create table if not exists public.transactions (
  id          uuid      default gen_random_uuid() primary key,
  user_id     uuid      references auth.users(id) on delete cascade not null,
  date        date      not null default current_date,
  time        time      not null default current_time,
  account     text      not null default 'Cash',
  category    text      not null default '',
  subcategory text      not null default '',
  note        text      not null default '',
  description text      not null default '',
  amount      numeric(15, 2) not null default 0,
  type        text      not null default 'Exp'
                        check (type in ('Inc', 'Exp', 'Trf')),
  bookmarked  boolean   not null default false,
  created_at  timestamptz default now() not null
);

-- 2. Enable Row Level Security
alter table public.transactions enable row level security;

-- 3. RLS Policies – users only see / modify their own rows
create policy "select_own_transactions"
  on public.transactions for select
  using (auth.uid() = user_id);

create policy "insert_own_transactions"
  on public.transactions for insert
  with check (auth.uid() = user_id);

create policy "update_own_transactions"
  on public.transactions for update
  using (auth.uid() = user_id);

create policy "delete_own_transactions"
  on public.transactions for delete
  using (auth.uid() = user_id);

-- 4. Indexes for fast querying
create index if not exists idx_txn_user_id
  on public.transactions (user_id);

create index if not exists idx_txn_date
  on public.transactions (date desc);

create index if not exists idx_txn_type
  on public.transactions (type);

-- Composite index for the most common query: user + month filter
create index if not exists idx_txn_user_date
  on public.transactions (user_id, date desc);

-- Composite index for filtering by user + type
create index if not exists idx_txn_user_type
  on public.transactions (user_id, type);

-- Index for note autocomplete query
create index if not exists idx_txn_user_note
  on public.transactions (user_id, note);

-- ============================================================
-- Done! You should now see the `transactions` table in the
-- Supabase Table Editor with RLS enabled.
-- ============================================================

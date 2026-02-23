-- ============================================================
-- Money Manager – Phase 2: Account Settings & Extended Types
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- 1. Create user_accounts table
create table if not exists public.user_accounts (
  id         uuid        default gen_random_uuid() primary key,
  user_id    uuid        references auth.users(id) on delete cascade not null,
  name       text        not null,
  category   text        not null default 'debit'
             check (category in ('cash', 'debit', 'credit', 'investment', 'ewallet')),
  created_at timestamptz default now() not null,
  unique (user_id, name)
);

-- 2. Enable RLS
alter table public.user_accounts enable row level security;

-- 3. RLS Policies
create policy "select_own_user_accounts"
  on public.user_accounts for select
  using (auth.uid() = user_id);

create policy "insert_own_user_accounts"
  on public.user_accounts for insert
  with check (auth.uid() = user_id);

create policy "update_own_user_accounts"
  on public.user_accounts for update
  using (auth.uid() = user_id);

create policy "delete_own_user_accounts"
  on public.user_accounts for delete
  using (auth.uid() = user_id);

-- 4. Index
create index if not exists idx_user_accounts_user_id
  on public.user_accounts (user_id);

-- 5. Extend transactions.type to support new types
--    New types:
--      IncBal  = Income Balance  (balance correction that increases account)
--      ExpBal  = Expense Balance (balance correction that decreases account)
--      TrfIn   = Transfer-In  (nominal receipt from another account)
--      TrfOut  = Transfer-Out (nominal send to another account)
--      Trf     = Legacy generic transfer (treated as TrfOut)
alter table public.transactions
  drop constraint if exists transactions_type_check;

alter table public.transactions
  add constraint transactions_type_check
  check (type in ('Inc', 'Exp', 'Trf', 'TrfIn', 'TrfOut', 'IncBal', 'ExpBal'));

-- ============================================================
-- Done!
-- ============================================================

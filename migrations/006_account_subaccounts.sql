-- ============================================================
-- Money Manager – Phase 3: Account Hierarchy (parent / subaccount)
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Add parent_id to support Account → Subaccount hierarchy.
-- Top-level accounts have parent_id = NULL (these are the "Account Groups").
-- Subaccounts have parent_id pointing to their parent account.
alter table public.user_accounts
  add column if not exists parent_id uuid
    references public.user_accounts(id) on delete cascade;

-- Index for fast child-lookup
create index if not exists idx_user_accounts_parent_id
  on public.user_accounts (parent_id);

-- ============================================================
-- Usage:
--   Account Group  → parent_id IS NULL,  category = 'debit'|'credit'|…
--   Subaccount     → parent_id = <group uuid>, category can be NULL
-- In transactions, the "account" field stores a subaccount name.
-- ============================================================

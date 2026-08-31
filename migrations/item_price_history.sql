-- ─────────────────────────────────────────────────────────────────────────────
-- What a price used to be, when it changed, and what it earned at the time.
--
-- Owner's ask (2026-08-29): "we should have Log of prices — what was the price
-- before, dates of price last set, and its corresponding GP% and whether it is
-- within range or not."
--
-- WRITTEN BY TRIGGERS, NOT BY THE APP. Three reasons, and the third is the one
-- that decides it:
--   1. Set Pricing is not the only writer — Deal Lookup, the Floor Audit's
--      "raise to floor" and the bulk raise all move prices too;
--   2. an app-side log is silently skipped whenever a save path is added later;
--   3. `po@icasolar.com` now writes through PostgREST directly, so anything the
--      React app records is a log of the humans only.
--
-- GP IS SNAPSHOTTED, NOT DERIVED. Landed cost is a moving average and the
-- margin bands are editable, so recomputing an old margin from today's numbers
-- would answer a different question than the one asked. The cost and the band
-- in force at the moment of the change are copied onto the row, and the margin
-- is read back from those.
--
-- Applied 2026-08-29.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public."21.3_item_price_history" (
  history_id         uuid primary key default gen_random_uuid(),
  component_id       uuid not null references public."3.0_components"(component_id) on delete cascade,
  -- null = the item's NET price (3.0_components.selling_price_idr).
  -- set    = a per-tier override row (21.1_item_tier_prices).
  tier_id            uuid references public."21.0_price_tiers"(tier_id) on delete cascade,
  old_price_idr      numeric,
  new_price_idr      numeric,
  -- The economics AS THEY STOOD. See the note above.
  cost_idr           numeric,
  margin_profile_id  uuid references public."21.2_margin_profiles"(id) on delete set null,
  target_min_pct     numeric,
  target_max_pct     numeric,
  changed_at         timestamptz not null default now(),
  changed_by_email   text
);

comment on table public."21.3_item_price_history" is
  'Every selling-price change. Written by triggers so API writes are logged too.';
comment on column public."21.3_item_price_history".cost_idr is
  'Landed cost at the moment of the change — GP is read back from this, never recomputed from today''s cost.';

-- The only query this table serves: one item, newest first.
create index if not exists "21.3_item_price_history_component_idx"
  on public."21.3_item_price_history" (component_id, changed_at desc);

-- ── Who did it ───────────────────────────────────────────────────────────────
-- auth.uid() is null for a service-role write, so the email is best-effort and
-- the column is nullable. A null author is still a logged change.
create or replace function public.price_history_actor() returns text
language sql stable as $$
  select coalesce(
    (select email from public.user_profiles where id = auth.uid()),
    nullif(current_setting('request.jwt.claims', true)::json ->> 'email', '')
  );
$$;

-- ── The snapshot ─────────────────────────────────────────────────────────────
create or replace function public.log_price_change(
  p_component_id uuid, p_tier_id uuid, p_old numeric, p_new numeric
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cost numeric;
  v_profile uuid;
  v_min numeric;
  v_max numeric;
begin
  select max(avg_cost_idr) into v_cost
    from public."30.1_stock_balances" where component_id = p_component_id;
  select margin_profile_id into v_profile
    from public."3.0_components" where component_id = p_component_id;
  if v_profile is not null then
    select margin_target_min, margin_target_max into v_min, v_max
      from public."21.2_margin_profiles" where id = v_profile;
  end if;

  insert into public."21.3_item_price_history"
    (component_id, tier_id, old_price_idr, new_price_idr,
     cost_idr, margin_profile_id, target_min_pct, target_max_pct, changed_by_email)
  values
    (p_component_id, p_tier_id, p_old, p_new,
     nullif(v_cost, 0), v_profile, v_min, v_max, public.price_history_actor());
end;
$$;

-- ── The net price, on 3.0_components ─────────────────────────────────────────
create or replace function public.trg_log_component_price() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- `is distinct from` so a null → null re-save is not a change, and a first
  -- price (null → value) IS one.
  if new.selling_price_idr is distinct from old.selling_price_idr then
    perform public.log_price_change(new.component_id, null,
                                    old.selling_price_idr, new.selling_price_idr);
  end if;
  return new;
end;
$$;

drop trigger if exists log_component_price on public."3.0_components";
create trigger log_component_price
  after update of selling_price_idr on public."3.0_components"
  for each row execute function public.trg_log_component_price();

-- ── Tier overrides, on 21.1_item_tier_prices ─────────────────────────────────
-- Insert, update and delete: clearing an override changes what the tier sells
-- at just as much as setting one does, so it is logged with a null new price.
create or replace function public.trg_log_tier_price() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.log_price_change(old.component_id, old.tier_id, old.override_price_idr, null);
    return old;
  end if;
  if tg_op = 'INSERT' then
    perform public.log_price_change(new.component_id, new.tier_id, null, new.override_price_idr);
  elsif new.override_price_idr is distinct from old.override_price_idr then
    perform public.log_price_change(new.component_id, new.tier_id,
                                    old.override_price_idr, new.override_price_idr);
  end if;
  return new;
end;
$$;

drop trigger if exists log_tier_price on public."21.1_item_tier_prices";
create trigger log_tier_price
  after insert or update or delete on public."21.1_item_tier_prices"
  for each row execute function public.trg_log_tier_price();

-- ── Access ───────────────────────────────────────────────────────────────────
-- Readable by any signed-in user (it is the history of a price they can already
-- see); nobody writes it by hand — the triggers are the only author.
alter table public."21.3_item_price_history" enable row level security;

drop policy if exists "price history read" on public."21.3_item_price_history";
create policy "price history read" on public."21.3_item_price_history"
  for select to authenticated using (true);

-- Amount for this trip, one-time products and purchase history (spec 012, 2026-11-05).
-- Additive and safe to run more than once. The app from before spec 012 keeps
-- working after this runs: finish_trip(text, jsonb) keeps its signature and
-- now also writes history. Run it again after a rerun of 0001, since 0001
-- makes finish_trip again.

-- One-time products ---------------------------------------------------------
-- once_trip: the trip a one-time product goes on, or null for a regular product.

alter table public.items add column if not exists once_trip text;

alter table public.items
  drop constraint if exists items_once_trip_check,
  add constraint items_once_trip_check check (once_trip is null or once_trip ~ '^[a-z0-9-]{1,20}$');

grant insert (once_trip) on table public.items to authenticated;
grant update (once_trip) on table public.items to authenticated;

-- Amount for this trip --------------------------------------------------------
-- A row overrides the computed packs of one item on one trip, until that trip is finished.

create table if not exists public.trip_overrides (
  household_id uuid not null references public.households (id) on delete cascade,
  trip text not null,
  item_id uuid not null,
  packs integer not null,
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint trip_overrides_pkey primary key (household_id, trip, item_id),
  constraint trip_overrides_item_fkey foreign key (item_id, household_id)
    references public.items (id, household_id) on delete cascade
);

create index if not exists trip_overrides_item_idx on public.trip_overrides (item_id, household_id);

alter table public.trip_overrides
  drop constraint if exists trip_overrides_trip_check,
  add constraint trip_overrides_trip_check check (trip ~ '^[a-z0-9-]{1,20}$'),
  drop constraint if exists trip_overrides_packs_check,
  add constraint trip_overrides_packs_check check (packs between 1 and 99);

-- Removing a trip from settings.trips deletes its overrides.
create or replace function public.households_drop_trip_overrides()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.trip_overrides o
  where o.household_id = new.id
    and not exists (
      select 1 from jsonb_array_elements(new.settings -> 'trips') x where x ->> 'id' = o.trip
    );
  return null;
end;
$$;

drop trigger if exists households_trips_changed_overrides on public.households;
create trigger households_trips_changed_overrides
  after update of settings on public.households
  for each row
  when (old.settings -> 'trips' is distinct from new.settings -> 'trips')
  execute function public.households_drop_trip_overrides();

-- Sets (amount 1 to 99) or removes (amount null) the override of one item on one trip.
create or replace function public.set_trip_override(hid uuid, trip_id text, item uuid, amount integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if hid is null or not public.is_member(hid) then
    raise exception 'household not found';
  end if;
  if trip_id is null or not (trip_id ~ '^[a-z0-9-]{1,20}$') then
    raise exception 'invalid trip';
  end if;
  if amount is null then
    delete from public.trip_overrides o
    where o.household_id = hid and o.trip = trip_id and o.item_id = item;
    return;
  end if;
  if not (amount between 1 and 99) then
    raise exception 'invalid packs';
  end if;
  -- Same lock as ticks_check_trip: a settings change waits, or this sees the new trips.
  perform 1 from public.households h
  where h.id = hid
    and exists (select 1 from jsonb_array_elements(h.settings -> 'trips') t where t ->> 'id' = trip_id)
  for share of h;
  if not found then
    raise exception 'invalid trip';
  end if;
  if not exists (select 1 from public.items i where i.id = item and i.household_id = hid) then
    raise exception 'item not found';
  end if;
  insert into public.trip_overrides as o (household_id, trip, item_id, packs)
  values (hid, trip_id, item, amount)
  on conflict on constraint trip_overrides_pkey
  do update set packs = excluded.packs, updated_by = auth.uid(), updated_at = now();
end;
$$;

-- Purchase history ------------------------------------------------------------
-- Written only by finish_household_trip. Names, unit, store and price are
-- copied at that time, so history stays true after edits.

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  trip text not null,
  trip_name text,
  finished_by uuid references auth.users (id) on delete set null,
  finished_by_name text,
  finished_at timestamptz not null default now()
);

create index if not exists purchases_household_idx on public.purchases (household_id, finished_at desc);

create table if not exists public.purchase_lines (
  id bigint generated always as identity primary key,
  purchase_id uuid not null references public.purchases (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  item_id uuid,
  item_name text not null,
  packs numeric not null,
  units numeric not null,
  unit text not null default '',
  store_name text,
  price_each numeric
);

create index if not exists purchase_lines_purchase_idx on public.purchase_lines (purchase_id);
create index if not exists purchase_lines_household_idx on public.purchase_lines (household_id);

-- Finish a trip ---------------------------------------------------------------
-- lines: [{"item_id": "<uuid>", "delta": <units>, "packs": <packs, optional>}, ...]. All or nothing.
-- Regular items: stock + delta, ran_out cleared. One-time items: bought, so
-- active = false and ran_out cleared; stock does not change. Then the
-- trip's ticks and overrides are deleted. With lines, one purchase and its
-- lines are written.
create or replace function public.finish_household_trip(hid uuid, trip_id text, lines jsonb)
returns setof public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  line jsonb;
  d numeric;
  p numeric;
  result public.items;
  pid uuid;
  tname text;
  who text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if hid is null or not public.is_member(hid) then
    raise exception 'household not found';
  end if;
  if trip_id is null or not (trip_id ~ '^[a-z0-9-]{1,20}$') then
    raise exception 'invalid trip';
  end if;
  if jsonb_typeof(lines) is distinct from 'array' or jsonb_array_length(lines) > 500 then
    raise exception 'invalid lines';
  end if;
  perform 1 from public.households h
  where h.id = hid
    and exists (select 1 from jsonb_array_elements(h.settings -> 'trips') t where t ->> 'id' = trip_id)
  for share of h;
  if not found then
    raise exception 'invalid trip';
  end if;
  if jsonb_array_length(lines) > 0 then
    select t ->> 'name' into tname
    from public.households h, jsonb_array_elements(h.settings -> 'trips') t
    where h.id = hid and t ->> 'id' = trip_id;
    select nullif(split_part(coalesce(u.email, ''), '@', 1), '') into who
    from auth.users u where u.id = auth.uid();
    insert into public.purchases (household_id, trip, trip_name, finished_by, finished_by_name)
    values (hid, trip_id, tname, auth.uid(), who)
    returning id into pid;
  end if;
  for line in select value from jsonb_array_elements(lines) loop
    if jsonb_typeof(line) is distinct from 'object'
       or jsonb_typeof(line -> 'delta') is distinct from 'number'
       or jsonb_typeof(line -> 'item_id') is distinct from 'string'
       or (line ? 'packs' and jsonb_typeof(line -> 'packs') is distinct from 'number') then
      raise exception 'invalid line';
    end if;
    d := (line ->> 'delta')::numeric;
    if not (d between 0 and 100000) then
      raise exception 'invalid delta';
    end if;
    p := (line ->> 'packs')::numeric;
    if p is not null and not (p between 0 and 100000) then
      raise exception 'invalid packs';
    end if;
    update public.items i
    set stock = case when i.once_trip is null then least(100000, greatest(0, i.stock + d)) else i.stock end,
        ran_out = false,
        active = case when i.once_trip is null then i.active else false end
    where i.id = (line ->> 'item_id')::uuid and i.household_id = hid
    returning * into result;
    if not found then
      raise exception 'item not found';
    end if;
    insert into public.purchase_lines (purchase_id, household_id, item_id, item_name, packs, units, unit, store_name, price_each)
    values (
      pid, hid, result.id, result.name,
      coalesce(p, round(d / result.pack_size, 2)), d, result.unit,
      (select s.name from public.stores s where s.id = result.store_id),
      result.price
    );
    return next result;
  end loop;
  delete from public.ticks t where t.household_id = hid and t.trip = trip_id;
  delete from public.trip_overrides o where o.household_id = hid and o.trip = trip_id;
end;
$$;

-- Same signature as 0001, for app copies from before spec 012. The household
-- is the one of the first line. No lines: nothing changes, as before.
create or replace function public.finish_trip(trip text, lines jsonb)
returns setof public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if jsonb_typeof(lines) is distinct from 'array' then
    raise exception 'invalid lines';
  end if;
  if jsonb_array_length(lines) = 0 then
    return;
  end if;
  if jsonb_typeof(lines -> 0 -> 'item_id') is distinct from 'string' then
    raise exception 'invalid line';
  end if;
  select i.household_id into hid
  from public.items i
  where i.id = (lines -> 0 ->> 'item_id')::uuid and public.is_member(i.household_id);
  if not found then
    raise exception 'item not found';
  end if;
  return query select * from public.finish_household_trip(hid, finish_trip.trip, lines);
end;
$$;

-- Row Level Security ------------------------------------------------------------
-- Members read their household's rows. No insert, update or delete policies:
-- clients write only through the functions above.

alter table public.trip_overrides enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_lines enable row level security;

drop policy if exists trip_overrides_select on public.trip_overrides;
create policy trip_overrides_select on public.trip_overrides
  for select to authenticated using (public.is_member(household_id));

drop policy if exists purchases_select on public.purchases;
create policy purchases_select on public.purchases
  for select to authenticated using (public.is_member(household_id));

drop policy if exists purchase_lines_select on public.purchase_lines;
create policy purchase_lines_select on public.purchase_lines
  for select to authenticated using (public.is_member(household_id));

-- Table grants ----------------------------------------------------------------

revoke all on table public.trip_overrides, public.purchases, public.purchase_lines
  from public, anon, authenticated;

grant select on table public.trip_overrides, public.purchases, public.purchase_lines to authenticated;

-- Function grants -------------------------------------------------------------

revoke execute on function public.households_drop_trip_overrides() from public, anon, authenticated;
revoke execute on function public.set_trip_override(uuid, text, uuid, integer) from public, anon;
revoke execute on function public.finish_household_trip(uuid, text, jsonb) from public, anon;
revoke execute on function public.finish_trip(text, jsonb) from public, anon;

grant execute on function public.set_trip_override(uuid, text, uuid, integer) to authenticated;
grant execute on function public.finish_household_trip(uuid, text, jsonb) to authenticated;
grant execute on function public.finish_trip(text, jsonb) to authenticated;

-- Realtime --------------------------------------------------------------------
-- household_id is part of the trip_overrides key, so delete events can be
-- matched to a household with the default replica identity.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trip_overrides'
     ) then
    alter publication supabase_realtime add table public.trip_overrides;
  end if;
end;
$$;

-- 0001 init: households, members, stores, items, join attempts, ticks (specs 003, 007).
-- Safe to run more than once. Also upgrades a database that ran an older 0001.
-- Every function uses an empty search_path, so every name is schema-qualified.
-- pg_catalog (now, gen_random_uuid, greatest, ...) is always searched.

create extension if not exists pgcrypto with schema extensions;

-- Settings ----------------------------------------------------------------
-- Same value as DEFAULT_SETTINGS in src/domain/schedule.ts (a unit test compares them).

create or replace function public.default_settings()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select
    -- settings:start
    '{"trips":[{"id":"main","name":"קנייה גדולה","emoji":"🧺","day":2,"carries":["bulk","fresh"]},{"id":"shabbat","name":"קניית שבת","emoji":"🕯️","day":4,"carries":["fresh","shabbat"]},{"id":"friday","name":"קניית שישי","emoji":"🍞","day":5,"carries":["friday"]}],"cadenceLabels":{"bulk":"שבועי בכמות","fresh":"טרי","shabbat":"שבת","friday":"שישי"},"margin":0.1}'
    -- settings:end
    ::jsonb;
$$;

-- Shape and size of households.settings (spec 007), the same rules as
-- validateTrips in src/domain/schedule.ts: 1 to 7 trips, each with a slug id
-- (unique), a name, an emoji, a day 0-6 and at least one known cadence.
-- Optional cadenceLabels (short strings) and margin (0 to 0.5).
create or replace function public.valid_settings(s jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  t jsonb;
  v jsonb;
  ids text[] := '{}';
begin
  if jsonb_typeof(s) is distinct from 'object' or octet_length(s::text) > 4096 then
    return false;
  end if;
  if jsonb_typeof(s -> 'trips') is distinct from 'array'
     or not (jsonb_array_length(s -> 'trips') between 1 and 7) then
    return false;
  end if;
  for t in select value from jsonb_array_elements(s -> 'trips') loop
    if jsonb_typeof(t) is distinct from 'object'
       or jsonb_typeof(t -> 'id') is distinct from 'string'
       or not ((t ->> 'id') ~ '^[a-z0-9-]{1,20}$')
       or (t ->> 'id') = any (ids)
       or jsonb_typeof(t -> 'name') is distinct from 'string'
       or not (length(trim(t ->> 'name')) between 1 and 30)
       or jsonb_typeof(t -> 'emoji') is distinct from 'string'
       or length(t ->> 'emoji') > 16
       or jsonb_typeof(t -> 'day') is distinct from 'number'
       or (t ->> 'day') not in ('0', '1', '2', '3', '4', '5', '6')
       or jsonb_typeof(t -> 'carries') is distinct from 'array'
       or jsonb_array_length(t -> 'carries') < 1 then
      return false;
    end if;
    for v in select value from jsonb_array_elements(t -> 'carries') loop
      if jsonb_typeof(v) is distinct from 'string'
         or (v #>> '{}') not in ('bulk', 'fresh', 'shabbat', 'friday') then
        return false;
      end if;
    end loop;
    ids := ids || (t ->> 'id');
  end loop;
  if s ? 'cadenceLabels' then
    if jsonb_typeof(s -> 'cadenceLabels') is distinct from 'object' then
      return false;
    end if;
    for v in select value from jsonb_each(s -> 'cadenceLabels') loop
      if jsonb_typeof(v) is distinct from 'string' or length(v #>> '{}') > 20 then
        return false;
      end if;
    end loop;
  end if;
  if s ? 'margin' and (jsonb_typeof(s -> 'margin') is distinct from 'number'
                       or not ((s ->> 'margin')::numeric between 0 and 0.5)) then
    return false;
  end if;
  return true;
end;
$$;

-- Tables ---------------------------------------------------------------

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text not null unique,
  settings jsonb not null default public.default_settings(),
  created_at timestamptz not null default now()
);

alter table public.households
  add column if not exists created_by uuid references auth.users (id) on delete set null;

alter table public.households alter column settings set default public.default_settings();

create index if not exists households_created_by_idx on public.households (created_by);

-- Goes up by one on each save_settings, so a stale save is refused.
alter table public.households
  add column if not exists settings_version integer not null default 0;

create table if not exists public.members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index if not exists members_user_id_idx on public.members (user_id);

-- Stores of a household (spec 007). Archived, never deleted.
create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  emoji text not null default '',
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Name is unique per household (archived stores too), ignoring case and outer spaces.
create unique index if not exists stores_household_name_idx
  on public.stores (household_id, lower(trim(name)));
-- (id, household_id) is unique so an item can point at a store of its own household only.
create unique index if not exists stores_id_household_idx on public.stores (id, household_id);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  category text not null default '',
  cadence text not null,
  store_id uuid,
  weekly_use numeric not null default 0,
  unit text not null default '',
  pack_size numeric not null default 1,
  price numeric,
  stock numeric not null default 0,
  ran_out boolean not null default false,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Name is unique per household, ignoring case and outer spaces.
create unique index if not exists items_household_name_idx
  on public.items (household_id, lower(trim(name)));

-- Items point to a store of the same household, or to none (null).
alter table public.items add column if not exists store_id uuid;

alter table public.items
  drop constraint if exists items_store_fkey,
  add constraint items_store_fkey foreign key (store_id, household_id)
    references public.stores (id, household_id);

create index if not exists items_store_idx on public.items (store_id, household_id);

-- Upgrade: older versions kept the store as free text on each item. Make
-- one store per distinct name, point the items to it, drop the text column.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'items' and column_name = 'store'
  ) then
    insert into public.stores (household_id, name, sort)
    select d.household_id, d.name,
           (row_number() over (partition by d.household_id order by d.name) - 1)::integer
    from (
      select distinct on (i.household_id, lower(trim(i.store))) i.household_id, trim(i.store) as name
      from public.items i
      where trim(i.store) <> ''
      order by i.household_id, lower(trim(i.store))
    ) d
    on conflict do nothing;
    update public.items i
    set store_id = s.id
    from public.stores s
    where i.store_id is null and s.household_id = i.household_id
      and lower(trim(s.name)) = lower(trim(i.store));
    alter table public.items drop column store;
  end if;
end;
$$;

-- Upgrade: older settings had fixed trips with only days. They become the
-- default trips on the saved days, before the settings check below.
update public.households h
set settings = jsonb_build_object(
  'trips', (
    select jsonb_agg(
      case when (h.settings -> 'days' ->> (d.t ->> 'id')) in ('0', '1', '2', '3', '4', '5', '6')
                and jsonb_typeof(h.settings -> 'days' -> (d.t ->> 'id')) = 'number'
           then jsonb_set(d.t, '{day}', h.settings -> 'days' -> (d.t ->> 'id'))
           else d.t end
      order by d.n)
    from jsonb_array_elements(public.default_settings() -> 'trips') with ordinality as d (t, n)
  ),
  'cadenceLabels', public.default_settings() -> 'cadenceLabels',
  'margin', case when jsonb_typeof(h.settings -> 'margin') = 'number'
                      and (h.settings ->> 'margin')::numeric between 0 and 0.5
                 then h.settings -> 'margin'
                 else to_jsonb(0.1) end
)
where jsonb_typeof(h.settings -> 'trips') is distinct from 'array';

-- Failed join attempts, for the rate limit in join_household.
create table if not exists public.join_attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);

create index if not exists join_attempts_user_at_idx on public.join_attempts (user_id, at);

-- Shared ticks of the open trips. A row means "ticked"; untick deletes it.
-- (id, household_id) is unique so a tick can point at an item of its own
-- household only.
create unique index if not exists items_id_household_idx on public.items (id, household_id);

create table if not exists public.ticks (
  household_id uuid not null references public.households (id) on delete cascade,
  trip text not null,
  item_id uuid not null,
  ticked_by uuid default auth.uid() references auth.users (id) on delete set null,
  ticked_at timestamptz not null default now(),
  primary key (household_id, trip, item_id),
  constraint ticks_item_fkey foreign key (item_id, household_id)
    references public.items (id, household_id) on delete cascade
);

create index if not exists ticks_item_idx on public.ticks (item_id, household_id);

-- Checks ----------------------------------------------------------------
-- Named, so a re-run replaces them. `between` and `<=` are false for NaN.
-- Limits match src/domain/catalog.ts, stores.ts and schedule.ts.

alter table public.households
  drop constraint if exists households_name_check,
  add constraint households_name_check
    check (length(trim(name)) between 1 and 60),
  drop constraint if exists households_join_code_check,
  add constraint households_join_code_check
    check (join_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  drop constraint if exists households_settings_check,
  add constraint households_settings_check
    check (public.valid_settings(settings)),
  drop constraint if exists households_settings_version_check,
  add constraint households_settings_version_check
    check (settings_version >= 0);

alter table public.stores
  drop constraint if exists stores_name_check,
  add constraint stores_name_check check (length(trim(name)) between 1 and 40),
  drop constraint if exists stores_emoji_check,
  add constraint stores_emoji_check check (length(emoji) <= 16),
  drop constraint if exists stores_sort_check,
  add constraint stores_sort_check check (sort between 0 and 10000);

alter table public.items
  drop constraint if exists items_name_check,
  add constraint items_name_check check (length(trim(name)) between 1 and 60),
  drop constraint if exists items_category_check,
  add constraint items_category_check check (length(category) <= 40),
  drop constraint if exists items_store_check,
  drop constraint if exists items_unit_check,
  add constraint items_unit_check check (length(unit) <= 20),
  drop constraint if exists items_cadence_check,
  add constraint items_cadence_check check (cadence in ('bulk', 'fresh', 'shabbat', 'friday')),
  drop constraint if exists items_weekly_use_check,
  add constraint items_weekly_use_check check (weekly_use between 0 and 100000),
  drop constraint if exists items_pack_size_check,
  add constraint items_pack_size_check check (pack_size > 0 and pack_size <= 100000),
  drop constraint if exists items_price_check,
  add constraint items_price_check check (price is null or price between 0 and 100000),
  drop constraint if exists items_stock_check,
  add constraint items_stock_check check (stock between 0 and 100000);

alter table public.ticks
  drop constraint if exists ticks_trip_check,
  add constraint ticks_trip_check check (trip ~ '^[a-z0-9-]{1,20}$');

-- updated_at --------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists items_touch_updated_at on public.items;
create trigger items_touch_updated_at
  before update on public.items
  for each row execute function public.touch_updated_at();

-- Limits per household (spec 003) ------------------------------------------------
-- At most 50 active stores and 500 active items, and 200 stores and 2000 items
-- in all (archived stores and inactive items keep their rows). Checked on insert
-- and when a row becomes active again. A lock per household and table makes
-- parallel writes wait, so the count holds. Same numbers as src/domain.

create or replace function public.stores_check_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A caller who is not a member gets the row level security error instead.
  if tg_op = 'UPDATE' and (old.active or not new.active)
     or auth.uid() is not null and not public.is_member(new.household_id) then
    return new;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('stores:' || new.household_id::text));
  if tg_op = 'INSERT'
     and (select count(*) from public.stores s where s.household_id = new.household_id) >= 200 then
    raise exception 'store limit reached' using errcode = '23514';
  end if;
  if new.active
     and (select count(*) from public.stores s where s.household_id = new.household_id and s.active) >= 50 then
    raise exception 'store limit reached' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists stores_check_limit on public.stores;
create trigger stores_check_limit
  before insert or update of active on public.stores
  for each row execute function public.stores_check_limit();

create or replace function public.items_check_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A caller who is not a member gets the row level security error instead.
  if tg_op = 'UPDATE' and (old.active or not new.active)
     or auth.uid() is not null and not public.is_member(new.household_id) then
    return new;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('items:' || new.household_id::text));
  if tg_op = 'INSERT'
     and (select count(*) from public.items i where i.household_id = new.household_id) >= 2000 then
    raise exception 'item limit reached' using errcode = '23514';
  end if;
  if new.active
     and (select count(*) from public.items i where i.household_id = new.household_id and i.active) >= 500 then
    raise exception 'item limit reached' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists items_check_limit on public.items;
create trigger items_check_limit
  before insert or update of active on public.items
  for each row execute function public.items_check_limit();

-- A new item, or an item moved to another store, needs an active store of its
-- household. The store row is locked (share), so this waits for a parallel
-- archive_store and then sees the store archived. An item may keep the store
-- it already has after that store is archived.
create or replace function public.items_check_store()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.store_id is null or (tg_op = 'UPDATE' and new.store_id is not distinct from old.store_id)
     or auth.uid() is not null and not public.is_member(new.household_id) then
    return new;
  end if;
  perform 1 from public.stores s
  where s.id = new.store_id and s.household_id = new.household_id and s.active
  for share of s;
  if not found then
    raise exception 'store not active' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists items_check_store on public.items;
create trigger items_check_store
  before insert or update of store_id on public.items
  for each row execute function public.items_check_store();

-- Trips (spec 007) ------------------------------------------------------------

-- True when the household has a trip with this id in settings.trips.
create or replace function public.has_trip(hid uuid, trip_id text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.households h, jsonb_array_elements(h.settings -> 'trips') t
    where h.id = hid and t ->> 'id' = trip_id
  );
$$;

-- A tick needs a trip that is in the household's settings.trips.
-- The household row is locked (share), so a settings change waits for this
-- insert and then clears it, or this insert waits and sees the new trips.
create or replace function public.ticks_check_trip()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.households h
  where h.id = new.household_id
    and exists (select 1 from jsonb_array_elements(h.settings -> 'trips') t where t ->> 'id' = new.trip)
  for share of h;
  if not found then
    raise exception 'unknown trip' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists ticks_check_trip on public.ticks;
create trigger ticks_check_trip
  before insert or update on public.ticks
  for each row execute function public.ticks_check_trip();

-- Removing a trip from settings.trips deletes its ticks.
create or replace function public.households_drop_trip_ticks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.ticks t
  where t.household_id = new.id
    and not exists (
      select 1 from jsonb_array_elements(new.settings -> 'trips') x where x ->> 'id' = t.trip
    );
  return null;
end;
$$;

drop trigger if exists households_trips_changed on public.households;
create trigger households_trips_changed
  after update of settings on public.households
  for each row
  when (old.settings -> 'trips' is distinct from new.settings -> 'trips')
  execute function public.households_drop_trip_ticks();

-- Membership check --------------------------------------------------------
-- Security definer so policies on members do not call themselves.

create or replace function public.is_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.household_id = hid and m.user_id = auth.uid()
  );
$$;

-- Row Level Security --------------------------------------------------------

alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.stores enable row level security;
alter table public.items enable row level security;
alter table public.join_attempts enable row level security;
alter table public.ticks enable row level security;

drop policy if exists households_select on public.households;
create policy households_select on public.households
  for select to authenticated using (public.is_member(id));

drop policy if exists households_update on public.households;
create policy households_update on public.households
  for update to authenticated
  using (public.is_member(id)) with check (public.is_member(id));

drop policy if exists members_select on public.members;
create policy members_select on public.members
  for select to authenticated
  using (user_id = auth.uid() or public.is_member(household_id));

-- Stores: like items. Archived, never deleted.
drop policy if exists stores_select on public.stores;
create policy stores_select on public.stores
  for select to authenticated using (public.is_member(household_id));

drop policy if exists stores_insert on public.stores;
create policy stores_insert on public.stores
  for insert to authenticated with check (public.is_member(household_id));

drop policy if exists stores_update on public.stores;
create policy stores_update on public.stores
  for update to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));

drop policy if exists items_select on public.items;
create policy items_select on public.items
  for select to authenticated using (public.is_member(household_id));

drop policy if exists items_insert on public.items;
create policy items_insert on public.items
  for insert to authenticated with check (public.is_member(household_id));

drop policy if exists items_update on public.items;
create policy items_update on public.items
  for update to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));

-- Members tick and untick. ticked_by is always the caller.
drop policy if exists ticks_select on public.ticks;
create policy ticks_select on public.ticks
  for select to authenticated using (public.is_member(household_id));

drop policy if exists ticks_insert on public.ticks;
create policy ticks_insert on public.ticks
  for insert to authenticated
  with check (public.is_member(household_id) and ticked_by = auth.uid());

drop policy if exists ticks_delete on public.ticks;
create policy ticks_delete on public.ticks
  for delete to authenticated using (public.is_member(household_id));

-- join_attempts has no policies: clients can never read or write it.

-- Table grants ----------------------------------------------------------
-- Supabase grants everything to anon and authenticated by default.
-- Take it all back, then grant only what the app needs.
-- Households and members are written only by the functions below.
-- Items are deactivated and stores archived, never deleted. Clients cannot move an item to
-- another household. They change a household's name directly and its settings
-- only through save_settings (version check).
-- Stores are archived only by archive_store (which moves the items first) and
-- restored only by restore_store, so clients never write stores.active.
-- Inserts list their columns, so updated_at and created_at come from the defaults.
-- Ticks are never updated. Clients insert only the key columns, so
-- ticked_by and ticked_at always come from the defaults.

revoke all on table public.households, public.members, public.stores, public.items, public.join_attempts, public.ticks
  from public, anon, authenticated;

grant select on table public.households to authenticated;
grant update (name) on table public.households to authenticated;
grant select on table public.members to authenticated;
grant select on table public.stores to authenticated;
grant insert (id, household_id, name, emoji, sort) on table public.stores to authenticated;
grant update (name, emoji, sort) on table public.stores to authenticated;
grant select on table public.items to authenticated;
grant insert (id, household_id, name, category, cadence, store_id, weekly_use, unit, pack_size, price, stock, ran_out, active)
  on table public.items to authenticated;
grant update (name, category, cadence, store_id, weekly_use, unit, pack_size, price, stock, ran_out, active)
  on table public.items to authenticated;
grant select, delete on table public.ticks to authenticated;
grant insert (household_id, trip, item_id) on table public.ticks to authenticated;

-- Join code ---------------------------------------------------------------
-- 32 letters, so byte % 32 is uniform. No I, O, 0 or 1.

create or replace function public.new_join_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea;
  code text;
begin
  loop
    bytes := extensions.gen_random_bytes(8);
    code := '';
    for i in 0..7 loop
      code := code || substr(alphabet, 1 + (get_byte(bytes, i) % 32), 1);
    end loop;
    exit when not exists (select 1 from public.households h where h.join_code = code);
  end loop;
  return code;
end;
$$;

-- Seed stores and catalog -----------------------------------------------------
-- Same rows as src/domain/seed.ts (a unit test compares them).

create or replace function public.seed_stores(hid uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  insert into public.stores (household_id, name, emoji, sort)
  select hid, s.name, s.emoji, s.sort
  from (values
    -- stores:start
    ('סופר זול', '🏬', 0),
    ('סופר שכונתי', '🛒', 1),
    ('ירקן', '🥕', 2),
    ('קצביה', '🍗', 3),
    ('חנות דגים', '🐟', 4),
    ('מאפייה', '🍞', 5)
    -- stores:end
  ) as s (name, emoji, sort);
$$;

-- Items point to the seed store with their store name (run seed_stores first).
create or replace function public.seed_items(hid uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  insert into public.items (household_id, name, category, cadence, store_id, weekly_use, unit, pack_size, price)
  select hid, s.name, s.category, s.cadence, st.id, s.weekly_use, s.unit, s.pack_size, s.price
  from (values
    -- seed:start
    ('אורז', 'יבשים', 'bulk', 'סופר זול', 1, 'ק"ג', 1, 9),
    ('ביצים', 'מוצרי חלב', 'bulk', 'סופר זול', 12, 'ביצה', 30, 38),
    ('קמח', 'יבשים', 'bulk', 'סופר זול', 1, 'ק"ג', 1, 5),
    ('תה', 'יבשים', 'bulk', 'סופר זול', 10, 'שקיק', 25, 12),
    ('תבלינים', 'יבשים', 'bulk', 'סופר זול', 0.25, 'אריזה', 1, 10),
    ('חמוצים', 'רטבים ושימורים', 'bulk', 'סופר זול', 0.5, 'צנצנת', 1, 12),
    ('מיונז', 'רטבים ושימורים', 'bulk', 'סופר זול', 0.25, 'צנצנת', 1, 14),
    ('קטשופ', 'רטבים ושימורים', 'bulk', 'סופר זול', 0.25, 'בקבוק', 1, 12),
    ('נייר טואלט', 'בית וניקיון', 'bulk', 'סופר זול', 6, 'גליל', 32, 45),
    ('מגבונים', 'תינוק', 'bulk', 'סופר זול', 2, 'חבילה', 1, 8),
    ('חיתולים', 'תינוק', 'bulk', 'סופר זול', 35, 'חיתול', 44, 60),
    ('חלב', 'מוצרי חלב', 'fresh', 'סופר שכונתי', 4, 'ליטר', 1, 7),
    ('גבינה', 'מוצרי חלב', 'fresh', 'סופר שכונתי', 2, 'גביע', 1, 6),
    ('יוגורט', 'מוצרי חלב', 'fresh', 'סופר שכונתי', 6, 'גביע', 1, 4),
    ('פירות', 'פירות וירקות', 'fresh', 'ירקן', 4, 'ק"ג', 1, null),
    ('ירקות', 'פירות וירקות', 'fresh', 'ירקן', 5, 'ק"ג', 1, null),
    ('עוף', 'בשר ועוף', 'shabbat', 'קצביה', 1.5, 'ק"ג', 1, 35),
    ('דניס', 'דגים', 'shabbat', 'חנות דגים', 2, 'דג', 1, 25),
    ('סלמון', 'דגים', 'fresh', 'חנות דגים', 0.5, 'ק"ג', 0.5, 45),
    ('אמנון', 'דגים', 'fresh', 'חנות דגים', 1, 'דג', 1, 18),
    ('טילפיה', 'דגים', 'fresh', 'חנות דגים', 1, 'דג', 1, 15),
    ('חלה', 'שבת', 'friday', 'מאפייה', 2, 'חלה', 1, 12),
    ('מיץ ענבים', 'שבת', 'shabbat', 'סופר שכונתי', 1, 'בקבוק', 1, 15),
    ('יין לבן', 'שבת', 'shabbat', 'סופר שכונתי', 1, 'בקבוק', 1, 35)
    -- seed:end
  ) as s (name, category, cadence, store, weekly_use, unit, pack_size, price)
  left join public.stores st on st.household_id = hid and st.name = s.store;
$$;

-- Households --------------------------------------------------------------
-- Older versions returned a row; drop them so the return type can change.

drop function if exists public.create_household(text);
drop function if exists public.join_household(text);

-- Creates the household with the default trips, the membership, the seed
-- stores and the seed catalog in one transaction. A user can create at most 5 households.
create or replace function public.create_household(household_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  hid uuid;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  -- One create at a time per user, so the cap holds under parallel calls.
  perform pg_advisory_xact_lock(hashtext('create_household:' || uid::text));
  if (select count(*) from public.households h where h.created_by = uid) >= 5 then
    raise exception 'household limit reached';
  end if;
  insert into public.households (name, join_code, created_by, settings)
  values (trim(household_name), public.new_join_code(), uid, public.default_settings())
  returning id into hid;
  insert into public.members (household_id, user_id) values (hid, uid);
  perform public.seed_stores(hid);
  perform public.seed_items(hid);
  return hid;
end;
$$;

-- Returns the household id, or null when the code is wrong or the user
-- has 10 failed attempts in the last hour. Never says which.
create or replace function public.join_household(code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  hid uuid;
  clean text := upper(trim(coalesce(code, '')));
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  -- One join at a time per user, so parallel calls cannot pass the limit.
  perform pg_advisory_xact_lock(hashtext('join_household:' || uid::text));
  delete from public.join_attempts a
  where a.user_id = uid and a.at < now() - interval '1 day';
  if (select count(*) from public.join_attempts a
      where a.user_id = uid and a.at > now() - interval '1 hour') >= 10 then
    return null;
  end if;
  if clean ~ '^[A-HJ-NP-Z2-9]{8}$' then
    select h.id into hid from public.households h where h.join_code = clean;
  end if;
  if hid is null then
    insert into public.join_attempts (user_id) values (uid);
    return null;
  end if;
  insert into public.members (household_id, user_id)
  values (hid, uid)
  on conflict do nothing;
  return hid;
end;
$$;

-- New join code for a household the user belongs to. The old code stops working.
create or replace function public.rotate_join_code(hid uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_code text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if not public.is_member(hid) then
    raise exception 'not a member';
  end if;
  new_code := public.new_join_code();
  update public.households h set join_code = new_code where h.id = hid;
  return new_code;
end;
$$;

-- Leaves a household. The last member to leave deletes it with its items.
create or replace function public.leave_household(hid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if not public.is_member(hid) then
    raise exception 'not a member';
  end if;
  -- Lock the household row, so two last members leaving at the same time
  -- run one after the other and the second one deletes the household.
  perform 1 from public.households h where h.id = hid for update;
  delete from public.members m where m.household_id = hid and m.user_id = uid;
  if not found then
    raise exception 'not a member';
  end if;
  if not exists (select 1 from public.members m where m.household_id = hid) then
    delete from public.households h where h.id = hid;
  end if;
end;
$$;

-- Settings ------------------------------------------------------------------
-- Saves settings only when expected_version is the stored version, then adds
-- one to it. Returns the new version, or null when the settings changed on
-- another device in the meantime (the client reloads them). The row is locked,
-- so two saves run one after the other. The settings check and the trigger
-- that deletes the ticks of a removed trip still run.
create or replace function public.save_settings(hid uuid, settings jsonb, expected_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_version integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if not public.is_member(hid) then
    raise exception 'not a member';
  end if;
  select h.settings_version into current_version
  from public.households h where h.id = hid
  for update;
  if not found then
    raise exception 'not a member';
  end if;
  if expected_version is distinct from current_version then
    return null;
  end if;
  update public.households h
  set settings = save_settings.settings,
      settings_version = current_version + 1
  where h.id = hid;
  return current_version + 1;
end;
$$;

-- Stock -------------------------------------------------------------------
-- Stock changes are relative and run on the server, so two phones that
-- change stock at the same time both count. Stock stays in 0..100000.

create or replace function public.adjust_stock(item_id uuid, delta numeric)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.items;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if delta is null or not (delta between -100000 and 100000) then
    raise exception 'invalid delta';
  end if;
  update public.items i
  set stock = least(100000, greatest(0, i.stock + delta)),
      ran_out = case when delta > 0 then false else i.ran_out end
  where i.id = item_id and public.is_member(i.household_id)
  returning * into result;
  if not found then
    raise exception 'item not found';
  end if;
  return result;
end;
$$;

-- Older versions took only the lines; drop them so the signature can change.
drop function if exists public.finish_trip(jsonb);

-- lines: [{"item_id": "<uuid>", "delta": <number>}, ...]. All or nothing.
-- Adds the bought units to stock, clears ran_out, and deletes the ticks of
-- this trip in the households of those items, in the same transaction.
-- The trip must be in the settings.trips of every household it touches.
create or replace function public.finish_trip(trip text, lines jsonb)
returns setof public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  line jsonb;
  d numeric;
  result public.items;
  hids uuid[] := '{}';
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if finish_trip.trip is null or not (finish_trip.trip ~ '^[a-z0-9-]{1,20}$') then
    raise exception 'invalid trip';
  end if;
  if jsonb_typeof(lines) is distinct from 'array' or jsonb_array_length(lines) > 500 then
    raise exception 'invalid lines';
  end if;
  for line in select value from jsonb_array_elements(lines) loop
    if jsonb_typeof(line) is distinct from 'object'
       or jsonb_typeof(line -> 'delta') is distinct from 'number'
       or jsonb_typeof(line -> 'item_id') is distinct from 'string' then
      raise exception 'invalid line';
    end if;
    d := (line ->> 'delta')::numeric;
    if not (d between 0 and 100000) then
      raise exception 'invalid delta';
    end if;
    update public.items i
    set stock = least(100000, greatest(0, i.stock + d)),
        ran_out = false
    where i.id = (line ->> 'item_id')::uuid and public.is_member(i.household_id)
    returning * into result;
    if not found then
      raise exception 'item not found';
    end if;
    if not result.household_id = any (hids) then
      if not public.has_trip(result.household_id, finish_trip.trip) then
        raise exception 'invalid trip';
      end if;
      hids := hids || result.household_id;
    end if;
    return next result;
  end loop;
  delete from public.ticks t
  where t.trip = finish_trip.trip and t.household_id = any (hids);
end;
$$;

-- Stores (spec 007) -------------------------------------------------------------

-- Moves every item of a store to another active store of the same household
-- (or to no store, when move_to_store_id is null), then archives the store.
-- One transaction. Returns the moved items.
create or replace function public.archive_store(store_id uuid, move_to_store_id uuid)
returns setof public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  src public.stores;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  select * into src from public.stores s
  where s.id = archive_store.store_id and public.is_member(s.household_id)
  for update;
  if not found then
    raise exception 'store not found';
  end if;
  if move_to_store_id is not null and (
       move_to_store_id = src.id
       or not exists (
         select 1 from public.stores s
         where s.id = move_to_store_id and s.household_id = src.household_id and s.active
       )) then
    raise exception 'invalid target store';
  end if;
  return query
    update public.items i
    set store_id = move_to_store_id
    where i.household_id = src.household_id and i.store_id = src.id
    returning i.*;
  update public.stores s set active = false where s.id = src.id;
end;
$$;

-- Makes an archived store active again. The store limit applies.
create or replace function public.restore_store(store_id uuid)
returns public.stores
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.stores;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  update public.stores s
  set active = true
  where s.id = restore_store.store_id and public.is_member(s.household_id)
  returning * into result;
  if not found then
    raise exception 'store not found';
  end if;
  return result;
end;
$$;

-- Sets sort = 0, 1, 2, ... for the stores in store_ids order, all or nothing.
-- Every id must be a store of a household of the caller, listed once.
create or replace function public.reorder_stores(store_ids uuid[])
returns setof public.stores
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if store_ids is null or cardinality(store_ids) > 200 then
    raise exception 'invalid store order';
  end if;
  return query
    update public.stores s
    set sort = (o.n - 1)::integer
    from unnest(store_ids) with ordinality as o (id, n)
    where s.id = o.id and public.is_member(s.household_id)
    returning s.*;
  get diagnostics changed = row_count;
  if changed <> cardinality(store_ids) then
    raise exception 'invalid store order';
  end if;
end;
$$;

-- Function grants -----------------------------------------------------------
-- Supabase grants EXECUTE on new functions to anon and authenticated.
-- Internal helpers: nobody. Policies call is_member as authenticated.

revoke execute on function public.touch_updated_at() from public, anon, authenticated;
revoke execute on function public.new_join_code() from public, anon, authenticated;
revoke execute on function public.seed_items(uuid) from public, anon, authenticated;
revoke execute on function public.seed_stores(uuid) from public, anon, authenticated;
revoke execute on function public.default_settings() from public, anon, authenticated;
revoke execute on function public.has_trip(uuid, text) from public, anon, authenticated;
revoke execute on function public.ticks_check_trip() from public, anon, authenticated;
revoke execute on function public.households_drop_trip_ticks() from public, anon, authenticated;
revoke execute on function public.stores_check_limit() from public, anon, authenticated;
revoke execute on function public.items_check_limit() from public, anon, authenticated;
revoke execute on function public.items_check_store() from public, anon, authenticated;
-- The settings check runs as the caller, so members need valid_settings.
revoke execute on function public.valid_settings(jsonb) from public, anon;
revoke execute on function public.archive_store(uuid, uuid) from public, anon;
revoke execute on function public.restore_store(uuid) from public, anon;
revoke execute on function public.reorder_stores(uuid[]) from public, anon;
revoke execute on function public.is_member(uuid) from public, anon;
revoke execute on function public.create_household(text) from public, anon;
revoke execute on function public.join_household(text) from public, anon;
revoke execute on function public.rotate_join_code(uuid) from public, anon;
revoke execute on function public.leave_household(uuid) from public, anon;
revoke execute on function public.adjust_stock(uuid, numeric) from public, anon;
revoke execute on function public.finish_trip(text, jsonb) from public, anon;
revoke execute on function public.save_settings(uuid, jsonb, integer) from public, anon;

grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.join_household(text) to authenticated;
grant execute on function public.rotate_join_code(uuid) to authenticated;
grant execute on function public.leave_household(uuid) to authenticated;
grant execute on function public.adjust_stock(uuid, numeric) to authenticated;
grant execute on function public.finish_trip(text, jsonb) to authenticated;
grant execute on function public.save_settings(uuid, jsonb, integer) to authenticated;
grant execute on function public.valid_settings(jsonb) to authenticated;
grant execute on function public.archive_store(uuid, uuid) to authenticated;
grant execute on function public.restore_store(uuid) to authenticated;
grant execute on function public.reorder_stores(uuid[]) to authenticated;

-- Realtime ------------------------------------------------------------------
-- Delete events under RLS carry only the primary key. household_id is part
-- of the ticks key, so the default replica identity is enough to tell the
-- household of an untick. households is here for live settings; members
-- receive only their own households (households_select).

do $$
declare
  t text;
begin
  foreach t in array array['households', 'stores', 'items', 'ticks'] loop
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (
         select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
       ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

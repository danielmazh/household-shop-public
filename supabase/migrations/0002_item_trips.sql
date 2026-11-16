-- Each product says on which trips it is bought (2026-11-03).
-- Users found the four product types unclear. A product now lists trip ids
-- directly. `cadence` stays for app copies cached before this change.

alter table public.items add column if not exists trips text[];

-- 0 to 7 trip ids, each a trip slug (same rule as valid_settings).
alter table public.items
  drop constraint if exists items_trips_check,
  add constraint items_trips_check check (
    trips is null
    or cardinality(trips) = 0
    or (cardinality(trips) <= 7 and array_to_string(trips, ',') ~ '^[a-z0-9-]{1,20}(,[a-z0-9-]{1,20})*$')
  );

-- The trips of the household that carry this cadence, in list order.
create or replace function public.trips_for_cadence(hid uuid, cad text)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(x.t ->> 'id' order by x.n), '{}')
  from public.households h,
       jsonb_array_elements(h.settings -> 'trips') with ordinality as x (t, n)
  where h.id = hid and (x.t -> 'carries') ? cad;
$$;

-- A row without trips (seed rows, older app copies) gets them from its cadence.
create or replace function public.items_fill_trips()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.trips is null then
    new.trips := public.trips_for_cadence(new.household_id, new.cadence);
  end if;
  return new;
end;
$$;

drop trigger if exists items_fill_trips on public.items;
create trigger items_fill_trips
  before insert on public.items
  for each row execute function public.items_fill_trips();

update public.items i
set trips = public.trips_for_cadence(i.household_id, i.cadence)
where i.trips is null;

grant insert (trips) on table public.items to authenticated;
grant update (trips) on table public.items to authenticated;

-- Called from the items trigger as the signed-in user; it reads settings under RLS.
revoke execute on function public.trips_for_cadence(uuid, text) from public, anon;
grant execute on function public.trips_for_cadence(uuid, text) to authenticated;
revoke execute on function public.items_fill_trips() from public, anon, authenticated;

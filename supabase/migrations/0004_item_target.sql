-- Keep at home (spec 009, 2026-11-04). Each product keeps `target` units at
-- home; the list fills stock up to it. Replaces weekly use plus margin in the UI.

alter table public.items add column if not exists target numeric;

alter table public.items
  drop constraint if exists items_target_check,
  add constraint items_target_check check (target is null or (target >= 0 and target <= 100000));

-- The old per-trip need, rounded up to whole packs, at least one pack.
-- Same rule as defaultTarget in src/domain/planner.ts.
create or replace function public.default_target(hid uuid, item_trips text[], weekly numeric, pack numeric)
returns numeric
language sql
stable
set search_path = ''
as $$
  select pack * greatest(1, ceil(
    weekly * (1 + coalesce((h.settings ->> 'margin')::numeric, 0.1))
    / greatest(1, coalesce((
        select sum(coalesce(jsonb_array_length(t -> 'days'), 1))
        from jsonb_array_elements(h.settings -> 'trips') as t
        where t ->> 'id' = any (item_trips)
      ), 0))
    / pack - 0.000000001))
  from public.households h
  where h.id = hid;
$$;

-- A row without target (older app copies) gets one. Runs after items_fill_trips
-- (triggers fire in name order), so the trips are already set.
create or replace function public.items_fill_target()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.target is null then
    new.target := public.default_target(new.household_id, new.trips, new.weekly_use, new.pack_size);
  end if;
  return new;
end;
$$;

drop trigger if exists items_fill_trips_target on public.items;
create trigger items_fill_trips_target
  before insert on public.items
  for each row execute function public.items_fill_target();

update public.items i
set target = public.default_target(i.household_id, i.trips, i.weekly_use, i.pack_size)
where i.target is null;

grant insert (target) on table public.items to authenticated;
grant update (target) on table public.items to authenticated;

revoke execute on function public.default_target(uuid, text[], numeric, numeric) from public, anon;
grant execute on function public.default_target(uuid, text[], numeric, numeric) to authenticated;
revoke execute on function public.items_fill_target() from public, anon, authenticated;

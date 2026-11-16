-- Spec 013 checks: a new household gets role stores, roleStores and 56 linked products.
\set ON_ERROR_STOP 1
insert into auth.users values ('33333333-3333-3333-3333-333333333333','new@example.com') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select public.create_household('He home') as he_hid \gset
select public.create_household('En home', 'en') as en_hid \gset
do $$
declare h record;
begin
  for h in select * from public.households where created_by = auth.uid() loop
    assert (select count(*) from public.stores s where s.household_id = h.id) = 4, 'not 4 stores';
    assert (select count(*) from jsonb_object_keys(h.settings -> 'roleStores')) = 4, 'roleStores not set';
    assert (select count(*) from public.items i where i.household_id = h.id) = 56, 'not 56 items';
    assert (select count(*) from public.items i where i.household_id = h.id and (i.store_id is null or i.price is not null)) = 0, 'item without store or with a price';
    assert (select count(*) from public.items i where i.household_id = h.id and cardinality(i.trips) <> 1) = 0, 'item not on one trip';
    assert public.valid_settings(h.settings), 'settings not valid';
  end loop;
  assert (select count(*) from public.items i join public.stores s on s.id = i.store_id
          where s.name = 'מאפייה' and i.name = 'חלה' and i.trips = '{friday}') = 1, 'challah not on bakery and friday';
  assert (select count(*) from public.stores s where s.name = 'Butcher and fish') = 1, 'English store missing';
end $$;
reset role;
select h.name, count(i.*) as items, h.settings -> 'roleStores' is not null as has_roles
from public.households h join public.items i on i.household_id = h.id
where h.created_by = '33333333-3333-3333-3333-333333333333' group by h.id order by h.name;

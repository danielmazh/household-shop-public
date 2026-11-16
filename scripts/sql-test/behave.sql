-- Spec 012 checks as a signed-in member, another user and anon. Any failed check stops the run.
\set ON_ERROR_STOP 1
insert into auth.users values ('11111111-1111-1111-1111-111111111111','dana@example.com'),('22222222-2222-2222-2222-222222222222','eve@example.com');
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select public.create_household('Test') as hid \gset
select id as milk from public.items where household_id = :'hid' order by name limit 1 \gset
select id as egg from public.items where household_id = :'hid' order by name offset 1 limit 1 \gset
-- override
select public.set_trip_override(:'hid', 'main', :'milk', 5);
select public.set_trip_override(:'hid', 'main', :'milk', 7);
select packs from public.trip_overrides;
-- once item
update public.items set once_trip = 'main', trips = '{main}' where id = :'egg';
-- client cannot write tables directly
do $$ begin
  begin insert into public.purchases (household_id, trip) select household_id, 'main' from public.items limit 1; raise exception 'insert purchases allowed'; exception when insufficient_privilege then null; end;
  begin delete from public.trip_overrides; raise exception 'delete overrides allowed'; exception when insufficient_privilege then null; end;
  begin insert into public.trip_overrides (household_id, trip, item_id, packs) select household_id, 'main', id, 3 from public.items limit 1; raise exception 'insert overrides allowed'; exception when insufficient_privilege then null; end;
end $$;
-- new finish
select name, active, stock from public.finish_household_trip(:'hid', 'main', jsonb_build_array(jsonb_build_object('item_id', :'milk', 'delta', 2, 'packs', 2), jsonb_build_object('item_id', :'egg', 'delta', 12, 'packs', 1)));
select count(*) as overrides_left from public.trip_overrides;
do $$ begin
  assert (select count(*) from public.trip_overrides) = 0, 'finish keeps overrides';
  assert (select count(*) from public.items where once_trip is not null and active) = 0, 'one-time item still active';
  assert (select count(*) from public.purchase_lines) = 2, 'purchase lines missing';
  assert (select finished_by_name from public.purchases) = 'dana', 'finished_by_name wrong';
end $$;
select trip, trip_name, finished_by_name from public.purchases;
select item_name, packs, units, store_name, price_each from public.purchase_lines order by item_name;
-- old finish (no packs)
select name, stock from public.finish_trip('main', jsonb_build_array(jsonb_build_object('item_id', :'milk', 'delta', 1)));
select count(*) as purchases from public.purchases;
do $$ begin assert (select count(*) from public.purchases) = 2, 'old finish_trip wrote no history'; end $$;
select count(*) from public.finish_trip('main', '[]'::jsonb);
-- finish with no lines clears overrides, writes no purchase
select public.set_trip_override(:'hid', 'main', :'milk', 3);
select count(*) from public.finish_household_trip(:'hid', 'main', '[]'::jsonb);
select count(*) as overrides_after_empty, (select count(*) from public.purchases) as purchases from public.trip_overrides;
-- removing a trip from settings clears its overrides
select public.set_trip_override(:'hid', 'friday', :'milk', 3);
-- other user sees nothing and cannot write
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select count(*) as other_sees from public.purchases;
do $$ begin assert (select count(*) from public.purchases) = 0, 'other user reads history'; end $$;
do $$ begin
  begin perform public.set_trip_override((select id from public.households limit 1), 'main', null, 2); raise exception 'other allowed'; exception when raise_exception then if sqlerrm <> 'household not found' then raise; end if; end;
end $$;
reset role;
set role anon;
do $$ begin
  begin perform count(*) from public.purchases; raise exception 'anon read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.set_trip_override(null, 'main', null, 1); raise exception 'anon exec allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.households set settings = jsonb_set(settings, '{trips}', (select jsonb_agg(t) from jsonb_array_elements(settings->'trips') t where t->>'id' <> 'friday'));
select count(*) as friday_overrides from public.trip_overrides where trip = 'friday';
do $$ begin assert (select count(*) from public.trip_overrides where trip = 'friday') = 0, 'removed trip keeps overrides'; end $$;

-- English base data (spec 011, 2026-11-04).
-- create_household gets `lang` (default 'he'). 'en' seeds English settings,
-- stores and products; any other value seeds Hebrew, as before. Existing
-- households do not change. Calls without `lang` (app copies from before
-- spec 011) work as before. Safe to run more than once. Run it again after
-- a rerun of 0001, since 0001 makes create_household(text) again.

-- Same value as defaultSettings('en') in src/domain/schedule.ts (a unit test compares them).
create or replace function public.default_settings(lang text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when lang = 'en' then
    -- settings-en:start
    '{"trips":[{"id":"main","name":"Big shop","emoji":"🧺","day":2,"carries":["bulk","fresh"]},{"id":"shabbat","name":"Weekend","emoji":"🛒","day":4,"carries":["fresh","shabbat"]},{"id":"friday","name":"Bakery","emoji":"🍞","day":5,"carries":["friday"]}],"cadenceLabels":{"bulk":"Weekly bulk","fresh":"Fresh","shabbat":"Weekend","friday":"Friday"},"margin":0.1}'
    -- settings-en:end
    ::jsonb
  else public.default_settings() end;
$$;

-- Same rows as the English stores in src/domain/seed.ts (a unit test compares them).
create or replace function public.seed_stores(hid uuid, lang text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  if lang is distinct from 'en' then
    perform public.seed_stores(hid);
    return;
  end if;
  insert into public.stores (household_id, name, emoji, sort)
  select hid, s.name, s.emoji, s.sort
  from (values
    -- stores-en:start
    ('Discount store', '🏬', 0),
    ('Local market', '🛒', 1),
    ('Greengrocer', '🥕', 2),
    ('Butcher', '🍗', 3),
    ('Fish shop', '🐟', 4),
    ('Bakery', '🍞', 5)
    -- stores-en:end
  ) as s (name, emoji, sort);
end;
$$;

-- Items point to the seed store with their store name (run seed_stores first).
create or replace function public.seed_items(hid uuid, lang text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  if lang is distinct from 'en' then
    perform public.seed_items(hid);
    return;
  end if;
  insert into public.items (household_id, name, category, cadence, store_id, weekly_use, unit, pack_size, price)
  select hid, s.name, s.category, s.cadence, st.id, s.weekly_use, s.unit, s.pack_size, s.price
  from (values
    -- seed-en:start
    ('Rice', 'Dry goods', 'bulk', 'Discount store', 1, 'kg', 1, 9),
    ('Eggs', 'Dairy', 'bulk', 'Discount store', 12, 'egg', 30, 38),
    ('Flour', 'Dry goods', 'bulk', 'Discount store', 1, 'kg', 1, 5),
    ('Tea', 'Dry goods', 'bulk', 'Discount store', 10, 'tea bag', 25, 12),
    ('Spices', 'Dry goods', 'bulk', 'Discount store', 0.25, 'pack', 1, 10),
    ('Pickles', 'Sauces and cans', 'bulk', 'Discount store', 0.5, 'jar', 1, 12),
    ('Mayonnaise', 'Sauces and cans', 'bulk', 'Discount store', 0.25, 'jar', 1, 14),
    ('Ketchup', 'Sauces and cans', 'bulk', 'Discount store', 0.25, 'bottle', 1, 12),
    ('Toilet paper', 'Home and cleaning', 'bulk', 'Discount store', 6, 'roll', 32, 45),
    ('Wet wipes', 'Baby', 'bulk', 'Discount store', 2, 'pack', 1, 8),
    ('Diapers', 'Baby', 'bulk', 'Discount store', 35, 'diaper', 44, 60),
    ('Milk', 'Dairy', 'fresh', 'Local market', 4, 'liter', 1, 7),
    ('Cheese', 'Dairy', 'fresh', 'Local market', 2, 'cup', 1, 6),
    ('Yogurt', 'Dairy', 'fresh', 'Local market', 6, 'cup', 1, 4),
    ('Fruit', 'Fruit and veg', 'fresh', 'Greengrocer', 4, 'kg', 1, null),
    ('Vegetables', 'Fruit and veg', 'fresh', 'Greengrocer', 5, 'kg', 1, null),
    ('Chicken', 'Meat and chicken', 'shabbat', 'Butcher', 1.5, 'kg', 1, 35),
    ('Sea bream', 'Fish', 'shabbat', 'Fish shop', 2, 'fish', 1, 25),
    ('Salmon', 'Fish', 'fresh', 'Fish shop', 0.5, 'kg', 0.5, 45),
    ('Sea bass', 'Fish', 'fresh', 'Fish shop', 1, 'fish', 1, 18),
    ('Tilapia', 'Fish', 'fresh', 'Fish shop', 1, 'fish', 1, 15),
    ('Bread', 'Weekend', 'friday', 'Bakery', 2, 'loaf', 1, 12),
    ('Grape juice', 'Weekend', 'shabbat', 'Local market', 1, 'bottle', 1, 15),
    ('White wine', 'Weekend', 'shabbat', 'Local market', 1, 'bottle', 1, 35)
    -- seed-en:end
  ) as s (name, category, cadence, store, weekly_use, unit, pack_size, price)
  left join public.stores st on st.household_id = hid and st.name = s.store;
end;
$$;

-- The one-argument version is replaced. A call with only household_name
-- gets lang 'he' from the default, so the live app keeps working.
drop function if exists public.create_household(text);

-- Same as 0001, plus the language of the seed. A user can create at most 5 households.
create or replace function public.create_household(household_name text, lang text default 'he')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  hid uuid;
  seed_lang text := case when lang = 'en' then 'en' else 'he' end;
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
  values (trim(household_name), public.new_join_code(), uid, public.default_settings(seed_lang))
  returning id into hid;
  insert into public.members (household_id, user_id) values (hid, uid);
  perform public.seed_stores(hid, seed_lang);
  perform public.seed_items(hid, seed_lang);
  return hid;
end;
$$;

revoke execute on function public.default_settings(text) from public, anon, authenticated;
revoke execute on function public.seed_stores(uuid, text) from public, anon, authenticated;
revoke execute on function public.seed_items(uuid, text) from public, anon, authenticated;
revoke execute on function public.create_household(text, text) from public, anon;
grant execute on function public.create_household(text, text) to authenticated;

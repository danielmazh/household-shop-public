-- Role stores and a bigger default product list (spec 013, 2026-11-07).
-- New households get four role stores with placeholder names, set as their
-- role stores in settings.roleStores, and 56 products without prices, each
-- on the role store of its category. Existing households do not change.
-- Safe to run more than once. Run after 0006, and again after a rerun of
-- 0001 or 0005, since those make create_household again.

-- Role stores: role, Hebrew name, English name, emoji, sort.
-- Same rows as ROLE_STORES in src/domain/seed.ts (a unit test compares them).
create or replace function public.seed_role_stores(lang text)
returns table (role text, name text, emoji text, sort integer)
language sql
immutable
set search_path = ''
as $$
  select r.role, case when lang = 'en' then r.en else r.he end, r.emoji, r.sort
  from (values
    -- role-stores:start
    ('dry', 'חנות יבשים', 'Grocery', '🏬', 0),
    ('produce', 'ירקן', 'Greengrocer', '🥕', 1),
    ('meat', 'קצב ודגים', 'Butcher and fish', '🍗', 2),
    ('bakery', 'מאפייה', 'Bakery', '🍞', 3)
    -- role-stores:end
  ) as r (role, he, en, emoji, sort);
$$;

create or replace function public.seed_stores_v2(hid uuid, lang text)
returns void
language sql
volatile
set search_path = ''
as $$
  insert into public.stores (household_id, name, emoji, sort)
  select hid, r.name, r.emoji, r.sort from public.seed_role_stores(lang) r;
$$;

-- Products on the role store of their category (run seed_stores_v2 first).
-- The cadence puts them on a trip: shabbat for produce and meat, friday for
-- bakery, bulk (main) for the rest; items_fill_trips turns it into trips.
-- Same rows as PRODUCTS in src/domain/seed.ts (a unit test compares them).
create or replace function public.seed_items_v2(hid uuid, lang text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  insert into public.items (household_id, name, category, cadence, store_id, weekly_use, unit, pack_size, price, target)
  select hid, s.name, s.category, s.cadence, st.id, s.weekly_use, s.unit, s.pack_size, null, s.target
  from (
    select * from (values
    -- seed-v2:start
    ('פירות', 'פירות וירקות', 'shabbat', 'produce', 2, 'ק"ג', 1, 2),
    ('ירקות', 'פירות וירקות', 'shabbat', 'produce', 3, 'ק"ג', 1, 3),
    ('ביצים', 'ביצים', 'shabbat', 'produce', 12, 'ביצה', 12, 12),
    ('עוף', 'בשר ועוף', 'shabbat', 'meat', 1, 'ק"ג', 1, 1),
    ('דניס', 'דגים', 'shabbat', 'meat', 2, 'דג', 1, 2),
    ('פילה סלמון', 'דגים', 'shabbat', 'meat', 0.5, 'ק"ג', 0.5, 0.5),
    ('פילה אמנון', 'דגים', 'shabbat', 'meat', 0.5, 'ק"ג', 0.5, 0.5),
    ('חלה', 'לחם ומאפים', 'friday', 'bakery', 2, 'חלה', 1, 2),
    ('לחם', 'לחם ומאפים', 'friday', 'bakery', 1, 'כיכר', 1, 1),
    ('חלב', 'מוצרי חלב', 'bulk', 'dry', 2, 'ליטר', 1, 2),
    ('גבינה', 'מוצרי חלב', 'bulk', 'dry', 2, 'גביע', 1, 2),
    ('יוגורט', 'מוצרי חלב', 'bulk', 'dry', 4, 'גביע', 1, 4),
    ('יוגורט פירות', 'מוצרי חלב', 'bulk', 'dry', 4, 'גביע', 1, 4),
    ('משקה יוגורט', 'מוצרי חלב', 'bulk', 'dry', 2, 'בקבוק', 1, 2),
    ('משקה שיבולת שועל', 'מוצרי חלב', 'bulk', 'dry', 1, 'ליטר', 1, 1),
    ('מעדן פרי', 'מוצרי חלב', 'bulk', 'dry', 4, 'גביע', 1, 4),
    ('מעדן סויה', 'מוצרי חלב', 'bulk', 'dry', 4, 'גביע', 1, 4),
    ('אוכמניות קפואות', 'קפואים', 'bulk', 'dry', 1, 'אריזה', 1, 1),
    ('חומוס מבושל קפוא', 'קפואים', 'bulk', 'dry', 1, 'אריזה', 1, 1),
    ('אורז', 'יבשים ודגנים', 'bulk', 'dry', 1, 'ק"ג', 1, 1),
    ('אורז פרסי', 'יבשים ודגנים', 'bulk', 'dry', 1, 'ק"ג', 1, 1),
    ('קמח', 'יבשים ודגנים', 'bulk', 'dry', 1, 'ק"ג', 1, 1),
    ('קמח כוסמין', 'יבשים ודגנים', 'bulk', 'dry', 1, 'ק"ג', 1, 1),
    ('קוסקוס', 'יבשים ודגנים', 'bulk', 'dry', 1, 'אריזה', 1, 1),
    ('אבקת אפייה', 'יבשים ודגנים', 'bulk', 'dry', 2, 'שקיק', 1, 2),
    ('תה', 'יבשים ודגנים', 'bulk', 'dry', 25, 'שקיק', 25, 25),
    ('תבלינים', 'יבשים ודגנים', 'bulk', 'dry', 1, 'אריזה', 1, 1),
    ('מלפפונים כבושים', 'שימורים ורטבים', 'bulk', 'dry', 1, 'צנצנת', 1, 1),
    ('מיונז', 'שימורים ורטבים', 'bulk', 'dry', 1, 'צנצנת', 1, 1),
    ('קטשופ', 'שימורים ורטבים', 'bulk', 'dry', 1, 'בקבוק', 1, 1),
    ('קרקרים', 'חטיפים ומתוקים', 'bulk', 'dry', 1, 'חבילה', 1, 1),
    ('עוגיות', 'חטיפים ומתוקים', 'bulk', 'dry', 1, 'חבילה', 1, 1),
    ('חטיפים', 'חטיפים ומתוקים', 'bulk', 'dry', 2, 'חבילה', 1, 2),
    ('תפוצ׳יפס', 'חטיפים ומתוקים', 'bulk', 'dry', 1, 'שקית', 1, 1),
    ('מים מינרליים', 'משקאות', 'bulk', 'dry', 6, 'בקבוק', 6, 6),
    ('מיץ ענבים', 'שבת', 'bulk', 'dry', 1, 'בקבוק', 1, 1),
    ('יין לבן', 'שבת', 'bulk', 'dry', 1, 'בקבוק', 1, 1),
    ('שקיות אשפה', 'ניקיון ובית', 'bulk', 'dry', 1, 'גליל', 1, 1),
    ('ספריי ניקוי', 'ניקיון ובית', 'bulk', 'dry', 1, 'בקבוק', 1, 1),
    ('אבקת כביסה', 'ניקיון ובית', 'bulk', 'dry', 1, 'אריזה', 1, 1),
    ('ג׳ל לאסלה', 'ניקיון ובית', 'bulk', 'dry', 1, 'בקבוק', 1, 1),
    ('מרכך כביסה', 'ניקיון ובית', 'bulk', 'dry', 1, 'בקבוק', 1, 1),
    ('נוזל ניקוי רצפות', 'ניקיון ובית', 'bulk', 'dry', 1, 'בקבוק', 1, 1),
    ('נוזל כלים', 'ניקיון ובית', 'bulk', 'dry', 1, 'בקבוק', 1, 1),
    ('נייר טואלט', 'נייר וחד פעמי', 'bulk', 'dry', 32, 'גליל', 32, 32),
    ('כפיות חד פעמי', 'נייר וחד פעמי', 'bulk', 'dry', 1, 'חבילה', 1, 1),
    ('מזלגות חד פעמי', 'נייר וחד פעמי', 'bulk', 'dry', 1, 'חבילה', 1, 1),
    ('סכינים חד פעמי', 'נייר וחד פעמי', 'bulk', 'dry', 1, 'חבילה', 1, 1),
    ('נייר אפייה', 'נייר וחד פעמי', 'bulk', 'dry', 1, 'גליל', 1, 1),
    ('נייר סנדוויץ׳', 'נייר וחד פעמי', 'bulk', 'dry', 1, 'גליל', 1, 1),
    ('נייר כסף', 'נייר וחד פעמי', 'bulk', 'dry', 1, 'גליל', 1, 1),
    ('שמפו', 'טיפוח ופארם', 'bulk', 'dry', 1, 'בקבוק', 1, 1),
    ('חיתולים', 'תינוק', 'bulk', 'dry', 44, 'חיתול', 44, 44),
    ('מגבונים', 'תינוק', 'bulk', 'dry', 2, 'חבילה', 1, 2),
    ('חטיף לתינוק', 'תינוק', 'bulk', 'dry', 2, 'חבילה', 1, 2),
    ('שמפו לתינוק', 'תינוק', 'bulk', 'dry', 1, 'בקבוק', 1, 1)
    -- seed-v2:end
    ) as he (name, category, cadence, role, weekly_use, unit, pack_size, target)
    where lang is distinct from 'en'
    union all
    select * from (values
    -- seed-v2-en:start
    ('Fruit', 'Fruit and veg', 'shabbat', 'produce', 2, 'kg', 1, 2),
    ('Vegetables', 'Fruit and veg', 'shabbat', 'produce', 3, 'kg', 1, 3),
    ('Eggs', 'Eggs', 'shabbat', 'produce', 12, 'egg', 12, 12),
    ('Chicken', 'Meat and chicken', 'shabbat', 'meat', 1, 'kg', 1, 1),
    ('Sea bream', 'Fish', 'shabbat', 'meat', 2, 'fish', 1, 2),
    ('Salmon fillet', 'Fish', 'shabbat', 'meat', 0.5, 'kg', 0.5, 0.5),
    ('Tilapia fillet', 'Fish', 'shabbat', 'meat', 0.5, 'kg', 0.5, 0.5),
    ('Challah', 'Bread and bakery', 'friday', 'bakery', 2, 'loaf', 1, 2),
    ('Bread', 'Bread and bakery', 'friday', 'bakery', 1, 'loaf', 1, 1),
    ('Milk', 'Dairy', 'bulk', 'dry', 2, 'liter', 1, 2),
    ('Cheese', 'Dairy', 'bulk', 'dry', 2, 'cup', 1, 2),
    ('Yogurt', 'Dairy', 'bulk', 'dry', 4, 'cup', 1, 4),
    ('Fruit yogurt', 'Dairy', 'bulk', 'dry', 4, 'cup', 1, 4),
    ('Yogurt drink', 'Dairy', 'bulk', 'dry', 2, 'bottle', 1, 2),
    ('Oat drink', 'Dairy', 'bulk', 'dry', 1, 'liter', 1, 1),
    ('Fruit pudding', 'Dairy', 'bulk', 'dry', 4, 'cup', 1, 4),
    ('Soy pudding', 'Dairy', 'bulk', 'dry', 4, 'cup', 1, 4),
    ('Frozen blueberries', 'Frozen', 'bulk', 'dry', 1, 'pack', 1, 1),
    ('Frozen cooked chickpeas', 'Frozen', 'bulk', 'dry', 1, 'pack', 1, 1),
    ('Rice', 'Dry goods and grains', 'bulk', 'dry', 1, 'kg', 1, 1),
    ('Persian rice', 'Dry goods and grains', 'bulk', 'dry', 1, 'kg', 1, 1),
    ('Flour', 'Dry goods and grains', 'bulk', 'dry', 1, 'kg', 1, 1),
    ('Spelt flour', 'Dry goods and grains', 'bulk', 'dry', 1, 'kg', 1, 1),
    ('Couscous', 'Dry goods and grains', 'bulk', 'dry', 1, 'pack', 1, 1),
    ('Baking powder', 'Dry goods and grains', 'bulk', 'dry', 2, 'sachet', 1, 2),
    ('Tea', 'Dry goods and grains', 'bulk', 'dry', 25, 'tea bag', 25, 25),
    ('Spices', 'Dry goods and grains', 'bulk', 'dry', 1, 'pack', 1, 1),
    ('Pickles', 'Cans and sauces', 'bulk', 'dry', 1, 'jar', 1, 1),
    ('Mayonnaise', 'Cans and sauces', 'bulk', 'dry', 1, 'jar', 1, 1),
    ('Ketchup', 'Cans and sauces', 'bulk', 'dry', 1, 'bottle', 1, 1),
    ('Crackers', 'Snacks and sweets', 'bulk', 'dry', 1, 'pack', 1, 1),
    ('Cookies', 'Snacks and sweets', 'bulk', 'dry', 1, 'pack', 1, 1),
    ('Snacks', 'Snacks and sweets', 'bulk', 'dry', 2, 'pack', 1, 2),
    ('Potato chips', 'Snacks and sweets', 'bulk', 'dry', 1, 'bag', 1, 1),
    ('Mineral water', 'Drinks', 'bulk', 'dry', 6, 'bottle', 6, 6),
    ('Grape juice', 'Weekend', 'bulk', 'dry', 1, 'bottle', 1, 1),
    ('White wine', 'Weekend', 'bulk', 'dry', 1, 'bottle', 1, 1),
    ('Trash bags', 'Cleaning and home', 'bulk', 'dry', 1, 'roll', 1, 1),
    ('Cleaning spray', 'Cleaning and home', 'bulk', 'dry', 1, 'bottle', 1, 1),
    ('Laundry powder', 'Cleaning and home', 'bulk', 'dry', 1, 'pack', 1, 1),
    ('Toilet gel', 'Cleaning and home', 'bulk', 'dry', 1, 'bottle', 1, 1),
    ('Fabric softener', 'Cleaning and home', 'bulk', 'dry', 1, 'bottle', 1, 1),
    ('Floor cleaner', 'Cleaning and home', 'bulk', 'dry', 1, 'bottle', 1, 1),
    ('Dish soap', 'Cleaning and home', 'bulk', 'dry', 1, 'bottle', 1, 1),
    ('Toilet paper', 'Paper and disposables', 'bulk', 'dry', 32, 'roll', 32, 32),
    ('Disposable spoons', 'Paper and disposables', 'bulk', 'dry', 1, 'pack', 1, 1),
    ('Disposable forks', 'Paper and disposables', 'bulk', 'dry', 1, 'pack', 1, 1),
    ('Disposable knives', 'Paper and disposables', 'bulk', 'dry', 1, 'pack', 1, 1),
    ('Baking paper', 'Paper and disposables', 'bulk', 'dry', 1, 'roll', 1, 1),
    ('Sandwich paper', 'Paper and disposables', 'bulk', 'dry', 1, 'roll', 1, 1),
    ('Aluminum foil', 'Paper and disposables', 'bulk', 'dry', 1, 'roll', 1, 1),
    ('Shampoo', 'Personal care', 'bulk', 'dry', 1, 'bottle', 1, 1),
    ('Diapers', 'Baby', 'bulk', 'dry', 44, 'diaper', 44, 44),
    ('Wet wipes', 'Baby', 'bulk', 'dry', 2, 'pack', 1, 2),
    ('Baby snack', 'Baby', 'bulk', 'dry', 2, 'pack', 1, 2),
    ('Baby shampoo', 'Baby', 'bulk', 'dry', 1, 'bottle', 1, 1)
    -- seed-v2-en:end
    ) as en (name, category, cadence, role, weekly_use, unit, pack_size, target)
    where lang = 'en'
  ) as s
  join public.seed_role_stores(lang) r on r.role = s.role
  left join public.stores st on st.household_id = hid and st.name = r.name;
end;
$$;

-- Same as 0005, with the role stores and the new products, and
-- settings.roleStores pointing at the new stores.
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
  perform public.seed_stores_v2(hid, seed_lang);
  perform public.seed_items_v2(hid, seed_lang);
  update public.households h
  set settings = h.settings || jsonb_build_object('roleStores', (
    select jsonb_object_agg(r.role, st.id)
    from public.seed_role_stores(seed_lang) r
    join public.stores st on st.household_id = hid and st.name = r.name
  ))
  where h.id = hid;
  return hid;
end;
$$;

revoke execute on function public.seed_role_stores(text) from public, anon, authenticated;
revoke execute on function public.seed_stores_v2(uuid, text) from public, anon, authenticated;
revoke execute on function public.seed_items_v2(uuid, text) from public, anon, authenticated;
revoke execute on function public.create_household(text, text) from public, anon;
grant execute on function public.create_household(text, text) to authenticated;

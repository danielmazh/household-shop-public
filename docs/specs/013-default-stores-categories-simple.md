# 013 - Default stores, fixed categories, list view and simple mode

Operator request of 2026-11-07. Builds on spec 012. The 008 "simplicity first" rule applies.

## A. Store roles and default stores
- Four store roles: `dry` (dry goods and everything daily, the fallback), `produce` (fruit, vegetables, eggs), `meat` (meat, chicken, fresh fish), `bakery` (challah and bread).
- `settings.roleStores: { dry, produce, meat, bakery }`, each a store id or null. Old app copies drop the key when they save settings; the new app then shows "no default" until it is set again.
- A fixed category -> role map lives in `src/domain/categories.ts`.
- New product: when the user did not pick a store, it gets the role store of its category (after AI fill, and on save).
- Stores screen: one row per role, "ברירת מחדל ל..." with a store picker. A change also moves the products of that role whose store is empty or the old role store. Products with another store stay.

## B. Fixed categories in shopping order
- פירות וירקות, ביצים, בשר ועוף, דגים, מוצרי חלב, לחם ומאפים, קפואים, יבשים ודגנים, שימורים ורטבים, חטיפים ומתוקים, משקאות, שבת, ניקיון ובית, נייר וחד פעמי, טיפוח ופארם, תינוק, כללי. Each has an English name.
- Old names map to them: יבשים, רטבים ושימורים, בית וניקיון, חד פעמי, טיפוח, the old English names, and the empty category (כללי).
- The AI gets the list as an enum. The product form offers the list and still allows free text.
- Stored data is not rewritten by the app. Sorting and roles read old names through the map.

## C. Sorted by category
- Shop mode: inside each store, lines are grouped by category in the order above, with a small category header. Unknown categories come last, by name.
- Home list ("ברשימה של..."): same order, no headers.

## D. Catalog list and gallery
- A toggle in the catalog header: list (default) or gallery. Saved on the device (`household-shop.catalog-view`).

## E. Simple mode ("רשימה פשוטה")
- A per-device setting in Settings (`household-shop.simple`).
- Home shows one shared list sorted by category, with headers: active products marked "נגמר" plus active one-time products.
- An add field: an existing product is put on the list (ranOut). A new name makes a new product: category from the AI when it is on, else כללי; store from the role map; 1 pack.
- Tap to tick (shared ticks of the next trip). "סיימתי" runs the normal finish for the next trip with 1 pack per ticked product, so history works.
- Hidden in simple mode: stock, targets, trips (home card, trips row in settings, stock count, trip and amount fields in the product form). The catalog action becomes "לרשימה".
- Switching back keeps everything: the list is the "נגמר" items, which the regular list puts on the next trip.

## F. New households (migration 0007 and demo seed)
- Four role stores with placeholder names, already set as role stores: he "חנות יבשים", "ירקן", "קצב ודגים", "מאפייה"; en "Grocery", "Greengrocer", "Butcher and fish", "Bakery". Renaming a store keeps every product on it.
- A bigger product list (56 products, both languages, no prices, canonical categories, target 1 to 4 packs). Trip by role: produce and meat on the `shabbat` trip, bakery on `friday`, the rest on `main` (set through the cadence, so the SQL trigger fills `trips`).
- 0007 adds `seed_role_stores(lang)`, `seed_stores_v2`, `seed_items_v2`, and replaces `create_household(text, text)` to use them and save `roleStores`. Safe to run more than once. Needs 0006 first.

## G. Live data for our home (one-off)
- (private, not in this repo) a one-time data script, one transaction, safe to run again, after 0007. For one household only.
- Sets roleStores (dry רמי לוי, produce מבחר פרי וירק, meat אושרי / חזן, bakery סופר הצלחה; fails when a store is missing), maps categories, gives products with no store their role store, moves חלה and חלות to סופר הצלחה, adds the missing products from the list (on the role trip, stock = target), and prints counts per category and per store.

## H. Help
- Help page and the first-run card explain role stores, categories and simple mode.

## Tests
- Unit: category map and order, role store for a product, roleStores parse and save, role store change (which products move), seed TS = SQL (0007), data script list = seed list.
- SQL: 0001 to 0007 twice, create_household sets roleStores and links every item, the data script twice on a fixture of our home.
- e2e (demo): role store change moves products, category headers in shop mode, list/gallery toggle, simple mode add, tick and finish.

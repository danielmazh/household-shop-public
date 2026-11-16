# 012 - Amount for this trip, one-time products and purchase history

Operator approval of 2026-11-05 for spec 008 sections F, M and L (history only). The 008 "simplicity first" rule applies: the trip screen gets no new buttons or rows.

## A. Amount for this trip (008 F)
- On a trip line (the list on home and shop mode), the amount is a small button. A tap opens a sheet "כמה לקנות הפעם" with a stepper (1 to 99 packs) and the computed amount as a hint.
- "שמירה" saves an override for this trip only. "חזרה לחישוב" removes it. An overridden line shows a small "שונה" mark next to the amount.
- An override counts only while the item is on that trip. The list total uses it.
- Overrides are shared by the household and live. Finishing the trip clears them, ticked or not. Removing a trip from settings clears its overrides.
- Not now: the "נגמר" sheet of 008 F.

## B. One-time products (008 M)
- The product form has a choice "מוצר קבוע" or "פעם אחת". "פעם אחת" hides the stock fields and shows: which trip (one choice, default the next trip) and "כמה לקנות" (packs).
- Stored as `items.once_trip` (a trip id, or null for a regular product). `trips` is set to that one trip, so app copies from before this spec still show it there.
- It goes on its trip with its packs, whatever the stock. It is never in the stock count. If its trip was removed, it goes on the next trip.
- Finishing the trip with it ticked marks it bought: `active = false`, stock does not change. Not ticked: it stays for the next time.
- A bought one-time product shows with the hidden products. One tap on "שוב" puts it back on the next trip. The product form can change the trip.
- Not now: the 40-item library and the seed store "חנות לבית". The cadence check does not change.

## C. Purchase history (008 L, history only)
- Finishing a trip with ticked lines writes `purchases(id, household_id, trip, trip_name, finished_by, finished_by_name, finished_at)` and `purchase_lines(purchase_id, household_id, item_id, item_name, packs, units, unit, store_name, price_each)`. Name, unit, store and price are copied at that time.
- Settings > "היסטוריה": past trips, newest first (last 100): date, who finished, item count, estimated cost. A tap opens the lines. Every cost says "בערך" (estimate from catalog prices).
- Members read their household's rows. Clients never write these tables. Demo mode keeps the last 100 on the device.
- Not now: stats.

## D. Database (migration 0006)
- Additive and safe to run more than once. The live app keeps working after it runs and before the new app is deployed.
- New tables `trip_overrides`, `purchases`, `purchase_lines`: RLS on, select for members only, no client writes (grants revoked from anon and authenticated, select granted back to authenticated).
- New functions, security definer with `set search_path = ''`: `set_trip_override(hid, trip, item_id, packs)` (null packs removes) and `finish_household_trip(hid, trip, lines)`. Lines are `{item_id, delta, packs}`.
- `finish_household_trip` does what `finish_trip` did, plus: one-time items become inactive (no stock change), the trip's overrides are deleted, and a purchase with its lines is written when there are lines. It also clears ticks when there are no lines.
- `finish_trip(trip, lines)` keeps its signature and calls the new function for the household of the lines, so old app copies write history too.
- `items.once_trip` text, null or a trip slug. Clients may insert and update it.
- `trip_overrides` is added to the realtime publication.

## Tests
- Unit: override math (on and off the trip, total, back to computed), one-time placement (own trip, removed trip, stock ignored, not in stock count), finish (one-time becomes inactive, overrides cleared, history written in demo mode), history mapping from rows.
- SQL: 0001 to 0006 run twice on a local Postgres 16 with stub `auth` schema and roles.
- e2e (demo mode): change an amount and go back, add a one-time product, finish, open history, "שוב".

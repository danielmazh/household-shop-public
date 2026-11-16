# 007 - Flexible setup

Every household sets up its own stores, trips and days. Nothing about stores or the weekly plan is fixed in code. The current plan (Tue main, Thu Shabbat, Fri challah) is only the default for a new household.

## Stores
- Table `stores(id, household_id, name, emoji, sort, active)`, unique name per household, RLS like `items`.
- Items point to a store by `store_id` (not free text). Rename a store once, every item follows.
- Settings > Stores: add, rename, pick emoji, reorder, archive, restore. Before archiving, the app asks where to move the store's items (another active store, or no store). Archive and restore run on the server (`archive_store`, `restore_store`); clients cannot write `active`. New items and moved items need an active store.
- Up to 50 active stores and 200 in all (archived ones count) per household.
- The trip list groups by store in the household's store order.

## Trips
- `settings.trips`: list of 1 to 7 trips. Each trip: `id` (short slug, `^[a-z0-9-]{1,20}$`), `name` (max 30), `emoji`, `day` (0-6), `carries` (one or more cadences).
- Settings > Trips: add, edit, delete, reorder. Edit sheet: name, emoji, day pills, cadence pills ("what do we buy on this trip").
- Share rule (replaces the fixed table in 002): for a cadence carried by N trips, each of those trips gets `1/N` of the weekly use. A cadence carried by no trip shows a warning in Settings, and its items go on the next trip.
- Two trips on the same day are allowed; order in the list breaks ties for "next trip".
- Deleting a trip clears its ticks (cascade by trip id).
- `ticks.trip` and `finish_trip(trip, ...)` accept any trip id present in that household's `settings.trips`.

## Cadences
Fixed set, editable labels per household: `bulk` (weekly stock), `fresh` (fresh food), `shabbat` (for Shabbat), `friday` (same day bakery). Default labels in Hebrew. Labels live in `settings.cadenceLabels`.

## Other per-household settings
Safety margin (0 to 50%, step 5), household name, members (list, leave), join code (copy, rotate).

## Validation
All in `src/domain` with unit tests: trip list (1-7, unique ids and names, at least one cadence each, valid day), store names (unique, max 40), store and item limits per household (spec 003), share rule including cadences on 0, 1, 2 and 3 trips. The database checks `settings` shape and size (raise the limit to 4096 bytes).

## Migration
The app is not live yet, so `0001_init.sql` changes in place (idempotent). Seed creates default stores and trips in `create_household`.

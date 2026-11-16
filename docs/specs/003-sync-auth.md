# 003 - Sync and auth

## Model
Supabase tables: `households(id, name, join_code, settings jsonb)`, `members(household_id, user_id, created_at)`, `stores(id, household_id, name, emoji, sort, active)`, `items(...001 fields, id, household_id, updated_at)`, `join_attempts(user_id, at)`, `ticks(household_id, trip, item_id, ticked_by, ticked_at)` with primary key `(household_id, trip, item_id)`.
- A household has any number of members (couple, family).
- A user may belong to more than one household. The app keeps the active household id in localStorage. Default is the oldest membership (`members.created_at`). Settings has a household switcher when there is more than one.

## Security
- Row Level Security on every table. A user reads and writes only rows of households where they are a member. No delete policies, except on `ticks` (members may untick).
- `households`: clients may update only `name` (column grant); `settings` change only through `save_settings`. `join_code` matches `^[A-HJ-NP-Z2-9]{8}$`, made from `gen_random_bytes`.
- `stores`: clients may insert and update only `name`, `emoji` and `sort` (column grants). `active` changes only through `archive_store` and `restore_store`. Inserts on `stores` and `items` list their columns, so `created_at` and `updated_at` come from the defaults.
- Limits per household (triggers, same numbers in `src/domain`): 50 active stores and 200 stores in all; 500 active items and 2000 items in all. Checked on insert and when a row becomes active again. The app shows the limit in Hebrew.
- A new item, or an item moved to another store, needs an active store of its household. An item may keep its store after that store is archived.
- RPCs (security definer, `search_path = ''`, `auth.uid()` required, EXECUTE revoked from public and anon):
  - `create_household(name)` creates the household, the membership and the seed catalog in one transaction. Max 5 households created per user.
  - `join_household(code)` returns the household id or null. Max 10 failed attempts per user per hour.
  - `rotate_join_code(hid)`, `leave_household(hid)`.
  - `save_settings(hid, settings, expected_version)` saves only when the version matches and returns the new version, else null.
  - `finish_trip(trip, lines jsonb)` also deletes that trip's ticks in the same transaction.
  - `archive_store(store_id, move_to_store_id)` moves the items and archives the store in one transaction. `restore_store(store_id)` makes it active again. `reorder_stores(store_ids)` saves the store order all or nothing.
  - `adjust_stock(item_id, delta)` and `finish_trip` change stock on the server (`stock = greatest(0, stock + delta)`), so two phones never overwrite each other.
- Item edits send only the changed columns.
- Size and range checks on all text, numbers (`between`, rejects NaN) and `settings`.

## Auth
Email magic link, PKCE flow. Redirect URL is the exact app URL, allowlisted in Supabase. Sign-out clears the local session and every `household-shop.*` key.

## Sync
- Realtime on `stores`, `items` and `ticks` of the active household; refetch debounced 300 ms. A tick is shown at once on the phone that made it (optimistic) and rolled back if the write fails.
- Demo mode keeps ticks in localStorage and syncs open tabs with the `storage` event.
- Last known items cached in localStorage; offline the app reads the cache and shows a banner. Writes need network, except ticks.
- Offline ticks: a tick or untick made without network is kept in a local queue (`household-shop.tickQueue`), shown at once, and sent in order when the network returns (`online`, app visible, or next successful call). Only the last state per (trip, item) is sent. A queued change that the server rejects is dropped and the banner shows. "Finish trip" stays disabled while offline or while the queue is not empty.
- Known and accepted: realtime delete events for `ticks` reach every subscriber with only key ids (household, trip, item uuid); clients drop other households' events.
- Without env config the app runs in local demo mode (`LocalStore`).

## Acceptance
- Migration idempotent, RLS on every table, all rules above in SQL.
- Two members of one household see each other's changes and ticks live; a non-member sees nothing.

## Release fixes (QA 2026-10-28)
- Settings sync: settings are live on every device (realtime on `households`, `storage` event in demo). Saves go through `save_settings(hid, settings, expected_version)`; `households.settings_version` goes up by one on each save. A stale save is refused, the app reloads the settings and shows "ההגדרות עודכנו במכשיר אחר".
- Offline start with an expired token: the app keeps the last household and cached data, shows the offline banner, and asks to sign in only when the network is back and the refresh really fails.
- Tick order: one tick request at a time per household; queued changes wait for the request in flight. Finish waits for in-flight and queued ticks. An expired-token error is a retry, not a reject.
- Sign-in also accepts the 6-digit code from the email (for installed iOS apps where the link opens in Safari). Errors in the return URL are shown once and then cleared.
- Create household is safe to retry: the RPC result id is used directly, and a failed reload never leads to a second create.
- Last member leaving and join attempts take row locks, so parallel calls cannot leave an orphan household or skip the join limit.

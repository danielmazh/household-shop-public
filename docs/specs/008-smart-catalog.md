# 008 - Smart catalog, plain language and personal area

Operator requests of 2026-10-28. Defaults below were picked by the lead (operator did not choose); each is easy to change.

## Simplicity first (operator rule, overrides the sections below)
- The UI must not get more complex. The trip screen shows only: week strip, one summary line, the list, and the finish button. Suggestions are one collapsed line ("3 הצעות") until opened.
- New features live one level down: history, stats, activity, members, categories, stores, trips and special trips are rows in Settings or the personal area, not new tabs. Tab bar stays 3 tabs.
- Every form shows the basic fields only; the rest sits under "עוד פרטים" (brand, barcode, photo, price, pack size details).
- Special trip creation is 3 fields: name, date, emoji. What it carries defaults to festive meal + fresh and sits under "עוד פרטים"; "כמה סועדים" is dropped for now.
- No screen gets more than one primary button. When in doubt, remove.
- Built for someone who never used such an app: every button has text, not only an icon; one task per screen; the next step is always obvious; every change can be undone ("ביטול" for a few seconds) instead of "are you sure" dialogs, except for leaving a household; empty screens say exactly what to tap. Test: a first-time user finishes a trip without help.

## A. Plain language
- Every screen speaks like a person, not a system. No term without an example.
- Renames: "מרווח ביטחון" -> "כמה להוסיף ליתר ביטחון" with a live example ("צורכים 10 ביצים בשבוע? נקנה 11"). "צריכה שבועית" -> "כמה אתם צורכים בשבוע". "גודל אריזה" -> "כמה יש באריזה אחת". "סוג" (cadence) -> "מתי קונים". "בארכיון" -> "מוסתר".
- Each settings row has one help line under it. A "?" button opens a short sheet with an example.
- First run: 3 short cards that explain trips, stock count and "נגמר". Can be opened again from the personal area.
- Copy is reviewed screen by screen; the rule is CEFR B1 Hebrew, short sentences.

## B. Trip names by day (default)
Default trips: "שלישי - קנייה גדולה" (stock + fresh), "חמישי - לארוחה החגיגית" (fresh + festive meal: meat, fish, wine), "שישי בבוקר - חלות" (same day fresh). Default "when to buy" labels: "מלאי לשבוע", "טרי", "לארוחה חגיגית" (help line: "בשר, דגים, יין ומה שצריך לשבת, לחג או לאירוח"), "טרי מהיום". The internal key stays `shabbat`; only the label changes. Households can rename, merge or delete trips (007).

## C. Categories
- Table `categories(id, household_id, name, emoji, sort, active)`, like stores (RLS, limits 50 active, archive with move, restore). Items get `category_id`.
- Settings > Categories: add, rename, emoji, reorder, hide.
- Smart assignment when adding an item: 1) exact or close match in the library (D), 2) the household's own items with the same first word, 3) keyword rules (e.g. "שמפו" -> טיפוח). The suggestion is pre-selected and can be changed.

## D. Product library
- About 150 items that almost every home buys, in `src/domain/library.ts` (also seeded in SQL where needed): name, emoji, category, unit, pack size, when to buy, typical weekly use. Includes dairy (חלב, ביצים, גבינה לבנה, צהובה, יוגורט, שמנת), fruit and vegetables by type (תפוח אדום, תפוח ירוק, ענבים, בננה, עגבנייה, מלפפון, בצל, תפוח אדמה, גזר...), dry goods (אורז, פסטה, קמח, סוכר, שמן, טונה, שימורים: תירס, חומוס, רסק), cleaning (סקוצ'ים, נוזל כלים, אבקת כביסה, מרכך כביסה, מסיר כתמים, אקונומיקה), personal care (שמפו, מרכך, סבון, משחת שיניים), paper (נייר טואלט, מגבות נייר), baby (חיתולים, מגבונים).
- New household: a checklist "מה אתם קונים?" grouped by category, nothing selected by default except the operator's current 24 basics. Selected items become catalog items.
- Add item: autocomplete from the library fills everything.

## E. Product details, barcode and photo
- Item gets optional `brand`, `barcode`, `photo_path`. Pack size and unit are shown on the product card.
- Scan barcode with the camera (BarcodeDetector where supported, else a small wasm decoder). Known barcode in the household -> open that item. Else look up Open Food Facts (free) and prefill.
- Photo recognition (optional, off by default): a Supabase Edge Function sends the photo to the Claude API and returns name, brand, pack size, unit, category. It runs only when the operator sets the API key and a monthly cap as function secrets. Without a key the photo is only stored and the form is filled by hand.
- Photos: small JPEG (max 600 px), private Storage bucket per household, RLS by membership.
- CSP adds only the Open Food Facts API origin and the Supabase functions origin.

## F. Amount for this trip
- On a trip row, tapping the amount opens a stepper "כמה לקנות הפעם". It overrides the computed amount for this trip only. "חזרה לחישוב" removes the override.
- Tapping "נגמר" opens a small sheet: "כמה לקנות?" with the computed default.
- Table `trip_overrides(household_id, trip, item_id, packs)`, synced live, cleared by `finish_trip` for that trip.

## G. Suggestions on the trip screen
A card "אולי חסר לכם" at the top of the trip screen (collapsible):
- Items that should be running out: `last_bought_at` + time the bought amount lasts (by weekly use) is before the next trip. `finish_trip` sets `last_bought_at`.
- Library items that most homes buy and the household does not have yet (max 3, can be dismissed for good).
Each suggestion: one tap "הוספה לקנייה" or "לא עכשיו".

## H. Stock count, explained
Title "כמה יש בבית?" and the line "ספרו מה נשאר לפני הקנייה. נקנה רק את מה שחסר." A switch: "רק מה שבקנייה הזו" or "הכל".

## I. Personal area and feedback
- Avatar button in the header opens "האזור שלי": display name and emoji avatar (table `profiles(user_id, display_name, avatar)`, own row only), email, my households, the intro cards, sign out.
- "שליחת משוב": type (בעיה, רעיון, אחר), text up to 1000 chars, app version. Table `feedback(id, user_id, household_id, kind, body, app_version, created_at)`: insert own rows only, no select for clients; the operator reads it in Supabase. Demo mode keeps it locally and says so.
- Who did what: ticks show the first name of who ticked (from `profiles`).

## J. Google sign-in
- "המשך עם Google" on the sign-in screen, next to the email code/link. Supabase Google provider, PKCE, same redirect URLs.
- Prepared now, turned on later: the button shows only when `VITE_AUTH_PROVIDERS` lists `google`. README has the setup steps (Google Cloud OAuth client, consent screen, authorized redirect `https://<ref>.supabase.co/auth/v1/callback`, client id and secret in Supabase > Auth > Providers).
- Same email = same account (Supabase identity linking), so moving to Google-only later keeps households.
- Later step, not now: Google-only sign-in (hide email) is a one-line config change.

## K. Household view and activity
- Settings > "הבית שלנו": members with avatar, display name, joined date and last activity; the join code; leave.
- Activity log: table `activity(id, household_id, user_id, action, target_kind, target_id, summary, created_at)`, written only by database triggers (items, stores, categories, settings, finish trip, overrides, join and leave), never by clients. Members can read their household's rows. Kept 90 days.
- Screen "מה השתנה": newest first, grouped by day, "דנה סימנה נגמר: חלב", "יוסי סיים קנייה: 14 פריטים". Filter by member.
- Item edit shows "עודכן לאחרונה על ידי ... לפני ...".

## L. Purchase history and stats
- `finish_trip` writes `purchases(id, household_id, trip, finished_by, finished_at)` and `purchase_lines(purchase_id, item_id, item_name, packs, units, unit, store_name, price_each)` (name, store and price copied at that time, so history stays true after edits). Members read; clients never write directly.
- "היסטוריה": list of past trips (date, who, items, estimated cost); open one to see its lines.
- "סטטיסטיקה": period switch (חודש, 3 חודשים, שנה). Cards: estimated spend per month (simple bar chart), top items by times bought, top items by cost, most expensive item per unit, spend by store, spend by category, how often each trip actually happened. Costs are estimates from catalog prices and say so.
- Later, not now: receipt scanning for real prices (the `price_each` column is ready for it).

## M. One-time purchases ("שונות")
- New "when to buy" value `once` (label "פעם אחת"): no weekly use. The item goes on the trip the user picks (default: next trip) until it is bought; `finish_trip` marks it bought (`active=false`, kept in history). "שוב" puts it back.
- Library category "בית ושונות" with general home goods that are not weekly: צינור לגינה, מאוורר, מצעים, סלסלת כביסה, מגבות, מיקסר, קומקום, נורות, סוללות, מטריה, כלי אחסון, מתלים, שטיח, כרית, ועוד (about 40). Typical store "חנות לבית" in the seed stores list (inactive by default).
- These items never appear in suggestions (G) or in stock count (H).
- Database: cadence check adds `once`; `settings.cadenceLabels` gets the new key; trips do not need to carry `once` (it goes on the picked trip directly), stored as `items.once_trip`.

## N. Trip picker that scales (1 to 7 trips)
- Replace the trip name pills with a week strip: 7 day cells (א to ש) with the date under each. Days with a trip are active and show the trip emoji; the selected day is filled; the next trip has a small "הבאה" mark; today has a ring. Same layout for 1 or 7 trips, so it never overflows.
- Two trips on the same day: the day cell shows a "2" badge and a small segmented switch appears under the strip.
- Under the strip, one clear line about the selected trip: "חמישי 30.10 · לארוחה החגיגית · בשר, דגים, יין · 12 פריטים". The words come from the trip name and the "when to buy" labels it carries, so it is always true for the household's own setup.
- A day without a trip is not tappable and has an accessible name ("שני - אין קנייה").

## O. Special trips (holiday, guests)
- Besides the weekly trips, a household can add a one-time "קנייה מיוחדת" for a date: name (e.g. "ערב ראש השנה", "אירוח שישי"), emoji and date; what it carries defaults to festive meal + fresh (editable under "עוד פרטים").
- It shows on the week strip on its date with its emoji and a "מיוחדת" mark, and goes away after it is finished or its date passes (kept in history).
- Stored in `settings.specialTrips` (max 10 upcoming), same validation style as trips. Ticks, overrides and finish work the same way.

## Acceptance
Unit tests for: stats aggregation, category suggestion rules, library lookup, override math, running-out suggestion math, OFF response mapping. SQL verified like before (RLS on every new table and the storage bucket; activity rows cannot be written or changed by clients). Copy review checklist done for every screen.

# 014 - One list, by store

Operator request of 2026-11-12: trips and days feel heavy. One list for the home; split by store when shopping. Builds on specs 009, 012 and 013. No database change.

## A. One list
- The list is every active product that needs buying now: stock below "keep at home", marked "נגמר", or an active one-time product. Amounts as before (fill up to "keep at home", at least 1 pack when "נגמר"; one-time product: its own packs).
- Days and trip kinds no longer decide anything. `planList(items, settings, overrides)` in `src/domain/planner.ts`.
- Ticks, amounts for this time, finish and history keep using the stored trip machinery with one fixed id: `listTrip(settings)` = the first trip in settings. Settings are no longer edited, so the id stays.

## B. Home
- The hero card: "רשימת קניות", item count and about cost, "יוצא לקנות" (all stores), and one chip per store with its count. A chip opens shop mode on that store.
- "מה ברשימה" (peek) shows the whole list.
- No day, no "next trip", no other-trip chips.

## C. Shop mode
- Store chips at the top: "הכל" and each store on the list with its count. A chip shows only that store. Default: what was picked on home.
- "סיימתי" finishes every ticked line (all stores). Unticked lines stay on the list.
- Caveat: finish clears all "amount for this time" values (the server deletes them per trip). Acceptable.

## D. Removed from the screens (code kept, marked with a dated comment)
- Settings row "קניות וימים" and its screen.
- Product form: "באיזו קנייה קונים" and "באיזו קנייה" for one-time products. A new one-time product gets `onceTrip = listTrip`.
- Catalog one-time card: "פעם אחת" with no trip name. "שוב" uses `listTrip`.
- Use sheet: "ברשימה: +N", no trip name or day.

## E. Simple mode and history
- Simple mode ticks and finishes on `listTrip` (was: the next trip by day).
- History rows are named by the stores bought in (from the lines), else the stored trip name.

## F. Texts
- Help, first-run steps, share text and hints speak of "the list", not trips or days. Both languages.

## Tests
- Unit: planList (below target, ranOut, one-time, inactive, overrides), listTrip.
- e2e (demo): home store chip opens shop mode on that store; finish keeps unticked lines; product form has no trip field; existing specs updated.

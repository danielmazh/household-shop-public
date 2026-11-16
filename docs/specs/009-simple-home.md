# 009 - Simple home, shop mode and "keep at home"

Operator brainstorm of 2026-11-04. The operator still did not understand how to use the app. Goal: every step is obvious, and no feature is lost. Decisions below were approved by the operator or left to the lead ("שלך").

## Mental model (shown to the user in 4 steps)
1. Set once: for each product, how many packs to keep at home, and on which trip it is bought.
2. At home: when something is used or gone, mark it ("מה נגמר?").
3. Going out: "יוצא לקנות" opens shop mode with the list ready.
4. Done: "סיימתי" adds what was bought to the stock. The next list updates by itself.

## A. Keep at home (replaces weekly use and margin)
- Each item has `target`: how much to keep at home, stored in units like `stock`. The UI shows and edits it in packs (`target / packSize`), whole numbers, 0-99.
- Packs to buy on a trip of the item = `ceil((target - stock) / packSize)`, never below 0. A ranOut item buys at least 1 pack (as today).
- An item with `target` null (cached old rows) keeps the old weekly-use rule.
- Trips: an item still lists its trips (0002). Partial use is filled on the item's own next trip. "נגמר הכל" (stock 0 + ranOut) also puts it on the next trip of any kind (as today).
- Hidden from the UI, kept in code with a dated comment: "שימוש בשבוע" field and the "מרווח ביטחון" card. Columns stay.
- Stock is shown in packs everywhere ("בבית 2 מתוך 3"). Pack size stays as info in the item form ("כמה יש באריזה").
- Migration 0004: column `items.target numeric` (null or 0..100000), grants, a BEFORE INSERT fill for null target, and a backfill: `pack_size * greatest(1, ceil(weekly_use * (1 + margin) / days / pack_size))`, where `days` is the number of trip days the item is bought on (at least 1) and `margin` is the household margin.

## B. Navigation
Three tabs: בית, מוצרים, הגדרות. Shop mode is a full screen without tabs.

## C. Home (בית)
- Card "הקנייה הבאה": emoji and name, when ("היום", "מחר", "יום חמישי"), item count, estimated total, primary button "יוצא לקנות".
- Under the card, one line with the other trips; a tap makes that trip the card's trip.
- "מה נגמר?": search with instant results. A tap on a result opens the use sheet (D). No result: "הוספת <text>" opens the new item form (AI fill).
- "נגמר השבוע": items marked since the last finish of their trip (ranOut, or stock below target), each with "ביטול" for the last mark of this session.
- "מה ברשימה": a collapsed list of the card trip, read only.
- First run: a dismissable "איך זה עובד" card with the 4 steps. Dismissal is kept in localStorage.

## D. Use sheet
```
🍚 אורז
השתמשתי ב:  [-]  1  [+]  חבילות
בבית: 3 ← 2   ·   בקנייה הבאה: +1 (משלים ל-3)
[ אישור ]     [ נגמר הכל ]
```
- Default 1 pack. Max is the packs at home (rounded up).
- "אישור" lowers stock by n packs through the existing stock adjust. "נגמר הכל" sets stock 0 and ranOut.
- The line under the stepper names the trip that fills it ("בקנייה הגדולה, יום שלישי").

## E. Shop mode
- Header: trip name, amount left to buy (sum of unticked line costs), "✕" back to home.
- List by store, each store with its estimated total. Row: emoji, name, packs (large), large checkbox.
- Ticked rows move to a collapsed group "בעגלה (n)".
- "+ הוספה": search the catalog or add a new item; the item goes on this trip now (ranOut) and stays in the catalog.
- Fixed bottom button "סיימתי": finish as today, back to home with a toast "המלאי עודכן".
- Screen wake lock while open, when the browser supports it.
- Offline rules of today stay (ticks queue, finish needs network in Supabase mode).

## F. Products (מוצרים)
- The catalog as today. Top button "ספירת מלאי" (moved from the trip screen), in packs.
- Each card: "בבית 2 מתוך 3" and a thin bar, green when full, orange when below target.
- Item form: "כמה להחזיק בבית" and "כמה יש עכשיו" as steppers in packs; then trips, store, category, price per pack, pack size and unit.

## G. Settings
Order: הבית ושיתוף, חנויות, ימי קנייה, איך זה עובד, חשבון. The margin card is hidden.

## Out of scope
No change to auth, sharing, AI, stores or trips data. Help page full text comes after this spec ships.

## Tests
- Unit: planner with target (fill to target, ranOut minimum, null target fallback), backfill rule in TS (same formula as SQL, used by the local demo store).
- e2e smoke: home, use sheet on an item, "יוצא לקנות", tick, quick add, "סיימתי", stock count from products.
- Screenshots at 390 and 768 px before go-live.

# 006 - UX improvements

Screens follow `design/screens-v2/*.png` (v2 redesign).
- Item emoji: a pure name map with a category fallback (`itemEmoji`), no schema change. Native emoji in the app.
- Catalog: category filter pills; tapping a card opens edit (accessible name "עריכת <name>").
- Stock count: focused view with back button and no tab bar.
- Header shows sync status: synced, offline, or waiting to send.
- Item form: cadence as radio pills; settings: safety margin as a stepper.
- Trip: total cost, progress "N מתוך M נאספו" with bar; per store "N פריטים" and total or "אין מחירים"; ticked rows sink to the bottom of their group; sticky finish button; stale "next trip" recomputed when the app becomes visible.
- Stock count: its own view with sticky "סיום ספירה"; steppers use `adjust_stock`.
- Catalog: search by name or category; icon edit button; "נגמר" state reads "בקנייה הבאה".
- Item form: two groups (פרטים, כמויות), error summary, focus on first invalid field, `aria-describedby` on errors.
- Settings: household switcher, join code block with copy button, rotate code, leave household.
- App: skeleton while loading; empty-state card with actions; dismissible error banner that also clears on success; tab bar with icons and `aria-label`; `role="status"` and `aria-live` where values change.
- Ran out can be undone from the catalog card ("ביטול").
- Trip pills follow the radio group pattern (arrow keys, one tab stop).

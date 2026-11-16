# 010 - English and a help page

Operator request of 2026-11-04. Goal: the app works in English too, and a help page explains every part in plain words. Hebrew stays the default.

## A. Language
- Two languages: Hebrew (default) and English. No automatic choice: `navigator.language` is not read. Only the switch in Settings changes it.
- The choice is kept per device in localStorage (`household-shop.lang`), with try/catch like `household-shop.help-closed`. Private mode: Hebrew each time.
- `<html lang dir>` follow the choice: `he` + `rtl`, or `en` + `ltr`. The page title follows too.
- Settings: card "עזרה ושפה" with two pills, "עברית" and "English" (each in its own language), and a row that opens the help page.

## B. Strings
- `src/ui/i18n.ts`: one typed dictionary per language (`en` must have every key of `he`), a `t(key)` helper and `plural(n, one, many)`. No new dependency.
- Every visible string in `src/ui` goes through it: text, aria-label, title, placeholder, banners, day names, "today" and "tomorrow".
- Data is never translated: item, trip, store and category names the user typed, and the seeded demo data.
- Units are data too, but the known Hebrew units of the seed ("ק\"ג", "ביצה", "אריזה" and so on) are shown with an English word in English. Other units show as typed.
- Domain checks (`src/domain`) keep their Hebrew text. The UI maps the known messages to English (`domainText`), and shows any other message as is.
- Hidden parts (margin card, product types) keep their Hebrew text until they are shown again.
- Numbers and money use `Intl` with `he-IL` or `en-US`. Money stays in ₪ (ILS).

## C. Layout in LTR
- CSS uses logical properties, so the layout mirrors by itself.
- Icons with a direction (back arrow, row chevron) flip in LTR. Arrow in the use sheet: "←" in Hebrew, "→" in English.
- No wrapped labels on buttons and chips at 360 px in both languages. English labels are kept short for this.

## D. Help page ("עזרה" / "Help")
A full screen from Settings, with back to Settings. Short sections:
1. What the app does.
2. The 4 steps (same as "איך זה עובד").
3. Keep at home: the rice example (base 3 packs, used 1, the next trip fills back to 3).
4. Shop mode: list by store, the cart, quick add, "סיימתי".
5. Share the home: the join code and the invite link.
6. Offline: what works without a network.
7. AI fill ("✨ השלמה עם AI").

## Out of scope
English for the seed data, server texts (emails) and the domain error text itself.

## Tests
- The Hebrew e2e smoke test stays as is.
- New e2e: switch to English in Settings, "Go shopping" on home, `dir="ltr"`, no horizontal overflow at 320 and 768 px, open Help, switch back to Hebrew.
- Unit: every `he` key exists in `en` (types), plural and English units, domain message mapping.
- Screenshots at 360 px of home, products, use sheet, shop mode, settings and help, in both languages.

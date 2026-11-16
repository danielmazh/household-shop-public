# 011 - First-run language and English base data

Operator request of 2026-11-04: "When a user opens the app for the first time, they choose a language at the start. Then all the base products that come with the app are in English (if English was chosen). Beyond that the user can add whatever they want. If the user picks English, they do not see Hebrew at all."

## A. Language screen
- Shown before anything else (sign-in, demo mode) when `household-shop.lang` is not set.
- The app name in both languages, and two big buttons: "עברית" and "English", each in its own language. A tap saves the choice, sets `<html lang dir>` and opens the app.
- A device that already has app state (any `household-shop.*` key or a Supabase `sb-*` session key) but no language key is an old user: Hebrew is saved silently and the screen is skipped.
- Sign-out keeps the language key.

## B. Base data in the chosen language
- Demo mode: the first seed (stores, products, trips, product type names) uses the language at that moment.
- Supabase: migration 0005 adds `lang` to `create_household` (default `'he'`). `lang = 'en'` seeds English stores, products and settings. Any other value is Hebrew. Existing households never change.
- The app sends `lang` only for English, so Hebrew sign-ups keep working with the live database before 0005 runs. English needs 0005 live first.
- English seed: the same 24 products, cadences, amounts and prices as Hebrew, with neutral names (for example "Weekend", "Bread"). A unit test compares the TypeScript and SQL rows.

## C. No Hebrew in English mode
- The hidden parts (margin card, product types) go through `t()`.
- `public/lang.js` (a plain file, the CSP allows no inline script) sets `<html lang dir>`, the title, the description and the manifest href before the first paint. Two web manifests: `manifest.webmanifest` and `manifest.en.webmanifest`. `applyLang` does the same on a switch.
- Domain messages that were not mapped yet get English words. The AI asks Gemini for English name and category when the app is in English (`lang` in the request body, default Hebrew).
- Product emoji know the English seed names.

## D. Sign-in email
- `signInWithOtp` sends `options.data.lang`. Supabase keeps it in user metadata on sign-up. After sign-in the app updates the metadata when the device language differs, so the next email matches.
- Bilingual templates in `supabase/templates/` use `{{ if eq (printf "%v" .Data.lang) "en" }}` (safe when lang is missing). They are applied by hand in the Supabase dashboard.

## Tests
- Unit: English seed has the same counts and shape as Hebrew and no Hebrew letters; SQL rows match; `readQuery` reads `lang`.
- e2e: a fresh context shows the language screen; English gives `dir=ltr`, English products, and no Hebrew letters on home, products, settings, help and shop mode. Old tests set the language before load.
- Screenshots at 360 px of the language screen and English products.

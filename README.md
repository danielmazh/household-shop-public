# Household Shop

A shared shopping list for one household. It is an installable web app (PWA) with a Hebrew, right-to-left UI built for phones.

The goal is fewer store runs. Dry goods are bought in bulk once a week. Fresh food is bought twice a week. Shabbat items are bought before Shabbat. Two or more people share one live list. Stock changes are sent as "add or remove this much", so two phones never overwrite each other.

## How it works

- **Catalog.** Each item has a cadence (`bulk`, `fresh`, `shabbat`, `friday`), one of the household's stores, weekly use, pack size, an optional price and the stock at home.
- **Trips.** Main trip on Tuesday carries `bulk` for a full week and `fresh` for half a week. Shabbat trip on Thursday carries `fresh` for half a week and `shabbat` for a full week. Friday trip carries `friday`. These are only the defaults: each household sets its own 1 to 7 trips, their days and what each one carries. A cadence on N trips gets 1/N of the weekly use on each.
- **Quantity rule.** `target = weeklyUse * share * (1 + margin)`, `packs = ceil(max(0, target - stock) / packSize)`. The default margin is 10%. A "ran out" item gets at least one pack and goes on the next trip, whatever its cadence.
- **Shopping.** The app opens on the next trip. The list is grouped by store and category, with a total per store when prices exist. Tick items as you shop, then tap "finish trip". Ticked packs are added to stock.

Details are in [docs/specs](docs/specs).

## Run locally

```sh
npm install
npm run dev
```

Without Supabase settings the app runs in local demo mode. Data stays in this browser only.

Other scripts:

| script | what it does |
|---|---|
| `npm run check` | typecheck, lint and unit tests |
| `npm run test:e2e` | Playwright smoke test in demo mode |
| `npm run build` | production build to `dist/` |
| `npm run preview` | serve the build |
| `npm run icons` | make the PNG icons from the SVG icons |

## Supabase setup

Use a Supabase organization and project only for this app, so nothing is shared with other projects.

1. In Supabase, create a new organization (Free plan), then a new project in it.
2. In the SQL editor, run `supabase/migrations/0001_init.sql`. It is safe to run again, and it also upgrades a database that ran an older version.
3. Authentication, Sign In / Providers: enable Email (magic link).
   Then in Authentication, Emails, Magic Link template, add the code next to the link, for example `<p>Or type this code in the app: {{ .Token }}</p>`. The installed iOS app needs it: there the link opens in Safari, so the user types the code instead.
4. Authentication, URL Configuration: set the Site URL to `https://household-shop.pages.dev/`. Add the redirect URLs `https://household-shop.pages.dev/` and, for local dev, `http://localhost:5173/`.
5. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the project API settings. Every `.env*` file except `.env.example` is ignored by git.

Sign-in uses a magic link with PKCE, so open the link in the same browser that asked for it, or type the code from the same email. Offline with an expired session, the app opens on the cached data and asks to sign in only when the network is back and the session cannot be renewed.

After sign-in, a user creates a household (it starts with the default catalog) or joins one with a code. Settings show the join code, can make a new code, switch between households, add one more, or leave. A user can belong to many households and create up to 5. Wrong join codes are limited to 10 per hour. A household has up to 50 active stores (200 in all) and 500 active items (2000 in all).

## Cloudflare Pages setup

1. In Cloudflare, Workers & Pages, create a Pages project named `household-shop` with Direct Upload. The site is `https://household-shop.pages.dev/`.
2. Create an API token with only the permission Account, Cloudflare Pages, Edit.
3. Note the account ID.

## GitHub secrets

| secret | value |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon (public) key |
| `CLOUDFLARE_API_TOKEN` | the Pages Edit token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |

## Deploy

Work on `dev`. A merge to `main` runs `.github/workflows/deploy.yml`: check, build with the Supabase secrets, then `wrangler pages deploy dist --project-name=household-shop --branch=main`. CI (`ci.yml`) runs `npm run check` on every push and pull request. Dependabot opens weekly update PRs into `dev`.

The build adds a Content Security Policy meta tag (only this origin and the Supabase host) and writes `dist/_headers` for Cloudflare with the same policy and other security headers. It also gives the service worker a cache name with the build hash and the list of files to precache.

## Free plan limits

- Supabase Free: a project pauses after 7 days without activity. Open the dashboard to restore it. Small database and auth email limits apply.
- Cloudflare Pages Free: enough for this app (500 builds a month; this repo builds in GitHub Actions and only uploads).

## Project layout

```
src/domain   pure logic: types, validation, seed, schedule, planner (unit tested)
src/data     Store interface, LocalStore (demo), SupabaseStore
src/ui       Preact components, no business rules
public       manifest, icons, service worker
build        Vite plugin: CSP, Cloudflare headers, service worker file list
scripts      icon generator (npm run icons)
supabase     SQL migration
tests/e2e    Playwright smoke test
docs/specs   specs, the source of truth
```

## License

MIT

The Rubik font in `src/ui/fonts/` (Hebrew and Latin subsets of the variable font, from the npm package `@fontsource-variable/rubik`) is under the SIL Open Font License 1.1. The license text is in `src/ui/fonts/OFL.txt`. The font is served from the app's own origin, so it works under the CSP and offline.

## About this copy

This is the public copy of a private repository. It has no history. Left out on purpose: the household data script, design files and screenshots (they show third-party emoji art), the store screenshots and the deploy workflow. The contact address in `public/privacy.html` is a placeholder: put your own before you publish the page.

Code is under the MIT license (see `LICENSE`). The Rubik font is under the SIL Open Font License (see `src/ui/fonts/OFL.txt`).

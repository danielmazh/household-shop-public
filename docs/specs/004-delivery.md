# 004 - Delivery

## Hosting
Cloudflare Pages, free plan, dedicated project `household-shop` on its own origin (`household-shop.pages.dev`). Nothing shared with other apps: own origin, own storage, own Supabase project in its own Supabase organization (free plan).

## CI/CD (GitHub Actions)
- `ci.yml` on every push and PR: `npm ci`, `npm run check`. Concurrency cancels old runs.
- `deploy.yml` on push to `main`: check, build with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, deploy with Wrangler using `CLOUDFLARE_API_TOKEN` (Pages edit only) and `CLOUDFLARE_ACCOUNT_ID`.
- Least privilege: `contents: read`; secrets only in the steps that need them; actions pinned by full SHA; Dependabot for actions and npm.
- Branches: work on `dev`, release by merge to `main`.

## Hardening
- CSP meta tag injected at build: self only, plus the Supabase origin in `connect-src`. `referrer` no-referrer.
- `public/_headers` for Cloudflare: CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors 'none'`, `Strict-Transport-Security` (1 year), `Cross-Origin-Opener-Policy: same-origin`.
- Service worker cache name holds the build hash; the shell and all built assets are precached; only `ok` responses are cached; old caches deleted on activate.
- PNG icons 180, 192, 512.

## Release check (once, at the end)
`npm run check`, `npm run build`, Playwright smoke in demo mode, visual check against `design/screens`.

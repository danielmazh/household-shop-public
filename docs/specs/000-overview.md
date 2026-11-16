# 000 - Overview

## Goal
Cut store runs. Buy dry goods in bulk once a week at the cheapest store, fresh food twice a week, Shabbat items before Shabbat. Two or more household members share one live list.

## Users
Household members on phones. Hebrew UI, RTL, mobile first, installable (PWA).

## Scope v1
- 001 Catalog: products with cadence, store, weekly use, pack size, price.
- 002 Trip planner: per-trip list from weekly use minus stock, grouped by store.
- 003 Sync and auth: Supabase, email sign-in, shared households with two or more members.
- 004 Delivery: Cloudflare Pages via GitHub Actions.
- 005 Design system: tokens from the Pencil design.
- 006 UX improvements.
- 007 Flexible setup: per-household stores, trips, days and labels.
- 008 Smart catalog, plain language, personal area and feedback.

## Out of scope v1
Automatic chain price comparison, receipts, budgets, notifications.

## Constraints
- Standalone repo. No shared code, config, or cloud resources with other projects.
- No PII or secrets in git. Supabase URL and anon key come from env at build time.
- Every commit passes `npm run check` (typecheck, lint, unit tests).

## Architecture
- `src/domain` - pure logic, no I/O. Fully unit tested.
- `src/data` - `Store` interface. `LocalStore` (localStorage, demo and offline cache) and `SupabaseStore`.
- `src/ui` - Preact components. Thin, no business rules.
- Stack: Vite, TypeScript strict, Preact, Vitest, ESLint, Playwright (one smoke test).

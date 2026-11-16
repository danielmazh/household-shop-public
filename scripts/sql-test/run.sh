#!/usr/bin/env bash
# Runs every migration twice on a throwaway local Postgres 16 (Docker), then
# the behave*.sql checks and the data script on a fixture. Never touches the live database.
# Usage: bash scripts/sql-test/run.sh   (DOCKER=podman to use Podman)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$here/../.."
name=hs-pg-test
docker="${DOCKER:-docker}"
"$docker" rm -f "$name" >/dev/null 2>&1 || true
"$docker" run -d --name "$name" -e POSTGRES_PASSWORD=pw docker.io/library/postgres:16-alpine >/dev/null
trap '"$docker" rm -f "$name" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do "$docker" exec "$name" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 2
"$docker" cp "$here/stub.sql" "$name:/stub.sql"
for f in "$here"/*.sql; do "$docker" cp "$f" "$name:/$(basename "$f")"; done
"$docker" cp "$root/supabase/data" "$name:/data" 2>/dev/null || true
"$docker" cp "$root/supabase/migrations" "$name:/mig"
psql() { "$docker" exec -e PGOPTIONS="-c client_min_messages=warning" "$name" psql -q -v ON_ERROR_STOP=1 -U postgres "$@"; }
psql -f /stub.sql 2>/dev/null
for round in 1 2; do
  for f in $("$docker" exec "$name" ls /mig | sort); do
    psql -f "/mig/$f" >/dev/null
  done
  echo "round $round: all migrations ran"
done
for f in $(cd "$here" && ls behave*.sql | sort); do
  psql -f "/$f" >/dev/null
  echo "$f passed"
done
# One-off data scripts: on a fixture, twice, then their checks.
if [ -e "$here/fixture-our-home.sql" ]; then
  psql -f /fixture-our-home.sql >/dev/null
  for round in 1 2; do
    psql -f /data/2026-11-07-our-home-defaults.sql >/dev/null
    echo "data script round $round ran"
  done
  psql -f /check-our-home.sql
  echo "check-our-home.sql passed"
fi

#!/usr/bin/env bash
#
# Runs the real migration and the SQL test suite against a real, ephemeral
# PostgreSQL 16 cluster. No Docker, no network, no Supabase account required.
#
# This is what makes "the migration is valid" a tested claim rather than an
# assertion about how the SQL reads. It proves: the migration applies cleanly,
# constraints and triggers fire, and — most importantly — the RLS policies
# actually deny a second user, executed as the non-superuser `authenticated`
# role that PostgREST uses in production.
#
# What it does NOT prove: that the hosted Supabase project is configured
# correctly. That still requires the real project.
#
#   npm run test:db

set -euo pipefail

PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d /tmp/contextshelf-pgtest.XXXXXX)"
SOCK="$WORK/sock"
DATA="$WORK/data"
DB=contextshelf_test

# Postgres refuses to run as root; drop to the `postgres` system user if we are.
RUNAS=""
if [ "$(id -u)" -eq 0 ]; then
  RUNAS="postgres"
fi

cleanup() {
  if [ -d "$DATA" ]; then
    as_pg "$PG_BIN/pg_ctl -D '$DATA' -m immediate stop" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

as_pg() {
  if [ -n "$RUNAS" ]; then
    su "$RUNAS" -s /bin/bash -c "$1"
  else
    bash -c "$1"
  fi
}

mkdir -p "$DATA" "$SOCK"
if [ -n "$RUNAS" ]; then
  chown -R "$RUNAS" "$WORK"
fi

echo "==> initdb (PostgreSQL $("$PG_BIN/postgres" --version | awk '{print $3}'))"
as_pg "$PG_BIN/initdb -D '$DATA' -U postgres -A trust --no-sync" >"$WORK/initdb.log" 2>&1

echo "==> starting ephemeral cluster"
as_pg "$PG_BIN/pg_ctl -D '$DATA' -l '$WORK/postgres.log' -w -o \"-k '$SOCK' -h '' -c fsync=off\" start" >/dev/null

psql_run() {
  as_pg "psql -v ON_ERROR_STOP=1 -h '$SOCK' -U postgres -d '$1' -q -f '$2'"
}

as_pg "psql -h '$SOCK' -U postgres -d postgres -q -c 'create database $DB'"

echo "==> applying Supabase shim (auth schema + roles)"
psql_run "$DB" "$ROOT/supabase/tests/00_supabase_shim.sql"

echo "==> applying migrations"
for migration in "$ROOT"/supabase/migrations/*.sql; do
  echo "    $(basename "$migration")"
  psql_run "$DB" "$migration"
done

status=0
for suite in "$ROOT"/supabase/tests/*.test.sql; do
  name="$(basename "$suite")"
  echo "==> $name"
  if psql_run "$DB" "$suite"; then
    echo "    PASS"
  else
    echo "    FAIL"
    status=1
  fi
done

if [ "$status" -eq 0 ]; then
  echo "==> all database tests passed"
else
  echo "==> database tests FAILED"
fi
exit "$status"

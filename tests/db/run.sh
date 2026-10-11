#!/usr/bin/env bash
# Applies the Supabase migrations to a throwaway Postgres (15 or newer) and
# runs the access rule tests. Usage: npm run test:db
# Set PG_BIN to the folder holding initdb/pg_ctl if they aren't on PATH.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
bin="${PG_BIN:-}"
if [ -z "$bin" ]; then
  if command -v initdb >/dev/null; then bin="$(dirname "$(command -v initdb)")"
  else bin="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"; fi
fi
[ -x "$bin/initdb" ] || { echo "Postgres not found. Install Postgres 15+ or set PG_BIN." >&2; exit 1; }

# Postgres refuses to run as root, so run it as the postgres user if needed.
run() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/sh -c "$*"; else sh -c "$*"; fi; }

data="$(mktemp -d)"
chmod 755 "$data"
[ "$(id -u)" = 0 ] && chown postgres "$data"
port="${PG_TEST_PORT:-54329}"
cleanup() { run "'$bin/pg_ctl' -D '$data/db' -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$data"; }
trap cleanup EXIT

run "'$bin/initdb' -D '$data/db' -U postgres --auth=trust >/dev/null"
run "'$bin/pg_ctl' -D '$data/db' -o '-p $port -k $data -c listen_addresses=' -l '$data/log' -w start >/dev/null"

psql_run() { run "'$bin/psql' -h '$data' -p $port -U postgres -d postgres -v ON_ERROR_STOP=1 -q $*"; }
psql_run "-f '$here/supabase-stub.sql'" >/dev/null
for f in "$root"/supabase/migrations/*.sql; do psql_run "-f '$f'" >/dev/null; done
psql_run "-f '$here/rls.test.sql'" 2>&1 >/dev/null | sed -e 's/^psql:[^ ]* NOTICE:  /  /' -e 's/^NOTICE:  /  /'

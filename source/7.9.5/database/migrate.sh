#!/usr/bin/env bash
# 7.9.5 carries schema version 29 forward with no DDL change. Migration is the
# idempotent schema re-apply below; the API adds its runtime columns and
# indexes itself at startup. This script does not copy data from another
# release database.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MYSQL_BIN="${MYSQL_BIN:-$(command -v mysql || true)}"
MYSQL_DATABASE="${MYSQL_DATABASE:-jeauditflow_795}"
DB_PORT="${DB_PORT:-43327}"
[[ -n "$MYSQL_BIN" && -x "$MYSQL_BIN" ]] || { printf 'Install the native MySQL client first.\n' >&2; exit 1; }
[[ "$MYSQL_DATABASE" == jeauditflow_795 ]] || { printf 'This scaffold targets only jeauditflow_795.\n' >&2; exit 1; }
[[ "$DB_PORT" =~ ^[0-9]+$ ]] && ((DB_PORT > 0 && DB_PORT < 65536)) || exit 1
[[ -n "${MYSQL_DEFAULTS_FILE:-}" && -f "$MYSQL_DEFAULTS_FILE" ]] ||
  { printf 'Set MYSQL_DEFAULTS_FILE to the protected native MySQL client config.\n' >&2; exit 1; }
[[ "${1:-}" == --confirm && "${2:-}" == "APPLY jeauditflow_795" && $# == 2 ]] ||
  { printf 'Usage: bash %s --confirm "APPLY jeauditflow_795"\n' "${0##*/}" >&2; exit 1; }
MYSQL_COMMAND=("$MYSQL_BIN" "--defaults-file=$MYSQL_DEFAULTS_FILE" --protocol=TCP
  --host=127.0.0.1 "--port=$DB_PORT" "--database=$MYSQL_DATABASE")
for schema in "$SCRIPT_DIR/schema"/*.sql; do
  [[ -f "$schema" ]] || continue
  "${MYSQL_COMMAND[@]}" <"$schema"
done
printf 'Schema 29 is current in jeauditflow_795 (no 7.9.5 DDL change). Start the API to apply its runtime column upgrades.\n'

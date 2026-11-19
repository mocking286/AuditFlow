#!/usr/bin/env bash
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
MYSQL_COMMAND=("$MYSQL_BIN" "--defaults-file=$MYSQL_DEFAULTS_FILE" --protocol=TCP
  --host=127.0.0.1 "--port=$DB_PORT" "--database=$MYSQL_DATABASE")
if [[ "${0##*/}" == healthcheck.sh ]]; then
  "${MYSQL_COMMAND[@]}" -Nse 'SELECT DATABASE(), @@port, @@default_storage_engine, 1'
  exit 0
fi
[[ "${1:-}" == --confirm && "${2:-}" == "APPLY jeauditflow_795" && $# == 2 ]] ||
  { printf 'Usage: bash %s --confirm "APPLY jeauditflow_795"\n' "${0##*/}" >&2; exit 1; }
for schema in "$SCRIPT_DIR/schema"/*.sql; do
  [[ -f "$schema" ]] || continue
  "${MYSQL_COMMAND[@]}" <"$schema"
done
printf 'Applied the 7.9 candidate native MySQL schema to jeauditflow_795.\n'

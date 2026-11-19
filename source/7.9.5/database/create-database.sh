#!/usr/bin/env bash
# Creates the jeauditflow_795 database and its application account.
# Run once as a MySQL administrator before install-schema.sh.
set -euo pipefail
MYSQL_BIN="${MYSQL_BIN:-$(command -v mysql || true)}"
MYSQL_DATABASE="${MYSQL_DATABASE:-jeauditflow_795}"
MYSQL_USER="${MYSQL_USER:-jeauditflow}"
DB_PORT="${DB_PORT:-43327}"
[[ -n "$MYSQL_BIN" && -x "$MYSQL_BIN" ]] || { printf 'Install the native MySQL client first.\n' >&2; exit 1; }
[[ "$MYSQL_DATABASE" == jeauditflow_795 ]] || { printf 'This scaffold targets only jeauditflow_795.\n' >&2; exit 1; }
[[ "$MYSQL_USER" =~ ^[A-Za-z0-9_]{1,32}$ ]] || { printf 'MYSQL_USER must be 1-32 letters, digits or underscores.\n' >&2; exit 1; }
[[ -n "${MYSQL_PASSWORD:-}" ]] || { printf 'Set MYSQL_PASSWORD to the application account password.\n' >&2; exit 1; }
[[ "$MYSQL_PASSWORD" != change-this-local-password ]] || { printf 'Replace the example MYSQL_PASSWORD first.\n' >&2; exit 1; }
[[ -n "${MYSQL_ADMIN_DEFAULTS_FILE:-}" && -f "$MYSQL_ADMIN_DEFAULTS_FILE" ]] ||
  { printf 'Set MYSQL_ADMIN_DEFAULTS_FILE to a protected client config for a MySQL administrator.\n' >&2; exit 1; }
[[ "${1:-}" == --confirm && "${2:-}" == "CREATE jeauditflow_795" && $# == 2 ]] ||
  { printf 'Usage: bash %s --confirm "CREATE jeauditflow_795"\n' "${0##*/}" >&2; exit 1; }
password_sql="${MYSQL_PASSWORD//\\/\\\\}"
password_sql="${password_sql//\'/\\\'}"
"$MYSQL_BIN" "--defaults-file=$MYSQL_ADMIN_DEFAULTS_FILE" --protocol=TCP --host=127.0.0.1 "--port=$DB_PORT" <<SQL
create database if not exists \`$MYSQL_DATABASE\` character set utf8mb4 collate utf8mb4_unicode_ci;
create user if not exists '$MYSQL_USER'@'127.0.0.1' identified by '$password_sql';
create user if not exists '$MYSQL_USER'@'localhost' identified by '$password_sql';
grant all privileges on \`$MYSQL_DATABASE\`.* to '$MYSQL_USER'@'127.0.0.1';
grant all privileges on \`$MYSQL_DATABASE\`.* to '$MYSQL_USER'@'localhost';
flush privileges;
SQL
printf 'Created database %s and account %s on 127.0.0.1:%s.\n' "$MYSQL_DATABASE" "$MYSQL_USER" "$DB_PORT"

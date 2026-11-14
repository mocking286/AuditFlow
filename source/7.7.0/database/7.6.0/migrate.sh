#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$root_dir"

source "$root_dir/lib/mysql-common.sh"

confirm="${JEAUDITFLOW_CONFIRM:-${JEAFLOW_CONFIRM:-}}"
mysql_url="${AUDITFLOW_MYSQL_URL:-${MYSQL_URL:-}}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --confirm)
      [[ $# -ge 2 ]] || { printf '%s\n' '--confirm requires the exact confirmation phrase' >&2; exit 2; }
      confirm="$2"
      shift 2
      ;;
    --help|-h)
      printf '%s\n' 'Usage: ./migrate.sh [--confirm "APPLY <database>"] [mysql://user:password@host:port/database]'
      printf '%s\n' 'The URL may also be supplied through AUDITFLOW_MYSQL_URL or MYSQL_URL.'
      exit 0
      ;;
    -*)
      printf 'Unknown option: %s\n' "$1" >&2
      exit 2
      ;;
    *)
      [[ -z "${mysql_url_arg_seen:-}" ]] || { printf '%s\n' 'Only one MySQL URL may be supplied.' >&2; exit 2; }
      mysql_url="$1"
      mysql_url_arg_seen=1
      shift
      ;;
  esac
done

if [[ -z "$mysql_url" ]]; then
  printf '%s\n' 'Usage: migrate.sh mysql://user:password@host:port/database' >&2
  printf '%s\n' 'Or set AUDITFLOW_MYSQL_URL / MYSQL_URL. No credentials are stored in this package.' >&2
  exit 2
fi

if [[ "$mysql_url" != mysql://* ]]; then
  printf '%s\n' 'Only mysql:// URLs are accepted by this migration helper.' >&2
  exit 2
fi

url_body="${mysql_url#mysql://}"
[[ "$url_body" == */* ]] || { printf '%s\n' 'The MySQL URL must include /database.' >&2; exit 2; }
authority="${url_body%%/*}"
database="${url_body#*/}"
userpass="${authority%@*}"
hostport="${authority#*@}"
user="${userpass%%:*}"
password="${userpass#*:}"
host="${hostport%%:*}"
port="${hostport#*:}"
[[ "$hostport" == *:* ]] || port=3306
[[ -n "$database" ]] || { printf '%s\n' 'The MySQL URL must include a target database.' >&2; exit 2; }

mysql_require_confirmation "APPLY $database" "$confirm"

for schema in schema/*.sql; do
  printf 'Applying %s to %s/%s\n' "$schema" "$host" "$database"
  MYSQL_PWD="$password" mysql --protocol=tcp --host="$host" --port="$port" --user="$user" "$database" < "$schema"
done
printf '%s\n' 'JEAuditFlow 7.6.0 schema migration completed.'

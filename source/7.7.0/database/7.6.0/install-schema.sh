#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$root_dir"

source "$root_dir/lib/mysql-common.sh"

confirm="${JEAUDITFLOW_CONFIRM:-${JEAFLOW_CONFIRM:-}}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --confirm)
      [[ $# -ge 2 ]] || { printf '%s\n' '--confirm requires the exact confirmation phrase' >&2; exit 2; }
      confirm="$2"
      shift 2
      ;;
    --help|-h)
      printf '%s\n' 'Usage: ./install-schema.sh [--confirm "APPLY <database>"]'
      printf '%s\n' 'The target database is read from MYSQL_DATABASE in the shell or .env.'
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

if [[ ! -f .env ]]; then
  printf '%s\n' 'Missing .env. Copy .env.example to .env and set local credentials.' >&2
  exit 2
fi

target_database="$(mysql_database_from_env)"
mysql_require_confirmation "APPLY $target_database" "$confirm"

docker compose up -d mysql
docker compose exec -T mysql sh -c 'until mysqladmin ping -h 127.0.0.1 -u root -p"$MYSQL_ROOT_PASSWORD" --silent; do sleep 2; done'
for schema in schema/*.sql; do
  printf 'Applying %s\n' "$schema"
  docker compose exec -T mysql sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < "$schema"
done
printf '%s\n' 'JEAuditFlow 7.6.0 database schema is ready.'

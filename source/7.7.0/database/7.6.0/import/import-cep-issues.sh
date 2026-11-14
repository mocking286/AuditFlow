#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root_dir"

source "$root_dir/lib/mysql-common.sh"

confirm="${JEAUDITFLOW_CONFIRM:-${JEAFLOW_CONFIRM:-}}"
input=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --confirm)
      [[ $# -ge 2 ]] || { printf '%s\n' '--confirm requires the exact confirmation phrase' >&2; exit 2; }
      confirm="$2"
      shift 2
      ;;
    --help|-h)
      printf '%s\n' 'Usage: ./import/import-cep-issues.sh [--confirm "IMPORT CEP INTO <database>"] /path/to/TUV-Audit.xlsx'
      printf '%s\n' 'The target database is read from MYSQL_DATABASE in the shell or .env.'
      exit 0
      ;;
    -*)
      printf 'Unknown option: %s\n' "$1" >&2
      exit 2
      ;;
    *)
      [[ -z "$input" ]] || { printf '%s\n' 'Only one workbook path may be supplied.' >&2; exit 2; }
      input="$1"
      shift
      ;;
  esac
done

[[ -n "$input" ]] || { printf '%s\n' 'Usage: import/import-cep-issues.sh /path/to/TUV-Audit.xlsx' >&2; exit 2; }
[[ -f .env ]] || { printf '%s\n' 'Missing .env. Copy .env.example to .env first.' >&2; exit 2; }
target_database="$(mysql_database_from_env)"
mysql_require_confirmation "IMPORT CEP INTO $target_database" "$confirm"

sql_file="$(mktemp -t jeauditflow-cep-issues.XXXXXX.sql)"
trap 'rm -f "$sql_file"' EXIT
node import/cep-issues-to-sql.mjs --input "$input" --output "$sql_file" --project CEP
docker compose exec -T mysql sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < "$sql_file"
printf '%s\n' 'CEP issues imported into auditflow_jira_issues; ownership remains JiraFlow.'

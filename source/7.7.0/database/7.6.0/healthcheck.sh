#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$root_dir"
[[ -f .env ]] || { printf '%s\n' 'Missing .env' >&2; exit 2; }
docker compose ps --status running mysql | grep -q mysql || { printf '%s\n' 'MySQL container is not running' >&2; exit 1; }
tables="$(docker compose exec -T mysql sh -c 'mysql -N -B -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e "select table_name from information_schema.tables where table_schema=database()"')"
for required in auditflow_accounts auditflow_projects auditflow_evidence_items auditflow_fileanalyst_attachments auditflow_shared_findings auditflow_jira_issues content_objects content_revisions release_content sync_outbox sync_conflicts; do
  grep -qx "$required" <<<"$tables" || { printf 'Missing table: %s\n' "$required" >&2; exit 1; }
done
docker compose exec -T mysql sh -c 'mysqladmin ping -h 127.0.0.1 -u root -p"$MYSQL_ROOT_PASSWORD" --silent'
printf '%s\n' 'JEAuditFlow 7.6.0 database health check passed.'

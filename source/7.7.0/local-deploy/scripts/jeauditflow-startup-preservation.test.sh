#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/jeauditflow-startup-preserve.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT
export JEAUDITFLOW_RUNTIME_ROOT="$TEST_ROOT/runtime"
JEAUDITFLOW_LOCAL_TEST_SOURCE_ONLY=1 source "$SCRIPT_DIR/jeauditflow-local.sh"
NODE_BIN="$(command -v node)"
JAVA_BIN=/usr/bin/true
version=7.6.0
mkdir -p "$VERSIONS_ROOT/$version/server" "$VERSIONS_ROOT/$version/client" "$DATABASE_ROOT/$version/schema" "$ENV_ROOT"
touch "$VERSIONS_ROOT/$version/server/server.mjs" "$VERSIONS_ROOT/$version/client/index.html" \
  "$VERSIONS_ROOT/$version/client/manifest.json" "$DATABASE_ROOT/$version/schema/collaboration-schema.sql"
printf '{"defaultDatabase":"synthetic_db","persistentVolume":"synthetic_volume"}\n' > "$DATABASE_ROOT/$version/manifest.json"
select_version() { printf '%s\n' "$1"; }
load_config() {
  JEAUDITFLOW_DATABASE_MODE=native
  MYSQL_DATABASE=synthetic_db MYSQL_VOLUME_NAME=synthetic_volume
  MYSQL_USER=synthetic_user MYSQL_PASSWORD=synthetic_database_password DB_PORT=43324
  AUDITFLOW_PORT=47683 AUDITFLOW_AI_PORT=47686 FILEANALYST_PORT=47684 JIRAFLOW_PORT=47685
  AUDITFLOW_ADMIN_EMAIL=first-run@example.test
  AUDITFLOW_BOOTSTRAP_ADMIN_PASSWORD=synthetic-configured-first-run-password
}
database_schema() { printf '%s\n' "$DATABASE_ROOT/$1/schema"; }
require_runtime_tools() { :; }
require_version_database_confirmation() { :; }
assert_release_ports_available() { :; }
install_dependencies() { :; }
start_native_mysql() { :; }
apply_schema() { :; }
stop_service() { :; }
wait_for_url() { :; }
ai_bridge_smoke() { :; }
write_mcp_client_config() { :; }
set_current_version() { :; }
urls() { :; }
log() { :; }
start_process_with_env_file() {
  local service="$1" env_file="$3"
  (
    set -a
    source "$env_file"
    [[ "$AUDITFLOW_BOOTSTRAP_ADMIN_EMAIL" == first-run@example.test ]]
    [[ "$AUDITFLOW_BOOTSTRAP_ADMIN_PASSWORD" == synthetic-configured-first-run-password ]]
    [[ "${AUDITFLOW_LOCAL_ADMIN_PASSWORD_SYNC:-}" == 0 ]]
    [[ "${AUDITFLOW_RECONCILE_CORE_DIRECTORY:-}" == 0 ]]
  ) || { printf 'FAIL: %s received startup credential or directory mutation controls\n' "$service" >&2; return 1; }
}
export JEAUDITFLOW_ADMIN_EMAIL_OVERRIDE=must-not-replace@example.test
export JEAUDITFLOW_ADMIN_PASSWORD_OVERRIDE=must-not-change-existing-password
export AUDITFLOW_LOCAL_ADMIN_PASSWORD_SYNC=1
export AUDITFLOW_RECONCILE_CORE_DIRECTORY=1
start_stack "$version"
printf 'PASS: ordinary startup ignores credential overrides and disables legacy mutation controls\n'

#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/jeauditflow-770-config.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT
export JEAUDITFLOW_RUNTIME_ROOT="$TEST_ROOT/runtime"
export JEAUDITFLOW_LOCAL_CONFIG="$TEST_ROOT/config/7.7.local.env"
JEAUDITFLOW_LOCAL_TEST_SOURCE_ONLY=1 source "$SCRIPT_DIR/jeauditflow-local.sh"
CONFIG_DIR="$TEST_ROOT/config"
random_hex() { printf 'local-test-secret-%s\n' "$1"; }
docker() { printf '7.7 must not use Docker\n' >&2; return 99; }
load_config 7.7.0
NODE_BIN="$(command -v node)"
[[ "$JEAUDITFLOW_DATABASE_MODE" == native ]]
[[ "$MYSQL_DATABASE" == jeauditflow_770 && "$DB_PORT" == 43324 ]]
[[ "$MYSQL_VOLUME_NAME" == jeauditflow_770_mysql_data ]]
[[ "$AUDITFLOW_PORT" == 47683 && "$AUDITFLOW_AI_PORT" == 47686 ]]
[[ "$FILEANALYST_PORT" == 47684 && "$JIRAFLOW_PORT" == 47685 ]]
[[ "$NODE_BIN" == "$TEST_ROOT/runtime/toolchains/node-v26.13.1-darwin-arm64/bin/node" ]]
[[ "$JIRAFLOW_JAVA" == "$TEST_ROOT/runtime/toolchains/jdk-27.0.1.0.3.jdk/Contents/Home/bin/java" ]]
[[ -z "$JEAUDITFLOW_POLARION_URL" ]]
JEAUDITFLOW_POLARION_URL=http://10.20.30.40:8080/polarion/
polarion_values="$(polarion_runtime_settings)"
[[ "$polarion_values" == $'10.20.30.40\t8080\thttp:\thttp://10.20.30.40:8080/polarion/' ]]
JEAUDITFLOW_POLARION_URL=https://192.168.8.50/polarion/
polarion_values="$(polarion_runtime_settings)"
[[ "$polarion_values" == $'192.168.8.50\t443\thttps:\thttps://192.168.8.50/polarion/' ]]
JEAUDITFLOW_POLARION_URL=https://8.8.8.8/polarion/
if polarion_runtime_settings >"$TEST_ROOT/polarion.out" 2>&1; then exit 1; fi
JEAUDITFLOW_POLARION_URL=http://192.168.8.50/other/
if polarion_runtime_settings >"$TEST_ROOT/polarion.out" 2>&1; then exit 1; fi
JEAUDITFLOW_POLARION_URL=
if (require_version_database_confirmation 7.7.0) >"$TEST_ROOT/confirm.out" 2>&1; then exit 1; fi
export JEAUDITFLOW_CONFIRM_DATABASE='APPLY jeauditflow_770 ON native'
require_version_database_confirmation 7.7.0
export JEAUDITFLOW_CONFIRM_MIGRATION='COPY jeauditflow_760 TO jeauditflow_770'
[[ "$JEAUDITFLOW_CONFIRM_MIGRATION" == "COPY jeauditflow_760 TO jeauditflow_770" ]]
assert_release_ports_available() { return 0; }
mysql_container_matches_release() { return 1; }
load_config() {
  case "$1" in
    7.7.0) AUDITFLOW_PORT=47683 ;;
    7.6.0) AUDITFLOW_PORT=47583 ;;
    *) printf 'Unexpected URL test version\n' >&2; exit 1 ;;
  esac
  AUDITFLOW_LAN_HOST=192.0.2.77
  AUDITFLOW_LAN_CIDR=192.0.2.0/24
  FILEANALYST_PORT=$((AUDITFLOW_PORT + 1))
  JIRAFLOW_PORT=$((AUDITFLOW_PORT + 2))
}
urls77="$(urls --version 7.7.0)"
if [[ "$urls77" != *$'AuditFlow:   http://127.0.0.1:47683/\n'* ||
      "$urls77" != *$'LAN access:  http://192.0.2.77:47683/\n'* ]]; then
  printf 'FAIL: 7.7 must advertise the promotional root for local and LAN access\n' >&2
  exit 1
fi
urls76="$(urls --version 7.6.0)"
[[ "$urls76" == *$'AuditFlow:   http://127.0.0.1:47583/index.html\n'* ]]
[[ "$urls76" == *$'LAN access:  http://192.0.2.77:47583/index.html\n'* ]]
printf '7.7.0\n' >"$CURRENT_VERSION_FILE"
[[ "$(urls)" == "$urls77" ]]
printf 'PASS: 7.7 advertises the promotional root and 7.6 retains index.html\n'
printf 'PASS: 7.7 is version-isolated, native-only, confirmation-gated, and configured for Polarion routing\n'

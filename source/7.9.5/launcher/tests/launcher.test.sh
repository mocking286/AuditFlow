#!/bin/bash
# Unit tests for the launcher's shell logic. Runs on Linux or macOS, under the
# macOS system bash 3.2 as well as newer versions:
#   NODE=/path/to/node bash source/7.9.5/launcher/tests/launcher.test.sh
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHER="$HERE/../JEAuditFlowLauncher.app/Contents/MacOS/JEAuditFlowLauncher"
NODE="${NODE:-$(command -v node)}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/launcher-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
FAILURES=0

check() {
  if [ "$2" = "$3" ]; then printf 'ok   %s\n' "$1"
  else printf 'FAIL %s\n  expected: %s\n  actual:   %s\n' "$1" "$2" "$3"; FAILURES=$((FAILURES + 1)); fi
}

mkdir -p "$WORK/home" "$WORK/bin"
export HOME="$WORK/home" JEAUDITFLOW_LAUNCHER_SOURCE_ONLY=1 JEAUDITFLOW_LAUNCHER_NO_GUI=1
export JEAUDITFLOW_TABLEPLUS_PLIST="$HERE/fixtures/tableplus-connections.xml" JEAUDITFLOW_PLUTIL="$WORK/bin/plutil"
printf '#!/bin/bash\nfor last; do :; done\ncat "$last"\n' >"$WORK/bin/plutil"
chmod +x "$WORK/bin/plutil"
# shellcheck source=../JEAuditFlowLauncher.app/Contents/MacOS/JEAuditFlowLauncher
. "$LAUNCHER"
# shellcheck disable=SC2034 # read by the sourced launcher functions
NODE_BIN="$NODE"

# --- Wi-Fi subnet ------------------------------------------------------------
check "lan /24" "192.168.8.0/24" "$(lan_cidr 192.168.8.45 255.255.255.0)"
check "lan /20" "172.20.0.0/20" "$(lan_cidr 172.20.5.9 255.255.240.0)"
check "lan wide mask clamps to /16" "10.1.0.0/16" "$(lan_cidr 10.1.2.3 255.0.0.0)"
check "lan public address refused" "refused" "$(lan_cidr 8.8.8.8 255.255.255.0 || echo refused)"
check "lan /32 refused" "refused" "$(lan_cidr 192.168.1.2 255.255.255.255 || echo refused)"
check "lan malformed refused" "refused" "$(lan_cidr 192.168.1 255.255.255.0 || echo refused)"
check "hex netmask" "255.255.252.0" "$(mask_from_hex 0xfffffc00)"
JEAUDITFLOW_LAN_HOST=192.168.8.45 detect_lan
check "lan override" "192.168.8.45 192.168.8.0/24" "$LAN_HOST $LAN_CIDR"
JEAUDITFLOW_LAN=off JEAUDITFLOW_LAN_HOST=192.168.8.45 detect_lan
check "lan disabled" "" "$LAN_HOST$LAN_CIDR"

# --- settings file -------------------------------------------------------------
conf_set DB_PASSWORD 'p=a#s&s/ w\o"rd'
conf_set DB_USER root
conf_set DB_USER admin
check "conf keeps special characters" 'p=a#s&s/ w\o"rd' "$(conf_get DB_PASSWORD)"
check "conf overwrites" "admin" "$(conf_get DB_USER)"
check "conf has one entry per key" "1" "$(grep -c '^DB_USER=' "$SETTINGS")"
conf_unset DB_USER
check "conf unset" "" "$(conf_get DB_USER)"
check "conf mode" "600" "$(stat -c %a "$SETTINGS" 2>/dev/null || stat -f %Lp "$SETTINGS")"
check "unquote single" "{}" "$(unquote "'{}'")"
check "unquote double" "a b" "$(unquote '"a b"')"

# --- project layout ------------------------------------------------------------
PROJECT="$WORK/AuditFlowDesktop71"
RUNTIME="$PROJECT/local-deploy/runtime/versions/7.9.5"
mkdir -p "$RUNTIME/server/node_modules/mysql2" "$RUNTIME/fileanalyst" "$RUNTIME/jiraflow" "$RUNTIME/client" "$PROJECT/local-deploy/config"
: >"$RUNTIME/server/server.mjs"; : >"$RUNTIME/fileanalyst/server.mjs"; : >"$RUNTIME/jiraflow/jiraflow.jar"; : >"$RUNTIME/client/index.html"
printf 'MYSQL_DATABASE=jeauditflow_790\nDB_PORT=43326\n' >"$PROJECT/local-deploy/config/7.9.local.env"
check "7.9.0 config is not used for 7.9.5" "none" "$(project_config_for "$PROJECT" || echo none)"
cat >"$PROJECT/local-deploy/config/7.9.5.local.env" <<'EOF'
# harness config
MYSQL_DATABASE=jeauditflow_795
MYSQL_USER=jeauditflow795
MYSQL_PASSWORD=0123abcd
DB_PORT=43327
AUDITFLOW_PORT=47883
AUDITFLOW_JIRA_PORT=8080
AUDITFLOW_SSO_ENTRA_USER_MAP='{"a":"b"}'
AUDITFLOW_MYSQL_URL=mysql://must-not-leak
NODE_BIN=local-deploy/runtime/toolchains/node/bin/node
OPENAI_API_KEY=sk-test
bad-key=1
EOF
check "normalize project root" "$RUNTIME" "$(normalize_root "$PROJECT")"
set_root "$(normalize_root "$PROJECT")"
load_ports
check "project base" "$PROJECT" "$PROJECT_BASE"
check "project config" "$PROJECT/local-deploy/config/7.9.5.local.env" "$PROJECT_CONFIG"
check "ports from project config" "47883 47884 47885" "$API_PORT $FA_PORT $JF_PORT"
(
  unset AUDITFLOW_MYSQL_URL NODE_BIN
  export_project_settings
  check "project settings exported" "8080|{\"a\":\"b\"}|sk-test" "$AUDITFLOW_JIRA_PORT|$AUDITFLOW_SSO_ENTRA_USER_MAP|$OPENAI_API_KEY"
  check "database URL and NODE_BIN not taken from config" "|" "${AUDITFLOW_MYSQL_URL:-}|$(printenv NODE_BIN)"
)

# --- database candidates ---------------------------------------------------------
mkdir -p "$SUPPORT"
printf '[client]\nuser=jeauditflow\npassword=x\n' >"$SUPPORT/mysql-client.cnf"
CANDIDATES="$(db_candidates)"
check "candidate order" "tableplus:161:43327 project:95:43327 dedicated:50:43327 tableplus:11:43324 tableplus:1:3306" \
  "$(printf '%s\n' "$CANDIDATES" | awk -F '\t' '{ printf "%s%s:%s:%s", (NR > 1 ? " " : ""), $2, $1, $5 }')"
check "TablePlus secret is a Keychain reference" "keychain:5D0C3B5E-0000-4000-8000-000000000002" "$(printf '%s\n' "$CANDIDATES" | head -n 1 | cut -f3)"
check "7.7 connection targets the 7.9.5 database" "jeauditflow_795" "$(printf '%s\n' "$CANDIDATES" | awk -F '\t' '$5 == 43324 { print $7 }')"
check "project password from config" "0123abcd" "$(resolve_secret "conf:$PROJECT_CONFIG")"
check "dedicated password from cnf" "x" "$(resolve_secret "cnf:$SUPPORT/mysql-client.cnf")"
pick_tied_candidate
check "no prompt without a tie" "0" "$USER_CHOSE"

# --- dialogs ---------------------------------------------------------------------
cat >"$WORK/bin/osascript" <<'EOF'
#!/bin/bash
printf '%s\n' "$2" >>"$OSA_LOG"
printf '%s\n' "$2" | sed -n 's/.*default button "\([^"]*\)".*/\1/p'
EOF
chmod +x "$WORK/bin/osascript"
(
  export PATH="$WORK/bin:$PATH" OSA_LOG="$WORK/osa.log" JEAUDITFLOW_LAUNCHER_NO_GUI=0
  check "dialog returns the default button" "继续" "$(dialog -t 5 'say "hi" \ there' "继续" "取消")"
  check "dialog escapes quotes and backslashes" 'display dialog "say \"hi\" \\ there"' "$(grep -o 'display dialog "say \\"hi\\" \\\\ there"' "$OSA_LOG")"
  check "dialog timeout" "1" "$(grep -c 'giving up after 5' "$OSA_LOG")"
)

if [ "$FAILURES" -gt 0 ]; then printf '%s test(s) failed\n' "$FAILURES"; exit 1; fi
echo "all launcher tests passed (bash $BASH_VERSION)"

#!/bin/bash
# End-to-end test of the launcher with the real 7.9.5 API and FileAnalyst code
# and real MySQL servers. JiraFlow is replaced by a stub behind a fake `java`
# because its jar is not in the repository; Keychain/plutil/defaults are stubbed.
#
# Requires: mysqld + mysql (8.0+), Node >= 26.13.1 with npm and registry access,
# curl, lsof. Uses ports 3307, 43327, 47883-47885 and 47983-47985.
#   NODE26=/path/to/node-v26/bin BASH_UNDER_TEST=/bin/bash bash tests/launcher-e2e.sh
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$HERE/../.." && pwd)"
LAUNCHER="$HERE/../JEAuditFlowLauncher.app/Contents/MacOS/JEAuditFlowLauncher"
NODE26="${NODE26:-$(dirname "$(command -v node)")}"
BASH_UNDER_TEST="${BASH_UNDER_TEST:-bash}"
E="$(mktemp -d "${TMPDIR:-/tmp}/launcher-e2e.XXXXXX")"
TP_PASSWORD='Tp!pa:ss@w#rd /1%'
LAN_IP="${LAN_IP:-}"
FAILURES=0

check() {
  if [ "$2" = "$3" ]; then printf 'ok   %s\n' "$1"
  else printf 'FAIL %s\n  expected: %s\n  actual:   %s\n' "$1" "$2" "$3"; FAILURES=$((FAILURES + 1)); fi
}
port_up() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
mode() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }
sql() { mysql --no-defaults -h127.0.0.1 "$@" 2>/dev/null; }
start_mysqld() { # datadir port pidfile
  mysqld --no-defaults --datadir="$1" --port="$2" --bind-address=127.0.0.1 --mysqlx=OFF \
    --socket="$1.sock" --pid-file="$3" --log-error="$1.log" >/dev/null 2>&1 &
  for _ in $(seq 1 60); do [ -S "$1.sock" ] && port_up "$2" && return 0; sleep 1; done
  return 1
}
launcher() {
  env -i HOME="$E/home" USER=tester TMPDIR="${TMPDIR:-/tmp}" LANG=C.UTF-8 PATH="$E/stubs:/usr/bin:/bin:/usr/sbin:/sbin" \
    JEAUDITFLOW_LAUNCHER_NO_GUI=1 JEAUDITFLOW_NODE="$NODE26/node" JEAUDITFLOW_JAVA="$E/stubs/java" \
    JEAUDITFLOW_TABLEPLUS_PLIST="$E/Connections.plist" JEAUDITFLOW_PLUTIL="$E/stubs/plutil" \
    ${CONFIRM:+JEAUDITFLOW_CONFIRM_DATABASE="$CONFIRM"} ${LAN_IP:+JEAUDITFLOW_LAN_HOST="$LAN_IP"} \
    "$BASH_UNDER_TEST" "$LAUNCHER" "$@"
}
cleanup() {
  launcher stop-all >/dev/null 2>&1
  for pid in "$E"/*.pid; do [ -f "$pid" ] && kill "$(cat "$pid")" 2>/dev/null; done
  sleep 2
  rm -rf "$E"
}
trap cleanup EXIT

mkdir -p "$E/home" "$E/stubs" "$E/keychain"
SUPPORT="$E/home/Library/Application Support/JEAuditFlow/7.9.5"

# --- stubs -------------------------------------------------------------------
cat >"$E/stubs/security" <<EOF
#!/bin/bash
while [ \$# -gt 0 ]; do case "\$1" in -s) s="\$2"; shift ;; -a) a="\$2"; shift ;; esac; shift; done
echo "\$s \$a" >>"$E/security.log"
[ "\$s" = com.tableplus.TablePlus ] && [ -f "$E/keychain/\$a" ] && { cat "$E/keychain/\$a"; echo; exit 0; }
exit 44
EOF
printf '#!/bin/bash\nfor last; do :; done\ncat "$last"\n' >"$E/stubs/plutil"
cat >"$E/stubs/java" <<EOF
#!/bin/bash
case "\$*" in
  *XshowSettings*) echo "    java.specification.version = 21" >&2; exit 0 ;;
  -version) echo 'openjdk version "21"' >&2; exit 0 ;;
esac
while [ \$# -gt 0 ]; do case "\$1" in --host) h="\$2"; shift ;; --port) p="\$2"; shift ;; esac; shift; done
env | grep -E '^(JIRAFLOW_|AUDITFLOW_)' | sort >"$E/service-env.txt"
exec "$NODE26/node" -e 'require("http").createServer((q, r) => r.end(JSON.stringify({ status: "ok", service: "JiraFlow", version: "2.1.0" }))).listen(+process.argv[2], process.argv[1])' "\$h" "\$p"
EOF
chmod +x "$E/stubs/"*

# --- 7.9.5 install at ~/JEAuditFlow/7.9.5 ------------------------------------------
R="$E/home/JEAuditFlow/7.9.5"
mkdir -p "$R/jiraflow" "$R/client/fileanalyst"
cp -R "$SRC/backend/server" "$R/server"
cp -R "$SRC/backend/fileanalyst" "$R/fileanalyst"
cp -R "$SRC/database" "$R/database"
: >"$R/jiraflow/jiraflow.jar"
printf '<!doctype html><title>JEAuditFlow</title>\n' >"$R/client/index.html"
printf '<!doctype html><title>FileAnalyst</title>\n' >"$R/client/fileanalyst/index.html"
for dir in server fileanalyst; do
  (cd "$R/$dir" && PATH="$NODE26:$PATH" npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null) || { echo "npm ci failed"; exit 1; }
done

# --- scenario 1: the MySQL connection saved in TablePlus -------------------------------
mysqld --no-defaults --initialize-insecure --datadir="$E/tp" --log-error="$E/tp-init.log" || exit 1
start_mysqld "$E/tp" 3307 "$E/tp.pid" || { echo "test MySQL did not start"; exit 1; }
mysql --no-defaults -uroot --socket="$E/tp.sock" -e "alter user 'root'@'localhost' identified by '$TP_PASSWORD';"
printf '%s' "$TP_PASSWORD" >"$E/keychain/TP-1_database"
cat >"$E/Connections.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><array>
<dict><key>ConnectionName</key><string>Analytics</string><key>Driver</key><string>PostgreSQL</string>
<key>DatabaseHost</key><string>127.0.0.1</string><key>DatabasePort</key><string>5432</string>
<key>DatabaseUser</key><string>postgres</string><key>ID</key><string>PG-1</string></dict>
<dict><key>ConnectionName</key><string>Local MySQL</string><key>Driver</key><string>MySQL</string>
<key>DatabaseHost</key><string>localhost</string><key>DatabasePort</key><string>3307</string>
<key>DatabaseUser</key><string>root</string><key>DatabaseName</key><string></string>
<key>ID</key><string>TP-1</string><key>isOverSSH</key><integer>0</integer></dict>
</array></plist>
EOF

launcher start >"$E/out.txt" 2>&1
check "creating the database needs confirmation" "1:1" "$?:$(grep -c 'JEAUDITFLOW_CONFIRM_DATABASE' "$E/out.txt")"
CONFIRM="APPLY jeauditflow_795" launcher start >"$E/out.txt" 2>&1
check "first start" "0" "$?"
health="$(curl -fsS http://127.0.0.1:47983/api/health)"
check "API healthy in desktop role" "ok desktop" "$(printf '%s' "$health" | "$NODE26/node" -e 'const h = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(h.status, h.role)')"
check "FileAnalyst and JiraFlow healthy" "2" "$(printf '%s' "$health" | grep -oE '"(fileAnalyst|jiraFlow)":\{"available":true,"healthy":true' | wc -l | tr -d ' ')"
check "schema created" "1" "$(sql -P3307 -uroot -p"$TP_PASSWORD" -Nse "select count(*) from information_schema.tables where table_schema='jeauditflow_795' and table_name='auditflow_accounts'")"
check "admin bootstrapped" "yumeng.li@johnsonelectric.com" "$(sql -P3307 -uroot -p"$TP_PASSWORD" -Nse 'select email from jeauditflow_795.auditflow_accounts')"
check "password read from Keychain once" "1" "$(wc -l <"$E/security.log" | tr -d ' ')"
check "API received the encoded URL" "mysql://root:Tp!pa%3Ass%40w%23rd%20%2F1%25@127.0.0.1:3307/jeauditflow_795" "$(sed -n 's/^AUDITFLOW_MYSQL_URL=//p' "$E/service-env.txt")"
password="$(sed -n 's/^初始密码：//p' "$SUPPORT/admin-login.txt")"
check "admin login" "200" "$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -H 'origin: http://127.0.0.1:47983' \
  -d "{\"email\":\"yumeng.li@johnsonelectric.com\",\"password\":\"$password\"}" http://127.0.0.1:47983/api/auth/login)"
check "launcher files are private" "600 600" "$(mode "$SUPPORT/launcher.conf") $(mode "$SUPPORT/admin-login.txt")"
if [ -n "$LAN_IP" ]; then
  check "Wi-Fi listener serves the workbench" "200" "$(curl -s -o /dev/null -w '%{http_code}' "http://$LAN_IP:47983/index.html")"
  check "Wi-Fi listener keeps loopback-only endpoints" "403" "$(curl -s -o /dev/null -w '%{http_code}' "http://$LAN_IP:47983/api/health")"
fi
launcher start >"$E/out.txt" 2>&1
check "second start reuses the running stack" "1" "$(grep -c '已在运行' "$E/out.txt")"
launcher stop >/dev/null 2>&1
check "stop" "down" "$(port_up 47983 && echo up || echo down)"
NEW_PASSWORD='N3w!p@ss:word#2'
sql -P3307 -uroot -p"$TP_PASSWORD" -e "alter user 'root'@'localhost' identified by '$NEW_PASSWORD'"
printf '%s' "$NEW_PASSWORD" >"$E/keychain/TP-1_database"
launcher start >/dev/null 2>&1
check "password changed in TablePlus is picked up" "0:2" "$?:$(wc -l <"$E/security.log" | tr -d ' ')"
kill -9 "$(cat "$SUPPORT/run/api.pid")"; sleep 1
launcher start >/dev/null 2>&1
check "recovers from a crashed API" "0" "$?"
launcher stop-all >/dev/null 2>&1
check "stop-all leaves the user's MySQL running" "up" "$(port_up 3307 && echo up || echo down)"
kill "$(cat "$E/tp.pid")"; sleep 3
launcher start >"$E/out.txt" 2>&1
check "saved database down: fail, do not switch" "1:1" "$?:$(grep -c '上次使用的数据库' "$E/out.txt")"

# --- scenario 2: AuditFlowDesktop71 project with its own native MySQL ------------------
B="$E/AuditFlowDesktop71"
N="$B/local-deploy/runtime/native-mysql/7.9.5"
mkdir -p "$B/local-deploy/runtime/versions" "$B/local-deploy/config" "$N"
mv "$R" "$B/local-deploy/runtime/versions/7.9.5"
rm -rf "$E/home/Library"
mysqld --no-defaults --initialize-insecure --datadir="$N/data" --log-error="$N/initialize.log" || exit 1
start_mysqld "$N/data" 43327 "$N/mysqld.pid" || { echo "native MySQL did not start"; exit 1; }
mysql --no-defaults -uroot --socket="$N/data.sock" <<'SQL'
create database jeauditflow_795 character set utf8mb4 collate utf8mb4_unicode_ci;
create user 'jeauditflow795'@'127.0.0.1' identified by 'f00dfeedf00dfeed';
grant all privileges on jeauditflow_795.* to 'jeauditflow795'@'127.0.0.1';
SQL
for f in "$B/local-deploy/runtime/versions/7.9.5/database/schema"/*.sql; do sql -P43327 -ujeauditflow795 -pf00dfeedf00dfeed jeauditflow_795 <"$f"; done
kill "$(cat "$N/mysqld.pid")"
for _ in $(seq 1 30); do port_up 43327 || break; sleep 1; done
sleep 2
cat >"$B/local-deploy/config/7.9.5.local.env" <<'EOF'
MYSQL_DATABASE=jeauditflow_795
MYSQL_USER=jeauditflow795
MYSQL_PASSWORD=f00dfeedf00dfeed
DB_PORT=43327
AUDITFLOW_PORT=47883
FILEANALYST_PORT=47884
JIRAFLOW_PORT=47885
AUDITFLOW_BOOTSTRAP_ADMIN_PASSWORD=ProjectAdmin-0123456789
AUDITFLOW_BOOTSTRAP_MBEAL_LEAD_PASSWORD=ProjectLead-0123456789
AUDITFLOW_JIRA_PORT=8080
EOF
printf '#!/bin/bash\n[ "$*" = "read local.maplemock.jeauditflowlauncher projectRoot" ] && echo "%s"\n' "$B" >"$E/stubs/defaults"
chmod +x "$E/stubs/defaults"
printf '<plist version="1.0"><array/></plist>\n' >"$E/Connections.plist"

launcher start >"$E/out.txt" 2>&1
check "project found via the 7.7 launcher and its MySQL started" "0:1" "$?:$(grep -c '启动项目内的 MySQL' "$E/out.txt")"
check "project ports" "ok" "$(curl -fsS http://127.0.0.1:47883/api/health >/dev/null && echo ok)"
check "project settings passed through" "8080" "$(sed -n 's/^AUDITFLOW_JIRA_PORT=//p' "$E/service-env.txt")"
check "project data directory" "$B/local-deploy/runtime/data/7.9.5/auditflow" "$(sed -n 's/^AUDITFLOW_OUTPUT_DIR=//p' "$E/service-env.txt")"
check "lead assessors bootstrapped like the harness" "4" "$(sql -P43327 -ujeauditflow795 -pf00dfeedf00dfeed -Nse 'select count(*) from jeauditflow_795.auditflow_accounts')"
launcher stop-all >/dev/null 2>&1
sleep 3
check "stop-all stops the MySQL the launcher started" "down" "$(port_up 43327 && echo up || echo down)"

if [ "$FAILURES" -gt 0 ]; then printf '%s check(s) failed; logs kept in %s\n' "$FAILURES" "$E"; trap - EXIT; exit 1; fi
echo "all end-to-end checks passed"

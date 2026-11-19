#!/usr/bin/env bash
# Post-install smoke test. Signs in with an existing account and checks the
# web client, collaboration API, FileAnalyst and JiraFlow through the API.
#   VERIFY_EMAIL=admin@example.com VERIFY_PASSWORD='...' bash verify.sh [base-url]
set -euo pipefail
BASE="${1:-http://127.0.0.1:47983}"
: "${VERIFY_EMAIL:?set VERIFY_EMAIL}" "${VERIFY_PASSWORD:?set VERIFY_PASSWORD}"
jar="$(mktemp)"; trap 'rm -f "$jar"' EXIT
fail=0
check() {
  local label="$1" expected="$2"; shift 2
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' "$@")" || code=000
  if [[ "$code" == "$expected" ]]; then printf 'PASS  %-40s %s\n' "$label" "$code"
  else printf 'FAIL  %-40s got %s, expected %s\n' "$label" "$code" "$expected"; fail=1; fi
}
origin=(-H "origin: $BASE" -H 'content-type: application/json')
check "health" 200 "$BASE/api/health"
check "landing page /" 200 "$BASE/"
check "workbench /index.html" 200 "$BASE/index.html"
check "server sources are not served" 403 "$BASE/server/server.mjs"
check "API requires sign-in" 401 "$BASE/api/projects"
check "JiraFlow proxy requires sign-in" 401 "$BASE/jiraflow/api/projects"
body="$(VERIFY_EMAIL="$VERIFY_EMAIL" VERIFY_PASSWORD="$VERIFY_PASSWORD" python3 -c 'import json,os;print(json.dumps({"email":os.environ["VERIFY_EMAIL"],"password":os.environ["VERIFY_PASSWORD"]}))')"
check "sign in" 200 -c "$jar" -X POST "${origin[@]}" --data-binary @- "$BASE/api/auth/login" <<<"$body"
check "session /api/auth/me" 200 -b "$jar" "$BASE/api/auth/me"
check "collaboration compatibility" 200 -b "$jar" "$BASE/api/collaboration/compatibility"
check "project list" 200 -b "$jar" "$BASE/api/projects"
check "FileAnalyst UI" 200 -b "$jar" "$BASE/fileanalyst/"
check "JiraFlow projects" 200 -b "$jar" "$BASE/jiraflow/api/projects"
health="$(curl -s "$BASE/api/health")"
python3 - "$health" <<'PY' || fail=1
import json, sys
h = json.loads(sys.argv[1])
checks = {
  "web client ready": h["webClient"]["ready"],
  "MySQL collaboration store": h["database"]["provider"] == "mysql",
  "FileAnalyst healthy (mysql)": h["fileAnalyst"]["healthy"] and h["fileAnalyst"]["storage"] == "mysql",
  "JiraFlow healthy": h["jiraFlow"]["healthy"],
}
bad = [k for k, v in checks.items() if not v]
for k, v in checks.items(): print(("PASS  " if v else "FAIL  ") + k)
sys.exit(1 if bad else 0)
PY
curl -s -o /dev/null -b "$jar" -X POST -H "origin: $BASE" "$BASE/api/auth/logout" || true
((fail == 0)) && printf '\nAll checks passed.\n' || { printf '\nSome checks failed.\n'; exit 1; }

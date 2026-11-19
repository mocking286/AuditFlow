#!/usr/bin/env bash
# jeauditflowctl start|stop|restart|status|health|logs
set -euo pipefail
CONFIG_FILE=/etc/jeauditflow/7.9.5.env
UNITS=(jeauditflow-fileanalyst.service jeauditflow-api.service)

config_value() { sed -n "s/^$1=//p" "$CONFIG_FILE" | tail -n1; }

assert_configured() {
  [[ -r "$CONFIG_FILE" ]] || { printf 'Missing %s\n' "$CONFIG_FILE" >&2; exit 1; }
  if grep -nE '^[A-Z0-9_]+=.*<[^>]+>' "$CONFIG_FILE" >&2; then
    printf 'Replace the <...> placeholders above in %s first.\n' "$CONFIG_FILE" >&2
    exit 1
  fi
}

health() {
  local api fa jf rc=0 body
  api="$(config_value AUDITFLOW_PORT)"; fa="$(config_value FILEANALYST_PORT)"; jf="$(config_value JIRAFLOW_PORT)"
  for target in "AuditFlow API|http://127.0.0.1:${api:-47983}/api/health" \
                "FileAnalyst|http://127.0.0.1:${fa:-47984}/api/health" \
                "JiraFlow|http://127.0.0.1:${jf:-47985}/health" \
                "Web client|http://127.0.0.1:${api:-47983}/index.html"; do
    if body="$(curl -fsS -m 10 "${target#*|}" 2>/dev/null)"; then
      printf '%-14s OK    %s\n' "${target%%|*}" "$(printf '%s' "$body" | head -c 120 | tr -d '\n')"
    else
      printf '%-14s FAIL  %s\n' "${target%%|*}" "${target#*|}"; rc=1
    fi
  done
  return $rc
}

case "${1:-status}" in
  start) assert_configured; systemctl enable --now "${UNITS[@]}"; sleep 5; health ;;
  stop) systemctl stop jeauditflow-api.service jeauditflow-fileanalyst.service ;;
  restart) assert_configured; systemctl restart "${UNITS[@]}"; sleep 5; health ;;
  status) systemctl --no-pager status "${UNITS[@]}" ;;
  health) health ;;
  logs) journalctl --no-pager -n "${2:-100}" -u jeauditflow-api.service -u jeauditflow-fileanalyst.service ;;
  *) printf 'Usage: jeauditflowctl start|stop|restart|status|health|logs [lines]\n' >&2; exit 2 ;;
esac

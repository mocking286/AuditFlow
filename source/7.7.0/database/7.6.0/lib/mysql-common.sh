#!/usr/bin/env bash

mysql_database_from_env() {
  local value="${MYSQL_DATABASE:-}"

  if [[ -z "$value" && -f .env ]]; then
    value="$(awk -F= '$1 == "MYSQL_DATABASE" { value=substr($0, index($0, "=") + 1) } END { print value }' .env)"
  fi

  value="${value%$'\r'}"
  if [[ ${#value} -ge 2 && "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ ${#value} -ge 2 && "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi

  printf '%s' "${value:-jeauditflow_760}"
}

mysql_require_confirmation() {
  local expected="$1"
  local supplied="${2:-}"

  if [[ -z "$supplied" && -t 0 ]]; then
    printf 'Type "%s" to continue: ' "$expected"
    IFS= read -r supplied
  fi

  if [[ "$supplied" != "$expected" ]]; then
    printf 'Action-time confirmation required; expected exactly: %s\n' "$expected" >&2
    return 3
  fi
}

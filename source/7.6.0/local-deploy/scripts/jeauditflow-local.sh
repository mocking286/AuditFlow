#!/usr/bin/env bash
set -euo pipefail

# Reusable local harness for JEAuditFlow backend releases.
# It owns only the dedicated 6.9+ stack and never removes Docker volumes.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$DEPLOY_ROOT/.." && pwd)"
SYSTEM_PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH="$SYSTEM_PATH${PATH:+:$PATH}"
CONFIG_DIR="$DEPLOY_ROOT/config"
CONFIG_FILE="${JEAUDITFLOW_LOCAL_CONFIG:-}"
CONFIG_VERSION=""
RUNTIME_ROOT="${JEAUDITFLOW_RUNTIME_ROOT:-$DEPLOY_ROOT/runtime}"
VERSIONS_ROOT="$RUNTIME_ROOT/versions"
DATABASE_ROOT="$RUNTIME_ROOT/database"
LOG_ROOT="$RUNTIME_ROOT/logs"
PID_ROOT="$RUNTIME_ROOT/pids"
ENV_ROOT="$RUNTIME_ROOT/env"
CURRENT_LINK="$RUNTIME_ROOT/current"
CURRENT_VERSION_FILE="$RUNTIME_ROOT/current-version"
COMPOSE_FILE="$DEPLOY_ROOT/docker/compose.yaml"
COMPOSE_PROJECT="${JEAUDITFLOW_COMPOSE_PROJECT:-}"
MYSQL_CONTAINER="${JEAUDITFLOW_MYSQL_CONTAINER:-}"
AI_BRIDGE_PORT="${AUDITFLOW_AI_PORT:-46976}"
DEFAULT_RELEASE_VERSION="${JEAUDITFLOW_DEFAULT_VERSION:-7.6.0}"
DEFAULT_RELEASE_DIR="$PROJECT_ROOT/artifacts/releases/$DEFAULT_RELEASE_VERSION"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
JAVA_BIN="${JIRAFLOW_JAVA:-$(command -v java || true)}"
TMUX_BIN="${TMUX_BIN:-$(command -v tmux || true)}"
TMUX_SESSION="${JEAUDITFLOW_TMUX_SESSION:-}"

log() { printf '[jeauditflow-local] %s\n' "$*"; }
warn() { printf '[jeauditflow-local] warning: %s\n' "$*" >&2; }
die() { printf '[jeauditflow-local] error: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage:
  jeauditflow-local.sh install [--release-dir DIR|--backend ZIP] [--web-client ZIP] [--database ZIP]
  jeauditflow-local.sh install-client --version VERSION --web-client ZIP
  jeauditflow-local.sh use [--release-dir DIR|--backend ZIP] [--database ZIP]
  jeauditflow-local.sh start [--version VERSION]
  jeauditflow-local.sh stop
  jeauditflow-local.sh restart [--version VERSION]
  jeauditflow-local.sh status
  jeauditflow-local.sh health
  jeauditflow-local.sh config --version VERSION
  jeauditflow-local.sh mcp-config --version VERSION
  jeauditflow-local.sh ai-smoke
  jeauditflow-local.sh logs [SERVICE]
  jeauditflow-local.sh urls

The default release is artifacts/releases/7.6.0. Runtime data is kept under
local-deploy/runtime/<version> and each release selects its own named Docker
volume. The launcher never runs `docker compose down -v`.
EOF
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

require_node() {
  [[ -n "$NODE_BIN" && -x "$NODE_BIN" ]] || die "Node.js 20+ is required; set NODE_BIN explicitly"
  local node_version node_major
  node_version="$("$NODE_BIN" --version 2>/dev/null || true)"
  node_major="${node_version#v}"
  node_major="${node_major%%.*}"
  [[ "$node_major" =~ ^[0-9]+$ ]] && (( node_major >= 20 )) ||
    die "Node.js 20+ is required; found ${node_version:-an unusable Node.js executable}"
}

require_runtime_tools() {
  require_node
  require_command docker
  require_command curl
  require_command unzip
  [[ -n "$JAVA_BIN" && -x "$JAVA_BIN" ]] || die "Java 21+ is required for JiraFlow; set JIRAFLOW_JAVA explicitly"
}

ensure_dirs() {
  mkdir -p "$CONFIG_DIR" "$VERSIONS_ROOT" "$DATABASE_ROOT" "$LOG_ROOT" "$PID_ROOT" "$ENV_ROOT"
  chmod 700 "$CONFIG_DIR" "$RUNTIME_ROOT" "$LOG_ROOT" "$PID_ROOT" "$ENV_ROOT" 2>/dev/null || true
}

env_value_from_container() {
  local key="$1"
  docker inspect "$MYSQL_CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null |
    awk -F= -v wanted="$key" '$1 == wanted {sub(/^[^=]*=/, ""); print; exit}'
}

port_from_container() {
  docker inspect "$MYSQL_CONTAINER" --format '{{(index (index .NetworkSettings.Ports "3306/tcp") 0).HostPort}}' 2>/dev/null || true
}

random_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    require_node
    "$NODE_BIN" -e 'console.log(require("node:crypto").randomBytes(Number(process.argv[1])).toString("hex"))' "$1"
  fi
}

ensure_config() {
  ensure_dirs
  if [[ -f "$CONFIG_FILE" ]]; then
    chmod 600 "$CONFIG_FILE" 2>/dev/null || true
    return
  fi

  local old_db old_user old_pw old_root old_port old_volume
  local default_db=jeauditflow_690 default_db_port=43308 default_auditflow_port=46973
  local default_ai_port=46976 default_fileanalyst_port=46974 default_jiraflow_port=46975
  local default_user=jeauditflow default_volume=jeauditflow_690_local default_compose=jeauditflow69-local
  local default_mcp_key=""
  if [[ "$CONFIG_VERSION" == 7.* ]]; then
    local release_digits="${CONFIG_VERSION//./}"
    default_db="jeauditflow_${release_digits}"
    default_user="jeauditflow${release_digits}"
    default_auditflow_port=47073
    default_ai_port=47076
    default_fileanalyst_port=47074
    default_jiraflow_port=47075
    case "$CONFIG_VERSION" in
      7.1.*) default_db_port=43318 ;;
      7.2.*)
        default_db_port=43319
        default_auditflow_port=47173
        default_ai_port=47176
        default_fileanalyst_port=47174
        default_jiraflow_port=47175
        ;;
      7.3.*)
        default_db_port=43320
        default_auditflow_port=47273
        default_ai_port=47276
        default_fileanalyst_port=47274
        default_jiraflow_port=47275
        ;;
      7.4.*)
        default_db_port=43321
        default_auditflow_port=47373
        default_ai_port=47376
        default_fileanalyst_port=47374
        default_jiraflow_port=47375
        ;;
      7.5.*)
        default_db_port=43322
        default_auditflow_port=47483
        default_ai_port=47486
        default_fileanalyst_port=47484
        default_jiraflow_port=47485
        ;;
      7.6.*)
        default_db_port=43323
        default_auditflow_port=47583
        default_ai_port=47586
        default_fileanalyst_port=47584
        default_jiraflow_port=47585
        ;;
      *) default_db_port=43318 ;;
    esac
    default_volume="${default_db}_mysql_data"
    default_compose="jeauditflow${release_digits}-local"
    default_mcp_key="$(random_hex 32)"
  fi
  old_db=""
  old_user=""
  old_pw=""
  old_root=""
  old_port=""
  old_volume=""
  if [[ "$CONFIG_VERSION" == 6.9.* || -z "$CONFIG_VERSION" ]]; then
    old_db="$(env_value_from_container MYSQL_DATABASE)"
    old_user="$(env_value_from_container MYSQL_USER)"
    old_pw="$(env_value_from_container MYSQL_PASSWORD)"
    old_root="$(env_value_from_container MYSQL_ROOT_PASSWORD)"
    old_port="$(port_from_container)"
    old_volume="$(docker inspect "$MYSQL_CONTAINER" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/mysql"}}{{.Name}}{{end}}{{end}}' 2>/dev/null || true)"
  fi
  umask 077
  {
    printf '%s\n' "MYSQL_DATABASE=${old_db:-$default_db}"
    printf '%s\n' "MYSQL_USER=${old_user:-$default_user}"
    printf '%s\n' "MYSQL_PASSWORD=${old_pw:-$(random_hex 24)}"
    printf '%s\n' "MYSQL_ROOT_PASSWORD=${old_root:-$(random_hex 32)}"
    printf '%s\n' "DB_PORT=${old_port:-$default_db_port}"
    printf '%s\n' "AUDITFLOW_PORT=$default_auditflow_port"
    printf '%s\n' "AUDITFLOW_LAN_HOST="
    printf '%s\n' "AUDITFLOW_LAN_CIDR=192.168.8.0/24"
    printf '%s\n' "AUDITFLOW_AI_PORT=$default_ai_port"
    printf '%s\n' "FILEANALYST_PORT=$default_fileanalyst_port"
    printf '%s\n' "JIRAFLOW_PORT=$default_jiraflow_port"
    printf '%s\n' "AUDITFLOW_ADMIN_EMAIL=yumeng.li@johnsonelectric.com"
    printf '%s\n' "AUDITFLOW_BOOTSTRAP_ADMIN_PASSWORD=$(random_hex 20)"
    printf '%s\n' "AUDITFLOW_BOOTSTRAP_MBEAL_LEAD_PASSWORD=$(random_hex 20)"
    printf '%s\n' "JIRAFLOW_USER=testuser"
    printf '%s\n' "MYSQL_VOLUME_NAME=${old_volume:-$default_volume}"
    printf '%s\n' "COMPOSE_PROJECT=${JEAUDITFLOW_COMPOSE_PROJECT:-$default_compose}"
    if [[ -n "$default_mcp_key" ]]; then
      printf '%s\n' "AUDITFLOW_MCP_API_KEY=$default_mcp_key"
    fi
  } > "$CONFIG_FILE"
  chmod 600 "$CONFIG_FILE"
  log "Created local-only configuration at $CONFIG_FILE"
}

config_path_for_version() {
  local version="${1:-}"
  if [[ -n "${JEAUDITFLOW_LOCAL_CONFIG:-}" ]]; then
    printf '%s\n' "$JEAUDITFLOW_LOCAL_CONFIG"
  elif [[ -n "$version" && -f "$CONFIG_DIR/$version.local.env" ]]; then
    printf '%s\n' "$CONFIG_DIR/$version.local.env"
  elif [[ -n "$version" && -f "$CONFIG_DIR/${version%.*}.local.env" ]]; then
    printf '%s\n' "$CONFIG_DIR/${version%.*}.local.env"
  elif [[ "$version" == 6.9.* ]]; then
    printf '%s\n' "$CONFIG_DIR/local.env"
  elif [[ -n "$version" ]]; then
    printf '%s\n' "$CONFIG_DIR/${version%.*}.local.env"
  else
    printf '%s\n' "$CONFIG_DIR/local.env"
  fi
}

load_config() {
  local requested_version="${1:-}"
  CONFIG_VERSION="$requested_version"
  if [[ -z "${JEAUDITFLOW_TMUX_SESSION:-}" && "$requested_version" == 7.* ]]; then
    TMUX_SESSION="jeauditflow$(printf '%s' "$requested_version" | tr -cd '0-9')-local"
    LOG_ROOT="$RUNTIME_ROOT/logs/$requested_version"
    PID_ROOT="$RUNTIME_ROOT/pids/$requested_version"
  else
    TMUX_SESSION="${JEAUDITFLOW_TMUX_SESSION:-jeauditflow69-local}"
    LOG_ROOT="$RUNTIME_ROOT/logs"
    PID_ROOT="$RUNTIME_ROOT/pids"
  fi
  if [[ -z "$CONFIG_FILE" || -n "$requested_version" ]]; then
    CONFIG_FILE="${JEAUDITFLOW_LOCAL_CONFIG:-$(config_path_for_version "$requested_version")}"
  fi
  ensure_config
  set -a
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
  set +a
  ensure_mcp_api_key
  : "${MYSQL_DATABASE:?MYSQL_DATABASE is missing in $CONFIG_FILE}"
  : "${MYSQL_USER:?MYSQL_USER is missing in $CONFIG_FILE}"
  : "${MYSQL_PASSWORD:?MYSQL_PASSWORD is missing in $CONFIG_FILE}"
  : "${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD is missing in $CONFIG_FILE}"
  : "${DB_PORT:?DB_PORT is missing in $CONFIG_FILE}"
  : "${AUDITFLOW_PORT:?AUDITFLOW_PORT is missing in $CONFIG_FILE}"
  : "${AUDITFLOW_LAN_HOST:=}"
  : "${AUDITFLOW_LAN_CIDR:=192.168.8.0/24}"
  : "${AUDITFLOW_AI_PORT:=46976}"
  : "${FILEANALYST_PORT:?FILEANALYST_PORT is missing in $CONFIG_FILE}"
  : "${JIRAFLOW_PORT:?JIRAFLOW_PORT is missing in $CONFIG_FILE}"
  MYSQL_VOLUME_NAME="${MYSQL_VOLUME_NAME:-jeauditflow_690_local}"
  if [[ -z "$COMPOSE_PROJECT" ]]; then
    if [[ "${requested_version:-}" == 6.9.* ]]; then
      COMPOSE_PROJECT="jeauditflow69-local"
    elif [[ "${requested_version:-}" == 7.* ]]; then
      COMPOSE_PROJECT="jeauditflow$(printf '%s' "$requested_version" | tr -cd '0-9')-local"
    else
      COMPOSE_PROJECT="jeauditflow69-local"
    fi
  fi
  MYSQL_CONTAINER="${MYSQL_CONTAINER:-${COMPOSE_PROJECT}-mysql-1}"
  export MYSQL_VOLUME_NAME AUDITFLOW_AI_PORT COMPOSE_PROJECT MYSQL_CONTAINER CONFIG_FILE
}

ensure_mcp_api_key() {
  [[ "$CONFIG_VERSION" == 7.* ]] || return 0
  if grep -q '^AUDITFLOW_MCP_API_KEY=' "$CONFIG_FILE" && [[ -n "${AUDITFLOW_MCP_API_KEY:-}" ]]; then
    export AUDITFLOW_MCP_API_KEY
    return 0
  fi

  local generated_key temp_file
  generated_key="$(random_hex 32)"
  temp_file="${CONFIG_FILE}.tmp.$$"
  awk -v key="$generated_key" '
    $0 !~ /^AUDITFLOW_MCP_API_KEY=/ { print }
    END { print "AUDITFLOW_MCP_API_KEY=" key }
  ' "$CONFIG_FILE" > "$temp_file"
  chmod 600 "$temp_file"
  mv "$temp_file" "$CONFIG_FILE"
  AUDITFLOW_MCP_API_KEY="$generated_key"
  export AUDITFLOW_MCP_API_KEY
}

write_mcp_client_config() {
  [[ "$CONFIG_VERSION" == 7.* ]] || die "Local MCP auto-configuration is supported for JEAuditFlow 7.x only"
  [[ -n "${AUDITFLOW_MCP_API_KEY:-}" ]] || die "MCP API key is missing from $CONFIG_FILE"
  require_node
  local target="${JEAUDITFLOW_MCP_CLIENT_CONFIG:-${HOME}/Library/Application Support/JEAuditFlow/mcp.json}"
  local base_url="http://127.0.0.1:${AUDITFLOW_PORT}"
  mkdir -p "$(dirname "$target")"
  chmod 700 "$(dirname "$target")" 2>/dev/null || true
  umask 077
  printf '{"baseUrl":"%s","apiKey":"%s"}\n' "$base_url" "$AUDITFLOW_MCP_API_KEY" |
    "$NODE_BIN" -e '
      const fs = require("node:fs");
      const path = require("node:path");
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", chunk => { input += chunk; });
      process.stdin.on("end", () => {
        const target = process.argv[1];
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        fs.writeFileSync(target, JSON.stringify(JSON.parse(input), null, 2) + "\n", { mode: 0o600 });
        fs.chmodSync(target, 0o600);
      });
    ' "$target"
  chmod 600 "$target"
  log "Wrote private loopback MCP connection file: $target"
}

compose() {
  local schema_dir="$1"
  shift
  DATABASE_SCHEMA_DIR="$schema_dir" \
    docker compose --env-file "$CONFIG_FILE" -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" "$@"
}

version_from_name() {
  local name="$1"
  if [[ "$name" =~ JEAuditFlow-([0-9]+\.[0-9]+\.[0-9]+)-Backend\.zip$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
  elif [[ "$name" =~ JEAuditFlow-([0-9]+\.[0-9]+)-Backend\.zip$ ]]; then
    printf '%s.0\n' "${BASH_REMATCH[1]}"
  else
    return 1
  fi
}

resolve_backend_zip() {
  local input="${1:-$DEFAULT_RELEASE_DIR}"
  if [[ -f "$input" ]]; then
    [[ "$input" == *.zip ]] || die "Backend input must be a .zip file: $input"
    printf '%s\n' "$input"
    return
  fi
  [[ -d "$input" ]] || die "Release directory does not exist: $input"
  local candidate
  candidate="$(find "$input" -maxdepth 1 -type f -name 'JEAuditFlow-*-Backend.zip' | sort -V | tail -n 1)"
  [[ -n "$candidate" ]] || die "No JEAuditFlow backend ZIP found in $input"
  printf '%s\n' "$candidate"
}

resolve_database_zip() {
  local backend_zip="$1"
  local backend_dir="$2"
  local version="$3"
  local sibling="${backend_zip/JEAuditFlow-${version}-Backend.zip/JEAuditFlow-${version}-Database.zip}"
  if [[ -f "$sibling" ]]; then
    printf '%s\n' "$sibling"
    return
  fi
  local candidate
  candidate="$(find "$backend_dir" "$PROJECT_ROOT/artifacts" -type f -name "JEAuditFlow-${version}-Database.zip" 2>/dev/null | sort -V | head -n 1)"
  [[ -n "$candidate" ]] || die "No database ZIP found for version $version"
  printf '%s\n' "$candidate"
}

resolve_web_client_zip() {
  local backend_zip="$1"
  local backend_dir="$2"
  local version="$3"
  local sibling="${backend_zip/JEAuditFlow-${version}-Backend.zip/JEAuditFlow-${version}-Web-Client.zip}"
  if [[ -f "$sibling" ]]; then
    printf '%s\n' "$sibling"
    return
  fi
  local candidate
  candidate="$(find "$backend_dir" -maxdepth 2 -type f -name "JEAuditFlow-${version}-Web-Client.zip" 2>/dev/null | sort -V | tail -n 1)"
  [[ -n "$candidate" ]] || return 1
  printf '%s\n' "$candidate"
}

manifest_version() {
  local root="$1"
  require_node
  [[ -f "$root/manifest.json" ]] || die "Backend manifest missing under $root"
  "$NODE_BIN" -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!p.version) process.exit(2); console.log(p.version)' "$root/manifest.json"
}

extract_backend() {
  local backend_zip="$1"
  local version="$2"
  local target="$VERSIONS_ROOT/$version"
  local archive_sha
  archive_sha="$("$NODE_BIN" -e 'const fs=require("node:fs"),crypto=require("node:crypto"); console.log(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$backend_zip")"
  if [[ -f "$target/manifest.json" ]]; then
    local existing installed_sha=""
    existing="$(manifest_version "$target")"
    [[ "$existing" == "$version" ]] || die "Existing runtime directory has an unexpected version: $target"
    [[ ! -f "$target/.backend-archive.sha256" ]] || installed_sha="$(tr -d '[:space:]' < "$target/.backend-archive.sha256")"
    if [[ "$installed_sha" == "$archive_sha" ]]; then
      log "Backend $version already matches this archive" >&2
      printf '%s\n' "$target"
      return
    fi
    if (load_config "$version"; pid_running backend || pid_running ai-bridge || pid_running fileanalyst); then
      die "Stop JEAuditFlow $version application services before installing an updated backend archive"
    fi
  elif [[ -e "$target" ]]; then
    die "Existing runtime directory has no valid manifest: $target"
  fi
  unzip -tqq "$backend_zip" || die "Backend archive failed integrity check: $backend_zip"
  local temp="$VERSIONS_ROOT/.${version}.extract.$$"
  rm -rf "$temp"
  mkdir -p "$temp"
  unzip -q "$backend_zip" -d "$temp"
  [[ -f "$temp/server/server.mjs" && -f "$temp/fileanalyst/server.mjs" && -f "$temp/jiraflow/jiraflow.jar" ]] ||
    die "Backend archive is missing a required service entrypoint"
  [[ "$(manifest_version "$temp")" == "$version" ]] || die "Backend archive manifest does not match $version"
  printf '%s\n' "$archive_sha" > "$temp/.backend-archive.sha256"
  if [[ -d "$target" ]]; then
    # The client and runtime data have independent installation lifecycles.
    [[ ! -d "$target/client" ]] || cp -R "$target/client" "$temp/client"
    local backup
    mkdir -p "$RUNTIME_ROOT/backups"
    backup="$(mktemp -d "$RUNTIME_ROOT/backups/runtime-${version}-$(date +%Y%m%d-%H%M%S).XXXXXX")"
    mv "$target" "$backup/runtime"
    if ! mv "$temp" "$target"; then
      mv "$backup/runtime" "$target"
      die "Backend replacement failed; restored the previous runtime"
    fi
    log "Previous backend retained at $backup/runtime" >&2
  else
    mv "$temp" "$target"
  fi
  printf '%s\n' "$target"
}

extract_web_client() {
  local client_zip="$1"
  local version="$2"
  local target="$VERSIONS_ROOT/$version/client"
  unzip -tqq "$client_zip" || die "Web-client archive failed integrity check: $client_zip"
  local temp="$VERSIONS_ROOT/.${version}.client.$$"
  rm -rf -- "$temp"
  mkdir -p "$temp"
  unzip -q "$client_zip" -d "$temp"
  [[ -f "$temp/index.html" && -f "$temp/app.js" && -f "$temp/manifest.json" ]] ||
    die "Web-client archive is missing its browser entrypoint or manifest"
  require_node
  local client_version
  client_version="$("$NODE_BIN" -e 'const fs=require("node:fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));console.log(p.version||"")' "$temp/manifest.json")"
  [[ "$client_version" == "$version" ]] || die "Web-client version $client_version does not match backend $version"
  local package_type compatible_range
  package_type="$("$NODE_BIN" -e 'const fs=require("node:fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));console.log(p.packageType||"")' "$temp/manifest.json")"
  compatible_range="$("$NODE_BIN" -e 'const fs=require("node:fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));console.log(p.compatibleBackendRange||"")' "$temp/manifest.json")"
  [[ "$package_type" == "web-client" && "$compatible_range" == "${version%.*}.x" ]] ||
    die "Web-client package type or backend compatibility range is invalid for $version"
  rm -rf -- "$target"
  mv "$temp" "$target"
  printf '%s\n' "$target"
}

install_web_client() {
  local version=""
  local client_zip=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --version) version="${2:?--version requires a version}"; shift 2 ;;
      --web-client|--client) client_zip="${2:?--web-client requires a ZIP}"; shift 2 ;;
      -h|--help) usage; return ;;
      *) die "Unknown install-client option: $1" ;;
    esac
  done
  [[ "$version" == 7.* ]] || die "Independent web-client installation is supported for JEAuditFlow 7.x only"
  [[ -n "$client_zip" && -f "$client_zip" ]] || die "install-client requires --web-client ZIP"
  local backend_manifest="$VERSIONS_ROOT/$version/manifest.json"
  [[ -f "$backend_manifest" ]] || die "Install the JEAuditFlow $version backend before its web client"
  require_node
  local backend_version client_range
  backend_version="$(manifest_version "$VERSIONS_ROOT/$version")"
  client_range="$("$NODE_BIN" -e 'const fs=require("node:fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));console.log(p.supportedClientRange||"")' "$backend_manifest")"
  [[ "$backend_version" == "$version" && "$client_range" == "${version%.*}.x" ]] ||
    die "Installed backend does not declare compatibility with the $version web client"
  extract_web_client "$client_zip" "$version" >/dev/null
  log "Installed web client: $VERSIONS_ROOT/$version/client"
}

extract_database() {
  local database_zip="$1"
  local version="$2"
  local target="$DATABASE_ROOT/$version"
  if [[ -f "$target/schema/collaboration-schema.sql" ]]; then
    printf '%s\n' "$target"
    return
  fi
  unzip -tqq "$database_zip" || die "Database archive failed integrity check: $database_zip"
  local temp="$DATABASE_ROOT/.${version}.extract.$$"
  rm -rf "$temp"
  mkdir -p "$temp"
  unzip -q "$database_zip" -d "$temp"
  [[ -f "$temp/schema/collaboration-schema.sql" ]] || die "Database archive has no schema directory"
  mv "$temp" "$target"
  printf '%s\n' "$target"
}

install_dependencies() {
  local backend_root="$1"
  require_command npm
  for package_root in "$backend_root/server" "$backend_root/fileanalyst"; do
    [[ -f "$package_root/package.json" ]] || continue
    if [[ ! -d "$package_root/node_modules/mysql2" ]]; then
      log "Installing production dependencies in $package_root"
      (cd "$package_root" && npm ci --omit=dev --ignore-scripts)
    fi
  done
}

select_version() {
  local version="${1:-}"
  if [[ -n "$version" ]]; then
    [[ -f "$VERSIONS_ROOT/$version/manifest.json" ]] || die "Version is not installed: $version"
  elif [[ -f "$CURRENT_VERSION_FILE" ]]; then
    version="$(tr -d '[:space:]' < "$CURRENT_VERSION_FILE")"
  else
    version="$DEFAULT_RELEASE_VERSION"
    if [[ ! -f "$VERSIONS_ROOT/$version/manifest.json" ]]; then
      local installed_version
      installed_version="$(find "$VERSIONS_ROOT" -mindepth 2 -maxdepth 2 -type f -name manifest.json -print 2>/dev/null |
        sed 's#/manifest.json$##' | awk -F/ '{print $NF}' | sort -V | tail -n 1)"
      [[ -n "$installed_version" ]] || die "No active version; run install first"
      version="$installed_version"
    fi
  fi
  printf '%s\n' "$version"
}

set_current_version() {
  local version="$1"
  local target="$VERSIONS_ROOT/$version"
  [[ -d "$target" ]] || die "Version directory does not exist: $target"
  ln -sfn "$target" "$CURRENT_LINK"
  printf '%s\n' "$version" > "$CURRENT_VERSION_FILE"
}

pid_file() { printf '%s/%s.pid\n' "$PID_ROOT" "$1"; }
log_file() { printf '%s/%s.log\n' "$LOG_ROOT" "$1"; }

assert_release_ports_available() {
  local version="$1"
  [[ "$version" == "7.3.0" || "$version" == 7.5.* || "$version" == 7.6.* ]] || return 0
  local -a managed_labels managed_ports
  managed_labels=("AuditFlow" "AI bridge" "FileAnalyst" "JiraFlow" "MySQL")
  managed_ports=("$AUDITFLOW_PORT" "$AUDITFLOW_AI_PORT" "$FILEANALYST_PORT" "$JIRAFLOW_PORT" "$DB_PORT")
  local i j
  for ((i = 0; i < ${#managed_ports[@]}; i++)); do
    for ((j = i + 1; j < ${#managed_ports[@]}; j++)); do
      if [[ "${managed_ports[$i]}" == "${managed_ports[$j]}" ]]; then
        die "Managed service ports must be unique: ${managed_labels[$i]} and ${managed_labels[$j]} both use port ${managed_ports[$i]}"
      fi
    done
  done
  require_command lsof
  local item label port listeners
  for item in "AuditFlow:$AUDITFLOW_PORT" "AI bridge:$AUDITFLOW_AI_PORT" "FileAnalyst:$FILEANALYST_PORT" "JiraFlow:$JIRAFLOW_PORT"; do
    label="${item%%:*}"
    port="${item##*:}"
    listeners="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | sort -u || true)"
    [[ -z "$listeners" ]] || die "Port $port for $label is already in use by PID(s) ${listeners//$'\n'/,}; stop the conflicting service before starting JEAuditFlow $version"
  done
  listeners="$(lsof -nP -iTCP:"$DB_PORT" -sTCP:LISTEN -t 2>/dev/null | sort -u || true)"
  if [[ -n "$listeners" ]] && ! mysql_container_matches_release; then
    die "Port $DB_PORT for MySQL is already in use by PID(s) ${listeners//$'\n'/,}; stop the conflicting service before starting JEAuditFlow $version"
  fi
}

mysql_container_matches_release() {
  local running compose_project container_database container_port container_volume
  running="$(docker inspect "$MYSQL_CONTAINER" --format '{{.State.Running}}' 2>/dev/null || true)"
  compose_project="$(docker inspect "$MYSQL_CONTAINER" --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true)"
  container_database="$(env_value_from_container MYSQL_DATABASE)"
  container_port="$(port_from_container)"
  container_volume="$(docker inspect "$MYSQL_CONTAINER" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/mysql"}}{{.Name}}{{end}}{{end}}' 2>/dev/null || true)"
  [[ "$running" == true && "$compose_project" == "$COMPOSE_PROJECT" &&
    "$container_database" == "$MYSQL_DATABASE" && "$container_port" == "$DB_PORT" &&
    "$container_volume" == "$MYSQL_VOLUME_NAME" ]]
}

tmux_window_running() {
  local service="$1"
  [[ -n "$TMUX_BIN" ]] || return 1
  "$TMUX_BIN" has-session -t "$TMUX_SESSION" 2>/dev/null || return 1
  "$TMUX_BIN" list-windows -t "$TMUX_SESSION" -F '#{window_name}' 2>/dev/null |
    grep -Fxq "$service"
}

pid_running() {
  local service="$1"
  local file
  file="$(pid_file "$service")"
  if tmux_window_running "$service"; then
    return 0
  fi
  [[ -s "$file" ]] || return 1
  local pid
  pid="$(cat "$file")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

stop_service() {
  local service="$1"
  local file
  file="$(pid_file "$service")"
  if tmux_window_running "$service"; then
    log "Stopping $service (tmux session $TMUX_SESSION)"
    "$TMUX_BIN" kill-window -t "$TMUX_SESSION:$service" 2>/dev/null || true
    rm -f "$file"
    return
  fi
  if ! pid_running "$service"; then
    rm -f "$file"
    return
  fi
  local pid
  pid="$(cat "$file")"
  log "Stopping $service (pid $pid)"
  kill -TERM "$pid" 2>/dev/null || true
  for _ in {1..30}; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.2
  done
  if kill -0 "$pid" 2>/dev/null; then
    warn "$service did not stop after SIGTERM; sending SIGKILL"
    kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$file"
}

stop_bundled_jiraflow() {
  local version="$1"
  [[ "$version" == 7.* ]] || return 0

  local jar="$VERSIONS_ROOT/$version/jiraflow/jiraflow.jar"
  [[ -f "$jar" ]] || return 0

  local listeners pid command
  listeners="$(lsof -nP -iTCP:"$JIRAFLOW_PORT" -sTCP:LISTEN -t 2>/dev/null || true)"
  while IFS= read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ "$command" != *"$jar"* || "$command" != *"--port $JIRAFLOW_PORT"* ]]; then
      warn "JiraFlow port $JIRAFLOW_PORT is held by an unmanaged process (PID $pid); leaving it untouched"
      continue
    fi

    log "Stopping bundled JiraFlow (pid $pid)"
    kill -TERM "$pid" 2>/dev/null || true
    for _ in {1..30}; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.2
    done
    if kill -0 "$pid" 2>/dev/null; then
      warn "Bundled JiraFlow PID $pid did not stop after SIGTERM; sending SIGKILL"
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done <<<"$listeners"
}

start_process() {
  local service="$1"
  local cwd="$2"
  shift 2
  if pid_running "$service"; then
    log "$service is already running (pid $(cat "$(pid_file "$service")"))"
    return
  fi
  rm -f "$(pid_file "$service")"
  local output
  output="$(log_file "$service")"
  mkdir -p "$cwd" "$LOG_ROOT" "$PID_ROOT"
  log "Starting $service; log: $output"
  if [[ -n "$TMUX_BIN" ]]; then
    local command_string cwd_quoted output_quoted
    printf -v command_string '%q ' "$@"
    printf -v cwd_quoted '%q' "$cwd"
    printf -v output_quoted '%q' "$output"
    if "$TMUX_BIN" has-session -t "$TMUX_SESSION" 2>/dev/null; then
      "$TMUX_BIN" new-window -d -t "$TMUX_SESSION:" -n "$service" \
        "cd $cwd_quoted && exec env $command_string >>$output_quoted 2>&1"
    else
      "$TMUX_BIN" new-session -d -s "$TMUX_SESSION" -n "$service" \
        "cd $cwd_quoted && exec env $command_string >>$output_quoted 2>&1"
    fi
    "$TMUX_BIN" display-message -p -t "$TMUX_SESSION:$service" '#{pane_pid}' >"$(pid_file "$service")"
    sleep 0.5
    tmux_window_running "$service" || {
      tail -n 40 "$output" >&2 || true
      die "$service failed to start"
    }
    return
  fi
  (
    cd "$cwd"
    nohup env "$@" >>"$output" 2>&1 </dev/null &
    echo $! >"$(pid_file "$service")"
    disown "$!" 2>/dev/null || true
  )
  sleep 0.5
  pid_running "$service" || {
    tail -n 40 "$output" >&2 || true
    die "$service failed to start"
  }
}

write_env_file() {
  local target="$1"
  shift
  umask 077
  : >"$target"
  local entry key value
  for entry in "$@"; do
    key="${entry%%=*}"
    value="${entry#*=}"
    printf '%s=' "$key" >>"$target"
    printf '%q\n' "$value" >>"$target"
  done
  chmod 600 "$target"
}

start_process_with_env_file() {
  local service="$1"
  local cwd="$2"
  local env_file="$3"
  shift 3
  if pid_running "$service"; then
    log "$service is already running (pid $(cat "$(pid_file "$service")" 2>/dev/null || true))"
    return
  fi
  rm -f "$(pid_file "$service")"
  local output
  output="$(log_file "$service")"
  mkdir -p "$cwd" "$LOG_ROOT" "$PID_ROOT"
  log "Starting $service; log: $output"
  local command_string cwd_quoted env_quoted output_quoted
  printf -v command_string '%q ' "$@"
  printf -v cwd_quoted '%q' "$cwd"
  printf -v env_quoted '%q' "$env_file"
  printf -v output_quoted '%q' "$output"
  if [[ -n "$TMUX_BIN" ]]; then
    local shell_command="cd $cwd_quoted && set -a && . $env_quoted && set +a && exec $command_string >>$output_quoted 2>&1"
    if "$TMUX_BIN" has-session -t "$TMUX_SESSION" 2>/dev/null; then
      "$TMUX_BIN" new-window -d -t "$TMUX_SESSION:" -n "$service" "$shell_command"
    else
      "$TMUX_BIN" new-session -d -s "$TMUX_SESSION" -n "$service" "$shell_command"
    fi
    "$TMUX_BIN" display-message -p -t "$TMUX_SESSION:$service" '#{pane_pid}' >"$(pid_file "$service")"
    sleep 0.5
    tmux_window_running "$service" || {
      tail -n 40 "$output" >&2 || true
      die "$service failed to start"
    }
    return
  fi
  (
    cd "$cwd"
    nohup sh -c "set -a; . $(printf '%q' "$env_file"); set +a; exec $command_string" >>"$output" 2>&1 </dev/null &
    echo $! >"$(pid_file "$service")"
    disown "$!" 2>/dev/null || true
  )
  sleep 0.5
  pid_running "$service" || {
    tail -n 40 "$output" >&2 || true
    die "$service failed to start"
  }
}

wait_for_url() {
  local name="$1" url="$2" attempts="${3:-60}"
  for _ in $(seq 1 "$attempts"); do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      log "$name is healthy: $url"
      return
    fi
    sleep 1
  done
  warn "$name did not answer: $url"
  return 1
}

database_schema() {
  local version="$1"
  printf '%s\n' "$DATABASE_ROOT/$version/schema"
}

mysql_health_state() {
  docker inspect "$MYSQL_CONTAINER" \
    --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    2>/dev/null || true
}

mysql_volume_from_container() {
  docker inspect "$MYSQL_CONTAINER" \
    --format '{{range .Mounts}}{{if eq .Destination "/var/lib/mysql"}}{{.Name}}{{end}}{{end}}' \
    2>/dev/null || true
}

mysql_probe() {
  local state container_db container_user container_password container_volume
  state="$(mysql_health_state)"
  [[ "$state" == "healthy" ]] || return 1
  container_db="$(env_value_from_container MYSQL_DATABASE)"
  container_user="$(env_value_from_container MYSQL_USER)"
  container_password="$(env_value_from_container MYSQL_PASSWORD)"
  container_volume="$(mysql_volume_from_container)"
  [[ "$container_db" == "$MYSQL_DATABASE" &&
    "$container_user" == "$MYSQL_USER" &&
    "$container_password" == "$MYSQL_PASSWORD" &&
    "$container_volume" == "$MYSQL_VOLUME_NAME" ]] || return 1
  docker exec "$MYSQL_CONTAINER" sh -c \
    'MYSQL_PWD="$MYSQL_PASSWORD" mysql --protocol=TCP -h 127.0.0.1 -u"$MYSQL_USER" "$MYSQL_DATABASE" -Nse "SELECT 1"' \
    2>/dev/null | grep -Fxq 1
}

apply_schema() {
  local schema_dir="$1"
  log "Applying idempotent schema to ${MYSQL_DATABASE} without deleting existing data"
  for schema in "$schema_dir"/*.sql; do
    [[ -f "$schema" ]] || continue
    compose "$schema_dir" exec -T mysql sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < "$schema"
  done
}

require_version_database_confirmation() {
  local version="$1"
  local major="${version%%.*}"
  local remainder="${version#*.}"
  local minor="${remainder%%.*}"
  [[ "$major" == 7 && "$minor" =~ ^[0-9]+$ ]] || return 0
  (( minor >= 1 )) || return 0
  local release_digits="${version//./}"
  local expected_database="jeauditflow_${release_digits}"
  local expected_volume="${expected_database}_mysql_data"
  [[ "$MYSQL_DATABASE" == "$expected_database" ]] ||
    die "$version requires database $expected_database; refusing to initialize $MYSQL_DATABASE"
  [[ "$MYSQL_VOLUME_NAME" == "$expected_volume" ]] ||
    die "$version requires volume $expected_volume; refusing to attach $MYSQL_VOLUME_NAME"
  local expected_confirmation="APPLY $expected_database ON $expected_volume"
  [[ "${JEAUDITFLOW_CONFIRM_DATABASE:-}" == "$expected_confirmation" ]] ||
    die "Database initialization requires action-time confirmation: $expected_confirmation. No Docker or schema changes were performed."
}

show_config() {
  local version="${1:-}"
  [[ -n "$version" ]] || die "config requires --version VERSION"
  load_config "$version"
  printf 'version=%s\n' "$version"
  printf 'config=%s\n' "$CONFIG_FILE"
  printf 'database=%s\n' "$MYSQL_DATABASE"
  printf 'volume=%s\n' "$MYSQL_VOLUME_NAME"
  printf 'compose_project=%s\n' "$COMPOSE_PROJECT"
  printf 'ports=AuditFlow:%s AI:%s FileAnalyst:%s JiraFlow:%s MySQL:%s\n' \
    "$AUDITFLOW_PORT" "$AUDITFLOW_AI_PORT" "$FILEANALYST_PORT" "$JIRAFLOW_PORT" "$DB_PORT"
}

mcp_config() {
  local version="${1:-}"
  [[ -n "$version" ]] || die "mcp-config requires --version VERSION"
  require_node
  load_config "$version"
  write_mcp_client_config
}

install_release() {
  require_node
  local release_dir="$DEFAULT_RELEASE_DIR"
  local backend_arg=""
  local client_arg=""
  local database_arg=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --release-dir) release_dir="${2:?--release-dir requires a directory}"; shift 2 ;;
      --backend) backend_arg="${2:?--backend requires a ZIP}"; shift 2 ;;
      --web-client|--client) client_arg="${2:?--web-client requires a ZIP}"; shift 2 ;;
      --database) database_arg="${2:?--database requires a ZIP}"; shift 2 ;;
      -h|--help) usage; return ;;
      *) die "Unknown install option: $1" ;;
    esac
  done
  local backend_zip
  backend_zip="$(resolve_backend_zip "${backend_arg:-$release_dir}")"
  local version
  version="$(version_from_name "$(basename "$backend_zip")")" || die "Cannot infer release version from $(basename "$backend_zip")"
  local backend_root
  backend_root="$(extract_backend "$backend_zip" "$version")"
  if [[ "$version" == 7.* ]]; then
    if [[ -z "$client_arg" ]]; then
      client_arg="$(resolve_web_client_zip "$backend_zip" "$release_dir" "$version" || true)"
    fi
    if [[ -n "$client_arg" ]]; then
      extract_web_client "$client_arg" "$version" >/dev/null
    elif [[ ! -f "$backend_root/client/manifest.json" ]]; then
      die "First install of JEAuditFlow $version requires a matching Web-Client ZIP; pass --web-client or provide it beside the backend archive"
    fi
  fi
  local database_zip
  database_zip="${database_arg:-$(resolve_database_zip "$backend_zip" "$release_dir" "$version")}"
  local database_root
  database_root="$(extract_database "$database_zip" "$version")"
  install_dependencies "$backend_root"
  log "Installed JEAuditFlow $version"
  log "Backend: $backend_root"
  log "Database schema: $database_root/schema"
  if [[ -f "$CURRENT_VERSION_FILE" ]]; then
    log "Kept selected runtime version $(tr -d '[:space:]' < "$CURRENT_VERSION_FILE"); use 'start --version $version' only after database compatibility is verified"
  else
    log "No runtime version selected; configure a compatible database first, then run 'start --version $version'"
  fi
}

start_stack() {
  local requested_version="${1:-}"
  require_runtime_tools
  local version
  version="$(select_version "$requested_version")"
  load_config "$version"
  local backend_root="$VERSIONS_ROOT/$version"
  local schema_dir
  schema_dir="$(database_schema "$version")"
  [[ -f "$backend_root/server/server.mjs" ]] || die "Backend version is incomplete: $backend_root"
  if [[ "$version" == 7.* ]]; then
    [[ -f "$backend_root/client/index.html" && -f "$backend_root/client/manifest.json" ]] ||
      die "Web client is not installed for $version; install its matching Web-Client ZIP first"
  fi
  [[ -f "$schema_dir/collaboration-schema.sql" ]] || die "Database schema is not installed for version $version"
  local expected_database expected_volume database_manifest
  database_manifest="$DATABASE_ROOT/$version/manifest.json"
  expected_database="$("$NODE_BIN" -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(p.defaultDatabase || "")' "$database_manifest")"
  expected_volume="$("$NODE_BIN" -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(p.persistentVolume || "")' "$database_manifest")"
  if [[ -n "$expected_database" && "$MYSQL_DATABASE" != "$expected_database" ]]; then
    die "Release $version expects database $expected_database, but local.env selects $MYSQL_DATABASE. Configure an isolated database and volume or complete an authorized migration before starting."
  fi
  if [[ -n "$expected_volume" && "$MYSQL_VOLUME_NAME" != "$expected_volume" && "$version" != "6.9.0" ]]; then
    die "Release $version expects MySQL volume $expected_volume, but local.env selects $MYSQL_VOLUME_NAME. Configure an isolated database and volume before starting."
  fi
  require_version_database_confirmation "$version"
  assert_release_ports_available "$version"
  install_dependencies "$backend_root"

  compose "$schema_dir" up -d mysql
  for _ in {1..60}; do
    if compose "$schema_dir" exec -T mysql mysqladmin ping -h 127.0.0.1 -u root -p"$MYSQL_ROOT_PASSWORD" --silent >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  compose "$schema_dir" exec -T mysql mysqladmin ping -h 127.0.0.1 -u root -p"$MYSQL_ROOT_PASSWORD" --silent >/dev/null 2>&1 ||
    die "MySQL did not become healthy"
  apply_schema "$schema_dir"

  local data_root="$RUNTIME_ROOT/data/$version"
  local bootstrap_admin_email="${JEAUDITFLOW_ADMIN_EMAIL_OVERRIDE:-${AUDITFLOW_ADMIN_EMAIL:-yumeng.li@johnsonelectric.com}}"
  local bootstrap_admin_password="${JEAUDITFLOW_ADMIN_PASSWORD_OVERRIDE:-${AUDITFLOW_BOOTSTRAP_ADMIN_PASSWORD:-}}"
  local configured_admin_email="${AUDITFLOW_ADMIN_EMAIL:-yumeng.li@johnsonelectric.com}"
  local configured_admin_password="${AUDITFLOW_BOOTSTRAP_ADMIN_PASSWORD:-}"
  local ephemeral_admin_credentials=0
  [[ -n "${JEAUDITFLOW_ADMIN_PASSWORD_OVERRIDE:-}" ]] && ephemeral_admin_credentials=1
  local common_env=(
    NODE_ENV=production
    AUDITFLOW_VERSION="$version"
    AUDITFLOW_WEB_CLIENT_ROOT="$backend_root/client"
    AUDITFLOW_SERVER_ROLE=desktop
    AUDITFLOW_PORT="$AUDITFLOW_PORT"
    AUDITFLOW_LAN_HOST="${AUDITFLOW_LAN_HOST:-}"
    AUDITFLOW_LAN_CIDR="${AUDITFLOW_LAN_CIDR:-}"
    AUDITFLOW_AI_PORT="$AUDITFLOW_AI_PORT"
    AUDITFLOW_MYSQL_URL="mysql://${MYSQL_USER}:${MYSQL_PASSWORD}@127.0.0.1:${DB_PORT}/${MYSQL_DATABASE}"
    AUDITFLOW_OUTPUT_DIR="$data_root/auditflow"
    AUDITFLOW_USER_DATA_DIR="$data_root/users"
    AUDITFLOW_BOOTSTRAP_ADMIN_EMAIL="$configured_admin_email"
    AUDITFLOW_BOOTSTRAP_ADMIN_PASSWORD="$configured_admin_password"
    AUDITFLOW_LOCAL_ADMIN_PASSWORD_SYNC=0
    AUDITFLOW_BOOTSTRAP_CORE_PROJECTS=1
    AUDITFLOW_BOOTSTRAP_MBEAL=1
    AUDITFLOW_BOOTSTRAP_MBEAL_LEAD_PASSWORD="${AUDITFLOW_BOOTSTRAP_MBEAL_LEAD_PASSWORD:-}"
    AUDITFLOW_MCP_API_KEY="${AUDITFLOW_MCP_API_KEY:-}"
    AUDITFLOW_MCP_USER_EMAIL="$configured_admin_email"
    DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY:-}"
    AUDITFLOW_MODEL_API_KEY="${AUDITFLOW_MODEL_API_KEY:-}"
    OPENAI_API_KEY="${OPENAI_API_KEY:-}"
    AUDITFLOW_MODEL_PROVIDER="${AUDITFLOW_MODEL_PROVIDER:-}"
    AUDITFLOW_MODEL_PROTOCOL="${AUDITFLOW_MODEL_PROTOCOL:-}"
    AUDITFLOW_MODEL_BASE_URL="${AUDITFLOW_MODEL_BASE_URL:-}"
    AUDITFLOW_MODEL="${AUDITFLOW_MODEL:-}"
    FILEANALYST_PORT="$FILEANALYST_PORT"
    FILEANALYST_HOST=127.0.0.1
    FILEANALYST_BASE_PATH=/fileanalyst
    FILEANALYST_AUDITFLOW_AUTH_URL="http://127.0.0.1:${AUDITFLOW_PORT}/api/auth/me"
    FILEANALYST_AUDITFLOW_PROJECTS_URL="http://127.0.0.1:${AUDITFLOW_PORT}/api/projects"
    FILEANALYST_CLIENT_ROOT="$backend_root/client/fileanalyst"
    FILEANALYST_STORAGE=mysql
    FILEANALYST_REQUIRE_DATABASE=1
    FILEANALYST_MYSQL_URL="mysql://${MYSQL_USER}:${MYSQL_PASSWORD}@127.0.0.1:${DB_PORT}/${MYSQL_DATABASE}"
    FILEANALYST_DATA_DIR="$data_root/fileanalyst"
    FILEANALYST_LOCAL_ONLY=0
    FILEANALYST_DESKTOP_MODE=0
    JIRAFLOW_PORT="$JIRAFLOW_PORT"
    JIRAFLOW_HOST=127.0.0.1
    JIRAFLOW_ROOT="$backend_root/jiraflow"
    JIRAFLOW_DATA_DIR="$data_root/jiraflow"
    JIRAFLOW_USER="${JIRAFLOW_USER:-testuser}"
    FILEANALYST_AUTOSTART=0
    JIRAFLOW_AUTOSTART=1
  )
  local ai_env=(
    NODE_ENV=production
    AUDITFLOW_VERSION="$version"
    AUDITFLOW_SERVER_ROLE=ai-bridge
    AUDITFLOW_PORT="${AUDITFLOW_AI_PORT:-46976}"
    AUDITFLOW_LAN_HOST=
    AUDITFLOW_LAN_CIDR=
    AUDITFLOW_MYSQL_URL="mysql://${MYSQL_USER}:${MYSQL_PASSWORD}@127.0.0.1:${DB_PORT}/${MYSQL_DATABASE}"
    AUDITFLOW_AI_BRIDGE_AUTH_MYSQL_URL="mysql://${MYSQL_USER}:${MYSQL_PASSWORD}@127.0.0.1:${DB_PORT}/${MYSQL_DATABASE}"
    AUDITFLOW_OUTPUT_DIR="$data_root/auditflow-ai-bridge"
    AUDITFLOW_COLLAB_DIR="$data_root/ai-bridge-collaboration"
    AUDITFLOW_USER_DATA_DIR="$data_root/users"
    AUDITFLOW_BOOTSTRAP_ADMIN_EMAIL="$configured_admin_email"
    AUDITFLOW_BOOTSTRAP_ADMIN_PASSWORD="$configured_admin_password"
    AUDITFLOW_BOOTSTRAP_MBEAL_LEAD_PASSWORD="${AUDITFLOW_BOOTSTRAP_MBEAL_LEAD_PASSWORD:-}"
    DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY:-}"
    AUDITFLOW_MODEL_API_KEY="${AUDITFLOW_MODEL_API_KEY:-}"
    OPENAI_API_KEY="${OPENAI_API_KEY:-}"
    FILEANALYST_AUTOSTART=0
    JIRAFLOW_AUTOSTART=0
  )
  mkdir -p "$data_root/auditflow" "$data_root/users" "$data_root/fileanalyst" "$data_root/jiraflow"
  chmod 700 "$RUNTIME_ROOT/data" "$data_root" "$data_root/jiraflow" "$data_root/fileanalyst" "$data_root/users" "$ENV_ROOT" 2>/dev/null || true
  local runtime_env="$ENV_ROOT/$version.env"
  write_env_file "$runtime_env" "${common_env[@]}"
  local backend_env="$runtime_env"
  local bootstrap_env=""
  if (( ephemeral_admin_credentials )); then
    bootstrap_env="$(mktemp "$ENV_ROOT/.${version}.bootstrap.XXXXXX")"
    write_env_file "$bootstrap_env" "${common_env[@]}" \
      "AUDITFLOW_BOOTSTRAP_ADMIN_EMAIL=$bootstrap_admin_email" \
      "AUDITFLOW_BOOTSTRAP_ADMIN_PASSWORD=$bootstrap_admin_password" \
      "AUDITFLOW_LOCAL_ADMIN_PASSWORD_SYNC=1"
    backend_env="$bootstrap_env"
  fi

  stop_service backend || true
  stop_service ai-bridge || true
  stop_service fileanalyst || true
  # JiraFlow is owned by the backend child and is stopped when the backend exits.
  start_process_with_env_file fileanalyst "$backend_root/fileanalyst" "$runtime_env" "$NODE_BIN" server.mjs
  wait_for_url FileAnalyst "http://127.0.0.1:${FILEANALYST_PORT}/api/health" 60 || {
    tail -n 80 "$(log_file fileanalyst)" >&2 || true
    die "FileAnalyst failed health check"
  }
  start_process_with_env_file backend "$backend_root/server" "$backend_env" "$NODE_BIN" server.mjs serve
  wait_for_url AuditFlow "http://127.0.0.1:${AUDITFLOW_PORT}/health" 60 || {
    rm -f -- "$bootstrap_env"
    tail -n 100 "$(log_file backend)" >&2 || true
    die "AuditFlow failed health check"
  }
  rm -f -- "$bootstrap_env"
  wait_for_url JiraFlow "http://127.0.0.1:${JIRAFLOW_PORT}/health" 60 || {
    tail -n 100 "$(log_file backend)" >&2 || true
    die "JiraFlow failed health check"
  }
  if [[ "$version" == 7.* ]]; then
    local ai_runtime_env="$ENV_ROOT/$version-ai-bridge.env"
    write_env_file "$ai_runtime_env" "${ai_env[@]}"
    start_process_with_env_file ai-bridge "$backend_root/server" "$ai_runtime_env" "$NODE_BIN" server.mjs serve
    wait_for_url "AuditFlow AI bridge" "http://127.0.0.1:${AUDITFLOW_AI_PORT:-46976}/health" 60 || {
      tail -n 100 "$(log_file ai-bridge)" >&2 || true
      die "Local AI bridge failed health check"
    }
  fi
  ai_bridge_smoke
  if (( ephemeral_admin_credentials )); then
    # The launcher may supply a user-entered password for first-run bootstrap.
    # Service processes already inherited it; do not leave that value in the
    # generated runtime env files after startup.
    rm -f -- "$runtime_env" "${ai_runtime_env:-}"
  fi
  if [[ "$version" == 7.* ]]; then write_mcp_client_config; fi
  set_current_version "$version"
  log "JEAuditFlow $version stack is running"
  urls
}

stop_stack() {
  local requested_version="${1:-}"
  local version="$requested_version"
  if [[ -n "$requested_version" ]]; then
    load_config "$requested_version"
  elif [[ -f "$CURRENT_VERSION_FILE" ]]; then
    version="$(tr -d '[:space:]' < "$CURRENT_VERSION_FILE")"
    load_config "$version"
  else
    load_config
  fi
  stop_service ai-bridge || true
  stop_service backend || true
  stop_bundled_jiraflow "$version"
  stop_service fileanalyst || true
  # MySQL is intentionally left running to preserve the database and make restart fast.
  log "Application services stopped; MySQL container remains running for persistence"
}

status_stack() {
  local version="not-installed"
  [[ -f "$CURRENT_VERSION_FILE" ]] && version="$(tr -d '[:space:]' < "$CURRENT_VERSION_FILE")"
  [[ "$version" != "not-installed" ]] && load_config "$version" || load_config
  printf 'version=%s\n' "$version"
  local backend_state=stopped fileanalyst_state=stopped mysql_state=stopped
  pid_running backend && backend_state=running || true
  pid_running fileanalyst && fileanalyst_state=running || true
  if [[ "$version" != "not-installed" && -f "$(database_schema "$version")/collaboration-schema.sql" ]]; then
    mysql_state="$(mysql_health_state)"
    if mysql_probe; then
      mysql_state=healthy
    elif [[ -z "$mysql_state" ]]; then
      mysql_state=stopped
    fi
  fi
  printf 'backend=%s\n' "$backend_state"
  printf 'fileanalyst=%s\n' "$fileanalyst_state"
  printf 'mysql=%s\n' "$mysql_state"
  printf 'mysql_database=%s\n' "$MYSQL_DATABASE"
  printf 'mysql_volume=%s\n' "$MYSQL_VOLUME_NAME"
  printf 'ports=AuditFlow:%s FileAnalyst:%s JiraFlow:%s MySQL:%s\n' "$AUDITFLOW_PORT" "$FILEANALYST_PORT" "$JIRAFLOW_PORT" "$DB_PORT"
}

health_stack() {
  local requested_version=""
  if [[ "${1:-}" == "--version" ]]; then requested_version="${2:?--version requires a version}"; fi
  if [[ -z "$requested_version" && -f "$CURRENT_VERSION_FILE" ]]; then requested_version="$(tr -d '[:space:]' < "$CURRENT_VERSION_FILE")"; fi
  load_config "$requested_version"
  local failed=0
  local version schema_dir mysql_state
  version="$(select_version "$requested_version")"
  schema_dir="$(database_schema "$version")"
  mysql_state="$(mysql_health_state)"
  printf 'MYSQL_CONTAINER=%s\n' "$MYSQL_CONTAINER"
  printf 'MYSQL_HEALTH=%s\n' "${mysql_state:-unknown}"
  printf 'MYSQL_DATABASE=%s\n' "$MYSQL_DATABASE"
  printf 'MYSQL_VOLUME=%s\n' "$MYSQL_VOLUME_NAME"
  if mysql_probe; then
    printf 'MYSQL_PROBE_STATUS=ok\n'
  else
    printf 'MYSQL_PROBE_STATUS=failed\n'
    failed=1
  fi
  [[ -f "$schema_dir/collaboration-schema.sql" ]] || {
    printf 'MYSQL_SCHEMA_STATUS=missing\n'
    failed=1
  }
  curl -fsS "http://127.0.0.1:${AUDITFLOW_PORT}/health" || failed=1
  printf '\n'
  curl -fsS "http://127.0.0.1:${FILEANALYST_PORT}/api/health" || failed=1
  printf '\n'
  curl -fsS "http://127.0.0.1:${JIRAFLOW_PORT}/health" || failed=1
  printf '\n'
  return "$failed"
}

ai_bridge_smoke() {
  local health codex_status ai_route_status ai_port
  ai_port="${AUDITFLOW_AI_PORT:-46976}"
  local bridge_base="http://127.0.0.1:${ai_port}"
  health="$(curl -fsS "http://127.0.0.1:${AUDITFLOW_PORT}/health")" ||
    die "AuditFlow health is unavailable for the local AI bridge check"
  local health_version
  health_version="$(printf '%s' "$health" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const h=JSON.parse(s);process.stdout.write(String(h.version||""))})')"
  if [[ "$health_version" == 6.* ]]; then bridge_base="http://127.0.0.1:${AUDITFLOW_PORT}"; fi
  if ! printf '%s' "$health" | grep -Eq '"service"[[:space:]]*:[[:space:]]*"local-bridge"' ||
    ! printf '%s' "$health" | grep -Eq '"role"[[:space:]]*:[[:space:]]*"desktop"'; then
    die "AuditFlow is not running in desktop local-bridge mode; AI routes remain unavailable"
  fi
  codex_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 \
    -H "Origin: ${bridge_base}" \
    "${bridge_base}/api/codex/status")"
  [[ "$codex_status" == "200" || ( "$health_version" == 6.* && "$codex_status" == "401" ) ]] ||
    die "Local Codex status endpoint returned HTTP $codex_status"
  ai_route_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 \
    -H "Origin: ${bridge_base}" \
    -H 'content-type: application/json' --data '{"prompt":"local AI bridge smoke"}' \
    "${bridge_base}/api/ai/opinion")"
  [[ "$ai_route_status" != "404" ]] ||
    die "Local AI route returned HTTP 404; desktop local bridge is still hidden"
  log "Local AI bridge routes are available; provider credentials remain unconfigured until explicitly set"
  printf 'AI_BRIDGE_SMOKE=passed\n'
}

urls() {
  local requested_version=""
  if [[ "${1:-}" == "--version" ]]; then requested_version="${2:?--version requires a version}"; fi
  if [[ -z "$requested_version" && -f "$CURRENT_VERSION_FILE" ]]; then requested_version="$(tr -d '[:space:]' < "$CURRENT_VERSION_FILE")"; fi
  load_config "$requested_version"
  local entry=landing.html
  if [[ "$requested_version" == 7.6.* ]]; then entry=index.html; fi
  printf 'AuditFlow:   http://127.0.0.1:%s/%s\n' "$AUDITFLOW_PORT" "$entry"
  if [[ -n "${AUDITFLOW_LAN_HOST:-}" ]]; then
    printf 'LAN access:  http://%s:%s/%s\n' "$AUDITFLOW_LAN_HOST" "$AUDITFLOW_PORT" "$entry"
    printf 'LAN scope:   %s (HTTP is unencrypted; use only on a trusted network)\n' "$AUDITFLOW_LAN_CIDR"
  fi
  printf 'Local AI routes: http://127.0.0.1:%s/api/codex/status (same-origin, authentication required)\n' "$AUDITFLOW_PORT"
  printf 'FileAnalyst: http://127.0.0.1:%s/fileanalyst/\n' "$AUDITFLOW_PORT"
  printf 'JiraFlow:    http://127.0.0.1:%s/jiraflow/\n' "$AUDITFLOW_PORT"
  printf 'Direct FileAnalyst health: http://127.0.0.1:%s/api/health\n' "$FILEANALYST_PORT"
  printf 'Direct JiraFlow health:    http://127.0.0.1:%s/health\n' "$JIRAFLOW_PORT"
}

logs() {
  local service="${1:-backend}"
  local file
  file="$(log_file "$service")"
  [[ -f "$file" ]] || die "No log file for service: $service"
  tail -n 200 "$file"
}

main() {
  local command="${1:-}"
  shift || true
  case "$command" in
    install) install_release "$@" ;;
    install-client) install_web_client "$@" ;;
    use)
      install_release "$@"
      ;;
    start)
      local version=""
      if [[ "${1:-}" == "--version" ]]; then version="${2:?--version requires a version}"; fi
      start_stack "$version"
      ;;
    stop) stop_stack ;;
    restart)
      local version=""
      if [[ "${1:-}" == "--version" ]]; then version="${2:?--version requires a version}"; fi
      if [[ -n "$version" ]]; then
        load_config "$version"
        require_version_database_confirmation "$version"
      fi
      stop_stack "$version"
      start_stack "$version"
      ;;
    status) status_stack ;;
    health)
      health_stack "$@"
      ;;
    ai-smoke) load_config; ai_bridge_smoke ;;
    config)
      local version=""
      if [[ "${1:-}" == "--version" ]]; then version="${2:?--version requires a version}"; fi
      show_config "$version"
      ;;
    mcp-config)
      local version=""
      if [[ "${1:-}" == "--version" ]]; then version="${2:?--version requires a version}"; fi
      mcp_config "$version"
      ;;
    logs) logs "${1:-backend}" ;;
    urls) urls ;;
    -h|--help|help) usage ;;
    *) usage; [[ -z "$command" ]] || exit 2 ;;
  esac
}

if [[ "${JEAUDITFLOW_LOCAL_TEST_SOURCE_ONLY:-0}" != 1 ]]; then
  main "$@"
fi

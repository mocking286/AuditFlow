#!/usr/bin/env bash
# Sourced by jeauditflow-local.sh. Owns one version-specific native instance.
native_mysql_root() { printf '%s/native-mysql/%s\n' "$RUNTIME_ROOT" "$CONFIG_VERSION"; }

native_mysql_socket() {
  local digest
  digest="$(printf '%s' "$(native_mysql_root)" | shasum -a 256 | cut -c1-16)"
  printf '/tmp/jeauditflow-mysql-%s-%s/mysql.sock\n' "$UID" "$digest"
}

native_mysql_command() {
  local account="${1:-app}"; shift
  local root; root="$(native_mysql_root)"
  local executable="${MYSQL_BIN:-$(command -v mysql || true)}"
  [[ -n "$executable" ]] || die "Native MySQL client is missing; install the MySQL community server"
  "$executable" "--defaults-file=$root/$account.cnf" "$@"
}

native_mysql_matches_release() {
  [[ -f "$(native_mysql_root)/mysqld.pid" && -f "$(native_mysql_root)/app.cnf" ]] || return 1
  local server_dir
  server_dir="$(native_mysql_command app -Nse 'SELECT @@datadir' 2>/dev/null || true)"
  [[ "${server_dir%/}" == "$(native_mysql_root)/data" ]]
}

start_native_mysql() {
  local root daemon socket socket_directory
  root="$(native_mysql_root)"
  socket="$(native_mysql_socket)"
  socket_directory="${socket%/*}"
  daemon="${MYSQLD_BIN:-$(command -v mysqld || true)}"
  [[ -n "$daemon" ]] || die "Native MySQL server is missing; install the MySQL community server"
  [[ "$MYSQL_DATABASE" =~ ^[A-Za-z0-9_]+$ && "$MYSQL_USER" =~ ^[A-Za-z0-9_]+$ &&
    "$MYSQL_PASSWORD" =~ ^[A-Za-z0-9]+$ && "$MYSQL_ROOT_PASSWORD" =~ ^[A-Za-z0-9]+$ ]] ||
    die "Native database names and generated credentials must be alphanumeric"
  mkdir -p "$root"
  chmod 700 "$root"
  if [[ ! -e "$socket_directory" ]]; then mkdir -m 700 "$socket_directory"; fi
  [[ -d "$socket_directory" && ! -L "$socket_directory" && -O "$socket_directory" ]] ||
    die "Native MySQL socket directory must be a private directory owned by the current user"
  chmod 700 "$socket_directory"
  if [[ ! -d "$root/data/mysql" ]]; then
    mkdir -p "$root/data"
    "$daemon" --no-defaults --initialize-insecure "--datadir=$root/data" "--log-error=$root/initialize.log"
  fi
  if ! native_mysql_matches_release; then
    local listeners
    listeners="$(lsof -nP -iTCP:"$DB_PORT" -sTCP:LISTEN -t 2>/dev/null || true)"
    [[ -z "$listeners" ]] || die "Native MySQL port $DB_PORT is occupied by another instance"
    local daemon_args=(--no-defaults "--datadir=$root/data" "--port=$DB_PORT"
      --bind-address=127.0.0.1 --mysqlx=OFF "--socket=$socket"
      "--pid-file=$root/mysqld.pid" "--log-error=$root/mysqld.log"
      --max-allowed-packet=512M --innodb-buffer-pool-size=256M)
    if declare -F start_process >/dev/null; then
      # Port ownership was checked above; a saved PID may have been reused after reboot.
      rm -f "$(pid_file mysql)"
      start_process mysql "$root" "$daemon" "${daemon_args[@]}"
    else
      "$daemon" "${daemon_args[@]}" --daemonize
    fi
  fi
  local client="${MYSQL_BIN:-$(command -v mysql)}"
  for _ in {1..60}; do
    [[ -S "$socket" && -n "$(lsof -nP -iTCP:"$DB_PORT" -sTCP:LISTEN -t 2>/dev/null || true)" ]] && break
    sleep 1
  done
  [[ -S "$socket" && -n "$(lsof -nP -iTCP:"$DB_PORT" -sTCP:LISTEN -t 2>/dev/null || true)" ]] ||
    die "Native MySQL failed to start; inspect $root/mysqld.log"
  if [[ ! -f "$root/root.cnf" ]]; then
    umask 077
    printf '[client]\nprotocol=SOCKET\nsocket=%s\nuser=root\n' "$socket" >"$root/root.cnf"
    chmod 600 "$root/root.cnf"
  fi
  if [[ ! -f "$root/root-password-configured" ]]; then
    local root_temp="$root/root.cnf.tmp.$$"
    printf '[client]\nprotocol=SOCKET\nsocket=%s\nuser=root\npassword=%s\n' "$socket" "$MYSQL_ROOT_PASSWORD" >"$root_temp"
    chmod 600 "$root_temp"
    if ! printf "ALTER USER 'root'@'localhost' IDENTIFIED BY '%s';\n" "$MYSQL_ROOT_PASSWORD" |
      native_mysql_command root 2>/dev/null; then
      "$client" "--defaults-file=$root_temp" -Nse 'SELECT 1' >/dev/null 2>&1 ||
        die "Native MySQL root authentication failed; preserve the data directory and inspect its client configuration"
    fi
    mv "$root_temp" "$root/root.cnf"
    : >"$root/root-password-configured"
    chmod 600 "$root/root-password-configured"
  fi
  umask 077
  printf '[client]\nprotocol=TCP\nhost=127.0.0.1\nport=%s\nuser=%s\npassword=%s\ndatabase=%s\n' "$DB_PORT" "$MYSQL_USER" "$MYSQL_PASSWORD" "$MYSQL_DATABASE" >"$root/app.cnf"
  chmod 600 "$root/app.cnf"
  printf "CREATE DATABASE IF NOT EXISTS \`%s\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER IF NOT EXISTS '%s'@'127.0.0.1' IDENTIFIED BY '%s'; GRANT ALL PRIVILEGES ON \`%s\`.* TO '%s'@'127.0.0.1';\n" \
    "$MYSQL_DATABASE" "$MYSQL_USER" "$MYSQL_PASSWORD" "$MYSQL_DATABASE" "$MYSQL_USER" | native_mysql_command root
  local engine
  engine="$(native_mysql_command app -Nse 'SELECT @@default_storage_engine')"
  [[ "$engine" == InnoDB ]] || die "Native MySQL must use InnoDB; found $engine"
  native_mysql_matches_release || die "Native MySQL ownership verification failed"
  log "Native MySQL is ready on 127.0.0.1:$DB_PORT ($MYSQL_DATABASE)"
}

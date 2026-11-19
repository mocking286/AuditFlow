#!/usr/bin/env bash
# Installs JEAuditFlow 7.9.5 from this Server-Install directory onto a Linux
# server: /opt/jeauditflow/7.9.5 (programs), /var/lib/jeauditflow/7.9.5 (data),
# /etc/jeauditflow/7.9.5.env (configuration). Existing data and configuration
# are never overwritten. The database is prepared separately (see INSTALL).
set -euo pipefail

VERSION=7.9.5
NODE_VERSION=26.13.1
BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${JEAUDITFLOW_PREFIX:-/opt/jeauditflow}"
APP_ROOT="$PREFIX/$VERSION"
DATA_ROOT="${JEAUDITFLOW_DATA_ROOT:-/var/lib/jeauditflow}/$VERSION"
CONFIG_DIR=/etc/jeauditflow
CONFIG_FILE="$CONFIG_DIR/$VERSION.env"
SERVICE_USER=jeauditflow
NODE_HOME="$PREFIX/node"
INSTALL_NODE=0
NODE_TARBALL=""
USE_SYSTEMD=1

die() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }
info() { printf '==> %s\n' "$*"; }

while (($#)); do
  case "$1" in
    --install-node) INSTALL_NODE=1 ;;
    --node-tarball) NODE_TARBALL="${2:?}"; INSTALL_NODE=1; shift ;;
    --no-systemd) USE_SYSTEMD=0 ;;
    -h|--help)
      printf 'Usage: sudo bash install.sh [--install-node | --node-tarball node-v%s-linux-x64.tar.xz] [--no-systemd]\n' "$NODE_VERSION"
      exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

[[ $EUID -eq 0 ]] || die "run as root (sudo)"
[[ "$(uname -s)" == Linux ]] || die "Linux is required"
for tool in unzip sha256sum; do command -v "$tool" >/dev/null || die "missing required tool: $tool"; done
((USE_SYSTEMD == 0)) || command -v systemctl >/dev/null || die "systemd is required (or pass --no-systemd)"

info "Verifying package checksums"
(cd "$BUNDLE_DIR" && sha256sum --quiet -c SHA256SUMS.txt) || die "SHA256SUMS.txt verification failed"

node_ok() {
  local bin="$1" v
  [[ -x "$bin" ]] || return 1
  v="$("$bin" -p 'process.versions.node' 2>/dev/null)" || return 1
  "$bin" -e '
    const [a,b,c]=process.argv[1].split(".").map(Number), [x,y,z]=process.argv[2].split(".").map(Number);
    process.exit(a>x||(a===x&&(b>y||(b===y&&c>=z)))?0:1)' "$v" "$NODE_VERSION"
}

if ! node_ok "$NODE_HOME/bin/node"; then
  if ((INSTALL_NODE)); then
    arch="$(uname -m)"; case "$arch" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) die "unsupported CPU: $arch" ;; esac
    name="node-v$NODE_VERSION-linux-$arch.tar.xz"
    work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
    if [[ -n "$NODE_TARBALL" ]]; then
      cp "$NODE_TARBALL" "$work/$name"
    else
      command -v curl >/dev/null || die "curl is required for --install-node"
      info "Downloading Node.js $NODE_VERSION"
      curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/$name" -o "$work/$name"
      curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$work/SHASUMS256.txt"
      (cd "$work" && grep " $name\$" SHASUMS256.txt | sha256sum -c --quiet -) || die "Node.js checksum mismatch"
    fi
    mkdir -p "$NODE_HOME"
    tar -xJf "$work/$name" -C "$NODE_HOME" --strip-components=1 --no-same-owner
  elif node_ok "$(command -v node || true)"; then
    mkdir -p "$NODE_HOME/bin"
    ln -sfn "$(command -v node)" "$NODE_HOME/bin/node"
  else
    die "Node.js >= $NODE_VERSION is required. Re-run with --install-node (downloads from nodejs.org) or --node-tarball <file>."
  fi
fi
node_ok "$NODE_HOME/bin/node" || die "Node.js at $NODE_HOME/bin/node is older than $NODE_VERSION"
info "Node.js $("$NODE_HOME/bin/node" -v)"

java_bin="$(command -v java || true)"
[[ -n "$java_bin" ]] || die "Java 21+ (OpenJDK) is required for JiraFlow"
java_major="$("$java_bin" -XshowSettings:properties -version 2>&1 | awk -F'= ' '/java.specification.version/{print $2}')"
((${java_major%%.*} >= 21)) || die "Java 21+ is required for JiraFlow (found $java_major)"
info "Java $java_major ($java_bin)"

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  info "Creating system user $SERVICE_USER"
  useradd --system --home-dir "$DATA_ROOT" --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

if [[ -d "$APP_ROOT" ]]; then
  backup="$APP_ROOT.previous-$(date +%Y%m%d%H%M%S)"
  info "Keeping previous program files at $backup"
  mv "$APP_ROOT" "$backup"
fi
info "Unpacking programs into $APP_ROOT"
mkdir -p "$APP_ROOT/client" "$APP_ROOT/database"
unzip -q "$BUNDLE_DIR/JEAuditFlow-$VERSION-Backend.zip" -d "$APP_ROOT"
unzip -q "$BUNDLE_DIR/JEAuditFlow-$VERSION-Web-Client.zip" -d "$APP_ROOT/client"
unzip -q "$BUNDLE_DIR/JEAuditFlow-$VERSION-Database.zip" -d "$APP_ROOT/database"
cp -r "$BUNDLE_DIR/deploy" "$APP_ROOT/deploy"
chown -R root:"$SERVICE_USER" "$APP_ROOT"
find "$APP_ROOT" -type d -exec chmod 750 {} +
find "$APP_ROOT" -type f -exec chmod 640 {} +
chmod 750 "$APP_ROOT"/database/*.sh "$APP_ROOT"/deploy/*.sh
for f in "$APP_ROOT"/server/node_modules/.bin/* "$APP_ROOT"/fileanalyst/node_modules/.bin/*; do [[ -e "$f" ]] && chmod 750 "$f"; done
chmod 755 "$PREFIX"

info "Preparing data directory $DATA_ROOT"
mkdir -p "$DATA_ROOT"/{auditflow,users,ops,releases,fileanalyst,jiraflow}
chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_ROOT"
chmod 700 "$DATA_ROOT" "$DATA_ROOT"/*

mkdir -p "$CONFIG_DIR"
chmod 750 "$CONFIG_DIR"; chown root:"$SERVICE_USER" "$CONFIG_DIR"
if [[ -f "$CONFIG_FILE" ]]; then
  info "Keeping existing configuration $CONFIG_FILE"
else
  install -m 640 -o root -g "$SERVICE_USER" "$BUNDLE_DIR/deploy/jeauditflow-$VERSION.env.example" "$CONFIG_FILE"
  sed -i "s#^JIRAFLOW_JAVA=.*#JIRAFLOW_JAVA=$(readlink -f "$java_bin")#" "$CONFIG_FILE"
  info "Wrote configuration template $CONFIG_FILE (edit the <...> values before starting)"
fi

install -m 755 "$BUNDLE_DIR/deploy/jeauditflowctl.sh" /usr/local/bin/jeauditflowctl
if ((USE_SYSTEMD)); then
  info "Installing systemd units"
  install -m 644 "$BUNDLE_DIR/deploy/systemd/jeauditflow-api.service" /etc/systemd/system/
  install -m 644 "$BUNDLE_DIR/deploy/systemd/jeauditflow-fileanalyst.service" /etc/systemd/system/
  systemctl daemon-reload
  next="sudo jeauditflowctl start"
else
  next="run the ExecStart commands of deploy/systemd/*.service as user $SERVICE_USER with $CONFIG_FILE loaded"
fi

printf '\nInstalled JEAuditFlow %s.\nNext: prepare MySQL (database/README.md), edit %s, then %s\n' "$VERSION" "$CONFIG_FILE" "$next"

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
MANIFEST_JSON="$ROOT_DIR/manifest.json"
VERIFY="$ROOT_DIR/scripts/verify-web-release.mjs"
COMMAND="${1:-check}"

require_tool() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }
}

run_checks() {
  require_tool node
  require_tool git
  require_tool zip
  require_tool unzip
  if ! command -v shasum >/dev/null 2>&1 && ! command -v sha256sum >/dev/null 2>&1; then
    echo 'Missing required checksum command: shasum or sha256sum' >&2
    exit 1
  fi
  node "$VERIFY" "$ROOT_DIR"
  git -C "$ROOT_DIR" diff --check
}

read_version() {
  node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(m.version)' "$MANIFEST_JSON"
}

package_release() {
  run_checks
  mkdir -p "$DIST_DIR"
  local version archive checksum
  version="$(read_version)"
  archive="$DIST_DIR/AuditFlow-v${version}-extension.zip"
  checksum="${archive}.sha256"
  rm -f "$archive" "$checksum"
  local package_list
  package_list="$(mktemp "${TMPDIR:-/tmp}/auditflow-release-list.XXXXXX")"
  node - "$ROOT_DIR" "$ROOT_DIR/.release-manifest" > "$package_list" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const manifestPath = process.argv[3];
const entries = fs.readFileSync(manifestPath, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
function walk(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['.git', '.idea', 'dist', 'docs', 'node_modules'].includes(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(full)); else result.push(full);
  }
  return result;
}
function matches(value, entry) {
  if (entry.endsWith('/')) return value.startsWith(entry);
  if (!entry.includes('*')) return value === entry;
  const escaped = entry.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(value);
}
const files = walk(root).map((full) => path.relative(root, full).split(path.sep).join('/'));
const selected = files.filter((value) => entries.some((entry) => matches(value, entry)));
for (const value of [...new Set(selected)].sort()) console.log(value);
NODE
  (cd "$ROOT_DIR" && zip -q "$archive" -@ < "$package_list")
  rm -f "$package_list"
  unzip -tqq "$archive"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$archive" | tee "$checksum"
  else
    sha256sum "$archive" | tee "$checksum"
  fi
  echo "Created $archive"
}

case "$COMMAND" in
  check)
    run_checks
    ;;
  package)
    package_release
    ;;
  commit|push)
    package_release
    message="${RELEASE_MESSAGE:-${2:-}}"
    if [[ -z "$message" ]]; then
      echo 'Set RELEASE_MESSAGE or pass a commit message as the second argument.' >&2
      exit 2
    fi
    git -C "$ROOT_DIR" add -A .github/workflows .gitignore .release-manifest README.md INSTALL.md scripts icons
    git -C "$ROOT_DIR" status --short
    git -C "$ROOT_DIR" commit -m "$message"
    if [[ "$COMMAND" == "push" ]]; then
      git -C "$ROOT_DIR" push origin HEAD:main
    fi
    ;;
  *)
    echo "Usage: $0 {check|package|commit|push}" >&2
    exit 2
    ;;
esac

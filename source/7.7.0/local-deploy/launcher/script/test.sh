#!/usr/bin/env bash
set -euo pipefail

LAUNCHER_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -d /Applications/Xcode-beta.app/Contents/Developer ]]; then
  export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer
fi
TEST_OUTPUT="$(mktemp -d "${TMPDIR:-/tmp}/jeauditflow-launcher-tests.XXXXXX")"
trap 'rm -rf "$TEST_OUTPUT"' EXIT

for test_name in RuntimeCatalogTests LauncherResponsivenessTests LauncherWindowTests; do
  xcrun swiftc -parse-as-library -D LAUNCHER_RUNTIME_CATALOG_TESTS \
    "$LAUNCHER_ROOT/Sources/JEAuditFlowLauncher/main.swift" \
    "$LAUNCHER_ROOT/Tests/$test_name.swift" \
    -o "$TEST_OUTPUT/$test_name"
  "$TEST_OUTPUT/$test_name"
done

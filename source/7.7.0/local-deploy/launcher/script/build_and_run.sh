#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
case "$MODE" in
  run|--build-only|--verify|verify|--debug|debug|--logs|logs|--telemetry|telemetry) ;;
  *) echo "usage: $0 [run|--build-only|--verify|--debug|--logs|--telemetry]" >&2; exit 2 ;;
esac
APP_NAME="JEAuditFlowLauncher"
BUNDLE_ID="local.maplemock.jeauditflowlauncher"
MIN_SYSTEM_VERSION="14.0"
RELEASE_VERSION="${JEAUDITFLOW_LAUNCHER_VERSION:-7.7.0}"
[[ "$RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Invalid launcher version" >&2; exit 2; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ROOT="$(cd "$ROOT_DIR/../.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
APP_BUNDLE="$DIST_DIR/$APP_NAME.app"
APP_CONTENTS="$APP_BUNDLE/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_BINARY="$APP_MACOS/$APP_NAME"
INFO_PLIST="$APP_CONTENTS/Info.plist"
DEFAULT_ROOT="$ROOT_DIR/Resources/default-project-root.txt"
ICON_SOURCE="$ROOT_DIR/Resources/JEAuditFlowLauncher-icon-source.png"
ICONSET_DIR="$ROOT_DIR/$APP_NAME.iconset"
ICON_NAME="$APP_NAME.icns"
INSTALL_DIR="${JEAUDITFLOW_LAUNCHER_INSTALL_DIR:-$HOME/Applications}"
INSTALLED_APP="$INSTALL_DIR/$APP_NAME.app"

cd "$ROOT_DIR"
if [[ -d "/Applications/Xcode-beta.app/Contents/Developer" ]]; then
  export DEVELOPER_DIR="/Applications/Xcode-beta.app/Contents/Developer"
fi

if [[ "$MODE" != --build-only ]] && pgrep -x "$APP_NAME" >/dev/null 2>&1; then
  /usr/bin/pkill -x "$APP_NAME" || true
  for _ in {1..20}; do
    pgrep -x "$APP_NAME" >/dev/null 2>&1 || break
    sleep 0.25
  done
fi

printf '%s\n' "$PROJECT_ROOT" > "$DEFAULT_ROOT"
swift build -c release
BUILD_BINARY="$(swift build -c release --show-bin-path)/$APP_NAME"

if [[ ! -f "$ICON_SOURCE" ]]; then
  echo "Missing launcher icon source: $ICON_SOURCE" >&2
  exit 1
fi

rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"
for spec in \
  "16:icon_16x16.png" \
  "32:icon_16x16@2x.png" \
  "32:icon_32x32.png" \
  "64:icon_32x32@2x.png" \
  "128:icon_128x128.png" \
  "256:icon_128x128@2x.png" \
  "256:icon_256x256.png" \
  "512:icon_256x256@2x.png" \
  "512:icon_512x512.png" \
  "1024:icon_512x512@2x.png"; do
  size="${spec%%:*}"
  filename="${spec#*:}"
  /usr/bin/sips -z "$size" "$size" "$ICON_SOURCE" --out "$ICONSET_DIR/$filename" >/dev/null
done

rm -rf "$APP_BUNDLE"
mkdir -p "$APP_MACOS" "$APP_CONTENTS/Resources"
cp "$BUILD_BINARY" "$APP_BINARY"
cp "$DEFAULT_ROOT" "$APP_CONTENTS/Resources/default-project-root.txt"
/usr/bin/iconutil --convert icns --output "$APP_CONTENTS/Resources/$ICON_NAME" "$ICONSET_DIR"
rm -rf "$ICONSET_DIR"
chmod +x "$APP_BINARY"

cat >"$INFO_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>$APP_NAME</string>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_ID</string>
  <key>CFBundleName</key>
  <string>JEAuditFlow 本地启动器</string>
  <key>CFBundleDisplayName</key>
  <string>JEAuditFlow 本地启动器</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>$RELEASE_VERSION</string>
  <key>CFBundleVersion</key>
  <string>$RELEASE_VERSION</string>
  <key>CFBundleIconFile</key>
  <string>$ICON_NAME</string>
  <key>LSMinimumSystemVersion</key>
  <string>$MIN_SYSTEM_VERSION</string>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
</dict>
</plist>
PLIST

/usr/bin/plutil -lint "$INFO_PLIST"
/usr/bin/codesign --force --deep --sign - "$APP_BUNDLE" >/dev/null
/usr/bin/codesign --verify --deep --strict "$APP_BUNDLE"
if [[ "$MODE" == --build-only ]]; then
  printf 'Built launcher without installing or starting services: %s\n' "$APP_BUNDLE"
  exit 0
fi
mkdir -p "$INSTALL_DIR"
rm -rf "$INSTALLED_APP"
/usr/bin/ditto "$APP_BUNDLE" "$INSTALLED_APP"
/usr/bin/codesign --verify --deep --strict "$INSTALLED_APP"

open_installed_app() {
  /usr/bin/open -n "$INSTALLED_APP"
}

case "$MODE" in
  run)
    open_installed_app
    ;;
  --verify|verify)
    open_installed_app
    for _ in {1..12}; do
      pgrep -x "$APP_NAME" >/dev/null && exit 0
      sleep 1
    done
    echo "App did not remain running: $APP_NAME" >&2
    exit 1
    ;;
  --debug|debug)
    lldb -- "$APP_BINARY"
    ;;
  --logs|logs)
    open_installed_app
    /usr/bin/log stream --info --style compact --predicate "process == \"$APP_NAME\""
    ;;
  --telemetry|telemetry)
    open_installed_app
    /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  *)
    echo "usage: $0 [run|--build-only|--verify|--debug|--logs|--telemetry]" >&2
    exit 2
    ;;
esac

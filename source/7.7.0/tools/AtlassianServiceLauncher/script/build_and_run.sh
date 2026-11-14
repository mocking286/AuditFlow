#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="AtlassianServiceLauncher"
BUNDLE_ID="local.maplemock.atlassianservicelauncher"
MIN_SYSTEM_VERSION="14.0"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
APP_BUNDLE="$DIST_DIR/$APP_NAME.app"
APP_CONTENTS="$APP_BUNDLE/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_BINARY="$APP_MACOS/$APP_NAME"
INSTALL_DIR="$HOME/Applications"
INSTALLED_APP="$INSTALL_DIR/$APP_NAME.app"

cd "$ROOT_DIR"
if [[ -d "/Applications/Xcode-beta.app/Contents/Developer" ]]; then
  export DEVELOPER_DIR="/Applications/Xcode-beta.app/Contents/Developer"
fi
if pgrep -x "$APP_NAME" >/dev/null 2>&1; then
  /usr/bin/pkill -x "$APP_NAME" || true
  for _ in {1..20}; do
    pgrep -x "$APP_NAME" >/dev/null 2>&1 || break
    sleep 0.25
  done
fi
swift build
BUILD_BINARY="$(swift build --show-bin-path)/$APP_NAME"

rm -rf "$APP_BUNDLE"
mkdir -p "$APP_MACOS" "$APP_CONTENTS/Resources" "$INSTALL_DIR"
cp "$BUILD_BINARY" "$APP_BINARY"
chmod +x "$APP_BINARY"
cp "$ROOT_DIR/Resources/AtlassianLogo.jpg" "$APP_CONTENTS/Resources/AtlassianLogo.jpg"

ICONSET_DIR="$ROOT_DIR/.build/AtlassianServiceLauncher.iconset"
ICON_SOURCE="$ROOT_DIR/.build/AtlassianServiceLauncher-icon-source.png"
rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"
# Convert the user-provided JPEG to a real PNG before handing it to iconutil.
# `--setProperty format png` can preserve the source codec on some macOS builds;
# `-s format png` performs the actual format conversion.
sips -s format png \
  --padToHeightWidth 739 739 \
  --padColor F2EAE6 \
  "$ROOT_DIR/Resources/AtlassianLogo.jpg" \
  --out "$ICON_SOURCE" >/dev/null
for SIZE in 16 32 128 256 512; do
  DOUBLE_SIZE=$((SIZE * 2))
  sips -s format png -z "$SIZE" "$SIZE" "$ICON_SOURCE" \
    --out "$ICONSET_DIR/icon_${SIZE}x${SIZE}.png" >/dev/null
  sips -s format png -z "$DOUBLE_SIZE" "$DOUBLE_SIZE" "$ICON_SOURCE" \
    --out "$ICONSET_DIR/icon_${SIZE}x${SIZE}@2x.png" >/dev/null
done
/usr/bin/iconutil --convert icns "$ICONSET_DIR" \
  --output "$APP_CONTENTS/Resources/AtlassianServiceLauncher.icns"

cat >"$APP_CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>$APP_NAME</string>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_ID</string>
  <key>CFBundleName</key>
  <string>Atlassian 本机服务启动器</string>
  <key>CFBundleDisplayName</key>
  <string>Atlassian 本机服务启动器</string>
  <key>CFBundleIconFile</key>
  <string>AtlassianServiceLauncher</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>$MIN_SYSTEM_VERSION</string>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
</dict>
</plist>
PLIST

/usr/bin/plutil -lint "$APP_CONTENTS/Info.plist"
/usr/bin/codesign --force --deep --sign - "$APP_BUNDLE" >/dev/null
rm -rf "$INSTALLED_APP"
/usr/bin/ditto "$APP_BUNDLE" "$INSTALLED_APP"
/usr/bin/codesign --verify --deep --strict "$INSTALLED_APP"

open_installed_app() {
  if [[ "$MODE" == "--start-services" ]]; then
    /usr/bin/open -n "$INSTALLED_APP" --args --start-services
  else
    /usr/bin/open -n "$INSTALLED_APP"
  fi
}

case "$MODE" in
  run|--verify|--start-services)
    open_installed_app
    if [[ "$MODE" == "--verify" ]]; then
      for _ in {1..10}; do
        pgrep -x "$APP_NAME" >/dev/null && exit 0
        sleep 1
      done
      echo "App did not remain running: $APP_NAME" >&2
      exit 1
    fi
    ;;
  --debug)
    lldb -- "$APP_BINARY"
    ;;
  --logs)
    /usr/bin/open -n "$INSTALLED_APP"
    LOG_FILE="$HOME/Library/Logs/AtlassianServiceLauncher/launcher.log"
    touch "$LOG_FILE"
    tail -f "$LOG_FILE"
    ;;
  --telemetry)
    /usr/bin/open -n "$INSTALLED_APP"
    /usr/bin/log stream --info --style compact --predicate "process == \"$APP_NAME\""
    ;;
  *)
    echo "usage: $0 [run|--verify|--start-services|--debug|--logs|--telemetry]" >&2
    exit 2
    ;;
esac

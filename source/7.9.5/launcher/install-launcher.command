#!/bin/bash
# Installs the 7.9.5 JEAuditFlowLauncher.app in place of the 7.7 launcher (same
# bundle id), signs it ad hoc so macOS accepts the changed bundle, and opens it.
#   bash install-launcher.command [/Applications]
set -eu

SOURCE_APP="$(cd "$(dirname "$0")" && pwd)/JEAuditFlowLauncher.app"
TARGET_DIR="${1:-/Applications}"
[ -d "$TARGET_DIR" ] && [ -w "$TARGET_DIR" ] || TARGET_DIR="$HOME/Applications"
TARGET="$TARGET_DIR/JEAuditFlowLauncher.app"
BACKUPS="$HOME/Library/Application Support/JEAuditFlow/launcher-backups"

[ -x "$SOURCE_APP/Contents/MacOS/JEAuditFlowLauncher" ] || { echo "找不到 $SOURCE_APP" >&2; exit 1; }
mkdir -p "$TARGET_DIR"

# The 7.7 launcher is a window app; quitting it does not stop running services.
pkill -x JEAuditFlowLauncher 2>/dev/null || true

if [ -d "$TARGET" ]; then
  # Kept as a zip so LaunchServices does not see two apps with the same bundle id.
  old="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$TARGET/Contents/Info.plist" 2>/dev/null || echo unknown)"
  mkdir -p "$BACKUPS"
  ditto -c -k --keepParent "$TARGET" "$BACKUPS/JEAuditFlowLauncher-$old-$(date +%Y%m%d%H%M%S).zip"
  rm -rf "$TARGET"
  echo "旧启动器（$old）已备份到 $BACKUPS"
fi

ditto "$SOURCE_APP" "$TARGET"
chmod +x "$TARGET/Contents/MacOS/JEAuditFlowLauncher"
xattr -cr "$TARGET" 2>/dev/null || true
codesign --force --deep --sign - "$TARGET"
codesign --verify --deep --strict "$TARGET"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$TARGET" >/dev/null 2>&1 || true

echo "已安装：$TARGET（包含 _CodeSignature/CodeResources）"
echo "正在打开启动器……以后双击它即可直接启动 JEAuditFlow 7.9.5。"
open "$TARGET"

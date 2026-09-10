#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
MESSAGE="${1:-}"
if [[ -z "$MESSAGE" ]]; then
  read -r -p 'Commit message: ' MESSAGE
fi
if [[ -z "$MESSAGE" ]]; then
  echo 'A non-empty commit message is required.' >&2
  exit 2
fi
RELEASE_MESSAGE="$MESSAGE" bash scripts/release-web.sh push
read -r -p 'Press Return to close.' _

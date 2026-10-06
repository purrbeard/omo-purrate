#!/usr/bin/env bash
set -euo pipefail

APP_NAME="OmO UI"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$ROOT/release/mac-arm64/$APP_NAME.app"

if [[ ! -d "$SOURCE" ]]; then
  echo "error: $SOURCE not found; run 'npm run package:mac' first." >&2
  exit 1
fi

if pgrep -x "$APP_NAME" >/dev/null 2>&1; then
  echo "error: $APP_NAME is running; quit it (Cmd+Q) and run this script again." >&2
  exit 1
fi

if [[ -w /Applications ]]; then
  DEST_DIR="/Applications"
else
  DEST_DIR="$HOME/Applications"
  echo "/Applications is not writable; installing into $DEST_DIR instead."
  mkdir -p "$DEST_DIR"
fi

DEST="$DEST_DIR/$APP_NAME.app"
rm -rf "$DEST"
ditto "$SOURCE" "$DEST"
# The system xattr: a Python xattr earlier in PATH lacks -r.
/usr/bin/xattr -dr com.apple.quarantine "$DEST"

echo "Installed $DEST"

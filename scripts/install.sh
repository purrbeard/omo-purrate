#!/usr/bin/env bash
# One-command install of the latest OmO UI release:
#   curl -fsSL https://raw.githubusercontent.com/realsigridjin/omo-ui-macosapp/main/scripts/install.sh | bash
# Downloads the arm64 zip from the latest GitHub release, replaces "OmO UI.app" in $OMO_UI_APP_DIR (default
# /Applications) and clears the quarantine flag, because the app is ad-hoc signed and Gatekeeper would refuse it.
set -euo pipefail

REPO="realsigridjin/omo-ui-macosapp"
APP_DIR="${OMO_UI_APP_DIR:-/Applications}"
APP_NAME="OmO UI.app"

fail() { printf 'omo-ui install: %s\n' "$1" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "macOS only"
[ "$(uname -m)" = "arm64" ] || fail "Apple silicon (arm64) only"
if pgrep -f "/${APP_NAME}/Contents/MacOS/OmO UI" >/dev/null 2>&1; then
  fail "OmO UI is running; quit it (Cmd+Q) and run this again"
fi

url=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep -o '"browser_download_url": *"[^"]*arm64[^"]*\.zip"' | head -1 | sed -E 's/.*"(https[^"]+)"/\1/')
[ -n "$url" ] || fail "no arm64 zip in the latest release of ${REPO}"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
printf 'Downloading %s\n' "$url"
curl -fL --progress-bar -o "$tmp/omo-ui.zip" "$url"
ditto -x -k "$tmp/omo-ui.zip" "$tmp/x"
[ -d "$tmp/x/${APP_NAME}" ] || fail "the zip does not contain ${APP_NAME}"

mkdir -p "$APP_DIR"
sudo_cmd=""
[ -w "$APP_DIR" ] || sudo_cmd="sudo"
$sudo_cmd rm -rf "${APP_DIR:?}/${APP_NAME}"
$sudo_cmd ditto "$tmp/x/${APP_NAME}" "${APP_DIR}/${APP_NAME}"
$sudo_cmd /usr/bin/xattr -r -d com.apple.quarantine "${APP_DIR}/${APP_NAME}" 2>/dev/null || true

printf 'Installed %s/%s\n' "$APP_DIR" "$APP_NAME"
command -v omo >/dev/null 2>&1 || printf 'omo is not installed yet; OmO UI can install it on first launch, or run: curl -fsSL https://get.omo.dev/install.sh | bash\n'
printf 'Open it with: open "%s/%s"\n' "$APP_DIR" "$APP_NAME"

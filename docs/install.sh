#!/usr/bin/env bash
set -euo pipefail

# Vellum macOS installer.
# Usage: curl -fsSL https://arunkant.github.io/vellum/install.sh | bash

REPO="${VELLUM_REPO:-arunkant/vellum}"
APP_NAME="vellum"

c_blue=$'\033[1;34m'; c_yellow=$'\033[1;33m'; c_red=$'\033[1;31m'; c_reset=$'\033[0m'
log()  { printf '%s==>%s %s\n' "$c_blue"   "$c_reset" "$*"; }
warn() { printf '%s!!%s  %s\n' "$c_yellow" "$c_reset" "$*" >&2; }
die()  { printf '%sxx%s  %s\n' "$c_red"    "$c_reset" "$*" >&2; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || die "This installer only supports macOS."
ARCH="$(uname -m)"
[[ "$ARCH" == "arm64" ]] || die "Vellum currently ships only for Apple Silicon (arm64); detected $ARCH."

for cmd in curl unzip; do
  command -v "$cmd" >/dev/null || die "$cmd is required but not installed."
done

log "Looking up the latest Vellum release for $REPO..."
API_URL="https://api.github.com/repos/$REPO/releases/latest"
ASSET_URL="$(
  curl -fsSL \
    -H 'Accept: application/vnd.github+json' \
    ${GITHUB_TOKEN:+-H "Authorization: Bearer $GITHUB_TOKEN"} \
    "$API_URL" \
  | grep -o '"browser_download_url": *"[^"]*darwin-arm64[^"]*\.zip"' \
  | head -n1 \
  | sed 's/.*"\(https[^"]*\)"/\1/'
)"
[[ -n "$ASSET_URL" ]] || die "Could not find a darwin-arm64 .zip asset in the latest release of $REPO."

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT
ZIP="$TMPDIR/$APP_NAME.zip"

log "Downloading $ASSET_URL"
curl -fL --progress-bar -o "$ZIP" "$ASSET_URL"

log "Extracting..."
mkdir -p "$TMPDIR/extracted"
unzip -q "$ZIP" -d "$TMPDIR/extracted"

APP_PATH="$(find "$TMPDIR/extracted" -maxdepth 3 -name '*.app' -print -quit)"
[[ -n "$APP_PATH" ]] || die "No .app bundle found inside the downloaded archive."

INSTALL_DIR="/Applications"
if [[ ! -w "$INSTALL_DIR" ]]; then
  warn "/Applications is not writable; installing to ~/Applications instead."
  INSTALL_DIR="$HOME/Applications"
  mkdir -p "$INSTALL_DIR"
fi
DEST="$INSTALL_DIR/$(basename "$APP_PATH")"

if pgrep -ifl "$(basename "$APP_PATH")/Contents/MacOS" >/dev/null 2>&1; then
  log "Quitting running $APP_NAME..."
  osascript -e "tell application \"$APP_NAME\" to quit" 2>/dev/null || true
  sleep 1
fi

if [[ -e "$DEST" ]]; then
  log "Removing existing install at $DEST"
  rm -rf "$DEST"
fi

log "Installing to $DEST"
mv "$APP_PATH" "$DEST"

# Vellum is not code-signed or notarized. The quarantine flag added by
# the browser/curl download would otherwise make Gatekeeper refuse to open it.
log "Removing macOS quarantine attribute..."
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

log "Launching $APP_NAME..."
open "$DEST"

log "Done. Installed at $DEST"

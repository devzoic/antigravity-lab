#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
#  AI Account Manager — One-Line Installer
#  Usage:
#    macOS/Linux: curl -fsSL https://raw.githubusercontent.com/devzoic/antigravity-lab/main/install.sh | bash
#    Options:     ... | bash -s -- --version 1.2.0
# ─────────────────────────────────────────────────────────
set -euo pipefail

REPO="devzoic/antigravity-lab"
APP_NAME="Antigravity Lab"
VERSION="${1:-latest}"

# ── Colors ──
RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${BLUE}▸${NC} $1"; }
ok()    { echo -e "${GREEN}✔${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠${NC} $1"; }
fail()  { echo -e "${RED}✖ $1${NC}"; exit 1; }

# ── Parse args ──
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) shift ;;
  esac
done

# ── Detect OS & Arch ──
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin) PLATFORM="macos" ;;
  Linux)  PLATFORM="linux" ;;
  *)      fail "Unsupported OS: $OS" ;;
esac

case "$ARCH" in
  x86_64|amd64)  ARCH_TAG="x64" ;;
  aarch64|arm64) ARCH_TAG="aarch64" ;;
  *)             fail "Unsupported architecture: $ARCH" ;;
esac

info "Detected: ${PLATFORM} / ${ARCH_TAG}"

# ── Determine download URL ──
if [[ "$VERSION" == "latest" ]]; then
  API_URL="https://api.github.com/repos/${REPO}/releases/latest"
else
  API_URL="https://api.github.com/repos/${REPO}/releases/tags/v${VERSION}"
fi

info "Fetching release info..."
RELEASE_JSON=$(curl -fsSL "$API_URL") || fail "Failed to fetch release info. Check your internet connection."

if [[ "$PLATFORM" == "macos" ]]; then
  # Look for .dmg matching architecture
  if [[ "$ARCH_TAG" == "aarch64" ]]; then
    ASSET_URL=$(echo "$RELEASE_JSON" | grep -o '"browser_download_url": *"[^"]*aarch64[^"]*\.dmg"' | head -1 | cut -d'"' -f4)
  else
    ASSET_URL=$(echo "$RELEASE_JSON" | grep -o '"browser_download_url": *"[^"]*x64[^"]*\.dmg"' | head -1 | cut -d'"' -f4)
  fi
  # Fallback: any .dmg
  if [[ -z "${ASSET_URL:-}" ]]; then
    ASSET_URL=$(echo "$RELEASE_JSON" | grep -o '"browser_download_url": *"[^"]*\.dmg"' | head -1 | cut -d'"' -f4)
  fi
elif [[ "$PLATFORM" == "linux" ]]; then
  # Prefer .deb, fallback to .AppImage
  ASSET_URL=$(echo "$RELEASE_JSON" | grep -o '"browser_download_url": *"[^"]*\.deb"' | head -1 | cut -d'"' -f4)
  if [[ -z "${ASSET_URL:-}" ]]; then
    ASSET_URL=$(echo "$RELEASE_JSON" | grep -o '"browser_download_url": *"[^"]*\.AppImage"' | head -1 | cut -d'"' -f4)
  fi
fi

[[ -z "${ASSET_URL:-}" ]] && fail "Could not find a suitable download for ${PLATFORM}/${ARCH_TAG}"

FILENAME=$(basename "$ASSET_URL")
info "Downloading: $FILENAME"

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  ok "Dry run — would download: $ASSET_URL"
  exit 0
fi

# ── Download ──
TMPDIR_DL=$(mktemp -d)
trap "rm -rf $TMPDIR_DL" EXIT
curl -fSL --progress-bar -o "${TMPDIR_DL}/${FILENAME}" "$ASSET_URL" || fail "Download failed"
ok "Downloaded successfully"

# ── Install ──
if [[ "$PLATFORM" == "macos" ]]; then
  info "Installing to /Applications..."
  hdiutil attach "${TMPDIR_DL}/${FILENAME}" -quiet -nobrowse -mountpoint /tmp/aam-dmg || fail "Failed to mount DMG"

  # Find .app in the mounted DMG
  APP_PATH=$(find /tmp/aam-dmg -maxdepth 1 -name "*.app" | head -1)
  [[ -z "$APP_PATH" ]] && fail "No .app found in DMG"

  APP_BASENAME=$(basename "$APP_PATH")

  # Remove old version if exists
  [[ -d "/Applications/${APP_BASENAME}" ]] && rm -rf "/Applications/${APP_BASENAME}"

  cp -R "$APP_PATH" /Applications/
  hdiutil detach /tmp/aam-dmg -quiet 2>/dev/null || true

  # Remove quarantine (no Apple Developer ID)
  xattr -cr "/Applications/${APP_BASENAME}" 2>/dev/null || true

  ok "Installed to /Applications/${APP_BASENAME}"
  info "Launching..."
  open "/Applications/${APP_BASENAME}" 2>/dev/null || true

elif [[ "$PLATFORM" == "linux" ]]; then
  if [[ "$FILENAME" == *.deb ]]; then
    info "Installing .deb package..."
    sudo dpkg -i "${TMPDIR_DL}/${FILENAME}" || sudo apt-get install -f -y
    ok "Installed via dpkg"
  elif [[ "$FILENAME" == *.AppImage ]]; then
    INSTALL_DIR="${HOME}/.local/bin"
    mkdir -p "$INSTALL_DIR"
    cp "${TMPDIR_DL}/${FILENAME}" "${INSTALL_DIR}/ai-account-manager"
    chmod +x "${INSTALL_DIR}/ai-account-manager"
    ok "Installed to ${INSTALL_DIR}/ai-account-manager"

    # Create desktop entry
    DESKTOP_DIR="${HOME}/.local/share/applications"
    mkdir -p "$DESKTOP_DIR"
    cat > "${DESKTOP_DIR}/ai-account-manager.desktop" << EOF
[Desktop Entry]
Type=Application
Name=AI Account Manager
Exec=${INSTALL_DIR}/ai-account-manager
Icon=ai-account-manager
Categories=Utility;
StartupWMClass=ai-account-manager
EOF
    ok "Desktop entry created"
  fi
fi

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ✔ ${APP_NAME} installed successfully!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

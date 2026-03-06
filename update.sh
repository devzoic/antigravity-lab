#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
#  AI Account Manager — Update Script
#  Same as install.sh — just re-downloads and replaces
#  Usage: curl -fsSL https://raw.githubusercontent.com/devzoic/antigravity-lab/main/update.sh | bash
# ─────────────────────────────────────────────────────────
#
# NOTE: The app has a built-in auto-updater that checks on launch.
#       This script is a manual fallback if auto-update fails.
#
# It simply runs the install script which overwrites the existing installation.

SCRIPT_URL="https://raw.githubusercontent.com/devzoic/antigravity-lab/main/install.sh"

echo ""
echo "  AI Account Manager — Manual Update"
echo "  ─────────────────────────────────"
echo ""
echo "  Downloading and running installer..."
echo ""

curl -fsSL "$SCRIPT_URL" | bash

echo ""
echo "  Update complete! The app's built-in updater will handle"
echo "  future updates automatically on launch."
echo ""

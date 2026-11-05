#!/usr/bin/env bash
# Reel Studio launcher for macOS / Linux
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Install Node.js 22+ first: https://nodejs.org"; exit 1; }
[ -d node_modules ] || npm install --omit=dev --no-audit --no-fund
export REEL_STUDIO_DEV=1  # running from source = the owner's copy: licence checks off
exec node server/index.js

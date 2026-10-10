#!/usr/bin/env bash
# Lädt three.js einmalig nach static/vendor/three/ (danach läuft alles offline).
set -euo pipefail
VER="${THREE_VERSION:-0.180.0}"
BASE="https://cdn.jsdelivr.net/npm/three@${VER}"
DEST="$(dirname "$0")/../static/vendor/three"
mkdir -p "$DEST/addons/controls"
curl -fsSL "$BASE/build/three.module.js" -o "$DEST/three.module.js"
curl -fsSL "$BASE/build/three.core.js" -o "$DEST/three.core.js"
curl -fsSL "$BASE/examples/jsm/controls/OrbitControls.js" -o "$DEST/addons/controls/OrbitControls.js"
echo "three.js $VER -> $DEST"

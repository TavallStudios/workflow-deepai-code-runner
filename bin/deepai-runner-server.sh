#!/usr/bin/env bash
# Headless DeepAI Code server (web mode, loopback only).
#
# Starts the desktop app's bundled server CLI in web mode, bound to 127.0.0.1 so it is
# only reachable over an SSH tunnel. Sign-in callbacks bind DEEPAI_AUTH_CALLBACK_PORT
# (requires the fixed-callback-port patch; see docs/sign-in-callback-port-patch.md).
#
# Configuration (environment):
#   DEEPAI_CODE_APP_DIR   extracted desktop app root   (default: /opt/deepai-code/app)
#   DEEPAI_CODE_DATA_DIR  server data directory        (default: <app-dir>/data)
#   DEEPAI_CODE_NODE      Node >= 22 binary            (default: resolved from PATH)
#   DEEPAI_CODE_PORT      loopback HTTP port           (default: 3780)
#   DEEPAI_AUTH_CALLBACK_PORT  fixed sign-in callback port (default: 3781)
set -euo pipefail

APP_DIR=${DEEPAI_CODE_APP_DIR:-/opt/deepai-code/app}
DATA_DIR=${DEEPAI_CODE_DATA_DIR:-$APP_DIR/data}
NODE=${DEEPAI_CODE_NODE:-$(command -v node || true)}
PORT=${DEEPAI_CODE_PORT:-3780}
export DEEPAI_CODE_HOME="$DATA_DIR"
export DEEPAI_AUTH_CALLBACK_PORT="${DEEPAI_AUTH_CALLBACK_PORT:-3781}"

SERVER="$APP_DIR/apps/server/dist/bin.mjs"
[[ -x "$NODE" ]] || { echo "node >= 22 not found (set DEEPAI_CODE_NODE)" >&2; exit 1; }
[[ -f "$SERVER" ]] || { echo "server bundle not found: $SERVER" >&2; exit 1; }

mkdir -p "$DATA_DIR"
cd "$DATA_DIR"
exec "$NODE" "$SERVER" serve --mode web --host 127.0.0.1 --port "$PORT" --base-dir "$DATA_DIR" "$DATA_DIR"

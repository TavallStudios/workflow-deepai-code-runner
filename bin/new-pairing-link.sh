#!/usr/bin/env bash
# Mint a fresh one-time DeepAI Code pairing link.
#
# The link printed in server.log is single-use; run this to mint a new one.
# Never paste pairing links or tokens into logs, tickets or repositories.
set -euo pipefail

APP_DIR=${DEEPAI_CODE_APP_DIR:-/opt/deepai-code/app}
DATA_DIR=${DEEPAI_CODE_DATA_DIR:-$APP_DIR/data}
NODE=${DEEPAI_CODE_NODE:-$(command -v node || true)}
export DEEPAI_CODE_HOME="$DATA_DIR"

CLI="$APP_DIR/apps/server/dist/bin.mjs"
[[ -x "$NODE" && -f "$CLI" ]] || { echo "DeepAI Code CLI not found (set DEEPAI_CODE_APP_DIR / DEEPAI_CODE_NODE)" >&2; exit 1; }

cd "$DATA_DIR"
"$NODE" "$CLI" auth pairing create --base-dir "$DATA_DIR" 2>&1 | grep -v -i -E "experimental|trace-warn"

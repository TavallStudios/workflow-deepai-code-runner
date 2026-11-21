#!/usr/bin/env bash
# Apply the sign-in fixed-callback-port patch to a DeepAI Code desktop app install.
#
# DeepAI's sign-in callback binds a random loopback port on the *server* host
# (http://127.0.0.1:<random>/auth-callback), so a remote browser can never reach it.
# This patch makes binCli-*.mjs honor DEEPAI_AUTH_CALLBACK_PORT so the callback binds a
# fixed port you can tunnel over SSH. See docs/sign-in-callback-port-patch.md and the
# internal root-cause report referenced there.
#
# usage: apply-callback-port-patch.sh [APP_DIR]   (default $DEEPAI_CODE_APP_DIR or /opt/deepai-code/app)
set -euo pipefail

APP_DIR=${1:-${DEEPAI_CODE_APP_DIR:-/opt/deepai-code/app}}
DIST=$APP_DIR/apps/server/dist
HERE=$(cd "$(dirname "$0")/.." && pwd)
PATCH=$HERE/patches/deepai-code-0.3.42-auth-callback-port.patch

command -v patch >/dev/null || { echo "patch(1) not found" >&2; exit 1; }
[[ -d $DIST ]] || { echo "dist dir not found: $DIST" >&2; exit 1; }

shopt -s nullglob
candidates=("$DIST"/binCli-*.mjs)
shopt -u nullglob
if (( ${#candidates[@]} == 0 )); then
    echo "no binCli-*.mjs found in $DIST (wrong app dir, or newer app layout)" >&2
    exit 1
fi

for f in "${candidates[@]}"; do
    if grep -q "DEEPAI_AUTH_CALLBACK_PORT" "$f"; then
        echo "already patched: $f"
        continue
    fi
    # The patch file is generated against DeepAI Code 0.3.42. Context is matched with
    # fuzz so it applies to near-by bundle revisions; verify with --dry-run first.
    if patch --dry-run --force -s "$f" < "$PATCH" >/dev/null 2>&1; then
        cp "$f" "$f.orig-unpatched"
        patch --force -s "$f" < "$PATCH"
        grep -q "DEEPAI_AUTH_CALLBACK_PORT" "$f" || { echo "patch verification failed: $f" >&2; exit 1; }
        echo "patched: $f (original saved as $f.orig-unpatched)"
    else
        echo "patch does not apply cleanly to $f" >&2
        echo "re-generate the diff against your app version (see docs/sign-in-callback-port-patch.md) and place it in patches/" >&2
        exit 1
    fi
done

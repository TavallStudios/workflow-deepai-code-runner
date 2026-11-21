#!/usr/bin/env bash
# Install the DeepAI Code headless runner on a Linux host (arm64 or x64).
#
# usage: install.sh [--app-image FILE.AppImage | --app-dir DIR] [--install-root DIR] [--apply-patch]
#
#   --app-image FILE   DeepAI Code AppImage you downloaded from deepai.org
#                      (https://deepai.org/download/deepai-code/linux-arm64 or /linux-x64).
#   --app-dir DIR      an already-extracted desktop app root (containing app/package.json
#                      and apps/server/dist/bin.mjs when extracted at top level).
#   --install-root DIR target root (default /opt/deepai-code)
#   --apply-patch      also apply the sign-in fixed-callback-port patch
#   --systemd          install the user systemd unit template and enable it
#
# The script never receives, prints or stores credentials. Sign-in happens through the
# loopback web UI over an SSH tunnel; see README.md.
set -euo pipefail

INSTALL_ROOT=/opt/deepai-code
APP_IMAGE=""
APP_DIR=""
APPLY_PATCH=0
SYSTEMD=0

while [[ $# -gt 0 ]]; do
    case $1 in
        --app-image) APP_IMAGE=$2; shift 2 ;;
        --app-dir) APP_DIR=$2; shift 2 ;;
        --install-root) INSTALL_ROOT=$2; shift 2 ;;
        --apply-patch) APPLY_PATCH=1; shift ;;
        --systemd) SYSTEMD=1; shift ;;
        *) echo "unknown option: $1" >&2; usage; exit 2 ;;
    esac
done

usage() {
    sed -n '2,12p' "$0"
}

HERE=$(cd "$(dirname "$0")" && pwd)
APP_ROOT=$INSTALL_ROOT/app
DATA_DIR=${DEEPAI_CODE_DATA_DIR:-$INSTALL_ROOT/data}

mkdir -p "$INSTALL_ROOT" "$DATA_DIR"

if [[ -n $APP_IMAGE ]]; then
    command -v unzip >/dev/null || { echo "unzip is required to extract AppImages" >&2; exit 1; }
    if [[ ! -x $APP_IMAGE && ${APP_IMAGE##*.} == AppImage ]]; then chmod +x "$APP_IMAGE"; fi
    # AppImages are squashfs images; extract with --appimage-extract or unzip.
    echo "Extracting $APP_IMAGE into $APP_ROOT ..."
    TMP=$(mktemp -d)
    (cd "$TMP" && "$APP_IMAGE" --appimage-extract >/dev/null 2>&1 || unzip -q "$APP_IMAGE")
    [[ -d $TMP/squashfs-root ]] || { echo "could not extract AppImage" >&2; exit 1; }
    mkdir -p "$APP_ROOT"
    cp -a "$TMP/squashfs-root/." "$APP_ROOT/"
    rm -rf "$TMP"
elif [[ -n $APP_DIR ]]; then
    [[ -d $APP_DIR ]] || { echo "app dir not found: $APP_DIR" >&2; exit 1; }
    mkdir -p "$APP_ROOT"
    cp -a "$APP_DIR/." "$APP_ROOT/"
fi

[[ -f $APP_ROOT/package.json ]] || { echo "app root missing package.json: $APP_ROOT (pass --app-image or --app-dir)" >&2; exit 1; }
[[ -f $APP_ROOT/apps/server/dist/bin.mjs ]] || echo "WARNING: $APP_ROOT/apps/server/dist/bin.mjs not found; check your app layout" >&2

# bin/ scripts reference DEEPAI_CODE_APP_DIR; install thin wrappers that export it.
mkdir -p "$INSTALL_ROOT/bin"
for script in deepai-runner-server.sh new-pairing-link.sh deepai-worker-launcher.sh deepai-worker-client.mjs deepai_quota.py deepai-auto-approver.mjs apply-callback-port-patch.sh; do
    cp "$HERE/bin/$script" "$INSTALL_ROOT/bin/$script"
done

cat > "$INSTALL_ROOT/env" <<EOF
# Sourced by wrappers/services. Node must be >= 22 (/usr/bin/node is often v12).
export DEEPAI_CODE_APP_DIR=$APP_ROOT
export DEEPAI_CODE_DATA_DIR=$DATA_DIR
export DEEPAI_CODE_NODE=${DEEPAI_CODE_NODE:-$(command -v node || true)}
export DEEPAI_CODE_PORT=${DEEPAI_CODE_PORT:-3780}
export DEEPAI_AUTH_CALLBACK_PORT=${DEEPAI_AUTH_CALLBACK_PORT:-3781}
EOF

mkdir -p "$INSTALL_ROOT/bin/real"
for script in deepai-runner-server.sh new-pairing-link.sh deepai-worker-launcher.sh; do
    cp "$HERE/bin/$script" "$INSTALL_ROOT/bin/real/$script"
    { echo '#!/usr/bin/env bash'; echo ". $INSTALL_ROOT/env"; echo "exec $INSTALL_ROOT/bin/real/$script \"\$@\""; } > "$INSTALL_ROOT/bin/$script"
    chmod +x "$INSTALL_ROOT/bin/real/$script" "$INSTALL_ROOT/bin/$script"
done

if (( APPLY_PATCH )); then
    "$HERE/bin/apply-callback-port-patch.sh" "$APP_ROOT"
fi

if (( SYSTEMD )); then
    mkdir -p ~/.config/systemd/user
    sed -e "s|@INSTALL_ROOT@|$INSTALL_ROOT|g" -e "s|@DATA_DIR@|$DATA_DIR|g" -e "s|@HOME@|$HOME|g" \
        "$HERE/systemd/deepai-code-server.service.template" > ~/.config/systemd/user/deepai-code-server.service
    systemctl --user daemon-reload
    systemctl --user enable --now deepai-code-server.service
    echo "Unit installed and started: journalctl --user -u deepai-code-server"
fi

echo
echo "Installed at $INSTALL_ROOT. Next steps:"
echo "  1. Start the server: $INSTALL_ROOT/bin/deepai-runner-server.sh (or the systemd unit)."
echo "  2. SSH tunnel:  ssh -L 3780:127.0.0.1:3780 -L 3781:127.0.0.1:3781 <host>"
echo "  3. Open http://127.0.0.1:3780 and complete DeepAI sign-in (or mint a link with new-pairing-link.sh)."
echo "  4. Never paste pairing links or tokens into logs, tickets or repositories."

#!/usr/bin/env bash
# DeepAI Code worker launcher.
#
#   deepai-worker-launcher.sh ID MODEL PROMPT_FILE   run a worker thread
#   deepai-worker-launcher.sh --probe MODEL          one-line provider probe
#
# Picks the first requested model that is not quota-limited (deepai_quota.py), runs the
# thread through deepai-worker-client.mjs, records the run outcome into the quota ledger,
# and writes ID-exit.txt / ID-out.json / ID-worker.log in the working directory.
#
# Configuration (environment): same as deepai-worker-client.mjs, plus
#   DEEPAI_QUOTA_LEDGER       quota ledger path
#   DEEPAI_WORKER_DONE_HOOK   optional command invoked with (ID RC) after each run
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
NODE=${DEEPAI_CODE_NODE:-node}
CLIENT=$HERE/deepai-worker-client.mjs
QUOTA=$HERE/deepai_quota.py

if [[ ${1:-} == --probe ]]; then
    model=${2:?usage: deepai-worker-launcher.sh --probe MODEL}
    set +e
    "$NODE" "$CLIENT" probe "$model" | python3 "$QUOTA" record-probe "$model"
    status=("${PIPESTATUS[@]}")
    set -e
    if (( status[0] == 0 && status[1] == 0 )); then
        exit 0
    fi
    if (( status[0] == 75 )); then
        exit 75
    fi
    exit 1
fi

id=${1:?usage: deepai-worker-launcher.sh ID MODEL PROMPT_FILE}
requested_model=${2:?usage: deepai-worker-launcher.sh ID MODEL PROMPT_FILE}
prompt=${3:?usage: deepai-worker-launcher.sh ID MODEL PROMPT_FILE}
start=$(date +%s)
out=$PWD/$id-out.json
log=$PWD/$id-worker.log
exit_file=$PWD/$id-exit.txt

if [[ ! -s $prompt ]]; then
    printf '%s missing prompt file: %s\n' "$(date -u +%FT%TZ)" "$prompt" > "$exit_file"
    exit 2
fi

model=$(python3 "$QUOTA" pick ${requested_model//,/ })
if [[ -z $model ]]; then
    printf '%s all requested DeepAI models are quota-limited\n' "$(date -u +%FT%TZ)" > "$exit_file"
    exit 75
fi

printf '%s starting DeepAI thread model=%s\n' "$(date -u +%FT%TZ)" "$model" >> "$log"
set +e
"$NODE" "$CLIENT" run "$id" "$model" "$prompt" > "$out" 2>> "$log"
rc=$?
set -e
python3 "$QUOTA" record "$model" "$out" >> "$log" 2>&1 || true
minutes=$(( ($(date +%s)-start)/60 ))
printf '%s exit=%s minutes=%s model=%s\n' "$(date -u +%FT%TZ)" "$rc" "$minutes" "$model" > "$exit_file"
if [[ -n ${DEEPAI_WORKER_DONE_HOOK:-} ]]; then
    "$DEEPAI_WORKER_DONE_HOOK" "$id" "$rc" || true
fi
exit "$rc"

#!/usr/bin/env python3
"""Record DeepAI model 429s and choose an available model for a local worker pool.

The ledger is a tiny JSON file of model-scoped cooldowns: when the server reports
quota/429, the model is marked LIMITED for the reset interval it advertises (or a
15-minute default), and `pick` returns the first requested model that is not limited.
`fresh` reports whether an AVAILABLE probe is younger than 15 minutes, for probe pacing.

Configuration (environment):
    DEEPAI_QUOTA_LEDGER  ledger path (default: ~/.local/state/deepai-runner/quota-ledger.json)

usage: deepai_quota.py pick MODEL... | fresh MODEL | record MODEL FILE | record-probe MODEL < JSON | status
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

LEDGER = Path(os.environ.get(
    "DEEPAI_QUOTA_LEDGER",
    os.path.expanduser("~/.local/state/deepai-runner/quota-ledger.json"),
))
DEFAULT_COOLDOWN_SECONDS = 15 * 60
PROBE_FRESH_SECONDS = 15 * 60
RESET = re.compile(r"resets? in (?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?", re.IGNORECASE)


def utc(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def canonical(model: str) -> str:
    return model if model.startswith("deepai/") else f"deepai/{model}"


def load() -> dict:
    try:
        value = json.loads(LEDGER.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def save(value: dict) -> None:
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    temp = LEDGER.with_suffix(".tmp")
    temp.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temp.replace(LEDGER)


def reset_seconds(payload: dict) -> int:
    value = payload.get("resetAfterSeconds")
    if isinstance(value, (int, float)) and value > 0:
        return int(value)
    try:
        text = json.dumps(payload, ensure_ascii=False)
    except (TypeError, ValueError):
        text = ""
    matches = RESET.findall(text)
    if matches:
        hours, minutes, seconds = (int(part or 0) for part in matches[-1])
        total = hours * 3600 + minutes * 60 + seconds
        if total > 0:
            return total
    return DEFAULT_COOLDOWN_SECONDS


def record_payload(model: str, payload: dict) -> None:
    model = canonical(model)
    ledger = load()
    now = time.time()
    entry = {"model": model, "checkedAt": utc(now)}
    if payload.get("quota429") is True:
        limited_until = now + reset_seconds(payload)
        entry.update(status="LIMITED", limitedUntil=utc(limited_until))
    elif payload.get("status") == "completed":
        entry["status"] = "AVAILABLE"
        entry["probeAt"] = utc(now)
    else:
        entry["status"] = "UNKNOWN"
    ledger[model] = entry
    save(ledger)
    print(f"{model} {entry['status']}")


def read_payload(stream) -> dict:
    try:
        value = json.load(stream)
        return value if isinstance(value, dict) else {}
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def limited(entry: dict, now: float) -> bool:
    if entry.get("status") != "LIMITED":
        return False
    try:
        until = datetime.strptime(entry["limitedUntil"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
        return until > now
    except (KeyError, ValueError):
        return False


def main(args: list[str]) -> int:
    if len(args) == 2 and args[0] == "record-probe":
        record_payload(args[1], read_payload(sys.stdin))
        return 0
    if len(args) == 3 and args[0] == "record":
        with Path(args[2]).open(encoding="utf-8") as source:
            record_payload(args[1], read_payload(source))
        return 0
    if len(args) >= 2 and args[0] == "pick":
        ledger = load()
        now = time.time()
        candidate = next((model for model in args[1:] if not limited(ledger.get(canonical(model), {}), now)), "")
        print(candidate)
        return 0
    if len(args) == 2 and args[0] == "fresh":
        entry = load().get(canonical(args[1]), {})
        try:
            checked_at = datetime.strptime(entry["probeAt"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
            return 0 if entry.get("status") == "AVAILABLE" and time.time() - checked_at < PROBE_FRESH_SECONDS else 1
        except (KeyError, ValueError):
            return 1
    if args == ["status"]:
        ledger = load()
        now = time.time()
        for model, entry in sorted(ledger.items()):
            status = entry.get("status", "UNKNOWN")
            if limited(entry, now):
                status += f" until {entry.get('limitedUntil')}"
            print(f"{model}: {status}")
        return 0
    print(__doc__.strip().splitlines()[-1])
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

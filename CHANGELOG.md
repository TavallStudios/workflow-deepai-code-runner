# Changelog

All notable changes to the `deepai-code-runner` workflow source repository are documented here. Versions are semantic; this repository is versioned independently of the DeepAI Code application it drives.

## 0.1.0 — 2026-11-21

### Added

- Published canonical source repository `TavallStudios/workflow-deepai-code-runner` for the DeepAI Code headless runner (owner directive 2026-11-21, CREATE UNDER TAVALL).
- `bin/deepai-runner-server.sh` — loopback web-mode server with fixed sign-in callback port.
- `bin/new-pairing-link.sh` — one-time pairing links.
- `patches/deepai-code-0.3.42-auth-callback-port.patch` + `bin/apply-callback-port-patch.sh` + `docs/sign-in-callback-port-patch.md` — three-line sign-in fixed-callback-port patch (`DEEPAI_AUTH_CALLBACK_PORT`), local and self-maintained; nothing filed upstream.
- `bin/deepai-worker-launcher.sh`, `bin/deepai-worker-client.mjs` — worker runs through supported server surfaces only (scoped `auth session issue` token in process memory, orchestration HTTP + WS), with model fallback and JSON output.
- `bin/deepai_quota.py` — model-scoped 429 cooldown ledger (`pick`/`fresh`/`record`/`status`; productization tracked in TavallStudios/tavall-ai#174).
- `bin/deepai-auto-approver.mjs` — optional, opt-in unattended approver.
- `install.sh` + `systemd/deepai-code-server.service.template`.
- `workflow.json` source descriptor (local-runner contract; no new manifest format).
- README per `tavall-docs PUBLIC_REPOSITORY_README_TEMPLATE.md`; MIT LICENSE with upstream attribution (DeepAI Code desktop app MIT; t3code/pingdotgg lineage) in NOTICE.md.
- Verification reference to the packaging PR: L0–L2 plus real end-to-end probe PASS; no full CI.

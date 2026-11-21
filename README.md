# workflow-deepai-code-runner

Run the **DeepAI Code** desktop app headless on a Linux host and use it as a local AI
worker pool — server, sign-in, pairing, worker launcher and quota ledger, packaged as a
releasable [Tavall Workflow](https://github.com/TavallStudios/tavall-workflows).

DeepAI Code is an Electron coding-agent desktop app. Its bundled server CLI runs headless
in web mode on `127.0.0.1`, which makes it a capable free-tier worker pool on a home or CI
box — but only after you solve headless sign-in, unattended worker launches, and model
429 cooldowns. This repository packages exactly those pieces, as they run in production
inside the Tavall orchestrator, generalized with environment-variable configuration.

## Why this exists

- **Headless sign-in is broken by default.** The OAuth callback binds a random loopback
  port on the *server* host, so a tunneled browser is refused. `--host` and
  `--tailscale-serve` do not fix it. We ship a three-line patch that makes the callback
  port fixed and tunnelable, plus a documented apply script. See
  [docs/sign-in-callback-port-patch.md](docs/sign-in-callback-port-patch.md).
- **Workers must start, run and finish without a human.** The launcher issues a scoped
  one-hour session through the supported `auth session issue` CLI, opens the orchestration
  WebSocket protocol, launches a thread with your prompt, streams run status until the run
  is terminal, and writes structured output. Tokens live only in process memory and are
  never logged, written or copied.
- **Free models rate-limit often.** `deepai_quota.py` keeps a model-scoped 429 cooldown
  ledger: a limited model is skipped for the reset interval the server advertises
  (15-minute default), and cheap probes are re-run at most every 15 minutes.
- **Unattended runs need an approver.** An optional auto-approver accepts pending runtime
  requests on worker-owned threads — opt-in (`DEEPAI_AUTO_APPROVER_FULL_ACCESS=1`) because
  it can grant full-access mode. Never point it at threads you did not create.

## Features

- `bin/deepai-runner-server.sh` — loopback web-mode server with fixed sign-in callback port
- `bin/new-pairing-link.sh` — mint fresh one-time pairing links
- `bin/apply-callback-port-patch.sh` + `patches/…` — the sign-in callback-port patch
- `bin/deepai-worker-launcher.sh` — run a worker or provider probe with model fallback
- `bin/deepai-worker-client.mjs` — supported-surface orchestration client (HTTP + WS)
- `bin/deepai_quota.py` — model-scoped 429 cooldown ledger (`pick` / `fresh` / `record` / `status`)
- `bin/deepai-auto-approver.mjs` — optional unattended runtime-request approver
- `install.sh` + `systemd/deepai-code-server.service.template` — install and run as a user unit

## Quick Start

### Requirements

- Linux (arm64 or x64), Node.js >= 22 (the distro node is often v12), `unzip`
- A DeepAI Code desktop app: download the AppImage from
  `https://deepai.org/download/deepai-code/linux-arm64` (or `linux-x64`), or point
  `--app-dir` at an extracted copy. Sign-in itself needs a free DeepAI account.

### Install

```sh
git clone https://github.com/TavallStudios/workflow-deepai-code-runner
cd workflow-deepai-code-runner
./install.sh --app-image ~/Downloads/DeepAI-Code-linux-arm64.AppImage --systemd --apply-patch
```

### First run and sign-in

```sh
# tunnel the server and the (patched, fixed) sign-in callback port
ssh -L 3780:127.0.0.1:3780 -L 3781:127.0.0.1:3781 <host>
open http://127.0.0.1:3780            # complete the free DeepAI sign-in there
```

The pairing link printed in `server.log` is single-use; `new-pairing-link.sh` mints more.
Never paste pairing links, tokens or `data/` contents anywhere shared.

### Run a worker

```sh
echo "Summarize the TODOs in this repo." > mytask-prompt.md
bin/deepai-worker-launcher.sh mytask deepai/glm-5.3-flash mytask-prompt.md
cat mytask-exit.txt mytask-out.json
```

Model IDs come from the live provider catalog the server reports (`server.getConfig`);
cheap unmetered DeepAI models include `deepai/glm-5.3-flash`, `deepai/deepseek-v4.1-flash`,
`deepai/minimax-m3.1-flash` and `deepai/qwen-3.8-flash`. Pass fallback models
comma-separated; the launcher picks the first not quota-limited.

## How It Works

```text
worker prompt ──▶ deepai-worker-launcher.sh ──▶ deepai-worker-client.mjs ──▶ headless server
                      │  deepai_quota.py (pick)          │  scoped session (auth session issue)
                      │  429 cooldown ledger             ├─ orchestration.launchThread (model from server.getConfig)
                      └─ record outcome ◀────────────────├─ orchestration.subscribeThread (WS, terminal run)
                                                         └─ final snapshot → JSON out
```

The client talks only to supported surfaces: the `auth session issue` CLI (scoped,
short-lived bearer kept in process memory), the orchestration HTTP API and the versioned
orchestration WebSocket protocol. It never calls an internal model proxy and never
extracts server-injected agent tokens. Runtime mode for run threads defaults to `auto`;
set `DEEPAI_WORKER_RUNTIME_MODE=full-access` only if you accept the risk.

## Configuration

Everything is environment-configured; nothing is hard-coded to a host:

| Variable | Meaning | Default |
| --- | --- | --- |
| `DEEPAI_CODE_APP_DIR` | extracted desktop app root | `/opt/deepai-code/app` |
| `DEEPAI_CODE_DATA_DIR` | server data directory | `<app>/data` |
| `DEEPAI_CODE_NODE` | Node >= 22 binary | resolved from PATH |
| `DEEPAI_CODE_BASE_URL` | server base URL | `http://127.0.0.1:3780` |
| `DEEPAI_CODE_PORT` | loopback HTTP port | `3780` |
| `DEEPAI_AUTH_CALLBACK_PORT` | fixed sign-in callback port | `3781` |
| `DEEPAI_CODE_WORKSPACE_ROOT` | workspace root for worker threads | `$PWD` |
| `DEEPAI_QUOTA_LEDGER` | quota ledger path | `~/.local/state/deepai-runner/quota-ledger.json` |
| `DEEPAI_WORKER_RUNTIME_MODE` | run-thread runtime mode | `auto` |
| `DEEPAI_WORKER_PREAMBLE_FILE` | optional preamble prepended to prompts | unset |
| `DEEPAI_WORKER_TITLE_PREFIX` | thread title prefix | `DeepAI worker` |
| `DEEPAI_WORKER_DONE_HOOK` | command called with (ID RC) after a run | unset |
| `DEEPAI_AUTO_APPROVER_FULL_ACCESS` | approver may grant full-access | unset (off) |

## Project Structure

```text
workflow-deepai-code-runner/
├── README.md
├── LICENSE / NOTICE.md            # MIT; upstream attribution (DeepAI, t3code/pingdotgg)
├── install.sh
├── bin/                           # server, pairing, patch, launcher, client, quota, approver
├── patches/deepai-code-0.3.42-auth-callback-port.patch
├── systemd/deepai-code-server.service.template
└── docs/sign-in-callback-port-patch.md
```

## Documentation

- [Sign-in fixed-callback-port patch](docs/sign-in-callback-port-patch.md) — root cause, patch, apply/re-apply after app updates
- [Tavall Workflows](https://github.com/TavallStudios/tavall-workflows) — the marketplace this ships as a Workflow in
- [TavallStudios/tavall-ai#174](https://github.com/TavallStudios/tavall-ai/issues/174) — provider routing/quota productization inside Tavall AI (this repo packages the *local runner* only, no scheduler or task store)

## Security notes

- Sign-in uses a free DeepAI account; there is no API key. Never copy tokens, pairing
  links, `data/` contents or credentials into repositories, logs or tickets.
- The auto-approver is opt-in and title-scoped; full-access mode is a further explicit
  opt-in (`DEEPAI_AUTO_APPROVER_FULL_ACCESS=1`).
- The server binds `127.0.0.1` only; expose it over SSH tunnels, never a public listener.

## Contributing

Bug reports and improvements welcome via GitHub issues/PRs. The patch file is
self-maintained; changes to it should keep the minimal three-line semantic and update the
apply script's verification.

## License

[MIT](LICENSE) for this repository's tooling. The DeepAI Code application is upstream MIT
software by DeepAI, derived from pingdotgg's t3code — see [NOTICE.md](NOTICE.md).

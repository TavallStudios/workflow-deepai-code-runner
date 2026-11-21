# Upstream attribution

This repository is glue tooling. The headless capability it drives belongs to the
**DeepAI Code** desktop application and its bundled server.

## DeepAI Code desktop app

- Product: DeepAI Code (`deepai-code-desktop`), version referenced by this tooling: **0.3.42**
- Publisher: DeepAI — https://deepai.org (downloads: https://deepai.org/download/deepai-code/…)
- License: **MIT** (declared in the app's own `package.json`)
- The bundled agent runtime is `@earendil-works/pi-coding-agent` 1.3.0 (npm, MIT), which the
  app runs through its authenticated server-owned runtime.

## t3code lineage

The app's `package.json` carries a `t3codeCommitHash` field, marking the DeepAI Code
desktop app as a derivative of the **t3code** coding-agent project by pingdotgg
(https://github.com/pingdotgg/t3code, MIT). This repository is not maintained by, and is
not affiliated with, pingdotgg or DeepAI; bugs in the app itself belong to those projects.

## This repository

- The shell/Node/Python scripts here (`bin/`, `install.sh`, `systemd/`) are original Tavall
  work, MIT-licensed — see [LICENSE](LICENSE).
- `patches/deepai-code-0.3.42-auth-callback-port.patch` is a local, self-maintained patch
  to the app bundle; see [docs/sign-in-callback-port-patch.md](docs/sign-in-callback-port-patch.md).
- DeepAI, DeepAI Code, t3code and pingdotgg are the marks of their respective owners.

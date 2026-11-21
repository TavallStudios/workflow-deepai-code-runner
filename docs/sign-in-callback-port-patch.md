# Sign-in fixed-callback-port patch (`DEEPAI_AUTH_CALLBACK_PORT`)

## Problem

DeepAI Code's sign-in flow binds its OAuth callback to a **random loopback port on the
host running the server** and opens `http://127.0.0.1:<random>/auth-callback`. On a
headless host, the person signing in opens the web UI through an SSH tunnel from their
laptop, so the browser resolves `127.0.0.1` on the laptop and the connection is refused:
the callback port only exists on the remote host.

`--host`, `--tailscale-serve`, and `pair --tailscale` expose the web UI but do **not**
fix sign-in: the callback host stays `127.0.0.1` on the server host. The supported
sequence is therefore: complete sign-in locally on the host (or through a fixed-port SSH
tunnel), then pair remote clients.

## The patch

Three lines in `app/apps/server/dist/binCli-*.mjs` make the callback port overridable:

- `function listen(server, port = 0)` — accept an optional port,
- `server.listen(port, "127.0.0.1", ...)` — bind the given port instead of a random one,
- `const port = await listen(server, Number(process.env.DEEPAI_AUTH_CALLBACK_PORT || 0))` —
  read the port from the environment (falling back to the original random behavior).

With the patch, run the server with `DEEPAI_AUTH_CALLBACK_PORT=3781` and tunnel it:

```sh
ssh -L 3780:127.0.0.1:3780 -L 3781:127.0.0.1:3781 <host>
```

Then open `http://127.0.0.1:3780` and complete sign-in in the tunneled browser.

## Files

- [`deepai-code-0.3.42-auth-callback-port.patch`](deepai-code-0.3.42-auth-callback-port.patch) —
  unified diff against DeepAI Code desktop **0.3.42 (arm64, sha256
  `6e7ec1c307fb5d9ab849abb5b247850f0c8490025294ea853171c0c764778dcf`)**. The bundle file
  name (`binCli-zM20e9Xy.mjs`) is content-hashed and changes per app revision.
- [`../bin/apply-callback-port-patch.sh`](../bin/apply-callback-port-patch.sh) — locates
  `binCli-*.mjs`, dry-runs the patch, saves the original as `*.orig-unpatched`, and
  verifies the result. Re-apply after every app update.

If the bundle drifted too far for the diff to apply with fuzz, regenerate it:

```sh
diff -u --label "a/<your original binCli>.mjs" --label "b/<patched binCli>.mjs" \
    <orig> <patched> > patches/deepai-code-<version>-auth-callback-port.patch
```

Keep the same three-line semantic change; do not widen it.

## Provenance and status

- Discovered 2026-11-21 on a headless Linux (arm64) install; original bundle kept as
  `binCli-*.mjs.orig-20261121` on the reporting host.
- Root-cause analysis, repro and tunnel/networking layering are recorded in an internal
  Tavall report (`DEEPAI-SIGNIN-REPRO.md`, orchestrator workspace 2026-11-21); nothing has
  been filed upstream yet. The change is local, self-maintained and not sent to DeepAI.
- If you reuse this patch, verify it against your own app version and keep the backup the
  apply script creates.

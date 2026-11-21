#!/usr/bin/env node
// Optional full-access auto-approver for unattended DeepAI Code worker threads.
//
// Owner authorization is required before running this: it accepts every pending runtime
// request and dismisses user-input prompts on threads whose title starts with
// DEEPAI_WORKER_TITLE_PREFIX, and can switch those threads to full-access mode
// (DEEPAI_AUTO_APPROVER_FULL_ACCESS=1). Never run this on threads you did not create.
//
// usage: deepai-auto-approver.mjs [--once]
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const APP = process.env.DEEPAI_CODE_APP_DIR ?? "/opt/deepai-code/app";
const BASE = process.env.DEEPAI_CODE_BASE_URL ?? "http://127.0.0.1:3780";
const NODE = process.env.DEEPAI_CODE_NODE ?? process.execPath;
const FULL_ACCESS = process.env.DEEPAI_AUTO_APPROVER_FULL_ACCESS === "1";
const TITLE_PREFIX = process.env.DEEPAI_WORKER_TITLE_PREFIX ?? "DeepAI worker";
const WebSocket = createRequire(`${APP}/app/package.json`)("ws");
const ONCE = process.argv.includes("--once");
const log = (m) => process.stdout.write(`${new Date().toISOString()} ${m}\n`);
function token() {
  const r = spawnSync(NODE, [`${APP}/apps/server/dist/bin.mjs`, "auth", "session", "issue", "--base-dir",
    process.env.DEEPAI_CODE_DATA_DIR ?? `${APP}/data`,
    "--scope", "orchestration:read", "--scope", "orchestration:operate", "--ttl", "1h", "--label", "deepai-auto-approver", "--token-only"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (r.status !== 0) throw new Error("session-issue-failed");
  return r.stdout.trim();
}
function dispatch(tok, command) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE.replace("http", "ws")}/ws?orchestrationProtocol=2`, { headers: { Authorization: `Bearer ${tok}` } });
    const t = setTimeout(() => { ws.terminate(); reject(new Error("timeout")); }, 20000);
    ws.on("open", () => ws.send(JSON.stringify({ _tag: "Request", id: 1, tag: "orchestration.dispatchCommand", payload: command, headers: [] })));
    ws.on("message", (d) => { let m; try { m = JSON.parse(d.toString()); } catch { return; }
      if (m._tag === "Exit") { clearTimeout(t); ws.close(); m.exit?._tag === "Success" ? resolve(m.exit.value) : reject(new Error((JSON.stringify(m.exit).match(/"message":"([^"]*)"/)||[,JSON.stringify(m.exit).slice(0,300)])[1].replace(/provider-session:[^ ]*/,"<session>"))); }
      else if (m._tag === "Defect") { clearTimeout(t); ws.close(); reject(new Error("defect")); } });
    ws.on("error", (e) => { clearTimeout(t); reject(e); });
  });
}
async function tick(tok) {
  const res = await fetch(`${BASE}/api/orchestration/shell`, { headers: { Authorization: `Bearer ${tok}`, "x-t3-orchestration-protocol": "2" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`shell-http-${res.status}`);
  const shell = await res.json();
  for (const th of shell.threads ?? []) {
    if (!String(th.title || "").startsWith(TITLE_PREFIX)) continue;
    if (FULL_ACCESS && th.runtimeMode !== "full-access") {
      try { await dispatch(tok, { type: "thread.runtime-mode.set", commandId: randomUUID(), threadId: th.id, runtimeMode: "full-access" }); log(`full-access ${th.title}`); }
      catch (e) { log(`runtime-mode-failed ${th.title} ${e.message}`); }
    }
    const req = th.pendingRuntimeRequest;
    if (!req) continue;
    const cmd = req.kind === "user_input"
      ? { type: "thread.user-input.dismiss", commandId: randomUUID(), threadId: th.id, requestId: req.id }
      : { type: "runtime-request.respond", commandId: randomUUID(), threadId: th.id, requestId: req.id, decision: "acceptForSession" };
    try { await dispatch(tok, cmd); log(`${cmd.type} kind=${req.kind} ${th.title}`); }
    catch (e) { log(`respond-failed kind=${req.kind} ${th.title} ${e.message}`); }
  }
}
let tok = token(), issued = Date.now();
do {
  try { if (Date.now() - issued > 45 * 60 * 1000) { tok = token(); issued = Date.now(); } await tick(tok); }
  catch (e) { log(`tick-failed ${e.message}`); }
  if (!ONCE) await new Promise((r) => setTimeout(r, 10000));
} while (!ONCE);

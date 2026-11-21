#!/usr/bin/env node
// DeepAI Code headless worker client.
//
// Talks only to the supported headless-server surfaces: a scoped `auth session issue`
// CLI token (lives in process memory, never logged or written), the orchestration HTTP
// API, and the orchestration WebSocket protocol. Never calls an internal model proxy and
// never extracts server-injected agent tokens.
//
// usage: deepai-worker-client.mjs run ID MODEL PROMPT_FILE | probe MODEL
//
// Configuration (environment):
//   DEEPAI_CODE_APP_DIR       extracted desktop app root (default /opt/deepai-code/app)
//   DEEPAI_CODE_DATA_DIR      server data directory      (default <app>/data)
//   DEEPAI_CODE_BASE_URL      server base URL            (default http://127.0.0.1:3780)
//   DEEPAI_CODE_WORKSPACE_ROOT workspace root to run in  (default $PWD)
//   DEEPAI_CODE_NODE          node >= 22 binary          (default: resolved from PATH)
//   DEEPAI_WORKER_RUNTIME_MODE runtime mode for run threads (default "auto";
//                             set "full-access" only if you understand the risk)
//   DEEPAI_WORKER_PREAMBLE_FILE optional preamble text prepended to run prompts
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";

const APP = process.env.DEEPAI_CODE_APP_DIR ?? "/opt/deepai-code/app";
const DATA = process.env.DEEPAI_CODE_DATA_DIR ?? `${APP}/data`;
const NODE = process.env.DEEPAI_CODE_NODE ?? process.execPath;
const BASE_URL = process.env.DEEPAI_CODE_BASE_URL ?? "http://127.0.0.1:3780";
const WORKSPACE_ROOT = process.env.DEEPAI_CODE_WORKSPACE_ROOT ?? process.cwd();
const RUNTIME_MODE = process.env.DEEPAI_WORKER_RUNTIME_MODE ?? "auto";
const CLI = `${APP}/apps/server/dist/bin.mjs`;
const WS_PROTOCOL_VERSION = 2;
const require = createRequire(`${APP}/app/package.json`);
const WebSocket = require("ws");
const terminalRunStatuses = new Set(["completed", "interrupted", "failed", "cancelled", "rolled_back"]);

function issueSession(label) {
  const issued = spawnSync(NODE, [
    CLI, "auth", "session", "issue", "--base-dir", DATA,
    "--scope", "orchestration:read", "--scope", "orchestration:operate",
    "--ttl", "1h", "--label", label, "--token-only"
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (issued.status !== 0 || !issued.stdout.trim()) throw new Error("scoped-session-unavailable");
  // The short-lived token exists only in process memory and is never logged or written.
  return issued.stdout.trim();
}
function openRpc(token) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${BASE_URL.replace("http", "ws")}/ws?orchestrationProtocol=${WS_PROTOCOL_VERSION}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("websocket-connect-timeout"));
    }, 15000);
    socket.once("open", () => {
      clearTimeout(timer);
      resolve(new RpcConnection(socket));
    });
    socket.once("unexpected-response", (_request, response) => {
      clearTimeout(timer);
      const status = response.statusCode;
      response.resume();
      reject(new Error(`websocket-http-${status}`));
    });
    socket.once("error", () => {
      clearTimeout(timer);
      reject(new Error("websocket-connect-failed"));
    });
  });
}

class RpcConnection {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.socket.on("message", (data) => this.onMessage(data));
    this.socket.on("close", () => {
      for (const pending of this.pending.values()) pending.reject(new Error("websocket-closed"));
      this.pending.clear();
    });
    this.socket.on("error", () => {
      for (const pending of this.pending.values()) pending.reject(new Error("websocket-failed"));
      this.pending.clear();
    });
  }

  onMessage(data) {
    let message;
    try { message = JSON.parse(data.toString()); } catch { return; }
    const rawId = message.requestId ?? message.id;
    const id = typeof rawId === "string" && /^\d+$/.test(rawId) ? Number(rawId) : rawId;
    const pending = this.pending.get(id);
    if (!pending) return;
    if (message._tag === "Chunk") {
      pending.onChunk?.(message.values);
      this.socket.send(JSON.stringify({ _tag: "Ack", requestId: message.requestId }));
      return;
    }
    if (message._tag === "Exit") {
      this.pending.delete(message.requestId);
      const exit = message.exit;
      if (exit?._tag === "Success") pending.resolve(exit.value);
      else pending.reject(new RpcFailure(exit));
      return;
    }
    if (message._tag === "Defect") {
      this.pending.delete(id);
      (pending ?? (this.pending.size === 1 ? this.pending.values().next().value : null))?.reject(new Error("rpc-defect"));
    }
  }

  request(tag, payload, onChunk) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = onChunk ? null : setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("rpc-timeout"));
      }, 30000);
      this.pending.set(id, {
        resolve: (value) => { if (timer) clearTimeout(timer); resolve(value); },
        reject: (error) => { if (timer) clearTimeout(timer); reject(error); },
        onChunk
      });
      this.socket.send(JSON.stringify({ _tag: "Request", id, tag, payload, headers: [] }));
      if (onChunk) onChunk.requestId = id;
    });
  }

  stream(tag, payload, onChunk, timeoutMs) {
    const id = this.nextId++;
    let timer;
    const promise = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("worker-timeout"));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
        onChunk
      });
      this.socket.send(JSON.stringify({ _tag: "Request", id, tag, payload, headers: [] }));
    });
    return { id, promise };
  }

  close() {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
    else this.socket.terminate();
  }
}

class RpcFailure extends Error {
  constructor(exit) {
    super("rpc-failed");
    this.exit = exit;
  }
}

function quotaInfo(value) {
  let text;
  try { text = JSON.stringify(value); } catch { text = String(value); }
  const quota429 = /\b429\b|RESOURCE_EXHAUSTED|rate.?limit|quota.?reached/i.test(text);
  const match = text.match(/resets? in (?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i);
  const resetAfterSeconds = match
    ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0)
    : null;
  return { quota429, resetAfterSeconds };
}

async function getProjectId(token) {
  const response = await fetch(`${BASE_URL}/api/orchestration/shell`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "x-t3-orchestration-protocol": String(WS_PROTOCOL_VERSION)
    },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`project-list-http-${response.status}`);
  const snapshot = await response.json();
  const root = realpathSync(WORKSPACE_ROOT);
  let project = snapshot.projects?.find((item) => {
    try { return realpathSync(item.workspaceRoot) === root; } catch { return false; }
  });
  if (!project) {
    const added = spawnSync(NODE, [
      CLI, "project", "add", WORKSPACE_ROOT, "--title", "Workflow Workspaces", "--base-dir", DATA
    ], { encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] });
    if (added.status !== 0) throw new Error("project-create-failed");
    return getProjectId(token);
  }
  return project.id;
}

function selectDeepAiModel(config, requestedModel) {
  const providers = Array.isArray(config.providers) ? config.providers : (config.providers?.providers ?? []);
  const provider = providers.find((candidate) => candidate.instanceId === "deepai");
  if (!provider) throw new Error("deepai-provider-unavailable");
  const requested = requestedModel.startsWith("deepai/") ? requestedModel : `deepai/${requestedModel}`;
  const model = provider.models?.find((candidate) => candidate.slug === requested);
  if (!model) throw new Error("deepai-model-unavailable");
  return { instanceId: provider.instanceId, model: model.slug };
}

function terminalRun(projection) {
  const run = projection?.runs?.slice().sort((a, b) => b.ordinal - a.ordinal)[0];
  return run && terminalRunStatuses.has(run.status) ? run : null;
}

function streamRunStatus(value, state) {
  const items = Array.isArray(value) ? value : [value];
  for (const item of items) {
    if (item?.kind === "snapshot") {
      const run = terminalRun(item.projection);
      if (run) state.run = run;
      else {
        state.run = item.projection?.runs?.slice().sort((a, b) => b.ordinal - a.ordinal)[0] ?? state.run;
      }
    } else if (item?.kind === "event" && item.event?.type === "run.updated") {
      state.run = item.event.payload;
    }
    if (state.run) {
      process.stderr.write(`thread-run status=${state.run.status}\n`);
      if (terminalRunStatuses.has(state.run.status)) state.resolve(state.run);
    }
  }
}

async function finalSnapshot(token, threadId) {
  const response = await fetch(`${BASE_URL}/api/orchestration/threads/${encodeURIComponent(threadId)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "x-t3-orchestration-protocol": String(WS_PROTOCOL_VERSION)
    },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`thread-snapshot-http-${response.status}`);
  return response.json();
}

async function pollTerminalRun(token, threadId, runId) {
  const deadline = Date.now() + 30 * 60 * 1000;
  let previousStatus = "";
  while (Date.now() < deadline) {
    const snapshot = await finalSnapshot(token, threadId);
    const runs = snapshot.projection?.runs ?? [];
    const run = (runId ? runs.find((candidate) => candidate.id === runId) : null)
      ?? runs.slice().sort((left, right) => right.ordinal - left.ordinal)[0];
    if (run && run.status !== previousStatus) {
      previousStatus = run.status;
      process.stderr.write(`thread-run status=${run.status} source=http-snapshot\n`);
    }
    if (run && terminalRunStatuses.has(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error("worker-timeout");
}

function assistantResult(projection, runId) {
  const messages = (projection.messages ?? []).filter((message) =>
    message.role === "assistant" && message.runId === runId && message.text?.trim()
  );
  return messages.at(-1)?.text ?? "";
}

async function runWorker(mode, id, model, promptPath) {
  const label = `tavall-${mode}-${String(id).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40)}`;
  let token;
  let connection;
  let result;
  let failure = null;
  let quota = { quota429: false, resetAfterSeconds: null };
  try {
    token = issueSession(label);
    connection = await openRpc(token);
    const [projectId, config] = await Promise.all([
      getProjectId(token),
      connection.request("server.getConfig", {})
    ]);
    const modelSelection = selectDeepAiModel(config, model);
    const preamble = process.env.DEEPAI_WORKER_PREAMBLE_FILE
      ? readFileSync(process.env.DEEPAI_WORKER_PREAMBLE_FILE, "utf8")
      : "";
    const prompt = mode === "probe"
      ? "Reply with exactly DEEPAI_OK. Do not use tools or read files."
      : preamble + readFileSync(promptPath, "utf8");
    if (mode === "run" && !prompt.trim()) throw new Error("empty-worker-prompt");
    const titlePrefix = process.env.DEEPAI_WORKER_TITLE_PREFIX ?? "DeepAI worker";
    const title = mode === "probe" ? `${titlePrefix} provider probe` : `${titlePrefix} ${id}`;
    const launch = await connection.request("orchestration.launchThread", {
      commandId: randomUUID(),
      creationSource: "web",
      projectId,
      title,
      modelSelection,
      runtimeMode: mode === "run" ? RUNTIME_MODE : "auto",
      interactionMode: "default",
      workspaceStrategy: { type: "root" },
      initialMessage: { text: prompt, attachments: [] }
    });
    const threadId = launch.threadId;
    const initialRun = launch.projection?.runs?.slice().sort((a, b) => b.ordinal - a.ordinal)[0];
    process.stderr.write(`thread-started id=${threadId} model=${modelSelection.model}\n`);
    const state = { run: initialRun, resolve: null };
    const terminal = new Promise((resolve) => { state.resolve = resolve; });
    const stream = connection.stream("orchestration.subscribeThread", {
      threadId,
      requestCompletionMarker: true,
      acceptBoundedSnapshot: true,
      acceptCompactTurnItems: true
    }, (value) => streamRunStatus(value, state), 30 * 60 * 1000);
    void stream.promise.catch(() => {});
    const completedRun = terminalRun({ runs: [initialRun] })
      ? initialRun
      : await Promise.race([terminal, pollTerminalRun(token, threadId, initialRun?.id)]);
    if (!completedRun) throw new Error("thread-ended-without-terminal-run");
    result = {
      status: completedRun.status,
      model: modelSelection.model,
      projectId,
      threadId,
      runId: completedRun.id,
      finalMessage: ""
    };
    if (completedRun.status === "completed") {
      const snapshot = await finalSnapshot(token, threadId);
      result.finalMessage = assistantResult(snapshot.projection, completedRun.id);
      if (!result.finalMessage) result.status = "completed_without_final_message";
      if (mode === "probe" && !result.finalMessage.includes("DEEPAI_OK")) result.status = "probe_mismatch";
    } else {
      const snapshot = await finalSnapshot(token, threadId).catch(() => null);
      quota = quotaInfo({ run: completedRun, projection: snapshot?.projection });
      result.status = completedRun.status;
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : "worker-failed";
    const nested = error instanceof RpcFailure ? error.exit : error;
    quota = quotaInfo(nested);
    result = {
      status: "failed",
      model,
      quota429: quota.quota429,
      resetAfterSeconds: quota.resetAfterSeconds,
      error: failure
    };
  } finally {
    connection?.close();
    token = undefined;
  }
  const completed = result?.status === "completed";
  const output = {
    ...result,
    quota429: quota.quota429,
    resetAfterSeconds: quota.resetAfterSeconds
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  return quota.quota429 ? 75 : completed ? 0 : 1;
}

const args = process.argv.slice(2);
const mode = args[0];
const id = mode === "run" ? args[1] : "probe";
const model = mode === "run" ? args[2] : args[1];
const promptPath = mode === "run" ? args[3] : undefined;
if (!new Set(["run", "probe"]).has(mode) || !model || (mode === "run" && !promptPath)) {
  process.stderr.write("usage: deepai-worker-client.mjs run ID MODEL PROMPT | probe MODEL\n");
  process.exit(2);
}
process.exitCode = await runWorker(mode, id ?? "probe", model, promptPath);

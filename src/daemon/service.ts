import { createServer, createConnection } from "node:net";
import { createHash, randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, chmod } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Server as HttpServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { resolveMemsphereHome } from "../home.js";
import { atomicWriteJson } from "../persistence.js";
import { withNativeFileLock } from "../file-lock.js";
import { spawnCommand } from "../platform-process.js";
import { readConfigAt, readViewConfig } from "../config.js";
import { currentCliRuntimeDescriptor } from "../acp/cli-runtime.js";
import { listTasks, updateTask, taskDiagnostics, type TaskRow } from "./tasks.js";
import { inspectReview, reviewResumeNotification, reviewReady } from "./review.js";
import { readRunnerAgents } from "../runner/identity.js";
import { dispatchArtifactReviewAgents } from "../acp/dispatcher.js";

const stateSchema = z.object({ protocol: z.literal(1), pid: z.number().int().positive(), instanceId: z.string(), token: z.string(), endpoint: z.string() }).strict();
type State = z.infer<typeof stateSchema>;
const intentSchema = z.object({ version: z.literal(1), view: z.object({ desiredState: z.enum(["running", "stopped"]), configPath: z.string().optional() }).strict() }).strict();
const root = (home: string) => join(home, ".runtime");
const statePath = (home: string) => join(root(home), "daemon.json");
const intentPath = (home: string) => join(root(home), "daemon-services.json");
const endpoint = (home: string) => process.platform === "win32" ? `\\\\.\\pipe\\memsphere-${createHash("sha256").update(home).digest("hex").slice(0, 24)}` : join(root(home), "daemon.sock");
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };
async function readState(home: string) { try { return stateSchema.parse(JSON.parse(await readFile(statePath(home), "utf8"))); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw e; } }
export async function readServiceIntent(home = resolveMemsphereHome()) {
  try { return intentSchema.parse(JSON.parse(await readFile(intentPath(home), "utf8"))); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return intentSchema.parse({ version: 1, view: { desiredState: "stopped" } }); throw e; }
}
export async function writeViewIntent(desiredState: "running" | "stopped", configPath?: string, home = resolveMemsphereHome()) {
  await mkdir(root(home), { recursive: true });
  return withNativeFileLock(join(root(home), "daemon-services.lock"), async () => {
    const previous = await readServiceIntent(home);
    const value = intentSchema.parse({ version: 1, view: { ...previous.view, desiredState, ...(configPath ? { configPath } : {}) } });
    await atomicWriteJson(intentPath(home), value);
  });
}
function request(state: State, command: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(state.endpoint);
    const timer = setTimeout(() => socket.destroy(new Error("Daemon control timeout")), 15000);
    let data = "";
    socket.once("connect", () => socket.write(JSON.stringify({ protocol: 1, instanceId: state.instanceId, token: state.token, command }) + "\n"));
    socket.on("data", chunk => {
      data += chunk.toString();
      if (data.length > 128 * 1024) socket.destroy(new Error("Daemon response too large"));
      const end = data.indexOf("\n");
      if (end >= 0) {
        try { const result = JSON.parse(data.slice(0, end)); if (result.error) reject(new Error(result.error)); else resolve(result); }
        catch (e) { reject(e); }
        socket.end();
      }
    });
    socket.once("error", reject);
    socket.once("close", () => { clearTimeout(timer); if (!data.includes("\n")) reject(new Error("Daemon closed control connection")); });
  });
}
export async function daemonStatus(home = resolveMemsphereHome()) {
  const state = await readState(home);
  if (!state || !alive(state.pid)) return { running: false, view: (await readServiceIntent(home)).view };
  return request(state, "status");
}
export async function ensureDaemon(home = resolveMemsphereHome()) {
  await mkdir(root(home), { recursive: true });
  return withNativeFileLock(join(root(home), "daemon-start.lock"), async () => {
    const state = await readState(home);
    if (state && alive(state.pid)) { await request(state, "status"); return state; }
    const runtime = currentCliRuntimeDescriptor();
    const env: NodeJS.ProcessEnv = { ...process.env, MEMSPHERE_HOME: home };
    delete env.CODEX_THREAD_ID; delete env.TRAECLI_THREAD_ID;
    const child = spawnCommand(runtime.nodeExecutable, [...process.execArgv, runtime.cliEntrypoint, "daemon", "serve"], { cwd: process.cwd(), env, detached: true, stdio: "ignore" });
    let failed: Error | undefined;
    child.once("error", e => { failed = e; });
    child.unref();
    for (let i = 0; i < 150; i++) {
      if (failed) throw failed;
      const next = await readState(home);
      if (next && next.pid === child.pid) { try { await request(next, "status"); return next; } catch { /* wait for ready */ } }
      await delay(50);
    }
    throw new Error("Daemon startup timeout; no task registration acknowledged");
  });
}
export async function daemonControl(command: string, home = resolveMemsphereHome()) {
  const state = await readState(home);
  if (!state || !alive(state.pid)) {
    if (command === "stop" || command === "view-stop") return { running: false };
    return request(await ensureDaemon(home), command);
  }
  return request(state, command);
}
export async function stopDaemon(home = resolveMemsphereHome()) {
  const state = await readState(home);
  if (!state || !alive(state.pid)) return;
  await request(state, "stop");
  for (let i = 0; i < 1200; i++) { if (!alive(state.pid) || !(await readState(home))) return; await delay(50); }
  throw new Error("Daemon did not stop; process was not forcefully terminated");
}

export async function runDaemon(home = resolveMemsphereHome()) {
  await mkdir(root(home), { recursive: true });
  await withNativeFileLock(join(root(home), "daemon-instance.lock"), async () => {
    const state: State = { protocol: 1, pid: process.pid, instanceId: randomUUID(), token: randomBytes(32).toString("hex"), endpoint: endpoint(home) };
    let view: HttpServer | undefined, viewError: string | undefined;
    let opening: Promise<void> | undefined;
    let stopping = false, busy = false, scanOffset = 0;
    let viewInfo: { host: string; port: number; settingsToken?: string } | undefined;
    const closeView = async () => { await opening; const server = view; view = undefined; viewInfo = undefined; if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
    const doOpenView = async () => {
      if (view) return;
      const intent = await readServiceIntent(home);
      if (intent.view.desiredState !== "running" || !intent.view.configPath) return;
      try {
        const config = await readViewConfig(intent.view.configPath);
        const { getViewServiceStatus, stopViewService } = await import("../view/service.js");
        const previous = await getViewServiceStatus(config);
        if (previous.running && previous.state) {
          let verified = false;
          if (process.platform === "linux") {
            const args = (await readFile(`/proc/${previous.state.pid}/cmdline`, "utf8")).split("\0");
            const flag = args.indexOf("--config");
            verified = args.some((arg, i) => arg === "view" && args[i + 1] === "serve") && flag >= 0 && args[flag + 1] === config.configPath && previous.state.configPath === config.configPath;
          }
          if (!verified) throw new Error("Cannot verify the legacy View process; stop it with its original CLI before takeover");
          await stopViewService(config);
        }
        const { createViewServer } = await import("../commands/view.js");
        const settingsToken = config.view.operatorToken ?? randomBytes(24).toString("hex");
        const server = createViewServer(config, { settingsToken });
        await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(config.view.port, config.view.host, () => { server.removeListener("error", reject); resolve(); }); });
        view = server; viewError = undefined;
        const address = server.address();
        viewInfo = { settingsToken, host: config.view.host, port: typeof address === "object" && address ? address.port : config.view.port };
        server.on("error", () => { viewError = "View service error"; void closeView(); });
      } catch (e) { viewError = (e as Error).message; }
    };
    const openView = () => opening ??= doOpenView().finally(() => { opening = undefined; });
    for (const row of await listTasks(home)) if (row.value.status === "running") await updateTask(row, { status: "failed", error: { stage: "recovery", code: "execution_interrupted", message: "Daemon exited during task execution; notification may have been sent. Explicit retry required." } }, home);
    const active = new Map<string, { row: TaskRow; sending: boolean }>();
    const executionErrors = new Map<string, { id: string; error: string }>();
    const processTask = async (initial: TaskRow) => {
      let row = initial;
      let stage: "wait" | "render" | "send" = "wait";
      const save = async (changes: Parameters<typeof updateTask>[1]) => { const updated = await updateTask(row, changes, home); row = { ...updated, value: { ...row.value, ...changes } }; return row; };
      try {
        const claimed = row.value.status === "queued";
        if (claimed) {
          await save({ status: "running", daemonInstanceId: state.instanceId });
        }
        active.set(row.id, { row, sending: false });
        const runner = (await readRunnerAgents(home))[row.value.recipient.agentType];
        if (!runner?.identity_enabled || !runner.async_enabled) { await save({ status: "cancelled", error: { stage: "cancel", code: "runner_disabled", message: "Runner identity/asynchronous execution disabled" } }); return; }
        const config = await readConfigAt(row.value.input.configPath);
        if (config.project?.name !== row.value.input.project) throw new Error("Task Project changed");
        const context = await inspectReview(config, row.value.input.reviewId);
        if (context.run.id !== row.value.input.runId || context.review.currentRoundId !== row.value.input.roundId) { await save({ status: "cancelled", error: { stage: "cancel", code: "round_changed", message: "Review round changed" } }); return; }
        if (claimed) await dispatchArtifactReviewAgents({ config, run: context.run });
        if (!reviewReady(context)) return;
        stage = "render";
        const body = reviewResumeNotification(row.value.input.project, row.value.input.reviewId);
        const latest = await inspectReview(config, row.value.input.reviewId);
        if (latest.round.id !== row.value.input.roundId) { await save({ status: "cancelled", error: { stage: "cancel", code: "round_changed", message: "Review round changed before sending" } }); return; }
        if (!reviewReady(latest)) return;
        const enabled = (await readRunnerAgents(home))[row.value.recipient.agentType];
        if (!enabled?.identity_enabled || !enabled.async_enabled) { await save({ status: "cancelled", error: { stage: "cancel", code: "runner_disabled", message: "Runner disabled before sending" } }); return; }
        stage = "send";
        active.get(row.id)!.sending = true;
        await sendQueue(row.value.recipient.agentCommand, row.value.recipient.sessionId, body, row.value.input.cwd);
        await save({ status: "completed", error: undefined });
      } catch (error) {
        try {
          await save({ status: "failed", error: { stage, code: "task_failed", message: active.get(row.id)?.sending ? "Queue failed; use explicit retry (outcome may be unknown)" : (error as Error).message.slice(0, 500) } });
        } catch {
          // A notification may already have been sent. Never schedule this row again
          // in this instance when even its failure cannot be persisted.
          executionErrors.set(row.id, { id: row.id, error: "TASK_STATE_WRITE_FAILED: scheduling suspended; notification outcome may be unknown. Repair storage and restart daemon before explicit retry." });
        }
      } finally { active.delete(row.id); }
    };
    const tick = async () => {
      if (busy || stopping) return;
      busy = true;
      try { const rows = (await listTasks(home)).filter(r => !executionErrors.has(r.id) && (r.value.status === "queued" || r.value.status === "running" && r.value.daemonInstanceId === state.instanceId)); const batch = [...rows.slice(scanOffset), ...rows.slice(0, scanOffset)].slice(0, 8); scanOffset = rows.length ? (scanOffset + batch.length) % rows.length : 0; await Promise.all(batch.map(processTask)); }
      catch { /* Keep control service available; status queries validate task records. */ }
      finally { busy = false; }
    };
    const server = createServer(socket => {
      let buffer = ""; socket.setTimeout(15000, () => socket.destroy());
      socket.on("error", () => undefined);
      socket.on("data", async chunk => {
        buffer += chunk.toString();
        if (buffer.length > 65536) { socket.destroy(); return; }
        if (!buffer.includes("\n")) return;
        const input = buffer.slice(0, buffer.indexOf("\n")); buffer = "";
        try {
          const request = JSON.parse(input);
          if (request.protocol !== 1 || request.instanceId !== state.instanceId || typeof request.token !== "string" || request.token.length !== state.token.length || !timingSafeEqual(Buffer.from(request.token), Buffer.from(state.token))) throw new Error("Daemon protocol/authentication mismatch; restart with a compatible CLI");
          if (request.command === "status") await opening;
          if (request.command === "view-start") await openView();
          else if (request.command === "view-stop") await closeView();
          else if (request.command === "view-restart") { await closeView(); await openView(); }
          else if (request.command === "notify") void tick();
          else if (request.command !== "status" && request.command !== "stop") throw new Error("Unknown daemon command");
          const counts: Record<string, number> = {}; for (const row of await listTasks(home)) counts[row.value.status] = (counts[row.value.status] ?? 0) + 1;
          socket.end(JSON.stringify({ taskErrors: [...taskDiagnostics(home), ...executionErrors.values()], tasks: counts, running: !stopping, pid: process.pid, instanceId: state.instanceId, protocol: 1, view: { ...(await readServiceIntent(home)).view, running: Boolean(view), ...viewInfo, ...(viewError ? { error: viewError } : {}) } }) + "\n");
          if (request.command === "stop") void shutdown();
        } catch (e) { socket.end(JSON.stringify({ error: (e as Error).message }) + "\n"); }
      });
    });
    if (process.platform !== "win32") await rm(state.endpoint, { force: true });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(state.endpoint, resolve); });
    if (process.platform !== "win32") await chmod(state.endpoint, 0o600);
    const restoringView = openView();
    await atomicWriteJson(statePath(home), state);
    await restoringView;
    const timer = setInterval(() => void tick(), 1000);
    const shutdown = async () => {
      if (stopping) return; stopping = true; clearInterval(timer);
      while (busy) await delay(50);
      await closeView();
      for (const row of await listTasks(home)) if (!executionErrors.has(row.id) && row.value.status === "running" && row.value.daemonInstanceId === state.instanceId) await updateTask(row, { status: "queued", daemonInstanceId: undefined }, home);
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(statePath(home), { force: true });
      if (process.platform !== "win32") await rm(state.endpoint, { force: true });
    };
    process.once("SIGTERM", () => void shutdown()); process.once("SIGINT", () => void shutdown());
    void tick();
    await new Promise<void>(resolve => server.once("close", resolve));
  });
}
export function sendQueue(command: string, sessionId: string, body: string, cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const message = `[Memsphere 自动消息]\n${body}`;
    const child = spawnCommand(command, ["queue", "--thread", sessionId, "--message", message], { cwd, stdio: "ignore" });
    const timeout = setTimeout(() => { child.kill(); reject(new Error("Queue timeout; outcome unknown")); }, 15000);
    child.once("error", e => { clearTimeout(timeout); reject(e); });
    child.once("close", code => { clearTimeout(timeout); if (code === 0) resolve(); else reject(new Error(`Queue exited ${code}`)); });
  });
}

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { unlink, mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import type { MemsphereConfig } from "../config.js";
import { terminateProcessTree } from "../platform-process.js";

const stateFileName = "view-service.json";
const startupTimeoutMs = 10_000;
const shutdownTimeoutMs = 2_000;
const pollIntervalMs = 50;

const viewServiceStateSchema = z.object({
  pid: z.number().int().positive(),
  host: z.string().min(1),
  port: z.number().int().min(0).max(65535),
  startedAt: z.string().min(1),
  configPath: z.string().min(1),
  settingsToken: z.string().min(32).optional()
});

export type ViewServiceState = z.infer<typeof viewServiceStateSchema>;

export type ViewServiceStatus = {
  running: boolean;
  state?: ViewServiceState;
};

export type ViewServiceDependencies = {
  spawnProcess?: typeof spawn;
  isProcessAlive?: (pid: number) => boolean;
  killProcess?: (pid: number, signal?: NodeJS.Signals) => void | Promise<void>;
  sleep?: (milliseconds: number) => Promise<void>;
};

export function viewServiceStatePath(config: MemsphereConfig): string {
  return join(config.homeRoot ?? config.scopeRoot, ".runtime", stateFileName);
}

export async function readViewServiceState(statePath: string): Promise<ViewServiceState | undefined> {
  try {
    return viewServiceStateSchema.parse(JSON.parse(await readFile(statePath, "utf8")));
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw new Error(`invalid view service state: ${statePath}`);
  }
}

export async function writeViewServiceState(statePath: string, state: ViewServiceState): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${state.pid}.${randomBytes(6).toString("hex")}.tmp`;
  const temporary = await open(temporaryPath, "wx", 0o600);
  let renamed = false;
  try {
    await temporary.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
    await temporary.sync();
    await temporary.close();
    await rename(temporaryPath, statePath);
    renamed = true;
  } finally {
    await temporary.close().catch(() => undefined);
    if (!renamed) await unlink(temporaryPath).catch(() => undefined);
  }
}

export async function clearViewServiceState(statePath: string, pid?: number): Promise<void> {
  if (pid !== undefined) {
    const state = await readViewServiceState(statePath);
    if (state && state.pid !== pid) return;
  }

  try {
    await unlink(statePath);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
}

export async function getViewServiceStatus(
  config: MemsphereConfig,
  dependencies: ViewServiceDependencies = {}
): Promise<ViewServiceStatus> {
  const statePath = viewServiceStatePath(config);
  let state: ViewServiceState | undefined;

  try {
    state = await readViewServiceState(statePath);
  } catch {
    await clearViewServiceState(statePath);
    return { running: false };
  }

  if (!state) return { running: false };
  const isAlive = dependencies.isProcessAlive ?? isProcessAlive;
  if (isAlive(state.pid)) return { running: true, state };

  await clearViewServiceState(statePath, state.pid);
  return { running: false };
}

export async function startViewService(
  config: MemsphereConfig,
  dependencies: ViewServiceDependencies = {}
): Promise<ViewServiceState> {
  const existing = await getViewServiceStatus(config, dependencies);
  if (existing.running && existing.state) return existing.state;

  const cliPath = process.argv[1];
  if (!cliPath) throw new Error("unable to determine memsphere CLI path");

  const statePath = viewServiceStatePath(config);
  const spawnProcess = dependencies.spawnProcess ?? spawn;
  const child = spawnProcess(
    process.execPath,
    [cliPath, "view", "serve", "--config", config.configPath, "--state", statePath],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      windowsHide: true
    }
  );
  if (!child.pid) throw new Error("failed to start view service process");
  let childFailure: string | undefined;
  child.once?.("error", (error) => {
    childFailure = error.message;
  });
  child.once?.("exit", (code, signal) => {
    if (code !== 0 || signal) {
      childFailure = signal ? `terminated by ${signal}` : `exited with code ${code ?? "unknown"}`;
    }
  });
  child.unref();

  const wait = dependencies.sleep ?? ((milliseconds: number) => sleep(milliseconds));
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    const state = await readViewServiceState(statePath).catch(() => undefined);
    if (state?.pid === child.pid) return state;
    if (childFailure) {
      await clearViewServiceState(statePath, child.pid);
      throw new Error(
        `view service ${childFailure} before publishing state; ` +
        `check whether ${config.view.host}:${config.view.port} is already in use`
      );
    }
    await wait(pollIntervalMs);
  }

  await terminateAndWait(child.pid, dependencies, wait);
  await clearViewServiceState(statePath, child.pid);
  throw new Error("view service did not start successfully; check whether the configured port is available");
}

export async function stopViewService(
  config: MemsphereConfig,
  dependencies: ViewServiceDependencies = {}
): Promise<ViewServiceStatus> {
  const status = await getViewServiceStatus(config, dependencies);
  if (!status.running || !status.state) return { running: false };

  const isAlive = dependencies.isProcessAlive ?? isProcessAlive;
  const wait = dependencies.sleep ?? ((milliseconds: number) => sleep(milliseconds));
  await terminateAndWait(status.state.pid, dependencies, wait);

  if (isAlive(status.state.pid)) throw new Error(`view service ${status.state.pid} did not stop successfully`);
  await clearViewServiceState(viewServiceStatePath(config), status.state.pid);
  return { running: false };
}

export async function restartViewService(
  config: MemsphereConfig,
  dependencies: ViewServiceDependencies = {}
): Promise<ViewServiceState> {
  await stopViewService(config, dependencies);
  return startViewService(config, dependencies);
}

export function viewServiceUrl(state: Pick<ViewServiceState, "host" | "port">): string {
  return `http://${state.host}:${state.port}`;
}

export function createSettingsToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "EPERM");
  }
}

async function terminateAndWait(
  pid: number,
  dependencies: ViewServiceDependencies,
  wait: (milliseconds: number) => Promise<void>
): Promise<void> {
  const isAlive = dependencies.isProcessAlive ?? isProcessAlive;
  const kill = dependencies.killProcess ?? terminateProcess;
  if (!isAlive(pid)) return;

  await kill(pid, "SIGTERM");
  let deadline = Date.now() + shutdownTimeoutMs;
  while (Date.now() < deadline && isAlive(pid)) await wait(pollIntervalMs);
  if (!isAlive(pid)) return;

  await kill(pid, "SIGKILL");
  deadline = Date.now() + shutdownTimeoutMs;
  while (Date.now() < deadline && isAlive(pid)) await wait(pollIntervalMs);
}

async function terminateProcess(pid: number, signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
  await terminateProcessTree(pid, signal);
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT");
}

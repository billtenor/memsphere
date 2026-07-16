import { spawn, type ChildProcess } from "node:child_process";
import { unlink, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import type { MemsphereConfig } from "../config.js";

const stateFileName = "view-service.json";
const startupTimeoutMs = 2_000;
const pollIntervalMs = 50;

const viewServiceStateSchema = z.object({
  pid: z.number().int().positive(),
  host: z.string().min(1),
  port: z.number().int().min(0).max(65535),
  startedAt: z.string().min(1),
  configPath: z.string().min(1)
});

export type ViewServiceState = z.infer<typeof viewServiceStateSchema>;

export type ViewServiceStatus = {
  running: boolean;
  state?: ViewServiceState;
};

export type ViewServiceDependencies = {
  spawnProcess?: typeof spawn;
  isProcessAlive?: (pid: number) => boolean;
  killProcess?: (pid: number) => void;
  sleep?: (milliseconds: number) => Promise<void>;
};

export function viewServiceStatePath(config: MemsphereConfig): string {
  return join(config.scopeRoot, stateFileName);
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
  const temporaryPath = `${statePath}.${state.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, statePath);
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
      stdio: "ignore"
    }
  );
  child.unref();
  if (!child.pid) throw new Error("failed to start view service process");

  const wait = dependencies.sleep ?? ((milliseconds: number) => sleep(milliseconds));
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    const state = await readViewServiceState(statePath).catch(() => undefined);
    if (state?.pid === child.pid) return state;
    await wait(pollIntervalMs);
  }

  if ((dependencies.isProcessAlive ?? isProcessAlive)(child.pid)) {
    (dependencies.killProcess ?? terminateProcess)(child.pid);
  }
  await clearViewServiceState(statePath);
  throw new Error("view service did not start successfully; check whether the configured port is available");
}

export async function stopViewService(
  config: MemsphereConfig,
  dependencies: ViewServiceDependencies = {}
): Promise<ViewServiceStatus> {
  const status = await getViewServiceStatus(config, dependencies);
  if (!status.running || !status.state) return { running: false };

  const isAlive = dependencies.isProcessAlive ?? isProcessAlive;
  const kill = dependencies.killProcess ?? terminateProcess;
  kill(status.state.pid);

  const wait = dependencies.sleep ?? ((milliseconds: number) => sleep(milliseconds));
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(status.state.pid)) {
      await clearViewServiceState(viewServiceStatePath(config), status.state.pid);
      return { running: false };
    }
    await wait(pollIntervalMs);
  }

  throw new Error(`view service ${status.state.pid} did not stop successfully`);
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

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "EPERM");
  }
}

function terminateProcess(pid: number): void {
  process.kill(pid, "SIGTERM");
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT");
}

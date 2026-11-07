import { once } from "node:events";
import type { ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { captureProcessIdentity, queryWindowsProcesses, type ProcessIdentity } from "../../src/context_control/review-process.js";
import { inspectWindowsReviewJob } from "../../src/context_control/windows-review-job.js";
import type { TestContext } from "node:test";
import { processGates } from "../fixtures/process-gates.mjs";

export async function bounded<T>(operation: Promise<T>, description: string, ms = 15_000): Promise<T> {
  const timer = new AbortController();
  try {
    return await Promise.race([operation, delay(ms, undefined, { signal: timer.signal }).then(() => { throw Error(`Timed out: ${description}`); })]);
  } finally { timer.abort(); }
}

export function sameProcess(expected: ProcessIdentity, current: ProcessIdentity | undefined): boolean {
  if (!expected.started || current && !current.started) throw Error("Process creation identity is missing");
  return current !== undefined && expected.pid === current.pid && expected.started === current.started && expected.group === current.group;
}

async function identities(pids: number[], query = queryWindowsProcesses): Promise<Map<number, ProcessIdentity>> {
  if (process.platform !== "win32") {
    const result = await Promise.all(pids.map(async pid => [pid, await captureProcessIdentity(pid)] as const));
    return new Map(result.filter((row): row is readonly [number, ProcessIdentity] => row[1] !== undefined));
  }
  // One fresh CIM snapshot per observation, never a cached exit decision.
  const selected = new Set(pids.filter(pid => {
    try { process.kill(pid, 0); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
  }));
  if (!selected.size) return new Map();
  return new Map((await query()).filter(row => selected.has(row.pid)).map(row => {
    if (!row.started) throw Error(`Process ${row.pid} has no creation identity`);
    return [row.pid, { pid: row.pid, group: row.group, started: row.started }];
  }));
}

export async function createFixtureProcesses(signal?: AbortSignal) {
  if (process.platform !== "win32") return { ...fixtureProcesses(), close: async () => {} };
  const { windowsProcessObserver } = await import("./windows-process-observer.js");
  const observer = await windowsProcessObserver(signal);
  return { ...fixtureProcesses(pids => identities(pids, () => queryWindowsProcesses(undefined,
    async () => ({ stdout: await observer.query(pids) })))), close: () => observer.close() };
}

/** Ready barriers must keep these original processes alive until remember ends. */
export function fixtureProcesses(read = identities) {
  const originals = new Map<number, ProcessIdentity>();
  const observed = new Map<number, ProcessIdentity | undefined>();
  const record = (identity: ProcessIdentity) => {
    if (!identity.started) throw Error(`Ready fixture ${identity.pid} has no process identity`);
    const previous = originals.get(identity.pid);
    if (previous && !sameProcess(previous, identity)) throw Error(`Cannot replace original identity for ${identity.pid}`);
    originals.set(identity.pid, Object.freeze({ ...identity }));
  };
  return {
    // The native test already obtained these identities from its ready-time CIM
    // group snapshot; querying the same live barrier again adds no evidence.
    rememberSnapshot(...members: ProcessIdentity[]) { members.forEach(record); },
    async remember(...pids: number[]) {
      const rows = await read(pids);
      for (const pid of pids) {
        const identity = rows.get(pid);
        if (!identity?.started) throw Error(`Ready fixture ${pid} has no process identity`);
        record(identity);
      }
    },
    async alive(...pids: number[]) {
      const rows = await read(pids);
      return pids.map(pid => {
        const original = originals.get(pid);
        if (!original) throw Error(`Fixture ${pid} was not recorded at readiness`);
        const current = rows.get(pid);
        observed.set(pid, current);
        return sameProcess(original, current);
      });
    },
    original(pid: number) { return originals.get(pid); },
    diagnostic(pid: number) { return JSON.stringify({ original: originals.get(pid), observed: observed.get(pid) ?? null }); }
  };
}

/** ChildProcess.kill uses its original process handle on Windows. No PID lookup. */
export async function stopFixtureChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  // Register before signalling: the event may arrive synchronously in a fixture.
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await bounded(exited, "owned ChildProcess exit");
}

/** A Job name is fixed by the original Attempt; never derive it from a new PID. */
export async function stopFixtureJob(job: string): Promise<void> {
  const state = await inspectWindowsReviewJob(job, true);
  if (state.active !== 0) throw Error(`Fixture Job still has ${state.active} processes`);
}

/** One broken probe must not prevent cleanup of the other owned resources. */
export async function cleanupFixtureResources(actions: Array<() => unknown | Promise<unknown>>): Promise<void> {
  const errors: unknown[] = [];
  for (const action of actions) {
    try { await action(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, "Fixture cleanup failed");
}

/** Register ownership before the next fallible await; dispose dependents first. */
export async function rewindFixtureResources(t: Pick<TestContext, "after" | "signal">, options: {
  createGates?: typeof processGates;
  createObserver?: typeof createFixtureProcesses;
} = {}) {
  const actions: Array<() => unknown | Promise<unknown>> = [];
  let closed = false;
  const defer = (action: () => unknown | Promise<unknown>) => {
    if (closed) throw Error("Cannot register a closed rewind fixture");
    actions.push(action);
  };
  const close = async () => {
    if (closed) return;
    closed = true;
    await cleanupFixtureResources(actions.reverse());
  };
  t.after(close);
  try {
    const gates = await (options.createGates ?? processGates)(t.signal);
    defer(() => gates.close());
    const observed = await (options.createObserver ?? createFixtureProcesses)(t.signal);
    defer(() => observed.close());
    return { gates, observed, defer, close };
  } catch (error) {
    try { await close(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], "Rewind fixture initialization and cleanup failed"); }
    throw error;
  }
}

export async function untilFixture(read: () => Promise<boolean>, description = "fixture state"): Promise<void> {
  const end = Date.now() + 60_000;
  while (!await read()) {
    if (Date.now() >= end) throw Error(`Timed out: ${description}`);
    await delay(25);
  }
}

/** Job completion covers the workload, while the external keeper subsequently
 * closes its handle and exits. Both must be gone before fixture completion. */
export async function verifyFixtureTreeExit(observed: ReturnType<typeof fixtureProcesses>, workload: number[], keepers: number[]) {
  const workloadStates = await observed.alive(...workload);
  const survivors = workload.filter((_, index) => workloadStates[index]);
  if (survivors.length) throw Error(`Original fixture workload has not exited: ${survivors.map(pid => observed.diagnostic(pid)).join(", ")}`);
  if (keepers.length) await untilFixture(async () => !(await observed.alive(...keepers)).some(Boolean), "external fixture keepers exit after the Job drains");
}

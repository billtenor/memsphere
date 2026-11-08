import assert from "node:assert/strict";

import type { ChildProcess } from "node:child_process";

import { EventEmitter } from "node:events";







import test from "node:test";

import type { MemsphereConfig } from "../src/config.js";

import { getViewServiceStatus, restartViewService, startViewService, stopViewService, viewServiceStatePath } from "../src/view/service.js";

import { MemoryViewState } from "./support/memory-view-state.js";
import { ManualClock } from "./support/manual-clock.js";
async function withTempConfig(fn: (config: MemsphereConfig, stateStore: MemoryViewState, clock: ManualClock) => Promise<void>) {
  const config = { configPath: "module/config.json", scopeRoot: "module", view: { host: "127.0.0.1", port: 0 } } as MemsphereConfig;
  await fn(config, new MemoryViewState(), new ManualClock());
}

function state(config: MemsphereConfig, pid: number, port = 30002) {
  return { pid, host: config.view.host, port, startedAt: "2026-07-16T00:00:00.000Z", configPath: config.configPath };
}

test("status removes stale View service state", async () => {
  await withTempConfig(async (config, stateStore, clock) => {
    const path = viewServiceStatePath(config);
    await stateStore.write(path, state(config, 1234));

    const status = await getViewServiceStatus(config, { stateStore, now: clock.now, isProcessAlive: () => false });

    assert.equal(status.running, false);
    assert.equal(await stateStore.read(path), undefined);
  });
});

test("start is idempotent while the managed View service is running", async () => {
  await withTempConfig(async (config, stateStore, clock) => {
    const existing = state(config, 1234);
    await stateStore.write(viewServiceStatePath(config), existing);
    let spawned = false;

    const started = await startViewService(config, { stateStore, now: clock.now,
      isProcessAlive: () => true,
      spawnProcess: (() => {
        spawned = true;
        throw new Error("should not spawn");
      }) as never
    });

    assert.deepEqual(started, existing);
    assert.equal(spawned, false);
  });
});

test("start waits for its child service to publish state", async () => {
  await withTempConfig(async (config, stateStore, clock) => {
    const childPid = 4321;
    let publishState = true;
    const started = await startViewService(config, { stateStore, now: clock.now,
      isProcessAlive: () => true,
      spawnProcess: (() => {
        return { pid: childPid, unref() {} } as ChildProcess;
      }) as never,
      sleep: async () => {
        if (!publishState) return;
        publishState = false;
        await stateStore.write(viewServiceStatePath(config), state(config, childPid, 30003));
      }
    });

    assert.equal(started.pid, childPid);
    assert.equal(started.port, 30003);
  });
});

test("start fails immediately when its child exits before publishing state", async () => {
  await withTempConfig(async (config, stateStore, clock) => {
    const child = Object.assign(new EventEmitter(), {
      pid: 4321,
      unref() {}
    }) as ChildProcess;
    let sleepCount = 0;

    await assert.rejects(
      startViewService(config, { stateStore, now: clock.now,
        isProcessAlive: () => false,
        spawnProcess: (() => {
          queueMicrotask(() => child.emit("exit", 1, null));
          return child;
        }) as never,
        sleep: async () => {
          sleepCount += 1;
          await Promise.resolve();
        }
      }),
      /exited with code 1 before publishing state.*already in use/
    );
    assert.ok(sleepCount < 10);
  });
});

test("managed start does not transport the Settings token through the child environment", async () => {
  await withTempConfig(async (config, stateStore, clock) => {
    config.view = { host: "0.0.0.0", port: 30002 };
    const childPid = 4321;
    let spawnOptions: Record<string, unknown> | undefined;
    let publishState = true;
    const started = await startViewService(config, { stateStore, now: clock.now,
      isProcessAlive: () => true,
      spawnProcess: ((...args: unknown[]) => {
        spawnOptions = args[2] as Record<string, unknown>;
        return { pid: childPid, unref() {} } as ChildProcess;
      }) as never,
      sleep: async () => {
        if (!publishState) return;
        publishState = false;
        await stateStore.write(viewServiceStatePath(config), {
          ...state(config, childPid),
          host: "0.0.0.0",
          settingsToken: "a".repeat(43)
        });
      }
    });

    assert.equal(spawnOptions?.env, undefined);
    assert.equal(spawnOptions?.windowsHide, true);
    assert.equal(started.settingsToken, "a".repeat(43));
  });
});

test("stop terminates a managed service and clears state", async () => {
  await withTempConfig(async (config, stateStore, clock) => {
    const path = viewServiceStatePath(config);
    await stateStore.write(path, state(config, 1234));
    let alive = true;

    const status = await stopViewService(config, { stateStore, now: clock.now,
      isProcessAlive: () => alive,
      killProcess: () => { alive = false; },
      sleep: async () => undefined
    });

    assert.equal(status.running, false);
    assert.equal(await stateStore.read(path), undefined);
  });
});

test("restart replaces the managed service state", async () => {
  await withTempConfig(async (config, stateStore, clock) => {
    const path = viewServiceStatePath(config);
    await stateStore.write(path, state(config, 1234));
    let oldAlive = true;
    let publishState = true;
    const restarted = await restartViewService(config, { stateStore, now: clock.now, stateStore, now: clock.now,
      isProcessAlive: (pid) => pid === 1234 ? oldAlive : true,
      killProcess: (pid) => { if (pid === 1234) oldAlive = false; },
      spawnProcess: (() => {
        return { pid: 4321, unref() {} } as ChildProcess;
      }) as never,
      sleep: async () => {
        if (!publishState) return;
        publishState = false;
        await stateStore.write(path, state(config, 4321, 30004));
      }
    });

    assert.equal(restarted.pid, 4321);
    assert.equal((await stateStore.read(path))?.port, 30004);
  });
});

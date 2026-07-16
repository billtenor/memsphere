import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { MemsphereConfig } from "../src/config.js";
import {
  getViewServiceStatus,
  readViewServiceState,
  restartViewService,
  startViewService,
  stopViewService,
  viewServiceStatePath,
  writeViewServiceState
} from "../src/view/service.js";

async function withTempConfig(fn: (config: MemsphereConfig) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-view-service-test-"));
  const config: MemsphereConfig = {
    configPath: join(dir, "config.json"),
    scopeRoot: dir,
    memoryRoot: join(dir, "memory"),
    reviewsRoot: join(dir, "reviews"),
    runsRoot: join(dir, "runs"),
    archiveRoot: join(dir, "archives"),
    view: { host: "127.0.0.1", port: 0 }
  };
  try {
    await fn(config);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function state(config: MemsphereConfig, pid: number, port = 30002) {
  return { pid, host: config.view.host, port, startedAt: "2026-07-16T00:00:00.000Z", configPath: config.configPath };
}

test("status removes stale View service state", async () => {
  await withTempConfig(async (config) => {
    const path = viewServiceStatePath(config);
    await writeViewServiceState(path, state(config, 1234));

    const status = await getViewServiceStatus(config, { isProcessAlive: () => false });

    assert.equal(status.running, false);
    assert.equal(await readViewServiceState(path), undefined);
  });
});

test("start is idempotent while the managed View service is running", async () => {
  await withTempConfig(async (config) => {
    const existing = state(config, 1234);
    await writeViewServiceState(viewServiceStatePath(config), existing);
    let spawned = false;

    const started = await startViewService(config, {
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
  await withTempConfig(async (config) => {
    const childPid = 4321;
    const started = await startViewService(config, {
      isProcessAlive: () => true,
      spawnProcess: (() => {
        setTimeout(() => void writeViewServiceState(viewServiceStatePath(config), state(config, childPid, 30003)), 5);
        return { pid: childPid, unref() {} } as ChildProcess;
      }) as never,
      sleep: async () => new Promise((resolveSleep) => setTimeout(resolveSleep, 5))
    });

    assert.equal(started.pid, childPid);
    assert.equal(started.port, 30003);
  });
});

test("stop terminates a managed service and clears state", async () => {
  await withTempConfig(async (config) => {
    const path = viewServiceStatePath(config);
    await writeViewServiceState(path, state(config, 1234));
    let alive = true;

    const status = await stopViewService(config, {
      isProcessAlive: () => alive,
      killProcess: () => { alive = false; },
      sleep: async () => undefined
    });

    assert.equal(status.running, false);
    assert.equal(await readViewServiceState(path), undefined);
  });
});

test("restart replaces the managed service state", async () => {
  await withTempConfig(async (config) => {
    const path = viewServiceStatePath(config);
    await writeViewServiceState(path, state(config, 1234));
    let oldAlive = true;
    const restarted = await restartViewService(config, {
      isProcessAlive: (pid) => pid === 1234 ? oldAlive : true,
      killProcess: (pid) => { if (pid === 1234) oldAlive = false; },
      spawnProcess: (() => {
        setTimeout(() => void writeViewServiceState(path, state(config, 4321, 30004)), 5);
        return { pid: 4321, unref() {} } as ChildProcess;
      }) as never,
      sleep: async () => new Promise((resolveSleep) => setTimeout(resolveSleep, 5))
    });

    assert.equal(restarted.pid, 4321);
    assert.equal((await readViewServiceState(path))?.port, 30004);
  });
});

import assert from "node:assert/strict";





import { mkdtemp, rm, stat } from "node:fs/promises";

import { tmpdir } from "node:os";

import { join } from "node:path";

import test from "node:test";

import type { MemsphereConfig } from "../../../src/config.js";

import { viewServiceStatePath, writeViewServiceState } from "../../../src/view/service.js";

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

test("View service state is private to the current user", async () => {
  await withTempConfig(async (config) => {
    const path = viewServiceStatePath(config);
    await writeViewServiceState(path, {
      ...state(config, 1234),
      settingsToken: "a".repeat(43)
    });
    if (process.platform !== "win32") {
      assert.equal((await stat(path)).mode & 0o777, 0o600);
    } else {
      assert.equal((await stat(path)).isFile(), true);
    }
  });
});

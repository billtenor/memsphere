import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readConfigAt } from "../src/config.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-config-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("readConfigAt defaults archiveRoot within the scope", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({ memoryRoot: "memory" }));

    const config = await readConfigAt(configPath);

    assert.equal(config.archiveRoot, join(dir, "archives"));
  });
});

test("readConfigAt resolves an explicit archiveRoot", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({ memoryRoot: "memory", archiveRoot: "/shared/memsphere/archives" }));

    const config = await readConfigAt(configPath);

    assert.equal(config.archiveRoot, "/shared/memsphere/archives");
  });
});

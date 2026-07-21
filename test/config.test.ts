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
    assert.deepEqual(config.view, { host: "127.0.0.1", port: 0 });
  });
});

test("readConfigAt resolves View service configuration", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({ memoryRoot: "memory", view: { host: "0.0.0.0", port: 30002 } }));

    const config = await readConfigAt(configPath);

    assert.deepEqual(config.view, { host: "0.0.0.0", port: 30002 });
  });
});

test("readConfigAt rejects an invalid View service port", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({ memoryRoot: "memory", view: { host: "127.0.0.1", port: 65536 } }));

    await assert.rejects(readConfigAt(configPath));
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

test("readConfigAt resolves strict control_plane configuration", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({
      memoryRoot: "memory",
      control_plane: {
        identities: {
          reviewer: { kind: "human", name: "Reviewer" }
        },
        roles: {
          runner: { name: "Runner", permissions: ["artifact.submit"] },
          reviewer: {
            name: "Reviewer",
            permissions: ["artifact.read", "decision.assess"],
            system_prompt: "Review the Artifact."
          }
        }
      }
    }));

    const config = await readConfigAt(configPath);
    assert.deepEqual(config.controlPlane?.roles.runner.permissions, ["artifact.submit"]);
    assert.equal(config.controlPlane?.roles.reviewer.systemPrompt, "Review the Artifact.");
  });
});

test("readConfigAt rejects unknown top-level and control_plane fields", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({ memoryRoot: "memory", unknown: true }));
    await assert.rejects(readConfigAt(configPath), /Unrecognized key.*unknown/);

    await writeFile(configPath, JSON.stringify({
      memoryRoot: "memory",
      control_plane: {
        identities: {},
        roles: { runner: { name: "Runner", permissions: [] } },
        permissions: []
      }
    }));
    await assert.rejects(readConfigAt(configPath), /Unrecognized key.*permissions/);
  });
});

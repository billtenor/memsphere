import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { memoryKinds, type MemoryKind } from "../src/memory/kinds.js";
import { listMemoryFiles } from "../src/memory/store.js";
import { validateMemoryStore } from "../src/validation.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-test-"));

  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("listMemoryFiles treats any missing memory kind directory as empty", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    await mkdir(memoryRoot);

    for (const kind of memoryKinds) {
      assert.deepEqual(await listMemoryFiles(memoryRoot, kind), [], kind);
    }
  });
});

test("listMemoryFiles keeps yaml filtering and sorting for existing directories", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    await mkdir(proceduresRoot, { recursive: true });
    await mkdir(join(proceduresRoot, "nested"));
    await writeFile(join(proceduresRoot, "b.yml"), "!procedure\nnames: [b]\nflow: []\n");
    await writeFile(join(proceduresRoot, "a.yaml"), "!procedure\nnames: [a]\nflow: []\n");
    await writeFile(join(proceduresRoot, "note.txt"), "not a memory\n");
    await writeFile(join(proceduresRoot, "nested", "c.yaml"), "!procedure\nnames: [c]\nflow: []\n");

    assert.deepEqual(await listMemoryFiles(memoryRoot, "procedures"), [
      join(proceduresRoot, "a.yaml"),
      join(proceduresRoot, "b.yml")
    ]);
  });
});

for (const missingKind of memoryKinds) {
  test(`validateMemoryStore still reports missing ${missingKind} directory`, async () => {
    await withTempDir(async (dir) => {
      const configPath = join(dir, "config.json");
      const memoryRoot = join(dir, "memory");
      await mkdir(memoryRoot);
      await mkdir(join(dir, "reviews"));
      await mkdir(join(dir, "runs"));

      for (const kind of memoryKinds) {
        if (kind !== missingKind) {
          await mkdir(join(memoryRoot, kind));
        }
      }

      await writeFile(configPath, `${JSON.stringify({ memoryRoot: "memory", reviewsRoot: "reviews", runsRoot: "runs" })}\n`);

      const result = await validateMemoryStore(configPath);
      assert(result.issues.some((issue) =>
        issue.path === join(memoryRoot, missingKind as MemoryKind) &&
        issue.message === "memory kind directory does not exist"
      ));
    });
  });
}

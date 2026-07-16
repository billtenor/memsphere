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

test("validateMemoryStore reports kind-scoped canonical and alias conflicts", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "config.json");
    const memoryRoot = join(dir, "memory");
    await mkdir(join(dir, "reviews"));
    await mkdir(join(dir, "runs"));
    for (const kind of memoryKinds) await mkdir(join(memoryRoot, kind), { recursive: true });
    await writeFile(configPath, `${JSON.stringify({ memoryRoot: "memory", reviewsRoot: "reviews", runsRoot: "runs" })}\n`);
    await writeFile(join(memoryRoot, "concepts", "one.yaml"), "!concept\nnames: [Memory, shared]\ndefines: []\n");
    await writeFile(join(memoryRoot, "concepts", "two.yaml"), "!concept\nnames: [Other, shared]\ndefines: []\n");
    await writeFile(join(memoryRoot, "concepts", "three.yaml"), "!concept\nnames: [Memory]\ndefines: []\n");
    await writeFile(join(memoryRoot, "statements", "same-name.yaml"), "!statement\nnames: [Memory]\nasserts: [valid]\n");

    const result = await validateMemoryStore(configPath);
    assert(result.issues.some((issue) => issue.message.includes('memory name "shared" conflicts within concepts')));
    assert(result.issues.some((issue) => issue.message.includes('memory name "Memory" conflicts within concepts')));
    assert(!result.issues.some((issue) => issue.message.includes("conflicts within statements")));
  });
});

test("validateMemoryStore reports normalized empty and repeated names with parse errors", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "config.json");
    const memoryRoot = join(dir, "memory");
    await mkdir(join(dir, "reviews"));
    await mkdir(join(dir, "runs"));
    for (const kind of memoryKinds) await mkdir(join(memoryRoot, kind), { recursive: true });
    await writeFile(configPath, `${JSON.stringify({ memoryRoot: "memory", reviewsRoot: "reviews", runsRoot: "runs" })}\n`);
    await writeFile(join(memoryRoot, "concepts", "names.yaml"), "!concept\nnames: [' Memory ', Memory, ' ']\ndefines: []\n");
    await writeFile(join(memoryRoot, "schemas", "broken.yaml"), "!schema\nnames: [Broken\n");

    const result = await validateMemoryStore(configPath);
    assert(result.issues.some((issue) => issue.message.includes('repeats the normalized name "Memory"')));
    assert(result.issues.some((issue) => issue.message.includes("alias at names[2] is empty")));
    assert(result.issues.some((issue) => issue.path.endsWith("broken.yaml")));
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

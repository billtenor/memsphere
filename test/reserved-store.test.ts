import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initCommand } from "../src/commands/init.js";
import { DefaultMemoryCatalog } from "../src/memory/catalog.js";
import { FileMemoryProvider } from "../src/memory/file-provider.js";
import { readAllMemoryFiles } from "../src/memory/store.js";
import {
  bundledReservedMemoryRoot,
  importReservedMemory,
  installReservedMemories,
  listReservedMemories,
  reservedMemoryRoot
} from "../src/reserved/store.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-reserved-test-"));

  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("bundled reserved memory contains a valid self-bootstrap chain", async () => {
  const files = await readAllMemoryFiles(bundledReservedMemoryRoot());
  const names = new Map<string, string>();

  for (const file of files) {
    for (const name of file.entity.names) {
      assert.equal(names.has(name), false, `duplicate reserved memory name: ${name}`);
      names.set(name, file.path);
    }
  }

  for (const expected of [
    "Memory",
    "Memsphere",
    "Concept",
    "Statement",
    "Schema",
    "Procedure",
    "Procedure entity schema",
    "Memory 访问规则",
    "Memory 解读与应用规则",
    "基于 Memory 完成任务流程",
    "通用流程"
  ]) {
    assert(names.has(expected), `missing reserved memory: ${expected}`);
  }

  const memory = files.find((file) => file.entity.names[0] === "Memory");
  assert(memory);
  assert(memory.entity.defines.every((definition) => typeof definition === "string"));
});

test("init installs reserved memory into the scope root without importing it into user memory", async () => {
  await withTempDir(async (dir) => {
    await initCommand({ folder: dir });

    const scopeRoot = join(dir, ".memsphere");
    const memoryRoot = join(scopeRoot, "memory");
    const items = await listReservedMemories(scopeRoot, memoryRoot);

    assert(items.some((item) => item.path === "concepts/concept.yaml"));
    assert(items.length > 0);
    assert(items.every((item) => item.error === undefined));
    assert(items.every((item) => item.imported === false));
    assert.deepEqual(await readAllMemoryFiles(memoryRoot, "concepts"), []);
    assert.deepEqual((await new DefaultMemoryCatalog(new FileMemoryProvider(memoryRoot)).list()).memories, []);
  });
});

test("reserved memory install rebuilds managed files", async () => {
  await withTempDir(async (dir) => {
    const scopeRoot = join(dir, ".memsphere");
    await installReservedMemories(scopeRoot);

    const target = join(reservedMemoryRoot(scopeRoot), "concepts", "concept.yaml");
    await writeFile(target, "!concept\nnames: [local reserved]\ndefines: [local edit]\n");
    await installReservedMemories(scopeRoot);

    assert.doesNotMatch(await readFile(target, "utf8"), /local edit/);
  });
});

test("repeated init preserves config and rebuilds the installed reserved memory cache", async () => {
  await withTempDir(async (dir) => {
    await initCommand({ folder: dir, memoryRoot: "custom-memory" });

    const scopeRoot = join(dir, ".memsphere");
    const configPath = join(scopeRoot, "config.json");
    const originalConfig = await readFile(configPath, "utf8");
    const target = join(reservedMemoryRoot(scopeRoot), "concepts", "concept.yaml");
    const stale = join(reservedMemoryRoot(scopeRoot), "concepts", "stale.yaml");
    await writeFile(target, "!concept\nnames: [local reserved]\ndefines: [local edit]\n");
    await writeFile(stale, "!concept\nnames: [stale]\n");

    await initCommand({ folder: dir });

    assert.equal(await readFile(configPath, "utf8"), originalConfig);
    assert.doesNotMatch(await readFile(target, "utf8"), /local edit/);
    await assert.rejects(readFile(stale, "utf8"), /ENOENT/);
    assert.deepEqual(await readAllMemoryFiles(join(scopeRoot, "custom-memory"), "concepts"), []);
  });
});

test("repeated init requires force only when changing configured paths", async () => {
  await withTempDir(async (dir) => {
    await initCommand({ folder: dir });

    await assert.rejects(
      initCommand({ folder: dir, memoryRoot: "other-memory" }),
      /Use --force to change its configured paths/
    );
  });
});

test("importReservedMemory copies reserved memory into the user memory root", async () => {
  await withTempDir(async (dir) => {
    const scopeRoot = join(dir, ".memsphere");
    const memoryRoot = join(scopeRoot, "memory");
    await mkdir(join(memoryRoot, "concepts"), { recursive: true });
    await installReservedMemories(scopeRoot);

    assert.deepEqual(await readAllMemoryFiles(memoryRoot, "concepts"), []);
    const reservedPath = join(reservedMemoryRoot(scopeRoot), "concepts", "concept.yaml");
    const reservedSource = await readFile(reservedPath, "utf8");

    const importedPath = await importReservedMemory(scopeRoot, memoryRoot, "concepts/concept.yaml");
    assert.equal(importedPath, join(memoryRoot, "concepts", "concept.yaml"));

    const files = await readAllMemoryFiles(memoryRoot, "concepts");
    assert.equal(files.length, 1);
    assert.equal(files[0].entity.names[0], "Concept");
    assert.equal(await readFile(reservedPath, "utf8"), reservedSource);
    assert.deepEqual(
      (await new DefaultMemoryCatalog(new FileMemoryProvider(memoryRoot)).list()).memories.map((item) => item.reference),
      ["concepts/Concept"]
    );

    const items = await listReservedMemories(scopeRoot, memoryRoot);
    assert.equal(items.find((item) => item.path === "concepts/concept.yaml")?.imported, true);
  });
});

test("importReservedMemory does not overwrite existing user memory", async () => {
  await withTempDir(async (dir) => {
    const scopeRoot = join(dir, ".memsphere");
    const memoryRoot = join(scopeRoot, "memory");
    await mkdir(join(memoryRoot, "concepts"), { recursive: true });
    await installReservedMemories(scopeRoot);

    await writeFile(
      join(memoryRoot, "concepts", "concept.yaml"),
      "!concept\nnames:\n  - Concept\ndefines:\n  - User-owned memory wins.\n"
    );

    await assert.rejects(
      importReservedMemory(scopeRoot, memoryRoot, "concepts/concept.yaml"),
      /memory already exists/
    );

    assert.match(
      await readFile(join(memoryRoot, "concepts", "concept.yaml"), "utf8"),
      /User-owned memory wins/
    );
  });
});

test("importReservedMemory rejects unsafe relative paths", async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(
      importReservedMemory(join(dir, ".memsphere"), join(dir, ".memsphere", "memory"), "../memory/concepts/x.yaml"),
      /invalid reserved memory path/
    );
  });
});

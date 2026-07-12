import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initCommand } from "../src/commands/init.js";
import { readAllMemoryFiles } from "../src/memory/store.js";
import {
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
  });
});

test("reserved memory install does not overwrite existing files", async () => {
  await withTempDir(async (dir) => {
    const scopeRoot = join(dir, ".memsphere");
    await installReservedMemories(scopeRoot);

    const target = join(reservedMemoryRoot(scopeRoot), "concepts", "concept.yaml");
    await writeFile(target, "!concept\nnames: [local reserved]\ndefines: [local edit]\n");
    await installReservedMemories(scopeRoot);

    assert.match(await readFile(target, "utf8"), /local edit/);
  });
});

test("importReservedMemory copies reserved memory into the user memory root", async () => {
  await withTempDir(async (dir) => {
    const scopeRoot = join(dir, ".memsphere");
    const memoryRoot = join(scopeRoot, "memory");
    await mkdir(join(memoryRoot, "concepts"), { recursive: true });
    await installReservedMemories(scopeRoot);

    assert.deepEqual(await readAllMemoryFiles(memoryRoot, "concepts"), []);

    const importedPath = await importReservedMemory(scopeRoot, memoryRoot, "concepts/concept.yaml");
    assert.equal(importedPath, join(memoryRoot, "concepts", "concept.yaml"));

    const files = await readAllMemoryFiles(memoryRoot, "concepts");
    assert.equal(files.length, 1);
    assert.equal(files[0].entity.names[0], "Concept");

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

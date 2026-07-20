import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileMemoryProvider } from "../src/memory/file-provider.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-provider-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("file provider lists summaries and reads only ids from the current list", async () => {
  await withTempDir(async (memoryRoot) => {
    const path = join(memoryRoot, "concepts", "unrelated-file-name.yaml");
    await mkdir(join(memoryRoot, "concepts"), { recursive: true });
    await writeFile(path, withCurrentMemorySyntax("!concept\nnames: [Memory, 记忆]\ndefines: [original]\n"));

    const provider = new FileMemoryProvider(memoryRoot);
    const descriptors = await provider.list({ kind: "concepts" });

    assert.deepEqual(descriptors, [{ id: path, kind: "concepts", names: ["Memory", "记忆"], defines: ["original"] }]);
    await assert.rejects(provider.read(join(memoryRoot, "concepts", "other.yaml")), /not returned by the current list/);

    await writeFile(path, withCurrentMemorySyntax("!concept\nnames: [Changed]\ndefines: [changed]\n"));
    assert.equal((await provider.read(path)).names[0], "Memory");

    const nextProvider = new FileMemoryProvider(memoryRoot);
    const nextDescriptors = await nextProvider.list({ kind: "concepts" });
    assert.deepEqual(nextDescriptors[0].names, ["Changed"]);
    assert.equal((await nextProvider.read(path)).names[0], "Changed");
  });
});

test("file provider clears ids that were not returned by its latest list", async () => {
  await withTempDir(async (memoryRoot) => {
    const conceptPath = join(memoryRoot, "concepts", "one.yaml");
    const schemaPath = join(memoryRoot, "schemas", "two.yaml");
    await mkdir(join(memoryRoot, "concepts"), { recursive: true });
    await mkdir(join(memoryRoot, "schemas"), { recursive: true });
    await writeFile(conceptPath, withCurrentMemorySyntax("!concept\nnames: [One]\ndefines: []\n"));
    await writeFile(schemaPath, withCurrentMemorySyntax("!schema\nnames: [Two]\ndefines: []\n"));

    const provider = new FileMemoryProvider(memoryRoot);
    await provider.list({ kind: "concepts" });
    assert.equal((await provider.read(conceptPath)).names[0], "One");
    await provider.list({ kind: "schemas" });
    await assert.rejects(provider.read(conceptPath), /not returned by the current list/);
    assert.equal((await provider.read(schemaPath)).names[0], "Two");
  });
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { readReservedMemoryManifest } from "../src/reserved/store.js";

const root = process.cwd();
const reservedRoot = join(root, "reserved-memory", "system-memory");
const projectMemoryRoot = join(root, ".memsphere", "memory");

test("all installed System Memory sources match the current Project copies", async () => {
  const manifest = await readReservedMemoryManifest();
  assert(manifest.system_memory.install.includes("concepts/memsphere-personalized-software.yaml"));

  for (const relativePath of manifest.system_memory.install) {
    const [reserved, project] = await Promise.all([
      readFile(join(reservedRoot, relativePath)),
      readFile(join(projectMemoryRoot, relativePath))
    ]);
    assert(reserved.equals(project), `System Memory copy differs: ${relativePath}`);
  }
});

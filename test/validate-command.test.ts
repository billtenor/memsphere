import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateMemoryRoot } from "../src/validation.js";
import { memoryKinds } from "../src/memory/kinds.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";

test("stateless Memory validation does not require Home or Registry", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-stateless-validation-"));
  try {
    for (const kind of memoryKinds) await mkdir(join(root, kind));
    await writeFile(join(root, "concepts", "valid.yaml"), withCurrentMemorySyntax("!concept\nnames: [valid]\ndefines: []\n"));
    assert.deepEqual((await validateMemoryRoot(root)).issues, []);
    await writeFile(join(root, "concepts", "broken.yaml"), "!concept\nnames: [Broken\n");
    const broken = await validateMemoryRoot(root);
    assert.equal(broken.issues.length, 1);
    assert.equal(broken.issues[0].path, join(root, "concepts", "broken.yaml"));
    assert.equal(broken.issues[0].line, 3);
    assert.equal(broken.issues[0].column, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Memory validation rejects symbolic links", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-symlink-validation-"));
  try {
    for (const kind of memoryKinds) await mkdir(join(root, kind));
    const outside = join(root, "outside.yaml");
    await writeFile(outside, withCurrentMemorySyntax("!concept\nnames: [outside]\ndefines: []\n"));
    await symlink(outside, join(root, "concepts", "linked.yaml"));
    const result = await validateMemoryRoot(root);
    assert.equal(result.issues.length, 1);
    assert.match(result.issues[0].message, /symbolic links are not allowed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

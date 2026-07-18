import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
  readReservedMemoryManifest,
  reservedMemoryManifestSchema,
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

test("bundled memory contains a valid self-bootstrap chain and manifest", async () => {
  const files = await readAllMemoryFiles(bundledReservedMemoryRoot());
  const manifest = await readReservedMemoryManifest();
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
    "Memory 撰写规则",
    "基于 Memory 完成任务流程",
    "敏捷需求开发流程",
    "通用流程"
  ]) {
    assert(names.has(expected), `missing reserved memory: ${expected}`);
  }

  const memory = files.find((file) => file.entity.names[0] === "Memory");
  assert(memory);
  assert(memory.entity.defines.every((definition) => typeof definition === "string"));
  assert.equal(manifest.system_memory.install.length, 9);
  assert.deepEqual(manifest.system_memory.remove, []);
});

test("init installs system memory and keeps other bundled memory reserved", async () => {
  await withTempDir(async (dir) => {
    await initCommand({ folder: dir });

    const scopeRoot = join(dir, ".memsphere");
    const memoryRoot = join(scopeRoot, "memory");
    const items = await listReservedMemories(scopeRoot, memoryRoot);

    assert(items.some((item) => item.path === "schemas/concept.yaml"));
    assert(items.some((item) => item.path === "statements/memory-authoring-rules.yaml"));
    assert(items.some((item) => item.path === "procedures/agile-requirement-development.yaml"));
    assert.equal(items.some((item) => item.path === "concepts/concept.yaml"), false);
    assert(items.length > 0);
    assert(items.every((item) => item.error === undefined));
    assert(items.every((item) => item.imported === false));
    assert.equal((await readAllMemoryFiles(memoryRoot, "concepts")).length, 6);
    const catalog = await new DefaultMemoryCatalog(new FileMemoryProvider(memoryRoot)).list();
    assert(catalog.memories.some((item) => item.reference === "concepts/Memory"));
    assert(catalog.memories.some((item) => item.reference === "procedures/通用流程"));
    assert.equal(catalog.memories.some((item) => item.reference === "statements/Memory 撰写规则"), false);
    assert.equal(catalog.memories.some((item) => item.reference === "procedures/敏捷需求开发流程"), false);
    assert.equal(catalog.memories.some((item) => item.reference === "schemas/Concept entity schema"), false);
  });
});

test("reserved memory install rebuilds managed files", async () => {
  await withTempDir(async (dir) => {
    const scopeRoot = join(dir, ".memsphere");
    await installReservedMemories(scopeRoot);

    const target = join(reservedMemoryRoot(scopeRoot), "schemas", "concept.yaml");
    await writeFile(target, "!schema\nnames: [local reserved]\ndefines: [local edit]\n");
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
    const target = join(reservedMemoryRoot(scopeRoot), "schemas", "concept.yaml");
    const stale = join(reservedMemoryRoot(scopeRoot), "concepts", "stale.yaml");
    const systemTarget = join(scopeRoot, "custom-memory", "concepts", "concept.yaml");
    await writeFile(target, "!schema\nnames: [local reserved]\ndefines: [local edit]\n");
    await writeFile(systemTarget, "!concept\nnames: [local system]\ndefines: [local edit]\n");
    await writeFile(stale, "!concept\nnames: [stale]\n");

    await initCommand({ folder: dir });

    assert.equal(await readFile(configPath, "utf8"), originalConfig);
    assert.doesNotMatch(await readFile(target, "utf8"), /local edit/);
    assert.doesNotMatch(await readFile(systemTarget, "utf8"), /local edit/);
    await assert.rejects(readFile(stale, "utf8"), /ENOENT/);
    assert.equal((await readAllMemoryFiles(join(scopeRoot, "custom-memory"), "concepts")).length, 6);
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
    await mkdir(join(memoryRoot, "schemas"), { recursive: true });
    await installReservedMemories(scopeRoot);

    assert.deepEqual(await readAllMemoryFiles(memoryRoot, "schemas"), []);
    const reservedPath = join(reservedMemoryRoot(scopeRoot), "schemas", "concept.yaml");
    const reservedSource = await readFile(reservedPath, "utf8");

    const importedPath = await importReservedMemory(scopeRoot, memoryRoot, "schemas/concept.yaml");
    assert.equal(importedPath, join(memoryRoot, "schemas", "concept.yaml"));

    const files = await readAllMemoryFiles(memoryRoot, "schemas");
    assert.equal(files.length, 1);
    assert.equal(files[0].entity.names[0], "Concept entity schema");
    assert.equal(await readFile(reservedPath, "utf8"), reservedSource);
    const references = (await new DefaultMemoryCatalog(new FileMemoryProvider(memoryRoot)).list()).memories.map(
      (item) => item.reference
    );
    assert(references.includes("concepts/Memory"));
    assert(references.includes("schemas/Concept entity schema"));

    const items = await listReservedMemories(scopeRoot, memoryRoot);
    assert.equal(items.find((item) => item.path === "schemas/concept.yaml")?.imported, true);
  });
});

test("importReservedMemory does not overwrite existing user memory", async () => {
  await withTempDir(async (dir) => {
    const scopeRoot = join(dir, ".memsphere");
    const memoryRoot = join(scopeRoot, "memory");
    await mkdir(join(memoryRoot, "schemas"), { recursive: true });
    await installReservedMemories(scopeRoot);

    await writeFile(
      join(memoryRoot, "schemas", "concept.yaml"),
      "!schema\nnames:\n  - Concept entity schema\ndefines:\n  - User-owned memory wins.\n"
    );

    await assert.rejects(
      importReservedMemory(scopeRoot, memoryRoot, "schemas/concept.yaml"),
      /memory already exists/
    );

    assert.match(
      await readFile(join(memoryRoot, "schemas", "concept.yaml"), "utf8"),
      /User-owned memory wins/
    );
  });
});

test("manifest rejects unsafe, duplicate, overlapping, and unknown values", () => {
  for (const manifest of [
    { version: 1, system_memory: { install: ["../concepts/x.yaml"], remove: [] } },
    { version: 1, system_memory: { install: ["concepts/./x.yaml"], remove: [] } },
    { version: 1, system_memory: { install: ["concepts/x.yaml", "concepts/x.yaml"], remove: [] } },
    { version: 1, system_memory: { install: ["concepts/x.yaml"], remove: ["concepts/x.yaml"] } },
    { version: 1, system_memory: { install: [], remove: [] }, extra: true }
  ]) {
    assert.equal(reservedMemoryManifestSchema.safeParse(manifest).success, false);
  }
});

test("manifest requires install sources to be regular YAML files but allows removed sources to be absent", async () => {
  await withTempDir(async (dir) => {
    const sourceRoot = join(dir, "source");
    await mkdir(join(sourceRoot, "concepts"), { recursive: true });
    await writeManifest(sourceRoot, ["concepts/missing.yaml"], ["concepts/removed.yaml"]);
    await assert.rejects(readReservedMemoryManifest(sourceRoot), /system memory source not found/);

    await symlink(join(sourceRoot, "concepts", "missing-target.yaml"), join(sourceRoot, "concepts", "missing.yaml"));
    await assert.rejects(readReservedMemoryManifest(sourceRoot), /not a regular file/);

    await rm(join(sourceRoot, "concepts", "missing.yaml"));
    await writeFile(join(sourceRoot, "concepts", "missing.yaml"), conceptYaml("System"));
    const manifest = await readReservedMemoryManifest(sourceRoot);
    assert.deepEqual(manifest.system_memory.remove, ["concepts/removed.yaml"]);
  });
});

test("invalid manifest leaves system and reserved memory unchanged", async () => {
  await withTempDir(async (dir) => {
    const sourceRoot = join(dir, "source");
    const scopeRoot = join(dir, ".memsphere");
    const memoryRoot = join(scopeRoot, "memory");
    const systemTarget = join(memoryRoot, "concepts", "old.yaml");
    const reservedTarget = join(reservedMemoryRoot(scopeRoot), "concepts", "marker.yaml");
    await mkdir(join(sourceRoot, "concepts"), { recursive: true });
    await mkdir(join(memoryRoot, "concepts"), { recursive: true });
    await mkdir(join(reservedMemoryRoot(scopeRoot), "concepts"), { recursive: true });
    await writeManifest(sourceRoot, ["concepts/missing.yaml"], ["concepts/old.yaml"]);
    await writeFile(systemTarget, conceptYaml("Old system"));
    await writeFile(reservedTarget, conceptYaml("Reserved marker"));

    await assert.rejects(
      installReservedMemories(scopeRoot, { memoryRoot, sourceRoot }),
      /system memory source not found/
    );
    assert.match(await readFile(systemTarget, "utf8"), /Old system/);
    assert.match(await readFile(reservedTarget, "utf8"), /Reserved marker/);
  });
});

test("target preflight prevents partial removal and symbolic-link installs", async () => {
  await withTempDir(async (dir) => {
    const sourceRoot = join(dir, "source");
    const scopeRoot = join(dir, ".memsphere");
    const memoryRoot = join(scopeRoot, "memory");
    const oldTarget = join(memoryRoot, "concepts", "old.yaml");
    await writeBundledMemory(sourceRoot, "concepts/system.yaml", conceptYaml("System"));
    await writeManifest(sourceRoot, ["concepts/system.yaml"], ["concepts/old.yaml", "concepts/blocked.yaml"]);
    await mkdir(join(memoryRoot, "concepts", "blocked.yaml"), { recursive: true });
    await writeFile(oldTarget, conceptYaml("Old"));

    await assert.rejects(
      installReservedMemories(scopeRoot, { memoryRoot, sourceRoot }),
      /removal target is not a file/
    );
    assert.match(await readFile(oldTarget, "utf8"), /Old/);

    await rm(join(memoryRoot, "concepts", "blocked.yaml"), { recursive: true });
    await writeManifest(sourceRoot, ["concepts/system.yaml"], []);
    const externalTarget = join(dir, "external.yaml");
    await writeFile(externalTarget, conceptYaml("External"));
    await symlink(externalTarget, join(memoryRoot, "concepts", "system.yaml"));
    await assert.rejects(
      installReservedMemories(scopeRoot, { memoryRoot, sourceRoot }),
      /install target is a symbolic link/
    );
    assert.match(await readFile(externalTarget, "utf8"), /External/);
  });
});

test("manifest installs, overwrites, removes, and preserves unrelated memory", async () => {
  await withTempDir(async (dir) => {
    const sourceRoot = join(dir, "source");
    const scopeRoot = join(dir, ".memsphere");
    const memoryRoot = join(scopeRoot, "memory");
    await writeBundledMemory(sourceRoot, "concepts/system.yaml", conceptYaml("System"));
    await writeBundledMemory(sourceRoot, "concepts/manual.yaml", conceptYaml("Manual"));
    await writeManifest(sourceRoot, ["concepts/system.yaml"], ["concepts/old.yaml"]);
    await mkdir(join(memoryRoot, "concepts"), { recursive: true });
    await writeFile(join(memoryRoot, "concepts", "system.yaml"), conceptYaml("Locally edited"));
    await writeFile(join(memoryRoot, "concepts", "old.yaml"), conceptYaml("Old"));
    await writeFile(join(memoryRoot, "concepts", "user.yaml"), conceptYaml("User"));

    const result = await installReservedMemories(scopeRoot, { memoryRoot, sourceRoot });

    assert.deepEqual(result, {
      reservedMemoryRoot: reservedMemoryRoot(scopeRoot),
      installedSystemMemories: 1,
      removedSystemMemories: 1,
      installedReservedMemories: 1
    });
    assert.match(await readFile(join(memoryRoot, "concepts", "system.yaml"), "utf8"), /System/);
    await assert.rejects(readFile(join(memoryRoot, "concepts", "old.yaml")), /ENOENT/);
    assert.match(await readFile(join(memoryRoot, "concepts", "user.yaml"), "utf8"), /User/);
    await assert.rejects(readFile(join(reservedMemoryRoot(scopeRoot), "concepts", "system.yaml")), /ENOENT/);
    assert.match(await readFile(join(reservedMemoryRoot(scopeRoot), "concepts", "manual.yaml"), "utf8"), /Manual/);

    const repeated = await installReservedMemories(scopeRoot, { memoryRoot, sourceRoot });
    assert.equal(repeated.removedSystemMemories, 0);
  });
});

test("manifest can downgrade system memory to reserved memory", async () => {
  await withTempDir(async (dir) => {
    const sourceRoot = join(dir, "source");
    const scopeRoot = join(dir, ".memsphere");
    const memoryRoot = join(scopeRoot, "memory");
    await writeBundledMemory(sourceRoot, "concepts/system.yaml", conceptYaml("System"));
    await writeManifest(sourceRoot, ["concepts/system.yaml"], []);
    await installReservedMemories(scopeRoot, { memoryRoot, sourceRoot });

    await writeManifest(sourceRoot, [], ["concepts/system.yaml"]);
    const result = await installReservedMemories(scopeRoot, { memoryRoot, sourceRoot });

    assert.equal(result.removedSystemMemories, 1);
    await assert.rejects(readFile(join(memoryRoot, "concepts", "system.yaml")), /ENOENT/);
    assert.match(await readFile(join(reservedMemoryRoot(scopeRoot), "concepts", "system.yaml"), "utf8"), /System/);
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

async function writeManifest(sourceRoot: string, install: string[], removePaths: string[]): Promise<void> {
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(
    join(sourceRoot, "manifest.json"),
    `${JSON.stringify({ version: 1, system_memory: { install, remove: removePaths } }, null, 2)}\n`
  );
}

async function writeBundledMemory(sourceRoot: string, relativePath: string, source: string): Promise<void> {
  const path = join(sourceRoot, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source);
}

function conceptYaml(name: string): string {
  return `!concept\nnames:\n  - ${name}\ndefines:\n  - ${name} definition.\n`;
}

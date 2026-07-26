import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { initCommand } from "../src/commands/init.js";
import { DefaultMemoryCatalog } from "../src/memory/catalog.js";
import { FileMemoryProvider } from "../src/memory/file-provider.js";
import { readAllMemoryFiles } from "../src/memory/store.js";
import { currentMemorySyntax } from "../src/memory/syntax.js";
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
    assert.match(basename(file.path), /^memsphere-/);
    assert.equal(file.entity.names.at(-1), basename(file.path, ".yaml"));
    for (const name of file.entity.names) {
      assert.equal(names.has(name), false, `duplicate reserved memory name: ${name}`);
      names.set(name, file.path);
    }
  }

  for (const expected of [
    "Memory",
    "memsphere-memory",
    "Memsphere",
    "memsphere-framework",
    "Concept",
    "memsphere-concept",
    "Statement",
    "memsphere-statement",
    "Schema",
    "memsphere-schema",
    "Procedure",
    "memsphere-procedure",
    "Concept Schema",
    "memsphere-concept-schema",
    "Statement Schema",
    "memsphere-statement-schema",
    "Procedure Schema",
    "memsphere-procedure-schema",
    "Schema Schema",
    "memsphere-schema-schema",
    "memsphere 记忆访问规则",
    "Memory 访问规则",
    "memsphere-memory-access-rules",
    "Memsphere YAML 语法规则",
    "memsphere-yaml-syntax-rules",
    "敏捷需求开发流程",
    "memsphere-agile-requirement-development",
    "memsphere Procedure记忆提取流程",
    "Procedure 提取流程",
    "memsphere-procedure-construction",
    "memsphere 记忆 review 流程",
    "memsphere-review",
    "memsphere tutorial 流程",
    "memsphere-tutorial",
    "memsphere 通用流程",
    "通用流程",
    "兜底流程",
    "memsphere-general-task-execution"
  ]) {
    assert(names.has(expected), `missing reserved memory: ${expected}`);
  }
  for (const removed of [
    "Concept entity schema",
    "Statement entity schema",
    "Procedure entity schema",
    "Schema entity schema",
    "Memory discovery and read rules",
    "Memsphere YAML syntax rules"
  ]) {
    assert.equal(names.has(removed), false, `obsolete reserved memory name: ${removed}`);
  }

  const memory = files.find((file) => file.entity.names.includes("memsphere-memory"));
  assert(memory);
  for (const [conceptName, schemaReference] of [
    ["memsphere-concept", "schemas/Concept Schema"],
    ["memsphere-statement", "schemas/Statement Schema"],
    ["memsphere-procedure", "schemas/Procedure Schema"],
    ["memsphere-schema", "schemas/Schema Schema"]
  ]) {
    const concept = files.find((file) => file.entity.names.includes(conceptName));
    assert(concept?.entity.tag === "!concept");
    assert(concept.entity.defines.some((definition) =>
      typeof definition === "object" &&
      definition.tag === "!ref" &&
      definition.target === schemaReference
    ));
    assert.equal(concept.entity.defines.some((definition) =>
      typeof definition === "object" && definition.tag === "!schema"
    ), false);
  }
  for (const [entitySchemaName, expectedFields] of [
    ["memsphere-concept-schema", ["syntax", "name", "names", "defines", "extends"]],
    ["memsphere-statement-schema", ["syntax", "name", "names", "defines", "asserts", "suggests", "sections"]],
    ["memsphere-procedure-schema", ["syntax", "name", "names", "defines", "asserts", "goals", "flow"]],
    ["memsphere-schema-schema", ["syntax", "name", "names", "defines", "asserts", "suggests", "optional", "type", "format", "fields", "item", "items"]]
  ] as const) {
    const entitySchema = files.find((file) => file.entity.names.includes(entitySchemaName));
    assert(entitySchema?.entity.tag === "!schema");
    const fields = (entitySchema.entity.fields ?? []).map((field) => {
      assert(typeof field === "object" && field.tag === "!schema");
      return { name: field.names[0], optional: field.optional === true };
    });
    assert.deepEqual(fields.map((field) => field.name), expectedFields);
    assert.equal(fields[0]?.optional, false);
    assert(fields.slice(1).every((field) => field.optional));
  }
  assert(files.every((file) => file.entity.syntax === currentMemorySyntax));
  assert(memory.entity.defines.some((definition) => typeof definition === "object" && definition.tag === "!statement"));
  assert.equal(manifest.version, 2);
  assert.equal("memory_syntax" in manifest ? manifest.memory_syntax : undefined, currentMemorySyntax);
  assert.equal(manifest.system_memory.install.length, 16);
  assert.deepEqual(manifest.system_memory.remove, [
    "concepts/memory.yaml",
    "concepts/memsphere.yaml",
    "concepts/concept.yaml",
    "concepts/statement.yaml",
    "concepts/procedure.yaml",
    "concepts/schema.yaml",
    "schemas/concept.yaml",
    "schemas/statement.yaml",
    "schemas/procedure.yaml",
    "schemas/schema.yaml",
    "schemas/concept-entity-schema.yaml",
    "schemas/statement-entity-schema.yaml",
    "schemas/procedure-entity-schema.yaml",
    "schemas/schema-entity-schema.yaml",
    "statements/memory-access-rules.yaml",
    "statements/memory-interpretation-application-rules.yaml",
    "procedures/general-task-execution.yaml",
    "procedures/procedure-construction.yaml",
    "procedures/dialogic-procedure-construction.yaml",
    "procedures/memsphere-review-application.yaml"
  ]);
});

test("init installs system memory and keeps other bundled memory reserved", async () => {
  await withTempDir(async (dir) => {
    await initCommand({ folder: dir });

    const scopeRoot = join(dir, ".memsphere");
    const memoryRoot = join(scopeRoot, "memory");
    const items = await listReservedMemories(scopeRoot, memoryRoot);

    assert(items.some((item) => item.path === "procedures/memsphere-agile-requirement-development.yaml"));
    assert.equal(items.some((item) => item.path === "concepts/memsphere-concept.yaml"), false);
    assert.equal(items.some((item) => item.path === "schemas/memsphere-concept-schema.yaml"), false);
    assert.equal(items.some((item) => item.path === "procedures/memsphere-procedure-construction.yaml"), false);
    assert.equal(items.some((item) => item.path === "procedures/memsphere-review.yaml"), false);
    assert.equal(items.some((item) => item.path === "procedures/memsphere-tutorial.yaml"), false);
    assert(items.length > 0);
    assert(items.every((item) => item.error === undefined));
    assert(items.every((item) => item.imported === false));
    assert.equal((await readAllMemoryFiles(memoryRoot, "concepts")).length, 6);
    const catalog = await new DefaultMemoryCatalog(new FileMemoryProvider(memoryRoot)).list();
    assert(catalog.memories.some((item) => item.reference === "concepts/Memory"));
    assert(catalog.memories.some((item) => item.reference === "procedures/memsphere 通用流程"));
    assert(catalog.memories.some((item) => item.reference === "procedures/memsphere Procedure记忆提取流程"));
    assert(catalog.memories.some((item) => item.reference === "procedures/memsphere 记忆 review 流程"));
    assert(catalog.memories.some((item) => item.reference === "procedures/memsphere tutorial 流程"));
    assert.equal(catalog.memories.some((item) => item.reference === "procedures/敏捷需求开发流程"), false);
    assert(catalog.memories.some((item) => item.reference === "schemas/Concept Schema"));
    assert(catalog.memories.some((item) => item.reference === "schemas/Statement Schema"));
    assert(catalog.memories.some((item) => item.reference === "schemas/Procedure Schema"));
    assert(catalog.memories.some((item) => item.reference === "schemas/Schema Schema"));
  });
});

test("reserved memory install rebuilds managed files", async () => {
  await withTempDir(async (dir) => {
    const scopeRoot = join(dir, ".memsphere");
    await installReservedMemories(scopeRoot);

    const target = join(reservedMemoryRoot(scopeRoot), "procedures", "memsphere-agile-requirement-development.yaml");
    await writeFile(target, "!procedure\nnames: [local reserved]\ndefines: [local edit]\n");
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
    const target = join(reservedMemoryRoot(scopeRoot), "procedures", "memsphere-agile-requirement-development.yaml");
    const stale = join(reservedMemoryRoot(scopeRoot), "concepts", "stale.yaml");
    const systemTarget = join(scopeRoot, "custom-memory", "concepts", "memsphere-concept.yaml");
    await writeFile(target, "!procedure\nnames: [local reserved]\ndefines: [local edit]\n");
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
    await mkdir(join(memoryRoot, "procedures"), { recursive: true });
    await installReservedMemories(scopeRoot);

    const filesBeforeImport = await readAllMemoryFiles(memoryRoot, "procedures");
    const reservedPath = join(reservedMemoryRoot(scopeRoot), "procedures", "memsphere-agile-requirement-development.yaml");
    const reservedSource = await readFile(reservedPath, "utf8");

    const importedPath = await importReservedMemory(scopeRoot, memoryRoot, "procedures/memsphere-agile-requirement-development.yaml");
    assert.equal(importedPath, join(memoryRoot, "procedures", "memsphere-agile-requirement-development.yaml"));

    const files = await readAllMemoryFiles(memoryRoot, "procedures");
    assert.equal(files.length, filesBeforeImport.length + 1);
    assert(files.some((file) => file.entity.names.includes("memsphere-agile-requirement-development")));
    assert.equal(await readFile(reservedPath, "utf8"), reservedSource);
    const references = (await new DefaultMemoryCatalog(new FileMemoryProvider(memoryRoot)).list()).memories.map(
      (item) => item.reference
    );
    assert(references.includes("concepts/Memory"));
    assert(references.includes("procedures/敏捷需求开发流程"));

    const items = await listReservedMemories(scopeRoot, memoryRoot);
    assert.equal(items.find((item) => item.path === "procedures/memsphere-agile-requirement-development.yaml")?.imported, true);
  });
});

test("importReservedMemory does not overwrite existing user memory", async () => {
  await withTempDir(async (dir) => {
    const scopeRoot = join(dir, ".memsphere");
    const memoryRoot = join(scopeRoot, "memory");
    await mkdir(join(memoryRoot, "procedures"), { recursive: true });
    await installReservedMemories(scopeRoot);

    await writeFile(
      join(memoryRoot, "procedures", "memsphere-agile-requirement-development.yaml"),
      "!procedure\nnames:\n  - memsphere-agile-requirement-development\ndefines:\n  - User-owned memory wins.\n"
    );

    await assert.rejects(
      importReservedMemory(scopeRoot, memoryRoot, "procedures/memsphere-agile-requirement-development.yaml"),
      /memory already exists/
    );

    assert.match(
      await readFile(join(memoryRoot, "procedures", "memsphere-agile-requirement-development.yaml"), "utf8"),
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

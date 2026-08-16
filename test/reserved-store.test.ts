import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { readAllMemoryFiles } from "../src/memory/store.js";
import { currentMemorySyntax } from "../src/memory/syntax.js";
import {
  bundledReservedMemoryRoot,
  readReservedMemoryManifest,
  reservedMemoryManifestSchema
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
    "memsphere 记忆 review 处理流程",
    "memsphere-memory-review-process",
    "memsphere 教学流程-第一章",
    "memsphere-tutorial-chapter-01",
    "memsphere 教学流程-第二章",
    "memsphere-tutorial-chapter-02",
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
  assert.equal(manifest.system_memory.install.length, 17);
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
    "procedures/memsphere-review.yaml",
    "procedures/memsphere-review-application.yaml",
    "procedures/memsphere-tutorial.yaml"
  ]);
  const tutorial = await readFile(
    join(bundledReservedMemoryRoot(), "procedures", "memsphere-tutorial-chapter-01.yaml"),
    "utf8"
  );
  assert.match(tutorial, /Project Catalog/);
  assert.doesNotMatch(tutorial, /导入 Reserved Memory|Imported|not imported|了解并导入 Reserved Memory/);
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

async function writeManifest(sourceRoot: string, install: string[], removePaths: string[]): Promise<void> {
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(
    join(sourceRoot, "manifest.json"),
    `${JSON.stringify({ version: 1, system_memory: { install, remove: removePaths } }, null, 2)}\n`
  );
}

function conceptYaml(name: string): string {
  return `!concept\nnames:\n  - ${name}\ndefines:\n  - ${name} definition.\n`;
}

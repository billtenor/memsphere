import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import test from "node:test";
import { readAllMemoryFiles } from "../../../src/memory/store.js";
import { currentMemorySyntax } from "../../../src/memory/syntax.js";
import { bundledReservedMemoryRoot, bundledOfficialMemoryRoot, bundledSystemMemoryRoot, readBundledSystemMemories, readBundledMarketMemories, readReservedMemoryManifest, reservedSystemMemoryRemovalTombstones } from "../../../src/reserved/store.js";


test("bundled memory contains a valid self-bootstrap chain and manifest", async () => {
  const files = (await Promise.all([
    readAllMemoryFiles(bundledSystemMemoryRoot()),
    readAllMemoryFiles(bundledOfficialMemoryRoot())
  ])).flat();
  const manifest = await readReservedMemoryManifest();
  const systemMemories = await readBundledSystemMemories();
  const names = new Map<string, string>();

  for (const file of files) {
    assert.match(basename(file.path), /^(?:memsphere|generic)-/);
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
    "个性化软件",
    "Personalized Software",
    "memsphere-personalized-software",
    "Concept",
    "memsphere-concept",
    "Statement",
    "memsphere-statement",
    "Schema",
    "memsphere-schema",
    "Procedure",
    "memsphere-procedure",
    "Run",
    "memsphere-run",
    "Actor",
    "参与者",
    "memsphere-actor",
    "Artifact Review",
    "产物评审",
    "memsphere-artifact-review",
    "View",
    "memsphere-view",
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
    "memsphere-concept-writing-rules",
    "memsphere-procedure-writing-rules",
    "通用敏捷需求开发流程",
    "generic-agile-requirement-development",
    "通用 bug 修复流程",
    "generic-bug-fix",
    "通用需求管理流程",
    "generic-requirement-management",
    "memsphere Procedure记忆提取流程",
    "Procedure 提取流程",
    "memsphere-procedure-construction",
    "memsphere ChangeSet Comment 处理流程",
    "memsphere-changeset-comment-processing",
    "memsphere 教学流程-第一章",
    "memsphere-tutorial-chapter-01",
    "memsphere 教学流程-第二章",
    "memsphere-tutorial-chapter-02",
    "memsphere 教学流程-第三章",
    "memsphere-tutorial-chapter-03",
    "memsphere 教学流程-第三章评审体验",
    "memsphere-tutorial-chapter-03-review-experience",
    "memsphere-exploration-artifact-rules"
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
  for (const conceptName of [
    "memsphere-concept",
    "memsphere-statement",
    "memsphere-procedure",
    "memsphere-schema"
  ]) {
    const concept = files.find((file) => file.entity.names.includes(conceptName));
    assert(concept?.entity.tag === "!concept");
    assert(concept.entity.defines.every((definition) => typeof definition === "string"));
  }
  for (const [entitySchemaName, expectedFields, requiredFields] of [
    ["memsphere-concept-schema", ["syntax", "name", "names", "defines", "extends"], ["syntax", "defines"]],
    ["memsphere-statement-schema", ["syntax", "name", "names", "defines", "asserts", "suggests", "sections"], ["syntax"]],
    ["memsphere-procedure-schema", ["syntax", "name", "names", "defines", "asserts", "goals", "flow", "mode", "actions"], ["syntax", "defines"]],
    ["memsphere-schema-schema", ["syntax", "name", "names", "defines", "asserts", "suggests", "optional", "type", "format", "fields", "item", "items"], ["syntax"]]
  ] as const) {
    const entitySchema = files.find((file) => file.entity.names.includes(entitySchemaName));
    assert(entitySchema?.entity.tag === "!schema");
    const fields = (entitySchema.entity.fields ?? []).map((field) => {
      assert(typeof field === "object" && field.tag === "!schema");
      return { name: field.names[0], optional: field.optional === true };
    });
    assert.deepEqual(fields.map((field) => field.name), expectedFields);
    assert.deepEqual(fields.filter((field) => !field.optional).map((field) => field.name), requiredFields);
  }
  assert(files.every((file) => file.entity.syntax === currentMemorySyntax));
  assert(files.every((file) => file.entity.defines.every((definition) => typeof definition === "string")));
  assert.equal(manifest.version, 5);
  assert.equal("memory_syntax" in manifest ? manifest.memory_syntax : undefined, currentMemorySyntax);
  assert.equal(manifest.system_memory.install.length, 30);
  assert(manifest.system_memory.install.includes("concepts/memsphere-runner.yaml"));
  assert(manifest.system_memory.install.includes("concepts/memsphere-app.yaml"));
  assert(manifest.system_memory.install.includes("statements/memsphere-app-usage-rules.yaml"));
  assert.deepEqual(systemMemories.map((memory) => memory.path), manifest.system_memory.install);
  assert(systemMemories.every((memory) => memory.sourcePath === join(bundledSystemMemoryRoot(), memory.path)));
  assert(systemMemories.every((memory) => memory.names[0] === basename(memory.path, ".yaml")));
  assert(systemMemories.every((memory) => memory.reference === `${memory.kind}/${memory.names[0]}`));
  assert(systemMemories.every((memory) => memory.names.length > 0));
  assert.equal(reservedSystemMemoryRemovalTombstones(manifest).length, 2);
});


test("bundled Market manifest exposes every complete source", async () => {
  const market = await readBundledMarketMemories();
  assert.deepEqual(market.map((memory) => memory.reference), [
    "procedures/generic-agile-requirement-development",
    "procedures/generic-bug-fix",
    "procedures/generic-code-branch-review-and-remediation",
    "procedures/generic-requirement-management",
    "statements/memsphere-general-requirement-rules",
    "statements/memsphere-general-development-rules",
    "statements/memsphere-general-testing-rules",
    "statements/memsphere-general-delivery-rules"
  ]);
  assert(market.every((memory) => memory.source.length > 0 && memory.digest.length === 64));
  for (const memory of market) {
    assert.equal(memory.sourcePath, join(bundledOfficialMemoryRoot(), memory.path));
    assert.deepEqual(memory.source, await readFile(join(bundledOfficialMemoryRoot(), memory.path)));
  }
  for (const kind of ["concepts", "procedures", "schemas", "statements"]) {
    await assert.rejects(access(join(bundledReservedMemoryRoot(), kind)), /ENOENT/);
  }
});

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { MemsphereConfig } from "../src/config.js";
import { memoryKinds } from "../src/memory/kinds.js";
import { parseMemoryEntity, readAllMemoryFiles } from "../src/memory/store.js";
import {
  currentMemorySyntax,
  firstStableMemorySyntax,
  MemorySyntaxRegistry,
  readMemorySyntax,
  startMemorySyntax
} from "../src/memory/syntax.js";
import { parseMemoryYaml } from "../src/memory/yaml.js";
import {
  checkMemorySyntaxMigration,
  writeMemorySyntaxMigration
} from "../src/migration/memory-syntax.js";
import { canMigrateMemorySyntax } from "../src/migration/memory-syntax-path.js";
import { writeArtifactContractV2Migration } from "../src/migration/artifact-contract-v2.js";
import { writeSchemaContractV2Migration } from "../src/migration/schema-contract-v2.js";
import { assertMigrationSourcesUnchanged } from "../src/migration/store-write.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-syntax-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("Memory syntax defaults to start and formal versions use immutable identifiers", () => {
  assert.equal(readMemorySyntax({ tag: "!concept" }), startMemorySyntax);
  assert.equal(readMemorySyntax({ syntax: currentMemorySyntax }), currentMemorySyntax);
  assert.throws(() => readMemorySyntax({ syntax: 1 }), /must be a string/);
  assert.throws(() => readMemorySyntax({ syntax: "v1" }), /memsphere-YYYYMMDD/);
  assert.throws(() => readMemorySyntax({ syntax: "memsphere-20260230-stable" }), /memsphere-YYYYMMDD/);
});

test("Memory syntax migration availability comes from the migration graph", () => {
  assert.equal(canMigrateMemorySyntax(startMemorySyntax, currentMemorySyntax), true);
  assert.equal(canMigrateMemorySyntax(firstStableMemorySyntax, currentMemorySyntax), true);
  assert.equal(canMigrateMemorySyntax(currentMemorySyntax, currentMemorySyntax), false);
  assert.equal(canMigrateMemorySyntax("memsphere-20990101-stable", currentMemorySyntax), false);
});

test("Memory syntax dispatch accepts registered stable versions and rejects nested syntax fields", () => {
  const current = parseMemoryEntity("concepts", parseMemoryYaml(`!concept
syntax: ${currentMemorySyntax}
name: Current
defines: [Current syntax.]
`));
  assert.equal(current.syntax, currentMemorySyntax);

  const previous = parseMemoryEntity("concepts", parseMemoryYaml(`!concept
syntax: ${firstStableMemorySyntax}
name: Previous
defines: [Previous stable syntax remains executable.]
`));
  assert.equal(previous.syntax, firstStableMemorySyntax);

  assert.throws(() => parseMemoryEntity("concepts", parseMemoryYaml(`!concept
name: Legacy
defines: [Legacy syntax.]
`)), /Unsupported Memory syntax start/);

  assert.throws(() => parseMemoryEntity("concepts", parseMemoryYaml(`!concept
syntax: memsphere-20990101-stable
name: Future
defines: [Future syntax.]
`)), /Unsupported Memory syntax/);

  assert.throws(() => parseMemoryEntity("statements", parseMemoryYaml(`!statement
syntax: ${currentMemorySyntax}
name: Root
sections:
  - !statement
    syntax: ${currentMemorySyntax}
    name: Nested
    asserts: [Nested rule.]
`)), /Unrecognized key.*syntax/);
});

test("current syntax declares Review Slots and rejects removed governance fields", () => {
  const parsed = parseMemoryEntity("procedures", parseMemoryYaml(`!procedure
syntax: ${currentMemorySyntax}
name: governed
flow:
  - !action
    action: Produce an Artifact.
    artifact: !artifact
      name: result
      review: [human_reviewer, agent_reviewer]
`));
  assert.equal(parsed.tag, "!procedure");
  if (parsed.tag !== "!procedure") return;
  const action = parsed.flow[0];
  assert.equal(action.tag, "!action");
  if (action.tag !== "!action") return;
  assert.deepEqual(action.artifact.review, ["human_reviewer", "agent_reviewer"]);

  assert.throws(() => parseMemoryEntity("procedures", parseMemoryYaml(`!procedure
syntax: ${firstStableMemorySyntax}
name: old-governed
role_bindings: { reviewer: human }
flow: []
`)), /Unrecognized key.*role_bindings/);

  assert.throws(() => parseMemoryEntity("procedures", parseMemoryYaml(`!procedure
syntax: ${firstStableMemorySyntax}
name: invalid-old-governance
flow:
  - !action
    action: Produce.
    artifact: !artifact
      name: result
      permission_grants: { runner: [decision.decide] }
`)), /Unrecognized key.*permission_grants/);

  assert.throws(() => parseMemoryEntity("procedures", parseMemoryYaml(`!procedure
syntax: ${currentMemorySyntax}
name: invalid-review
flow:
  - !action
    action: Produce.
    artifact: !artifact
      name: result
      review: reviewer
`)), /Expected array/);

  assert.throws(() => parseMemoryEntity("procedures", parseMemoryYaml(`!procedure
syntax: ${currentMemorySyntax}
name: misplaced
flow:
  - !action
    action: Invalid placement.
    role_bindings: { reviewer: human }
    artifact: !artifact { name: result }
`)), /Unrecognized key.*role_bindings/);

  for (const removed of ["review_role: implementation", "review_requires: [implementation]"]) {
    assert.throws(() => parseMemoryEntity("procedures", parseMemoryYaml(`!procedure
syntax: ${currentMemorySyntax}
name: removed-artifact-review-field
flow:
  - !action
    action: Produce.
    artifact: !artifact
      name: result
      ${removed}
`)), /Unrecognized key.*review_/);
  }

});

test("Memory syntax registries reject duplicate definitions", () => {
  const registry = new MemorySyntaxRegistry();
  const schemas = Object.fromEntries(memoryKinds.map((kind) => [kind, {}])) as never;
  registry.register({ version: startMemorySyntax, schemas });
  assert.throws(() => registry.register({ version: startMemorySyntax, schemas }), /Duplicate/);
  assert.throws(() => registry.require("memsphere-20990101-stable"), /Unsupported Memory syntax/);
});

test("Memory syntax migration upgrades start atomically and is idempotent", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    for (const kind of memoryKinds) await mkdir(join(memoryRoot, kind), { recursive: true });
    const path = join(memoryRoot, "concepts", "Legacy.yaml");
    await writeFile(path, `!concept
name: Legacy
defines: [Legacy syntax.]
`);
    const config: MemsphereConfig = {
      configPath: join(dir, "config.json"),
      scopeRoot: dir,
      memoryRoot,
      reviewsRoot: join(dir, "reviews"),
      runsRoot: join(dir, "runs"),
      archiveRoot: join(dir, "archives"),
      view: { host: "127.0.0.1", port: 0 }
    };

    const checked = await checkMemorySyntaxMigration(config);
    assert.equal(checked.manifest.status, "ready");
    assert.equal(checked.manifest.files[0].from, startMemorySyntax);
    assert.equal(checked.manifest.files[0].to, currentMemorySyntax);
    assert.equal(checked.manifest.files[0].changed, true);

    const written = await writeMemorySyntaxMigration(config);
    assert(written.backupRoot);
    assert.match(await readFile(path, "utf8"), new RegExp(`^!concept\\nsyntax: ${currentMemorySyntax}\\n`));
    assert.match(await readFile(join(written.backupRoot, "concepts", "Legacy.yaml"), "utf8"), /^!concept\nname:/);

    const second = await checkMemorySyntaxMigration(config);
    assert.equal(second.manifest.status, "ready");
    assert(second.manifest.files.every((file) => file.changed === false));
  });
});

test("Memory syntax migration composes legacy Artifact and Schema contract upgrades", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    for (const kind of memoryKinds) await mkdir(join(memoryRoot, kind), { recursive: true });
    const procedurePath = join(memoryRoot, "procedures", "legacy.yaml");
    const schemaPath = join(memoryRoot, "schemas", "rows.yaml");
    await writeFile(procedurePath, `!procedure
names: [legacy]
flow:
  - !action
    action: Produce a result.
    artifact: !artifact
      name: result
      format: string
  - !action
    action: Produce rows.
    artifact: !artifact
      name: rows
      format: schema
      schema: rows
`);
    await writeFile(schemaPath, `!schema
names: [rows]
format: table
fields: [ID, Summary]
element_types: [Schema]
`);
    const config: MemsphereConfig = {
      configPath: join(dir, "config.json"), scopeRoot: dir, memoryRoot,
      reviewsRoot: join(dir, "reviews"), runsRoot: join(dir, "runs"), archiveRoot: join(dir, "archives"),
      view: { host: "127.0.0.1", port: 0 }
    };

    const checked = await checkMemorySyntaxMigration(config);
    assert.equal(checked.manifest.status, "ready", JSON.stringify(checked.manifest.issues));
    const outputs = new Map(checked.prepared.map((file) => [file.path, file.output]));
    const procedureOutput = outputs.get("procedures/legacy.yaml") ?? "";
    assert.doesNotMatch(procedureOutput, /format: string/);
    assert.match(procedureOutput, /layout: table/);
    assert.doesNotMatch(outputs.get("schemas/rows.yaml") ?? "", /element_types/);
    assert.match(outputs.get("schemas/rows.yaml") ?? "", /type: array/);

    await writeMemorySyntaxMigration(config);
    for (const file of await readAllMemoryFiles(memoryRoot)) {
      assert.equal(file.entity.syntax, currentMemorySyntax);
    }
  });
});

test("Memory syntax migration leaves stable files out of legacy contract migration", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    for (const kind of memoryKinds) await mkdir(join(memoryRoot, kind), { recursive: true });
    await writeFile(join(memoryRoot, "concepts", "legacy.yaml"), `!concept
name: Legacy
defines: [Legacy syntax.]
`);
    const schemaPath = join(memoryRoot, "schemas", "stable-rows.yaml");
    const schemaSource = `!schema
syntax: ${currentMemorySyntax}
name: stable-rows
type: array
format: { name: markdown, layout: table }
item: !schema
  type: object
  fields: [ID, Summary]
`;
    const procedurePath = join(memoryRoot, "procedures", "stable.yaml");
    const procedureSource = `!procedure
syntax: ${currentMemorySyntax}
name: stable-procedure
flow:
  - !action
    action: Produce rows.
    artifact: !artifact
      name: rows
      type: array
      format: { name: markdown, layout: table }
      schema: stable-rows
`;
    await writeFile(schemaPath, schemaSource);
    await writeFile(procedurePath, procedureSource);
    const config: MemsphereConfig = {
      configPath: join(dir, "config.json"), scopeRoot: dir, memoryRoot,
      reviewsRoot: join(dir, "reviews"), runsRoot: join(dir, "runs"), archiveRoot: join(dir, "archives"),
      view: { host: "127.0.0.1", port: 0 }
    };

    const checked = await checkMemorySyntaxMigration(config);
    assert.equal(checked.manifest.status, "ready", JSON.stringify(checked.manifest.issues));
    const outputs = new Map(checked.prepared.map((file) => [file.path, file]));
    assert.equal(outputs.get("schemas/stable-rows.yaml")?.changed, false);
    assert.equal(outputs.get("schemas/stable-rows.yaml")?.output, schemaSource);
    assert.equal(outputs.get("procedures/stable.yaml")?.changed, false);
    assert.equal(outputs.get("procedures/stable.yaml")?.output, procedureSource);
  });
});

test("Memory syntax migration rejects an unregistered target in an empty store", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    for (const kind of memoryKinds) await mkdir(join(memoryRoot, kind), { recursive: true });
    const config: MemsphereConfig = {
      configPath: join(dir, "config.json"), scopeRoot: dir, memoryRoot,
      reviewsRoot: join(dir, "reviews"), runsRoot: join(dir, "runs"), archiveRoot: join(dir, "archives"),
      view: { host: "127.0.0.1", port: 0 }
    };
    await assert.rejects(
      checkMemorySyntaxMigration(config, "memsphere-20990101-stable"),
      /Unsupported Memory syntax/
    );
  });
});

test("Memory migration writers share one store lock", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    for (const kind of memoryKinds) await mkdir(join(memoryRoot, kind), { recursive: true });
    const config: MemsphereConfig = {
      configPath: join(dir, "config.json"), scopeRoot: dir, memoryRoot,
      reviewsRoot: join(dir, "reviews"), runsRoot: join(dir, "runs"), archiveRoot: join(dir, "archives"),
      view: { host: "127.0.0.1", port: 0 }
    };
    const lockPath = join(dir, "migrations", "memory-store.lock");
    await mkdir(join(dir, "migrations"), { recursive: true });
    await writeFile(lockPath, "held");

    await assert.rejects(writeMemorySyntaxMigration(config), /Another Memory migration/);
    await assert.rejects(writeArtifactContractV2Migration(config), /Another Memory migration/);
    await assert.rejects(writeSchemaContractV2Migration(config), /Another Memory migration/);
  });
});

test("Migration source hashes detect edits made after preparation", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    for (const kind of memoryKinds) await mkdir(join(memoryRoot, kind), { recursive: true });
    const path = join(memoryRoot, "concepts", "legacy.yaml");
    await writeFile(path, `!concept\nname: Legacy\ndefines: [Legacy syntax.]\n`);
    const config: MemsphereConfig = {
      configPath: join(dir, "config.json"), scopeRoot: dir, memoryRoot,
      reviewsRoot: join(dir, "reviews"), runsRoot: join(dir, "runs"), archiveRoot: join(dir, "archives"),
      view: { host: "127.0.0.1", port: 0 }
    };
    const checked = await checkMemorySyntaxMigration(config);
    await writeFile(path, `!concept\nname: Edited\ndefines: [Edited concurrently.]\n`);
    await assert.rejects(assertMigrationSourcesUnchanged(checked.prepared), /Memory changed while migration/);
  });
});

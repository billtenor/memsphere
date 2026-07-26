import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { MemsphereConfig } from "../src/config.js";
import { procedureMemorySchema, schemaMemorySchema } from "../src/memory/schema.js";
import { currentMemorySyntax } from "../src/memory/syntax.js";
import { parseMemoryYaml } from "../src/memory/yaml.js";
import {
  checkSchemaContractV2Migration,
  writeSchemaContractV2Migration
} from "../src/migration/schema-contract-v2.js";

async function withScope(fn: (config: MemsphereConfig) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "memsphere-schema-v2-"));
  const memoryRoot = join(root, "memory");
  for (const kind of ["procedures", "concepts", "statements", "schemas"]) {
    await mkdir(join(memoryRoot, kind), { recursive: true });
  }
  const config: MemsphereConfig = {
    configPath: join(root, "config.json"),
    scopeRoot: root,
    memoryRoot,
    reviewsRoot: join(root, "reviews"),
    runsRoot: join(root, "runs"),
    archiveRoot: join(root, "archives"),
    view: { host: "127.0.0.1", port: 0 }
  };
  try {
    await fn(config);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("Schema Contract v2 migration stages, backs up, and removes contextual element_types", async () => {
  await withScope(async (config) => {
    const path = join(config.memoryRoot, "procedures", "rows.yaml");
    await writeFile(path, `!procedure
names: [rows]
flow:
  - !action
    action: Produce rows.
    artifact: !artifact
      name: rows
      type: array
      format: json
      schema: !schema
        element_types: [Schema]
        fields: [ID]
`);

    const checked = await checkSchemaContractV2Migration(config);
    assert.equal(checked.manifest.status, "ready", JSON.stringify(checked.manifest.issues));
    assert.equal(checked.manifest.files.find((file) => file.path === "procedures/rows.yaml")?.changed, true);
    assert.doesNotMatch(checked.prepared[0]?.output ?? "", /element_types/);
    const migrated = procedureMemorySchema.parse({
      ...(parseMemoryYaml(checked.prepared[0]?.output ?? "") as Record<string, unknown>),
      syntax: currentMemorySyntax
    });
    const action = migrated.flow[0];
    assert.equal(action?.tag, "!action");
    if (action?.tag === "!action" && typeof action.artifact.schema === "object") {
      assert.equal(action.artifact.schema.type, "array");
      assert.equal(action.artifact.schema.item?.type, "object");
      assert.deepEqual(action.artifact.schema.item?.fields, ["ID"]);
    }

    const written = await writeSchemaContractV2Migration(config);
    assert(written.backupRoot);
    assert.match(await readFile(path, "utf8"), /type: array/);
    assert.match(await readFile(join(written.backupRoot ?? "", "procedures", "rows.yaml"), "utf8"), /element_types/);

    const repeated = await checkSchemaContractV2Migration(config);
    assert.equal(repeated.manifest.status, "ready");
    assert.equal(repeated.manifest.files.every((file) => !file.changed), true);
  });
});

test("Schema Contract v2 migration converts legacy table format", async () => {
  await withScope(async (config) => {
    await writeFile(join(config.memoryRoot, "schemas", "rows.yaml"), `!schema
names: [rows]
format: table
fields: [ID, Summary]
element_types: [Schema]
`);
    const checked = await checkSchemaContractV2Migration(config);
    assert.equal(checked.manifest.status, "ready", JSON.stringify(checked.manifest.issues));
    const output = checked.prepared[0]?.output ?? "";
    assert.match(output, /type: array/);
    assert.match(output, /name: markdown/);
    assert.match(output, /layout: table/);
    assert.doesNotMatch(output, /element_types/);
  });
});

test("Schema Contract v2 migration moves direct array fields into an object item", async () => {
  await withScope(async (config) => {
    const path = join(config.memoryRoot, "schemas", "rows.yaml");
    await writeFile(path, `!schema
names: [rows]
type: array
format: json
fields: [ID, Summary]
`);
    const checked = await checkSchemaContractV2Migration(config);
    assert.equal(checked.manifest.status, "ready", JSON.stringify(checked.manifest.issues));
    const output = checked.prepared[0]?.output ?? "";
    assert.match(output, /item: !schema/);
    assert.match(output, /type: object/);
    const migrated = schemaMemorySchema.parse({
      ...(parseMemoryYaml(output) as Record<string, unknown>),
      syntax: currentMemorySyntax
    });
    assert.deepEqual(migrated.item?.fields, ["ID", "Summary"]);
    await writeFile(path, output);
    const repeated = await checkSchemaContractV2Migration(config);
    assert.equal(repeated.manifest.status, "ready");
    assert.equal(repeated.manifest.files[0]?.changed, false);
  });
});

test("Schema Contract v2 migration converts primitive, union, and legacy items member contracts", async () => {
  await withScope(async (config) => {
    await writeFile(join(config.memoryRoot, "schemas", "union.yaml"), `!schema
names: [union]
type: array
format: json
element_types: [string, Schema]
fields: [ID]
`);
    await writeFile(join(config.memoryRoot, "schemas", "primitive.yaml"), `!schema
names: [primitive]
type: array
format: json
element_types: [string]
`);
    await writeFile(join(config.memoryRoot, "schemas", "legacy-items.yaml"), `!schema
names: [legacy-items]
type: array
format: yaml
items: [string, number]
`);
    const checked = await checkSchemaContractV2Migration(config);
    assert.equal(checked.manifest.status, "ready", JSON.stringify(checked.manifest.issues));
    const outputs = new Map(checked.prepared.map((file) => [file.path, file.output]));
    assert.match(outputs.get("schemas/primitive.yaml") ?? "", /item: !schema/);
    assert.match(outputs.get("schemas/union.yaml") ?? "", /items:/);
    assert.match(outputs.get("schemas/union.yaml") ?? "", /fields:/);
    assert.match(outputs.get("schemas/legacy-items.yaml") ?? "", /items:/);
    assert.doesNotMatch(outputs.get("schemas/legacy-items.yaml") ?? "", /items: \[string, number\]/);
  });
});

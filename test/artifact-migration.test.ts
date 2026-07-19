import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { MemsphereConfig } from "../src/config.js";
import {
  checkArtifactContractV2Migration,
  writeArtifactContractV2Migration
} from "../src/migration/artifact-contract-v2.js";
import { readMemoryFile } from "../src/memory/store.js";

test("Artifact Contract v2 migration stages, backs up, validates, and is idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-artifact-v2-"));
  const scopeRoot = join(root, ".memsphere");
  const memoryRoot = join(scopeRoot, "memory");
  const runsRoot = join(scopeRoot, "runs");
  for (const kind of ["procedures", "concepts", "statements", "schemas"]) await mkdir(join(memoryRoot, kind), { recursive: true });
  await mkdir(runsRoot, { recursive: true });
  const procedurePath = join(memoryRoot, "procedures", "demo.yaml");
  await writeFile(procedurePath, `!procedure
names: [demo]
goals: []
flow:
  - !action
    action: write result
    artifact: !artifact
      name: result
      format: string
`);
  const config: MemsphereConfig = {
    configPath: join(scopeRoot, "config.json"),
    scopeRoot,
    memoryRoot,
    reviewsRoot: join(scopeRoot, "reviews"),
    runsRoot,
    archiveRoot: join(scopeRoot, "archives"),
    view: { host: "127.0.0.1", port: 0 }
  };

  const checked = await checkArtifactContractV2Migration(config, { includeRuns: false });
  assert.equal(checked.manifest.status, "ready");
  assert.equal(checked.manifest.files[0]?.changed, true);

  const written = await writeArtifactContractV2Migration(config);
  assert(written.backupRoot);
  const migrated = await readFile(procedurePath, "utf8");
  assert.doesNotMatch(migrated, /type: string/);
  assert.doesNotMatch(migrated, /format: string/);
  const memory = await readMemoryFile("procedures", procedurePath);
  const step = memory.entity.tag === "!procedure" ? memory.entity.flow[0] : undefined;
  assert.equal(step?.tag === "!action" ? step.artifact.type : undefined, "string");

  const second = await checkArtifactContractV2Migration(config, { includeRuns: false });
  assert.equal(second.manifest.status, "ready");
  assert.equal(second.manifest.files[0]?.changed, false);
});

test("Artifact Contract v2 migration blocks ambiguous YAML type", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-artifact-v2-blocked-"));
  const scopeRoot = join(root, ".memsphere");
  const memoryRoot = join(scopeRoot, "memory");
  for (const kind of ["procedures", "concepts", "statements", "schemas"]) await mkdir(join(memoryRoot, kind), { recursive: true });
  await writeFile(join(memoryRoot, "procedures", "demo.yaml"), `!procedure
names: [demo]
goals: []
flow:
  - !action
    action: write result
    artifact: !artifact
      name: result
      format: yaml
`);
  const config: MemsphereConfig = {
    configPath: join(scopeRoot, "config.json"), scopeRoot, memoryRoot,
    reviewsRoot: join(scopeRoot, "reviews"), runsRoot: join(scopeRoot, "runs"), archiveRoot: join(scopeRoot, "archives"),
    view: { host: "127.0.0.1", port: 0 }
  };
  const result = await checkArtifactContractV2Migration(config, { includeRuns: false });
  assert.equal(result.manifest.status, "blocked");
  assert.equal(result.manifest.issues[0]?.code, "migration.artifact.structured_type_required");
});

test("Artifact Contract v2 check rejects prepared output that still uses removed Schema fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-artifact-v2-invalid-output-"));
  const memoryRoot = join(root, "memory");
  for (const kind of ["procedures", "concepts", "statements", "schemas"]) {
    await mkdir(join(memoryRoot, kind), { recursive: true });
  }
  await writeFile(join(memoryRoot, "concepts", "legacy.yaml"), `!concept
names: [legacy]
defines:
  - !schema
    element_types: [string]
`);
  const config: MemsphereConfig = {
    configPath: join(root, "config.json"), scopeRoot: root, memoryRoot,
    reviewsRoot: join(root, "reviews"), runsRoot: join(root, "runs"), archiveRoot: join(root, "archives"),
    view: { host: "127.0.0.1", port: 0 }
  };

  const result = await checkArtifactContractV2Migration(config, { includeRuns: false });
  assert.equal(result.manifest.status, "blocked");
  assert(result.manifest.issues.some((issue) =>
    issue.code === "migration.output.invalid" && issue.file === "concepts/legacy.yaml" && issue.path === "defines.0"
  ));
});

test("Artifact Contract v2 migration resolves external Schema consumers across files", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-artifact-v2-external-"));
  const scopeRoot = join(root, ".memsphere");
  const memoryRoot = join(scopeRoot, "memory");
  for (const kind of ["procedures", "concepts", "statements", "schemas"]) await mkdir(join(memoryRoot, kind), { recursive: true });
  const procedurePath = join(memoryRoot, "procedures", "demo.yaml");
  const schemaPath = join(memoryRoot, "schemas", "delivery.yaml");
  await writeFile(procedurePath, `!procedure
names: [demo]
flow:
  - !action
    action: write delivery
    artifact: !artifact
      name: delivery
      format: schema
      schema: delivery-schema
`);
  await writeFile(schemaPath, `!schema
names: [delivery-schema]
format: outline
fields: [summary]
`);
  const config: MemsphereConfig = {
    configPath: join(scopeRoot, "config.json"), scopeRoot, memoryRoot,
    reviewsRoot: join(scopeRoot, "reviews"), runsRoot: join(scopeRoot, "runs"), archiveRoot: join(scopeRoot, "archives"),
    view: { host: "127.0.0.1", port: 0 }
  };

  const checked = await checkArtifactContractV2Migration(config, { includeRuns: false });
  assert.equal(checked.manifest.status, "ready");
  assert.equal(checked.manifest.files.filter((file) => file.changed).length, 2);
  await writeArtifactContractV2Migration(config);
  const procedure = await readFile(procedurePath, "utf8");
  const schema = await readFile(schemaPath, "utf8");
  assert.match(procedure, /type: object/);
  assert.match(procedure, /name: markdown/);
  assert.match(procedure, /layout: outline/);
  assert.doesNotMatch(schema, /format:/);
  await readMemoryFile("procedures", procedurePath);
  await readMemoryFile("schemas", schemaPath);
});

test("Artifact Contract v2 migration leaves v2 source bytes unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-artifact-v2-noop-"));
  const memoryRoot = join(root, "memory");
  for (const kind of ["procedures", "concepts", "statements", "schemas"]) await mkdir(join(memoryRoot, kind), { recursive: true });
  const path = join(memoryRoot, "procedures", "demo.yaml");
  const source = "!procedure\nnames: [demo]\nflow:\n  - !action\n    action: write result\n    artifact: !artifact\n      name: result\n      type: string\n";
  await writeFile(path, source);
  const config: MemsphereConfig = {
    configPath: join(root, "config.json"), scopeRoot: root, memoryRoot,
    reviewsRoot: join(root, "reviews"), runsRoot: join(root, "runs"), archiveRoot: join(root, "archives"),
    view: { host: "127.0.0.1", port: 0 }
  };
  const checked = await checkArtifactContractV2Migration(config, { includeRuns: false });
  assert.equal(checked.manifest.files[0]?.changed, false);
  assert.equal(checked.prepared[0]?.output, source);
});

test("Artifact Contract v2 migration blocks running v1 Runs", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-artifact-v2-running-"));
  const memoryRoot = join(root, "memory");
  const runsRoot = join(root, "runs");
  for (const kind of ["procedures", "concepts", "statements", "schemas"]) await mkdir(join(memoryRoot, kind), { recursive: true });
  await mkdir(runsRoot);
  await writeFile(join(runsRoot, "run-v1.json"), `${JSON.stringify({
    id: "run-v1", status: "running", procedureName: "legacy", memoryRoot,
    createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
    stack: [], events: []
  })}\n`);
  const config: MemsphereConfig = {
    configPath: join(root, "config.json"), scopeRoot: root, memoryRoot,
    reviewsRoot: join(root, "reviews"), runsRoot, archiveRoot: join(root, "archives"),
    view: { host: "127.0.0.1", port: 0 }
  };
  const checked = await checkArtifactContractV2Migration(config);
  assert.equal(checked.manifest.status, "blocked");
  assert(checked.manifest.issues.some((issue) => issue.code === "migration.artifact.running_v1_run"));
});

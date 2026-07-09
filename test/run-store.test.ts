import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { memoryKinds } from "../src/memory/kinds.js";
import { artifactSchemaName, enterSchema, readRun, reportRun, startRun } from "../src/run/store.js";
import { validateMemoryStore } from "../src/validation.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-test-"));

  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const validProcedure = `!procedure
names: [target-procedure]
flow:
  - action: Capture result.
    artifact:
      name: result
      format: string
`;

const invalidProcedure = `!procedure
names: [unrelated-invalid-procedure]
flow:
  - legacy string step
`;

test("startRun skips unrelated invalid procedures when resolving the target procedure", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });

    await writeFile(join(proceduresRoot, "a-invalid.yaml"), invalidProcedure);
    await writeFile(join(proceduresRoot, "z-target.yaml"), validProcedure);

    const run = await startRun({ memoryRoot, runsRoot, procedureName: "target-procedure" });

    assert.equal(run.status, "running");
    assert.equal(run.procedureName, "target-procedure");
    assert.equal(run.stack[0].memoryName, "target-procedure");
    assert.equal(run.stack[0].steps[0].instruction, "Capture result.");
  });
});

test("validateMemoryStore still reports unrelated invalid procedures", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "config.json");
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const invalidPath = join(proceduresRoot, "a-invalid.yaml");
    await mkdir(memoryRoot);
    await mkdir(join(dir, "reviews"));
    await mkdir(join(dir, "runs"));

    for (const kind of memoryKinds) {
      await mkdir(join(memoryRoot, kind));
    }

    await writeFile(invalidPath, invalidProcedure);
    await writeFile(join(proceduresRoot, "z-target.yaml"), validProcedure);
    await writeFile(configPath, `${JSON.stringify({ memoryRoot: "memory", reviewsRoot: "reviews", runsRoot: "runs" })}\n`);

    const result = await validateMemoryStore(configPath);

    assert(result.issues.some((issue) =>
      issue.path === invalidPath &&
      issue.message.includes("flow.0")
    ));
  });
});

test("startRun writes run state inside the run root directory", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "target.yaml"), validProcedure);

    const run = await startRun({ memoryRoot, runsRoot, procedureName: "target-procedure" });
    const raw = await readFile(join(runsRoot, run.id, `${run.id}.json`), "utf8");
    const persisted = JSON.parse(raw);

    assert.equal(persisted.id, run.id);
    assert.equal((await readRun(runsRoot, run.id)).id, run.id);
  });
});

test("readRun still accepts legacy root-level run JSON files", async () => {
  await withTempDir(async (dir) => {
    const runsRoot = join(dir, "runs");
    await mkdir(runsRoot);
    await writeFile(join(runsRoot, "run-legacy-layout.json"), `${JSON.stringify({
      id: "run-legacy-layout",
      status: "done",
      procedureName: "legacy",
      memoryRoot: join(dir, "memory"),
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T00:00:00.000Z",
      stack: [],
      events: []
    }, null, 2)}\n`);

    const run = await readRun(runsRoot, "run-legacy-layout");
    assert.equal(run.id, "run-legacy-layout");
  });
});

test("reportRun stores markdown artifacts as managed files", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });

    await writeFile(join(proceduresRoot, "target.yaml"), `!procedure
names: [target-procedure]
flow:
  - action: Capture markdown.
    artifact:
      name: markdown result
      format: markdown
`);

    const run = await startRun({ memoryRoot, runsRoot, procedureName: "target-procedure" });
    const updated = await reportRun({
      runsRoot,
      runId: run.id,
      artifact: { kind: "inline", value: "# Result\n" }
    });

    const artifact = updated.events[0].artifact;
    assert.equal(artifact.storage, "file");
    assert.equal(artifact.format, "markdown");
    assert.match(artifact.path ?? "", new RegExp(`^${run.id}/artifacts/`));
    assert.equal(await readFile(join(runsRoot, artifact.path ?? ""), "utf8"), "# Result\n");
  });
});

test("reportRun stores schema artifacts with fields and .schema.md extension", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });

    await writeFile(join(proceduresRoot, "target.yaml"), `!procedure
names: [target-procedure]
flow:
  - action: Capture schema.
    artifact:
      name: schema result
      format: schema
      schema: demo-schema
`);

    const run = await startRun({ memoryRoot, runsRoot, procedureName: "target-procedure" });
    const updated = await reportRun({
      runsRoot,
      runId: run.id,
      artifact: { kind: "inline", value: "schema content\n" }
    });

    const artifact = updated.events[0].artifact;
    assert.equal(artifact.storage, "file");
    assert.equal(artifactSchemaName(artifact), "demo-schema");
    assert.equal(artifact.schemaName, undefined);
    assert.match(artifact.fileName ?? "", /\.schema\.md$/);
    assert.equal(await readFile(join(runsRoot, artifact.path ?? ""), "utf8"), "schema content\n");
  });
});

test("completed schema flows store the parent schema artifact as a managed file", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const schemasRoot = join(memoryRoot, "schemas");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await mkdir(schemasRoot, { recursive: true });

    await writeFile(join(proceduresRoot, "target.yaml"), `!procedure
names: [target-procedure]
flow:
  - action: Capture schema.
    artifact:
      name: schema result
      format: schema
      schema: demo-schema
`);
    await writeFile(join(schemasRoot, "demo.yaml"), `!schema
names: [demo-schema]
defines:
  - Demo schema.
`);

    const run = await startRun({ memoryRoot, runsRoot, procedureName: "target-procedure" });
    await enterSchema({ memoryRoot, runsRoot, runId: run.id, schemaName: "demo-schema" });
    const updated = await reportRun({
      runsRoot,
      runId: run.id,
      artifact: { kind: "inline", value: "schema field value" }
    });

    const artifact = updated.events.at(-1)?.artifact;
    assert.equal(artifact?.name, "schema result");
    assert.equal(artifact?.storage, "file");
    assert.equal(artifactSchemaName(artifact), "demo-schema");
    assert.match(artifact?.fileName ?? "", /\.schema\.md$/);
    assert.equal(await readFile(join(runsRoot, artifact?.path ?? ""), "utf8"), "schema:demo-schema");
  });
});

test("reportRun copies file sources into the managed artifacts directory", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    const sourcePath = join(dir, "external.md");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(sourcePath, "external content\n");

    await writeFile(join(proceduresRoot, "target.yaml"), `!procedure
names: [target-procedure]
flow:
  - action: Capture markdown.
    artifact:
      name: markdown result
      format: markdown
`);

    const run = await startRun({ memoryRoot, runsRoot, procedureName: "target-procedure" });
    const updated = await reportRun({
      runsRoot,
      runId: run.id,
      artifact: { kind: "file", path: sourcePath }
    });

    const artifact = updated.events[0].artifact;
    assert.equal(artifact.storage, "file");
    assert.notEqual(artifact.path, sourcePath);
    assert.match(artifact.path ?? "", new RegExp(`^${run.id}/artifacts/`));
    assert.equal(await readFile(join(runsRoot, artifact.path ?? ""), "utf8"), "external content\n");
  });
});

test("boolean artifacts remain inline and continue to drive branches", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });

    await writeFile(join(proceduresRoot, "target.yaml"), `!procedure
names: [target-procedure]
flow:
  - !if
    condition:
      action: Choose path.
      artifact:
        name: choose
        format: boolean
    then:
      - action: Capture true path.
        artifact:
          name: true result
          format: string
    else:
      - action: Capture false path.
        artifact:
          name: false result
          format: string
`);

    const run = await startRun({ memoryRoot, runsRoot, procedureName: "target-procedure" });
    const updated = await reportRun({
      runsRoot,
      runId: run.id,
      artifact: { kind: "inline", value: "true" }
    });

    assert.equal(updated.events[0].artifact.storage, "inline");
    assert.equal(updated.events[0].artifact.value, "true");
    assert.equal(updated.stack[0].steps[updated.stack[0].index].artifact, "true result");
  });
});

test("readRun accepts legacy artifact value and schemaName fields", async () => {
  await withTempDir(async (dir) => {
    const runsRoot = join(dir, "runs");
    await mkdir(runsRoot);
    await writeFile(join(runsRoot, "run-legacy.json"), `${JSON.stringify({
      id: "run-legacy",
      status: "done",
      procedureName: "legacy",
      memoryRoot: join(dir, "memory"),
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T00:00:00.000Z",
      stack: [],
      events: [{
        at: "2026-07-08T00:00:00.000Z",
        frame: "procedure",
        stepId: "flow[1]",
        artifact: {
          name: "legacy schema",
          format: "schema",
          schemaName: "legacy-schema",
          value: "legacy value"
        }
      }]
    }, null, 2)}\n`);

    const run = await readRun(runsRoot, "run-legacy");
    assert.equal(run.events[0].artifact.value, "legacy value");
    assert.equal(artifactSchemaName(run.events[0].artifact), "legacy-schema");
  });
});

test("missing file sources do not append partial events", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });

    await writeFile(join(proceduresRoot, "target.yaml"), `!procedure
names: [target-procedure]
flow:
  - action: Capture markdown.
    artifact:
      name: markdown result
      format: markdown
`);

    const run = await startRun({ memoryRoot, runsRoot, procedureName: "target-procedure" });
    await assert.rejects(
      reportRun({
        runsRoot,
        runId: run.id,
        artifact: { kind: "file", path: join(dir, "missing.md") }
      }),
      /ENOENT/
    );

    const unchanged = await readRun(runsRoot, run.id);
    assert.equal(unchanged.events.length, 0);
  });
});

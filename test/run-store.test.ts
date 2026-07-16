import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { memoryKinds } from "../src/memory/kinds.js";
import { activeProcedureAsserts, artifactSchemaName, enterSchema, finalArtifacts, readRun, reportRun, startRun } from "../src/run/store.js";
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
asserts:
  - Keep the procedure contract active.
flow:
  - !action
    action: Capture result.
    artifact: !artifact
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
    assert.deepEqual(run.asserts, ["Keep the procedure contract active."]);
    assert.equal(run.stack[0].memoryName, "target-procedure");
    assert.deepEqual(run.stack[0].asserts, ["Keep the procedure contract active."]);
    assert.deepEqual(activeProcedureAsserts(run), ["Keep the procedure contract active."]);
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
  - !action
    action: Capture markdown.
    artifact: !artifact
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
  - !action
    action: Capture schema.
    artifact: !artifact
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

test("inline schema contracts are snapshotted, enter without a name, and persist final artifacts", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    const procedurePath = join(proceduresRoot, "inline.yaml");
    await writeFile(procedurePath, `!procedure
names: [inline-contract]
flow:
  - !action
    action: Produce delivery.
    asserts: [Keep every required field.]
    suggests: [Prefer short prose.]
    artifact: !artifact
      name: delivery
      format: schema
      final: true
      schema: !schema
        format: outline
        fields: [summary]
`);

    const started = await startRun({ memoryRoot, runsRoot, procedureName: "inline-contract" });
    const step = started.stack[0].steps[0];
    assert.deepEqual(step.asserts, ["Keep every required field."]);
    assert.deepEqual(step.suggests, ["Prefer short prose."]);
    assert(step.inlineSchema);
    assert(step.inlineSchemaId?.startsWith("inline:flow[1]:delivery"));
    await writeFile(procedurePath, validProcedure);

    const entered = await enterSchema({ memoryRoot, runsRoot, runId: started.id });
    assert.equal(entered.stack.at(-1)?.memoryName, step.inlineSchemaId);
    assert.equal(entered.stack.at(-1)?.steps[0]?.artifact, step.inlineSchemaId);
    await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "# Delivery\n" } });
    const done = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "finished" } });
    assert.equal(done.status, "done");
    assert.equal(finalArtifacts(done).length, 1);
    const delivery = finalArtifacts(done)[0];
    assert.equal(delivery.schemaKind, "inline");
    assert.equal(delivery.final, true);
    assert.match(delivery.path ?? "", /\.schema\.md$/);
    assert.equal(await readFile(join(runsRoot, delivery.path ?? ""), "utf8"), `schema:${step.inlineSchemaId}`);
  });
});

test("final artifacts only include the executed branch", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "branch.yaml"), `!procedure
names: [branch-final]
flow:
  - !if
    condition: !action
      action: Choose path.
      artifact: !artifact
        name: choose
        format: boolean
    then:
      - !action
        action: True delivery.
        artifact: !artifact
          name: true result
          format: string
          final: true
    else:
      - !action
        action: False delivery.
        artifact: !artifact
          name: false result
          format: string
          final: true
`);
    const started = await startRun({ memoryRoot, runsRoot, procedureName: "branch-final" });
    const afterChoice = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "false" } });
    const done = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "false result" } });
    assert.equal(afterChoice.stack[0].steps[afterChoice.stack[0].index]?.artifact, "false result");
    assert.deepEqual(finalArtifacts(done).map((artifact) => artifact.name), ["false result"]);
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
  - !action
    action: Capture schema.
    artifact: !artifact
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
  - !action
    action: Capture markdown.
    artifact: !artifact
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
    condition: !action
      action: Choose path.
      artifact: !artifact
        name: choose
        format: boolean
    then:
      - !action
        action: Capture true path.
        artifact: !artifact
          name: true result
          format: string
    else:
      - !action
        action: Capture false path.
        artifact: !artifact
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

test("recursive elseif evaluates in order and falls back to the root else", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });

    await writeFile(join(proceduresRoot, "target.yaml"), `!procedure
names: [target-procedure]
flow:
  - !if
    condition: !action
      action: Check A.
      artifact: !artifact
        name: A
        format: boolean
    then:
      - !action
        action: Handle A.
        artifact: !artifact
          name: A result
          format: string
    elseif: !if
      condition: !action
        action: Check B.
        artifact: !artifact
          name: B
          format: boolean
      then:
        - !action
          action: Handle B.
          artifact: !artifact
            name: B result
            format: string
    else:
      - !action
        action: Handle fallback.
        artifact: !artifact
          name: fallback result
          format: string
`);

    const started = await startRun({ memoryRoot, runsRoot, procedureName: "target-procedure" });
    assert.equal(started.stack[0].steps[started.stack[0].index].artifact, "A");

    const afterA = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "false" } });
    assert.equal(afterA.stack[0].steps[afterA.stack[0].index].artifact, "B");

    const afterB = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "false" } });
    assert.equal(afterB.stack[0].steps[afterB.stack[0].index].artifact, "fallback result");
  });
});

test("while repeats its body and call automatically enters the child procedure", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });

    await writeFile(join(proceduresRoot, "parent.yaml"), `!procedure
names: [parent]
asserts: [Keep the parent contract active.]
flow:
  - !while
    condition: !action
      action: Continue?
      artifact: !artifact
        name: continue
        format: boolean
    do:
      - !action
        action: Record iteration.
        artifact: !artifact
          name: iteration
          format: number
  - !call
    target: child
`);
    await writeFile(join(proceduresRoot, "child.yaml"), `!procedure
names: [child]
asserts: [Keep the child contract active.]
flow:
  - !action
    action: Finish child.
    artifact: !artifact
      name: child result
      format: string
`);

    const started = await startRun({ memoryRoot, runsRoot, procedureName: "parent" });
    const enteredLoop = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "true" } });
    assert.equal(enteredLoop.stack[0].steps[enteredLoop.stack[0].index].artifact, "iteration");

    const repeated = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "1" } });
    assert.equal(repeated.stack[0].steps[repeated.stack[0].index].artifact, "continue");

    const enteredChild = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "false" } });
    assert.equal(enteredChild.stack.at(-1)?.memoryName, "child");
    assert.equal(enteredChild.stack.at(-1)?.steps[0].artifact, "child result");
    assert.deepEqual(activeProcedureAsserts(enteredChild), [
      "Keep the parent contract active.",
      "Keep the child contract active."
    ]);

    const done = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "done" } });
    assert.equal(done.status, "done");
  });
});

test("schema execution expands shorthand string fields", async () => {
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
  - !action
    action: Capture schema.
    artifact: !artifact
      name: schema result
      format: schema
      schema: demo-schema
`);
    await writeFile(join(schemasRoot, "demo.yaml"), `!schema
names: [demo-schema]
defines:
  - !statement
    asserts:
      - Keep it concise.
fields:
  - summary
  - !schema
    names: [details]
`);

    const started = await startRun({ memoryRoot, runsRoot, procedureName: "target-procedure" });
    const entered = await enterSchema({ memoryRoot, runsRoot, runId: started.id, schemaName: "demo-schema" });
    const schemaFrame = entered.stack.at(-1);
    assert.deepEqual(schemaFrame?.steps.map((step) => step.artifact), [
      "demo-schema",
      "demo-schema.summary",
      "demo-schema.details"
    ]);
    assert.deepEqual(schemaFrame?.steps.map((step) => step.format), ["markdown", "string", "string"]);
    assert(schemaFrame?.steps[0].details?.includes("asserts: Keep it concise."));
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
  - !action
    action: Capture markdown.
    artifact: !artifact
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

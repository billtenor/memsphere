import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile as writeRawFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readConfigAt } from "../src/config.js";
import { parseControlPlaneConfig } from "../src/control-plane/index.js";
import { memoryKinds } from "../src/memory/kinds.js";
import { currentMemorySyntax } from "../src/memory/syntax.js";
import {
  activeProcedureAsserts,
  ArtifactAuthorizationFailure,
  artifactSchemaName,
  currentArtifactReview,
  currentStep,
  enterSchema,
  finalArtifacts,
  readRun,
  repeatRun,
  reportRun,
  resolveArtifactReviewComment,
  submitArtifactReviewAssignment,
  submitArtifactReviewRunnerVote,
  skipRun,
  startRun,
  updateArtifactReviewDraft,
  waitForArtifactReview
} from "../src/run/store.js";
import { validateMemoryStore } from "../src/validation.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-test-"));

  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeFile(path: string, data: string): Promise<void> {
  const versioned = /\.ya?ml$/.test(path) && /^!(?:concept|statement|schema|procedure)\n/.test(data)
    ? data.replace(/^(!(?:concept|statement|schema|procedure))\n/, `$1\nsyntax: ${currentMemorySyntax}\n`)
    : data;
  await writeRawFile(path, versioned);
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
      type: string
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
    assert.equal(run.memorySyntax, currentMemorySyntax);
    assert.equal(run.procedureName, "target-procedure");
    assert.deepEqual(run.asserts, ["Keep the procedure contract active."]);
    assert.equal(run.stack[0].memoryName, "target-procedure");
    assert.deepEqual(run.stack[0].asserts, ["Keep the procedure contract active."]);
    assert.deepEqual(activeProcedureAsserts(run), ["Keep the procedure contract active."]);
    assert.equal(run.stack[0].steps[0].instruction, "Capture result.");
  });
});

test("startRun loads a root Procedure file outside memoryRoot", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    const fixtureRoot = join(dir, "fixtures");
    const procedureFile = join(fixtureRoot, "external-procedure.yaml");
    await mkdir(proceduresRoot, { recursive: true });
    await mkdir(fixtureRoot, { recursive: true });

    await writeFile(join(proceduresRoot, "invalid.yaml"), invalidProcedure);
    await writeFile(procedureFile, validProcedure.replace("target-procedure", "external-procedure"));

    const run = await startRun({ memoryRoot, runsRoot, procedureFile });

    assert.equal(run.status, "running");
    assert.equal(run.procedureName, "external-procedure");
    assert.equal(run.memoryRoot, memoryRoot);
    assert.equal(run.stack[0].memoryName, "external-procedure");
    assert.equal(run.stack[0].steps[0].instruction, "Capture result.");
  });
});

test("startRun requires exactly one Procedure source", async () => {
  await withTempDir(async (dir) => {
    const base = { memoryRoot: join(dir, "memory"), runsRoot: join(dir, "runs") };
    await assert.rejects(startRun(base), /provide a procedure name or procedure file/);
    await assert.rejects(
      startRun({ ...base, procedureName: "installed", procedureFile: join(dir, "external.yaml") }),
      /use either a procedure name or procedure file, not both/
    );
  });
});

test("Agent Review smoke Procedures start directly from test fixture files", async () => {
  await withTempDir(async (dir) => {
    const controlPlane = parseControlPlaneConfig({
      identities: {
        traex1: { kind: "agent", name: "Traex reviewer 1", agent: { provider: "traex", command: "traex", args: [] } },
        traex2: { kind: "agent", name: "Traex reviewer 2", agent: { provider: "traex", command: "traex", args: [] } },
        human: { kind: "human", name: "Human reviewer" }
      },
      roles: {
        runner: { name: "Runner", permissions: ["artifact.read", "artifact.submit", "decision.decide"] },
        development_engineer: { name: "Development engineer", permissions: ["artifact.read", "decision.assess"] },
        test_engineer: { name: "Test engineer", permissions: ["artifact.read", "decision.decide"] },
        system_architect: { name: "System architect", permissions: ["artifact.read", "decision.decide"] }
      }
    });
    const fixtureRoot = join(
      process.cwd(),
      "test",
      "fixtures",
      "agent-review",
      ".memsphere",
      "memory",
      "procedures"
    );
    const cases = [
      ["traex-artifact-review-smoke.yaml", "Traex ACP 四方评审测试流程"],
      ["traex-code-fact-review-smoke.yaml", "Traex ACP 代码事实评审测试流程"]
    ] as const;

    for (const [fileName, procedureName] of cases) {
      const run = await startRun({
        memoryRoot: join(dir, "memory"),
        runsRoot: join(dir, "runs"),
        procedureFile: join(fixtureRoot, fileName),
        controlPlane
      });
      assert.equal(run.procedureName, procedureName);
      assert.equal(run.status, "running");
      assert.equal(run.stack[0].roleBindings?.development_engineer?.identityIds[0], "traex1");
      assert.equal(run.stack[0].roleBindings?.test_engineer?.identityIds[0], "traex2");
      assert.equal(run.stack[0].roleBindings?.system_architect?.identityIds[0], "human");
    }
  });
});

test("startRun routes an unversioned Procedure to store validation without parsing legacy content", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    await mkdir(proceduresRoot, { recursive: true });
    await writeRawFile(join(proceduresRoot, "target.yaml"), validProcedure);

    await assert.rejects(
      startRun({ memoryRoot, runsRoot: join(dir, "runs"), procedureName: "target-procedure" }),
      /Memory store contains invalid Memory YAML; run memsphere validate/
    );
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
      type: string
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
    assert.deepEqual(artifact.format, { name: "markdown", options: {} });
    assert.match(artifact.path ?? "", new RegExp(`^${run.id}/artifacts/`));
    assert.equal(await readFile(join(runsRoot, artifact.path ?? ""), "utf8"), "# Result\n");
  });
});

test("reportRun validates and stores external-schema Markdown artifacts", async () => {
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
      type: object
      format:
        name: markdown
        layout: outline
      schema: demo-schema
`);
    await writeFile(join(schemasRoot, "demo.yaml"), `!schema
names: [demo-schema]
fields: [summary]
`);

    const run = await startRun({ memoryRoot, runsRoot, procedureName: "target-procedure" });
    const updated = await reportRun({
      runsRoot,
      runId: run.id,
      artifact: { kind: "inline", value: "# Delivery\n\n## summary\n\nschema content\n" }
    });

    const artifact = updated.events[0].artifact;
    assert.equal(artifact.storage, "file");
    assert.equal(artifactSchemaName(artifact), "demo-schema");
    assert.match(artifact.fileName ?? "", /\.md$/);
    assert.equal(await readFile(join(runsRoot, artifact.path ?? ""), "utf8"), "# Delivery\n\n## summary\n\nschema content\n");
  });
});

test("failed Artifact validation leaves Run state and managed artifacts unchanged", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "target.yaml"), `!procedure
names: [atomic-report]
flow:
  - !action
    action: Produce a release record.
    artifact: !artifact
      name: release record
      type: object
      format:
        name: markdown
        layout: outline
      schema: !schema
        fields: [summary]
`);

    const started = await startRun({ memoryRoot, runsRoot, procedureName: "atomic-report" });
    const runPath = join(runsRoot, started.id, `${started.id}.json`);
    const before = await readFile(runPath, "utf8");
    await assert.rejects(
      reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "# Release\n\nNo summary heading.\n" } }),
      /missing heading summary/
    );
    assert.equal(await readFile(runPath, "utf8"), before);
    await assert.rejects(readFile(join(runsRoot, started.id, "artifacts", "001-release-record.md"), "utf8"), { code: "ENOENT" });

    const done = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "# Release\n\n## summary\n\nReady.\n" }
    });
    assert.equal(done.status, "done");
    assert.equal(done.events.length, 1);
    assert.equal(done.events[0]?.artifact.validation?.status, "passed");
  });
});

test("external schemas are snapshotted when a Run starts", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const schemasRoot = join(memoryRoot, "schemas");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await mkdir(schemasRoot, { recursive: true });
    const schemaPath = join(schemasRoot, "release.yaml");
    await writeFile(join(proceduresRoot, "target.yaml"), `!procedure
names: [schema-snapshot]
flow:
  - !action
    action: Produce a release record.
    artifact: !artifact
      name: release record
      type: object
      format: { name: markdown, layout: outline }
      schema: release-schema
`);
    await writeFile(schemaPath, "!schema\nnames: [release-schema]\nfields: [summary]\n");

    const started = await startRun({ memoryRoot, runsRoot, procedureName: "schema-snapshot" });
    assert.equal(started.stack[0]?.steps[0]?.schema?.kind, "external");
    assert.deepEqual(started.stack[0]?.steps[0]?.schema?.node?.fields, ["summary"]);
    await writeFile(schemaPath, "!schema\nnames: [release-schema]\nfields: [different]\n");

    const done = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "# Release\n\n## summary\n\nReady.\n" }
    });
    assert.equal(done.status, "done");
  });
});

test("schema Memory refs are resolved into the Run schema snapshot", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const schemasRoot = join(memoryRoot, "schemas");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await mkdir(schemasRoot, { recursive: true });

    await writeFile(join(proceduresRoot, "target.yaml"), `!procedure
names: [schema-ref-procedure]
flow:
  - !action
    action: Produce delivery.
    artifact: !artifact
      name: delivery
      type: object
      format: { name: markdown, layout: outline }
      schema: !ref
        target: schemas/Delivery Schema
`);
    await writeFile(join(schemasRoot, "delivery.yaml"), `!schema
names: [Delivery Schema]
fields:
  - summary
  - !ref
    target: schemas/Detail Schema
`);
    await writeFile(join(schemasRoot, "detail.yaml"), `!schema
names: [Detail Schema]
fields: [owner]
`);

    const started = await startRun({ memoryRoot, runsRoot, procedureName: "schema-ref-procedure" });
    const step = started.stack[0].steps[0];
    assert.equal(step.schema?.kind, "external");
    assert.equal(step.schema?.name, "schemas/Delivery Schema");
    assert.deepEqual(step.schema?.node?.fields?.map((field) => typeof field === "string" ? field : field.names[0]), [
      "summary",
      "Detail Schema"
    ]);

    const entered = await enterSchema({ memoryRoot, runsRoot, runId: started.id, schemaName: "schemas/Delivery Schema" });
    assert.deepEqual(entered.stack.at(-1)?.steps.map((schemaStep) => schemaStep.artifact), [
      "schemas/Delivery Schema",
      "schemas/Delivery Schema.summary",
      "schemas/Delivery Schema.Detail Schema",
      "schemas/Delivery Schema.Detail Schema.owner"
    ]);

    await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "# Delivery\n" } });
    await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "ready" } });
    await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "Detail" } });
    const done = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "Ada" } });

    assert.equal(done.status, "done");
    const delivery = done.events.find((event) => event.artifact.name === "delivery")?.artifact;
    assert(delivery?.path);
    assert.match(await readFile(join(runsRoot, delivery.path), "utf8"), /## Detail Schema\n\nDetail\n\n### owner\n\nAda/);
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
      type: object
      format:
        name: markdown
        layout: outline
      final: true
      schema: !schema
        fields: [summary]
`);

    const started = await startRun({ memoryRoot, runsRoot, procedureName: "inline-contract" });
    const step = started.stack[0].steps[0];
    assert.deepEqual(step.asserts, ["Keep every required field."]);
    assert.deepEqual(step.suggests, ["Prefer short prose."]);
    assert.equal(step.schema?.kind, "inline");
    assert(step.schema?.kind === "inline" && step.schema.id.startsWith("inline:flow[1]:delivery"));
    await writeFile(procedurePath, validProcedure);

    const entered = await enterSchema({ memoryRoot, runsRoot, runId: started.id });
    const inlineSchemaId = step.schema?.kind === "inline" ? step.schema.id : "";
    assert.equal(entered.stack.at(-1)?.memoryName, inlineSchemaId);
    assert.equal(entered.stack.at(-1)?.steps[0]?.artifact, inlineSchemaId);
    await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "# Delivery\n" } });
    const done = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "finished" } });
    assert.equal(done.status, "done");
    assert.equal(finalArtifacts(done).length, 1);
    const delivery = finalArtifacts(done)[0];
    assert.equal(delivery.schema?.kind, "inline");
    assert.equal(delivery.final, true);
    assert.match(delivery.path ?? "", /\.md$/);
    assert.equal(await readFile(join(runsRoot, delivery.path ?? ""), "utf8"), "# Delivery\n\n## summary\n\nfinished\n");
  });
});

test("enter-schema records a local Markdown table as one complete structured step", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "table.yaml"), `!procedure
names: [table-contract]
flow:
  - !action
    action: Produce delivery.
    artifact: !artifact
      name: delivery
      type: object
      format: { name: markdown, layout: outline }
      schema: !schema
        fields:
          - !schema
            names: [Requirements]
            type: array
            format: { name: markdown, layout: table }
            item: !schema
              type: object
              fields: [ID, Summary]
`);

    const started = await startRun({ memoryRoot, runsRoot, procedureName: "table-contract" });
    const entered = await enterSchema({ memoryRoot, runsRoot, runId: started.id });
    const schemaSteps = entered.stack.at(-1)?.steps ?? [];
    assert.equal(schemaSteps.length, 2);
    assert.equal(schemaSteps[1]?.artifact?.endsWith(".Requirements"), true);
    assert.deepEqual(schemaSteps[1]?.format, { name: "markdown", options: { layout: "table" } });

    await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "# Delivery" } });
    const done = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "| ID | Summary |\n| --- | --- |\n| R-1 | First |\n" }
    });
    assert.equal(done.status, "done");
    assert.equal(done.events.filter((event) => event.frame === "schema").length, 2);
    assert.match(await readFile(join(runsRoot, done.events.at(-1)?.artifact.path ?? ""), "utf8"), /## Requirements/);
  });
});

test("enter-schema parent validation failure leaves Run state and managed artifacts unchanged", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "table.yaml"), `!procedure
names: [table-contract]
flow:
  - !action
    action: Produce delivery.
    artifact: !artifact
      name: delivery
      type: object
      format: { name: markdown, layout: outline }
      schema: !schema
        fields:
          - !schema
            names: [Requirements]
            type: array
            format: { name: markdown, layout: table }
            item: !schema
              type: object
              fields: [ID, Summary]
`);

    const started = await startRun({ memoryRoot, runsRoot, procedureName: "table-contract" });
    await enterSchema({ memoryRoot, runsRoot, runId: started.id });
    await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "# Delivery" } });

    const runPath = join(runsRoot, started.id, `${started.id}.json`);
    const artifactRoot = join(runsRoot, started.id, "artifacts");
    const runBefore = await readFile(runPath, "utf8");
    const artifactsBefore = (await readdir(artifactRoot)).sort();

    await assert.rejects(
      reportRun({
        runsRoot,
        runId: started.id,
        artifact: { kind: "inline", value: "| ID |\n| --- |\n| R-1 |\n" }
      }),
      /missing column Summary/
    );

    assert.equal(await readFile(runPath, "utf8"), runBefore);
    assert.deepEqual((await readdir(artifactRoot)).sort(), artifactsBefore);
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
        type: boolean
    then:
      - !action
        action: True delivery.
        artifact: !artifact
          name: true result
          type: string
          final: true
    else:
      - !action
        action: False delivery.
        artifact: !artifact
          name: false result
          type: string
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
      type: object
      format:
        name: markdown
        layout: outline
      schema: demo-schema
`);
    await writeFile(join(schemasRoot, "demo.yaml"), `!schema
names: [demo-schema]
type: object
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
    assert.match(artifact?.fileName ?? "", /\.md$/);
    assert.equal(await readFile(join(runsRoot, artifact?.path ?? ""), "utf8"), "schema field value\n");
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
      type: string
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
        type: boolean
    then:
      - !action
        action: Capture true path.
        artifact: !artifact
          name: true result
          type: string
    else:
      - !action
        action: Capture false path.
        artifact: !artifact
          name: false result
          type: string
`);

    const run = await startRun({ memoryRoot, runsRoot, procedureName: "target-procedure" });
    const updated = await reportRun({
      runsRoot,
      runId: run.id,
      artifact: { kind: "inline", value: "true" }
    });

    assert.equal(updated.events[0].artifact.storage, "inline");
    assert.equal(updated.events[0].artifact.value, true);
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
        type: boolean
    then:
      - !action
        action: Handle A.
        artifact: !artifact
          name: A result
          type: string
    elseif: !if
      condition: !action
        action: Check B.
        artifact: !artifact
          name: B
          type: boolean
      then:
        - !action
          action: Handle B.
          artifact: !artifact
            name: B result
            type: string
    else:
      - !action
        action: Handle fallback.
        artifact: !artifact
          name: fallback result
          type: string
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
        type: boolean
    do:
      - !action
        action: Record iteration.
        artifact: !artifact
          name: iteration
          type: number
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
      type: string
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
      type: object
      format:
        name: markdown
        layout: outline
      schema: demo-schema
`);
    await writeFile(join(schemasRoot, "demo.yaml"), `!schema
names: [demo-schema]
defines:
  - !statement
    asserts:
      - Keep it concise.
    suggests:
      - Prefer direct wording.
    sections:
      - !statement
        names: [Formatting]
        asserts:
          - Use Markdown headings.
        sections:
          - !statement
            names: [Examples]
            suggests:
              - Include one example when useful.
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
    assert.deepEqual(schemaFrame?.steps.map((step) => step.format), [
      { name: "markdown", options: { layout: "outline" } },
      { name: "markdown", options: {} },
      { name: "markdown", options: {} }
    ]);
    assert.deepEqual(schemaFrame?.steps.map((step) => step.type), ["object", "string", "string"]);
    assert(schemaFrame?.steps[0].details?.includes("asserts: Keep it concise."));
    assert(schemaFrame?.steps[0].details?.includes("suggests: Prefer direct wording."));
    assert(schemaFrame?.steps[0].details?.includes("asserts [Formatting]: Use Markdown headings."));
    assert(schemaFrame?.steps[0].details?.includes("suggests [Formatting > Examples]: Include one example when useful."));
  });
});

test("schema Repeat persists its control step and expands a chosen count without artifacts", async () => {
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
      type: object
      format:
        name: markdown
        layout: outline
      schema: repeat-schema
`);
    await writeFile(join(schemasRoot, "repeat.yaml"), `!schema
names: [repeat-schema]
fields:
  - context
  - !repeat
    limit: { min: 1, max: 3 }
    body:
      - !schema
        names: [decision]
        fields: [conclusion]
      - owner
  - summary
`);

    const started = await startRun({ memoryRoot, runsRoot, procedureName: "target-procedure" });
    await enterSchema({ memoryRoot, runsRoot, runId: started.id, schemaName: "repeat-schema" });
    await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "# Record" } });
    const waiting = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "context" } });

    assert.equal(currentStep(waiting)?.kind, "repeat");
    assert.deepEqual(currentStep(waiting)?.repeat?.body.map((field) => typeof field === "string" ? field : field.names[0]), ["decision", "owner"]);
    assert.equal((await readRun(runsRoot, started.id)).stack.at(-1)?.steps.at(-2)?.kind, "repeat");
    await assert.rejects(
      reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "2" } }),
      /run repeat/
    );
    await assert.rejects(repeatRun({ runsRoot, runId: started.id, count: 0 }), /at least 1/);
    await assert.rejects(repeatRun({ runsRoot, runId: started.id, count: 4 }), /at most 3/);

    const expanded = await repeatRun({ runsRoot, runId: started.id, count: 2 });
    assert.equal(expanded.events.length, 2);
    assert.deepEqual(expanded.stack.at(-1)?.steps.slice(expanded.stack.at(-1)?.index).map((step) => step.artifact), [
      "repeat-schema.decision[1]",
      "repeat-schema.decision[1].conclusion",
      "repeat-schema.owner[1]",
      "repeat-schema.decision[2]",
      "repeat-schema.decision[2].conclusion",
      "repeat-schema.owner[2]",
      "repeat-schema.summary"
    ]);
  });
});

test("schema optional fields can be explicitly skipped", async () => {
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
      type: object
      format:
        name: markdown
        layout: outline
      schema: optional-schema
`);
    await writeFile(join(schemasRoot, "optional.yaml"), `!schema
names: [optional-schema]
fields:
  - required
  - !schema
    names: [notes]
    optional: true
`);

    const started = await startRun({ memoryRoot, runsRoot, procedureName: "target-procedure" });
    await enterSchema({ memoryRoot, runsRoot, runId: started.id, schemaName: "optional-schema" });
    await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "# Record" } });
    await assert.rejects(skipRun({ runsRoot, runId: started.id }), /required/);
    const required = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "ready" } });

    assert.equal(currentStep(required)?.artifact, "optional-schema.notes");
    assert.equal(currentStep(required)?.optional, true);

    const skipped = await skipRun({ runsRoot, runId: started.id });
    assert.equal(skipped.events.find((event) => event.stepId === "schema:optional-schema.notes")?.artifact.fields?.skipped, true);
    assert.equal(skipped.status, "done");
    const assembledArtifact = skipped.events.find((event) => event.artifact.name === "schema result")?.artifact;
    assert(assembledArtifact?.path);
    const assembled = await readFile(join(runsRoot, assembledArtifact.path), "utf8");
    assert.match(assembled, /## required/);
    assert.doesNotMatch(assembled, /notes/);
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

test("running v1 Runs remain byte-for-byte read-only", async () => {
  await withTempDir(async (dir) => {
    const runsRoot = join(dir, "runs");
    const runId = "run-v1-running";
    await mkdir(runsRoot);
    const path = join(runsRoot, `${runId}.json`);
    const source = `${JSON.stringify({
      id: runId,
      status: "running",
      procedureName: "legacy",
      memoryRoot: join(dir, "memory"),
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T00:00:00.000Z",
      stack: [{
        type: "procedure",
        memoryName: "legacy",
        steps: [{ id: "flow[1]", instruction: "Legacy step", artifact: "result", format: "string" }],
        index: 0
      }],
      events: []
    }, null, 2)}\n`;
    await writeFile(path, source);

    const run = await readRun(runsRoot, runId);
    assert.equal(run.contractVersion, 1);
    assert.equal(run.readOnly, true);
    await assert.rejects(
      reportRun({ runsRoot, runId, artifact: { kind: "inline", value: "result" } }),
      /v1 run is read-only/
    );
    assert.equal(await readFile(path, "utf8"), source);
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
      type: string
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

test("concurrent reports serialize through the per-Run write lock", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "concurrent.yaml"), `!procedure
names: [concurrent-report]
flow:
  - !action
    action: Capture first.
    artifact: !artifact
      name: first
  - !action
    action: Capture second.
    artifact: !artifact
      name: second
`);
    const started = await startRun({ memoryRoot, runsRoot, procedureName: "concurrent-report" });

    await Promise.all([
      reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "A" } }),
      reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "B" } })
    ]);

    const completed = await readRun(runsRoot, started.id);
    assert.equal(completed.status, "done");
    assert.equal(completed.events.length, 2);
    assert.deepEqual(new Set(completed.events.map((event) => event.artifact.value)), new Set(["A", "B"]));
  });
});

test("Run writes recover a lock left by a terminated process", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "stale-lock.yaml"), `!procedure
names: [stale-lock]
flow:
  - !action
    action: Capture result.
    artifact: !artifact
      name: result
`);
    const started = await startRun({ memoryRoot, runsRoot, procedureName: "stale-lock" });
    const lockRoot = join(runsRoot, ".locks");
    const lockName = createHash("sha256").update(started.id).digest("hex");
    await mkdir(lockRoot, { recursive: true });
    await writeRawFile(join(lockRoot, `${lockName}.lock`), `${JSON.stringify({
      pid: 99_999_999,
      token: "terminated-owner",
      startedAt: "2026-01-01T00:00:00.000Z"
    })}\n`);

    const completed = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "done" }
    });
    assert.equal(completed.status, "done");
    assert.deepEqual(await readdir(lockRoot), []);
    assert.equal((await readdir(join(runsRoot, started.id))).some((name) => name.endsWith(".tmp")), false);
  });
});

test("Run v3 snapshots control-plane bindings, grants, and report authorization", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "governed.yaml"), `!procedure
name: governed
role_bindings:
  reviewer: human
flow:
  - !action
    action: Produce a governed Artifact.
    artifact: !artifact
      name: governed result
      role_bindings:
        reviewer: [human, agent]
      permission_grants:
        runner: [decision.decide]
`);
    const controlPlane = parseControlPlaneConfig({
      identities: {
        human: { kind: "human", name: "Human" },
        agent: { kind: "agent", name: "Agent", agent: { command: "traecli", args: ["acp"] } }
      },
      roles: {
        runner: {
          name: "Runner",
          permissions: ["artifact.read", "artifact.submit"],
          grantable_permissions: ["decision.decide"]
        },
        reviewer: { name: "Reviewer", permissions: ["artifact.read", "decision.assess"] }
      }
    });

    const run = await startRun({ memoryRoot, runsRoot, procedureName: "governed", controlPlane });
    assert.equal(run.contractVersion, 3);
    assert(run.controlPlane);
    assert(run.procedureSnapshots?.governed);
    assert.deepEqual(currentStep(run)?.controlPlane?.bindings.reviewer.identityIds, ["human", "agent"]);
    assert.deepEqual(currentStep(run)?.controlPlane?.permissions.runner.effective, [
      "artifact.read",
      "artifact.submit",
      "decision.decide"
    ]);

    const completed = await reportRun({
      runsRoot,
      runId: run.id,
      artifact: { kind: "inline", value: "done" }
    });
    assert.equal(completed.events[0].artifact.authorization?.allowed, true);
    assert.equal(completed.events[0].artifact.authorization?.permission, "artifact.submit");
    assert.equal(completed.events[0].artifact.authorization?.artifactScope, "governed#flow[1]");
    assert.equal(completed.events[0].artifact.authorization?.grantSource, "artifact:governed#flow[1]");
  });
});

test("control-plane fixture validates and runs through caller and callee precedence", async () => {
  await withTempDir(async (dir) => {
    const fixtureRoot = join(process.cwd(), "test", "fixtures", "control-plane", ".memsphere");
    const config = await readConfigAt(join(fixtureRoot, "config.json"));
    const validation = await validateMemoryStore(join(fixtureRoot, "config.json"));
    assert.deepEqual(validation.issues, []);

    const run = await startRun({
      memoryRoot: config.memoryRoot,
      runsRoot: join(dir, "runs"),
      procedureName: "control-plane-caller",
      controlPlane: config.controlPlane
    });
    assert.deepEqual(currentStep(run)?.controlPlane?.bindings.reviewer.identityIds, [
      "human_reviewer",
      "review_agent"
    ]);

    const child = await reportRun({
      runsRoot: join(dir, "runs"),
      runId: run.id,
      artifact: { kind: "inline", value: "caller" }
    });
    assert.equal(currentStep(child)?.instruction, "Produce the child Artifact.");
    assert.deepEqual(currentStep(child)?.controlPlane?.bindings.reviewer.identityIds, ["review_agent"]);
  });
});

test("report authorization denial leaves Run and Artifact files unchanged", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "governed.yaml"), `!procedure
name: governed
role_bindings: { reviewer: human }
flow:
  - !action
    action: Produce a governed Artifact.
    artifact: !artifact { name: result }
`);
    const controlPlane = parseControlPlaneConfig({
      identities: { human: { kind: "human", name: "Human" } },
      roles: {
        runner: { name: "Runner", permissions: ["artifact.read"] },
        reviewer: { name: "Reviewer", permissions: ["artifact.read"] }
      }
    });
    const run = await startRun({ memoryRoot, runsRoot, procedureName: "governed", controlPlane });
    const runPath = join(runsRoot, run.id, `${run.id}.json`);
    const before = await readFile(runPath, "utf8");

    await assert.rejects(
      reportRun({ runsRoot, runId: run.id, artifact: { kind: "inline", value: "denied" } }),
      (error: unknown) => {
        assert(error instanceof ArtifactAuthorizationFailure);
        assert.match(error.message, /requires artifact\.submit|requires artifact.submit/);
        assert.match(error.message, /artifact\.read/);
        return true;
      }
    );
    assert.equal(await readFile(runPath, "utf8"), before);
    assert.deepEqual(await readdir(join(runsRoot, run.id)), [`${run.id}.json`]);
  });
});

test("configured control plane authorizes every Artifact even without Memory governance fields", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "plain.yaml"), `!procedure
name: plain
flow:
  - !action
    action: Produce an ordinary Artifact.
    artifact: !artifact { name: result }
`);
    const controlPlane = parseControlPlaneConfig({
      identities: {},
      roles: {
        runner: { name: "Runner", permissions: ["artifact.read"] }
      }
    });
    const run = await startRun({ memoryRoot, runsRoot, procedureName: "plain", controlPlane });
    assert(currentStep(run)?.controlPlane);

    await assert.rejects(
      reportRun({ runsRoot, runId: run.id, artifact: { kind: "inline", value: "denied" } }),
      ArtifactAuthorizationFailure
    );
  });
});

test("Artifact grants can supply runner artifact.submit within the configured ceiling", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "granted.yaml"), `!procedure
name: granted
flow:
  - !action
    action: Produce a granted Artifact.
    artifact: !artifact
      name: result
      permission_grants:
        runner: [artifact.submit]
`);
    const controlPlane = parseControlPlaneConfig({
      identities: {},
      roles: {
        runner: {
          name: "Runner",
          permissions: ["artifact.read"],
          grantable_permissions: ["artifact.submit"]
        }
      }
    });
    const run = await startRun({ memoryRoot, runsRoot, procedureName: "granted", controlPlane });
    const completed = await reportRun({ runsRoot, runId: run.id, artifact: { kind: "inline", value: "allowed" } });
    assert.equal(completed.events[0].artifact.authorization?.allowed, true);
    assert.equal(completed.events[0].artifact.authorization?.grantSource, "artifact:granted#flow[1]");
  });
});

test("reachable called Procedures are frozen before the Run advances into them", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "caller.yaml"), `!procedure
name: caller
role_bindings: { reviewer: human }
flow:
  - !action
    action: Before call.
    artifact: !artifact { name: first }
  - !call
    target: child
`);
    const childPath = join(proceduresRoot, "child.yaml");
    await writeFile(childPath, `!procedure
name: child
role_bindings: { reviewer: agent }
flow:
  - !action
    action: Original child instruction.
    artifact: !artifact { name: child result }
`);
    const controlPlane = parseControlPlaneConfig({
      identities: {
        human: { kind: "human", name: "Human" },
        agent: { kind: "agent", name: "Agent", agent: { command: "traecli", args: [] } }
      },
      roles: {
        runner: { name: "Runner", permissions: ["artifact.submit"] },
        reviewer: { name: "Reviewer", permissions: ["artifact.read"] }
      }
    });
    const run = await startRun({ memoryRoot, runsRoot, procedureName: "caller", controlPlane });

    await writeFile(childPath, `!procedure
name: child
role_bindings: { reviewer: human }
flow:
  - !action
    action: Mutated child instruction.
    artifact: !artifact { name: mutated result }
`);
    const enteredChild = await reportRun({ runsRoot, runId: run.id, artifact: { kind: "inline", value: "first" } });
    assert.equal(currentStep(enteredChild)?.instruction, "Original child instruction.");
    assert.equal(currentStep(enteredChild)?.artifact, "child result");
    assert.deepEqual(currentStep(enteredChild)?.controlPlane?.bindings.reviewer.identityIds, ["agent"]);
  });
});

test("Artifact Review prerequisites fail before a Run is persisted", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "reviewed.yaml"), `!procedure
name: reviewed-prerequisites
role_bindings:
  reviewer: human
flow:
  - !action
    action: Produce a reviewed Artifact.
    artifact: !artifact
      name: reviewed result
      review: artifact_acceptance.unanimous
`);

    await assert.rejects(
      startRun({ memoryRoot, runsRoot, procedureName: "reviewed-prerequisites" }),
      /control_plane config is required for Artifact Review/
    );
    assert.deepEqual(await readdir(runsRoot), []);

    const noDecider = parseControlPlaneConfig({
      identities: { human: { kind: "human", name: "Human" } },
      roles: {
        runner: { name: "Runner", permissions: ["artifact.read", "artifact.submit"] },
        reviewer: { name: "Reviewer", permissions: ["artifact.read", "decision.assess"] }
      }
    });
    await assert.rejects(
      startRun({ memoryRoot, runsRoot, procedureName: "reviewed-prerequisites", controlPlane: noDecider }),
      /requires at least one decision\.decide subject/
    );
    assert.deepEqual(await readdir(runsRoot), []);
  });
});

test("Artifact Review requests a revision and accepts only the approved Submission", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "reviewed.yaml"), `!procedure
name: reviewed
role_bindings:
  reviewer: human
flow:
  - !action
    action: Produce a reviewed Artifact.
    artifact: !artifact
      name: reviewed result
      format: markdown
      review: artifact_acceptance.unanimous
  - !action
    action: Continue after review.
    artifact: !artifact
      name: continuation
`);
    const controlPlane = parseControlPlaneConfig({
      identities: {
        human: { kind: "human", name: "Human" }
      },
      roles: {
        runner: {
          name: "Runner",
          permissions: ["artifact.read", "artifact.submit", "decision.decide"]
        },
        reviewer: {
          name: "Reviewer",
          permissions: ["artifact.read", "decision.decide"]
        }
      }
    });

    const started = await startRun({ memoryRoot, runsRoot, procedureName: "reviewed", controlPlane });
    const first = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "# First candidate\n" }
    });
    const review = currentArtifactReview(first);
    assert(review);
    assert.equal(first.events.length, 0);
    assert.equal(currentStep(first)?.id, "flow[1]");
    assert.equal(review.rounds[0].votes.length, 0);

    const duplicate = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "# First candidate\n" }
    });
    assert.equal(currentArtifactReview(duplicate)?.rounds.length, 1);
    await assert.rejects(
      reportRun({
        runsRoot,
        runId: started.id,
        artifact: { kind: "inline", value: "# Conflicting candidate\n" }
      }),
      /is in progress; wait/
    );

    const draft = await updateArtifactReviewDraft({
      runsRoot,
      reviewId: review.id,
      roundId: review.currentRoundId,
      identityId: "human",
      expectedRevision: 1,
      draft: {
        vote: "request_changes",
        comments: [{ body: "Please revise the candidate." }]
      }
    });
    const rejected = await submitArtifactReviewAssignment({
      runsRoot,
      reviewId: review.id,
      roundId: review.currentRoundId,
      identityId: "human",
      expectedRevision: draft.round.revision
    });
    assert.equal(rejected.review.status, "awaiting_revision");
    assert.equal(rejected.run.events.length, 0);
    await assert.rejects(
      reportRun({
        runsRoot,
        runId: started.id,
        artifact: { kind: "inline", value: "# Second candidate\n" }
      }),
      /requires --revision-summary-file/
    );

    const second = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "# Second candidate\n" },
      revisionSummary: "Addressed the Human comment."
    });
    const secondReview = currentArtifactReview(second);
    assert(secondReview);
    assert.equal(secondReview.id, review.id);
    assert.equal(secondReview.rounds.length, 2);
    assert.equal(secondReview.submissions[1].revisionSummary?.previousSubmissionId, secondReview.submissions[0].id);

    const approvedDraft = await updateArtifactReviewDraft({
      runsRoot,
      reviewId: review.id,
      roundId: secondReview.currentRoundId,
      identityId: "human",
      expectedRevision: 1,
      draft: { vote: "approve", comments: [] }
    });
    const awaitingRunner = await submitArtifactReviewAssignment({
      runsRoot,
      reviewId: review.id,
      roundId: secondReview.currentRoundId,
      identityId: "human",
      expectedRevision: approvedDraft.round.revision
    });
    assert.equal(awaitingRunner.review.status, "awaiting_runner_vote");
    assert.equal(awaitingRunner.round.status, "awaiting_runner_vote");
    assert.equal(awaitingRunner.run.events.length, 0);
    assert.equal(currentStep(awaitingRunner.run)?.id, "flow[1]");
    const waited = await waitForArtifactReview({ runsRoot, reviewId: review.id, pollIntervalMs: 0 });
    assert.equal(waited.review.status, "awaiting_runner_vote");
    await assert.rejects(
      submitArtifactReviewRunnerVote({
        runsRoot,
        reviewId: review.id,
        roundId: secondReview.currentRoundId,
        vote: "request_changes"
      }),
      /requires --comment/
    );
    const runnerRejected = await submitArtifactReviewRunnerVote({
      runsRoot,
      reviewId: review.id,
      roundId: secondReview.currentRoundId,
      vote: "request_changes",
      comment: "Please address the advisory feedback before acceptance."
    });
    assert.equal(runnerRejected.review.status, "awaiting_revision");
    assert.equal(runnerRejected.run.events.length, 0);
    assert.equal(runnerRejected.round.votes.find((vote) => vote.subject.kind === "runner")?.automatic, false);
    assert.equal(
      runnerRejected.round.votes.find((vote) => vote.subject.kind === "runner")?.comment,
      "Please address the advisory feedback before acceptance."
    );

    const third = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "# Third candidate\n" },
      revisionSummary: "Addressed the Runner decision comment."
    });
    const thirdReview = currentArtifactReview(third);
    assert(thirdReview);
    const thirdDraft = await updateArtifactReviewDraft({
      runsRoot,
      reviewId: review.id,
      roundId: thirdReview.currentRoundId,
      identityId: "human",
      expectedRevision: 1,
      draft: { vote: "approve", comments: [] }
    });
    await submitArtifactReviewAssignment({
      runsRoot,
      reviewId: review.id,
      roundId: thirdReview.currentRoundId,
      identityId: "human",
      expectedRevision: thirdDraft.round.revision
    });
    const approved = await submitArtifactReviewRunnerVote({
      runsRoot,
      reviewId: review.id,
      roundId: thirdReview.currentRoundId,
      vote: "approve"
    });
    assert.equal(approved.review.status, "passed");
    assert.equal(approved.run.events.length, 1);
    assert.equal(approved.run.events[0].artifact.path?.includes(thirdReview.submissions[2].id), true);
    assert.equal(currentStep(approved.run)?.id, "flow[2]");
    const waitedAfterVote = await waitForArtifactReview({ runsRoot, reviewId: review.id, pollIntervalMs: 0 });
    assert.equal(waitedAfterVote.review.status, "passed");
    assert.equal(waitedAfterVote.round.id, thirdReview.currentRoundId);
  });
});

test("Artifact Review snapshots implementation evidence and requires blocking dispositions", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeRawFile(join(proceduresRoot, "package.yaml"), `!procedure
syntax: ${currentMemorySyntax}
name: package-review
role_bindings:
  advisor: advisor
flow:
  - !action
    action: Record implementation.
    artifact: !artifact
      name: implementation
      format: markdown
      review_role: implementation
  - !action
    action: Record validation.
    artifact: !artifact
      name: validation
      format: markdown
      review_role: validation
  - !action
    action: Review delivery package.
    artifact: !artifact
      name: review material
      format: markdown
      review_role: review-material
      review_requires: [implementation, validation]
      review: artifact_acceptance.unanimous
`);
    const controlPlane = parseControlPlaneConfig({
      identities: { advisor: { kind: "human", name: "Advisor" } },
      roles: {
        runner: { name: "Runner", permissions: ["artifact.read", "artifact.submit", "decision.decide"] },
        advisor: { name: "Advisor", permissions: ["artifact.read", "decision.assess"] }
      }
    });
    let run = await startRun({ memoryRoot, runsRoot, procedureName: "package-review", controlPlane });
    run = await reportRun({ runsRoot, runId: run.id, artifact: { kind: "inline", value: "# Implementation\nChanged src/a.ts." } });
    run = await reportRun({ runsRoot, runId: run.id, artifact: { kind: "inline", value: "# Validation\nnpm test passed." } });
    run = await reportRun({ runsRoot, runId: run.id, artifact: { kind: "inline", value: "# Review material\nReady." } });
    const review = currentArtifactReview(run);
    assert(review);
    const submission = review.submissions[0];
    assert.deepEqual(submission.package?.requirements.map((item) => [item.role, item.status]), [
      ["implementation", "present"],
      ["validation", "present"]
    ]);
    assert.equal(submission.package?.evidence.length, 2);
    for (const evidence of submission.package?.evidence ?? []) {
      assert.match(evidence.artifact.path ?? "", /artifacts\/reviews\/review-.*\/submission-.*\/evidence\//);
      assert.equal(typeof await readFile(join(runsRoot, evidence.artifact.path!), "utf8"), "string");
    }

    const draft = await updateArtifactReviewDraft({
      runsRoot,
      reviewId: review.id,
      roundId: review.currentRoundId,
      identityId: "advisor",
      expectedRevision: 1,
      draft: {
        vote: "request_changes",
        comments: [{ body: "Fix the implementation issue.", severity: "blocking" }]
      }
    });
    const awaitingRunner = await submitArtifactReviewAssignment({
      runsRoot,
      reviewId: review.id,
      roundId: review.currentRoundId,
      identityId: "advisor",
      expectedRevision: draft.round.revision
    });
    const commentId = awaitingRunner.assignment.submitted?.comments[0].id;
    assert(commentId);
    await assert.rejects(
      submitArtifactReviewRunnerVote({
        runsRoot,
        reviewId: review.id,
        roundId: review.currentRoundId,
        vote: "approve"
      }),
      /requires dispositions for 1 blocking/
    );
    await resolveArtifactReviewComment({
      runsRoot,
      reviewId: review.id,
      roundId: review.currentRoundId,
      commentId,
      disposition: "accepted-fixed",
      note: "Applied the focused fix.",
      validationSummary: "Focused regression passed."
    });
    const approved = await submitArtifactReviewRunnerVote({
      runsRoot,
      reviewId: review.id,
      roundId: review.currentRoundId,
      vote: "approve"
    });
    assert.equal(approved.review.status, "passed");
    assert.equal(approved.round.commentDispositions?.[0].disposition, "accepted-fixed");
  });
});

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildAgentReviewContract } from "../src/acp/review-contract.js";
import { buildRunStepDetail } from "../src/commands/run.js";
import { renderRunOutput } from "../src/prompts/run-output.js";
import {
  buildSchemaWritingSnapshot,
  currentStep,
  enterSchema,
  readRun,
  startRun
} from "../src/run/store.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";

test("Run freezes Statement projections and renders source and section groups", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-run-rules-"));
  try {
    const memoryRoot = join(root, "memory");
    const runsRoot = join(root, "runs");
    await Promise.all([
      mkdir(join(memoryRoot, "procedures"), { recursive: true }),
      mkdir(join(memoryRoot, "schemas"), { recursive: true }),
      mkdir(join(memoryRoot, "statements"), { recursive: true })
    ]);
    const statementPath = join(memoryRoot, "statements", "shared.yaml");
    await writeFile(statementPath, withCurrentMemorySyntax(`!statement
name: shared-rules
defines:
  - Shared rules for delivery.
asserts:
  - Keep the root requirement.
suggests:
  - Prefer a short result.
sections:
  - !statement
    name: Security
    defines:
      - Requirements that protect credentials.
    asserts:
      - Do not expose credentials.
    suggests:
      - Mention the security check.
`));
    await writeFile(join(memoryRoot, "schemas", "report.yaml"), withCurrentMemorySyntax(`!schema
name: report-contract
defines:
  - A report.
type: object
format:
  name: markdown
  layout: outline
asserts:
  - !ref
    target: statements/shared-rules
fields:
  - Summary
`));
    await writeFile(join(memoryRoot, "procedures", "delivery.yaml"), withCurrentMemorySyntax(`!procedure
name: delivery
defines:
  - Deliver a reviewed report.
asserts:
  - !ref
    target: statements/shared-rules
flow:
  - !action
    action: Write the report.
    asserts:
      - Local action requirement.
      - !ref
        target: statements/shared-rules
    suggests:
      - !ref
        target: statements/shared-rules
    artifact: !artifact
      name: report
      type: object
      format:
        name: markdown
        layout: outline
      schema: !ref
        target: schemas/report-contract
`));

    const started = await startRun({
      memoryRoot,
      runsRoot,
      name: "Rule integration",
      procedureName: "delivery"
    });
    assert.equal(started.assertTree?.entries[0]?.kind, "reference");
    assert.deepEqual(started.asserts, ["Keep the root requirement.", "Do not expose credentials."]);
    const step = currentStep(started)!;
    assert.equal(step.assertTree?.entries[1]?.kind, "reference");
    assert.equal(step.suggestTree?.entries[0]?.kind, "reference");
    assert.deepEqual(step.asserts, [
      "Local action requirement.",
      "Keep the root requirement.",
      "Do not expose credentials."
    ]);

    const detail = buildRunStepDetail(started, "delivery#flow[1]") as {
      step: { asserts: Array<string | { reference: string }> };
    };
    assert.equal(
      (detail.step.asserts[1] as { reference: string }).reference,
      "statements/shared-rules"
    );

    const reviewContract = buildAgentReviewContract({
      run: started,
      review: { stepId: "flow[1]", artifactName: "report" },
      round: {},
      assignment: {}
    } as never);
    assert.equal((reviewContract.procedure.asserts[0] as { reference: string }).reference, "statements/shared-rules");
    assert.equal((reviewContract.action.asserts[1] as { reference: string }).reference, "statements/shared-rules");
    assert.equal((reviewContract.action.suggests[0] as { reference: string }).reference, "statements/shared-rules");
    assert.doesNotMatch(JSON.stringify(reviewContract), /"entries"|"sections":\[\]|"defines":\[\]/);
    assert.doesNotMatch(JSON.stringify(detail), /ruleId|source_path|imported_at/);
    assert.doesNotMatch(JSON.stringify(reviewContract), /ruleId|source_path|imported_at/);

    const output = renderRunOutput({ kind: "start", run: started, runsRoot }, "zh-CN");
    assert.match(output, /来自 statements\/shared-rules/);
    assert.match(output, /章节 Security/);
    assert.match(output, /上下文:/);
    assert.match(output, /规则:/);
    assert.match(output, /Do not expose credentials\./);
    assert.doesNotMatch(output, /source_path|imported_at|ruleId/);

    const cacheOnly = structuredClone(started);
    cacheOnly.assertTree = undefined;
    cacheOnly.stack[0].assertTree = undefined;
    cacheOnly.stack[0].steps[0].assertTree = undefined;
    cacheOnly.stack[0].steps[0].suggestTree = undefined;
    const cacheOnlyOutput = renderRunOutput({ kind: "status", run: cacheOnly, runsRoot }, "zh-CN");
    assert.doesNotMatch(cacheOnlyOutput, /Keep the root requirement|Local action requirement|Prefer a short result/);

    await writeFile(statementPath, withCurrentMemorySyntax(`!statement
name: shared-rules
defines: [Changed later.]
asserts: [A later rule.]
suggests: [A later suggestion.]
`));
    const persisted = await readRun(runsRoot, started.id);
    assert.deepEqual(persisted.asserts, ["Keep the root requirement.", "Do not expose credentials."]);

    const entered = await enterSchema({ runsRoot, runId: started.id, schemaName: "schemas/report-contract" });
    const snapshot = buildSchemaWritingSnapshot(runsRoot, entered)!;
    assert.equal(snapshot.currentField?.sources[0]?.assertTree?.entries[0]?.kind, "reference");
    assert.deepEqual(snapshot.currentField?.sources[0]?.asserts, [
      "Keep the root requirement.",
      "Do not expose credentials."
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

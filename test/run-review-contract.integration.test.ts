import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildAgentReviewContract } from "../src/acp/review-contract.js";
import { reportRun, readArtifactReviewForActor, startRun } from "../src/run/store.js";
import { reviewConfiguration } from "./helpers/review.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";

// Integration scope: real flow Store persistence feeds the ACP contract builder.
// Public restricted CLI entrypoints are covered by the Reviewer system suites.
test("a persisted flow Review exposes its complete frozen requirement contract", async () => {
 const root = await mkdtemp(join(tmpdir(), "memsphere-review-contract-"));
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
      review: [reviewer]
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
      procedureName: "delivery",
      controlPlane: {
        runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] },
        actors: { human: { kind: "human", name: "Human", permissions: ["artifact.read", "decision.decide"] } }
      },
      reviewConfiguration: reviewConfiguration({ procedure: "delivery", slots: { reviewer: ["human"] } })
    });
    const pending = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "# Summary\n\nFrozen report." } });
    const review = pending.artifactReviews![0];
    const context = await readArtifactReviewForActor({ runsRoot, reviewId: review.id, roundId: review.currentRoundId, actorId: "human" });
    const reviewContract = buildAgentReviewContract(context);
    assert.equal((reviewContract.procedure.asserts[0] as { reference: string }).reference, "statements/shared-rules");
    assert.equal((reviewContract.action.asserts[1] as { reference: string }).reference, "statements/shared-rules");
    assert.equal((reviewContract.action.suggests[0] as { reference: string }).reference, "statements/shared-rules");
    assert.doesNotMatch(JSON.stringify(reviewContract), /"entries"|"sections":\[\]|"defines":\[\]/);
    assert.doesNotMatch(JSON.stringify(reviewContract), /ruleId|source_path|imported_at/);


 } finally { await rm(root,{recursive:true,force:true}); }
});

// @integration-platform: native — verifies real filesystem, process or build-adapter behavior.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { reviewNodeFixture } from "./helpers/review-nodes.js";
import { reviewMaterialFixture, completeReview } from "./helpers/review-node-materials.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";
import * as reviews from "../src/context_control/review-repository.js";
import * as flow from "../src/run/store.js";
import { GraphRuntime } from "../src/context_control/graph-runtime.js";
import { currentReviewNode, reviewCommentId, allReviewNodes } from "../src/review-nodes.js";

for (const material of ["inputA", "inputB"] as const) test(`graph: ${material} anchor retains target and content digest through editing and submission`, async t => {
  const f = await reviewMaterialFixture(t), targetId = f.result.materials[material];
  const n = currentReviewNode(f.claimed.assignment)!;
  let c = await reviews.mutateArtifactReviewNodes({ ...f.bound, mutation: { operation: "comment-add", artifact: { rulePath: n.asserts[0].rulePath, result: "undetermined", body: "Finding", severity: "risk", anchor: { targetRef: { kind: "artifact", id: targetId }, location: "markdown:h1:0", context: material } } } });
  const id = reviewCommentId(c.assignment.draft.comments[0]);
  const expected = { targetRef: { kind: "artifact", id: targetId }, submissionId: targetId, sourceHash: createHash("sha256").update(`# ${material}\n\nMaterial body.`).digest("hex"), target: "markdown:h1:0", location: "markdown:h1:0", context: material };
  assert.deepEqual(c.assignment.draft.comments[0].anchor, expected);
  c = await reviews.mutateArtifactReviewNodes({ ...f.bound, mutation: { operation: "comment-update", commentId: id, artifact: { body: "Edited" } } });
  assert.deepEqual(c.assignment.draft.comments[0].anchor, expected);
  await completeReview(f.bound);
  c = await reviews.submitArtifactReviewAgentAssignment({ ...f.bound, vote: "approve" });
  assert.deepEqual(c.assignment.submitted!.comments[0].anchor, expected);
  assert.equal(c.review.submissions.at(-1)!.contextArtifacts.find(a => a.artifactId === targetId)?.artifact.name, material);
});

test("graph: deleting an input anchored finding preserves other material targets", async t => {
  const f = await reviewMaterialFixture(t), n = currentReviewNode(f.claimed.assignment)!;
  let c;
  for (const key of ["inputA", "inputB"]) c = await reviews.mutateArtifactReviewNodes({ ...f.bound, mutation: { operation: "comment-add", artifact: { rulePath: n.asserts[0].rulePath, result: "undetermined", body: key, severity: "risk", anchor: { targetRef: { kind: "artifact", id: f.result.materials[key] }, location: "markdown:h1:0" } } } });
  const remaining = c!.assignment.draft.comments[1];
  c = await reviews.mutateArtifactReviewNodes({ ...f.bound, mutation: { operation: "comment-delete", commentId: reviewCommentId(c!.assignment.draft.comments[0]) } });
  assert.deepEqual(c.assignment.draft.comments, [remaining]);
});

for (const target of ["previous", "unrelated", "arbitrary"] as const) test(`graph: revised round rejects ${target} anchor atomically`, async t => {
  const f = await reviewMaterialFixture(t);
  await completeReview(f.bound);
  await reviews.submitArtifactReviewAgentAssignment({ ...f.bound, vote: "approve" });
  await f.service.withGraph(async g => {
    await g.submitReview(f.runId, f.stepId, f.input.roundId, "runner", "request_changes", [], "Revise candidate");
    await g.enter(f.runId, f.stepId);
  });
  const next = await f.service.withGraph(g => g.report(f.runId, f.stepId, { text: "# New Candidate", revisionSummary: "Revision" }));
  const input = { ...f.input, roundId: next.step.reviewRounds!.at(-1)!.id };
  const claimed = (await reviews.claimArtifactReviewAgentAssignment({ ...input }))!;
  const bound = { ...input, attemptId: claimed.attempt.id }; await reviews.markArtifactReviewAgentCliReady(bound);
  const before = (await reviews.readArtifactReviewForActor(input)).assignment;
  const id = target === "previous" ? f.result.artifact!.id : target === "unrelated" ? f.result.materials.unrelated : "artifact-does-not-exist";
  const n = currentReviewNode(before)!;
  await assert.rejects(reviews.mutateArtifactReviewNodes({ ...bound, mutation: { operation: "comment-add", artifact: { rulePath: n.asserts[0].rulePath, result: "undetermined", body: "Invalid", severity: "risk", anchor: { targetRef: { kind: "artifact", id }, location: "markdown:h1:0" } } } }), /outside the current materials/);
  assert.deepEqual((await reviews.readArtifactReviewForActor(input)).assignment, before);
  for (const valid of [next.artifact!.id, f.result.materials.inputA]) {
    const c = await reviews.mutateArtifactReviewNodes({ ...bound, mutation: { operation: "comment-add", artifact: { rulePath: n.asserts[0].rulePath, result: "undetermined", body: "Valid", severity: "risk", anchor: { targetRef: { kind: "artifact", id: valid }, location: "markdown:h1:0" } } } });
    assert.equal(c.assignment.draft.comments.at(-1)!.anchor!.submissionId, valid);
  }
});

for (const graph of [true, false]) for (const vote of ["request_changes", "abstain"] as const) for (const summary of [undefined, "Independent summary"]) test(`${graph ? "graph" : "flow"}: ${vote} validates final comments after an intervening deletion${summary ? " with summary" : ""}`, async t => {
  const f = await reviewNodeFixture(t, graph);
  const ready = await completeReview(f.bound, [{ body: "Only explanation", severity: "risk" }]);
  const id = reviewCommentId(ready.assignment.draft.comments[0]);
  const remove = () => reviews.mutateArtifactReviewNodes({ ...f.bound, mutation: { operation: "comment-delete", commentId: id } });
  if (graph) {
    const original = GraphRuntime.prototype.submitReview;
    t.mock.method(GraphRuntime.prototype, "submitReview", async function(this: GraphRuntime, ...args: Parameters<typeof original>) { await remove(); return original.apply(this, args); });
  } else {
    const original = fsPromises.readFile; let once = true;
    t.mock.method(fsPromises, "readFile", async function(...args: Parameters<typeof original>) {
      const bytes = await original.apply(fsPromises, args);
      if (once && String(args[0]).endsWith(`${f.runId}.json`)) { once = false; await remove(); }
      return bytes;
    });
    syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  }
  const submit = reviews.submitArtifactReviewAgentAssignment({ ...f.bound, vote, summary });
  if (summary) { const c = await submit; assert.equal(c.assignment.status, "submitted"); assert.deepEqual(c.assignment.submitted!.comments, []); assert.equal(c.assignment.submitted!.summary, summary); }
  else { await assert.rejects(submit, /explanation|Comment or Summary/); const c = await reviews.readArtifactReviewForActor(f.input); assert.notEqual(c.assignment.status, "submitted"); assert.deepEqual(c.assignment.draft.comments, []); }
});

for (const graph of [true, false]) test(`${graph ? "graph" : "flow"}: final submission preserves a concurrently edited reason`, async t => {
  const f = await reviewNodeFixture(t, graph);
  const ready = await completeReview(f.bound, [{ body: "Initial", severity: "risk" }]);
  const id = reviewCommentId(ready.assignment.draft.comments[0]);
  const update = () => reviews.mutateArtifactReviewNodes({ ...f.bound, mutation: { operation: "comment-update", commentId: id, artifact: { body: "Latest reason" } } });
  if (graph) { const original = GraphRuntime.prototype.submitReview; t.mock.method(GraphRuntime.prototype, "submitReview", async function(this: GraphRuntime, ...args: Parameters<typeof original>) { await update(); return original.apply(this, args); }); }
  else { const original = fsPromises.readFile; let once = true; t.mock.method(fsPromises, "readFile", async function(...args: Parameters<typeof original>) { const bytes = await original.apply(fsPromises, args); if (once && String(args[0]).endsWith(`${f.runId}.json`)) { once = false; await update(); } return bytes; }); syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); }); }
  const c = await reviews.submitArtifactReviewAgentAssignment({ ...f.bound, vote: "request_changes" });
  assert.equal(c.assignment.submitted!.comments[0].body, "Latest reason");
});

const simpleAction = `!action
        action: Body
        artifact: !artifact {name: body}
`;
function conditionAction(review = false) { return `!action
      action: Evaluate condition
      asserts: [Condition requirement]
      artifact: !artifact
        name: condition
        type: boolean
${review ? '        review: [reviewer]\n' : ''}\n`;  }
for (const shape of ["if", "while", "elseif", "nested"] as const) test(`flow: ${shape} condition Review points to the true frozen Memory location`, async t => {
  const f = await reviewNodeFixture(t, false), memoryRoot = join(f.root, "memory");
  const target = shape === "elseif" ? "flow[0].elseif.condition" : shape === "nested" ? "flow[0].then[0].condition" : "flow[0].condition";
  const scope = shape === "elseif" ? "p#flow[1].elseif" : shape === "nested" ? "p#flow[1].then[1]" : "p#flow[1]";
  let body;
  if (shape === "while") body = `  - !while\n    condition: ${conditionAction(true)}    do:\n      - ${simpleAction}\n`;
  else if (shape === "if") body = `  - !if\n    condition: ${conditionAction(true)}    then:\n      - ${simpleAction}\n`;
  else if (shape === "elseif") body = `  - !if\n    condition: ${conditionAction()}    then:\n      - ${simpleAction}\n    elseif: !if\n      condition: ${conditionAction(true).replace(/\n/g, '\n  ')}\n      then:\n        - ${simpleAction.replace(/\n/g, '\n  ')}\n`;
  else body = `  - !if\n    condition: ${conditionAction()}    then:\n      - !if\n        condition: ${conditionAction(true).replace(/\n/g, '\n    ')}\n        then:\n          - ${simpleAction.replace(/\n/g, '\n    ')}\n`;
  await writeFile(join(memoryRoot, "procedures/p.yaml"), withCurrentMemorySyntax(`!procedure\nnames: [p]\nflow:\n${body}`));
  let run = await flow.startRun({ name: "Condition source", memoryRoot, runsRoot: f.input.runsRoot, procedureName: "p", controlPlane: f.controlPlane, reviewConfiguration: { reviews: { [scope]: { policy: "artifact_acceptance.unanimous" } }, slots: { "p::reviewer": { actorIds: ["agent", "human"] } } } });
  if (shape === "elseif" || shape === "nested") run = await flow.reportRun({ runsRoot: f.input.runsRoot, runId: run.id, artifact: { kind: "inline", value: shape === "nested" ? "true" : "false" } });
  run = await flow.reportRun({ runsRoot: f.input.runsRoot, runId: run.id, artifact: { kind: "inline", value: "false" } });
  const assignment = flow.currentArtifactReview(run)!.rounds[0].assignments.find(a => a.actorId === "agent")!;
  const node = allReviewNodes(assignment.nodeTree!).find(n => n.source?.kind === "step")!;
  assert.equal(node.source!.path, target);
  assert.deepEqual(node.asserts, [{ rulePath: `${target}.asserts[0]`, text: "Condition requirement" }]);
});

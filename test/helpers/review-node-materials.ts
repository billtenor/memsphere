import type test from "node:test";
import { join } from "node:path";
import { openContextControl } from "../../src/project/context-control.js";
import { graphMemorySyntax } from "../../src/memory/syntax.js";
import type { GraphProcedureMemory } from "../../src/memory/ast.js";
import { reviewNodeFixture } from "./review-nodes.js";
import * as reviews from "../../src/context_control/review-repository.js";
import { currentReviewNode } from "../../src/review-nodes.js";

export async function reviewMaterialFixture(t: test.TestContext) {
  const base = await reviewNodeFixture(t, true);
  const service = (await openContextControl(base.root))!;
  const procedure: GraphProcedureMemory = { tag: "!procedure", syntax: graphMemorySyntax, mode: "graph", names: ["materials"], defines: ["Frozen material anchors"], actions: [
    ...["inputA", "inputB", "unrelated"].map(id => ({ tag: "!action" as const, id, description: id, dependencies: [{ tag: "!dependency" as const, from: "START" }], artifact: { name: id, model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/markdown" } } })),
    { tag: "!action", id: "candidate", description: "Review candidate", asserts: ["Check"], dependencies: [{ tag: "!dependency", from: ["inputA", "inputB"] }], artifact: { name: "Candidate", model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/markdown" }, review: ["reviewer"] } }
  ] };
  const result = await service.withGraph(async g => {
    const start = await g.start({ name: "Materials", procedure, controlPlane: base.controlPlane, reviewConfiguration: { reviews: { "materials#actions[candidate]": { policy: "artifact_acceptance.unanimous" } }, slots: { "materials::reviewer": { actorIds: ["agent", "human"] } } } });
    const materials: Record<string, string> = {};
    for (const step of start.steps) {
      await g.enter(start.run.id, step.id);
      const reported = await g.report(start.run.id, step.id, { text: `# ${step.source!.actionId}\n\nMaterial body.` });
      materials[step.source!.actionId] = reported.artifact!.id;
    }
    const next = (await g.snapshot(start.run.id)).steps.find(s => s.source?.actionId === "candidate")!;
    await g.enter(start.run.id, next.id);
    const reported = await g.report(start.run.id, next.id, { text: "# Candidate\n\nCandidate body." });
    return { ...reported, materials };
  });
  const runId = result.snapshot.run.id, stepId = result.step.id;
  const input = { runsRoot: join(base.root, "runs"), reviewId: reviews.graphReviewHandle(runId, stepId), roundId: result.step.reviewRounds!.at(-1)!.id, actorId: "agent", service };
  const claimed = (await reviews.claimArtifactReviewAgentAssignment({ ...input, workerPid: process.pid }))!;
  const bound = { ...input, attemptId: claimed.attempt.id }; await reviews.markArtifactReviewAgentCliReady(bound);
  return { ...base, service, result, runId, stepId, input, claimed, bound };
}
export async function completeReview(bound: Omit<Parameters<typeof reviews.mutateArtifactReviewNodes>[0], "mutation">, openComments: Array<{body: string; severity: "risk"}> = []) {
  let c = await reviews.readArtifactReviewForActor(bound);
  while (currentReviewNode(c.assignment)) {
    const node = currentReviewNode(c.assignment)!;
    c = await reviews.mutateArtifactReviewNodes({ ...bound, mutation: { operation: "report", expectedNodeId: node.nodeId, artifact: { applicable: true, ...(node.kind === "open_review" ? { comments: openComments } : {}) } } });
  }
  return c;
}

import { join } from "node:path";
import { openContextControl } from "../../src/project/context-control.js";
import { graphMemorySyntax } from "../../src/memory/syntax.js";
import * as reviews from "../../src/context_control/review-repository.js";

/** A persisted, claimed Assignment for actual restricted CLI reads. No worker is spawned. */
export async function reviewerSessionEnvironment(root: string, home: string, workspace: string, body: { contentType: string; text: string } = { contentType: "text/plain", text: "fixed candidate" }) {
  const service = (await openContextControl(root, true))!;
  const result = await service.withGraph(async g => {
    const start = await g.start({ name: "Reader", procedure: { tag: "!procedure", syntax: graphMemorySyntax, mode: "graph", names: ["reader"], defines: ["Reader"], actions: [{ tag: "!action", id: "review", description: "Read", dependencies: [{ tag: "!dependency", from: "START" }], artifact: { name: "Candidate", model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: body.contentType }, review: ["reader"] } }] }, controlPlane: { runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] }, actors: { reader: { kind: "agent", name: "Reader", permissions: ["artifact.read", "decision.assess"], agent: { provider: "test", providerType: "traex", command: process.execPath, args: [], env: {}, startupTimeoutMs: 10000, idleTimeoutMs: null, maxRuntimeMs: null } } }, acpProviders: {} }, reviewConfiguration: { reviews: { "reader#actions[review]": { policy: "artifact_acceptance.unanimous" } }, slots: { "reader::reader": { actorIds: ["reader"] } } } });
    await g.enter(start.run.id, start.steps[0].id); return g.report(start.run.id, start.steps[0].id, { text: body.text });
  });
  const input = { service, runsRoot: join(root, "runs"), reviewId: reviews.graphReviewHandle(result.snapshot.run.id, result.step.id), roundId: result.step.reviewRounds![0].id, actorId: "reader" };
  // This fixture starts an Assignment, not an OS Worker. Native Worker enrollment
  // is covered by the real worker/launcher suites.
  const claim = (await reviews.claimArtifactReviewAgentAssignment(input))!;
  return { MEMSPHERE_HOME: home, MEMSPHERE_CONFIG_PATH: join(root, "config.json"), MEMSPHERE_WORKSPACE_ROOT: workspace, MEMSPHERE_REVIEW_SOURCE_WORKSPACE: workspace, MEMSPHERE_REVIEW_RUN_ID: result.snapshot.run.id, MEMSPHERE_REVIEW_MEMORY_RUN_ID: result.snapshot.run.id, MEMSPHERE_REVIEW_ASSIGNMENT_ID: claim.assignment.id!, MEMSPHERE_REVIEW_ATTEMPT_ID: claim.attempt.id };
}

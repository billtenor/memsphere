

import assert from "node:assert/strict";

import test from "node:test";

import { join } from "node:path";

import { fileURLToPath } from "node:url";

import { runArtifactReviewAgentWorker } from "../src/acp/review-worker.js";

import { graphDomainFixture } from "./helpers/graph-domain.js";

import { businessFixture } from "./helpers/business-data.js";

import { initializedContextFixture } from "./helpers/initialized-context.js";

import { openContextControl } from "../src/project/context-control.js";

import { graphMemorySyntax } from "../src/memory/syntax.js";

import type { GraphProcedureMemory } from "../src/memory/ast.js";

import * as reviews from "../src/context_control/review-repository.js";

async function fixture(t: test.TestContext, agent = false, advisory = false, mixed = false, filesystem = false) {
  const f = filesystem ? await initializedContextFixture(t) : await businessFixture(t, {});
  const service = filesystem ? (await openContextControl(f.root))! : (await graphDomainFixture(t)).service;
  const actor = agent ? { kind: "agent" as const, name: "Agent", permissions: ["artifact.read" as const, "decision.assess" as const], agent: { provider: "test", providerType: "traex" as const, command: process.execPath, args: [fileURLToPath(new URL("./fixtures/fake-acp-reviewer.mjs", import.meta.url)), "approve"], env: {}, startupTimeoutMs: 10000, idleTimeoutMs: 10000 } } : { kind: "human" as const, name: "Human", permissions: ["artifact.read" as const, ...(advisory ? ["decision.assess" as const] : ["decision.decide" as const])] };
  const procedure: GraphProcedureMemory = { tag: "!procedure", syntax: graphMemorySyntax, mode: "graph", names: ["review-graph"], defines: ["Review"], actions: [{ tag: "!action", id: "A", description: "Deliver", dependencies: [{ tag: "!dependency", from: "START" }], artifact: { name: "Result", model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/markdown" }, review: ["approval"] } }] };
  const result = await service.withGraph(async g => {
    const start = await g.start({ name: "review", procedure, controlPlane: { runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] }, actors: { reviewer: actor, ...(mixed ? { human: { kind: "human" as const, name: "Human", permissions: ["artifact.read" as const, "decision.decide" as const] } } : {}) }, acpProviders: {} }, reviewConfiguration: { reviews: { "review-graph#actions[A]": { policy: "artifact_acceptance.unanimous" } }, slots: { "review-graph::approval": { actorIds: mixed ? ["reviewer", "human"] : ["reviewer"] } } } });
    await g.enter(start.run.id, start.steps[0].id); return g.report(start.run.id, start.steps[0].id, { text: "# Candidate" });
  });
  return { ...f, service, result, input: { service, runsRoot: join(f.root, "runs"), reviewId: reviews.graphReviewHandle(result.snapshot.run.id, result.step.id), roundId: result.step.reviewRounds![0].id, actorId: "reviewer" } };
}

test("graph ACP worker uses the real Session CLI to read the candidate and submit its assigned Review", { timeout: 60000 }, async t => {
  const f = await fixture(t, true, false, false, true);
  const oldHome = process.env.MEMSPHERE_HOME;
  process.env.MEMSPHERE_HOME = f.home;
  try {
    const initial = await reviews.readArtifactReviewForActor(f.input);
    await runArtifactReviewAgentWorker({ config: join(f.root, "config.json"), review: f.input.reviewId, round: f.input.roundId, assignment: initial.assignment.id!, nodeExecutable: process.execPath, cliEntrypoint: fileURLToPath(new URL("../dist/cli.js", import.meta.url)), providerResolver: () => ({ id: "traex", buildLaunch: ({ actor, workspaceRoot, sessionEnv }) => ({ provider: "fake-test-provider", command: actor.agent.command, args: actor.agent.args, cwd: workspaceRoot, env: { ...process.env, MEMSPHERE_HOME: f.home, ...sessionEnv }, startupTimeoutMs: 10000, idleTimeoutMs: 10000, maxRuntimeMs: null, promptVersion: "artifact-review-v1" }) }) });
    const result = await reviews.readArtifactReviewForActor(f.input);
    assert.equal(result.assignment.status, "submitted", JSON.stringify(result.assignment.attempts));
    assert.equal(result.assignment.submitted?.vote, "approve");
    assert.ok(result.assignment.attempts?.[0].cliReadyAt);
    assert.equal(result.round.status, "awaiting_runner_vote");
  } finally { if (oldHome === undefined) delete process.env.MEMSPHERE_HOME; else process.env.MEMSPHERE_HOME = oldHome; }
});
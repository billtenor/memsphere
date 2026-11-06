import type test from "node:test";
import type { GraphProcedureMemory, RulePart } from "../../src/memory/ast.js";
import { serializeMemoryYaml } from "../../src/memory/serializer.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { initializedContextFixture } from "./initialized-context.js";
import { businessFixture } from "./business-data.js";
import { withCurrentMemorySyntax } from "./memory.js";
import { reviewConfiguration } from "./review.js";
import { openContextControl } from "../../src/project/context-control.js";
import { graphMemorySyntax } from "../../src/memory/syntax.js";
import * as flow from "../../src/run/store.js";
import * as reviews from "../../src/context_control/review-repository.js";
export async function reviewNodeFixture(t: test.TestContext, graph: boolean, secondAgent = false, options: { reuseService?: boolean; statementRule?: boolean; project?: { fixture: Awaited<ReturnType<typeof businessFixture>>; service: NonNullable<Awaited<ReturnType<typeof openContextControl>>> } } = {}) {
  const f = options.project?.fixture ?? (graph ? await initializedContextFixture(t) : await businessFixture(t, {}));
  const controlPlane = { runner: { permissions: ["artifact.read" as const, "artifact.submit" as const, "decision.decide" as const] }, actors: { human: { kind: "human" as const, name: "Human", permissions: ["artifact.read" as const, "decision.decide" as const] }, agent: { kind: "agent" as const, name: "Agent", permissions: ["artifact.read" as const, "decision.assess" as const], agent: { provider: "test", providerType: "traex" as const, command: process.execPath, args: [], env: {}, startupTimeoutMs: 10000, idleTimeoutMs: 10000 } } } };
  const ruleFile = join(f.root, "memory/statements/checkpoint-rules.yaml");
  const ruleText = withCurrentMemorySyntax("!statement\nnames: [checkpoint-rules]\nasserts: [Frozen dependency rule.]\n");
  const rules: RulePart[] = options.statementRule ? [{ tag: "!ref", target: "statements/checkpoint-rules" }] : ["Check evidence", "Check scope"];
  if (options.statementRule) { await mkdir(join(f.root, "memory/statements"), { recursive: true }); await writeFile(ruleFile, ruleText); }
  if (secondAgent) Object.assign(controlPlane.actors, { agent2: structuredClone(controlPlane.actors.agent) });
  let input: { runsRoot: string; reviewId: string; roundId: string; actorId: string; service?: NonNullable<Awaited<ReturnType<typeof openContextControl>>> }, runId: string;
  if (graph) {
    const service = options.project?.service ?? (await openContextControl(f.root))!;
    const result = await service.withGraph(async g => {
      const procedure: GraphProcedureMemory = { tag: "!procedure", syntax: graphMemorySyntax, mode: "graph", names: ["p"], defines: ["Fixture procedure"], actions: [{ tag: "!action", id: "a", description: "Make result", asserts: rules, dependencies: [{ tag: "!dependency", from: "START" }], artifact: { name: "Result", model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/markdown" }, review: ["reviewer"] } }] };
      const memorySnapshot = options.statementRule ? { memories: {
        "procedures/p": { memoryRef: "procedures/p", payload: { contentType: "application/yaml", content: serializeMemoryYaml(procedure) } },
        "statements/checkpoint-rules": { memoryRef: "statements/checkpoint-rules", payload: { contentType: "application/yaml", content: ruleText } }
      } } : undefined;
      const start = await g.start({ name: "test", procedure, memorySnapshot, controlPlane, reviewConfiguration: { reviews: { "p#actions[a]": { policy: "artifact_acceptance.unanimous" } }, slots: { "p::reviewer": { actorIds: ["agent", "human", ...(secondAgent ? ["agent2"] : [])] } } } });
      await g.enter(start.run.id, start.steps[0].id);
      return g.report(start.run.id, start.steps[0].id, { text: "Candidate" });
    });
    // Reuse validated bindings; store reads still load current persisted records.
    runId = result.snapshot.run.id; input = { runsRoot: join(f.root, "runs"), reviewId: reviews.graphReviewHandle(runId, result.step.id), roundId: result.step.reviewRounds![0].id, actorId: "agent", ...(options.reuseService !== false ? { service } : {}) };
  } else {
    const memoryRoot = join(f.root, "memory"); await mkdir(join(memoryRoot, "procedures"), { recursive: true });
    await writeFile(join(memoryRoot, "procedures", "p.yaml"), withCurrentMemorySyntax(`!procedure\nname: p\nflow:\n  - !action\n    action: Make result\n    asserts: ${options.statementRule ? "\n      - !ref\n        target: statements/checkpoint-rules" : "[Check evidence, Check scope]"}\n    artifact: !artifact\n      name: Result\n      review: [reviewer]\n`));
    const started = await flow.startRun({ name: "test", memoryRoot, runsRoot: join(f.root, "runs"), procedureName: "p", controlPlane, reviewConfiguration: reviewConfiguration({ procedure: "p", slots: { reviewer: ["agent", "human", ...(secondAgent ? ["agent2"] : [])] } }) });
    const pending = await flow.reportRun({ runsRoot: join(f.root, "runs"), runId: started.id, artifact: { kind: "inline", value: "Candidate" } });
    const review = pending.artifactReviews![0]; runId = pending.id; input = { runsRoot: join(f.root, "runs"), reviewId: review.id, roundId: review.currentRoundId, actorId: "agent" };
  }
  const claimed = (await reviews.claimArtifactReviewAgentAssignment({ ...input, workerPid: process.pid }))!;
  const bound = { ...input, attemptId: claimed.attempt.id }; await reviews.markArtifactReviewAgentCliReady(bound);
  return { ...f, runId, input, bound, claimed, controlPlane, ruleFile };
}

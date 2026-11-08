// @integration-platform: native — verifies real filesystem, process or build-adapter behavior.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { reviewNodeFixture } from "./helpers/review-nodes.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";
import { reviewConfiguration } from "./helpers/review.js";
import { openContextControl } from "../src/project/context-control.js";
import { graphMemorySyntax } from "../src/memory/syntax.js";
import { serializeMemoryYaml } from "../src/memory/serializer.js";
import type { GraphProcedureMemory, StatementMemory } from "../src/memory/ast.js";
import * as flow from "../src/run/store.js";
import { allReviewNodes } from "../src/review-nodes.js";

for (const graph of [true, false]) for (const first of ["asserts", "suggests"] as const) test(`${graph ? "graph" : "flow"}: automatic frozen tree respects mixed Statement section declaration order (${first} first)`, async t => {
  const f = await reviewNodeFixture(t, graph), other = first === "asserts" ? "suggests" : "asserts";
  const statement: StatementMemory = { tag: "!statement", names: ["s"], defines: ["Statement scope"], sections: [
    { tag: "!statement", names: ["first"], defines: [], [first]: ["First rule"], sections: [
      { tag: "!statement", names: ["nested-first"], defines: [], [first]: ["Nested first rule"] },
      { tag: "!statement", names: ["nested-second"], defines: [], [other]: ["Nested second rule"] }
    ] },
    { tag: "!statement", names: ["second"], defines: [], [other]: ["Second rule"] }
  ] };
  let tree;
  if (graph) {
    const service = (await openContextControl(f.root))!;
    const ref = { tag: "!ref" as const, target: "statements/s" };
    const procedure: GraphProcedureMemory = { tag: "!procedure", syntax: graphMemorySyntax, mode: "graph", names: ["order"], defines: ["Declaration order"], actions: [{ tag: "!action", id: "a", description: "Produce", asserts: [ref], suggests: [ref], dependencies: [{ tag: "!dependency", from: "START" }], artifact: { name: "Candidate", model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/markdown" }, review: ["reviewer"] } }] };
    const result = await service.withGraph(async g => {
      const start = await g.start({ name: "Order", procedure, memorySnapshot: { memories: { "procedures/order": { memoryRef: "procedures/order", payload: { contentType: "application/yaml", content: serializeMemoryYaml(procedure) } }, "statements/s": { memoryRef: "statements/s", payload: { contentType: "application/yaml", content: withCurrentMemorySyntax(serializeMemoryYaml(statement)) } } } }, controlPlane: f.controlPlane, reviewConfiguration: { reviews: { "order#actions[a]": { policy: "artifact_acceptance.unanimous" } }, slots: { "order::reviewer": { actorIds: ["agent", "human"] } } } });
      await g.enter(start.run.id, start.steps[0].id); return g.report(start.run.id, start.steps[0].id, { text: "Candidate" });
    });
    tree = result.snapshot.reviews.find(r => r.reviewer.actorId === "agent")!.nodeTree!;
  } else {
    const memoryRoot = join(f.root, "memory"); await mkdir(join(memoryRoot, "statements"), { recursive: true });
    await writeFile(join(memoryRoot, "statements/s.yaml"), withCurrentMemorySyntax(serializeMemoryYaml(statement)));
    await writeFile(join(memoryRoot, "procedures/p.yaml"), withCurrentMemorySyntax(`!procedure\nnames: [p]\nflow:\n  - !action\n    action: Produce\n    asserts:\n      - !ref {target: statements/s}\n    suggests:\n      - !ref {target: statements/s}\n    artifact: !artifact {name: Candidate, review: [reviewer]}\n`));
    const start = await flow.startRun({ name: "Order", memoryRoot, runsRoot: f.input.runsRoot, procedureName: "p", controlPlane: f.controlPlane, reviewConfiguration: reviewConfiguration({ procedure: "p", slots: { reviewer: ["agent", "human"] } }) });
    const result = await flow.reportRun({ runsRoot: f.input.runsRoot, runId: start.id, artifact: { kind: "inline", value: "Candidate" } });
    tree = flow.currentArtifactReview(result)!.rounds[0].assignments.find(a => a.actorId === "agent")!.nodeTree!;
  }
  const nodes = allReviewNodes(tree).filter(n => n.source?.kind === "statement");
  assert.deepEqual(nodes.map(n => n.name), ["s", "first", "nested-first", "nested-second", "second"]);
  assert.deepEqual(nodes.slice(1).map(n => n.source!.path), ["sections[0]", "sections[0].sections[0]", "sections[0].sections[1]", "sections[1]"]);
  assert.deepEqual(nodes.slice(1).map(n => [...n.asserts, ...n.suggests][0].rulePath), [`sections[0].${first}[0]`, `sections[0].sections[0].${first}[0]`, `sections[0].sections[1].${other}[0]`, `sections[1].${other}[0]`]);
});

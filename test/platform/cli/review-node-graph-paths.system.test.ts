import assert from "node:assert/strict";
import test from "node:test";
import { reviewCliFixture } from "../../helpers/review-node-cli.js";
import { completeReview } from "../../helpers/review-node-materials.js";
import { openContextControl } from "../../../src/project/context-control.js";
import { graphMemorySyntax } from "../../../src/memory/syntax.js";
import { serializeMemoryYaml } from "../../../src/memory/serializer.js";
import type { GraphProcedureMemory, StatementMemory } from "../../../src/memory/ast.js";
import * as reviews from "../../../src/context_control/review-repository.js";
import { allReviewNodes } from "../../../src/review-nodes.js";

for (const index of [0, 1]) test(`graph actual Action ${index} and Artifact paths match frozen AST through persistence, CLI and revised rounds`, {timeout: 60000}, async t => {
  const f = await reviewCliFixture(t), service = (await openContextControl(f.root))!;
  const reference = { tag: "!ref" as const, target: "statements/path-rules" };
  const statement: StatementMemory = { tag: "!statement", syntax: graphMemorySyntax, names: ["path-rules"], defines: ["Rules"], asserts: ["Referenced rule"], suggests: ["Referenced advice"] };
  const procedure: GraphProcedureMemory = { tag: "!procedure", syntax: graphMemorySyntax, mode: "graph", names: ["paths"], defines: ["Paths"], actions: [
    ...(index ? [{ tag: "!action" as const, id: "input", description: "Input", dependencies: [{tag: "!dependency" as const, from: "START"}], artifact: {name: "Input", model: {definedBy: "raw.json", definition: "{}"}, payload: {contentType: "text/plain"}} }] : []),
    { tag: "!action", id: "reviewed", description: "Reviewed", asserts: ["Action requirement", reference], suggests: ["Action advice", reference], dependencies: [{tag: "!dependency", from: index ? "input" : "START"}], artifact: {name: "Candidate", asserts: ["Artifact requirement", reference], suggests: ["Artifact advice", reference], model: {definedBy: "raw.json", definition: "{}"}, payload: {contentType: "text/plain"}, review: ["reviewer"]} }
  ] };
  let result = await service.withGraph(async g => {
    const started = await g.start({ name: "Paths", procedure, controlPlane: f.controlPlane, reviewConfiguration: {reviews: {"paths#actions[reviewed]": {policy: "artifact_acceptance.unanimous"}}, slots: {"paths::reviewer": {actorIds: ["agent", "human"]}}}, memorySnapshot: {memories: {"procedures/paths": {memoryRef: "procedures/paths", payload: {contentType: "application/yaml", content: serializeMemoryYaml(procedure)}}, "statements/path-rules": {memoryRef: "statements/path-rules", payload: {contentType: "application/yaml", content: serializeMemoryYaml(statement)}}}} });
    let step = started.steps[0];
    if(index) {await g.enter(started.run.id, step.id); await g.report(started.run.id, step.id, {text: "Input"}); step=(await g.snapshot(started.run.id)).steps.find(s=>s.source?.actionId==="reviewed")!;}
    await g.enter(started.run.id,step.id);return g.report(started.run.id,step.id,{text:"Candidate"});
  });
  for(const roundNumber of [0,1]) {
    const input={runsRoot:f.input.runsRoot,reviewId:reviews.graphReviewHandle(result.snapshot.run.id,result.step.id),roundId:result.step.reviewRounds!.at(-1)!.id,actorId:"agent"};
    const claimed=(await reviews.claimArtifactReviewAgentAssignment({...input,workerPid:process.pid}))!;
    const bound={...input,attemptId:claimed.attempt.id};await reviews.markArtifactReviewAgentCliReady(bound);
    Object.assign(f.env,{MEMSPHERE_REVIEW_RUN_ID:result.snapshot.run.id,MEMSPHERE_REVIEW_ASSIGNMENT_ID:claimed.assignment.id!,MEMSPHERE_REVIEW_ATTEMPT_ID:bound.attemptId});
    const read=await reviews.readArtifactReviewForActor(input), nodes=allReviewNodes(read.assignment.nodeTree!);
    for(const suffix of ["", ".artifact"]) {
      const path=`actions[${index}]${suffix}`, node=nodes.find(n=>n.source?.path===path)!;
      assert.ok(node,`Round ${roundNumber}: ${path}`);assert.equal(node.source!.memoryRef,"procedures/paths");
      assert.deepEqual(node.asserts,[{rulePath:`${path}.asserts[0]`,text:suffix ? "Artifact requirement" : "Action requirement"}]);
      assert.deepEqual(node.suggests,[{rulePath:`${path}.suggests[0]`,text:suffix ? "Artifact advice" : "Action advice"}]);
      const shown=f.cli(["continue","show","--node",node.nodeId,"--output","json"]);
      assert.equal(shown.node.source.path,path);assert.deepEqual(shown.node.asserts,node.asserts);assert.deepEqual(shown.node.suggests,node.suggests);
    }
    assert.ok(nodes.some(n=>n.source?.memoryRef==="statements/path-rules"&&n.asserts[0]?.rulePath==="asserts[0]"));
    assert.doesNotMatch(JSON.stringify(nodes),/actions\[-1\]/);
    if(!roundNumber){await completeReview(bound);await reviews.submitArtifactReviewAgentAssignment({...bound,vote:"approve"});await service.withGraph(async g=>{await g.submitReview(result.snapshot.run.id,result.step.id,input.roundId,"runner","request_changes",[],"Revise");await g.enter(result.snapshot.run.id,result.step.id);});result=await service.withGraph(g=>g.report(result.snapshot.run.id,result.step.id,{text:"Revised",revisionSummary:"New candidate"}));}
  }
});

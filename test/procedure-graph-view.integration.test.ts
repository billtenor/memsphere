// @integration-platform: native — verifies real filesystem, process or build-adapter behavior.
import assert from "node:assert/strict";
import test from "node:test";



import { businessFixture } from "./helpers/business-data.js";
import { openContextControl } from "../src/project/context-control.js";



import { graphMemorySyntax } from "../src/memory/syntax.js";
import type { GraphProcedureMemory } from "../src/memory/ast.js";

test("graph overview reads neither artifact bodies nor reviews", async t=>{
  const f=await businessFixture(t,{}),service=(await openContextControl(f.root,true))!;
  const procedure:GraphProcedureMemory={tag:"!procedure",syntax:graphMemorySyntax,names:["lazy-graph"],mode:"graph",defines:["Lazy overview"],actions:[{tag:"!action",id:"A",description:"Prepare",dependencies:[{tag:"!dependency",from:"START"}],artifact:{name:"Result",model:{definedBy:"raw.json",definition:"{}"},payload:{contentType:"text/plain"}}}]};
  const run=await service.withGraph(async g=>{const started=await g.start({name:"Lazy",procedure,controlPlane:{runner:{permissions:["artifact.read","artifact.submit"]},actors:{},acpProviders:{}}});await g.enter(started.run.id,started.steps[0].id);await g.report(started.run.id,started.steps[0].id,{text:"body must stay lazy"});return started.run;});
  const savedArtifact=service.stores.artifact.get,savedReview=service.stores.review.list;
  service.stores.artifact.get=async()=>{throw Error("unexpected artifact read");};
  service.stores.review.list=async()=>{throw Error("unexpected review enumeration");};
  try{const view=await service.viewProjection(run.id,"overview");assert.ok(view);assert.equal(view.steps[0].status,"done");assert.deepEqual(view.artifacts,[]);assert.deepEqual(view.reviews,[]);assert.equal(view.steps[0].reviewRounds,undefined);}
  finally{service.stores.artifact.get=savedArtifact;service.stores.review.list=savedReview;}
  const detail=await service.viewProjection(run.id,"action","A");assert.equal(detail?.artifacts.length,1);assert.equal(detail?.artifacts[0].content,undefined);assert.deepEqual(detail?.reviews,[]);
});
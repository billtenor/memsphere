import assert from "node:assert/strict";
import test from "node:test";
import { graphDomainFixture } from "./helpers/graph-domain.js";
import type { GraphAction, GraphProcedureMemory } from "../src/memory/ast.js";
import { graphMemorySyntax } from "../src/memory/syntax.js";
import { graphEvidence } from "../src/context_control/graph-evidence.js";
const action = (id: string, from = "START", when?: string): GraphAction => ({ tag: "!action", id, description: id, dependencies: [{ tag: "!dependency", from, ...(when ? { when } : {}) }], artifact: { name: id, model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/plain" } } });
const procedure = (actions: GraphAction[]): GraphProcedureMemory => ({ tag: "!procedure", syntax: graphMemorySyntax, mode: "graph", names: ["evidence"], defines: ["Evidence"], actions });

for (const nonempty of [false, true]) test(`explicit dependencies validate ${nonempty ? "nonempty" : "empty"} collect data/control sources`, async t => {
 const { service } = await graphDomainFixture(t);
 await service.withGraph(async g => {
  const p = procedure([action("X"), action("B", "X", String(nonempty)), action("stop"), { tag: "!action", id: "gather", description: "Gather", dependencies: [{ tag: "!dependency", from: "stop" }], collect: ["B"] }, action("summary", "gather"), action("unrelated")]);
  const start = await g.start({ name: "empty control", procedure: p });
  async function produce(id: string, dependencies?: Array<{kind:"artifact"|"external";id:string}>) { const s=(await g.snapshot(start.run.id)).steps.find(s=>s.source?.actionId===id)!; await g.enter(start.run.id,s.id); return g.report(start.run.id,s.id,{text:id,dependencies}); }
  const x=await produce("X"), u=await produce("unrelated");
  const member=nonempty ? await produce("B") : undefined;
  const stop=await produce("stop");
  const snapshot=await g.snapshot(start.run.id), summary=snapshot.steps.find(s=>s.source?.actionId==='summary')!;
  assert.deepEqual(summary.inputs,{B:member ? [{kind:"artifact",id:member.artifact.id}] : []});
  const eligible=graphEvidence(snapshot,summary);
  assert.ok(eligible.has(x.artifact.id)); assert.ok(eligible.has(stop.artifact.id)); assert.ok(!eligible.has(u.artifact.id));
  await g.enter(start.run.id,summary.id);
  await assert.rejects(g.report(start.run.id,summary.id,{text:"invalid null",dependencies:null as any}),/dependencies must contain/);
  await assert.rejects(g.report(start.run.id,summary.id,{text:'bad',dependencies:[{kind:'artifact',id:u.artifact.id}]}),/outside this Step/);
  assert.equal((await g.snapshot(start.run.id)).artifacts.length,snapshot.artifacts.length);
  const result=await g.report(start.run.id,summary.id,{text:'summary',dependencies:[{kind:'artifact',id:x.artifact.id},{kind:'artifact',id:stop.artifact.id}]});
  assert.deepEqual(result.artifact.dependencies,[...(member ? [{kind:"artifact",id:member.artifact.id}] : []),{kind:'artifact',id:x.artifact.id},{kind:'artifact',id:stop.artifact.id}]);
  assert.deepEqual(result.step.inputs,summary.inputs);
  const preview=await g.rewindPreview(start.run.id,x.step.id);
  assert.ok(preview.affectedStepIds.includes(summary.id));
 });
});

test("graph revision inherits supplemental External, empty clears it, replacement preserves old Review versions", async t => {
 const {service}=await graphDomainFixture(t);
 await service.withGraph(async g=>{
  const a=action('A'); a.artifact!.review=['approval'];
  const start=await g.start({name:'revisions',procedure:procedure([action('input'),a]),controlPlane:{runner:{permissions:['artifact.read','artifact.submit','decision.decide']},actors:{human:{kind:'human',name:'Human',permissions:['artifact.read','decision.assess']}},acpProviders:{}},reviewConfiguration:{reviews:{'evidence#actions[A]':{policy:'artifact_acceptance.unanimous'}},slots:{'evidence::approval':{actorIds:['human']}}}});
  const input=start.steps.find(s=>s.source?.actionId==='input')!; await g.enter(start.run.id,input.id); const i=await g.report(start.run.id,input.id,{text:'unrelated'});
  const step=start.steps.find(s=>s.source?.actionId==='A')!; await g.enter(start.run.id,step.id);
  const body={content:{model:{definedBy:'raw.json',definition:'{}'},payload:{contentType:'text/plain',content:'external'}}};
  const e1=await service.addExternal(start.run.id,'E1',body), e2=await service.addExternal(start.run.id,'E2',body);
  const first=await g.report(start.run.id,step.id,{text:'first',dependencies:[{kind:'external',id:e1.id}]});
  async function reject(result:typeof first){ await g.submitReview(start.run.id,step.id,result.step.reviewRounds!.at(-1)!.id,'runner','request_changes',[],'revise'); }
  await reject(first);
  const inherited=await g.report(start.run.id,step.id,{text:'second',revisionSummary:'inherit'}); assert.deepEqual(inherited.artifact.dependencies,first.artifact.dependencies);
  await reject(inherited);
  const cleared=await g.report(start.run.id,step.id,{text:'third',revisionSummary:'clear',dependencies:[]}); assert.deepEqual(cleared.artifact.dependencies,[]);
  await reject(cleared);
  const replaced=await g.report(start.run.id,step.id,{text:'fourth',revisionSummary:'replace',dependencies:[{kind:'external',id:e2.id}]}); assert.deepEqual(replaced.artifact.dependencies,[{kind:'external',id:e2.id}]);
  const old=await g.reviewSnapshot(start.run.id,step.id,first.step.reviewRounds![0].id);
  assert.deepEqual(old.externals.map(e=>e.id),[e1.id]);
  const current=await g.reviewSnapshot(start.run.id,step.id,'current'); assert.deepEqual(current.externals.map(e=>e.id),[e2.id]);
  assert.equal((await g.readArtifact(start.run.id,first.artifact.id)).bytes.toString(),'first');
  assert.ok(!current.artifacts.some(a=>a.id===i.artifact.id));
 });
});

test("loop and rewind acceptance snapshots pin concrete requirements and never drift to the latest Action", async t => {
 const {service}=await graphDomainFixture(t);
 await service.withGraph(async g=>{
  const requirement=action('requirements');requirement.dependencies.push({tag:'!dependency',from:'again',when:'artifacts.again = true'});
  const acceptance=action('acceptance','requirements');acceptance.artifact!.review=['check'];
  const again=action('again','acceptance');again.artifact={name:'Again',model:{definedBy:'json-schema/draft-07.json',definition:'{"type":"boolean"}'},payload:{contentType:'application/json'}};
  const start=await g.start({name:'loop evidence',procedure:procedure([requirement,acceptance,again]),controlPlane:{runner:{permissions:['artifact.read','artifact.submit','decision.decide']},actors:{human:{kind:'human',name:'Human',permissions:['artifact.read','decision.decide']}},acpProviders:{}},reviewConfiguration:{reviews:{'evidence#actions[acceptance]':{policy:'artifact_acceptance.unanimous'}},slots:{'evidence::check':{actorIds:['human']}}}});
  const active=async(id:string)=>(await g.snapshot(start.run.id)).steps.find(s=>s.source?.actionId===id&&s.status==='pending');
  async function produce(id:string,text:string,dependencies?:Array<{kind:'artifact'|'external';id:string}>){const s=(await active(id))!;assert.ok(s);await g.enter(start.run.id,s.id);return g.report(start.run.id,s.id,{text,dependencies});}
  async function accept(result:Awaited<ReturnType<typeof produce>>){const round=result.step.reviewRounds!.at(-1)!;await g.submitReview(start.run.id,result.step.id,round.id,'human','approve');await g.submitReview(start.run.id,result.step.id,round.id,'runner','approve');}
  const r1=await produce('requirements','requirements v1'),c1=await produce('acceptance','acceptance v1');await accept(c1);
  await produce('again','true');const r2=await produce('requirements','requirements v2'),c2=await produce('acceptance','acceptance v2');
  const oldRound=c1.step.reviewRounds![0].id;
  const old=await g.reviewSnapshot(start.run.id,c1.step.id,oldRound),current=await g.reviewSnapshot(start.run.id,c2.step.id,'current');
  assert.ok(old.artifacts.some(a=>a.id===r1.artifact.id));assert.ok(!old.artifacts.some(a=>a.id===r2.artifact.id));
  assert.ok(current.artifacts.some(a=>a.id===r2.artifact.id));assert.ok(!current.artifacts.some(a=>a.id===r1.artifact.id));
  const rewind=await g.rewind(start.run.id,r1.step.id,'new confirmed requirements');
  await g.enter(start.run.id,rewind.replacementStepId);const r3=await g.report(start.run.id,rewind.replacementStepId,{text:'requirements after rewind'});
  const c3=await produce('acceptance','acceptance after rewind');
  const replacement=await g.reviewSnapshot(start.run.id,c3.step.id,'current');assert.ok(replacement.artifacts.some(a=>a.id===r3.artifact.id));assert.ok(!replacement.artifacts.some(a=>a.id===r2.artifact.id));
  const history=await g.reviewSnapshot(start.run.id,c1.step.id,oldRound);assert.ok(history.artifacts.some(a=>a.id===r1.artifact.id));assert.equal((await g.readArtifact(start.run.id,r1.artifact.id)).bytes.toString(),'requirements v1');
 });
});

test("graph revision independently verifies External inherit", async t=>{
 const {service}=await graphDomainFixture(t);
 await service.withGraph(async g=>{
  const a=action('A'); a.artifact!.review=['approval'];
  const start=await g.start({name:'revisions',procedure:procedure([action('input'),a]),controlPlane:{runner:{permissions:['artifact.read','artifact.submit','decision.decide']},actors:{human:{kind:'human',name:'Human',permissions:['artifact.read','decision.assess']}},acpProviders:{}},reviewConfiguration:{reviews:{'evidence#actions[A]':{policy:'artifact_acceptance.unanimous'}},slots:{'evidence::approval':{actorIds:['human']}}}});
  const input=start.steps.find(s=>s.source?.actionId==='input')!; await g.enter(start.run.id,input.id); const i=await g.report(start.run.id,input.id,{text:'unrelated'});
  const step=start.steps.find(s=>s.source?.actionId==='A')!; await g.enter(start.run.id,step.id);
  const body={content:{model:{definedBy:'raw.json',definition:'{}'},payload:{contentType:'text/plain',content:'external'}}};
  const e1=await service.addExternal(start.run.id,'E1',body), e2=await service.addExternal(start.run.id,'E2',body);
  const first=await g.report(start.run.id,step.id,{text:'first',dependencies:[{kind:'external',id:e1.id}]});
  async function reject(result:typeof first){ await g.submitReview(start.run.id,step.id,result.step.reviewRounds!.at(-1)!.id,'runner','request_changes',[],'revise'); }
  await reject(first);
  const revised=await g.report(start.run.id,step.id,{text:'revised',revisionSummary:'inherit'});
  assert.deepEqual(revised.artifact.dependencies,first.artifact.dependencies);
  const old=await g.reviewSnapshot(start.run.id,step.id,first.step.reviewRounds![0].id);assert.deepEqual(old.externals.map(e=>e.id),[e1.id]);
 });
});

test("graph revision independently verifies External clear", async t=>{
 const {service}=await graphDomainFixture(t);
 await service.withGraph(async g=>{
  const a=action('A'); a.artifact!.review=['approval'];
  const start=await g.start({name:'revisions',procedure:procedure([action('input'),a]),controlPlane:{runner:{permissions:['artifact.read','artifact.submit','decision.decide']},actors:{human:{kind:'human',name:'Human',permissions:['artifact.read','decision.assess']}},acpProviders:{}},reviewConfiguration:{reviews:{'evidence#actions[A]':{policy:'artifact_acceptance.unanimous'}},slots:{'evidence::approval':{actorIds:['human']}}}});
  const input=start.steps.find(s=>s.source?.actionId==='input')!; await g.enter(start.run.id,input.id); const i=await g.report(start.run.id,input.id,{text:'unrelated'});
  const step=start.steps.find(s=>s.source?.actionId==='A')!; await g.enter(start.run.id,step.id);
  const body={content:{model:{definedBy:'raw.json',definition:'{}'},payload:{contentType:'text/plain',content:'external'}}};
  const e1=await service.addExternal(start.run.id,'E1',body), e2=await service.addExternal(start.run.id,'E2',body);
  const first=await g.report(start.run.id,step.id,{text:'first',dependencies:[{kind:'external',id:e1.id}]});
  async function reject(result:typeof first){ await g.submitReview(start.run.id,step.id,result.step.reviewRounds!.at(-1)!.id,'runner','request_changes',[],'revise'); }
  await reject(first);
  const revised=await g.report(start.run.id,step.id,{text:'revised',revisionSummary:'clear',dependencies:[]});
  assert.deepEqual(revised.artifact.dependencies,[]);
  const old=await g.reviewSnapshot(start.run.id,step.id,first.step.reviewRounds![0].id);assert.deepEqual(old.externals.map(e=>e.id),[e1.id]);
 });
});

test("graph revision independently verifies External replace", async t=>{
 const {service}=await graphDomainFixture(t);
 await service.withGraph(async g=>{
  const a=action('A'); a.artifact!.review=['approval'];
  const start=await g.start({name:'revisions',procedure:procedure([action('input'),a]),controlPlane:{runner:{permissions:['artifact.read','artifact.submit','decision.decide']},actors:{human:{kind:'human',name:'Human',permissions:['artifact.read','decision.assess']}},acpProviders:{}},reviewConfiguration:{reviews:{'evidence#actions[A]':{policy:'artifact_acceptance.unanimous'}},slots:{'evidence::approval':{actorIds:['human']}}}});
  const input=start.steps.find(s=>s.source?.actionId==='input')!; await g.enter(start.run.id,input.id); const i=await g.report(start.run.id,input.id,{text:'unrelated'});
  const step=start.steps.find(s=>s.source?.actionId==='A')!; await g.enter(start.run.id,step.id);
  const body={content:{model:{definedBy:'raw.json',definition:'{}'},payload:{contentType:'text/plain',content:'external'}}};
  const e1=await service.addExternal(start.run.id,'E1',body), e2=await service.addExternal(start.run.id,'E2',body);
  const first=await g.report(start.run.id,step.id,{text:'first',dependencies:[{kind:'external',id:e1.id}]});
  async function reject(result:typeof first){ await g.submitReview(start.run.id,step.id,result.step.reviewRounds!.at(-1)!.id,'runner','request_changes',[],'revise'); }
  await reject(first);
  const revised=await g.report(start.run.id,step.id,{text:'revised',revisionSummary:'replace',dependencies:[{kind:'external',id:e2.id}]});
  assert.deepEqual(revised.artifact.dependencies,[{kind:'external',id:e2.id}]);
  const old=await g.reviewSnapshot(start.run.id,step.id,first.step.reviewRounds![0].id);assert.deepEqual(old.externals.map(e=>e.id),[e1.id]);
 });
});

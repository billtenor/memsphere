import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { openContextControl } from "../src/project/context-control.js";
import { businessFixture } from "./helpers/business-data.js";
import type { GraphAction, GraphProcedureMemory } from "../src/memory/ast.js";
import type { GraphRuntime } from "../src/context_control/graph-runtime.js";
import type { Step } from "../src/context_control/types.js";
import { effectiveStep } from "../src/context_control/graph-rewind.js";

const artifact = { name: "Result", model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/plain" } };
const action = (id: string, from: string | string[] = "START", when?: string): GraphAction => ({ tag: "!action", id, description: id, dependencies: [{ tag: "!dependency", from, ...(when ? { when } : {}) }], artifact });
const procedure = (actions: GraphAction[]): GraphProcedureMemory => ({ tag: "!procedure", syntax: "memsphere-20261027-stable", names: ["rewind-test"], defines: ["Rewind"], mode: "graph", actions });
async function fixture(t: TestContext) { const f = await businessFixture(t, {}); return { ...f, service: (await openContextControl(f.root, true))! }; }
async function produce(g: GraphRuntime, run: string, step: string, text = "body") { await g.enter(run, step); return g.report(run, step, { text }); }
const latest = (steps: Step[], id: string) => steps.filter(s => s.source?.actionId === id).sort((a,b) => a.createdAt.localeCompare(b.createdAt)).at(-1)!;

test("rewind creates a pending product version and retains exact old dependencies while replacing downstream", async t => {
  const f = await fixture(t);
  await f.service.withGraph(async g => {
    const start = await g.start({ name: "versions", procedure: procedure([action("product"), action("technical", "product")]) });
    const old = await produce(g, start.run.id, start.steps[0].id, "P1");
    const technical = latest(old.snapshot.steps, "technical"); await g.enter(start.run.id, technical.id);
    const before = await g.snapshot(start.run.id);
    const preview = await g.rewindPreview(start.run.id, old.step.id);
    assert.deepEqual(await g.snapshot(start.run.id), before); assert.ok(preview.affectedStepIds.includes(technical.id));
    const result = await g.rewind(start.run.id, old.step.id, "P1 is wrong");
    assert.equal(latest(result.snapshot.steps, "product").status, "pending");
    await assert.rejects(g.report(start.run.id, technical.id, { text: "old T" }), { code: "STEP_SUPERSEDED" });
    assert.equal(Buffer.from((await g.readArtifact(start.run.id, old.artifact.id)).bytes).toString(), "P1");
    const fresh = await produce(g, start.run.id, result.replacementStepId, "P2");
    assert.equal(fresh.artifact.revisedFrom, old.artifact.id);
    assert.deepEqual(fresh.snapshot.steps.find(s => s.source?.actionId === "technical" && effectiveStep(fresh.snapshot.run, s.id))!.inputs, { product: [{ kind: "artifact", id: fresh.artifact.id }] });
    assert.deepEqual(fresh.snapshot.artifacts.find(a => a.id === old.artifact.id), old.artifact);
    assert.ok(!fresh.snapshot.completeIds.includes(old.artifact.id));
  });
});

test("rewind restores a consumed independent B input and creates C exactly once", async t => {
  const f = await fixture(t);
  await f.service.withGraph(async g => {
    const start = await g.start({ name: "join", procedure: procedure([action("A"), action("B"), action("C", ["A", "B"])]) });
    const a = await produce(g, start.run.id, latest(start.steps, "A").id);
    const b = await produce(g, start.run.id, latest(start.steps, "B").id);
    await produce(g, start.run.id, latest(b.snapshot.steps, "C").id);
    const result = await g.rewind(start.run.id, a.step.id, "revise A");
    const a2 = await produce(g, start.run.id, result.replacementStepId);
    const cs = a2.snapshot.steps.filter(s => s.source?.actionId === "C" && effectiveStep(a2.snapshot.run, s.id));
    assert.equal(cs.length, 1); assert.deepEqual(cs[0].inputs, { B: [{ kind: "artifact", id: b.artifact.id }], A: [{ kind: "artifact", id: a2.artifact.id }] });
    assert.equal(a2.snapshot.steps.filter(s => s.source?.actionId === "B").length, 1);
    assert.deepEqual((await g.advance(start.run.id)).steps, a2.snapshot.steps);
  });
});

for (const direction of ["false-true", "true-false"]) test(`rewind reevaluates ${direction} conditions and retains false history`, async t => {
  const f = await fixture(t);
  await f.service.withGraph(async g => {
    const start = await g.start({ name: direction, procedure: procedure([action("A"), action("C", "A", 'artifacts.A = "yes"')]) });
    const old = await produce(g, start.run.id, start.steps[0].id, direction === "false-true" ? "no" : "yes");
    const result = await g.rewind(start.run.id, old.step.id, "change condition");
    const fresh = await produce(g, start.run.id, result.replacementStepId, direction === "false-true" ? "yes" : "no");
    assert.equal(fresh.snapshot.steps.filter(s => s.source?.actionId === "C" && effectiveStep(fresh.snapshot.run, s.id)).length, direction === "false-true" ? 1 : 0);
    assert.ok(fresh.snapshot.run.frames![0].graphFrame.triggers.some(t => t.inputs !== undefined));
  });
});

test("collect with independent stop waits for the replacement member and preserves other members", async t => {
  const f = await fixture(t);
  await f.service.withGraph(async g => {
    const gather: GraphAction = { tag: "!action", id: "gather", description: "collect", dependencies: [{ tag: "!dependency", from: "stop" }], collect: ["A", "B"] };
    const start = await g.start({ name: "collect", procedure: procedure([action("A"), action("B"), action("stop"), gather, action("summary", "gather")]) });
    const a = await produce(g, start.run.id, latest(start.steps, "A").id, "A1");
    const b = await produce(g, start.run.id, latest(start.steps, "B").id, "B1");
    const stopped = await produce(g, start.run.id, latest(start.steps, "stop").id);
    const result = await g.rewind(start.run.id, a.step.id, "new member");
    for (let i = 0; i < 2; i++) {
      const waiting = await g.advance(start.run.id);
      assert.equal(waiting.steps.filter(s => s.source?.actionId === "gather" && effectiveStep(waiting.run, s.id)).length, 0);
    }
    const fresh = await produce(g, start.run.id, result.replacementStepId, "A2");
    const current = fresh.snapshot.steps.find(s => s.source?.actionId === "gather" && effectiveStep(fresh.snapshot.run, s.id))!;
    assert.deepEqual(current.artifact, { mode: "collect", items: { A: [fresh.artifact.id], B: [b.artifact.id] } });
    assert.equal(fresh.snapshot.steps.filter(s => s.source?.actionId === "stop").length, 1);
    assert.ok(fresh.snapshot.run.frames![0].graphFrame.processedStepIds.includes(stopped.step.id));
    assert.equal(fresh.snapshot.run.frames![0].graphFrame.deferredCollects?.length, 0);
  });
});

test("rewind blocks an old formal review and preserves its candidate and comments", async t => {
  const f = await fixture(t);
  await f.service.withGraph(async g => {
    const technical = action("T", "A"); technical.artifact = { ...artifact, review: ["architect"] };
    const start = await g.start({ name: "review", procedure: procedure([action("A"), technical]), controlPlane: { runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] }, actors: { human: { kind: "human", name: "Architect", permissions: ["artifact.read", "decision.decide"] } } }, reviewConfiguration: { reviews: { "rewind-test#actions[T]": { policy: "artifact_acceptance.unanimous" } }, slots: { "rewind-test::architect": { actorIds: ["human"] } } } });
    const a = await produce(g, start.run.id, start.steps[0].id);
    const old = await produce(g, start.run.id, latest(a.snapshot.steps, "T").id, "old candidate");
    const round = old.step.reviewRounds![0];
    await g.mutateReview(start.run.id, old.step.id, round.id, "human", async r => { r.comments = [{ id: "draft", body: "Keep this", createdAt: round.createdAt }]; });
    await g.rewind(start.run.id, a.step.id, "bad A");
    await assert.rejects(g.submitReview(start.run.id, old.step.id, round.id, "human", "approve"), { code: "STEP_SUPERSEDED" });
    const snapshot = await g.snapshot(start.run.id);
    assert.equal(snapshot.reviews.find(r => r.roundId === round.id)!.comments[0].body, "Keep this");
    assert.equal(Buffer.from((await g.readArtifact(start.run.id, old.artifact.id)).bytes).toString(), "old candidate");
  });
});

test("a saved rewind recovers the same target after materialization interruption", async t => {
  const f = await fixture(t);
  await f.service.withGraph(async g => {
    const start = await g.start({ name: "recovery", procedure: procedure([action("A")]) });
    const old = await produce(g, start.run.id, start.steps[0].id);
    const create = f.service.stores.step.create.bind(f.service.stores.step);
    f.service.stores.step.create = async () => { throw Error("interrupted materialization"); };
    await assert.rejects(g.rewind(start.run.id, old.step.id, "fix"), /interrupted materialization/);
    f.service.stores.step.create = create;
    const expected = (await g.snapshot(start.run.id)).run.frames![0].graphFrame.rewinds![0].replacementStepId;
    const recovered = await g.advance(start.run.id);
    assert.equal(recovered.steps.filter(s => s.id === expected).length, 1);
    assert.equal(latest(recovered.steps, "A").status, "pending");
    assert.deepEqual((await g.advance(start.run.id)).steps, recovered.steps);
    await assert.rejects(g.rewind(start.run.id, old.step.id, "duplicate"), { code: "STEP_SUPERSEDED" });
  });
});

for (const waiting of [false, true]) test(`rewind uses actual dispatch rank across a cycle${waiting ? ' and newer waiting partner' : ''}`, async t => {
  const f = await fixture(t);
  await f.service.withGraph(async g => {
    const a = action('A'); a.dependencies.push({tag:'!dependency',from:'C'});
    const b = action('B'); b.dependencies.push({tag:'!dependency',from:'tick'}); b.dependencies.push({tag:'!dependency',from:'tick2'});
    const start = await g.start({name:'ranks',procedure:procedure([a,b,action('tick'),action('tick2'),action('C',['A','B'])])});
    const a1 = await produce(g,start.run.id,latest(start.steps,'A').id);
    const b1 = latest(start.steps,'B');
    const tick = await produce(g,start.run.id,latest(start.steps,'tick').id);
    const b2 = await produce(g,start.run.id,latest(tick.snapshot.steps,'B').id);
    const c1 = await produce(g,start.run.id,latest(b2.snapshot.steps,'C').id);
    const a2 = await produce(g,start.run.id,latest(c1.snapshot.steps,'A').id);
    const lateB1 = await produce(g,start.run.id,b1.id);
    let selectedB = lateB1.artifact.id;
    if(waiting) {
      const tick3 = await produce(g,start.run.id,latest(start.steps,'tick2').id);
      const b3 = await produce(g,start.run.id,latest(tick3.snapshot.steps,'B').id);
      selectedB = b3.artifact.id;
    }
    assert.ok(lateB1.snapshot.run.frames![0].graphFrame.processedStepIds.indexOf(b2.step.id) < lateB1.snapshot.run.frames![0].graphFrame.processedStepIds.indexOf(b1.id));
    const rewound = await g.rewind(start.run.id,a1.step.id,'replace first A');
    assert.ok(rewound.affectedStepIds.includes(a2.step.id));
    const fresh = await produce(g,start.run.id,rewound.replacementStepId);
    const cs = fresh.snapshot.steps.filter(s=>s.source?.actionId==='C' && effectiveStep(fresh.snapshot.run,s.id));
    assert.equal(cs.length,1); assert.deepEqual(cs[0].inputs?.B,[{kind:'artifact',id:selectedB}]);
    const again = await g.rewind(start.run.id,fresh.step.id,'second replacement');
    const fresh2 = await produce(g,start.run.id,again.replacementStepId);
    assert.equal(fresh2.snapshot.steps.filter(s=>s.source?.actionId==='C' && effectiveStep(fresh2.snapshot.run,s.id)).length,1);
  });
});

for (const removed of [false,true]) test(`collect waits for a descendant member${removed ? ' eliminated by when' : ''} across repeated rewinds`, async t=>{
 const f=await fixture(t);
 await f.service.withGraph(async g=>{
  const gather:GraphAction={tag:'!action',id:'gather',description:'collect',dependencies:[{tag:'!dependency',from:'stop'}],collect:['B']};
  const start=await g.start({name:'descendants',procedure:procedure([action('A'),action('B','A','artifacts.A = "yes"'),action('stop'),gather,action('summary','gather')])});
  const a=await produce(g,start.run.id,latest(start.steps,'A').id,'yes');
  await produce(g,start.run.id,latest(a.snapshot.steps,'B').id);
  await produce(g,start.run.id,latest(start.steps,'stop').id);
  const rewind=await g.rewind(start.run.id,a.step.id,'replace root');
  await g.enter(start.run.id,rewind.replacementStepId);
  const rewind2=await g.rewind(start.run.id,rewind.replacementStepId,'replace pending work');
  const fresh=await produce(g,start.run.id,rewind2.replacementStepId,removed?'no':'yes');
  if(!removed){
   assert.equal(fresh.snapshot.steps.filter(s=>s.source?.actionId==='gather'&&effectiveStep(fresh.snapshot.run,s.id)).length,0);
   const b=await produce(g,start.run.id,latest(fresh.snapshot.steps,'B').id);
   assert.deepEqual(b.snapshot.steps.find(s=>s.source?.actionId==='gather'&&effectiveStep(b.snapshot.run,s.id))!.artifact,{mode:'collect',items:{B:[b.artifact.id]}});
  }else assert.deepEqual(fresh.snapshot.steps.find(s=>s.source?.actionId==='gather'&&effectiveStep(fresh.snapshot.run,s.id))!.artifact,{mode:'collect',items:{B:[]}});
 });
});

test('rewind preserves dispatch order when reserved completion numbers reach done in reverse order',{timeout:20000},async t=>{
 const f=await fixture(t);
 await f.service.withGraph(async g=>{
  const b=action('B');b.dependencies.push({tag:'!dependency',from:'tick'});
  const start=await g.start({name:'reserved order',procedure:procedure([action('A'),b,action('tick'),action('C',['A','B'])])});
  const a=await produce(g,start.run.id,latest(start.steps,'A').id);
  const tick=await produce(g,start.run.id,latest(start.steps,'tick').id);
  const b1=latest(start.steps,'B'),b2=latest(tick.snapshot.steps,'B');
  await g.enter(start.run.id,b1.id);await g.enter(start.run.id,b2.id);
  let scanned!:()=>void,resumeScan!:()=>void,held!:()=>void,resumeDone!:()=>void;
  const scan=new Promise<void>(r=>scanned=r),scanGate=new Promise<void>(r=>resumeScan=r),done=new Promise<void>(r=>held=r),doneGate=new Promise<void>(r=>resumeDone=r);
  const list=g.records.list.bind(g.records),update=g.records.update.bind(g.records);
  let pauseScan=true;
  g.records.list=async(...args:any[])=>{const result=await (list as any)(...args);if(args[0]==='step'&&pauseScan){pauseScan=false;scanned();await scanGate;}return result;};
  g.records.update=async(...args:any[])=>{if(args[0]==='step'&&args[3].id===b1.id&&args[3].status==='done'){held();await doneGate;}return (update as any)(...args);};
  const advance=g.advance.bind(g);
  const advancing=advance(start.run.id);
  await scan;
  const first=g.report(start.run.id,b1.id,{text:'B1'});
  await done;
  g.advance=async()=>advancing;
  let b2Saved!:()=>void;
  const saved=new Promise<void>(r=>b2Saved=r);
  const heldUpdate=g.records.update.bind(g.records);
  g.records.update=async(...args:any[])=>{const result=await (heldUpdate as any)(...args);if(args[0]==='step'&&args[3].id===b2.id&&args[3].status==='done')b2Saved();return result;};
  const second=g.report(start.run.id,b2.id,{text:'B2'});
  await saved;resumeScan();await second;g.advance=advance;resumeDone();const late=await first;
  g.records.list=list;g.records.update=update;
  const steps=late.snapshot.steps;
  assert.ok(steps.find(s=>s.id===b1.id)!.completionSequence! < steps.find(s=>s.id===b2.id)!.completionSequence!);
  const processed=late.snapshot.run.frames![0].graphFrame.processedStepIds;
  assert.ok(processed.indexOf(b2.id)<processed.indexOf(b1.id));
  const rewind=await g.rewind(start.run.id,a.step.id,'new A');
  const fresh=await produce(g,start.run.id,rewind.replacementStepId);
  const current=fresh.snapshot.steps.filter(s=>s.source?.actionId==='C'&&effectiveStep(fresh.snapshot.run,s.id));
  assert.equal(current.length,1);assert.deepEqual(current[0].inputs?.B,[{kind:'artifact',id:late.artifact.id}]);
 });
});

test('a late report after the rewind CAS remains history and cannot dispatch current work',async t=>{
 const f=await fixture(t);
 await f.service.withGraph(async g=>{
  const start=await g.start({name:'late report',procedure:procedure([action('A'),action('T','A'),action('end','T')])});
  const a=await produce(g,start.run.id,latest(start.steps,'A').id);
  const technical=latest(a.snapshot.steps,'T');await g.enter(start.run.id,technical.id);
  const update=g.records.update.bind(g.records);let entered!:()=>void,release!:()=>void;
  const held=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);let once=true;
  g.records.update=async(...args:any[])=>{if(once&&args[0]==='step'&&args[3].id===technical.id&&args[3].frames?.length){once=false;entered();await gate;}return (update as any)(...args);};
  const report=g.report(start.run.id,technical.id,{text:'late T'});await held;
  const rewind=await g.rewind(start.run.id,a.step.id,'new product');release();
  await assert.rejects(report,{code:'STEP_SUPERSEDED'});g.records.update=update;
  const snapshot=await g.advance(start.run.id);
  assert.equal(snapshot.steps.filter(s=>s.source?.actionId==='end').length,0);
  assert.equal(snapshot.steps.find(s=>s.id===rewind.replacementStepId)!.status,'pending');
 });
});

test('current outputs cannot resurrect a superseded accepted artifact',async t=>{
 const f=await fixture(t);
 const old=await f.service.withGraph(async g=>{const s=await g.start({name:'outputs',procedure:procedure([action('A')])});return produce(g,s.run.id,s.steps[0].id);});
 await f.service.updateOutputs(old.snapshot.run.id,[old.artifact.id],[]);
 await f.service.withGraph(g=>g.rewind(old.snapshot.run.id,old.step.id,'replace output'));
 assert.deepEqual(await f.service.outputs(old.snapshot.run.id),[]);
 await assert.rejects(f.service.updateOutputs(old.snapshot.run.id,[old.artifact.id],[]),{code:'STEP_SUPERSEDED'});
 await assert.rejects(f.service.finish(old.snapshot.run.id,[old.artifact.id]),{code:'GRAPH_INCOMPLETE'});
});

for (const operation of ["outputs", "finish"] as const) for (const boundary of ["before", "after"] as const) {
 test(`${operation} rejects all added outputs when rewind wins ${boundary} the validated Run read`, { timeout: 20000 }, async t => {
  const f = await fixture(t);
  await f.service.withGraph(async g => {
   const start = await g.start({ name: "output race", procedure: procedure([action("A"), action("B")]) });
   const a = await produce(g, start.run.id, latest(start.steps, "A").id, "A1");
   const b = await produce(g, start.run.id, latest(start.steps, "B").id, "B1");
   const runId = start.run.id;
   let entered!: () => void, release!: () => void;
   const held = new Promise<void>(resolve => entered = resolve);
   const gate = new Promise<void>(resolve => release = resolve);
   const store = f.service.stores.run, get = store.get.bind(store);
   const updateOutputs = f.service.updateOutputs.bind(f.service);
   // Install only around the shared output operation, including finish's explicit roots.
   f.service.updateOutputs = async (...args) => {
    let reads = 0;
    store.get = async (...readArgs) => {
     if (++reads !== 2) return get(...readArgs);
     store.get = get; // Rewind uses normal Store reads while this call is suspended.
     if (boundary === "before") { entered(); await gate; return get(...readArgs); }
     const row = await get(...readArgs);
     entered(); await gate; return row;
    };
    try { return await updateOutputs(...args); }
    finally { store.get = get; }
   };
   // Cover invalid-last atomicity and invalid-first stale-read resurrection.
   const roots = boundary === "before" ? [b.artifact.id, a.artifact.id] : [a.artifact.id, b.artifact.id];
   const pending = operation === "outputs"
    ? f.service.updateOutputs(runId, roots, [])
    : f.service.finish(runId, roots);
   const rejected = assert.rejects(pending, { code: boundary === "before" ? "STEP_SUPERSEDED" : "REVISION_CONFLICT" });
   await held;
   try { await g.rewind(runId, a.step.id, "replace A during output selection"); }
   finally { release(); }
   await rejected;
   f.service.updateOutputs = updateOutputs;
   const current = await g.advance(runId);
   assert.equal(current.run.status, "running");
   assert.ok(!current.run.outputOverrides?.addedArtifactIds.length);
   assert.deepEqual(current.outputArtifactIds, [b.artifact.id]);
   assert.deepEqual(await f.service.outputs(runId), [b.artifact.id]);
   const replacement = current.steps.find(s => s.source?.actionId === "A" && effectiveStep(current.run, s.id))!;
   const fresh = await produce(g, runId, replacement.id, "A2");
   assert.deepEqual(new Set(await f.service.updateOutputs(runId, [fresh.artifact.id, b.artifact.id], [])), new Set([fresh.artifact.id, b.artifact.id]));
   assert.equal(Buffer.from((await g.readArtifact(runId, a.artifact.id)).bytes).toString(), "A1");
   assert.equal((await f.service.finish(runId, [fresh.artifact.id])).status, "done");
   assert.deepEqual((await g.snapshot(runId)).outputArtifactIds, [fresh.artifact.id]);
  });
 });
}

test('collect waits for formal acceptance of the replacement root',async t=>{
 const f=await fixture(t);
 await f.service.withGraph(async g=>{
  const a=action('A');a.artifact={...artifact,review:['owner']};
  const stop=action('stop');stop.dependencies.push({tag:'!dependency',from:'tick'});
  const gather:GraphAction={tag:'!action',id:'gather',description:'collect',dependencies:[{tag:'!dependency',from:'stop'}],collect:['A']};
  const start=await g.start({name:'reviewed collect',procedure:procedure([a,stop,action('tick'),gather]),controlPlane:{runner:{permissions:['artifact.read','artifact.submit','decision.decide']},actors:{human:{kind:'human',name:'Owner',permissions:['artifact.read','decision.decide']}}},reviewConfiguration:{reviews:{'rewind-test#actions[A]':{policy:'artifact_acceptance.unanimous'}},slots:{'rewind-test::owner':{actorIds:['human']}}}});
  const old=await produce(g,start.run.id,latest(start.steps,'A').id);
  const round=old.step.reviewRounds![0];await g.submitReview(start.run.id,old.step.id,round.id,'human','approve');await g.submitReview(start.run.id,old.step.id,round.id,'runner','approve');
  await produce(g,start.run.id,latest(start.steps,'stop').id);
  const rewind=await g.rewind(start.run.id,old.step.id,'replace accepted root');
  const candidate=await produce(g,start.run.id,rewind.replacementStepId);
  assert.equal(candidate.step.status,'awaiting_review');
  const tick=await produce(g,start.run.id,latest(start.steps,'tick').id);await produce(g,start.run.id,latest(tick.snapshot.steps,'stop').id);
  const waiting=await g.advance(start.run.id);
  assert.equal(waiting.steps.filter(s=>s.source?.actionId==='gather'&&effectiveStep(waiting.run,s.id)).length,0);
  const next=candidate.step.reviewRounds![0];await g.submitReview(start.run.id,candidate.step.id,next.id,'human','approve');
  const accepted=await g.submitReview(start.run.id,candidate.step.id,next.id,'runner','approve');
  assert.deepEqual(accepted.steps.find(s=>s.source?.actionId==='gather'&&effectiveStep(accepted.run,s.id))!.artifact,{mode:'collect',items:{A:[candidate.artifact.id]}});
 });
});

for(const reverse of [false,true])test(`overlapping independent member rewinds wait for both replacements, ${reverse?'B':'A'} first`,async t=>{
 const f=await fixture(t);
 await f.service.withGraph(async g=>{
  const gather:GraphAction={tag:'!action',id:'gather',description:'collect',dependencies:[{tag:'!dependency',from:'stop'}],collect:['A','B']};
  const start=await g.start({name:'overlapping members',procedure:procedure([action('A'),action('B'),action('stop'),gather,action('summary','gather')])});
  const a=await produce(g,start.run.id,latest(start.steps,'A').id);
  const b=await produce(g,start.run.id,latest(start.steps,'B').id);
  await produce(g,start.run.id,latest(start.steps,'stop').id);
  const a2=await g.rewind(start.run.id,a.step.id,'replace A');
  const b2=await g.rewind(start.run.id,b.step.id,'replace B');
  const first=await produce(g,start.run.id,reverse?b2.replacementStepId:a2.replacementStepId);
  for(let i=0;i<2;i++){
   const waiting=await g.advance(start.run.id);
   assert.equal(waiting.steps.filter(s=>s.source?.actionId==='gather'&&effectiveStep(waiting.run,s.id)).length,0);
  }
  const last=await produce(g,start.run.id,reverse?a2.replacementStepId:b2.replacementStepId);
  const gathers=last.snapshot.steps.filter(s=>s.source?.actionId==='gather'&&effectiveStep(last.snapshot.run,s.id));
  assert.equal(gathers.length,1);
  const expected={A:[reverse?last.artifact.id:first.artifact.id],B:[reverse?first.artifact.id:last.artifact.id]};
  assert.deepEqual(gathers[0].artifact,{mode:'collect',items:expected});
  const summaries=last.snapshot.steps.filter(s=>s.source?.actionId==='summary'&&effectiveStep(last.snapshot.run,s.id));
  assert.equal(summaries.length,1);assert.deepEqual(summaries[0].inputs,{A:expected.A.map(id=>({kind:'artifact',id})),B:expected.B.map(id=>({kind:'artifact',id}))});
 });
});

for(const controlFirst of [true,false])test(`rewinding collect control during a member wait releases once, ${controlFirst?'control':'member'} first`,async t=>{
 const f=await fixture(t);
 await f.service.withGraph(async g=>{
  const gather:GraphAction={tag:'!action',id:'gather',description:'collect',dependencies:[{tag:'!dependency',from:'stop'}],collect:['A']};
  const start=await g.start({name:'control replacement',procedure:procedure([action('A'),action('stop'),gather,action('summary','gather')])});
  const a=await produce(g,start.run.id,latest(start.steps,'A').id);
  const stop=await produce(g,start.run.id,latest(start.steps,'stop').id);
  const a2=await g.rewind(start.run.id,a.step.id,'replace A');
  const stop2=await g.rewind(start.run.id,stop.step.id,'replace control');
  const first=await produce(g,start.run.id,controlFirst?stop2.replacementStepId:a2.replacementStepId);
  assert.equal(first.snapshot.steps.filter(s=>s.source?.actionId==='gather'&&effectiveStep(first.snapshot.run,s.id)).length,0);
  const last=await produce(g,start.run.id,controlFirst?a2.replacementStepId:stop2.replacementStepId);
  const gathers=last.snapshot.steps.filter(s=>s.source?.actionId==='gather'&&effectiveStep(last.snapshot.run,s.id));
  assert.equal(gathers.length,1);assert.deepEqual(gathers[0].artifact,{mode:'collect',items:{A:[controlFirst?last.artifact.id:first.artifact.id]}});
  assert.equal(last.snapshot.steps.filter(s=>s.source?.actionId==='summary'&&effectiveStep(last.snapshot.run,s.id)).length,1);
 });
});

test('collect recovery coalesces historical and newly dispatched controls into its latest single slot',async t=>{
 const f=await fixture(t);
 await f.service.withGraph(async g=>{
  const stop=action('stop');stop.dependencies.push({tag:'!dependency',from:'tick'});stop.dependencies.push({tag:'!dependency',from:'tick2'});
  const gather:GraphAction={tag:'!action',id:'gather',description:'collect',dependencies:[{tag:'!dependency',from:'stop'}],collect:['A']};
  const start=await g.start({name:'latest control',procedure:procedure([action('A'),stop,action('tick'),action('tick2'),gather,action('summary','gather')])});
  const a=await produce(g,start.run.id,latest(start.steps,'A').id);
  const firstStop=await produce(g,start.run.id,latest(start.steps,'stop').id);
  const tick=await produce(g,start.run.id,latest(start.steps,'tick').id);
  await produce(g,start.run.id,latest(tick.snapshot.steps,'stop').id);
  const rewind=await g.rewind(start.run.id,a.step.id,'replace member');
  assert.equal(rewind.snapshot.run.frames![0].graphFrame.deferredCollects!.length,1);
  await g.enter(start.run.id,rewind.replacementStepId);
  const tick2=await produce(g,start.run.id,latest(start.steps,'tick2').id);
  const newest=await produce(g,start.run.id,latest(tick2.snapshot.steps,'stop').id);
  assert.equal(newest.snapshot.steps.filter(s=>s.source?.actionId==='gather'&&effectiveStep(newest.snapshot.run,s.id)).length,0);
  const fresh=await produce(g,start.run.id,rewind.replacementStepId);
  const gathers=fresh.snapshot.steps.filter(s=>s.source?.actionId==='gather'&&effectiveStep(fresh.snapshot.run,s.id));
  assert.equal(gathers.length,1);assert.deepEqual(gathers[0].inputs?.stop,[{kind:'artifact',id:newest.artifact.id}]);
  assert.deepEqual(gathers[0].artifact,{mode:'collect',items:{A:[fresh.artifact.id]}});
  assert.equal(fresh.snapshot.steps.filter(s=>s.source?.actionId==='summary'&&effectiveStep(fresh.snapshot.run,s.id)).length,1);
 });
});

for(const state of ['pending','collect','foreign','terminal','archived'])test(`rewind rejects ${state} targets without changing history`,async t=>{
 const f=await fixture(t);
 await f.service.withGraph(async g=>{
  const gather:GraphAction={tag:'!action',id:'gather',description:'collect',dependencies:[{tag:'!dependency',from:'A'}],collect:['A']};
  const start=await g.start({name:'rejected target',procedure:procedure([action('A'),gather])});
  let target=start.steps[0].id;
  if(state!=='pending'){
   const result=await produce(g,start.run.id,target);
   if(state==='collect')target=latest(result.snapshot.steps,'gather').id;
   if(state==='foreign'){const other=await g.start({name:'other',procedure:procedure([action('A')])});target=other.steps[0].id;}
   if(state==='terminal'||state==='archived'){await g.finish(start.run.id);if(state==='archived')await f.service.archive(start.run.id);}
  }
  const before=await g.snapshot(start.run.id);
  const code=['terminal','archived'].includes(state)?'RUN_FINISHED':state==='foreign'?'NOT_FOUND':'INVALID_ARGUMENT';
  await assert.rejects(g.rewindPreview(start.run.id,target),{code});
  await assert.rejects(g.rewind(start.run.id,target,'rejected'),{code});
  assert.deepEqual(await g.snapshot(start.run.id),before);
 });
});

test('rewind preview requires read permission and execution also requires submit/decide',async t=>{
 const f=await fixture(t);
 await f.service.withGraph(async g=>{
  const start=await g.start({name:'permissions',procedure:procedure([action('A')]),controlPlane:{runner:{permissions:['artifact.read']},actors:{}}});
  await g.enter(start.run.id,start.steps[0].id);
  const before=await g.snapshot(start.run.id);await g.rewindPreview(start.run.id,start.steps[0].id);
  await assert.rejects(g.rewind(start.run.id,start.steps[0].id,'cannot submit'),{code:'PERMISSION_DENIED'});
  assert.deepEqual(await g.snapshot(start.run.id),before);
 });
});

test('dry-run with an interrupted saved rewind does not materialize or clear its intent',async t=>{
 const f=await fixture(t);
 await f.service.withGraph(async g=>{
  const start=await g.start({name:'readonly recovery',procedure:procedure([action('A'),action('B')])});
  const a=await produce(g,start.run.id,latest(start.steps,'A').id);
  const b=latest(start.steps,'B');await g.enter(start.run.id,b.id);
  const create=f.service.stores.step.create.bind(f.service.stores.step);f.service.stores.step.create=async()=>{throw Error('materialization interrupted');};
  await assert.rejects(g.rewind(start.run.id,a.step.id,'new A'),/materialization interrupted/);
  f.service.stores.step.create=create;
  const before=await g.snapshot(start.run.id);assert.ok(before.run.frames![0].graphFrame.pendingRewind);
  await g.rewindPreview(start.run.id,b.id);assert.deepEqual(await g.snapshot(start.run.id),before);
 });
});

for(const eliminated of [false,true])test(`overlapping member waits handle ${eliminated?'condition elimination':'descendant formal acceptance'}`,async t=>{
 const f=await fixture(t);
 await f.service.withGraph(async g=>{
  const b=action('B','X','artifacts.X = "yes"');b.artifact={...artifact,review:['owner']};
  const stop=action('stop');stop.dependencies.push({tag:'!dependency',from:'tick'});stop.dependencies.push({tag:'!dependency',from:'tick2'});
  const gather:GraphAction={tag:'!action',id:'gather',description:'collect',dependencies:[{tag:'!dependency',from:'stop'}],collect:['A','B']};
  const start=await g.start({name:'reviewed overlap',procedure:procedure([action('A'),action('X'),b,stop,action('tick'),action('tick2'),gather,action('summary','gather')]),controlPlane:{runner:{permissions:['artifact.read','artifact.submit','decision.decide']},actors:{human:{kind:'human',name:'Owner',permissions:['artifact.read','decision.decide']}}},reviewConfiguration:{reviews:{'rewind-test#actions[B]':{policy:'artifact_acceptance.unanimous'}},slots:{'rewind-test::owner':{actorIds:['human']}}}});
  const approve=async (candidate:Awaited<ReturnType<typeof produce>>)=>{const round=candidate.step.reviewRounds![0];await g.submitReview(start.run.id,candidate.step.id,round.id,'human','approve');return g.submitReview(start.run.id,candidate.step.id,round.id,'runner','approve');};
  const a=await produce(g,start.run.id,latest(start.steps,'A').id);
  const x=await produce(g,start.run.id,latest(start.steps,'X').id,'yes');await approve(await produce(g,start.run.id,latest(x.snapshot.steps,'B').id));
  await produce(g,start.run.id,latest(start.steps,'stop').id);
  const a2=await g.rewind(start.run.id,a.step.id,'new A');
  const x2=await g.rewind(start.run.id,x.step.id,'new X/B');
  const newA=await produce(g,start.run.id,a2.replacementStepId);
  const tick=await produce(g,start.run.id,latest(start.steps,'tick').id);
  await produce(g,start.run.id,latest(tick.snapshot.steps,'stop').id);
  const waiting=await g.advance(start.run.id);
  assert.equal(waiting.steps.filter(s=>s.source?.actionId==='gather'&&effectiveStep(waiting.run,s.id)).length,0);
  const newX=await produce(g,start.run.id,x2.replacementStepId,eliminated?'no':'yes');
  let final=newX.snapshot,expectedB:string[]=[];
  if(!eliminated){const candidate=await produce(g,start.run.id,latest(newX.snapshot.steps,'B').id);expectedB=[candidate.artifact.id];
   const tick2=await produce(g,start.run.id,latest(start.steps,'tick2').id);await produce(g,start.run.id,latest(tick2.snapshot.steps,'stop').id);
   assert.equal(candidate.snapshot.steps.filter(s=>s.source?.actionId==='gather'&&effectiveStep(candidate.snapshot.run,s.id)).length,0);final=await approve(candidate);
  }
  const gathers=final.steps.filter(s=>s.source?.actionId==='gather'&&effectiveStep(final.run,s.id));
  assert.equal(gathers.length,1);assert.deepEqual(gathers[0].artifact,{mode:'collect',items:{A:[newA.artifact.id],B:expectedB}});
  assert.equal(final.steps.filter(s=>s.source?.actionId==='summary'&&effectiveStep(final.run,s.id)).length,1);
 });
});

test('collect restores the latest actual control dispatch even when that instance was created first',async t=>{
 const f=await fixture(t);
 await f.service.withGraph(async g=>{
  const stop=action('stop');stop.dependencies.push({tag:'!dependency',from:'tick'});
  const gather:GraphAction={tag:'!action',id:'gather',description:'collect',dependencies:[{tag:'!dependency',from:'stop'}],collect:['A']};
  const start=await g.start({name:'control dispatch order',procedure:procedure([action('A'),stop,action('tick'),gather,action('summary','gather')])});
  const a=await produce(g,start.run.id,latest(start.steps,'A').id);
  const tick=await produce(g,start.run.id,latest(start.steps,'tick').id);
  await produce(g,start.run.id,latest(tick.snapshot.steps,'stop').id);
  const lastControl=await produce(g,start.run.id,latest(start.steps,'stop').id);
  const rewind=await g.rewind(start.run.id,a.step.id,'new member');
  const fresh=await produce(g,start.run.id,rewind.replacementStepId);
  const gathers=fresh.snapshot.steps.filter(s=>s.source?.actionId==='gather'&&effectiveStep(fresh.snapshot.run,s.id));
  assert.equal(gathers.length,1);assert.deepEqual(gathers[0].inputs?.stop,[{kind:'artifact',id:lastControl.artifact.id}]);
 });
});

for(const readOnly of [true,false])test(`rewind rejects missing ${readOnly?'decide':'read'} permission without mutation`,async t=>{
 const f=await fixture(t);
 await f.service.withGraph(async g=>{
  const start=await g.start({name:'denied rewind',procedure:procedure([action('A')]),controlPlane:{runner:{permissions:readOnly?['artifact.read','artifact.submit']:[]},actors:{}}});
  const target=start.steps[0].id;
  if(readOnly)await produce(g,start.run.id,target);
  const before=await g.snapshot(start.run.id);
  if(!readOnly)await assert.rejects(g.rewindPreview(start.run.id,target),{code:'PERMISSION_DENIED'});
  await assert.rejects(g.rewind(start.run.id,target,'denied'),{code:'PERMISSION_DENIED'});
  assert.deepEqual(await g.snapshot(start.run.id),before);
 });
});

const collectAction = (id: string, from: string, members: string[]): GraphAction => ({ tag: '!action', id, description: id, dependencies: [{ tag: '!dependency', from }], collect: members });
const current = (snapshot: Awaited<ReturnType<GraphRuntime['snapshot']>>, id: string) => snapshot.steps.filter(s => s.source?.actionId === id && effectiveStep(snapshot.run, s.id));

for (const reverse of [false, true]) test(`collect recovery follows the newly selected ${reverse ? 'direct' : 'intermediate'} member path`, async t => {
  const f = await fixture(t);
  await f.service.withGraph(async g => {
    const b = action('B', 'A', 'artifacts.A = "no"'); b.dependencies.push({ tag: '!dependency', from: 'C' });
    const start = await g.start({ name: 'alternate route', procedure: procedure([action('A'), action('C', 'A', 'artifacts.A = "yes"'), b, action('stop'), collectAction('gather', 'stop', ['B']), action('summary', 'gather')]) });
    const a1 = await produce(g, start.run.id, latest(start.steps, 'A').id, reverse ? 'yes' : 'no');
    let old = a1.snapshot;
    if (reverse) old = (await produce(g, start.run.id, latest(old.steps, 'C').id)).snapshot;
    await produce(g, start.run.id, latest(old.steps, 'B').id);
    await produce(g, start.run.id, latest(start.steps, 'stop').id);
    const rewind = await g.rewind(start.run.id, a1.step.id, 'change route');
    let fresh = (await produce(g, start.run.id, rewind.replacementStepId, reverse ? 'no' : 'yes')).snapshot;
    assert.equal(current(fresh, 'gather').length, 0);
    if (!reverse) {
      const c = latest(fresh.steps, 'C');
      await g.enter(start.run.id, c.id);
      assert.equal(current(await g.advance(start.run.id), 'gather').length, 0);
      fresh = (await produce(g, start.run.id, c.id)).snapshot;
    }
    assert.equal(current(fresh, 'gather').length, 0);
    const b2 = await produce(g, start.run.id, latest(fresh.steps, 'B').id);
    assert.equal(current(b2.snapshot, 'gather').length, 1);
    assert.deepEqual(current(b2.snapshot, 'gather')[0].artifact, { mode: 'collect', items: { B: [b2.artifact.id] } });
  });
});

for (const nonempty of [false, true]) test(`collect member recovery retains ${nonempty ? 'nonempty' : 'empty'} intermediate collect control ancestry`, async t => {
  const f = await fixture(t);
  await f.service.withGraph(async g => {
    const start = await g.start({ name: 'control ancestry', procedure: procedure([action('A'), action('C', 'A'), action('X'), collectAction('bridge', 'C', ['X']), action('B', 'bridge'), action('stop'), collectAction('gather', 'stop', ['B']), action('summary', 'gather')]) });
    if (nonempty) await produce(g, start.run.id, latest(start.steps, 'X').id);
    const a1 = await produce(g, start.run.id, latest(start.steps, 'A').id);
    const c1 = await produce(g, start.run.id, latest(a1.snapshot.steps, 'C').id);
    await produce(g, start.run.id, latest(c1.snapshot.steps, 'B').id);
    await produce(g, start.run.id, latest(start.steps, 'stop').id);
    const rewind = await g.rewind(start.run.id, a1.step.id, 'replace ancestor');
    const a2 = await produce(g, start.run.id, rewind.replacementStepId);
    assert.equal(current(a2.snapshot, 'gather').length, 0);
    const c = latest(a2.snapshot.steps, 'C'); await g.enter(start.run.id, c.id);
    assert.equal(current(await g.advance(start.run.id), 'gather').length, 0);
    const c2 = await produce(g, start.run.id, c.id);
    assert.equal(current(c2.snapshot, 'gather').length, 0);
    const b2 = await produce(g, start.run.id, latest(c2.snapshot.steps, 'B').id);
    assert.deepEqual(current(b2.snapshot, 'gather')[0].artifact, { mode: 'collect', items: { B: [b2.artifact.id] } });
    assert.equal(current(b2.snapshot, 'gather').length, 1);
  });
});

test('nested collect recovery waits for the upstream slot after downstream then upstream rewinds', async t => {
  const f = await fixture(t);
  await f.service.withGraph(async g => {
    const start = await g.start({ name: 'nested recovery', procedure: procedure([action('A'), action('stop1'), collectAction('g1', 'stop1', ['A']), action('B', 'g1'), action('stop2'), collectAction('g2', 'stop2', ['B']), action('summary', 'g2')]) });
    const a1 = await produce(g, start.run.id, latest(start.steps, 'A').id);
    const stop1 = await produce(g, start.run.id, latest(start.steps, 'stop1').id);
    const b1 = await produce(g, start.run.id, latest(stop1.snapshot.steps, 'B').id);
    await produce(g, start.run.id, latest(start.steps, 'stop2').id);
    await g.rewind(start.run.id, b1.step.id, 'replace downstream');
    const rewind = await g.rewind(start.run.id, a1.step.id, 'replace upstream');
    const a2 = await produce(g, start.run.id, rewind.replacementStepId);
    assert.equal(current(a2.snapshot, 'g2').length, 0);
    assert.equal(current(a2.snapshot, 'summary').length, 0);
    const b = current(a2.snapshot, 'B')[0]; assert.ok(b);
    await g.enter(start.run.id, b.id);
    assert.equal(current(await g.advance(start.run.id), 'g2').length, 0);
    const b2 = await produce(g, start.run.id, b.id);
    assert.equal(current(b2.snapshot, 'g2').length, 1);
    assert.deepEqual(current(b2.snapshot, 'g2')[0].artifact, { mode: 'collect', items: { B: [b2.artifact.id] } });
    assert.equal(current(b2.snapshot, 'summary').length, 1);
  });
});

for (const eliminated of [true, false]) test(`control ancestor rewind ${eliminated ? 'retires an eliminated' : 'waits for a replacement'} collect recovery slot`, async t => {
  const f = await fixture(t);
  await f.service.withGraph(async g => {
    const start = await g.start({ name: 'control condition', procedure: procedure([action('A'), action('X'), action('stop', 'X', 'artifacts.X = "yes"'), collectAction('gather', 'stop', ['A']), action('summary', 'gather')]) });
    const a1 = await produce(g, start.run.id, latest(start.steps, 'A').id);
    const x1 = await produce(g, start.run.id, latest(start.steps, 'X').id, 'yes');
    await produce(g, start.run.id, latest(x1.snapshot.steps, 'stop').id);
    const aRewind = await g.rewind(start.run.id, a1.step.id, 'new member');
    const xRewind = await g.rewind(start.run.id, x1.step.id, 'new control condition');
    const a2 = await produce(g, start.run.id, aRewind.replacementStepId);
    assert.equal(current(a2.snapshot, 'gather').length, 0);
    const x2 = await produce(g, start.run.id, xRewind.replacementStepId, eliminated ? 'no' : 'yes');
    assert.equal(current(x2.snapshot, 'gather').length, 0);
    let final = x2.snapshot;
    if (!eliminated) {
      const stop = latest(final.steps, 'stop'); await g.enter(start.run.id, stop.id);
      assert.equal(current(await g.advance(start.run.id), 'gather').length, 0);
      final = (await produce(g, start.run.id, stop.id)).snapshot;
      assert.equal(current(final, 'gather').length, 1);
      assert.deepEqual(current(final, 'gather')[0].artifact, { mode: 'collect', items: { A: [a2.artifact.id] } });
      final = (await produce(g, start.run.id, current(final, 'summary')[0].id)).snapshot;
    }
    assert.equal(final.run.frames![0].graphFrame.deferredCollects?.length, 0);
    if (eliminated) assert.equal(current(final, 'summary').length, 0);
    await g.finish(start.run.id);
  });
});

for (const shape of ['alternate-join', 'collect-ancestor', 'nested-slot']) test(`collect recovery waits for formal acceptance along ${shape}`, async t => {
  const f = await fixture(t);
  await f.service.withGraph(async g => {
    const reviewed = action(shape === 'nested-slot' ? 'B' : 'C', shape === 'nested-slot' ? 'g1' : 'A');
    reviewed.artifact = { ...artifact, review: ['owner'] };
    let actions: GraphAction[];
    if (shape === 'alternate-join') {
      reviewed.dependencies[0].when = 'artifacts.A = "yes"';
      const b = action('B', 'A', 'artifacts.A = "no"'); b.dependencies.push({ tag: '!dependency', from: ['C', 'Y'] });
      actions = [action('A'), reviewed, action('Y', 'C'), b, action('stop'), collectAction('gather', 'stop', ['B']), action('summary', 'gather')];
    } else if (shape === 'collect-ancestor') {
      actions = [action('A'), reviewed, action('X'), collectAction('bridge', 'C', ['X']), action('B', 'bridge'), action('stop'), collectAction('gather', 'stop', ['B']), action('summary', 'gather')];
    } else {
      actions = [action('A'), action('stop1'), collectAction('g1', 'stop1', ['A']), reviewed, action('stop'), collectAction('gather', 'stop', ['B']), action('summary', 'gather')];
    }
    const start = await g.start({ name: shape, procedure: procedure(actions), controlPlane: { runner: { permissions: ['artifact.read', 'artifact.submit', 'decision.decide'] }, actors: { human: { kind: 'human', name: 'Owner', permissions: ['artifact.read', 'decision.decide'] } } }, reviewConfiguration: { reviews: { [`rewind-test#actions[${reviewed.id}]`]: { policy: 'artifact_acceptance.unanimous' } }, slots: { 'rewind-test::owner': { actorIds: ['human'] } } } });
    const approve = async (candidate: Awaited<ReturnType<typeof produce>>) => {
      const round = candidate.step.reviewRounds![0];
      await g.submitReview(start.run.id, candidate.step.id, round.id, 'human', 'approve');
      return g.submitReview(start.run.id, candidate.step.id, round.id, 'runner', 'approve');
    };
    const a1 = await produce(g, start.run.id, latest(start.steps, 'A').id, 'no');
    let old = a1.snapshot;
    if (shape === 'nested-slot') old = (await produce(g, start.run.id, latest(start.steps, 'stop1').id)).snapshot;
    if (shape === 'collect-ancestor') old = await approve(await produce(g, start.run.id, latest(old.steps, 'C').id));
    const b1 = await produce(g, start.run.id, latest(old.steps, 'B').id);
    if (shape === 'nested-slot') await approve(b1);
    await produce(g, start.run.id, latest(start.steps, 'stop').id);
    // Two rewinds before the member completes preserve the same collect slot.
    if (shape === 'nested-slot') await g.rewind(start.run.id, b1.step.id, 'new downstream');
    const rewind = await g.rewind(start.run.id, a1.step.id, 'new upstream');
    let fresh = (await produce(g, start.run.id, rewind.replacementStepId, 'yes')).snapshot;
    assert.equal(current(fresh, 'gather').length, 0);
    const candidate = await produce(g, start.run.id, current(fresh, reviewed.id)[0].id);
    assert.equal(candidate.step.status, 'awaiting_review');
    assert.equal(current(candidate.snapshot, 'gather').length, 0);
    fresh = await approve(candidate);
    if (shape !== 'nested-slot') {
      assert.equal(current(fresh, 'gather').length, 0);
      if (shape === 'alternate-join') {
        // C is accepted, but its second Join partner has not dispatched yet.
        assert.ok(fresh.run.frames![0].graphFrame.joins.some(j => j.actionId === 'B' && j.arrivals.C));
        const y = current(fresh, 'Y')[0]; await g.enter(start.run.id, y.id);
        assert.equal(current(await g.advance(start.run.id), 'gather').length, 0);
        fresh = (await produce(g, start.run.id, y.id)).snapshot;
      }
      fresh = (await produce(g, start.run.id, current(fresh, 'B')[0].id)).snapshot;
    }
    const b = current(fresh, 'B')[0]; assert.equal(b.artifact?.mode, 'produce');
    assert.equal(current(fresh, 'gather').length, 1);
    assert.deepEqual(current(fresh, 'gather')[0].artifact, { mode: 'collect', items: { B: [b.artifact!.mode === 'produce' ? b.artifact!.id : 'invalid'] } });
    assert.equal(current(fresh, 'summary').length, 1);
  });
});

test('a control eliminated then restored during the member wait reuses one recovery slot', async t => {
  const f = await fixture(t);
  await f.service.withGraph(async g => {
    const start = await g.start({ name: 'control toggles', procedure: procedure([action('A'), action('X'), action('stop', 'X', 'artifacts.X = "yes"'), collectAction('gather', 'stop', ['A']), action('summary', 'gather')]) });
    const a1 = await produce(g, start.run.id, latest(start.steps, 'A').id);
    const x1 = await produce(g, start.run.id, latest(start.steps, 'X').id, 'yes');
    await produce(g, start.run.id, latest(x1.snapshot.steps, 'stop').id);
    const aRewind = await g.rewind(start.run.id, a1.step.id, 'new member');
    const xRewind = await g.rewind(start.run.id, x1.step.id, 'disable control');
    const no = await produce(g, start.run.id, xRewind.replacementStepId, 'no');
    assert.equal(current(no.snapshot, 'gather').length, 0);
    const again = await g.rewind(start.run.id, no.step.id, 'restore control');
    const yes = await produce(g, start.run.id, again.replacementStepId, 'yes');
    const stopped = await produce(g, start.run.id, current(yes.snapshot, 'stop')[0].id);
    assert.equal(current(stopped.snapshot, 'gather').length, 0);
    const a2 = await produce(g, start.run.id, aRewind.replacementStepId);
    assert.equal(current(a2.snapshot, 'gather').length, 1);
    assert.deepEqual(current(a2.snapshot, 'gather')[0].artifact, { mode: 'collect', items: { A: [a2.artifact.id] } });
  });
});

test('condition elimination of an intermediate collect path releases a legal empty member set', async t => {
  const f = await fixture(t);
  await f.service.withGraph(async g => {
    const start = await g.start({ name: 'eliminated bridge', procedure: procedure([action('A'), action('C', 'A', 'artifacts.A = "yes"'), action('X'), collectAction('bridge', 'C', ['X']), action('B', 'bridge'), action('stop'), collectAction('gather', 'stop', ['B']), action('summary', 'gather')]) });
    const a1 = await produce(g, start.run.id, latest(start.steps, 'A').id, 'yes');
    const c1 = await produce(g, start.run.id, current(a1.snapshot, 'C')[0].id);
    await produce(g, start.run.id, current(c1.snapshot, 'B')[0].id);
    await produce(g, start.run.id, latest(start.steps, 'stop').id);
    const rewind = await g.rewind(start.run.id, a1.step.id, 'remove member path');
    const a2 = await produce(g, start.run.id, rewind.replacementStepId, 'no');
    assert.equal(current(a2.snapshot, 'B').length, 0);
    assert.equal(current(a2.snapshot, 'gather').length, 1);
    assert.deepEqual(current(a2.snapshot, 'gather')[0].artifact, { mode: 'collect', items: { B: [] } });
  });
});

for (const shape of ['direct', 'intermediate', 'reviewed', 'continuous']) test(`collect recovery includes a newly selected member via ${shape}`, async t => {
  const f = await fixture(t);
  await f.service.withGraph(async g => {
    const intermediate = shape !== 'direct';
    const b = action('B', intermediate ? 'C' : 'X', intermediate ? undefined : 'artifacts.X = "b"');
    if (shape === 'reviewed') b.artifact = { ...artifact, review: ['owner'] };
    const actions = [action('X'), action('A', 'X', 'artifacts.X = "a"'), ...(intermediate ? [action('C', 'X', 'artifacts.X = "b"')] : []), b, action('stop'), collectAction('gather', 'stop', ['A', 'B']), action('summary', 'gather')];
    const start = await g.start({ name: shape, procedure: procedure(actions), ...(shape === 'reviewed' ? { controlPlane: { runner: { permissions: ['artifact.read', 'artifact.submit', 'decision.decide'] }, actors: { human: { kind: 'human' as const, name: 'Owner', permissions: ['artifact.read', 'decision.decide'] } } }, reviewConfiguration: { reviews: { 'rewind-test#actions[B]': { policy: 'artifact_acceptance.unanimous' } }, slots: { 'rewind-test::owner': { actorIds: ['human'] } } } } : {}) });
    const x1 = await produce(g, start.run.id, latest(start.steps, 'X').id, 'a');
    await produce(g, start.run.id, current(x1.snapshot, 'A')[0].id);
    await produce(g, start.run.id, latest(start.steps, 'stop').id);
    const rewind = await g.rewind(start.run.id, x1.step.id, 'select another member');
    let x2 = await produce(g, start.run.id, rewind.replacementStepId, 'b');
    assert.equal(current(x2.snapshot, 'gather').length, 0);
    if (shape === 'continuous') {
      const c = current(x2.snapshot, 'C')[0]; await g.enter(start.run.id, c.id);
      const back = await g.rewind(start.run.id, x2.step.id, 'switch back before B');
      const a2 = await produce(g, start.run.id, back.replacementStepId, 'a');
      assert.equal(current(a2.snapshot, 'gather').length, 0);
      const finalRewind = await g.rewind(start.run.id, a2.step.id, 'select B again');
      x2 = await produce(g, start.run.id, finalRewind.replacementStepId, 'b');
      assert.equal(current(x2.snapshot, 'gather').length, 0);
    }
    let fresh = x2.snapshot;
    if (intermediate) {
      const c = current(fresh, 'C')[0]; await g.enter(start.run.id, c.id);
      assert.equal(current(await g.advance(start.run.id), 'gather').length, 0);
      fresh = (await produce(g, start.run.id, c.id)).snapshot;
      assert.equal(current(fresh, 'gather').length, 0);
    }
    const member = current(fresh, 'B')[0]; await g.enter(start.run.id, member.id);
    assert.equal(current(await g.advance(start.run.id), 'gather').length, 0);
    const b2 = await produce(g, start.run.id, member.id);
    fresh = b2.snapshot;
    if (shape === 'reviewed') {
      assert.equal(b2.step.status, 'awaiting_review');
      assert.equal(current(fresh, 'gather').length, 0);
      assert.equal(current(fresh, 'summary').length, 0);
      const round = b2.step.reviewRounds![0];
      await g.submitReview(start.run.id, member.id, round.id, 'human', 'approve');
      fresh = await g.submitReview(start.run.id, member.id, round.id, 'runner', 'approve');
    }
    assert.equal(current(fresh, 'gather').length, 1);
    assert.deepEqual(current(fresh, 'gather')[0].artifact, { mode: 'collect', items: { A: [], B: [b2.artifact.id] } });
    assert.equal(current(fresh, 'summary').length, 1);
    assert.deepEqual(current(fresh, 'summary')[0].inputs, { A: [], B: [{ kind: 'artifact', id: b2.artifact.id }] });
  });
});

for (const eliminated of [true, false]) test(`dual-control collect recovery ${eliminated ? 'retires' : 'releases'} once and retains the independent signal`, async t => {
  const f = await fixture(t);
  await f.service.withGraph(async g => {
    const gather = collectAction('gather', 'stop', ['A']); gather.dependencies[0].from = ['stop', 'Y'];
    const start = await g.start({ name: 'two controls', procedure: procedure([action('A'), action('X'), action('Y'), action('stop', 'X', 'artifacts.X = "yes"'), gather, action('summary', 'gather')]) });
    const a1 = await produce(g, start.run.id, latest(start.steps, 'A').id);
    const x1 = await produce(g, start.run.id, latest(start.steps, 'X').id, 'yes');
    await produce(g, start.run.id, current(x1.snapshot, 'stop')[0].id);
    const y1 = await produce(g, start.run.id, latest(start.steps, 'Y').id);
    const newA = await g.rewind(start.run.id, a1.step.id, 'member');
    const newX = await g.rewind(start.run.id, x1.step.id, 'control');
    const x2 = await produce(g, start.run.id, newX.replacementStepId, eliminated ? 'no' : 'yes');
    assert.equal(current(x2.snapshot, 'gather').length, 0);
    const a2 = await produce(g, start.run.id, newA.replacementStepId);
    assert.equal(current(a2.snapshot, 'gather').length, 0);
    let fresh = a2.snapshot;
    if (!eliminated) {
      fresh = (await produce(g, start.run.id, current(fresh, 'stop')[0].id)).snapshot;
      assert.equal(current(fresh, 'gather').length, 1);
      assert.deepEqual(current(fresh, 'gather')[0].inputs?.Y, [{ kind: 'artifact', id: y1.artifact.id }]);
      assert.deepEqual(current(fresh, 'gather')[0].artifact, { mode: 'collect', items: { A: [a2.artifact.id] } });
      fresh = (await produce(g, start.run.id, current(fresh, 'summary')[0].id)).snapshot;
    } else assert.equal(current(fresh, 'summary').length, 0);
    assert.equal(current(fresh, 'Y').length, 1);
    assert.equal(fresh.run.frames![0].graphFrame.deferredCollects?.length, 0);
    await g.finish(start.run.id);
  });
});

for (const shape of ['initial-empty', 'roundtrip', 'reviewed', 'nested-empty']) test(`empty collect retains condition provenance through ${shape}`, async t => {
  const f = await fixture(t);
  await f.service.withGraph(async g => {
    const nested = shape === 'nested-empty', reviewed = shape === 'reviewed';
    const b = action('B', nested ? 'bridge' : 'X', nested ? undefined : 'artifacts.X = "yes"');
    if (reviewed) b.artifact = { ...artifact, review: ['owner'] };
    const actions = [action('X'), action('unrelated'), ...(nested ? [action('C', 'X', 'artifacts.X = "yes"'), action('Z'), collectAction('bridge', 'C', ['Z'])] : []), b, action('stop'), collectAction('gather', 'stop', ['B']), action('summary', 'gather')];
    const start = await g.start({ name: shape, procedure: procedure(actions), ...(reviewed ? { controlPlane: { runner: { permissions: ['artifact.read', 'artifact.submit', 'decision.decide'] }, actors: { human: { kind: 'human' as const, name: 'Owner', permissions: ['artifact.read', 'decision.decide'] } } }, reviewConfiguration: { reviews: { 'rewind-test#actions[B]': { policy: 'artifact_acceptance.unanimous' } }, slots: { 'rewind-test::owner': { actorIds: ['human'] } } } } : {}) });
    const acceptB = async (candidate: Awaited<ReturnType<typeof produce>>) => {
      if (!reviewed) return candidate.snapshot;
      const round = candidate.step.reviewRounds![0];
      await g.submitReview(start.run.id, candidate.step.id, round.id, 'human', 'approve');
      return g.submitReview(start.run.id, candidate.step.id, round.id, 'runner', 'approve');
    };
    const initial = await produce(g, start.run.id, latest(start.steps, 'X').id, shape === 'initial-empty' ? 'no' : 'yes');
    let fresh = initial.snapshot;
    if (shape !== 'initial-empty') {
      if (nested) fresh = (await produce(g, start.run.id, current(fresh, 'C')[0].id)).snapshot;
      fresh = await acceptB(await produce(g, start.run.id, current(fresh, 'B')[0].id));
    }
    const stop = await produce(g, start.run.id, latest(start.steps, 'stop').id);
    const oldSummary = await produce(g, start.run.id, current(stop.snapshot, 'summary')[0].id, 'old summary');
    let root = initial.step.id;
    let emptySummary = oldSummary;
    if (shape !== 'initial-empty') {
      const rewind = await g.rewind(start.run.id, root, 'remove member');
      const no = await produce(g, start.run.id, rewind.replacementStepId, 'no');
      assert.deepEqual(current(no.snapshot, 'gather')[0].artifact, { mode: 'collect', items: { B: [] } });
      emptySummary = await produce(g, start.run.id, current(no.snapshot, 'summary')[0].id, 'empty summary');
      assert.equal(emptySummary.snapshot.run.frames![0].graphFrame.deferredCollects?.length, 0);
      root = no.step.id;
    }
    const empty = current(emptySummary.snapshot, 'gather')[0];
    const rewind = await g.rewind(start.run.id, root, 'restore member after completed empty output');
    assert.ok(rewind.affectedStepIds.includes(empty.id));
    assert.ok(rewind.affectedStepIds.includes(emptySummary.step.id));
    assert.ok(!rewind.affectedStepIds.includes(stop.step.id));
    assert.ok(!rewind.affectedStepIds.includes(latest(start.steps, 'unrelated').id));
    const yes = await produce(g, start.run.id, rewind.replacementStepId, 'yes');
    assert.equal(current(yes.snapshot, 'gather').length, 0);
    fresh = yes.snapshot;
    if (nested) {
      const c = current(fresh, 'C')[0]; await g.enter(start.run.id, c.id);
      assert.equal(current(await g.advance(start.run.id), 'gather').length, 0);
      fresh = (await produce(g, start.run.id, c.id)).snapshot;
      assert.equal(current(fresh, 'gather').length, 0);
    }
    const member = current(fresh, 'B')[0]; await g.enter(start.run.id, member.id);
    assert.equal(current(await g.advance(start.run.id), 'gather').length, 0);
    const b2 = await produce(g, start.run.id, member.id);
    if (reviewed) {
      assert.equal(b2.step.status, 'awaiting_review');
      assert.equal(current(b2.snapshot, 'gather').length, 0);
    }
    fresh = await acceptB(b2);
    assert.equal(current(fresh, 'gather').length, 1);
    assert.deepEqual(current(fresh, 'gather')[0].artifact, { mode: 'collect', items: { B: [b2.artifact.id] } });
    assert.equal(current(fresh, 'summary').length, 1);
    assert.deepEqual(current(fresh, 'summary')[0].inputs, { B: [{ kind: 'artifact', id: b2.artifact.id }] });
    assert.equal(fresh.steps.find(s => s.id === empty.id)!.artifact?.mode, 'collect');
    assert.deepEqual(fresh.steps.find(s => s.id === empty.id)!.artifact, { mode: 'collect', items: { B: [] } });
    assert.ok((await g.readArtifact(start.run.id, emptySummary.artifact.id)).bytes.length);
    assert.equal(current(fresh, 'stop').length, 1);
  });
});

test('collect materialization retries exclude members accepted after the collection was frozen', async t => {
  const f = await fixture(t);
  await f.service.withGraph(async g => {
    const start = await g.start({ name: 'frozen empty', procedure: procedure([action('B'), action('stop'), collectAction('gather', 'stop', ['B'])]) });
    const update = f.service.stores.step.update.bind(f.service.stores.step);
    f.service.stores.step.update = async (...args) => {
      if ((args[2] as any).source?.actionId === 'gather' && (args[2] as any).status === 'done') throw Error('interrupted collect materialization');
      return update(...args);
    };
    await assert.rejects(produce(g, start.run.id, latest(start.steps, 'stop').id), /interrupted collect materialization/);
    const frozen = await g.snapshot(start.run.id), trigger = frozen.run.frames![0].graphFrame.triggers.find(t => t.actionId === 'gather')!;
    assert.ok(trigger.collection); assert.ok(trigger.collection.triggerIds.length);
    // B completes durably while the gather write is still blocked. Its report
    // fails only while advancing that saved gather, after accepting B itself.
    await assert.rejects(produce(g, start.run.id, latest(start.steps, 'B').id, 'late B'), /interrupted collect materialization/);
    const changed = await g.snapshot(start.run.id);
    assert.equal(current(changed, 'B')[0].status, 'done');
    assert.ok(changed.completeIds.length);
    f.service.stores.step.update = update;
    const after = await g.advance(start.run.id);
    assert.deepEqual(after.run.frames![0].graphFrame.triggers.find(t => t.id === trigger.id)!.collection, trigger.collection);
    assert.deepEqual(current(after, 'gather')[0].artifact, { mode: 'collect', items: { B: [] } });
  });
});

test('completed empty collect provenance survives switching between different declared members', async t => {
  const f = await fixture(t);
  await f.service.withGraph(async g => {
    const start = await g.start({ name: 'empty member switches', procedure: procedure([action('X'), action('A', 'X', 'artifacts.X = "a"'), action('B', 'X', 'artifacts.X = "b"'), action('stop'), collectAction('gather', 'stop', ['A', 'B']), action('summary', 'gather')]) });
    let x = await produce(g, start.run.id, latest(start.steps, 'X').id, 'none');
    let state = (await produce(g, start.run.id, latest(start.steps, 'stop').id)).snapshot;
    state = (await produce(g, start.run.id, current(state, 'summary')[0].id)).snapshot;
    for (const value of ['a', 'none', 'b']) {
      const old = current(state, 'gather')[0];
      const rewind = await g.rewind(start.run.id, x.step.id, `select ${value}`);
      assert.ok(rewind.affectedStepIds.includes(old.id));
      x = await produce(g, start.run.id, rewind.replacementStepId, value); state = x.snapshot;
      const expected: Record<string, string[]> = { A: [], B: [] };
      if (value !== 'none') {
        assert.equal(current(state, 'gather').length, 0);
        const id = value.toUpperCase(); const member = await produce(g, start.run.id, current(state, id)[0].id);
        expected[id] = [member.artifact.id]; state = member.snapshot;
      }
      assert.equal(current(state, 'gather').length, 1);
      assert.deepEqual(current(state, 'gather')[0].artifact, { mode: 'collect', items: expected });
      state = (await produce(g, start.run.id, current(state, 'summary')[0].id)).snapshot;
      assert.equal(state.run.frames![0].graphFrame.deferredCollects?.length, 0);
    }
  });
});

test('rewind rejects legacy collect records without membership evidence instead of retaining stale empty outputs', async t => {
  const f = await fixture(t);
  await f.service.withGraph(async g => {
    const start = await g.start({ name: 'missing historical evidence', procedure: procedure([action('X'), action('B', 'X', 'artifacts.X = "yes"'), action('stop'), collectAction('gather', 'stop', ['B'])]) });
    const x = await produce(g, start.run.id, latest(start.steps, 'X').id, 'no');
    await produce(g, start.run.id, latest(start.steps, 'stop').id);
    const row = (await f.service.stores.run.get({}, start.run.id))!;
    const value = structuredClone(row.value) as any;
    delete value.frames[0].graphFrame.triggers.find((t: any) => t.actionId === 'gather').collection;
    await f.service.stores.run.update({}, start.run.id, value, { expectedRevision: row.revision });
    const before = await g.snapshot(start.run.id);
    await assert.rejects(g.rewindPreview(start.run.id, x.step.id), { code: 'GRAPH_SOURCE_UNAVAILABLE' });
    await assert.rejects(g.rewind(start.run.id, x.step.id, 'cannot infer missing condition origins'), { code: 'GRAPH_SOURCE_UNAVAILABLE' });
    assert.deepEqual(await g.snapshot(start.run.id), before);
  });
});

test('new collect evidence retains reconstructible legacy false-trigger inputs', async t => {
  const f = await fixture(t);
  await f.service.withGraph(async g => {
    const start = await g.start({ name: 'legacy false evidence', procedure: procedure([action('X'), action('B', 'X', 'artifacts.X = "yes"'), action('stop'), collectAction('gather', 'stop', ['B'])]) });
    const x = await produce(g, start.run.id, latest(start.steps, 'X').id, 'no');
    const row = (await f.service.stores.run.get({}, start.run.id))!; const value = structuredClone(row.value) as any;
    delete value.frames[0].graphFrame.triggers.find((t: any) => t.actionId === 'B').arrivals;
    await f.service.stores.run.update({}, start.run.id, value, { expectedRevision: row.revision });
    await produce(g, start.run.id, latest(start.steps, 'stop').id);
    const rewind = await g.rewind(start.run.id, x.step.id, 'legacy false becomes true');
    const yes = await produce(g, start.run.id, rewind.replacementStepId, 'yes');
    assert.equal(current(yes.snapshot, 'gather').length, 0);
    const b = await produce(g, start.run.id, current(yes.snapshot, 'B')[0].id);
    assert.deepEqual(current(b.snapshot, 'gather')[0].artifact, { mode: 'collect', items: { B: [b.artifact.id] } });
  });
});

test('collect provenance excludes later instances of the same condition action', async t => {
  const f = await fixture(t);
  await f.service.withGraph(async g => {
    const x = action('X'); x.dependencies.push({ tag: '!dependency', from: 'tick' });
    const start = await g.start({ name: 'bounded provenance', procedure: procedure([x, action('tick'), action('B', 'X', 'artifacts.X = "yes"'), action('stop'), collectAction('gather', 'stop', ['B']), action('summary', 'gather')]) });
    await produce(g, start.run.id, latest(start.steps, 'X').id, 'no');
    const stop = await produce(g, start.run.id, latest(start.steps, 'stop').id);
    const original = current(stop.snapshot, 'gather')[0];
    const summary = await produce(g, start.run.id, current(stop.snapshot, 'summary')[0].id);
    const tick = await produce(g, start.run.id, latest(start.steps, 'tick').id);
    const later = latest(tick.snapshot.steps, 'X'); await g.enter(start.run.id, later.id);
    const rewind = await g.rewind(start.run.id, later.id, 'only this later instance');
    assert.ok(!rewind.affectedStepIds.includes(original.id));
    assert.ok(!rewind.affectedStepIds.includes(summary.step.id));
    const yes = await produce(g, start.run.id, rewind.replacementStepId, 'yes');
    assert.equal(current(yes.snapshot, 'gather')[0].id, original.id);
    assert.equal(current(yes.snapshot, 'summary')[0].id, summary.step.id);
  });
});

for (const multiple of [false, true]) test(`empty collect condition provenance survives overlapping roots${multiple ? ' and multiple historical controls' : ''}`, async t => {
  const f = await fixture(t);
  await f.service.withGraph(async g => {
    const y = action('Y'); y.dependencies.push({ tag: '!dependency', from: 'tickY' });
    const stop = action('stop'); stop.dependencies.push({ tag: '!dependency', from: 'tickStop' });
    const start = await g.start({ name: 'overlapping empty conditions', procedure: procedure([action('X'), y, action('A', 'X', 'artifacts.X = "yes"'), action('B', 'Y', 'artifacts.Y = "yes"'), action('tickY'), action('tickStop'), stop, collectAction('gather', 'stop', ['A', 'B']), action('summary', 'gather')]) });
    const x1 = await produce(g, start.run.id, latest(start.steps, 'X').id, 'no');
    let y1 = await produce(g, start.run.id, latest(start.steps, 'Y').id, 'no');
    let stopped = await produce(g, start.run.id, latest(start.steps, 'stop').id);
    await produce(g, start.run.id, current(stopped.snapshot, 'summary')[0].id);
    if (multiple) {
      const tick = await produce(g, start.run.id, latest(start.steps, 'tickY').id);
      y1 = await produce(g, start.run.id, latest(tick.snapshot.steps, 'Y').id, 'no');
      const tickStop = await produce(g, start.run.id, latest(start.steps, 'tickStop').id);
      stopped = await produce(g, start.run.id, latest(tickStop.snapshot.steps, 'stop').id);
      await produce(g, start.run.id, latest(stopped.snapshot.steps, 'summary').id);
    }
    const xRewind = await g.rewind(start.run.id, x1.step.id, 'first independent empty condition');
    const yRewind = await g.rewind(start.run.id, y1.step.id, 'second independent empty condition');
    const x2 = await produce(g, start.run.id, xRewind.replacementStepId, 'no');
    assert.equal(current(x2.snapshot, 'gather').length, 0);
    const y2 = await produce(g, start.run.id, yRewind.replacementStepId, 'yes');
    assert.equal(current(y2.snapshot, 'gather').length, 0);
    const b = await produce(g, start.run.id, current(y2.snapshot, 'B')[0].id);
    assert.equal(current(b.snapshot, 'gather').length, 1);
    assert.deepEqual(current(b.snapshot, 'gather')[0].artifact, { mode: 'collect', items: { A: [], B: [b.artifact.id] } });
    assert.deepEqual(current(b.snapshot, 'gather')[0].inputs?.stop, [{ kind: 'artifact', id: stopped.artifact.id }]);
    assert.equal(current(b.snapshot, 'summary').length, 1);
  });
});

for (const mode of ['eliminated-inner', 'initially-empty', 'reviewed', 'two-levels', 'continuous', 'eliminated-outer-member']) test(`empty bridge preserves downstream production waits: ${mode}`, async t => {
  const f = await fixture(t);
  await f.service.withGraph(async g => {
    const reviewed = mode === 'reviewed', layered = mode === 'two-levels';
    const b = action('B', 'g1', mode === 'eliminated-outer-member' ? '$count(artifacts.C) > 0' : undefined);
    if (reviewed) b.artifact = { ...artifact, review: ['owner'] };
    const finalMember = layered ? 'D' : 'B';
    const actions = [action('X'), action('unrelated'), action('C', 'X', 'artifacts.X = "yes"'), action('stop1'), collectAction('g1', 'stop1', ['C']), b, ...(layered ? [action('stopMid'), collectAction('mid', 'stopMid', ['B']), action('D', 'mid')] : []), action('stop2'), collectAction('g2', 'stop2', [finalMember]), action('summary', 'g2')];
    const start = await g.start({ name: mode, procedure: procedure(actions), ...(reviewed ? { controlPlane: { runner: { permissions: ['artifact.read', 'artifact.submit', 'decision.decide'] }, actors: { human: { kind: 'human' as const, name: 'Owner', permissions: ['artifact.read', 'decision.decide'] } } }, reviewConfiguration: { reviews: { 'rewind-test#actions[B]': { policy: 'artifact_acceptance.unanimous' } }, slots: { 'rewind-test::owner': { actorIds: ['human'] } } } } : {}) });
    const accept = async (candidate: Awaited<ReturnType<typeof produce>>) => {
      if (!reviewed) return candidate.snapshot;
      const round = candidate.step.reviewRounds![0];
      await g.submitReview(start.run.id, candidate.step.id, round.id, 'human', 'approve');
      return g.submitReview(start.run.id, candidate.step.id, round.id, 'runner', 'approve');
    };
    const x1 = await produce(g, start.run.id, latest(start.steps, 'X').id, mode === 'initially-empty' ? 'no' : 'yes');
    if (mode !== 'initially-empty') await produce(g, start.run.id, current(x1.snapshot, 'C')[0].id);
    const stop1 = await produce(g, start.run.id, latest(start.steps, 'stop1').id);
    let state = await accept(await produce(g, start.run.id, current(stop1.snapshot, 'B')[0].id));
    if (layered) {
      const mid = await produce(g, start.run.id, latest(start.steps, 'stopMid').id);
      state = (await produce(g, start.run.id, current(mid.snapshot, 'D')[0].id)).snapshot;
    }
    state = (await produce(g, start.run.id, latest(start.steps, 'stop2').id)).snapshot;
    await produce(g, start.run.id, current(state, 'summary')[0].id);
    const rewind = await g.rewind(start.run.id, x1.step.id, 'empty the inner member path');
    let x2 = await produce(g, start.run.id, rewind.replacementStepId, 'no'); state = x2.snapshot;
    assert.deepEqual(current(state, 'g1')[0].artifact, { mode: 'collect', items: { C: [] } });
    if (mode === 'eliminated-outer-member') {
      assert.equal(current(state, 'B').length, 0);
      assert.equal(current(state, 'g2').length, 1);
      assert.deepEqual(current(state, 'g2')[0].artifact, { mode: 'collect', items: { B: [] } });
      assert.equal(state.run.frames![0].graphFrame.deferredCollects?.length, 0);
      return;
    }
    assert.equal(current(state, 'g2').length, 0);
    assert.equal(current(state, 'summary').length, 0);
    if (mode === 'continuous') {
      const oldB = current(state, 'B')[0]; await g.enter(start.run.id, oldB.id);
      const again = await g.rewind(start.run.id, x2.step.id, 'repeat before new B finishes');
      assert.ok(again.affectedStepIds.includes(oldB.id));
      x2 = await produce(g, start.run.id, again.replacementStepId, 'no'); state = x2.snapshot;
      assert.equal(current(state, 'g2').length, 0);
    }
    const pendingB = current(state, 'B')[0]; await g.enter(start.run.id, pendingB.id);
    assert.equal(current(await g.advance(start.run.id), 'g2').length, 0);
    const b2 = await produce(g, start.run.id, pendingB.id);
    if (reviewed) {
      assert.equal(b2.step.status, 'awaiting_review');
      assert.equal(current(b2.snapshot, 'g2').length, 0);
    }
    state = await accept(b2);
    let id = b2.artifact.id;
    if (layered) {
      assert.equal(current(state, 'g2').length, 0);
      const pendingD = current(state, 'D')[0]; await g.enter(start.run.id, pendingD.id);
      assert.equal(current(await g.advance(start.run.id), 'g2').length, 0);
      const d = await produce(g, start.run.id, pendingD.id); state = d.snapshot; id = d.artifact.id;
    }
    assert.equal(current(state, 'g2').length, 1);
    assert.deepEqual(current(state, 'g2')[0].artifact, { mode: 'collect', items: { [finalMember]: [id] } });
    assert.equal(current(state, 'summary').length, 1);
    assert.deepEqual(current(state, 'summary')[0].inputs, { [finalMember]: [{ kind: 'artifact', id }] });
    assert.equal(current(state, 'unrelated').length, 1);
    assert.equal(current(state, 'stop1')[0].id, stop1.step.id);
  });
});

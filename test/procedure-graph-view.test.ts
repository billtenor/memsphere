import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { businessFixture } from "./helpers/business-data.js";
import { openContextControl } from "../src/project/context-control.js";
import { readProjectConfig } from "../src/config.js";
import { createViewServer } from "../src/commands/view.js";
import { graphReviewHandle } from "../src/context_control/review-repository.js";
import { graphMemorySyntax } from "../src/memory/syntax.js";
import type { GraphProcedureMemory } from "../src/memory/ast.js";

test("graph View detail is read-only and each Step opens its own formal Review", { timeout: 60000 }, async t => {
  const f = await businessFixture(t, {}), service = (await openContextControl(f.root, true))!;
  const procedure: GraphProcedureMemory = { tag: "!procedure", syntax: graphMemorySyntax, names: ["view-graph"], mode: "graph", defines: ["View graph"], actions: ["A", "B"].map(id => ({ tag: "!action", id, description: `Produce ${id}`, dependencies: [{ tag: "!dependency", from: "START" }], artifact: { name: `${id} result`, model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/markdown" }, review: ["human"] } })) };
  const snapshot = await service.withGraph(async g => {
    const start = await g.start({ name: "View graph", procedure, controlPlane: { runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] }, actors: { human: { kind: "human", name: "Human", permissions: ["artifact.read", "decision.decide"] } }, acpProviders: {} }, reviewConfiguration: { reviews: { "view-graph#actions[A]": { policy: "artifact_acceptance.unanimous" }, "view-graph#actions[B]": { policy: "artifact_acceptance.unanimous" } }, slots: { "view-graph::human": { actorIds: ["human"] } } } });
    for (const step of start.steps) { await g.enter(start.run.id, step.id); await g.report(start.run.id, step.id, { text: `# ${step.source!.actionId} content` }); }
    return g.snapshot(start.run.id);
  });
  const config = await readProjectConfig("test-project", f.home), server = createViewServer(config);
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/test-project`;
  try {
    const response = await fetch(`${api}/runs/${snapshot.run.id}`);
    assert.equal(response.status, 200, await response.clone().text());
    const detail = await response.json();
    assert.equal(detail.run.context.graph.work.length, 2); assert.equal(detail.run.artifactReviewSummaries.length, 2);
    assert.deepEqual(detail.run.context.graph.work.map((s: any) => s.action.id), ["A", "B"]);
    for (const step of snapshot.steps) {
      const handle = graphReviewHandle(snapshot.run.id, step.id), round = step.reviewRounds![0];
      const response = await fetch(`${api}/runs/${snapshot.run.id}/artifact-reviews/${encodeURIComponent(handle)}/rounds/${round.id}?actor_id=human`);
      assert.equal(response.status, 200, await response.clone().text());
      const context = await response.json();
      assert.equal(context.submission.artifact.name, `${step.source!.actionId} result`);
      assert.equal(context.submission.contractArtifact.value.action.instruction, `Produce ${step.source!.actionId}`);
      assert.equal(context.assignment.status, "draft");
      assert.equal(context.submission.artifact.format.name, "markdown");
      assert.match(context.submission.artifact.renderedContent, /<h1>/);
    }
    for (const step of snapshot.steps) {
      const artifactId = step.reviewRounds![0].artifactId;
      const content = await fetch(`${api}/runs/${snapshot.run.id}/artifacts/${artifactId}/content`);
      assert.equal(content.status, 200);
      assert.equal((await content.json()).contentType, "text/markdown");
    }
    assert.deepEqual(await service.snapshot(snapshot.run.id), snapshot);
    const first = snapshot.steps[0], handle = graphReviewHandle(snapshot.run.id, first.id), round = first.reviewRounds![0];
    const endpoint = `${api}/artifact-reviews/${encodeURIComponent(handle)}/rounds/${round.id}/assignments/human`;
    const current = await (await fetch(`${api}/runs/${snapshot.run.id}/artifact-reviews/${encodeURIComponent(handle)}/rounds/${round.id}?actor_id=human`)).json();
    const draft = await fetch(`${endpoint}/draft`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: current.review.round.revision, vote: "request_changes", comments: [{ id: "inline-heading", body: "Clarify heading", severity: "risk", anchor: { submissionId: current.submission.id, sourceHash: current.submission.digest, target: "markdown:h1:0", location: "markdown:h1:0", context: "Candidate heading" } }] }) });
    assert.equal(draft.status, 200, await draft.clone().text());
    const saved = await draft.json(); assert.equal(saved.assignment.draft.comments[0].anchor.target, "markdown:h1:0");
    const submitted = await fetch(`${endpoint}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: saved.review.round.revision }) });
    assert.equal(submitted.status, 200, await submitted.clone().text());
    const opinion = await submitted.json(); assert.equal(opinion.assignment.submitted.comments[0].anchor.target, "markdown:h1:0");
    assert.equal((await service.snapshot(snapshot.run.id)).steps.find(s => s.id === first.id)!.status, "running");
    const row = await service.stores.run.get({}, snapshot.run.id);
    await writeFile(join(f.root, "data/context_control/runs/run-corrupt.json"), JSON.stringify({ ...row, id: "run-corrupt", value: { broken: true } }));
    const list = await (await fetch(`${api}/runs?representation=summary`)).json();
    assert.ok(list.runs.some((r: any) => r.id === snapshot.run.id)); assert.ok(list.runs.some((r: any) => r.id === "run-corrupt" && r.unavailable));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

for (const mode of ['missing', 'malformed', 'wrong-kind', 'cycle'] as const) test(`display-only frozen rule ${mode} cannot hide a Run or fail a successful abandon response`, {timeout:60000}, async t=>{
 const {serializeMemoryYaml}=await import('../src/memory/serializer.js');
 const f=await businessFixture(t,{}),service=(await openContextControl(f.root,true))!;
 const refs=['statements/bad-rules','statements/good-rules'];
 const procedure:GraphProcedureMemory={tag:'!procedure',syntax:graphMemorySyntax,names:['best-effort-rules'],defines:['Frozen display'],mode:'graph',actions:[{tag:'!action',id:'A',description:'Read rules',asserts:refs.map(target=>({tag:'!ref',target})),dependencies:[{tag:'!dependency',from:'START'}],artifact:{name:'Result',model:{definedBy:'raw.json',definition:'{}'},payload:{contentType:'text/plain'}}}]};
 const memoryRef='procedures/best-effort-rules';
 const source=(name:string)=>`!statement\nsyntax: ${graphMemorySyntax}\nnames: [${name}]\ndefines: [Rule source]\nasserts: [${name} evidence]\n`;
 const started=await service.withGraph(g=>g.start({name:`Rule ${mode}`,procedure,memorySnapshot:{memories:{[memoryRef]:{memoryRef,payload:{contentType:'application/yaml',content:serializeMemoryYaml(procedure)}},...Object.fromEntries(refs.map(reference=>[reference,{memoryRef:reference,payload:{contentType:'application/yaml',content:source(reference.split('/')[1])}}]))}}}));
 const stored=(await service.stores.run.get({},started.run.id))!,value=structuredClone(stored.value) as typeof started.run;
 const memories=value.memorySnapshot!.memories;
 if(mode==='missing')delete memories[refs[0]];
 else memories[refs[0]].payload.content=mode==='malformed'?'[':mode==='wrong-kind'?`!concept\nsyntax: ${graphMemorySyntax}\nnames: [bad-rules]\ndefines: [Wrong kind]\n`:`!statement\nsyntax: ${graphMemorySyntax}\nnames: [bad-rules]\ndefines: [Cycle]\nasserts:\n  - !ref\n    target: statements/bad-rules\n`;
 await service.stores.run.update({},started.run.id,value,{expectedRevision:stored.revision});
 const before=await service.stores.run.get({},started.run.id);
 const server=createViewServer(await readProjectConfig('test-project',f.home));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const api=`http://127.0.0.1:${(server.address()as AddressInfo).port}/api/projects/test-project/runs/${started.run.id}`;
 try{
  const response=await fetch(api);assert.equal(response.status,200,await response.clone().text());const payload=await response.json();
  assert.equal(payload.run.context.graph.work.length,1);assert.equal(payload.run.context.graph.procedure.actions[0].asserts.length,2);
  assert.deepEqual(payload.run.context.graph.procedure.actions[0].effectiveRules.asserts.map((rule:any)=>rule.reference),[refs[1]]);
  assert.deepEqual(await service.stores.run.get({},started.run.id),before,'GET must not repair or mutate stored history');
  const abandoned=await fetch(`${api}/abandon`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(abandoned.status,200,await abandoned.clone().text());assert.equal((await abandoned.json()).run.status,'abandoned');
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});

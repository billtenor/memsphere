import { browserScope } from "./helpers/browser.js";
import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { businessFixture } from "./helpers/business-data.js";
import { openContextControl } from "../src/project/context-control.js";
import { readProjectConfig } from "../src/config.js";
import { createViewServer } from "../src/commands/view.js";
import { graphMemorySyntax } from "../src/memory/syntax.js";
import type { GraphProcedureMemory } from "../src/memory/ast.js";

test("graph View renders Markdown and submits a Human inline opinion inside the Graph dialog", { timeout: 60000 }, async t => {
  const f = await businessFixture(t, {}), service = (await openContextControl(f.root, true))!;
  const procedure: GraphProcedureMemory = { tag: "!procedure", syntax: graphMemorySyntax, names: ["browser-graph"], defines: ["Graph review browser contract"], mode: "graph", actions: [{ tag: "!action", id: "A", description: "Prepare the candidate", dependencies: [{ tag: "!dependency", from: "START" }], artifact: { name: "Candidate", model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/markdown" }, review: ["reviewer"] } }] };
  const report = await service.withGraph(async g => {
    const start = await g.start({ name: "Graph Human review", procedure, controlPlane: { runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] }, actors: { human: { kind: "human", name: "Human", permissions: ["artifact.read", "decision.decide"] } }, acpProviders: {} }, reviewConfiguration: { reviews: { "browser-graph#actions[A]": { policy: "artifact_acceptance.unanimous" } }, slots: { "browser-graph::reviewer": { actorIds: ["human"] } } } });
    await g.enter(start.run.id, start.steps[0].id); return g.report(start.run.id, start.steps[0].id, { text: "# Graph candidate\n\nEvidence is pending." });
  });
  const server = createViewServer(await readProjectConfig("test-project", f.home));
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const browser = await browserScope();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(15000);
    let releaseList!:()=>void;const listGate=new Promise<void>(resolve=>{releaseList=resolve;});
    await page.route("**/runs?representation=summary**",async route=>{await listGate;await route.continue();});
    const requests:string[]=[];page.on("request",request=>{requests.push(request.url());});
    await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/projects/test-project/tasks/${report.snapshot.run.id}`);
    try{await page.locator(".pg-node[data-action-id=A]").waitFor();assert.ok(requests.some(url=>url.includes("representation=overview")));assert.equal(requests.some(url=>url.includes("artifact-reviews")||url.includes("representation=action")||url.includes("representation=artifacts")||url.includes("/content")),false);}finally{releaseList();}

    let releaseReview!:()=>void;const reviewGate=new Promise<void>(resolve=>{releaseReview=resolve;});
    await page.route("**/artifact-reviews/**/rounds/**",async route=>{await reviewGate;await route.continue();});
    await page.locator(".pg-node[data-action-id=A]").click();
    await page.locator(".cc-dialog").waitFor();
    try{await page.locator(".cc-pane-content h1").filter({hasText:"Graph candidate"}).waitFor();assert.equal(await page.locator("#artifact-review-my-panel").count(),0,"visible content must not await review");}finally{releaseReview();}
    await page.unroute("**/artifact-reviews/**/rounds/**");
    const modal = page.locator(".cc-dialog"); await modal.locator("#artifact-review-my-panel").waitFor();
    const ratio=async()=> (await modal.locator(".cc-pane-review").boundingBox())!.width/(await modal.locator(".cc-modal-columns").boundingBox())!.width;
    assert.ok(Math.abs(await ratio()-.3)<.01);
    await page.setViewportSize({width:1440,height:600});assert.ok(Math.abs(await ratio()-.3)<.01);
    const header=modal.locator(".cc-review-pane-head");const beforeHeader=(await header.boundingBox())!;
    const scroll=modal.locator(".cc-review-scroll");assert.ok(await scroll.evaluate(el=>el.scrollHeight>el.clientHeight));
    await scroll.evaluate(el=>{el.scrollTop=el.scrollHeight;});
    assert.ok(Math.abs((await header.boundingBox())!.y-beforeHeader.y)<1,"review heading stays fixed while content scrolls");
    assert.equal(await header.getByRole("button",{name:"收起评审",exact:true}).isVisible(),true);
    await scroll.evaluate(el=>{el.scrollTop=0;});await page.setViewportSize({width:1280,height:900});
    assert.equal(await page.locator("#artifact-review-modal").count(), 0);
    assert.equal(await modal.getByRole("combobox",{name:"选择评审材料",exact:true}).count(),0);
    for(const name of ["执行实例","产物版本","轮次"]){
      const control=modal.getByRole("combobox",{name,exact:true});
      await control.click();
      const list=modal.getByRole("listbox");await list.waitFor();
      await list.getByRole("option").first().click();
      await list.waitFor({state:"detached"});
    }

    await modal.getByRole("button",{name:"关闭",exact:true}).click();
    await page.getByRole("button",{name:"产物视角",exact:true}).click();
    await page.locator(`.cc-node[data-artifact-id="${report.step.artifact?.mode==="produce"?report.step.artifact.id:""}"]`).click();
    await modal.locator("#artifact-review-my-panel").waitFor();

    assert.equal(await modal.locator(".cc-review-material h1").innerText(), "Graph candidate");
    await modal.locator(".inline-plus").first().click();
    const editor = modal.locator(".inline-comment-editor"); await editor.getByPlaceholder("这里应该如何修改？").fill("补充验收依据");
    const saved = page.waitForResponse(r => r.url().endsWith("/draft") && r.request().method() === "PATCH");
    await editor.getByRole("button", { name: "添加意见", exact: true }).click(); assert.equal((await saved).status(), 200);
    await modal.getByText("补充验收依据", { exact: true }).waitFor();
    await modal.getByRole("radio", { name: "要求修改", exact: true }).click();
    await modal.getByRole("button", { name: "提交评审", exact: true }).click();
    const confirm = page.locator("dialog.mem-view-confirm"); await confirm.waitFor();
    const submitted = page.waitForResponse(r => r.url().endsWith("/submit") && r.request().method() === "POST");
    await confirm.getByRole("button", { name: "提交评审", exact: true }).click(); assert.equal((await submitted).status(), 200);
    const snapshot = await service.snapshot(report.snapshot.run.id);
    assert.equal(snapshot.steps[0].id, report.step.id); assert.equal(snapshot.steps[0].status, "running");
    assert.equal(snapshot.reviews[0].comments[0].anchor!.location, "markdown:h1:0");
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll(".run-error,.memory-error")].map(n => n.textContent)), []);
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("collect dialog lists concrete members without raw JSON and opens the frozen artifact", { timeout:60000 },async t=>{
 const f=await businessFixture(t,{}),service=(await openContextControl(f.root,true))!;
 const procedure:GraphProcedureMemory={tag:"!procedure",syntax:graphMemorySyntax,names:["collect-browser"],defines:["Collection presentation"],mode:"graph",actions:[{tag:"!action",id:"produce",description:"Prepare the document",dependencies:[{tag:"!dependency",from:"START"}],artifact:{name:"Example document",model:{definedBy:"raw.json",definition:"{}"},payload:{contentType:"text/markdown"}}},{tag:"!action",id:"collect",description:"Collect the document",dependencies:[{tag:"!dependency",from:"produce"}],collect:["produce"]}]};
 const snapshot=await service.withGraph(async g=>{const start=await g.start({name:"Collect presentation",procedure,controlPlane:{runner:{permissions:["artifact.read","artifact.submit"]},actors:{},acpProviders:{}}});await g.enter(start.run.id,start.steps[0].id);await g.report(start.run.id,start.steps[0].id,{text:"# Frozen document"});return g.snapshot(start.run.id);});
 const server=createViewServer(await readProjectConfig("test-project",f.home));await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});const browser=await browserScope();
 try{const page=await browser.newPage({viewport:{width:1280,height:900}});await page.goto(`http://127.0.0.1:${(server.address()as AddressInfo).port}/projects/test-project/tasks/${snapshot.run.id}`);await page.locator('.pg-node[data-action-id=collect]').click();const dialog=page.locator('.cc-dialog[open]');await dialog.waitFor();await dialog.locator('.cc-member-list>.cc-member-row').first().waitFor();assert.equal(await dialog.locator('.cc-member-list>.cc-member-row').count(),1);assert.equal(await dialog.locator('pre').count(),0);assert.equal(await dialog.locator('.cc-modal-head select').count(),0);assert.ok((await dialog.innerText()).includes('已完成'));assert.equal(await dialog.locator('.cc-upstream-links button').count(),1);await dialog.locator('.cc-upstream-links').getByRole('button',{name:/Example document/}).click();await page.getByRole('heading',{name:'Frozen document',exact:true}).waitFor();const review=page.locator('.cc-pane-review');assert.ok(Math.abs((await review.boundingBox())!.width/(await page.locator(".cc-modal-columns").boundingBox())!.width-.3)<.01);await page.getByRole('button',{name:'收起评审',exact:true}).click();assert.equal(await review.isVisible(),false);await page.getByRole('button',{name:'展开评审',exact:true}).click();assert.equal(await review.isVisible(),true);assert.equal(await dialog.locator('pre').count(),0);assert.equal(await dialog.locator('.cc-modal-head select').count(),0);assert.equal(await dialog.locator('.cc-related').count(),0);await page.getByRole('button',{name:'← 返回',exact:true}).click();assert.equal(await dialog.locator('.cc-member-list>.cc-member-row').count(),1);
 await dialog.getByRole('button',{name:'关闭',exact:true}).click();
 for(let attempt=0;attempt<2;attempt++){
  await page.locator(`[data-item-id="${snapshot.run.id}"]`).waitFor({state:'visible'});
  await page.getByRole('complementary',{name:'Secondary navigation',exact:true}).getByRole('button',{name:'运行中',exact:true}).click();await page.waitForURL(/\/tasks(?:\?|$)/);
  await page.locator(`[data-item-id="${snapshot.run.id}"]`).click();await page.locator('.pg-node').first().waitFor();
  assert.equal(await page.locator('.view-host-module-error').count(),0);
 }
 const edgeStyle=await page.locator('.pg-edge').first().evaluate(el=>{const css=getComputedStyle(el);return {stroke:css.stroke,expected:(()=>{const probe=document.createElement('span');probe.style.color='var(--mem-view-color-text-muted)';el.parentElement!.append(probe);const color=getComputedStyle(probe).color;probe.remove();return color;})(),opacity:css.opacity,width:css.strokeWidth};});assert.equal(edgeStyle.stroke,edgeStyle.expected);assert.equal(edgeStyle.opacity,'1');assert.equal(edgeStyle.width,'1.5px');
 const workflowHeight=await page.locator('.pg .pg-viewport').evaluate(el=>el.clientHeight),statistics=await page.locator('.pg .pg-metadata').innerText();
 await page.getByRole('button',{name:'产物视角',exact:true}).click();await page.locator('.cc-graph[data-layout-ready]').waitFor();
 assert.equal(await page.locator('.cc-canvas-scroll').evaluate(el=>el.clientHeight),workflowHeight);
 assert.equal(await page.locator('.cc-graph-card .pg-metadata').innerText(),statistics);
 assert.equal(await page.locator('.cc-graph-card .pg-controls button').count(),4);
 assert.equal(await page.locator('.cc-toolbar').isVisible(),false);
 }
 finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('real graph joins preserve evidence, frozen rules and closed zero-instance dialogs across refresh', {timeout:60000}, async t=>{
 const {serializeMemoryYaml}=await import('../src/memory/serializer.js');
 const f=await businessFixture(t,{}),service=(await openContextControl(f.root,true))!;
 const make=(id:string,from:string|string[]='START',when?:string)=>({tag:'!action' as const,id,description:`工作 ${id}`,dependencies:[{tag:'!dependency' as const,from,...(when?{when}:{})}],artifact:{name:`产物 ${id}`,model:{definedBy:'raw.json',definition:'{}'},payload:{contentType:'text/markdown'}}});
 const never={...make('never','A','false'),asserts:[{tag:'!ref' as const,target:'statements/frozen-rules'}],artifact:{...make('never').artifact,asserts:['产物层要求'],suggests:[{tag:'!ref' as const,target:'statements/frozen-rules'}]}};
 const procedure:GraphProcedureMemory={tag:'!procedure',syntax:graphMemorySyntax,names:['evidence-browser'],defines:['Evidence'],mode:'graph',actions:[make('A'),make('B'),make('join',['A','B']),make('reject',['A','B'],'false'),never,{tag:'!action',id:'empty',description:'收集尚无产物的来源',dependencies:[{tag:'!dependency',from:'A'}],collect:['never']}]};
 const memoryRef='procedures/evidence-browser';
 const start=await service.withGraph(g=>g.start({name:'Evidence browser',procedure,memorySnapshot:{memories:{[memoryRef]:{memoryRef,payload:{contentType:'application/yaml',content:serializeMemoryYaml(procedure)}},'statements/frozen-rules':{memoryRef:'statements/frozen-rules',payload:{contentType:'application/yaml',content:'!statement\nsyntax: memsphere-20261027-stable\nnames: [frozen-rules]\ndefines: [冻结规则来源]\nasserts: [冻结要求正文]\nsuggests: [冻结建议正文]\n'}}}}}));
 const step=(id:string)=>start.steps.find(s=>s.source?.actionId===id)!;
 const server=createViewServer(await readProjectConfig('test-project',f.home));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const browser=await browserScope();
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(`http://127.0.0.1:${(server.address()as AddressInfo).port}/projects/test-project/tasks/${start.run.id}`);
  const edge=(to:string)=>page.locator(`.pg-hit[data-edge="${to}:0:A"]`);
  const openEdge=async(to:string)=>{await edge(to).focus();await page.keyboard.press('Enter');};
  const refresh=async()=>{const response=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith(`/runs/${start.run.id}`)&&r.request().method()==='GET');await page.getByRole('button',{name:'刷新',exact:true}).click();await response;};
  await openEdge('join');await page.getByText('暂无可用的汇合记录',{exact:true}).waitFor();await page.keyboard.press('Escape');
  await page.locator('.pg-node[data-action-id=never]').click();const zero=page.locator('.pg-dialog[open]');await zero.locator('.pg-rule-reference').first().locator('summary').click();await zero.getByText('冻结要求正文',{exact:true}).waitFor();await zero.locator('.pg-rule-reference').nth(1).locator('summary').click();await zero.getByText('冻结建议正文',{exact:true}).waitFor();assert.ok((await zero.innerText()).includes('产物层要求'));await page.keyboard.press('Escape');
  await service.withGraph(g=>g.enter(start.run.id,step('B').id));await refresh();await page.locator('.pg-node[data-action-id=B] .pg-badge').getByText('执行中 1',{exact:true}).waitFor();assert.equal(await page.locator('dialog[open]').count(),0);
  await service.withGraph(async g=>{await g.enter(start.run.id,step('A').id);await g.report(start.run.id,step('A').id,{text:'# A 正文'});});await refresh();await page.locator('.pg-node[data-action-id=A] .pg-badge').getByText('已完成 1',{exact:true}).waitFor();
  await openEdge('join');const evidence=page.locator('.cc-join-evidence');assert.deepEqual(await evidence.locator('section').nth(0).locator('li').allTextContents(),['产物 A']);assert.deepEqual(await evidence.locator('section').nth(1).locator('li').allTextContents(),['产物 B']);assert.equal(await evidence.locator('pre').count(),0);await page.keyboard.press('Escape');
  await page.locator('.pg-node[data-action-id=empty]').click();await page.locator('.cc-member-heading').waitFor();assert.ok((await page.locator('.cc-dialog[open]').innerText()).includes('0 个产物'));assert.equal(await page.locator('.cc-member-list>.cc-member-row').count(),0);await page.keyboard.press('Escape');
  const viewport=page.locator('.pg .pg-viewport');await viewport.evaluate(el=>{el.scrollLeft=80;});const scroll=await viewport.evaluate(el=>el.scrollLeft);
  await service.withGraph(g=>g.report(start.run.id,step('B').id,{text:'# B 正文'}));await refresh();await page.locator('.pg-node[data-action-id=B] .pg-badge').getByText('已完成 1',{exact:true}).waitFor();await page.locator('.pg[data-layout-state=ready]').waitFor();assert.equal(await viewport.evaluate(el=>el.scrollLeft),scroll);
  // State changes may legitimately alter geometry. Only unchanged geometry must retain the SVG.
  await page.locator('.pg-edges').evaluate(el=>el.setAttribute('data-layout-identity','retained'));
  const joined=(await service.snapshot(start.run.id)).steps.find(s=>s.source?.actionId==='join')!;
  await service.withGraph(g=>g.enter(start.run.id,joined.id));await refresh();await page.locator('.pg-node[data-action-id=join] .pg-badge').getByText('执行中 1',{exact:true}).waitFor();await page.locator('.pg[data-layout-state=ready]').waitFor();assert.equal(await page.locator('.pg-edges').getAttribute('data-layout-identity'),'retained');
  await page.getByRole('button',{name:'产物视角',exact:true}).click();await page.locator('.cc-graph[data-layout-ready]').waitFor();
  await service.withGraph(g=>g.report(start.run.id,joined.id,{text:'# Joined'}));await refresh();
  await page.getByRole('button',{name:'流程视角',exact:true}).click();await page.locator('.pg-node[data-action-id=join] .pg-badge').getByText('已完成 1',{exact:true}).waitFor();await page.locator('.pg[data-layout-state=ready]').waitFor();assert.equal(await page.locator('.pg-edges').getAttribute('data-layout-identity'),'retained');
  await openEdge('join');await page.getByText('已汇合并触发执行',{exact:true}).waitFor();assert.equal(await page.locator('.cc-join-evidence').getByText('尚未到达',{exact:true}).count(),0);await page.keyboard.press('Escape');
  await openEdge('reject');await page.getByText('最近一次汇合的条件未通过',{exact:true}).waitFor();assert.equal(await page.locator('.cc-join-evidence pre').count(),0);
 }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
});

test('two executions and a reviewed revision retain exact artifacts and reading state on refresh', {timeout:60000}, async t=>{
 const f=await businessFixture(t,{}),service=(await openContextControl(f.root,true))!;
 const procedure:GraphProcedureMemory={tag:'!procedure',syntax:graphMemorySyntax,names:['revision-browser'],defines:['Revision'],mode:'graph',actions:[{tag:'!action',id:'A',description:'循环产物',dependencies:[{tag:'!dependency',from:'START'},{tag:'!dependency',from:'A',when:'$contains(artifacts.A, "again")'}],artifact:{name:'产物版本',model:{definedBy:'raw.json',definition:'{}'},payload:{contentType:'text/markdown'},review:['human']}}]};
 const cp={runner:{permissions:['artifact.read','artifact.submit','decision.decide']},actors:{human:{kind:'human' as const,name:'Human',permissions:['artifact.read','decision.decide']}},acpProviders:{}};
 const state=await service.withGraph(async g=>{
  const start=await g.start({name:'Execution versions',procedure,controlPlane:cp,reviewConfiguration:{reviews:{'revision-browser#actions[A]':{policy:'artifact_acceptance.unanimous'}},slots:{'revision-browser::human':{actorIds:['human']}}}}),first=start.steps[0];
  await g.enter(start.run.id,first.id);const candidate=await g.report(start.run.id,first.id,{text:'# candidate'}),round=candidate.step.reviewRounds![0];
  await g.submitReview(start.run.id,first.id,round.id,'human','request_changes',[{id:'first-fix',body:'Revise',createdAt:start.run.createdAt,updatedAt:start.run.createdAt}], 'Revise');
  const revised=await g.report(start.run.id,first.id,{text:'# again\n\n'+('Long evidence\n\n'.repeat(100)),revisionSummary:'Updated candidate'}),nextRound=revised.step.reviewRounds!.at(-1)!;
  await g.submitReview(start.run.id,first.id,nextRound.id,'human','approve');await g.submitReview(start.run.id,first.id,nextRound.id,'runner','approve');
  const snapshot=await g.snapshot(start.run.id),second=snapshot.steps.find(s=>s.id!==first.id)!;await g.enter(start.run.id,second.id);const secondReport=await g.report(start.run.id,second.id,{text:'# final'});
  return {runId:start.run.id,firstId:first.id,secondId:second.id,oldId:candidate.artifact.id,revisedId:revised.artifact.id,finalId:secondReport.artifact.id,secondRound:secondReport.step.reviewRounds!.at(-1)!.id};
 });
 const server=createViewServer(await readProjectConfig('test-project',f.home));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const browser=await browserScope();
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const origin=`http://127.0.0.1:${(server.address()as AddressInfo).port}`;const api=await fetch(`${origin}/api/projects/test-project/runs/${state.runId}`);assert.equal(api.status,200,await api.clone().text());const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`${origin}/projects/test-project/tasks/${state.runId}`);try{await page.locator('.pg-node[data-action-id=A]').waitFor({timeout:8000});}catch(error){t.diagnostic(JSON.stringify({errors,body:await page.locator('body').innerText()}));throw error;}await page.locator('.pg-node[data-action-id=A]').click();const dialog=page.locator('.cc-dialog[open]');await dialog.getByRole('heading',{name:'final',exact:true}).waitFor();
  const execution=dialog.getByRole('combobox',{name:'执行实例',exact:true});assert.equal(await execution.locator('option').count(),2);assert.equal(await execution.inputValue(),state.secondId);
  await execution.selectOption(state.firstId);await dialog.getByRole('heading',{name:'again',exact:true}).waitFor();assert.equal(await dialog.getAttribute('data-artifact-id'),state.revisedId);
  await dialog.getByRole('combobox',{name:'产物版本',exact:true}).selectOption(state.oldId);await dialog.getByRole('heading',{name:'candidate',exact:true}).waitFor();
  await dialog.getByRole('combobox',{name:'产物版本',exact:true}).selectOption(state.revisedId);await dialog.getByRole('heading',{name:'again',exact:true}).waitFor();await dialog.locator('.cc-execution-info summary').click();await dialog.locator('.cc-pane-content').evaluate(el=>{el.scrollTop=240;});
  const before=await dialog.locator('.cc-pane-content').evaluate(el=>el.scrollTop);
  // A second execution changes status, rebuilding the selector without losing the selected first execution or its reading state.
  await service.withGraph(g=>g.submitReview(state.runId,state.secondId,state.secondRound,'human','request_changes',[{id:'second-fix',body:'Amend second execution',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}],'Amend second execution'));
  const response=await page.request.get(`http://127.0.0.1:${(server.address()as AddressInfo).port}/api/projects/test-project/runs/${state.runId}`);assert.equal(response.status(),200);
  await page.getByRole('button',{name:'刷新',exact:true}).dispatchEvent('click');await dialog.locator('.cc-execution-select option').filter({hasText:'第2次执行 · 执行中'}).waitFor({state:'attached'});assert.equal(await dialog.locator('.cc-execution-info').evaluate(el=>(el as HTMLDetailsElement).open),true);assert.equal(await dialog.locator('.cc-pane-content').evaluate(el=>el.scrollTop),before);assert.equal(await dialog.getAttribute('data-artifact-id'),state.revisedId);
 }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
});

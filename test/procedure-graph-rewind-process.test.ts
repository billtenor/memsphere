import {processGates} from './fixtures/process-gates.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {terminateProcessTree} from '../src/platform-process.js';
import {writeFile, readdir} from 'node:fs/promises';
import {readConfig} from '../src/config.js';
import {dispatchArtifactReviewAgents} from '../src/acp/dispatcher.js';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {initializedContextFixture} from './helpers/initialized-context.js';
import {openContextControl} from '../src/project/context-control.js';
import {captureProcessIdentity,stopRewindWorker} from '../src/context_control/review-process.js';
import * as reviews from '../src/context_control/review-repository.js';
import type {GraphProcedureMemory} from '../src/memory/ast.js';
import type {Run} from '../src/context_control/types.js';
// OS liveness has no portable exit event for non-child descendants. Bound each
// observation loop; success always requires the actual identity probe.
async function until<T>(read:()=>Promise<T|undefined>){const end=Date.now()+60000;while(Date.now()<end){const value=await read();if(value)return value;await delay(25);}throw Error('Timed out waiting for process readiness');}
// These assertions ask whether an owned fixture PID is alive, not for its
// creation identity. Windows signal 0 queries that directly without spawning
// PowerShell for every PID; identity safety remains covered by native CIM tests.
const alive=async(pid:number)=>{
 if(process.platform!=='win32')return Boolean(await captureProcessIdentity(pid));
 try{process.kill(pid,0);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error;}
};

test('a mismatched OS start identity never signals a live detached process', {skip:process.platform==='win32'}, async t=>{
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
 t.after(()=>{try{process.kill(-child.pid!,'SIGKILL');}catch{}});
 await once(child,'spawn');
 const identity=await captureProcessIdentity(child.pid!);
 assert.ok(identity);
 await assert.rejects(stopRewindWorker({pid:child.pid!,identity:{...identity,started:'different kernel start'},reviewId:'review',attemptId:'attempt',members:[identity]}),{code:'PROCESS_IDENTITY_CHANGED'});
 assert.equal(await alive(child.pid!),true);
 await stopRewindWorker({pid:child.pid!,identity,reviewId:'review',attemptId:'attempt',members:[identity]});
 assert.equal(await alive(child.pid!),false);
});

for(const {resistant,late,failOnce,orphan=false,launchGate=undefined,submitted=false,nativeDispatch=false,completed=false} of [{resistant:false,late:false,failOnce:false,submitted:true,completed:true},{resistant:false,late:false,failOnce:true,nativeDispatch:true},{resistant:false,late:false,failOnce:true,submitted:true},{resistant:false,late:false,failOnce:false},{resistant:true,late:false,failOnce:false},{resistant:false,late:true,failOnce:false},{resistant:false,late:false,failOnce:false,orphan:true},{resistant:false,late:false,failOnce:false,launchGate:"before-provider"},{resistant:false,late:false,failOnce:false,launchGate:"after-provider"}])test(`rewind stops the real ACP worker/provider group${completed?" after normal completion and exit":nativeDispatch?" through the native dispatcher":submitted?" after voting but before prompt returns":launchGate?` at ${launchGate}`:resistant?' through persisted cancellation recovery':late?' before late claim':failOnce?' after termination failure':orphan?' with orphaned Windows descendants':''} and preserves an unrelated reviewer`,{timeout:240000,skip:(resistant&&process.platform==='win32')||(orphan&&process.platform!=='win32')},async t=>{
 const gates=await processGates(t.signal);
 const f=await initializedContextFixture(t);
 t.after(()=>gates.close());
 if(nativeDispatch){const previous=process.env.MEMSPHERE_HOME;process.env.MEMSPHERE_HOME=f.home;f.beforeCleanup(async()=>{if(previous===undefined)delete process.env.MEMSPHERE_HOME;else process.env.MEMSPHERE_HOME=previous;});}
 const service=(await openContextControl(f.root))!;
 const spec={name:'body',model:{definedBy:'raw.json',definition:'{}'},payload:{contentType:'text/plain'}};
 const actor={kind:'agent' as const,name:'reviewer',permissions:['artifact.read' as const,'decision.assess' as const],agent:{provider:'test',providerType:'traex' as const,command:process.execPath,args:[fileURLToPath(new URL('./fixtures/fake-acp-reviewer.mjs',import.meta.url)),'rewind-gated'],env:{REVIEW_TEST_GATES:String(gates.endpoint),REVIEW_TEST_READY_PREFIX:f.directory},startupTimeoutMs:10000,idleTimeoutMs:null}};
 const p:GraphProcedureMemory={tag:'!procedure',syntax:'memsphere-20261027-stable',mode:'graph',names:['process-rewind'],defines:['process test'],actions:[{tag:'!action',id:'A',description:'product',dependencies:[{tag:'!dependency',from:'START'}],artifact:spec},{tag:'!action',id:'T',description:'technical',dependencies:[{tag:'!dependency',from:'A'}],artifact:{...spec,review:['check']}},{tag:'!action',id:'independent',description:'independent',dependencies:[{tag:'!dependency',from:'START'}],artifact:{...spec,review:['check']}}]};
 const start=await service.withGraph(g=>g.start({name:'cancel groups',procedure:p,controlPlane:{runner:{permissions:['artifact.read','artifact.submit','decision.decide']},actors:{reviewer:actor}},reviewConfiguration:{reviews:{'process-rewind#actions[T]':{policy:'artifact_acceptance.unanimous'},'process-rewind#actions[independent]':{policy:'artifact_acceptance.unanimous'}},slots:{'process-rewind::check':{actorIds:['reviewer']}}}}));
 const product=await service.withGraph(async g=>{const a=start.steps.find(s=>s.source?.actionId==='A')!;await g.enter(start.run.id,a.id);return g.report(start.run.id,a.id,{text:'A1'});});
 const candidates=[];
 for(const name of ['T','independent'])candidates.push(await service.withGraph(async g=>{const s=product.snapshot.steps.find(s=>s.source?.actionId===name)!;await g.enter(start.run.id,s.id);return g.report(start.run.id,s.id,{text:name});}));
 const processes=[];
 let dispatch:Promise<number>|undefined,releaseDispatch:(()=>void)|undefined;
 t.after(async()=>{releaseDispatch?.();await dispatch?.catch(()=>undefined);});
 const launch=async(i:number)=>{
  if(nativeDispatch&&i===0){
   const candidate=candidates[0],config=await readConfig(join(f.root,'config.json'));
   const ready=join(f.directory,reviews.graphReviewHandle(start.run.id,candidate.step.id));
   let reads=0,reached!:()=>void;
   const paused=new Promise<void>(resolve=>{reached=resolve;});
   const release=new Promise<void>(resolve=>{releaseDispatch=resolve;});
   dispatch=dispatchArtifactReviewAgents({config:{...config,debug:{...config.debug,agentReview:false}},run:await reviews.readRun(config.runsRoot,start.run.id),workspaceRoot:f.cwd,runtime:{nodeExecutable:process.execPath,cliEntrypoint:fileURLToPath(new URL('./fixtures/dispatcher-review-worker.mjs',import.meta.url))}}, {readRun:async(...args)=>{
    if(++reads===3){await gates.wait(ready);reached();await release;}
    return reviews.readRun(...args);
   }});
   await Promise.race([paused,dispatch.then(()=>{throw Error('dispatcher exited before the post-spawn boundary');})]);
   const info=await gates.wait(ready);
   const draft=await reviews.readArtifactReviewForActor({runsRoot:config.runsRoot,reviewId:reviews.graphReviewHandle(start.run.id,candidate.step.id),roundId:candidate.step.reviewRounds![0].id,actorId:'reviewer'});
   const workerPid=draft.assignment.attempts!.at(-1)!.workerPid!;
   f.beforeCleanup(()=>terminateProcessTree(workerPid,'SIGKILL',process.platform,true).catch(()=>undefined));
   processes[0]={workerPid,ready,...info};
   return;
  }
  const candidate=candidates[i],ready=join(f.directory,`ready-${i}.json`),input=join(f.directory,`worker-${i}.json`);
  await writeFile(input,JSON.stringify({config:join(f.root,'config.json'),review:reviews.graphReviewHandle(start.run.id,candidate.step.id),round:candidate.step.reviewRounds![0].id,assignment:'reviewer',cliEntrypoint:fileURLToPath(new URL('../dist/cli.js',import.meta.url)),workspaceRoot:f.cwd,ready,gates:gates.endpoint,...(completed&&i===0?{completed:true}:{}),...(submitted&&i===0?{submitted:true}:{}),...(launchGate&&i===0?{launchGate}:{}),...(orphan?{release:join(f.directory,`release-orphans-${i}`)}:{}) ,...(late&&i===0?{claimGate:join(f.directory,'release-claim')}:{})}));
  const worker=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/graph-review-worker.mjs',import.meta.url)),input],{detached:true,stdio:['ignore','ignore','pipe'],env:{...process.env,MEMSPHERE_HOME:f.home,...(resistant&&i===0?{REVIEW_TEST_RESISTANT:'yes'}:{})}});
  let errors='';worker.stderr!.on('data',s=>errors+=s);
  f.beforeCleanup(async()=>{
   if(orphan)gates.publish(join(f.directory,`release-orphans-${i}`));
   await terminateProcessTree(worker.pid!,'SIGKILL',process.platform,true).catch(()=>undefined);
   if(worker.exitCode===null&&worker.signalCode===null)await once(worker,'exit');
  });
  const lifetime=new AbortController();
  worker.once('exit',()=>lifetime.abort(new Error(errors||'Fixture worker exited before readiness')));
  const info=await Promise.race([gates.wait(ready),new Promise((_,reject)=>lifetime.signal.addEventListener('abort',()=>reject(lifetime.signal.reason),{once:true}))]);
  processes[i]={workerPid:worker.pid!,worker,exited:once(worker,'exit'),ready,...info};
 };
 // Only the native dispatcher needs the unrelated assignment already claimed.
 // Other workers use separate Review records and can reach readiness together.
 if(nativeDispatch){await launch(1);await launch(0);}
 else {
  const results=await Promise.allSettled([0,1].map(launch));
  for(const result of results)if(result.status==='rejected')throw result.reason;
 }
 const old=candidates[0],common={runsRoot:join(f.root,'runs'),reviewId:reviews.graphReviewHandle(start.run.id,old.step.id),roundId:old.step.reviewRounds![0].id,actorId:'reviewer'};
 const draft=await reviews.readArtifactReviewForActor(common);
 if(!late&&!launchGate)assert.ok(draft.assignment.attempts![0].cliReadyAt);
 const submittedReview = submitted ? (await service.snapshot(start.run.id)).reviews.find(r=>r.artifactId===old.artifact.id)! : undefined;
 if(submitted){assert.equal(draft.assignment.status,'submitted');assert.ok(submittedReview!.attempts!.at(-1)!.completion);}
 if(completed){
  gates.publish(`finish-review:${processes[0].ready}`);
  const [code]=await processes[0].exited;
  assert.equal(code,0,'Reviewer completes the actual ACP session normally');
  await until(async()=>await alive(processes[0].providerPid)||await alive(processes[0].childPid)?undefined:true);
  const attempt=(await service.snapshot(start.run.id)).reviews.find(r=>r.artifactId===old.artifact.id)!.attempts!.at(-1)!;
  assert.ok(attempt.workerMembers?.some(member=>member.pid===processes[0].childPid),'descendant identity persisted before Provider stop');
 }
 if(orphan){
  await assert.rejects(service.withGraph(g=>{
   g.stopReviewer=async worker=>{
    process.kill(worker.pid,'SIGKILL');
    await until(async()=>await alive(worker.pid)?undefined:true);
    assert.equal(await alive(processes[0].childPid),true,'fixture child survives worker exit until explicitly released');
    await stopRewindWorker(worker);
   };
   return g.rewind(start.run.id,product.step.id,'bad product');
  }),{code:'PROCESS_TERMINATION_PENDING'});
  assert.ok((await service.snapshot(start.run.id)).run.frames![0].graphFrame.pendingRewind);
  assert.equal(await alive(processes[0].childPid),true);
  gates.publish(join(f.directory,'release-orphans-0'));
  await until(async()=>await alive(processes[0].childPid)||await alive(processes[0].providerPid)?undefined:true);
  await service.withGraph(g=>g.advance(start.run.id));
 }else if(completed){
  await assert.rejects(service.withGraph(g=>{
   g.stopReviewer=async()=>{throw Error('interrupted before persisted evidence refresh');};
   return g.rewind(start.run.id,product.step.id,'completed product needs revision');
  }),/interrupted before persisted evidence refresh/);
  // Reconstruct the valid persisted intent from a pre-shutdown snapshot. The
  // later lifecycle evidence exists in the Review, but not in this old intent.
  const row=(await service.stores.run.get({},start.run.id))!;
  const value=structuredClone(row.value) as Run;
  for(const worker of value.frames![0].graphFrame.pendingRewind!.workers)delete worker.members;
  await service.stores.run.update({},start.run.id,value,{expectedRevision:row.revision});
  await service.withGraph(g=>g.advance(start.run.id));
 }else if(failOnce){
  await service.withGraph(async g=>{
   // Pause an advance after its entry cleanup check. Rewind then saves its
   // intent and fails cleanup while this old invocation is still in flight.
   const runtime=g as unknown as {materialize:(runId:string)=>Promise<void>};
   const materialize=runtime.materialize.bind(g);
   let reached!:()=>void,release!:()=>void;
   const paused=new Promise<void>(resolve=>{reached=resolve;});
   const resume=new Promise<void>(resolve=>{release=resolve;});
   let first=true;
   runtime.materialize=async id=>{if(first){first=false;reached();await resume;}return materialize(id);};
   const stale=g.advance(start.run.id);
   const staleResult=assert.rejects(stale,{code:'RECOVERY_REQUIRED'});
   try{
    await paused;
    g.stopReviewer=async()=>{throw Error('injected first termination failure');};
    await assert.rejects(g.rewind(start.run.id,product.step.id,'bad product'),/injected first termination failure/);
    release();await staleResult;
    const saved=await g.snapshot(start.run.id);
    const replacement=saved.run.frames![0].graphFrame.rewinds!.at(-1)!.replacementStepId;
    assert.equal(saved.steps.some(s=>s.id===replacement),false,'stale advance cannot materialize replacement');
    await assert.rejects(g.enter(start.run.id,replacement),{code:'RECOVERY_REQUIRED'});
    await assert.rejects(g.report(start.run.id,replacement,{text:'premature product'}),{code:'RECOVERY_REQUIRED'});
    assert.equal((await g.snapshot(start.run.id)).artifacts.length,saved.artifacts.length);
    for(const key of ['workerPid','providerPid','childPid'])assert.equal(await alive(processes[0][key]),true,key);
   }finally{release();runtime.materialize=materialize;await stale.catch(()=>undefined);}
  });
  const pending=await service.snapshot(start.run.id);
  assert.ok(pending.run.frames![0].graphFrame.pendingRewind);
  assert.equal(pending.reviews.find(r=>r.artifactId===old.artifact.id)!.status,submitted?'submitted':'cancelled');
  for(const key of ['workerPid','providerPid','childPid'])assert.equal(await alive(processes[0][key]),true,key);
  await service.withGraph(g=>g.advance(start.run.id));
 }else if(resistant){
  await assert.rejects(service.withGraph(g=>g.rewind(start.run.id,product.step.id,'bad product')),{code:'PROCESS_TERMINATION_PENDING'});
  const saved=await service.snapshot(start.run.id);assert.ok(saved.run.frames![0].graphFrame.pendingRewind);
  assert.equal(saved.reviews.find(r=>r.artifactId===old.artifact.id)!.status,'cancelled');
  process.kill(processes[0].childPid,'SIGUSR1');
  await service.withGraph(g=>g.advance(start.run.id));
 }else await service.withGraph(g=>g.rewind(start.run.id,product.step.id,'bad product'));
 if(nativeDispatch){
  releaseDispatch!();assert.equal(await dispatch,1);
  const markers=await readdir(join(f.root,'.runtime','review-dispatch'));
  assert.equal(markers.some(name=>name.endsWith('.json')),false,'stale dispatcher writes no live marker');
 }
 if(late){
  // The old OS worker exists but has not registered an Attempt/PID when rewind finishes.
  gates.publish(join(f.directory,'release-claim'));
  const [code]=await processes[0].exited;
  assert.notEqual(code,0,'superseded claim is rejected');
  assert.equal(gates.has(`provider-launched:${processes[0].ready}`),false,'no provider launched');
  assert.equal(await alive(processes[0].workerPid),false);
 }else for(const key of ['workerPid','providerPid','childPid'].filter(key=>Number.isInteger(processes[0][key])))assert.equal(await alive(processes[0][key]),false,key);
 for(const key of ['workerPid','providerPid','childPid'])assert.equal(await alive(processes[1][key]),true,key);
 await assert.rejects(reviews.retryArtifactReviewAgentAssignment(common),{code:'STEP_SUPERSEDED'});
 await assert.rejects(reviews.markArtifactReviewAgentCliReady({...common,attemptId:draft.assignment.attempts?.[0]?.id??'stale-attempt'}),{code:'STEP_SUPERSEDED'});
 const snapshot=await service.snapshot(start.run.id);
 if(submitted){
  const saved=snapshot.reviews.find(r=>r.artifactId===old.artifact.id)!;
  assert.equal(saved.status,'submitted');
  assert.deepEqual(saved.vote,submittedReview!.vote,'submitted vote is retained');
  assert.deepEqual(saved.comments,submittedReview!.comments,'submitted comments are retained');
 }
 assert.equal(snapshot.run.frames![0].graphFrame.pendingRewind,undefined);
 assert.equal(snapshot.run.frames![0].graphFrame.rewinds!.length,1);
 assert.equal(snapshot.steps.filter(s=>s.source?.actionId==='A').length,2);
 if(completed){
  const replacement=snapshot.run.frames![0].graphFrame.rewinds!.at(-1)!.replacementStepId;
  await service.withGraph(g=>g.enter(start.run.id,replacement));
  assert.equal((await service.snapshot(start.run.id)).steps.find(step=>step.id===replacement)!.status,'running','normal completed Reviewer does not block the replacement');
 }
 if(orphan){
  // A second actual graph rewind starts only after the independent leader has
  // exited. No descendant snapshot was persisted while that leader was alive.
  process.kill(processes[1].workerPid,'SIGKILL');
  await processes[1].exited;
  assert.equal(await alive(processes[1].childPid),true,'unrecorded child survives before rewind');
  await assert.rejects(service.withGraph(g=>g.rewind(start.run.id,candidates[1].step.id,'leader already gone')),{code:'PROCESS_IDENTITY_UNAVAILABLE'});
  const blocked=await service.snapshot(start.run.id);
  const pending=blocked.run.frames![0].graphFrame.pendingRewind!;
  assert.ok(pending);
  const replacement=blocked.run.frames![0].graphFrame.rewinds!.at(-1)!.replacementStepId;
  await assert.rejects(service.withGraph(g=>g.enter(start.run.id,replacement)),{code:'RECOVERY_REQUIRED'});
  assert.equal(await alive(processes[1].childPid),true,'no unknown descendant was signalled');
  gates.publish(join(f.directory,'release-orphans-1'));
  await until(async()=>await alive(processes[1].childPid)||await alive(processes[1].providerPid)?undefined:true);
  await assert.rejects(service.withGraph(g=>g.advance(start.run.id)),{code:'PROCESS_IDENTITY_UNAVAILABLE'});
  assert.deepEqual((await service.snapshot(start.run.id)).run.frames![0].graphFrame.pendingRewind,pending,'absence of evidence cannot clear the saved intent');
 }

});

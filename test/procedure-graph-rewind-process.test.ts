import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cleanupFixtureResources, createFixtureProcesses, fixtureProcesses, rewindFixtureResources, stopFixtureChild, stopFixtureJob, untilFixture} from './helpers/fixture-process.js';
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
// Hooks have their own deadline; a test timeout does not bound an exit event.
async function boundedCleanup<T>(operation:Promise<T>,description:string):Promise<T>{
 const controller=new AbortController();
 const deadline=delay(10000,undefined,{signal:controller.signal}).then(()=>{throw Error(`Timed out: ${description}`);});
 try{return await Promise.race([operation,deadline]);}finally{controller.abort();}
}
// OS liveness has no portable exit event for non-child descendants. Bound each
// observation loop; success always requires the actual identity probe.
async function until<T>(read:()=>Promise<T|undefined>){const end=Date.now()+60000;while(Date.now()<end){const value=await read();if(value)return value;await delay(25);}throw Error('Timed out waiting for process readiness');}

test('a mismatched OS start identity never signals a live detached process', {skip:process.platform==='win32'}, async t=>{
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
 t.after(()=>stopFixtureChild(child));
 const observed=await createFixtureProcesses(t.signal);
 const alive=async(pid:number)=>(await observed.alive(pid))[0];
 t.after(()=>observed.close());
 await once(child,'spawn');
 await observed.remember(child.pid!);
 const identity=await captureProcessIdentity(child.pid!);
 assert.ok(identity);
 await assert.rejects(stopRewindWorker({pid:child.pid!,identity:{...identity,started:'different kernel start'},reviewId:'review',attemptId:'attempt',members:[identity]}),{code:'PROCESS_IDENTITY_CHANGED'});
 assert.equal(await alive(child.pid!),true);
 await stopRewindWorker({pid:child.pid!,identity,reviewId:'review',attemptId:'attempt',members:[identity]});
 assert.equal(await alive(child.pid!),false);
});

for(const {resistant,late,failOnce,orphan=false,launchGate=undefined,submitted=false,nativeDispatch=false,completed=false,failedBeforeProvider=false,lateDescendant=false} of [{resistant:false,late:false,failOnce:false,submitted:true,completed:true,failedBeforeProvider:true},{resistant:false,late:false,failOnce:false,submitted:true,completed:true,lateDescendant:true},{resistant:false,late:false,failOnce:false,submitted:true,completed:true},{resistant:false,late:false,failOnce:true,nativeDispatch:true},{resistant:false,late:false,failOnce:true,submitted:true},{resistant:false,late:false,failOnce:false},{resistant:true,late:false,failOnce:false},{resistant:false,late:true,failOnce:false},{resistant:false,late:false,failOnce:false,orphan:true},{resistant:false,late:false,failOnce:false,launchGate:"before-provider"},{resistant:false,late:false,failOnce:false,launchGate:"after-provider"}])test(`rewind stops the real ACP worker/provider group${failedBeforeProvider?" after Provider construction failure and successful retry":lateDescendant?" with a descendant born after the saved lifecycle snapshot":completed?" after normal completion and exit":nativeDispatch?" through the native dispatcher":submitted?" after voting but before prompt returns":launchGate?` at ${launchGate}`:resistant?' through persisted cancellation recovery':late?' before late claim':failOnce?' after termination failure':orphan?' after forced Windows worker exit':''} and preserves an unrelated reviewer`,{timeout:240000,skip:((failedBeforeProvider||lateDescendant)&&process.platform!=='win32')||(resistant&&process.platform==='win32')||(orphan&&process.platform!=='win32')},async t=>{
 const resources=await rewindFixtureResources(t);
 const {gates,observed}=resources;
 const cleanups:Array<()=>unknown|Promise<unknown>>=[];
 const beforeCleanup=(cleanup:()=>unknown|Promise<unknown>)=>{cleanups.push(cleanup);};
 let dispatch:Promise<number>|undefined,releaseDispatch:(()=>void)|undefined;
 resources.defer(()=>cleanupFixtureResources([...cleanups,async()=>{releaseDispatch?.();if(dispatch)await boundedCleanup(dispatch,"dispatcher cleanup");}]));
 let failCleanupJob=false;
 const cleanupFailure=Error('injected first owned Job probe failure');
 const jobCleanupAttempts:number[]=[];
 const cleanupJob=async(job:string|undefined,i:number)=>{
  if(failCleanupJob){jobCleanupAttempts.push(i);if(i===0)throw cleanupFailure;}
  if(process.platform==='win32'&&job)await stopFixtureJob(job);
 };
 const alive=async(pid:number)=>(await observed.alive(pid))[0];
 const assertProcesses=async(record:any,keys:string[],expected:boolean)=>{
  const pids=keys.map(key=>record[key]);
  const states=await observed.alive(...pids);
  keys.forEach((key,index)=>assert.equal(states[index],expected,`${key}: ${observed.diagnostic(pids[index])}`));
 };
 const f=await initializedContextFixture(t);
 if(nativeDispatch){const previous=process.env.MEMSPHERE_HOME;process.env.MEMSPHERE_HOME=f.home;beforeCleanup(async()=>{if(previous===undefined)delete process.env.MEMSPHERE_HOME;else process.env.MEMSPHERE_HOME=previous;});}
 const service=(await openContextControl(f.root))!;
 const spec={name:'body',model:{definedBy:'raw.json',definition:'{}'},payload:{contentType:'text/plain'}};
 const actor={kind:'agent' as const,name:'reviewer',permissions:['artifact.read' as const,'decision.assess' as const],agent:{provider:'test',providerType:'traex' as const,command:process.execPath,args:[fileURLToPath(new URL('./fixtures/fake-acp-reviewer.mjs',import.meta.url)),'rewind-gated'],env:{REVIEW_TEST_GATES:String(gates.endpoint),REVIEW_TEST_SETUP_API:"yes",REVIEW_TEST_READY_PREFIX:f.directory},startupTimeoutMs:10000,idleTimeoutMs:null}};
 const p:GraphProcedureMemory={tag:'!procedure',syntax:'memsphere-20261027-stable',mode:'graph',names:['process-rewind'],defines:['process test'],actions:[{tag:'!action',id:'A',description:'product',dependencies:[{tag:'!dependency',from:'START'}],artifact:spec},{tag:'!action',id:'T',description:'technical',dependencies:[{tag:'!dependency',from:'A'}],artifact:{...spec,review:['check']}},{tag:'!action',id:'independent',description:'independent',dependencies:[{tag:'!dependency',from:'START'}],artifact:{...spec,review:['check']}}]};
 const start=await service.withGraph(g=>g.start({name:'cancel groups',procedure:p,controlPlane:{runner:{permissions:['artifact.read','artifact.submit','decision.decide']},actors:{reviewer:actor}},reviewConfiguration:{reviews:{'process-rewind#actions[T]':{policy:'artifact_acceptance.unanimous'},'process-rewind#actions[independent]':{policy:'artifact_acceptance.unanimous'}},slots:{'process-rewind::check':{actorIds:['reviewer']}}}}));
 const product=await service.withGraph(async g=>{const a=start.steps.find(s=>s.source?.actionId==='A')!;await g.enter(start.run.id,a.id);return g.report(start.run.id,a.id,{text:'A1'});});
 const candidates=[];
 for(const name of ['T','independent'])candidates.push(await service.withGraph(async g=>{const s=product.snapshot.steps.find(s=>s.source?.actionId===name)!;await g.enter(start.run.id,s.id);return g.report(start.run.id,s.id,{text:name});}));
 const processes=[];
 let verifiedCleanup=false;
 let failedAttempt:any, failureConsumed=false;
 const launch=async(i:number)=>{
  if(nativeDispatch&&i===0){
   const candidate=candidates[0],config=await readConfig(join(f.root,'config.json'));
   const ready=join(f.directory,reviews.graphReviewHandle(start.run.id,candidate.step.id));
   const previousControl={endpoint:process.env.REWIND_DISPATCH_GATES,ready:process.env.REWIND_DISPATCH_CONTROL};
   process.env.REWIND_DISPATCH_GATES=String(gates.endpoint);process.env.REWIND_DISPATCH_CONTROL=ready;
   beforeCleanup(()=>{
    for(const [key,value] of [['REWIND_DISPATCH_GATES',previousControl.endpoint],['REWIND_DISPATCH_CONTROL',previousControl.ready]])
     if(value===undefined)delete process.env[key!];else process.env[key!]=value;
   });
   const control=`control:${ready}`;
   const tracked=gates.wait(control).then(async({pid})=>{await observed.remember(pid);gates.publish(`start:${ready}`);return pid;});
   tracked.catch(()=>undefined);
   const cleanupNative=async()=>{
    releaseDispatch?.();
    const pid=await boundedCleanup(tracked,'native dispatcher control readiness');
    gates.publish(`stop:${ready}`);
    gates.publish(`release-provider:${ready}`);
    gates.publish(`cleanup-child:${ready}`);
    const current=await reviews.readArtifactReviewForActor({runsRoot:config.runsRoot,reviewId:reviews.graphReviewHandle(start.run.id,candidate.step.id),roundId:candidate.step.reviewRounds![0].id,actorId:'reviewer'});
    const job=current.assignment.attempts?.find(a=>a.workerPid===pid&&a.workerIdentity?.started===observed.original(pid)?.started)?.workerJob;
    if(process.platform==='win32'&&job&&!processes[0]?.retired)await stopFixtureJob(job);
    await untilFixture(async()=>!(await alive(pid)),'native dispatcher original worker exit');
   };
   beforeCleanup(cleanupNative);
   let reads=0,reached!:()=>void;
   const paused=new Promise<void>(resolve=>{reached=resolve;});
   const release=new Promise<void>(resolve=>{releaseDispatch=resolve;});
   dispatch=dispatchArtifactReviewAgents({config:{...config,debug:{...config.debug,agentReview:false}},run:await reviews.readRun(config.runsRoot,start.run.id),workspaceRoot:f.cwd,runtime:{nodeExecutable:process.execPath,cliEntrypoint:fileURLToPath(new URL('./fixtures/dispatcher-review-worker.mjs',import.meta.url))}}, {readRun:async(...args)=>{
    if(++reads===3){await boundedCleanup(tracked,"native control readiness");await gates.wait(ready);reached();await release;}
    return reviews.readRun(...args);
   }});
   await Promise.race([paused,dispatch.then(()=>{throw Error('dispatcher exited before the post-spawn boundary');})]);
   const info=await gates.wait(ready);
   const draft=await reviews.readArtifactReviewForActor({runsRoot:config.runsRoot,reviewId:reviews.graphReviewHandle(start.run.id,candidate.step.id),roundId:candidate.step.reviewRounds![0].id,actorId:'reviewer'});
   const workerPid=draft.assignment.attempts!.at(-1)!.workerPid!;
   await observed.remember(...[info.providerPid,info.childPid].filter(Number.isInteger));
   assert.equal(workerPid,await tracked);
   processes[0]={workerPid,ready,...info,cleanup:cleanupNative};
   return;
  }
  const failProviderBuild=Boolean(failedBeforeProvider&&i===0&&!failureConsumed);
  const candidate=candidates[i],ready=join(f.directory,`ready-${i}.json`),input=join(f.directory,`worker-${i}.json`);
  await writeFile(input,JSON.stringify({config:join(f.root,'config.json'),review:reviews.graphReviewHandle(start.run.id,candidate.step.id),round:candidate.step.reviewRounds![0].id,assignment:'reviewer',cliEntrypoint:fileURLToPath(new URL('../dist/cli.js',import.meta.url)),workspaceRoot:f.cwd,ready,gates:gates.endpoint,setupApi:!(completed&&!lateDescendant&&!failedBeforeProvider&&i===0),...(failProviderBuild?{failProviderBuild}:{}),...(lateDescendant&&i===0?{lateDescendant}:{}),...(completed&&i===0?{completed:true}:{}),...(submitted&&i===0?{submitted:true}:{}),...(launchGate&&i===0?{launchGate}:{}),...(orphan?{release:join(f.directory,`release-orphans-${i}`)}:{}) ,...(late&&i===0?{claimGate:join(f.directory,'release-claim')}:{})}));
  const worker=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/graph-review-worker.mjs',import.meta.url)),input],{detached:true,stdio:['ignore','ignore','pipe'],env:{...process.env,MEMSPHERE_HOME:f.home,...(resistant&&i===0?{REVIEW_TEST_RESISTANT:'yes'}:{})}});
  let ownedJob:string|undefined;
  let errors='';worker.stderr!.on('data',s=>errors+=s);
  beforeCleanup(async()=>{
   const wasAlive=worker.exitCode===null&&worker.signalCode===null;
   await cleanupFixtureResources([()=>{
   gates.publish(join(f.directory,`release-orphans-${i}`));
   gates.publish(join(f.directory,'release-claim'));
   gates.publish(`finish-review:${ready}`);
   gates.publish(`release-launch:${ready}`);
   gates.publish(`release-provider:${ready}`);
   gates.publish(`cleanup-child:${ready}`);
   if(lateDescendant){gates.publish(`release-late:${ready}`);gates.publish(`snapshot-continue:${ready}`);gates.publish(`spawn-late:${ready}`);}
   },()=>stopFixtureChild(worker),async()=>{
   const current=await reviews.readArtifactReviewForActor({runsRoot:join(f.root,'runs'),reviewId:reviews.graphReviewHandle(start.run.id,candidate.step.id),roundId:candidate.step.reviewRounds![0].id,actorId:'reviewer'});
   const attempt=current.assignment.attempts?.find(a=>a.workerPid===worker.pid&&observed.original(worker.pid!)?.started===a.workerIdentity?.started);
   const job=ownedJob??attempt?.workerJob;
   if(wasAlive||!verifiedCleanup)await cleanupJob(job,i);
   }]);
  });
  if(failProviderBuild){
   const [code]=await once(worker,'exit');
   assert.equal(code,0,errors);
   const common={runsRoot:join(f.root,'runs'),reviewId:reviews.graphReviewHandle(start.run.id,candidate.step.id),roundId:candidate.step.reviewRounds![0].id,actorId:'reviewer'};
   const failed=await reviews.readArtifactReviewForActor(common);
   failedAttempt=(await service.snapshot(start.run.id)).reviews.find(r=>r.artifactId===candidate.artifact.id)!.attempts!.at(-1)!;
   ownedJob=failedAttempt.workerJob;
   assert.equal(failedAttempt.completion.kind,'failed');
   assert.ok(failedAttempt.workerJob,failedAttempt.completion.failure?.message??'enrollment proof was saved with claim before Provider preparation');
   assert.equal(failed.assignment.attempts!.length,1);
   assert.equal(gates.has(`provider-launched:${ready}`),false);
   await reviews.retryArtifactReviewAgentAssignment(common);
   failureConsumed=true;
   return launch(i);
  }
  const lifetime=new AbortController();
  worker.once('exit',()=>lifetime.abort(new Error(errors||'Fixture worker exited before readiness')));
  const info=await Promise.race([gates.wait(ready),new Promise((_,reject)=>lifetime.signal.addEventListener('abort',()=>reject(lifetime.signal.reason),{once:true}))]);
  const own=await reviews.readArtifactReviewForActor({runsRoot:join(f.root,'runs'),reviewId:reviews.graphReviewHandle(start.run.id,candidate.step.id),roundId:candidate.step.reviewRounds![0].id,actorId:'reviewer'});
  const ownAttempt=own.assignment.attempts?.at(-1);
  if(ownAttempt?.workerPid===worker.pid)ownedJob=ownAttempt.workerJob;
  processes[i]={workerPid:worker.pid!,worker,exited:once(worker,'exit'),errors:()=>errors,ready,...info};
 };
 // The native dispatcher needs the unrelated assignment already claimed.
 // The teardown fault case must register owner 0 before owner 1: it injects
 // failure into owner 0 and verifies that cleanup then reaches owner 1.
 // Parallel file writes otherwise make cleanup registration order arbitrary.
 // Other cases keep both independent Review records starting concurrently.
 if(nativeDispatch){await launch(1);await launch(0);}
 else if(failOnce&&submitted){await launch(0);await launch(1);}
 else {
  const results=await Promise.allSettled([0,1].map(launch));
  for(const result of results)if(result.status==='rejected')throw result.reason;
 }
 // Both ready barriers are still held: capture all roles in one fresh CIM query.
 await observed.remember(...new Set(processes.flatMap(p=>[p.workerPid,p.providerPid,p.childPid]).filter(Number.isInteger)));
 const old=candidates[0],common={runsRoot:join(f.root,'runs'),reviewId:reviews.graphReviewHandle(start.run.id,old.step.id),roundId:old.step.reviewRounds![0].id,actorId:'reviewer'};
 const draft=await reviews.readArtifactReviewForActor(common);
 if(!late&&!launchGate)assert.ok(draft.assignment.attempts!.at(-1)!.cliReadyAt);
 const submittedReview = submitted ? (await service.snapshot(start.run.id)).reviews.find(r=>r.artifactId===old.artifact.id)! : undefined;
 if(submitted){assert.equal(draft.assignment.status,'submitted');assert.ok(submittedReview!.attempts!.at(-1)!.completion);}
 if(completed){
  gates.publish(`finish-review:${processes[0].ready}`);
  if(lateDescendant){
   await gates.wait(`snapshot-ready:${processes[0].ready}`);
   gates.publish(`spawn-late:${processes[0].ready}`);
   const late=await gates.wait(`late-descendant:${processes[0].ready}`);
   await observed.remember(late.latePid);
   processes[0].latePid=late.latePid;
   await until(async()=>await alive(processes[0].childPid)?undefined:true);
   const attempt=(await service.snapshot(start.run.id)).reviews.find(r=>r.artifactId===old.artifact.id)!.attempts!.at(-1)!;
   assert.equal(attempt.workerMembers?.some(member=>member.pid===late.latePid),false,'late descendant is absent from the saved snapshot');
   gates.publish(`snapshot-continue:${processes[0].ready}`);
  }
  const [code]=await processes[0].exited;
  assert.equal(code,0,`Reviewer completes the actual ACP session normally: ${processes[0].errors?.()??''}`);
  await until(async()=>await alive(processes[0].providerPid)||await alive(processes[0].childPid)?undefined:true);
  const attempt=(await service.snapshot(start.run.id)).reviews.find(r=>r.artifactId===old.artifact.id)!.attempts!.at(-1)!;
  assert.ok(attempt.workerMembers?.some(member=>member.pid===processes[0].childPid),'descendant identity persisted before Provider stop');
 }
 if(lateDescendant||orphan){
  // Real ACP startup creates libuv Jobs before the tracked Job. Those outer
  // kill-on-close Jobs may reap descendants as the Worker/Provider exits.
  // Do not confuse that valid OS cleanup with a missing rewind rejection.
  // The native fixture separately guarantees live orphan/late-descendant
  // preconditions and strictly asserts PROCESS_TERMINATION_PENDING.
  let pending=false;
  try {
   await service.withGraph(g=>{
    if(orphan)g.stopReviewer=async worker=>{
     await stopFixtureChild(processes[0].worker);
     await until(async()=>await alive(worker.pid)?undefined:true);
     await stopRewindWorker(worker);
    };
    return g.rewind(start.run.id,product.step.id,'old reviewer lifecycle must finish');
   });
  } catch(error) {
   assert.equal((error as {code?:string}).code,'PROCESS_TERMINATION_PENDING');pending=true;
  }
  if(pending){
   const saved=await service.snapshot(start.run.id),replacement=saved.run.frames![0].graphFrame.rewinds!.at(-1)!.replacementStepId;
   assert.ok(saved.run.frames![0].graphFrame.pendingRewind);
   await assert.rejects(service.withGraph(g=>g.enter(start.run.id,replacement)),{code:'RECOVERY_REQUIRED'});
   await assert.rejects(service.withGraph(g=>g.report(start.run.id,replacement,{text:'premature'})),{code:'RECOVERY_REQUIRED'});
   if(lateDescendant)gates.publish(`release-late:${processes[0].ready}`);
   else gates.publish(join(f.directory,'release-orphans-0'));
   await until(async()=>await alive(lateDescendant?processes[0].latePid:processes[0].childPid)||await alive(processes[0].providerPid)?undefined:true);
   await service.withGraph(g=>g.advance(start.run.id));
  }
  // Success is safe only after the actual known descendants are gone, even
  // when the native Job disappeared before the Runner inspected it.
  await assertProcesses(processes[0],['workerPid','providerPid','childPid',...(lateDescendant?['latePid']:[])],false);
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
    await assertProcesses(processes[0],['workerPid','providerPid','childPid'],true);
   }finally{release();runtime.materialize=materialize;await stale.catch(()=>undefined);}
  });
  const pending=await service.snapshot(start.run.id);
  assert.ok(pending.run.frames![0].graphFrame.pendingRewind);
  assert.equal(pending.reviews.find(r=>r.artifactId===old.artifact.id)!.status,submitted?'submitted':'cancelled');
  await assertProcesses(processes[0],['workerPid','providerPid','childPid'],true);
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
 }else await assertProcesses(processes[0],['workerPid','providerPid','childPid'].filter(key=>Number.isInteger(processes[0][key])),false);
 if(nativeDispatch){processes[0].retired=true;await processes[0].cleanup();}
 await assertProcesses(processes[1],['workerPid','providerPid','childPid'],true);
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
 {
  const replacement=snapshot.run.frames![0].graphFrame.rewinds!.at(-1)!.replacementStepId;
  await service.withGraph(g=>g.enter(start.run.id,replacement));
  assert.equal((await service.snapshot(start.run.id)).steps.find(step=>step.id===replacement)!.status,'running','recovered Reviewer cleanup permits replacement');
  const produced=await service.withGraph(g=>g.report(start.run.id,replacement,{text:'replacement product'}));
  assert.equal(produced.artifact.stepId,replacement,'replacement can produce after cleanup');
 }
 if(failedAttempt)assert.deepEqual(snapshot.reviews.find(r=>r.artifactId===old.artifact.id)!.attempts![0],failedAttempt,'failed historical Attempt remains byte-equivalent');
 if(orphan){
  // A second actual graph rewind starts only after the independent leader has
  // exited. No descendant snapshot was persisted while that leader was alive.
  await stopFixtureChild(processes[1].worker);
  await processes[1].exited;
  // Absence of recorded Job evidence must fail closed even if libuv has
  // already reaped the descendants; dead old PIDs are not a complete proof.
  const review=snapshot.reviews.find(r=>r.artifactId===candidates[1].artifact.id)!;
  const historical=(await service.stores.review.get({},`${start.run.id}/${review.id}`))!;
  const oldEvidence=structuredClone(historical.value) as typeof review;
  delete oldEvidence.attempts!.at(-1)!.workerJob;
  await service.stores.review.update({},`${start.run.id}/${review.id}`,oldEvidence,{expectedRevision:historical.revision});
  await assert.rejects(service.withGraph(g=>g.rewind(start.run.id,candidates[1].step.id,'leader already gone')),{code:'PROCESS_IDENTITY_UNAVAILABLE'});
  const blocked=await service.snapshot(start.run.id);
  const pending=blocked.run.frames![0].graphFrame.pendingRewind!;
  assert.ok(pending);
  const replacement=blocked.run.frames![0].graphFrame.rewinds!.at(-1)!.replacementStepId;
  await assert.rejects(service.withGraph(g=>g.enter(start.run.id,replacement)),{code:'RECOVERY_REQUIRED'});
  gates.publish(join(f.directory,'release-orphans-1'));
  await until(async()=>await alive(processes[1].childPid)||await alive(processes[1].providerPid)?undefined:true);
  await assert.rejects(service.withGraph(g=>g.advance(start.run.id)),{code:'PROCESS_IDENTITY_UNAVAILABLE'});
  assert.deepEqual((await service.snapshot(start.run.id)).run.frames![0].graphFrame.pendingRewind,pending,'absence of evidence cannot clear the saved intent');
 }
 verifiedCleanup=true;
 if(failOnce&&submitted&&!completed)await t.test('ACP teardown still cleans the second original execution after the first Job probe rejects',async()=>{
  // Exercise the actual registered ACP cleanup chain, not just the aggregator.
  // The related execution is retired; its Job probe fails before cleanup of the
  // still-live unrelated execution, whose original worker/provider/child must exit.
  const pids=[...new Set(processes.flatMap(p=>[p.workerPid,p.providerPid,p.childPid]).filter(Number.isInteger))];
  const verification=fixtureProcesses();
  verification.rememberSnapshot(...pids.map(pid=>observed.original(pid)!));
  failCleanupJob=true;verifiedCleanup=false;
  const includesOriginal=(error:unknown):boolean=>error===cleanupFailure||error instanceof AggregateError&&error.errors.some(includesOriginal);
  await assert.rejects(resources.close(),includesOriginal);
  assert.deepEqual(jobCleanupAttempts,[0,1],'the second owned Job is attempted after the first fails');
  await untilFixture(async()=>!(await verification.alive(...pids)).some(Boolean),'all original ACP executions exit after a cleanup probe failure');
 });

});

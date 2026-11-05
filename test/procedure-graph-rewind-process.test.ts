import {processGates} from './fixtures/process-gates.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {terminateProcessTree} from '../src/platform-process.js';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {initializedContextFixture} from './helpers/initialized-context.js';
import {openContextControl} from '../src/project/context-control.js';
import {captureProcessIdentity,stopRewindWorker} from '../src/context_control/review-process.js';
import * as reviews from '../src/context_control/review-repository.js';
import type {GraphProcedureMemory} from '../src/memory/ast.js';
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

for(const {resistant,late,failOnce,orphan=false} of [{resistant:false,late:false,failOnce:false},{resistant:true,late:false,failOnce:false},{resistant:false,late:true,failOnce:false},{resistant:false,late:false,failOnce:true},{resistant:false,late:false,failOnce:false,orphan:true}])test(`rewind stops the real ACP worker/provider group${resistant?' through persisted cancellation recovery':late?' before late claim':failOnce?' after termination failure':orphan?' with orphaned Windows descendants':''} and preserves an unrelated reviewer`,{timeout:240000,skip:(resistant&&process.platform==='win32')||(orphan&&process.platform!=='win32')},async t=>{
 const gates=await processGates(t.signal);
 const f=await initializedContextFixture(t);
 t.after(()=>gates.close());
 const service=(await openContextControl(f.root))!;
 const spec={name:'body',model:{definedBy:'raw.json',definition:'{}'},payload:{contentType:'text/plain'}};
 const actor={kind:'agent' as const,name:'reviewer',permissions:['artifact.read' as const,'decision.assess' as const],agent:{provider:'test',providerType:'traex' as const,command:process.execPath,args:[fileURLToPath(new URL('./fixtures/fake-acp-reviewer.mjs',import.meta.url)),'rewind-gated'],env:{},startupTimeoutMs:10000,idleTimeoutMs:null}};
 const p:GraphProcedureMemory={tag:'!procedure',syntax:'memsphere-20261027-stable',mode:'graph',names:['process-rewind'],defines:['process test'],actions:[{tag:'!action',id:'A',description:'product',dependencies:[{tag:'!dependency',from:'START'}],artifact:spec},{tag:'!action',id:'T',description:'technical',dependencies:[{tag:'!dependency',from:'A'}],artifact:{...spec,review:['check']}},{tag:'!action',id:'independent',description:'independent',dependencies:[{tag:'!dependency',from:'START'}],artifact:{...spec,review:['check']}}]};
 const start=await service.withGraph(g=>g.start({name:'cancel groups',procedure:p,controlPlane:{runner:{permissions:['artifact.read','artifact.submit','decision.decide']},actors:{reviewer:actor}},reviewConfiguration:{reviews:{'process-rewind#actions[T]':{policy:'artifact_acceptance.unanimous'},'process-rewind#actions[independent]':{policy:'artifact_acceptance.unanimous'}},slots:{'process-rewind::check':{actorIds:['reviewer']}}}}));
 const product=await service.withGraph(async g=>{const a=start.steps.find(s=>s.source?.actionId==='A')!;await g.enter(start.run.id,a.id);return g.report(start.run.id,a.id,{text:'A1'});});
 const candidates=[];
 for(const name of ['T','independent'])candidates.push(await service.withGraph(async g=>{const s=product.snapshot.steps.find(s=>s.source?.actionId===name)!;await g.enter(start.run.id,s.id);return g.report(start.run.id,s.id,{text:name});}));
 const processes=[];
 for(let i=0;i<2;i++){
  const candidate=candidates[i],ready=join(f.directory,`ready-${i}.json`),input=join(f.directory,`worker-${i}.json`);
  await writeFile(input,JSON.stringify({config:join(f.root,'config.json'),review:reviews.graphReviewHandle(start.run.id,candidate.step.id),round:candidate.step.reviewRounds![0].id,assignment:'reviewer',cliEntrypoint:fileURLToPath(new URL('../dist/cli.js',import.meta.url)),workspaceRoot:f.cwd,ready,gates:gates.endpoint,...(orphan&&i===0?{release:join(f.directory,'release-orphans')}:{}) ,...(late&&i===0?{claimGate:join(f.directory,'release-claim')}:{})}));
  const worker=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/graph-review-worker.mjs',import.meta.url)),input],{detached:true,stdio:['ignore','ignore','pipe'],env:{...process.env,MEMSPHERE_HOME:f.home,...(resistant&&i===0?{REVIEW_TEST_RESISTANT:'yes'}:{})}});
  let errors='';worker.stderr!.on('data',s=>errors+=s);
  f.beforeCleanup(async()=>{
   if(orphan)gates.publish(join(f.directory,'release-orphans'));
   await terminateProcessTree(worker.pid!,'SIGKILL',process.platform,true).catch(()=>undefined);
   if(worker.exitCode===null&&worker.signalCode===null)await once(worker,'exit');
  });
  const lifetime=new AbortController();
  worker.once('exit',()=>lifetime.abort(new Error(errors||'Fixture worker exited before readiness')));
  const info=await Promise.race([gates.wait(ready),new Promise((_,reject)=>lifetime.signal.addEventListener('abort',()=>reject(lifetime.signal.reason),{once:true}))]);
  processes.push({workerPid:worker.pid!,worker,exited:once(worker,'exit'),ready,...info});
 }
 const old=candidates[0],common={runsRoot:join(f.root,'runs'),reviewId:reviews.graphReviewHandle(start.run.id,old.step.id),roundId:old.step.reviewRounds![0].id,actorId:'reviewer'};
 const draft=await reviews.readArtifactReviewForActor(common);
 if(!late)assert.ok(draft.assignment.attempts![0].cliReadyAt);
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
  gates.publish(join(f.directory,'release-orphans'));
  await until(async()=>await alive(processes[0].childPid)||await alive(processes[0].providerPid)?undefined:true);
  await service.withGraph(g=>g.advance(start.run.id));
 }else if(failOnce){
  await assert.rejects(service.withGraph(g=>{
   g.stopReviewer=async()=>{throw Error('injected first termination failure');};
   return g.rewind(start.run.id,product.step.id,'bad product');
  }),/injected first termination failure/);
  const pending=await service.snapshot(start.run.id);
  assert.ok(pending.run.frames![0].graphFrame.pendingRewind);
  assert.equal(pending.reviews.find(r=>r.artifactId===old.artifact.id)!.status,'cancelled');
  for(const key of ['workerPid','providerPid','childPid'])assert.equal(await alive(processes[0][key]),true,key);
  await service.withGraph(g=>g.advance(start.run.id));
 }else if(resistant){
  await assert.rejects(service.withGraph(g=>g.rewind(start.run.id,product.step.id,'bad product')),{code:'PROCESS_TERMINATION_PENDING'});
  const saved=await service.snapshot(start.run.id);assert.ok(saved.run.frames![0].graphFrame.pendingRewind);
  assert.equal(saved.reviews.find(r=>r.artifactId===old.artifact.id)!.status,'cancelled');
  process.kill(processes[0].childPid,'SIGUSR1');
  await service.withGraph(g=>g.advance(start.run.id));
 }else await service.withGraph(g=>g.rewind(start.run.id,product.step.id,'bad product'));
 if(late){
  // The old OS worker exists but has not registered an Attempt/PID when rewind finishes.
  gates.publish(join(f.directory,'release-claim'));
  const [code]=await processes[0].exited;
  assert.notEqual(code,0,'superseded claim is rejected');
  assert.equal(gates.has(`provider-launched:${processes[0].ready}`),false,'no provider launched');
  assert.equal(await alive(processes[0].workerPid),false);
 }else for(const key of ['workerPid','providerPid','childPid'])assert.equal(await alive(processes[0][key]),false,key);
 for(const key of ['workerPid','providerPid','childPid'])assert.equal(await alive(processes[1][key]),true,key);
 await assert.rejects(reviews.retryArtifactReviewAgentAssignment(common),{code:'STEP_SUPERSEDED'});
 await assert.rejects(reviews.markArtifactReviewAgentCliReady({...common,attemptId:draft.assignment.attempts?.[0]?.id??'stale-attempt'}),{code:'STEP_SUPERSEDED'});
 const snapshot=await service.snapshot(start.run.id);
 assert.equal(snapshot.run.frames![0].graphFrame.pendingRewind,undefined);
 assert.equal(snapshot.run.frames![0].graphFrame.rewinds!.length,1);
 assert.equal(snapshot.steps.filter(s=>s.source?.actionId==='A').length,2);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import crossSpawn from 'cross-spawn';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializedContextFixture } from './helpers/initialized-context.js';
import { openContextControl } from '../src/project/context-control.js';
import { createAgentReviewCliRuntime } from '../src/acp/cli-runtime.js';
import { graphMemorySyntax } from '../src/memory/syntax.js';
import type { GraphAction, GraphProcedureMemory } from '../src/memory/ast.js';
import * as reviews from '../src/context_control/review-repository.js';
import { currentReviewNode } from '../src/review-nodes.js';
const entrypoint=fileURLToPath(new URL('../dist/cli.js',import.meta.url));
const action=(id:string,from='START',review=false):GraphAction=>({tag:'!action',id,description:id,dependencies:[{tag:'!dependency',from}],artifact:{name:id,model:{definedBy:'raw.json',definition:'{}'},payload:{contentType:'text/plain'},...(review?{review:['check']}:{} )}});

async function fixture(t:test.TestContext,actions:GraphAction[]) {
 const f=await initializedContextFixture(t),service=(await openContextControl(f.root))!;
 const procedure:GraphProcedureMemory={tag:'!procedure',syntax:graphMemorySyntax,mode:'graph',names:['cli-evidence'],defines:['Evidence'],actions};
 const start=await service.withGraph(g=>g.start({name:'CLI evidence',procedure,controlPlane:{runner:{permissions:['artifact.read','artifact.submit','decision.decide']},actors:{reader:{kind:'agent',name:'Reader',permissions:['artifact.read','decision.assess'],agent:{provider:'test',providerType:'traex',command:process.execPath,args:[],env:{},startupTimeoutMs:10000,idleTimeoutMs:null,maxRuntimeMs:null}}},acpProviders:{}},reviewConfiguration:{reviews:Object.fromEntries(actions.filter(a=>a.artifact?.review).map(a=>[`cli-evidence#actions[${a.id}]`,{policy:'artifact_acceptance.unanimous'}])),slots:{'cli-evidence::check':{actorIds:['reader']}}}}));
 const runId=start.run.id,env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('MEMSPHERE_')));
 Object.assign(env,{MEMSPHERE_HOME:f.home,MEMSPHERE_CONFIG_PATH:join(f.root,'config.json')});
 const runtime=await createAgentReviewCliRuntime({nodeExecutable:process.execPath,cliEntrypoint:entrypoint});t.after(()=>runtime.cleanup());
 function runner(args:string[],ok=true){const r=crossSpawn.sync(process.execPath,[entrypoint,'--project','test-project',...args],{cwd:f.cwd,env,encoding:'utf8',timeout:20000,maxBuffer:2000000});assert.ifError(r.error);if(ok)assert.equal(r.status,0,r.stderr);else {assert.notEqual(r.status,0);assert.equal(r.stdout,'');}return r;}
 const active=async(id:string)=>(await service.snapshot(runId)).steps.find(s=>s.source?.actionId===id&&['pending','running'].includes(s.status))!;
 async function produce(id:string,text:string,extra:string[]=[],stepId?:string){const step=stepId??(await active(id)).id;runner(['run','step','enter','--run',runId,'--step',step]);const out=runner(['run','report','--run',runId,'--step',step,'--artifact',text,...extra,'--output','json']);return {...JSON.parse(out.stdout),stepId:step};}
 async function claim(stepId:string){const snapshot=await service.snapshot(runId),step=snapshot.steps.find(s=>s.id===stepId)!;const input={service,runsRoot:join(f.root,'runs'),reviewId:reviews.graphReviewHandle(runId,stepId),roundId:step.reviewRounds!.at(-1)!.id,actorId:'reader'};const claimed=(await reviews.claimArtifactReviewAgentAssignment(input))!;
  const bound={...input,attemptId:claimed.attempt.id},session={...env,MEMSPHERE_REVIEW_RUN_ID:runId,MEMSPHERE_REVIEW_MEMORY_RUN_ID:runId,MEMSPHERE_REVIEW_HANDLE:input.reviewId,MEMSPHERE_REVIEW_ASSIGNMENT_ID:claimed.assignment.id!,MEMSPHERE_REVIEW_ATTEMPT_ID:claimed.attempt.id,MEMSPHERE_WORKSPACE_ROOT:f.cwd,MEMSPHERE_REVIEW_SOURCE_WORKSPACE:f.cwd};
  const read=(kind:'artifact'|'external',id:string,out:string,ok=true)=>{const r=crossSpawn.sync(runtime.launcherPath,['run',kind,'show','--run',runId,`--${kind}`,id,'--out',out,'--output','json'],{cwd:f.cwd,env:session,encoding:'utf8',timeout:20000});assert.ifError(r.error);if(ok)assert.equal(r.status,0,r.stderr);else{assert.notEqual(r.status,0);assert.equal(r.stdout,'');assert.match(r.stderr,/REVIEW_RESOURCE_DENIED|REVIEW_SESSION_INVALID/);}return r;};
  async function decide(vote:'approve'|'request_changes'){await reviews.markArtifactReviewAgentCliReady(bound);let c=await reviews.readArtifactReviewForActor(input);while(currentReviewNode(c.assignment))c=await reviews.mutateArtifactReviewNodes({...bound,mutation:{operation:'report',expectedNodeId:currentReviewNode(c.assignment)!.nodeId,artifact:{applicable:true}}});await reviews.submitArtifactReviewAgentAssignment({...bound,vote:'approve'});await reviews.submitArtifactReviewRunnerVote({...input,vote,comment:vote==='request_changes'?'Revise fixed evidence':undefined});}
  return {input,read,decide};
 }
 return {...f,service,runId,runner,active,produce,claim};
}

test('production CLI dependency omission, clear and replace preserve mandatory inputs and historical Session references',async t=>{
 const f=await fixture(t,[action('R'),action('P','R'),action('C','P',true),action('U')]);
 const r=await f.produce('R','requirements'),p=await f.produce('P','plan'),u=await f.produce('U','unrelated');
 const e1=JSON.parse(f.runner(['run','external','add','--run',f.runId,'--source','E1','--content','external v1','--output','json']).stdout).externalId;
 const e2=JSON.parse(f.runner(['run','external','add','--run',f.runId,'--source','E2','--content','external v2','--output','json']).stdout).externalId;
 const first=await f.produce('C','candidate one',['--depends-on',`artifact:${r.artifactId}`,'--depends-on',`external:${e1}`]),old=await f.claim(first.stepId);
 old.read('artifact',r.artifactId,'r1.txt');old.read('artifact',u.artifactId,'deny-u.txt',false);await old.decide('request_changes');
 const second=await f.produce('C','candidate two',['--revision-summary','inherit']);assert.deepEqual(second.dependencies,first.dependencies);await(await f.claim(second.stepId)).decide('request_changes');
 const file=join(f.cwd,'clear.json');await writeFile(file,JSON.stringify({content:{model:{definedBy:'raw.json',definition:'{}'},payload:{contentType:'text/plain',content:'candidate three'}},dependencies:[]}));
 const cleared=JSON.parse(f.runner(['run','report','--run',f.runId,'--step',first.stepId,'--file',file,'--revision-summary','clear','--output','json']).stdout);assert.deepEqual(cleared.dependencies,[{kind:'artifact',id:p.artifactId}]);const clear=await f.claim(first.stepId);clear.read('artifact',p.artifactId,'p.txt');clear.read('artifact',r.artifactId,'deny-r.txt',false);clear.read('external',e1,'deny-e1.txt',false);await clear.decide('request_changes');
 const fourth=await f.produce('C','candidate four',['--revision-summary','replace','--depends-on',`external:${e2}`]);assert.deepEqual(fourth.dependencies,[{kind:'artifact',id:p.artifactId},{kind:'external',id:e2}]);const current=await f.claim(first.stepId);current.read('external',e2,'e2.txt');current.read('external',e1,'deny-old.txt',false);
 old.read('external',e1,'historical-e1.txt');old.read('external',e2,'deny-new.txt',false);assert.equal(await readFile(join(f.cwd,'historical-e1.txt'),'utf8'),'external v1');
});

for(const nonempty of [false,true])test(`production CLI accepts ${nonempty?'nonempty':'empty'} collect control provenance and restricts its Reviewer`,async t=>{
 const b=action('B','X');b.dependencies[0].when=String(nonempty);
 const f=await fixture(t,[action('X'),b,action('stop'),{tag:'!action',id:'gather',description:'Gather',dependencies:[{tag:'!dependency',from:'stop'}],collect:['B']},action('summary','gather',true),action('U')]);
 const x=await f.produce('X','control source'),u=await f.produce('U','unrelated');if(nonempty)await f.produce('B','member');const stop=await f.produce('stop','stop');
 const step=(await f.active('summary')).id;
 f.runner(['run','report','--run',f.runId,'--step',step,'--artifact','bad','--depends-on',`artifact:${u.artifactId}`,'--output','json'],false);
 const file=join(f.cwd,'summary.json');await writeFile(file,JSON.stringify({content:{model:{definedBy:'raw.json',definition:'{}'},payload:{contentType:'text/plain',content:'summary'}},dependencies:[{kind:'artifact',id:x.artifactId},{kind:'artifact',id:stop.artifactId}]}));
 f.runner(['run','step','enter','--run',f.runId,'--step',step]);const report=JSON.parse(f.runner(['run','report','--run',f.runId,'--step',step,'--file',file,'--output','json']).stdout);assert.ok(report.dependencies.some((d:any)=>d.id===x.artifactId));
 const reviewer=await f.claim(step);reviewer.read('artifact',x.artifactId,'control.txt');reviewer.read('artifact',u.artifactId,'unrelated.txt',false);
});

test('real production CLI loops and rewinds pin each acceptance Session to the correct requirement version',async t=>{
 const requirements=action('requirements');requirements.dependencies.push({tag:'!dependency',from:'again',when:'artifacts.again = true'});
 const again=action('again','acceptance');again.artifact!.payload.contentType='application/json';again.artifact!.model={definedBy:'json-schema/draft-07.json',definition:'{"type":"boolean"}'};
 const f=await fixture(t,[requirements,action('acceptance','requirements',true),again]);
 const r1=await f.produce('requirements','requirements v1'),c1=await f.produce('acceptance','first'),s1=await f.claim(c1.stepId);s1.read('artifact',r1.artifactId,'first-r1.txt');await s1.decide('approve');
 await f.produce('again','true');const r2=await f.produce('requirements','requirements v2'),c2=await f.produce('acceptance','second'),s2=await f.claim(c2.stepId);s2.read('artifact',r2.artifactId,'second-r2.txt');s2.read('artifact',r1.artifactId,'deny-v1.txt',false);s1.read('artifact',r1.artifactId,'history-r1.txt');s1.read('artifact',r2.artifactId,'deny-v2.txt',false);await s2.decide('approve');
 const rewound=JSON.parse(f.runner(['run','step','rewind','--run',f.runId,'--step',r1.stepId,'--reason','new confirmed requirements','--output','json']).stdout);
 const r3=await f.produce('requirements','requirements after rewind',[],rewound.replacementStepId),c3=await f.produce('acceptance','after rewind'),s3=await f.claim(c3.stepId);s3.read('artifact',r3.artifactId,'third-r3.txt');s3.read('artifact',r2.artifactId,'deny-v2-after.txt',false);
 s1.read('artifact',r1.artifactId,'revoked.txt',false);
 const history=JSON.parse(f.runner(['run','show','--run',f.runId,'--output','json']).stdout);const original=history.artifacts.find((a:any)=>a.id===c1.artifactId);assert.ok(original.dependencies.some((d:any)=>d.id===r1.artifactId));assert.ok(!original.dependencies.some((d:any)=>d.id===r2.artifactId||d.id===r3.artifactId));
 f.runner(['run','artifact','show','--run',f.runId,'--artifact',r1.artifactId,'--out',join(f.cwd,'historical-requirements.txt'),'--output','json']);assert.equal(await readFile(join(f.cwd,'historical-requirements.txt'),'utf8'),'requirements v1');
 assert.equal((await f.service.readArtifact(f.runId,r1.artifactId)).bytes.toString(),'requirements v1');assert.equal(await readFile(join(f.cwd,'history-r1.txt'),'utf8'),'requirements v1');
});

async function supplementalRevisionFixture(t:test.TestContext){
 const f=await fixture(t,[action('R'),action('P','R'),action('C','P',true)]),r=await f.produce('R','requirements'),p=await f.produce('P','plan');
 const body=(text:string)=>({content:{model:{definedBy:'raw.json',definition:'{}'},payload:{contentType:'text/plain',content:text}}});
 const e1=await f.service.addExternal(f.runId,'E1',body('first external')),e2=await f.service.addExternal(f.runId,'E2',body('second external')),step=(await f.active('C')).id;
 // API setup supplies an independent predecessor; the operation under test
 // below crosses the real production CLI and restricted Session boundaries.
 await f.service.withGraph(async g=>{await g.enter(f.runId,step);return g.report(f.runId,step,{text:'previous candidate',dependencies:[{kind:'artifact',id:r.artifactId},{kind:'external',id:e1.id}]});});
 await(await f.claim(step)).decide('request_changes');return {f,r,p,e1,e2,step};
}
for(const operation of ['inherit','clear','replace'] as const)test(`production CLI independently ${operation}s supplemental dependencies while preserving mandatory inputs`,async t=>{
 const {f,r,p,e1,e2,step}=await supplementalRevisionFixture(t);let result;
 if(operation==='clear'){
  const file=join(f.cwd,'clear-independent.json');await writeFile(file,JSON.stringify({content:{model:{definedBy:'raw.json',definition:'{}'},payload:{contentType:'text/plain',content:'clear'}},dependencies:[]}));
  result=JSON.parse(f.runner(['run','report','--run',f.runId,'--step',step,'--file',file,'--revision-summary','clear','--output','json']).stdout);
 }else result=await f.produce('C',operation,['--revision-summary',operation,...(operation==='replace'?['--depends-on',`external:${e2.id}`]:[])]);
 assert.ok(result.dependencies.some((d:any)=>d.id===p.artifactId));const current=await f.claim(step);current.read('artifact',p.artifactId,'mandatory.txt');
 current.read('artifact',r.artifactId,'ancestor.txt',operation==='inherit');current.read('external',e1.id,'e1.txt',operation==='inherit');current.read('external',e2.id,'e2.txt',operation==='replace');
});
test('production CLI rejects an unrelated supplemental Artifact and accepts a causal ancestor',async t=>{
 const f=await fixture(t,[action('R'),action('P','R'),action('U'),action('C','P',true)]),r=await f.produce('R','requirements');await f.produce('P','plan');const u=await f.produce('U','unrelated'),step=(await f.active('C')).id;
 f.runner(['run','step','enter','--run',f.runId,'--step',step]);const before=(await f.service.snapshot(f.runId)).artifacts.length;
 const denied=f.runner(['run','report','--run',f.runId,'--step',step,'--artifact','invalid','--depends-on',`artifact:${u.artifactId}`,'--output','json'],false);assert.match(denied.stderr,/outside this Step/);assert.equal((await f.service.snapshot(f.runId)).artifacts.length,before);
 await f.produce('C','valid',['--depends-on',`artifact:${r.artifactId}`]);const reader=await f.claim(step);reader.read('artifact',r.artifactId,'ancestor.txt');reader.read('artifact',u.artifactId,'unrelated.txt',false);
});

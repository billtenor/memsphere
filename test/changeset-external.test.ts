import crossSpawn from "cross-spawn";
import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { changeShowFixture } from "./helpers/change-show.js";
import { withMemoryChangeDetailSnapshot, validateMemoryChange } from "../src/memory/changeset.js";
import { memoryChangePart } from "../src/commands/memory-change-show.js";
import { openContextControl } from "../src/project/context-control.js";
import { createAgentReviewCliRuntime } from "../src/acp/cli-runtime.js";
import * as reviews from "../src/context_control/review-repository.js";
import { currentReviewNode } from "../src/review-nodes.js";
const execute=promisify(execFile);

test("fixed ChangeSet External survives D2 cleanup and historical restricted Review keeps E1", {timeout:180000}, async t=>{
 const f=await changeShowFixture(t), service=(await openContextControl(f.projectRoot))!, runId=f.env.MEMSPHERE_REVIEW_RUN_ID;
 const entrypoint=fileURLToPath(new URL('../dist/cli.js',import.meta.url)), runtime=await createAgentReviewCliRuntime({nodeExecutable:process.execPath,cliEntrypoint:entrypoint});t.after(()=>runtime.cleanup());
 const runnerEnv=Object.fromEntries(Object.entries(f.env).filter(([k])=>!k.startsWith('MEMSPHERE_REVIEW_')&&k!=='MEMSPHERE_WORKSPACE_ROOT'&&k!=='MEMSPHERE_CONFIG_PATH'));
 async function capture(digest:string){ const r=await execute(process.execPath,[entrypoint,'--project','project','run','external','add','--run',runId,'--change',f.edit.change.id,'--checkpoint',digest,'--output','json'],{cwd:f.env.MEMSPHERE_WORKSPACE_ROOT,env:runnerEnv});return JSON.parse(r.stdout).externalId as string; }
 const e1=await capture(f.checkpoint.checkpointDigest), fixed1=await service.readExternal(runId,e1);
 const snapshot1=JSON.parse(Buffer.from(fixed1.bytes).toString());assert.equal(snapshot1.summary.checkpointDigest,f.checkpoint.checkpointDigest);assert.match(JSON.stringify(snapshot1.memories),/Pinned content/);
 const modelRun=(await service.snapshot(runId)), step=modelRun.steps[0];
 async function revise(external:string){
  const current=(await service.snapshot(runId)).steps[0], round=current.reviewRounds!.at(-1)!;
  const input={service,runsRoot:join(f.projectRoot,'runs'),reviewId:reviews.graphReviewHandle(runId,step.id),roundId:round.id,actorId:'reader',attemptId:f.env.MEMSPHERE_REVIEW_ATTEMPT_ID};
  await reviews.markArtifactReviewAgentCliReady(input);
  let c=await reviews.readArtifactReviewForActor(input);
  while(currentReviewNode(c.assignment))c=await reviews.mutateArtifactReviewNodes({...input,mutation:{operation:'report',expectedNodeId:currentReviewNode(c.assignment)!.nodeId,artifact:{applicable:true}}});
  await reviews.submitArtifactReviewAgentAssignment({...input,vote:'approve'});
  await reviews.submitArtifactReviewRunnerVote({...input,vote:'request_changes',comment:'Replace fixed evidence'});
  const next=await service.withGraph(g=>g.report(runId,step.id,{text:'Evidence candidate',revisionSummary:'Replace fixed evidence',dependencies:[{kind:'external',id:external}]}));
  const claimed=(await reviews.claimArtifactReviewAgentAssignment({...input,roundId:next.step.reviewRounds!.at(-1)!.id,workerPid:process.pid}))!;
  Object.assign(f.env,{MEMSPHERE_REVIEW_ASSIGNMENT_ID:claimed.assignment.id!,MEMSPHERE_REVIEW_ATTEMPT_ID:claimed.attempt.id});
 }
 await revise(e1);
 const oldEnv={...f.env};
 await writeFile(f.candidate,(await readFile(f.candidate,'utf8')).replace('Pinned content','New D2 content'));
 const d2=await validateMemoryChange(f.edit.change.id);assert.notEqual(d2.checkpointDigest,f.checkpoint.checkpointDigest);
 assert.ok(!(await readdir(join(f.projectRoot,'changes',f.edit.change.id,'checkpoints'))).includes(f.checkpoint.checkpointDigest));
 const e2=await capture(d2.checkpointDigest);assert.notEqual(e1,e2);
 await revise(e2);
 async function read(external:string,env:NodeJS.ProcessEnv,file:string){const r=crossSpawn.sync(runtime.launcherPath,['run','external','show','--external',external,'--out',file,'--output','json'],{cwd:f.env.MEMSPHERE_WORKSPACE_ROOT,env,encoding:'utf8',timeout:20000});assert.ifError(r.error);if(r.status!==0)throw Object.assign(new Error(r.stderr),{code:r.status,stdout:r.stdout,stderr:r.stderr});return r;}
 await read(e1,oldEnv,'historical-e1.json');assert.deepEqual(await readFile(join(f.env.MEMSPHERE_WORKSPACE_ROOT,'historical-e1.json')),Buffer.from(fixed1.bytes));
 await assert.rejects(read(e2,oldEnv,'forbidden-e2.json'),(error:any)=>error.code===1&&error.stdout===''&&/REVIEW_RESOURCE_DENIED/.test(error.stderr));
 await read(e2,f.env,'current-e2.json');assert.match(await readFile(join(f.env.MEMSPHERE_WORKSPACE_ROOT,'current-e2.json'),'utf8'),/New D2 content/);
 await assert.rejects(read(e1,f.env,'forbidden-e1.json'),(error:any)=>error.code===1&&error.stdout===''&&/REVIEW_RESOURCE_DENIED/.test(error.stderr));
});

test("checkpoint changes during pure construction fail before any External registration", async t=>{
 const f=await changeShowFixture(t), service=(await openContextControl(f.projectRoot))!,runId=f.env.MEMSPHERE_REVIEW_RUN_ID;
 const before=(await service.snapshot(runId)).externals;
 let release!:()=>void, reached!:()=>void;
 const barrier=new Promise<void>(r=>{release=r}), ready=new Promise<void>(r=>{reached=r});
 const operation=(async()=>{
  const body=await withMemoryChangeDetailSnapshot({home:f.home,project:'project',changeId:f.edit.change.id,checkpointDigest:f.checkpoint.checkpointDigest,use:async detail=>{
   const part=await memoryChangePart(detail,{part:'diff',side:'after'});reached();await barrier;return part;
  }});
  return service.addExternal(runId,'fixed-capture',{content:{model:{definedBy:'raw.json',definition:'{}'},payload:{contentType:'application/json',content:JSON.stringify(body)}}});
 })();
 const rejected=assert.rejects(operation,/checkpoint mismatch/);
 await ready;await writeFile(f.candidate,(await readFile(f.candidate,'utf8')).replace('Pinned content','Changed at barrier'));
 await validateMemoryChange(f.edit.change.id);release();await rejected;
 assert.deepEqual((await service.snapshot(runId)).externals,before);
});

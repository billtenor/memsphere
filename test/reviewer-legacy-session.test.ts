import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import crossSpawn from "cross-spawn";
import { reviewNodeFixture } from "./helpers/review-nodes.js";
import * as reviews from "../src/context_control/review-repository.js";
import { createAgentReviewCliRuntime } from "../src/acp/cli-runtime.js";

async function legacyFixture(t: test.TestContext, context=false, tail=false) {
 const f=await reviewNodeFixture(t,false,false,{flowContext:context,flowTail:tail}), state=await reviews.readRun(f.input.runsRoot,f.runId);
 // Construct a historical persistence fixture; production commands never rewrite history.
 const assignment=state.artifactReviews![0].rounds[0].assignments.find(a=>a.actorId==='agent')!;
 delete assignment.nodeTree;delete assignment.nodeStates;delete assignment.id;
 await writeFile(join(f.input.runsRoot,f.runId,`${f.runId}.json`),JSON.stringify(state));
 const runtime=await createAgentReviewCliRuntime({nodeExecutable:process.execPath,cliEntrypoint:fileURLToPath(new URL('../dist/cli.js',import.meta.url))});t.after(()=>runtime.cleanup());
 const env={...process.env,MEMSPHERE_HOME:f.home,MEMSPHERE_CONFIG_PATH:join(f.root,'config.json'),MEMSPHERE_WORKSPACE_ROOT:f.cwd,MEMSPHERE_REVIEW_SOURCE_WORKSPACE:f.cwd,MEMSPHERE_REVIEW_RUN_ID:f.runId,MEMSPHERE_REVIEW_ASSIGNMENT_ID:assignment.actorId,MEMSPHERE_REVIEW_ATTEMPT_ID:f.bound.attemptId};
 const cli=(args:string[])=>{const r=crossSpawn.sync(runtime.launcherPath,args,{cwd:f.cwd,env,encoding:'utf8',timeout:20000});assert.ifError(r.error);return r;};
 return {...f,state,env,cli,runtime};
}

test('legacy Session requires its original Attempt identity',async t=>{
 const {state,env,cli,runtime,...f}=await legacyFixture(t);
 const missing=crossSpawn.sync(runtime.launcherPath,['run','artifact','show','--output','json'],{cwd:f.cwd,env:{...env,MEMSPHERE_REVIEW_ATTEMPT_ID:''},encoding:'utf8',timeout:20000});assert.equal(missing.status,1);assert.equal(missing.stdout,'');assert.match(missing.stderr,/REVIEW_SESSION_INVALID/);

});

test('legacy candidate reads accept legal global Project parameters',async t=>{
 const {state,env,cli,...f}=await legacyFixture(t);
 const read=cli(['--project','test-project','run','artifact','show','--output','json']);assert.equal(read.status,0,read.stderr);assert.match(read.stdout,/Candidate/);

});

test('legacy fixed Step reads reject targets outside the pinned submission',async t=>{
 const {state,env,cli,...f}=await legacyFixture(t);
 const step=cli(['run','artifact','show','--run',f.runId,'--step',state.artifactReviews![0].stepId,'--output','json']);assert.equal(step.status,0,step.stderr);assert.match(step.stdout,/Candidate/);
 const wrong=cli(['run','artifact','show','--run',f.runId,'--step','outside','--output','json']);assert.equal(wrong.status,1);assert.equal(wrong.stdout,'');assert.match(wrong.stderr,/REVIEW_RESOURCE_DENIED/);

});

test('legacy sessions without a node tree reject the progressive node protocol',async t=>{
 const {state,env,cli,...f}=await legacyFixture(t);
 const node=cli(['continue','report','--artifact','{"applicable":true}','--output','json']);assert.equal(node.status,1);assert.equal(node.stdout,'');assert.match(node.stderr,/review_nodes_not_enabled/);

});

test('legacy native comment and submit preserve the saved opinion and become read-only',async t=>{
 const {state,env,cli,...f}=await legacyFixture(t);
 const comment=cli(['run','review','comment','--body','Legacy suggestion','--severity','suggestion','--output','json']);assert.equal(comment.status,0,comment.stderr);
 const submitted=cli(['run','review','submit','--vote','approve','--summary','Historical protocol works','--output','json']);assert.equal(submitted.status,0,submitted.stderr);
 const after=cli(['run','artifact','show','--output','json']);assert.equal(after.status,0,after.stderr);assert.match(after.stdout,/Candidate/);
 const duplicate=cli(['run','review','comment','--body','Too late','--severity','suggestion','--output','json']);assert.equal(duplicate.status,1);assert.equal(duplicate.stdout,'');
 const persisted=await reviews.readArtifactReviewForActor(f.input);assert.equal(persisted.assignment.submitted?.comments[0].body,'Legacy suggestion');
});

test('legacy submitted Session remains pinned after a new candidate revision',async t=>{
 const {state,env,cli,...f}=await legacyFixture(t);
 const submitted=cli(['run','review','submit','--vote','approve','--summary','Submit fixed version','--output','json']);assert.equal(submitted.status,0,submitted.stderr);
 await reviews.submitArtifactReviewRunnerVote({ ...f.input, vote: 'request_changes', comment: 'Replace the candidate' });
 await reviews.reportRun({ runsRoot: f.input.runsRoot, runId: f.runId, artifact: { kind: 'inline', value: 'Replacement evidence' }, revisionSummary: 'Revised candidate' });
 const historical=cli(['run','artifact','show','--output','json']);assert.equal(historical.status,0,historical.stderr);assert.match(historical.stdout,/Candidate/);assert.doesNotMatch(historical.stdout,/Replacement evidence/);
 const persisted=await reviews.readArtifactReviewForActor(f.input);assert.equal(persisted.assignment.submitted?.vote,'approve');
});

test('historical flow capabilities, help and target errors agree with the actual protocol',async t=>{
 const f=await reviewNodeFixture(t,false),{buildArtifactReviewerPrompt}=await import('../src/acp/prompt.js');
 const prompt=await buildArtifactReviewerPrompt({context:await reviews.readArtifactReviewForActor(f.input),promptVersion:'artifact-review-v3'});
 assert.match(prompt,/"protocol": "flow"/);assert.doesNotMatch(prompt,/"run external show"/);assert.match(prompt,/fixed Artifact\/External\/confirmation targets are unsupported/);
 const runtime=await createAgentReviewCliRuntime({nodeExecutable:process.execPath,cliEntrypoint:fileURLToPath(new URL('../dist/cli.js',import.meta.url))});t.after(()=>runtime.cleanup());
 const env={...process.env,MEMSPHERE_HOME:f.home,MEMSPHERE_CONFIG_PATH:join(f.root,'config.json'),MEMSPHERE_WORKSPACE_ROOT:f.cwd,MEMSPHERE_REVIEW_RUN_ID:f.runId,MEMSPHERE_REVIEW_HANDLE:f.input.reviewId,MEMSPHERE_REVIEW_ASSIGNMENT_ID:f.claimed.assignment.id!,MEMSPHERE_REVIEW_ATTEMPT_ID:f.bound.attemptId};
 const cli=(args:string[])=>crossSpawn.sync(runtime.launcherPath,args,{cwd:f.cwd,env,encoding:'utf8',timeout:20000});
 const help=cli(['run','--help']);assert.equal(help.status,0,help.stderr);assert.doesNotMatch(help.stdout,/external/);
 for(const args of [['run','external','show','--external','unknown'],['run','artifact','show','--artifact','unknown']]){const r=cli([...args,'--output','json']);assert.equal(r.status,1);assert.equal(r.stdout,'');assert.match(r.stderr,/INVALID_ARGUMENT/);assert.match(r.stderr,/graph|flow/);}
 const read=cli(['run','artifact','show','--output','json']);assert.equal(read.status,0,read.stderr);assert.match(read.stdout,/Candidate/);
});


test('legacy Step candidate reads preserve the complete public Artifact DTO',async t=>{
 const f=await legacyFixture(t),args=['run','artifact','show','--output','json'];
 const normal=f.cli(args),step=f.cli([...args,'--run',f.runId,'--step',f.state.artifactReviews![0].stepId]);assert.equal(step.status,0,step.stderr);
 const expected=JSON.parse(normal.stdout),actual=JSON.parse(step.stdout);assert.equal(expected.artifact.type,'string');assert.ok(expected.artifact.format);assert.ok(expected.artifact.storage);assert.deepEqual(actual.artifact,expected.artifact);assert.deepEqual(actual.revisionSummary,expected.revisionSummary);
});
test('legacy Step context reads preserve frozen file metadata and complete body',async t=>{
 const f=await legacyFixture(t,true),full=JSON.parse(f.cli(['run','artifact','show','--output','json']).stdout),context=full.contextArtifacts[0];assert.ok(context);
 const r=f.cli(['run','artifact','show','--step',context.stepId,'--output','json']);assert.equal(r.status,0,r.stderr);const actual=JSON.parse(r.stdout);assert.equal(actual.artifact.type,'string');assert.equal(actual.artifact.format.name,'markdown');assert.equal(actual.artifact.storage,'file');assert.deepEqual(actual.artifact,context.artifact);assert.match(actual.artifact.value,/Earlier frozen evidence/);
});
async function revisedLegacyFixture(t:test.TestContext){
 const f=await legacyFixture(t);assert.equal(f.cli(['run','review','submit','--vote','approve','--output','json']).status,0);
 await reviews.submitArtifactReviewRunnerVote({...f.input,vote:'request_changes',comment:'Revise'});
 const run=await reviews.reportRun({runsRoot:f.input.runsRoot,runId:f.runId,artifact:{kind:'inline',value:'Second fixed candidate'},revisionSummary:'Second fixed revision'}),review=run.artifactReviews!.at(-1)!,input={...f.input,roundId:review.currentRoundId};
 const claimed=(await reviews.claimArtifactReviewAgentAssignment({...input,workerPid:process.pid}))!;await reviews.markArtifactReviewAgentCliReady({...input,attemptId:claimed.attempt.id});
 const state=await reviews.readRun(f.input.runsRoot,f.runId),assignment=state.artifactReviews!.at(-1)!.rounds.at(-1)!.assignments.find(a=>a.actorId==='agent')!;delete assignment.nodeTree;delete assignment.nodeStates;delete assignment.id;await writeFile(join(f.input.runsRoot,f.runId,`${f.runId}.json`),JSON.stringify(state));
 Object.assign(f.env,{MEMSPHERE_REVIEW_ASSIGNMENT_ID:'agent',MEMSPHERE_REVIEW_ATTEMPT_ID:claimed.attempt.id});return {...f,input};
}
test('legacy Step reads preserve the pinned revision summary after later revisions',async t=>{
 const f=await revisedLegacyFixture(t),before=JSON.parse(f.cli(['run','artifact','show','--step',f.state.artifactReviews![0].stepId,'--output','json']).stdout);assert.equal(before.revisionSummary.body,'Second fixed revision');assert.match(before.revisionSummary.digest,/^sha256:[a-f0-9]{64}$/);
 assert.equal(f.cli(['run','review','submit','--vote','approve','--output','json']).status,0);await reviews.submitArtifactReviewRunnerVote({...f.input,vote:'request_changes',comment:'Third'});await reviews.reportRun({runsRoot:f.input.runsRoot,runId:f.runId,artifact:{kind:'inline',value:'Third candidate'},revisionSummary:'Third revision'});
 const r=f.cli(['run','artifact','show','--step',f.state.artifactReviews![0].stepId,'--output','json']);assert.equal(r.status,0,r.stderr);const history=JSON.parse(r.stdout);assert.deepEqual(history.artifact,before.artifact);assert.deepEqual(history.revisionSummary,before.revisionSummary);assert.equal(history.artifact.value,'Second fixed candidate');
});

for(const completed of [false,true])test(`legacy accepted contract remains pinned after ${completed?'Run completion':'advancing to the next Step'}`,async t=>{
 const f=await legacyFixture(t,false,true),args=['run','artifact','contract','show','--output','json'],initial=f.cli(args);assert.equal(initial.status,0,initial.stderr);const expected=JSON.parse(initial.stdout);assert.equal(expected.action.instruction,'Make result');assert.ok(expected.action.asserts.length);
 assert.equal(f.cli(['run','review','submit','--vote','approve','--output','json']).status,0);
 await reviews.submitArtifactReviewHumanAssignmentForRunner({...f.input,runId:f.runId,assignmentId:'human',vote:'approve',comments:[],authorizationNote:'Fixture Human approves first Step.'});
 const accepted=await reviews.submitArtifactReviewRunnerVote({...f.input,vote:'approve'});assert.equal(accepted.run.status,'running');
 if(completed){const done=await reviews.reportRun({runsRoot:f.input.runsRoot,runId:f.runId,artifact:{kind:'inline',value:'Later result'}});assert.equal(done.status,'done');}
 for(const target of [[],['--assignment','agent'],['--step',f.state.artifactReviews![0].stepId],['--run',f.runId,'--step',f.state.artifactReviews![0].stepId]]){const r=f.cli([...args,...target]);assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),expected);}
});

test('legacy context contract targets fail explicitly instead of reading the current Run contract',async t=>{
 const f=await legacyFixture(t,true),context=JSON.parse(f.cli(['run','artifact','show','--output','json']).stdout).contextArtifacts[0];
 const r=f.cli(['run','artifact','contract','show','--run',f.runId,'--step',context.stepId,'--output','json']);assert.equal(r.status,1);assert.equal(r.stdout,'');assert.match(r.stderr,/INVALID_ARGUMENT/);assert.match(r.stderr,/pinned candidate contract only/);
});

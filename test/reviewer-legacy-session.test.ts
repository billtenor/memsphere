import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import crossSpawn from "cross-spawn";
import { reviewNodeFixture } from "./helpers/review-nodes.js";
import * as reviews from "../src/context_control/review-repository.js";
import { createAgentReviewCliRuntime } from "../src/acp/cli-runtime.js";

test("historical flow Session without a node tree retains native comment/submit and pinned reads", async t=>{
 const f=await reviewNodeFixture(t,false), state=await reviews.readRun(f.input.runsRoot,f.runId);
 // Construct a historical persistence fixture; production commands never rewrite history.
 const assignment=state.artifactReviews![0].rounds[0].assignments.find(a=>a.actorId==='agent')!;
 delete assignment.nodeTree;delete assignment.nodeStates;
 await writeFile(join(f.input.runsRoot,f.runId,`${f.runId}.json`),JSON.stringify(state));
 const runtime=await createAgentReviewCliRuntime({nodeExecutable:process.execPath,cliEntrypoint:fileURLToPath(new URL('../dist/cli.js',import.meta.url))});t.after(()=>runtime.cleanup());
 const env={...process.env,MEMSPHERE_HOME:f.home,MEMSPHERE_CONFIG_PATH:join(f.root,'config.json'),MEMSPHERE_WORKSPACE_ROOT:f.cwd,MEMSPHERE_REVIEW_SOURCE_WORKSPACE:f.cwd,MEMSPHERE_REVIEW_RUN_ID:f.runId,MEMSPHERE_REVIEW_ASSIGNMENT_ID:f.claimed.assignment.id!,MEMSPHERE_REVIEW_ATTEMPT_ID:f.bound.attemptId};
 const cli=(args:string[])=>{const r=crossSpawn.sync(runtime.launcherPath,args,{cwd:f.cwd,env,encoding:'utf8',timeout:20000});assert.ifError(r.error);return r;};
 const read=cli(['--project','test-project','run','artifact','show','--output','json']);assert.equal(read.status,0,read.stderr);assert.match(read.stdout,/Candidate/);
 const step=cli(['run','artifact','show','--run',f.runId,'--step',state.artifactReviews![0].stepId,'--output','json']);assert.equal(step.status,0,step.stderr);assert.match(step.stdout,/Candidate/);
 const wrong=cli(['run','artifact','show','--run',f.runId,'--step','outside','--output','json']);assert.equal(wrong.status,1);assert.equal(wrong.stdout,'');assert.match(wrong.stderr,/REVIEW_RESOURCE_DENIED/);
 const node=cli(['continue','report','--artifact','{"applicable":true}','--output','json']);assert.equal(node.status,1);assert.equal(node.stdout,'');assert.match(node.stderr,/review_nodes_not_enabled/);
 const comment=cli(['run','review','comment','--body','Legacy suggestion','--severity','suggestion','--output','json']);assert.equal(comment.status,0,comment.stderr);
 const submitted=cli(['run','review','submit','--vote','approve','--summary','Historical protocol works','--output','json']);assert.equal(submitted.status,0,submitted.stderr);
 const after=cli(['run','artifact','show','--output','json']);assert.equal(after.status,0,after.stderr);assert.match(after.stdout,/Candidate/);
 const duplicate=cli(['run','review','comment','--body','Too late','--severity','suggestion','--output','json']);assert.equal(duplicate.status,1);assert.equal(duplicate.stdout,'');
 const persisted=await reviews.readArtifactReviewForActor(f.input);assert.equal(persisted.assignment.submitted?.comments[0].body,'Legacy suggestion');assert.equal(persisted.assignment.submitted?.vote,'approve');
});

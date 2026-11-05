import {processGate} from './process-gates.mjs';
import {readFile} from 'node:fs/promises';
import {runArtifactReviewAgentWorker} from '../../dist/acp/review-worker.js';
const input=JSON.parse(await readFile(process.argv[2],'utf8'));
if(input.claimGate){
 await processGate(input.gates,'publish',input.ready,{paused:true});
 await processGate(input.gates,'wait',input.claimGate);
}
await runArtifactReviewAgentWorker({...input, nodeExecutable:process.execPath, providerResolver:()=>({id:'traex',buildLaunch:({actor,workspaceRoot,sessionEnv})=>({provider:'fake-test-provider',command:actor.agent.command,args:actor.agent.args,cwd:workspaceRoot,env:{...process.env,...sessionEnv,REVIEW_TEST_READY:input.ready,REVIEW_TEST_GATES:String(input.gates),...(input.release?{REVIEW_TEST_RELEASE:input.release}:{})},startupTimeoutMs:10000,idleTimeoutMs:null,maxRuntimeMs:null,promptVersion:'artifact-review-v1'})})});

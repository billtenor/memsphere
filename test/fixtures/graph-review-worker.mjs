import {processGate} from './process-gates.mjs';
import {spawn} from 'node:child_process';
import {runAgentReviewAcpSession} from '../../dist/acp/client.js';
import {readFile} from 'node:fs/promises';
import {runArtifactReviewAgentWorker} from '../../dist/acp/review-worker.js';
const input=JSON.parse(await readFile(process.argv[2],'utf8'));
if(input.claimGate){
 await processGate(input.gates,'publish',input.ready,{paused:true});
 await processGate(input.gates,'wait',input.claimGate);
}
const runSession = input.launchGate ? async session => {
 let checks=0,provider;
 const check=session.assertLaunchValid;
 return runAgentReviewAcpSession({...session,assertLaunchValid:async()=>{
  if(++checks === (input.launchGate === 'before-provider' ? 1 : 2)){
   await processGate(input.gates,'publish',input.ready,{paused:true,...(provider?{providerPid:provider.pid}:{})});
   await processGate(input.gates,'wait',`release-launch:${input.ready}`);
  }
  await check();
 }},{spawn:launch=>{provider=spawn(launch.command,launch.args,{cwd:launch.cwd,env:launch.env,stdio:'pipe'});return provider;}});
} : undefined;
await runArtifactReviewAgentWorker({...input, runSession, nodeExecutable:process.execPath, providerResolver:()=>({id:'traex',buildLaunch:({actor,workspaceRoot,sessionEnv})=>({provider:'fake-test-provider',command:actor.agent.command,args:actor.agent.args,cwd:workspaceRoot,env:{...process.env,...sessionEnv,REVIEW_TEST_READY:input.ready,REVIEW_TEST_GATES:String(input.gates),...(input.release?{REVIEW_TEST_RELEASE:input.release}:{}),...(input.submitted?{REVIEW_TEST_SUBMITTED:"yes"}:{})},startupTimeoutMs:10000,idleTimeoutMs:null,maxRuntimeMs:null,promptVersion:'artifact-review-v1'})})});

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
const runSession = input.lateDescendant ? session => runAgentReviewAcpSession({...session,onBeforeStop:async pid=>{
 await session.onBeforeStop(pid);
 await processGate(input.gates,'publish',`snapshot-ready:${input.ready}`);
 await processGate(input.gates,'wait',`snapshot-continue:${input.ready}`);
}}) : input.launchGate ? async session => {
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
await runArtifactReviewAgentWorker({...input, runSession, nodeExecutable:process.execPath, providerResolver:()=>({id:'traex',buildLaunch:({actor,workspaceRoot,sessionEnv})=>{if(input.failProviderBuild)throw new Error('agent_provider_configuration: injected before Provider spawn');return ({provider:'fake-test-provider',command:actor.agent.command,args:actor.agent.args,cwd:workspaceRoot,env:{...process.env,...sessionEnv,REVIEW_TEST_READY:input.ready,REVIEW_TEST_GATES:String(input.gates),...(input.lateDescendant?{REVIEW_TEST_LATE_DESCENDANT:'yes'}:{}),...(input.release?{REVIEW_TEST_RELEASE:input.release}:{}),...(input.submitted?{REVIEW_TEST_SUBMITTED:"yes"}:{}),...(input.completed?{REVIEW_TEST_COMPLETE:"yes"}:{})},startupTimeoutMs:10000,idleTimeoutMs:null,maxRuntimeMs:null,promptVersion:'artifact-review-v1'});}})});

import {readFile,writeFile,access} from 'node:fs/promises';
import {runArtifactReviewAgentWorker} from '../../dist/acp/review-worker.js';
const input=JSON.parse(await readFile(process.argv[2],'utf8'));
if(input.claimGate){
 await writeFile(input.ready,JSON.stringify({paused:true}));
 while(true){try{await access(input.claimGate);break;}catch{}await new Promise(resolve=>setTimeout(resolve,25));}
}
await runArtifactReviewAgentWorker({...input, nodeExecutable:process.execPath, providerResolver:()=>({id:'traex',buildLaunch:({actor,workspaceRoot,sessionEnv})=>({provider:'fake-test-provider',command:actor.agent.command,args:actor.agent.args,cwd:workspaceRoot,env:{...process.env,...sessionEnv,REVIEW_TEST_READY:input.ready,...(input.release?{REVIEW_TEST_RELEASE:input.release}:{})},startupTimeoutMs:10000,idleTimeoutMs:null,maxRuntimeMs:null,promptVersion:'artifact-review-v1'})})});

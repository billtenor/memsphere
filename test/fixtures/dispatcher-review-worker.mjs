// Keep the native dispatcher/worker/ACP path; only replace the external provider.
import {runArtifactReviewAgentWorker} from '../../dist/acp/review-worker.js';
import {join} from 'node:path';
import {processGate} from './process-gates.mjs';
if (process.argv.slice(2,5).join(' ') !== 'run review agent-worker') {
  await import('../../dist/cli.js');
} else {
  const args=process.argv.slice(5), value=name=>args[args.indexOf(name)+1];
  const review=value('--review');
  const endpoint=process.env.REWIND_DISPATCH_GATES;
  const ready=process.env.REWIND_DISPATCH_CONTROL, cleanup=new AbortController();
  if (!endpoint || !ready) throw Error('Missing controlled dispatcher fixture environment');
  const controlled=processGate(endpoint,'wait',`stop:${ready}`,undefined,cleanup.signal)
    .then(()=>process.exit(0),error=>{if(!cleanup.signal.aborted)throw error;});
  try {
   await processGate(endpoint,'publish',`control:${ready}`,{pid:process.pid});
   await processGate(endpoint,'wait',`start:${ready}`);
   await runArtifactReviewAgentWorker({config:value('--config'),review,round:value('--round'),assignment:value('--assignment'),nodeExecutable:value('--node-executable'),cliEntrypoint:value('--cli-entrypoint'),workspaceRoot:value('--workspace-root'),
    providerResolver:()=>({id:'traex',buildLaunch:({actor,workspaceRoot,sessionEnv})=>({provider:'fake-test-provider',command:actor.agent.command,args:actor.agent.args,cwd:workspaceRoot,env:{...process.env,...actor.agent.env,...sessionEnv,REVIEW_TEST_READY:join(actor.agent.env.REVIEW_TEST_READY_PREFIX,review)},startupTimeoutMs:10000,idleTimeoutMs:null,maxRuntimeMs:null,promptVersion:'artifact-review-v1'})})});
  } finally { cleanup.abort(); await controlled; }
}

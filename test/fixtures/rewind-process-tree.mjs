import { fork } from 'node:child_process';
import { once } from 'node:events';
import { processGate } from './process-gates.mjs';
import { captureProcessIdentity, queryWindowsProcesses } from '../../dist/context_control/review-process.js';
import { startWindowsReviewJob } from '../../dist/context_control/windows-review-job.js';
if (process.argv[2] === 'child') {
  process.on('disconnect', () => {});
  process.on('message', message => {
    if (message !== 'late') return;
    const late = fork(new URL(import.meta.url), ['grandchild', process.argv[3]], { detached: true, execArgv: [], stdio: ['ignore','ignore','inherit','ipc'] });
    late.once('message', () => { process.send?.({latePid:late.pid}, () => process.exit(0)); });
  });
  process.send?.({ ready: true });
  await processGate(process.argv[3], 'wait', 'release');
} else if (process.argv[2] === 'grandchild') {
  process.on('disconnect', () => {});
  process.send?.({ready:true});
  await processGate(process.argv[3], 'wait', 'release');
} else {
  // The parent captures our identity. Spawning CIM here would first enroll this
  // process in libuv's kill-on-close Job, destroying the orphan precondition.
  const identityReply = once(process, 'message');
  process.send?.({ identityRequired: true });
  const [identity] = await identityReply;
  const job = process.platform === 'win32' ? await startWindowsReviewJob(identity) : undefined;
  let host;
  if(process.argv[3]==='host-loss'){
    const snapshot=(await queryWindowsProcesses()).filter(p=>p.parent===process.pid);
    const children=(await Promise.all(snapshot.map(async row=>{
      const current=await captureProcessIdentity(row.pid);
      return current?.started===row.started ? row : undefined;
    }))).filter(Boolean);
    if(children.length!==1)throw Error('Expected exactly one live keeper host before child creation');
    if(!children[0].started)throw Error('Keeper host creation identity is missing');
    host={pid:children[0].pid,group:children[0].group,started:children[0].started};
  }
  const child = fork(new URL(import.meta.url), ['child', process.argv[2]], { detached: true, execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  child.on('message', message => {
    if (message.latePid) process.send?.(message, () => process.exit(0));
    else process.send?.({ childPid: child.pid, job, host });
  });
  process.on('message', message => { if (message === 'orphan') process.exit(0); if (message === 'late-orphan') child.send('late'); });
}

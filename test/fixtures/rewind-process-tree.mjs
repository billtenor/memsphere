import { fork } from 'node:child_process';
import { processGate } from './process-gates.mjs';
import { captureProcessIdentity } from '../../dist/context_control/review-process.js';
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
  const job = process.platform === 'win32' ? await startWindowsReviewJob(await captureProcessIdentity(process.pid)) : undefined;
  const child = fork(new URL(import.meta.url), ['child', process.argv[2]], { detached: true, execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  child.on('message', message => {
    if (message.latePid) process.send?.(message, () => process.exit(0));
    else process.send?.({ childPid: child.pid, job });
  });
  process.on('message', message => { if (message === 'orphan') process.exit(0); if (message === 'late-orphan') child.send('late'); });
}

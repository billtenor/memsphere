import { fork } from 'node:child_process';
import { processGate } from './process-gates.mjs';
if (process.argv[2] === 'child') {
  process.on('disconnect', () => {});
  process.send?.({ ready: true });
  await processGate(process.argv[3], 'wait', 'release');
} else {
  const child = fork(new URL(import.meta.url), ['child', process.argv[2]], { detached: true, execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  child.once('message', () => process.send?.({ childPid: child.pid }));
  process.on('message', message => { if (message === 'orphan') process.exit(0); });
}

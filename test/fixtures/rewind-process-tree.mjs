import { fork } from 'node:child_process';
import { access } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
if (process.argv[2] === 'child') {
  process.send?.({ ready: true });
  while (true) {
    try { await access(process.argv[3]); break; } catch {}
    await delay(25);
  }
} else {
  const child = fork(new URL(import.meta.url), ['child', process.argv[2]], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  child.once('message', () => process.send?.({ childPid: child.pid }));
  process.on('message', message => { if (message === 'orphan') process.exit(0); });
}

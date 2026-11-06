import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {processGate} from './process-gates.mjs';

process.on('disconnect', () => {});
process.send?.('ready');
if (process.argv[2] === 'late') {
  await processGate(process.env.REVIEW_TEST_GATES, 'wait', `release-late:${process.env.REVIEW_TEST_READY}`);
} else {
  await processGate(process.env.REVIEW_TEST_GATES, 'wait', `spawn-late:${process.env.REVIEW_TEST_READY}`);
  const late = spawn(process.execPath, [fileURLToPath(import.meta.url), 'late'], {detached:true,cwd:tmpdir(),stdio:['ignore','ignore','inherit','ipc']});
  await once(late, 'message');
  await processGate(process.env.REVIEW_TEST_GATES, 'publish', `late-descendant:${process.env.REVIEW_TEST_READY}`, {latePid:late.pid});
  process.exit(0);
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { signalRecordedGroup } from '../../scripts/ci/test-processes.mjs';

const failure = (code: string) => Object.assign(new Error(`kill ${code}`), { code });

test('recorded group receives the requested signal without an extra snapshot on success', async () => {
  const signals: Array<[number, string]> = [];
  await signalRecordedGroup(42, 'SIGTERM', async () => { throw new Error('unexpected snapshot'); }, (pid: number, signal: string) => { signals.push([pid, signal]); });
  assert.deepEqual(signals, [[-42, 'SIGTERM']]);
});

test('an absent process group is already reclaimed', async () => {
  await signalRecordedGroup(42, 'SIGTERM', async () => { throw new Error('unexpected snapshot'); }, () => { throw failure('ESRCH'); });
});

test('EPERM after the recorded group has exited does not turn cancellation into a failure', async () => {
  await signalRecordedGroup(42, 'SIGTERM', async () => [], () => { throw failure('EPERM'); });
});

test('surviving members in a different group do not keep the exited target group alive', async () => {
  await signalRecordedGroup(42, 'SIGKILL', async () => [{ pid: 53, group: 53 }], () => { throw failure('EPERM'); });
});

test('EPERM remains a failure while a recorded member in the target group is alive', async () => {
  const denied = failure('EPERM');
  await assert.rejects(signalRecordedGroup(42, 'SIGTERM', async () => [{ pid: 43, group: 42 }], () => { throw denied; }), error => error === denied);
});

test('unrelated signal errors cannot be hidden by an empty survivor list', async () => {
  const problem = failure('EINVAL');
  await assert.rejects(signalRecordedGroup(42, 'SIGTERM', async () => [], () => { throw problem; }), error => error === problem);
});

test('failure to inspect survivors cannot be reported as successful reclamation', async () => {
  const problem = new Error('process inspection failed');
  await assert.rejects(signalRecordedGroup(42, 'SIGTERM', async () => { throw problem; }, () => { throw failure('EPERM'); }), error => error === problem);
});

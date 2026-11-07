import { processGate } from './process-gates.mjs';

process.on('disconnect', () => {});
if (process.env.REVIEW_TEST_RESISTANT) {
  process.on('SIGTERM', () => {});
  process.on('SIGUSR1', () => process.removeAllListeners('SIGTERM'));
}
// Keep the controlled process alive; this timer makes no readiness assertion.
const lifetime = setInterval(() => {}, 1000);
const cleanup = new AbortController();
void processGate(process.env.REVIEW_TEST_GATES, 'wait', `cleanup-child:${process.env.REVIEW_TEST_READY}`, undefined, cleanup.signal)
  .then(() => process.exit(0), error => { if (!cleanup.signal.aborted) { console.error(error); process.exitCode=1; clearInterval(lifetime); } });
// The normal-completion fixture exits with its Provider; orphan scenarios retain
// their explicit release gate and continue to exercise missing-exit evidence.
if (process.env.REVIEW_TEST_COMPLETE) process.on('disconnect', () => { clearInterval(lifetime); cleanup.abort(); });
process.send?.('ready');
if (process.env.REVIEW_TEST_RELEASE) {
  await processGate(process.env.REVIEW_TEST_GATES,'wait',process.env.REVIEW_TEST_RELEASE);
  clearInterval(lifetime);
  cleanup.abort();
}

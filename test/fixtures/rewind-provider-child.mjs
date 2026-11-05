import { processGate } from './process-gates.mjs';

process.on('disconnect', () => {});
if (process.env.REVIEW_TEST_RESISTANT) {
  process.on('SIGTERM', () => {});
  process.on('SIGUSR1', () => process.removeAllListeners('SIGTERM'));
}
// Keep the controlled process alive; this timer makes no readiness assertion.
const lifetime = setInterval(() => {}, 1000);
process.send?.('ready');
if (process.env.REVIEW_TEST_RELEASE) {
  await processGate(process.env.REVIEW_TEST_GATES,'wait',process.env.REVIEW_TEST_RELEASE);
  clearInterval(lifetime);
}

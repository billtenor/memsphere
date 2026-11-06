// Observe the actual synchronous wait's pending poll. Replace only that poll's
// scheduling boundary; Store reads, Review readiness and CLI output stay real.
import timers from 'node:timers/promises';
import {syncBuiltinESMExports} from 'node:module';
import {processGate} from './process-gates.mjs';
const original=timers.setTimeout;
let observed=false;
timers.setTimeout=async function(...args){
 if(!observed && new Error().stack?.includes('waitForArtifactReview')){
  observed=true;
  await processGate(process.env.REVIEW_WAIT_GATES,'publish','pending-poll');
  await processGate(process.env.REVIEW_WAIT_GATES,'wait','release-poll');
  return args[1];
 }
 return original(...args);
};
syncBuiltinESMExports();

import assert from "node:assert/strict";
import test from "node:test";
import { ManualClock } from "./support/manual-clock.js";

test("manual time resolves waits exactly at their deadlines and removes cancelled waits", async () => {
  const clock = new ManualClock(0), other = new ManualClock(0), controller = new AbortController();
  let done = false; const pending = clock.sleep(100).then(() => { done = true; });
  const cancelled = clock.sleep(200, controller.signal); controller.abort(new Error("cancel wait"));
  await assert.rejects(cancelled, /cancel wait/);
  clock.advance(99); await Promise.resolve(); assert.equal(done, false);
  clock.advance(1); await pending; assert.equal(done, true);
  assert.equal(clock.waiting, 0); assert.equal(other.now(), 0);
});

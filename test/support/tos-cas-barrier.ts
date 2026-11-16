import assert from "node:assert/strict";
import type { Context } from "../../src/data/api/context.js";
import type { TosObjectClient } from "../../src/data/extensions/tos-datastore/client.js";

function gate() {
  let open!: () => void;
  const promise = new Promise<void>(resolve => { open = resolve; });
  return { promise, open };
}
// Capture the test watchdog before module tests freeze the production clock.
const schedule = globalThis.setTimeout, unschedule = globalThis.clearTimeout;
export async function casPhase<T>(promise: Promise<T>, phase: string, timeoutMs = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = schedule(() => reject(Error(`CAS barrier deadline: ${phase}`)), timeoutMs); })]); }
  finally { unschedule(timer); }
}

/** Hold both fully constructed conditions at the public client boundary, then
 * await the chosen server commit before releasing the other original request. */
export async function controlledPutPair(input: {
  client: TosObjectClient;
  key: string;
  context?: Context;
  first: 0 | 1;
  condition: { create?: boolean; ifMatch?: string };
  conflictCode: string;
  timeoutMs?: number;
  write: (client: TosObjectClient, context: Context, index: 0 | 1) => Promise<void>;
}): Promise<void> {
  const ready = gate(), permits = [gate(), gate()];
  const controllers = [new AbortController(), new AbortController()];
  let prepared = 0, conditionsReady = false;
  let rejectPreparation!: (error: unknown) => void;
  const premature = new Promise<never>((_, reject) => { rejectPreparation = reject; });
  const client: TosObjectClient = { ...input.client, async put(context, key, body, options) {
    assert.equal(key, input.key);
    const index = prepared++;
    assert.ok(index < 2, "Conditional writers must not retry");
    assert.equal(options.create, input.condition.create);
    assert.equal(options.ifMatch, input.condition.ifMatch);
    if (prepared === 2) { conditionsReady = true; ready.open(); }
    await permits[index].promise;
    context.signal?.throwIfAborted();
    return input.client.put(context, key, body, options);
  } };
  const writes = ([0, 1] as const).map(index => {
    const signal = input.context?.signal ? AbortSignal.any([input.context.signal, controllers[index].signal]) : controllers[index].signal;
    return Promise.resolve().then(() => input.write(client, { signal }, index)).then(() => {
      if (!conditionsReady) rejectPreparation(Error("Writer completed before both original conditions were prepared"));
      return { success: true, code: "" };
    }, error => {
      if (!conditionsReady) rejectPreparation(error);
      return { success: false, code: error?.code as string };
    });
  });
  try {
    await casPhase(Promise.race([ready.promise, premature]), "both original conditions prepared", input.timeoutMs);
    permits[input.first].open();
    const first = await casPhase(writes[input.first], "chosen first server commit", input.timeoutMs);
    assert.equal(first.success, true, `First writer failed: ${first.code}`);
    const secondIndex = (1 - input.first) as 0 | 1;
    permits[secondIndex].open();
    const second = await casPhase(writes[secondIndex], "second original condition response", input.timeoutMs);
    assert.equal(second.success, false, "Exactly one conditional writer may commit");
    assert.equal(second.code, input.conflictCode);
    assert.equal(prepared, 2);
  } finally {
    controllers.forEach(controller => controller.abort());
    permits.forEach(permit => permit.open());
    await casPhase(Promise.allSettled(writes), "owned writes settled during cleanup", input.timeoutMs);
  }
}

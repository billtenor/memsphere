import assert from "node:assert/strict";
import type { Context } from "../../src/data/api/context.js";
import type { TosObjectClient } from "../../src/data/extensions/tos-datastore/client.js";

function gate() {
  let open!: () => void;
  const promise = new Promise<void>(resolve => { open = resolve; });
  return { promise, open };
}
async function deadline<T>(promise: Promise<T>, phase: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(`CAS barrier deadline: ${phase}`)), 15_000); })]); }
  finally { clearTimeout(timer); }
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
  write: (client: TosObjectClient, context: Context, index: 0 | 1) => Promise<void>;
}): Promise<void> {
  const ready = gate(), permits = [gate(), gate()];
  const controllers = [new AbortController(), new AbortController()];
  let prepared = 0;
  const client: TosObjectClient = { ...input.client, async put(context, key, body, options) {
    assert.equal(key, input.key);
    const index = prepared++;
    assert.ok(index < 2, "Conditional writers must not retry");
    assert.equal(options.create, input.condition.create);
    assert.equal(options.ifMatch, input.condition.ifMatch);
    if (prepared === 2) ready.open();
    await permits[index].promise;
    context.signal?.throwIfAborted();
    return input.client.put(context, key, body, options);
  } };
  const writes = ([0, 1] as const).map(index => {
    const signal = input.context?.signal ? AbortSignal.any([input.context.signal, controllers[index].signal]) : controllers[index].signal;
    return input.write(client, { signal }, index).then(() => ({ success: true, code: "" }), error => ({ success: false, code: error.code as string }));
  });
  try {
    await deadline(ready.promise, "both original conditions prepared");
    permits[input.first].open();
    const first = await deadline(writes[input.first], "chosen first server commit");
    assert.equal(first.success, true, `First writer failed: ${first.code}`);
    const secondIndex = (1 - input.first) as 0 | 1;
    permits[secondIndex].open();
    const second = await deadline(writes[secondIndex], "second original condition response");
    assert.equal(second.success, false, "Exactly one conditional writer may commit");
    assert.equal(second.code, input.conflictCode);
    assert.equal(prepared, 2);
  } finally {
    controllers.forEach(controller => controller.abort());
    permits.forEach(permit => permit.open());
    await deadline(Promise.allSettled(writes), "owned writes settled during cleanup");
  }
}

import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { PreparationCache } from "../src/data/management/preparation.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

test("preparation shares pending work and caches successful result identity", async () => {
  const cache = new PreparationCache();
  const ready = deferred<{ id: string }>();
  let calls = 0;
  const create = () => { calls++; return ready.promise; };
  const first = cache.get({}, "runtime:order", create);
  const second = cache.get({}, "runtime:order", create);
  assert.equal(calls, 0, "creation starts after pending registration");
  await Promise.resolve();
  assert.equal(calls, 1);
  const runtime = { id: "order" };
  ready.resolve(runtime);
  assert.strictEqual(await first, runtime);
  assert.strictEqual(await second, runtime);
  assert.strictEqual(await cache.get({}, "runtime:order", create), runtime);
  assert.equal(calls, 1);

  let undefinedCalls = 0;
  const empty = async () => { undefinedCalls++; return undefined; };
  assert.equal(await cache.get({}, "undefined", empty), undefined);
  assert.equal(await cache.get({}, "undefined", empty), undefined);
  assert.equal(undefinedCalls, 1, "undefined is still a completed result");
});

test("preparation retries rejected and synchronously throwing creators", async () => {
  const cache = new PreparationCache();
  const failure = new Error("temporary failure");
  let calls = 0;
  const failed = () => { calls++; return Promise.reject(failure); };
  const results = await Promise.allSettled([
    cache.get({}, "model:order", failed),
    cache.get({}, "model:order", failed)
  ]);
  assert.equal(calls, 1);
  for (const result of results) {
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") assert.strictEqual(result.reason, failure);
  }
  await assert.rejects(cache.get({}, "model:order", () => { throw failure; }), error => error === failure);
  const value = {};
  assert.strictEqual(await cache.get({}, "model:order", async () => value), value);
});

test("already aborted contexts neither start work nor return cached values", async () => {
  const cache = new PreparationCache();
  const controller = new AbortController();
  const reason = new Error("already canceled");
  controller.abort(reason);
  let calls = 0;
  const create = async () => { calls++; return {}; };
  await assert.rejects(cache.get({ signal: controller.signal }, "new", create), error => error === reason);
  assert.equal(calls, 0);
  await cache.get({}, "done", create);
  await assert.rejects(cache.get({ signal: controller.signal }, "done", create), error => error === reason);
  assert.equal(calls, 1);
});

test("canceling the first waiter does not cancel shared creation or other waiters", async () => {
  const cache = new PreparationCache();
  const ready = deferred<object>();
  const controller = new AbortController();
  const reason = new Error("stop waiting");
  let calls = 0;
  const create = () => { calls++; return ready.promise; };
  const first = cache.get({ signal: controller.signal }, "store:order", create);
  const rejected = assert.rejects(first, error => error === reason);
  const second = cache.get({}, "store:order", create);
  controller.abort(reason);
  await rejected;
  const value = {};
  ready.resolve(value);
  assert.strictEqual(await second, value);
  assert.strictEqual(await cache.get({}, "store:order", create), value);
  assert.equal(calls, 1);
});

test("shared creation still caches success after every waiter cancels", async () => {
  const cache = new PreparationCache();
  const ready = deferred<object>();
  const controller = new AbortController();
  const first = cache.get({ signal: controller.signal }, "store:order", () => ready.promise);
  const rejected = assert.rejects(first, { name: "AbortError" });
  controller.abort();
  await rejected;
  const value = {};
  ready.resolve(value);
  await setImmediate();
  assert.strictEqual(await cache.get({}, "store:order", async () => { throw new Error("must be cached"); }), value);
});

test("shared rejection after every waiter cancels is observed and remains retryable", async () => {
  const cache = new PreparationCache();
  const ready = deferred<object>();
  const controller = new AbortController();
  const unhandled: unknown[] = [];
  const onUnhandled = (error: unknown) => { unhandled.push(error); };
  process.on("unhandledRejection", onUnhandled);
  try {
    const wait = cache.get({ signal: controller.signal }, "runtime:order", () => ready.promise);
    const rejected = assert.rejects(wait, { name: "AbortError" });
    controller.abort();
    await rejected;
    ready.reject(new Error("later failure"));
    await setImmediate();
    assert.deepEqual(unhandled, []);
    const value = {};
    assert.strictEqual(await cache.get({}, "runtime:order", async () => value), value);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("acyclic concurrent preparation roots can share a dependency", async () => {
  const cache = new PreparationCache();
  const ready = deferred<object>();
  const dependency = {};
  let dependencyCalls = 0;
  const createDependency = () => { dependencyCalls++; return ready.promise; };
  const left = cache.get({}, "runtime:left", () => cache.get({}, "runtime:common", createDependency, "runtime:left"));
  const right = cache.get({}, "runtime:right", () => cache.get({}, "runtime:common", createDependency, "runtime:right"));
  await setImmediate();
  assert.equal(dependencyCalls, 1);
  ready.resolve(dependency);
  assert.strictEqual(await left, dependency);
  assert.strictEqual(await right, dependency);
});

test("preparation rejects direct and nested dependency cycles", { timeout: 1000 }, async () => {
  const direct = new PreparationCache();
  await assert.rejects(
    direct.get({}, "runtime:self", () => direct.get({}, "runtime:self", async () => ({}), "runtime:self")),
    /dependency cycle: runtime:self -> runtime:self/
  );
  const cache = new PreparationCache();
  const createA = (): Promise<object> => cache.get({}, "runtime:b", createB, "runtime:a");
  const createB = (): Promise<object> => cache.get({}, "runtime:c", createC, "runtime:b");
  const createC = (): Promise<object> => cache.get({}, "runtime:a", createA, "runtime:c");
  await assert.rejects(cache.get({}, "runtime:a", createA), /dependency cycle: runtime:c -> runtime:a -> runtime:b -> runtime:c/);
});

test("preparation detects cycles across independently started roots and retries after failure", { timeout: 1000 }, async () => {
  const cache = new PreparationCache();
  const start = deferred<void>();
  const createA = async (): Promise<object> => {
    await start.promise;
    return cache.get({}, "runtime:b", createB, "runtime:a");
  };
  const createB = async (): Promise<object> => {
    await start.promise;
    return cache.get({}, "runtime:a", createA, "runtime:b");
  };
  const first = cache.get({}, "runtime:a", createA);
  const second = cache.get({}, "runtime:b", createB);
  const settled = Promise.allSettled([first, second]);
  start.resolve();
  for (const result of await settled) {
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") assert.match(String(result.reason), /dependency cycle: runtime:b -> runtime:a -> runtime:b/);
  }
  const value = {};
  assert.strictEqual(await cache.get({}, "runtime:a", () => cache.get({}, "runtime:b", async () => value, "runtime:a")), value);
  assert.strictEqual(await cache.get({}, "runtime:b", async () => { throw new Error("must be cached"); }), value);
});

test("duplicate wait edges remain tracked when one nested waiter cancels", { timeout: 1000 }, async () => {
  const cache = new PreparationCache();
  const controller = new AbortController();
  const bStarted = deferred<void>();
  const continueB = deferred<void>();
  const createA = async (): Promise<object> => {
    const canceled = cache.get({ signal: controller.signal }, "runtime:b", createB, "runtime:a");
    const rejected = assert.rejects(canceled, { name: "AbortError" });
    const remaining = cache.get({}, "runtime:b", createB, "runtime:a");
    controller.abort();
    await rejected;
    continueB.resolve();
    return remaining;
  };
  const createB = async (): Promise<object> => {
    bStarted.resolve();
    await continueB.promise;
    return cache.get({}, "runtime:a", createA, "runtime:b");
  };
  const root = cache.get({}, "runtime:a", createA);
  const rejected = assert.rejects(root, /dependency cycle/);
  await bStarted.promise;
  await rejected;
});

test("late cleanup from a failed attempt cannot erase a retry's dependency edges", { timeout: 1000 }, async () => {
  const cache = new PreparationCache();
  const controller = new AbortController();
  const continueB = deferred<void>();
  const retryStarted = deferred<void>();
  let abandonedWait!: Promise<object>;
  const createB = async (): Promise<object> => {
    await continueB.promise;
    return cache.get({}, "runtime:a", async () => ({}), "runtime:b");
  };
  await assert.rejects(cache.get({}, "runtime:a", async () => {
    abandonedWait = cache.get({ signal: controller.signal }, "runtime:b", createB, "runtime:a");
    void abandonedWait.catch(() => {});
    throw new Error("first attempt failed before its dependency");
  }), /first attempt failed/);

  const retry = cache.get({}, "runtime:a", async () => {
    const wait = cache.get({}, "runtime:b", createB, "runtime:a");
    retryStarted.resolve();
    return wait;
  });
  const rejectedRetry = assert.rejects(retry, /dependency cycle: runtime:b -> runtime:a -> runtime:b/);
  await retryStarted.promise;
  controller.abort();
  await assert.rejects(abandonedWait, { name: "AbortError" });
  continueB.resolve();
  await rejectedRetry;
});

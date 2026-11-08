import assert from "node:assert/strict";
import test from "node:test";
import { RunSummaryRequests } from "../modules/org.memsphere.run/adapter/view/summary-requests.js";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

test("Home and list share a pending query, but a subsequent refresh reads again", async () => {
  const response = deferred<Response>(); let calls = 0;
  const requests = new RunSummaryRequests(async () => ++calls === 1 ? response.promise : Response.json({ runs: [{ id: "B" }] }));
  const home = requests.read("/project/runs?running"), list = requests.read("/project/runs?running");
  response.resolve(Response.json({ runs: [{ id: "A" }] }));
  assert.deepEqual(await home, { runs: [{ id: "A" }] });
  assert.deepEqual(await list, await home); assert.equal(calls, 1);
  assert.deepEqual(await requests.read("/project/runs?running"), { runs: [{ id: "B" }] }); assert.equal(calls, 2);
});

test("leaving one consumer does not cancel another consumer's query", async () => {
  const response = deferred<Response>(); let networkSignal: AbortSignal | undefined;
  const requests = new RunSummaryRequests(async (_url, init) => { networkSignal = init?.signal as AbortSignal; return response.promise; });
  const controller = new AbortController();
  const leaving = requests.read("/runs", controller.signal), remaining = requests.read("/runs");
  controller.abort();
  await assert.rejects(leaving, { name: "AbortError" });
  assert.equal(networkSignal!.aborted, false);
  response.resolve(Response.json({ runs: [] })); assert.deepEqual(await remaining, { runs: [] });
});

test("different Project or status queries are isolated and a failed query can retry", async () => {
  const replies = [deferred<Response>(), deferred<Response>(), deferred<Response>()]; let calls = 0;
  const requests = new RunSummaryRequests(async () => replies[calls++].promise);
  const first = requests.read("/a/runs?running"), other = requests.read("/b/runs?running"), terminal = requests.read("/a/runs?done");
  replies[0].resolve(new Response("temporary failure", { status: 500 }));
  replies[1].resolve(Response.json({ runs: ["B"] })); replies[2].resolve(Response.json({ runs: ["done"] }));
  await assert.rejects(first, /temporary failure/);
  assert.deepEqual(await other, { runs: ["B"] }); assert.deepEqual(await terminal, { runs: ["done"] });
  replies.push(deferred<Response>()); const retry = requests.read("/a/runs?running");
  replies[3].resolve(Response.json({ runs: ["recovered"] })); assert.deepEqual(await retry, { runs: ["recovered"] });
});

test("unloading the Module aborts network work and rejects later use", async () => {
  const requests = new RunSummaryRequests(async (_url, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
  }));
  const pending = requests.read("/runs");
  await Promise.resolve(); requests.dispose();
  await assert.rejects(pending, { name: "AbortError" });
  await assert.rejects(requests.read("/runs"), { name: "AbortError" });
});

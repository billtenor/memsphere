import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Readable } from "node:stream";
import { ContextTosSdk, readBounded } from "../src/data/extensions/tos-datastore/context-sdk.js";

import { fixture, gate } from "./support/tos-sdk-http.js";

const settings = { timeout: 10_000 };

test("SDK defaults send conditional metadata and unknown-length body without a preliminary read", settings, async t => {
  const calls: { method: string; headers: http.IncomingHttpHeaders; body: Buffer }[] = [];
  const f = await fixture(t, (request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      calls.push({ method: request.method!, headers: request.headers, body: Buffer.concat(chunks) });
      response.writeHead(200, { etag: '"updated"', "x-tos-request-id": "local-test" }); response.end();
    });
  });
  const body = f.track(Readable.from([Buffer.from("header"), Buffer.from("payload")]));
  const result = await f.sdk.operate({}, [200], () => f.sdk.putObject({ bucket: "probe-bucket", key: "id",
    body, ifMatch: '"old:etag"', meta: { model: "file" } }), { body });
  assert.equal(result.headers.etag, '"updated"');
  assert.deepEqual(calls.map(c => c.method), ["PUT"]);
  assert.equal(calls[0].headers["if-match"], '"old:etag"');
  assert.equal(calls[0].headers["x-tos-meta-model"], "file");
  assert.equal(calls[0].headers["transfer-encoding"], "chunked");
  assert.equal(calls[0].body.toString(), "headerpayload");
});

test("SDK error stream is bounded and preserves safe error code/status only", settings, async t => {
  const f = await fixture(t, (request, response) => {
    response.writeHead(412, { "x-tos-request-id": "local-test", "content-type": "application/json" });
    response.end(request.url!.includes("large") ? "x".repeat(70_000) : JSON.stringify({ Code: "PreconditionFailed", Message: "not echoed" }));
  });
  await assert.rejects(f.sdk.operate({}, [200], () => f.sdk.putObject({ bucket: "probe-bucket", key: "id", body: Buffer.alloc(0) })),
    { code: "PreconditionFailed", status: 412, requestId: "local-test" });
  await assert.rejects(f.sdk.operate({}, [200], () => f.sdk.getObjectV2({ bucket: "probe-bucket", key: "large" })), { code: "RESPONSE_TOO_LARGE" });
});

test("only abort closes returned Payload and connection before fallback cleanup", settings, async t => {
  const closed = gate();
  const f = await fixture(t, (_request, response) => {
    response.on("close", closed.resolve); response.setHeader("etag", '"payload"'); response.write(Buffer.alloc(1024));
  });
  const controller = f.controller();
  const out = await f.sdk.operate({ signal: controller.signal }, [200], () => f.sdk.getObjectV2({ bucket: "probe-bucket", key: "id" }),
    { responseStream: value => value.data.content as Readable });
  const stream = f.track(out.data.content as Readable);
  await new Promise<void>(resolve => stream.once("data", () => resolve()));
  const streamClosed = new Promise<void>(resolve => stream.once("close", () => resolve()));
  controller.abort();
  await Promise.all([closed.promise, streamClosed]);
  assert.equal(stream.destroyed, true);
});

for (const status of [200, 403]) for (const cancel of ["signal", "deadline"] as const) {
  test(`SDK ${status === 200 ? "LIST JSON" : "error body"} reading honours ${cancel} and isolates its peer`, settings, async t => {
    const first = gate(), closed = gate(), peerStarted = gate(); let requested = 0, peerClosed = false;
    const f = await fixture(t, (request, response) => {
      requested++;
      if (request.url!.includes("peer")) {
        response.on("close", () => { peerClosed = true; });
        response.setHeader("etag", '\"peer\"'); response.write("pe"); peerStarted.resolve();
        void peerGate.promise.then(() => response.end("er")); return;
      }
      response.on("close", closed.resolve);
      response.writeHead(status, { "content-type": "application/json", "x-tos-request-id": "local-body" });
      response.write(status === 200 ? '{"Name":"probe-bucket",' : '{"Code":"AccessDenied",');
      first.resolve(); // Remaining body deliberately never finishes before cancellation.
    });
    const controller = f.controller();
    const peerGate = f.gate();
    if (cancel === "deadline") t.mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const action = status === 200
        ? () => f.sdk.listObjectsType2({ bucket: "probe-bucket", maxKeys: 1, listOnlyOnce: true })
        : () => f.sdk.getObjectV2({ bucket: "probe-bucket", key: "denied" });
      const operation = f.sdk.operate({ signal: controller.signal }, [200], action, { timeoutMs: 120_000 });
      const rejected = assert.rejects(operation, { code: cancel === "signal" ? "ABORTED" : "TOS_DEADLINE" });
      const peer = await f.sdk.operate({}, [200], () => f.sdk.getObjectV2({ bucket: "probe-bucket", key: "peer" }),
        { responseStream: value => value.data.content as Readable, timeoutMs: 240_000 });
      const peerBody = readBounded(f.track(peer.data.content as Readable), 10);
      await Promise.all([first.promise, peerStarted.promise]);
      if (cancel === "signal") controller.abort(); else t.mock.timers.tick(120_000);
      await rejected;
      await closed.promise;
      assert.equal(peerClosed, false, "Cancelling A must leave the in-flight B response open");
      peerGate.resolve();
      assert.equal((await peerBody).toString(), "peer");
      assert.equal(requested, 2);
    } finally { if (cancel === "deadline") t.mock.timers.reset(); }
  });
}

test("production object client sends only one conditional PUT and owns the complete Payload stream", settings, async t => {
  const { bindTosClient } = await import("../src/data/extensions/tos-datastore/client.js");
  const { TosDataStore } = await import("../src/data/extensions/tos-datastore/store.js");
  const { bytesContent } = await import("../src/data/extensions/shared/payload.js");
  const methods: string[] = [];
  const f = await fixture(t, (request, response) => {
    methods.push(request.method!); const chunks: Buffer[] = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      assert.equal(request.headers["if-match"], '"old:etag"');
      const bytes = Buffer.concat(chunks); assert.equal(bytes.subarray(10).toString(), "original"); assert.equal(bytes.readUInt32BE(6), 43);
      response.writeHead(200, { etag: '"new"' }); response.end();
    });
  });
  const store = new TosDataStore("store", "file.json", { region: "cn-beijing", endpoint: "tos-cn-beijing.volces.com", bucket: "probe-bucket", prefix: "test/", mode: "revision", credentials: { source: "settings", id: "test" } }, bindTosClient(f.sdk, "probe-bucket"));
  await store.update({}, { id: "item", model: "file.json", payload: { contentType: "text/plain", content: bytesContent(Buffer.from("original")) } }, { expectedRevision: '0000002a:"old:etag"' });
  assert.deepEqual(methods, ["PUT"]);
});

async function assertEarlyResponse(t: TestContext, status: number, waitForEof = true) {
  const { createTosUploadBody } = await import("../src/data/extensions/tos-datastore/store.js");
  const started = gate(), cancelled = gate(), handled = gate();
  const f = await fixture(t, (request, response) => { request.once("data", () => {
    response.writeHead(status); response.end(status === 412 ? JSON.stringify({ Code: "PreconditionFailed" }) : status === 403 ? JSON.stringify({ Code: "AccessDenied" }) : "");
  }); });
  let supplied = false;
  const data = { id: "item", model: "file.json", payload: { contentType: "text/plain", content: { stream: () => new ReadableStream<Uint8Array>({
    pull(output) { if (!supplied) { supplied = true; output.enqueue(Buffer.from("first")); started.resolve(); return; } return new Promise<void>(() => undefined); },
    cancel() { cancelled.resolve(); }
  }) } } };
  const body = f.track(createTosUploadBody({}, data));
  const controller = f.controller();
  let fulfilled = false;
  const writing = f.sdk.operate({ signal: controller.signal }, [200], async () => {
    try { return await f.sdk.putObject({ bucket: "probe-bucket", key: "item", body }); }
    finally { handled.resolve(); } // Actual SDK response processing, not server response.end.
  }, waitForEof ? { body } : {}).then(() => { fulfilled = true; });
  const observed = writing.catch(error => error);
  try {
    await Promise.all([started.promise, handled.promise]);
    // Cross an event-loop turn after SDK resolution so all result microtasks have run.
    await new Promise<void>(resolve => setImmediate(resolve));
    if (status === 200) {
      assert.equal(fulfilled, false, "A processed 200 cannot acknowledge a source without EOF");
      controller.abort(); assert.equal((await observed).code, "ABORTED");
    } else assert.equal((await observed).code, status === 412 ? "PreconditionFailed" : "AccessDenied");
    await cancelled.promise;
    assert.equal(body.destroyed, true); assert.equal(fulfilled, false);
  } finally { controller.abort(); body.destroy(); await observed; }
}
for (const status of [200, 403, 412]) test(`processed early ${status} cannot acknowledge a stalled Payload and closes its upstream`, settings, t => assertEarlyResponse(t,status));
test("early-response oracle detects removing the normal-EOF wait", settings, async t => {
  await assert.rejects(assertEarlyResponse(t, 200, false), /processed 200 cannot acknowledge/);
});

test("upload byte limit fails without acknowledging a partial source or retaining its stream", settings, async t => {
  const { createTosUploadBody } = await import("../src/data/extensions/tos-datastore/store.js");
  let cancelled = false;
  const f = await fixture(t, (request, response) => { request.resume(); request.once("end", () => response.end()); });
  const body = f.track(createTosUploadBody({}, { id: "item", model: "file.json", payload: { contentType: "text/plain", content: { stream: () => new ReadableStream<Uint8Array>({ pull(output) { output.enqueue(Buffer.alloc(16)); }, cancel() { cancelled = true; } }) } } }, Buffer.alloc(10), 20));
  await assert.rejects(f.sdk.operate({}, [200], () => f.sdk.putObject({ bucket: "probe-bucket", key: "item", body }), { body }), { code: "PAYLOAD_TOO_LARGE" });
  assert.equal(cancelled, true);
  assert.equal(body.destroyed, true);
});

test("full SDK request debug logging blocks transmission without changing other debug namespaces", settings, async t => {
  const { createRequire } = await import("node:module");
  const debug = createRequire(import.meta.url)("debug");
  const enabled = debug.enabled;
  t.mock.method(debug, "enabled", (namespace: string) => namespace === "TOS" ? true : enabled(namespace));
  const f = await fixture(t, () => assert.fail("Debug gate must run before any request"));
  let called = false;
  await assert.rejects(f.sdk.operate({}, [200], async () => { called = true; return undefined; }), { code: "TOS_DEBUG_LOGGING_FORBIDDEN" });
  assert.equal(called, false);
});

test("a failed Payload source cannot become a successful SDK upload or leak its error text", settings, async t => {
  const { createTosUploadBody } = await import("../src/data/extensions/tos-datastore/store.js");
  const f = await fixture(t, (request, response) => { request.resume(); request.once("end", () => response.end()); });
  const body = f.track(createTosUploadBody({}, { id: "item", model: "file.json", payload: { contentType: "text/plain", content: { stream: () => new ReadableStream<Uint8Array>({ pull() { throw Error("sensitive producer error"); } }) } } }));
  await assert.rejects(f.sdk.operate({}, [200], () => f.sdk.putObject({ bucket: "probe-bucket", key: "item", body }), { body }), error => {
    assert.equal((error as { code: string }).code, "PAYLOAD_READ_ERROR");
    assert.ok(!String(error).includes("sensitive")); return true;
  });
});

test("native SDK requests reach their endpoint despite inherited automatic proxy variables", settings, async t => {
  const f = await fixture(t, (_request, response) => { response.setHeader("etag", '"direct"'); response.end("direct"); });
  const names = ["http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "no_proxy", "NO_PROXY"];
  const previous = new Map(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) process.env[name] = name.toLowerCase() === "no_proxy" ? "" : "http://127.0.0.1:1";
    const response = await f.sdk.operate({}, [200], () => f.sdk.getObjectV2({ bucket: "probe-bucket", key: "item" }), { responseStream: value => value.data.content as Readable });
    assert.equal((await readBounded(response.data.content as Readable, 32)).toString(), "direct");
  } finally {
    for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});

test("object client omits absent LIST options before SDK signing and passes actual continuation tokens", settings, async t => {
  const { bindTosClient } = await import("../src/data/extensions/tos-datastore/client.js");
  const queries: string[] = [];
  const f = await fixture(t, (request, response) => { queries.push(request.url!); response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ Contents: [], IsTruncated: false })); });
  const original = f.sdk.listObjectsType2;
  const inputs: object[] = [];
  t.mock.method(f.sdk, "listObjectsType2", function (input: Parameters<typeof original>[0]) {
    inputs.push(input!);
    assert.ok(Object.values(input!).every(value => value !== undefined), "Undefined options are signed by the SDK but omitted on the wire");
    return original.call(f.sdk, input);
  });
  const client = bindTosClient(f.sdk, "probe-bucket");
  await client.list({}, { prefix: "test/", limit: 1 });
  await client.list({}, { prefix: "test/", limit: 1, token: "next:+/=% token" });
  assert.equal(Object.hasOwn(inputs[0], "continuationToken"), false);
  assert.equal(new URL(queries[1], "http://localhost").searchParams.get("continuation-token"), "next:+/=% token");
});

test("official SDK signs optional STS credentials and reports expiry without echoing the token", settings, async t => {
  const token = "fixture-sts-token";
  const f = await fixture(t, (request, response) => {
    assert.equal(request.headers["x-tos-security-token"], token);
    if (request.url!.includes("expired")) { response.writeHead(403, { "content-type": "application/json" }); response.end(JSON.stringify({ Code: "ExpiredToken", Message: token })); }
    else response.end("signed");
  }, { stsToken: token });
  const result = await f.sdk.operate({}, [200], () => f.sdk.getObjectV2({ bucket: "probe-bucket", key: "live" }), { responseStream: value => value.data.content as Readable });
  assert.equal((await readBounded(result.data.content as Readable, 32)).toString(), "signed");
  await assert.rejects(f.sdk.operate({}, [200], () => f.sdk.getObjectV2({ bucket: "probe-bucket", key: "expired" })), error => {
    assert.equal((error as { code: string }).code, "ExpiredToken"); assert.ok(!String(error).includes(token)); return true;
  });
});

for (const scenario of [
  { operation: "create", first: 0 }, { operation: "create", first: 1 },
  { operation: "update", first: 0 }, { operation: "update", first: 1 },
  { operation: "update", first: 0, ignoreConditions: true }
] as const) test(`controlled SDK ${scenario.operation} first=${scenario.first}${"ignoreConditions" in scenario ? " detects server ignoring conditions" : " preserves original conditions"}`, settings, async t => {
  const { bindTosClient } = await import("../src/data/extensions/tos-datastore/client.js");
  const { TosDataStore } = await import("../src/data/extensions/tos-datastore/store.js");
  const { bytesContent } = await import("../src/data/extensions/shared/payload.js");
  const { controlledPutPair } = await import("./support/tos-cas-barrier.js");
  let body: Buffer | undefined = scenario.operation === "update" ? Buffer.from("old") : undefined;
  let etag = '"original"', commits = 0;
  const methods: string[] = [];
  const f = await fixture(t, (request, response) => {
    methods.push(request.method!); const chunks: Buffer[] = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      const conflict = scenario.operation === "create" ? request.headers["if-none-match"] !== "*" || body !== undefined : request.headers["if-match"] !== etag;
      if (conflict && !("ignoreConditions" in scenario)) { response.writeHead(412, { "content-type": "application/json" }); response.end(JSON.stringify({ Code: "PreconditionFailed" })); return; }
      body = Buffer.concat(chunks); etag = `"committed-${++commits}"`;
      response.writeHead(200, { etag }); response.end();
    });
  });
  const client = bindTosClient(f.sdk, "probe-bucket");
  const config = { region: "cn-beijing", endpoint: "tos-cn-beijing.volces.com", bucket: "probe-bucket", prefix: "test/", mode: scenario.operation === "create" ? "raw" as const : "revision" as const, credentials: { source: "settings" as const, id: "test" } };
  const run = () => controlledPutPair({ client, key: "test/item", first: scenario.first,
    condition: scenario.operation === "create" ? { create: true } : { ifMatch: '"original"' },
    conflictCode: scenario.operation === "create" ? "ALREADY_EXISTS" : "REVISION_CONFLICT",
    write: (gated, context, index) => {
      const store = new TosDataStore("store", "file.json", config, gated);
      const data = { id: "item", model: "file.json", payload: { contentType: "text/plain", content: bytesContent(Buffer.from(`writer-${index}`)) } };
      return scenario.operation === "create" ? store.create(context, data) : store.update(context, data, { expectedRevision: '00000001:"original"' });
    } });
  if ("ignoreConditions" in scenario) { await assert.rejects(run(), /Exactly one conditional writer may commit/); assert.equal(commits, 2); }
  else {
    await run(); assert.equal(commits, 1);
    assert.equal(body!.subarray(scenario.operation === "update" ? 10 : 0).toString(), `writer-${scenario.first}`);
  }
  assert.deepEqual(methods, ["PUT", "PUT"]);
});

test("deadline after the server commits reports uncertainty without retrying or deleting the object", settings, async t => {
  const committed = gate(), closed = gate();
  let stored: Buffer | undefined;
  const methods: string[] = [];
  const f = await fixture(t, (request, response) => {
    methods.push(request.method!); const chunks: Buffer[] = [];
    response.on("close", closed.resolve);
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => { stored = Buffer.concat(chunks); committed.resolve(); /* Withhold acknowledgment. */ });
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const body = f.track(Readable.from([Buffer.from("committed")]));
  const writing = f.sdk.operate({}, [200], () => f.sdk.putObject({ bucket: "probe-bucket", key: "item", body }), { body, timeoutMs: 5000 });
  const result = writing.catch(error => error);
  await committed.promise;
  t.mock.timers.tick(5001);
  assert.equal((await result).code, "TOS_DEADLINE");
  await closed.promise;
  assert.equal(stored!.toString(), "committed");
  assert.deepEqual(methods, ["PUT"]);
});

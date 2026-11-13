// @integration-platform: native — verifies the official SDK over real local HTTP sockets.
import assert from "node:assert/strict";
import http from "node:http";
import type { Socket } from "node:net";
import test, { type TestContext } from "node:test";
import { Readable } from "node:stream";
import { ContextTosSdk, readBounded } from "../src/data/extensions/tos-datastore/context-sdk.js";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(t: TestContext, handle: http.RequestListener, credentials: { stsToken?: string } = {}) {
  const sockets = new Set<Socket>();
  const server = http.createServer(handle);
  const controllers: AbortController[] = [];
  const streams: Readable[] = [];
  const gates: ReturnType<typeof gate>[] = [];
  server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const controller of controllers) controller.abort();
    for (const value of gates) value.resolve();
    for (const stream of streams) stream.destroy();
    const closing = [...sockets].map(socket => new Promise<void>(resolve => socket.once("close", () => resolve())));
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    await Promise.all(closing);
    assert.equal(sockets.size, 0);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const sdk = new ContextTosSdk({ ...credentials, accessKeyId: "fake-ak", accessKeySecret: "fake-sk", region: "cn-beijing",
    endpoint: `127.0.0.1:${address.port}`, secure: false, maxRetryCount: 0, requestTimeout: 5000, connectionTimeout: 5000 });
  return {
    sdk,
    gate() { const value = gate(); gates.push(value); return value; },
    controller() { const value = new AbortController(); controllers.push(value); return value; },
    track(stream: Readable) { streams.push(stream); stream.on("error", () => undefined); return stream; }
  };
}

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
    const first = gate(), closed = gate(); let requested = 0;
    const f = await fixture(t, (request, response) => {
      requested++;
      if (request.url!.includes("peer")) {
        response.setHeader("etag", '"peer"'); response.end("peer"); return;
      }
      response.on("close", closed.resolve);
      response.writeHead(status, { "content-type": "application/json", "x-tos-request-id": "local-body" });
      response.write(status === 200 ? '{"Name":"probe-bucket",' : '{"Code":"AccessDenied",');
      first.resolve(); // Remaining body deliberately never finishes before cancellation.
    });
    const controller = f.controller();
    if (cancel === "deadline") t.mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const action = status === 200
        ? () => f.sdk.listObjectsType2({ bucket: "probe-bucket", maxKeys: 1, listOnlyOnce: true })
        : () => f.sdk.getObjectV2({ bucket: "probe-bucket", key: "denied" });
      const operation = f.sdk.operate({ signal: controller.signal }, [200], action, { timeoutMs: 120_000 });
      const rejected = assert.rejects(operation, { code: cancel === "signal" ? "ABORTED" : "TOS_DEADLINE" });
      await first.promise;
      if (cancel === "signal") controller.abort(); else t.mock.timers.tick(120_000);
      await rejected;
      await closed.promise;
      const peer = await f.sdk.operate({}, [200], () => f.sdk.getObjectV2({ bucket: "probe-bucket", key: "peer" }),
        { responseStream: value => value.data.content as Readable });
      assert.equal((await readBounded(f.track(peer.data.content as Readable), 10)).toString(), "peer");
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

for (const status of [200, 412]) test(`early ${status} response cannot acknowledge a stalled Payload and closes its upstream`, settings, async t => {
  const { createTosUploadBody } = await import("../src/data/extensions/tos-datastore/store.js");
  const started = gate(), cancelled = gate(), replied = gate();
  const f = await fixture(t, (_request, response) => { response.writeHead(status); response.end(status === 412 ? JSON.stringify({ Code: "PreconditionFailed" }) : ""); replied.resolve(); });
  const data = { id: "item", model: "file.json", payload: { contentType: "text/plain", content: { stream: () => new ReadableStream<Uint8Array>({ pull() { started.resolve(); return new Promise<void>(() => undefined); }, cancel() { cancelled.resolve(); } }) } } };
  const body = f.track(createTosUploadBody({}, data, Buffer.from("header")));
  const controller = f.controller();
  let fulfilled = false;
  const writing = f.sdk.operate({ signal: controller.signal }, [200], () => f.sdk.putObject({ bucket: "probe-bucket", key: "item", body }), { body }).then(() => { fulfilled = true; });
  const observed = writing.catch(error => error);
  await Promise.all([started.promise, replied.promise]);
  if (status === 200) {
    assert.equal(fulfilled, false);
    controller.abort();
    assert.equal((await observed).code, "ABORTED");
  } else assert.equal((await observed).code, "PreconditionFailed");
  await cancelled.promise;
  assert.equal(body.destroyed, true);
  assert.equal(fulfilled, false);
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

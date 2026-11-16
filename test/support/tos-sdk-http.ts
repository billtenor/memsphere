import assert from "node:assert/strict";
import http from "node:http";
import type { Socket } from "node:net";
import type { TestContext } from "node:test";
import { Readable } from "node:stream";
import { ContextTosSdk } from "../../src/data/extensions/tos-datastore/context-sdk.js";

export function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

export async function fixture(t: TestContext, handle: http.RequestListener, credentials: { stsToken?: string } = {}) {
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


/** Observe actual client consumption without completing or replacing the body. */
export function responseChunk(t: TestContext, requestId: string) {
  const consumed = gate(), read = http.IncomingMessage.prototype.read;
  t.mock.method(http.IncomingMessage.prototype, "read", function(this: http.IncomingMessage, ...args: Parameters<typeof read>) {
    const chunk = read.apply(this,args);
    if (this.headers["x-tos-request-id"] === requestId && chunk?.length) consumed.resolve();
    return chunk;
  });
  return consumed.promise;
}

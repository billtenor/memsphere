import type { ClientRequest, IncomingMessage, Server, ServerResponse } from "node:http";

import { waitForTestState as waitForHttpState } from "./test-state.js";
export { waitForTestState as waitForHttpState } from "./test-state.js";

/** Own real client connections and the real asynchronous View request handlers. */
export function ownHttpTestServer(server: Server) {
  type Handler = (request: IncomingMessage, response: ServerResponse) => unknown;
  const handlers = server.listeners("request") as Handler[];
  if (handlers.length !== 1) throw new Error("Expected one View request handler");
  const handler = handlers[0]!;
  server.removeListener("request", handler);
  const running = new Set<Promise<unknown>>();
  const failures: unknown[] = [];
  server.on("request", (request, response) => {
    const operation = Promise.resolve().then(() => handler.call(server, request, response));
    running.add(operation);
    void operation.then(() => { running.delete(operation); }, error => { running.delete(operation); failures.push(error); });
  });
  const requests = new Map<ClientRequest, Promise<void>>();
  let closing: Promise<void> | undefined;
  return {
    own(request: ClientRequest) {
      requests.set(request, new Promise<void>(resolve => request.once("close", () => { requests.delete(request); resolve(); })));
      return request;
    },
    get activeHandlers() { return running.size; },
    get activeRequests() { return requests.size; },
    close() {
      return closing ??= (async () => {
        const clients = [...requests.values()];
        for (const request of requests.keys()) request.destroy();
        const stopped = new Promise<void>((resolve, reject) => server.close(error => {
          if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") reject(error); else resolve();
        }));
        server.closeAllConnections();
        // Cleanup must work even when the owning TestContext is already aborted.
        await waitForHttpState(Promise.all([stopped, ...clients]), "HTTP connections to close");
        await waitForHttpState(Promise.allSettled([...running]), "View handlers to finish");
        if (failures.length) throw new AggregateError(failures, "View request handler failed");
      })();
    }
  };
}

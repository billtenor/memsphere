import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { relative } from "node:path";
import { readConfig } from "../config.js";
import { readAllMemoryFiles } from "../memory/store.js";
import { browserHtml } from "../view/browser.js";

type ViewOptions = {
  host?: string;
  port?: string;
};

type MemoryPayload = {
  memoryRoot: string;
  memories: Array<{
    id: string;
    kind: string;
    path: string;
    entity: unknown;
  }>;
};

export async function viewCommand(options: ViewOptions): Promise<void> {
  const host = options.host ?? "127.0.0.1";
  const port = parsePort(options.port);
  const config = await readConfig();

  const server = createServer(async (request, response) => {
    try {
      await handleRequest(request, response, config.memoryRoot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 500, { error: message });
    }
  });

  server.on("error", (error) => {
    console.error(`error: failed to start view server: ${error.message}`);
    process.exitCode = 1;
  });

  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    console.log(`vibe-mem view running at http://${host}:${actualPort}`);
    console.log(`memoryRoot: ${config.memoryRoot}`);
    console.log("Press Ctrl+C to stop.");
  });
}

function parsePort(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid port: ${value}`);
  }

  return port;
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, memoryRoot: string): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method !== "GET") {
    sendText(response, 405, "Method Not Allowed");
    return;
  }

  if (url.pathname === "/") {
    sendHtml(response, browserHtml);
    return;
  }

  if (url.pathname === "/api/memories") {
    const payload = await loadMemoryPayload(memoryRoot);
    sendJson(response, 200, payload);
    return;
  }

  sendText(response, 404, "Not Found");
}

async function loadMemoryPayload(memoryRoot: string): Promise<MemoryPayload> {
  const files = await readAllMemoryFiles(memoryRoot);

  return {
    memoryRoot,
    memories: files.map((file) => {
      const primaryName = Array.isArray(file.entity.names) ? file.entity.names[0] : file.path;
      return {
        id: `${file.kind}/${primaryName}`,
        kind: file.kind,
        path: relative(memoryRoot, file.path),
        entity: file.entity
      };
    })
  };
}

function sendHtml(response: ServerResponse, body: string): void {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body, null, 2));
}

function sendText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
}

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { relative } from "node:path";
import { type VibeMemConfig, readConfig } from "../config.js";
import { readAllMemoryFiles } from "../memory/store.js";
import {
  createReview,
  getReview,
  listReviews,
  reviewStatuses,
  updateReview,
  type ReviewComment,
  type ReviewStatus
} from "../review/store.js";
import { listRuns, readRun } from "../run/store.js";
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
      await handleRequest(request, response, config);
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
    console.log(`reviewsRoot: ${config.reviewsRoot}`);
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

async function handleRequest(request: IncomingMessage, response: ServerResponse, config: VibeMemConfig): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const { memoryRoot, reviewsRoot, runsRoot } = config;

  if (request.method === "GET" && url.pathname === "/") {
    sendHtml(response, browserHtml);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/memories") {
    const payload = await loadMemoryPayload(memoryRoot);
    sendJson(response, 200, payload);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/reviews") {
    sendJson(response, 200, { reviews: await listReviews(reviewsRoot) });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/runs") {
    sendJson(response, 200, { runs: await listRuns(runsRoot) });
    return;
  }

  const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (request.method === "GET" && runMatch) {
    const run = await readRun(runsRoot, decodeURIComponent(runMatch[1]));
    sendJson(response, 200, { run });
    return;
  }

  const reviewMatch = url.pathname.match(/^\/api\/reviews\/([^/]+)$/);
  if (request.method === "GET" && reviewMatch) {
    const review = await getReview(reviewsRoot, decodeURIComponent(reviewMatch[1]));
    if (!review) {
      sendJson(response, 404, { error: "review not found" });
      return;
    }
    sendJson(response, 200, { review });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/reviews") {
    const body = await readJsonBody<{ title?: unknown }>(request);
    const title = typeof body.title === "string" ? body.title : undefined;
    const review = await createReview({ title, memoryRoot, reviewsRoot });
    sendJson(response, 201, { review });
    return;
  }

  if (request.method === "PATCH" && reviewMatch) {
    const body = await readJsonBody<{ title?: unknown; status?: unknown; comments?: unknown }>(request);
    const status = normalizeReviewStatus(body.status);
    const comments = body.comments === undefined ? undefined : normalizeReviewComments(body.comments);
    const review = await updateReview(reviewsRoot, decodeURIComponent(reviewMatch[1]), {
      title: typeof body.title === "string" ? body.title : undefined,
      status,
      comments
    });
    if (!review) {
      sendJson(response, 404, { error: "review not found" });
      return;
    }
    sendJson(response, 200, { review });
    return;
  }

  if (!["GET", "POST", "PATCH"].includes(request.method ?? "")) {
    sendText(response, 405, "Method Not Allowed");
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

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > 512 * 1024) {
      throw new Error("request body is too large");
    }
    chunks.push(buffer);
  }

  if (!chunks.length) {
    return {} as T;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function normalizeReviewStatus(value: unknown): ReviewStatus | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && reviewStatuses.includes(value as ReviewStatus)) {
    return value as ReviewStatus;
  }
  throw new Error("invalid review status");
}

function normalizeReviewComments(value: unknown): ReviewComment[] {
  if (!Array.isArray(value)) {
    throw new Error("comments must be an array");
  }

  return value.map((comment, index) => {
    if (!comment || typeof comment !== "object") {
      throw new Error(`comments[${index}] must be an object`);
    }

    const record = comment as Record<string, unknown>;
    const body = typeof record.body === "string" ? record.body.trim() : "";
    const memoryId = typeof record.memoryId === "string" ? record.memoryId : "";
    const memoryName = typeof record.memoryName === "string" ? record.memoryName : "";
    const kind = typeof record.kind === "string" ? record.kind : "";
    const createdAt = typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString();

    if (!body) {
      throw new Error(`comments[${index}].body is required`);
    }
    if (!memoryId || !memoryName || !kind) {
      throw new Error(`comments[${index}] must include memoryId, memoryName, and kind`);
    }

    return {
      id: typeof record.id === "string" ? record.id : `${Date.now()}-${index}`,
      memoryId,
      memoryName,
      kind,
      target: typeof record.target === "string" ? record.target : undefined,
      location: normalizeCommentLocation(record.location),
      snapshot: typeof record.snapshot === "string" ? record.snapshot : undefined,
      body,
      createdAt
    };
  });
}

function normalizeCommentLocation(value: unknown): ReviewComment["location"] {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.anchor !== "string" || !record.anchor) return undefined;
  const line = Number(record.line);
  if (!Number.isInteger(line) || line < 1) return undefined;
  return {
    anchor: record.anchor,
    line,
    hash: typeof record.hash === "string" ? record.hash : undefined
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

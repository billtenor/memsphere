import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { access, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import MarkdownIt from "markdown-it";
import { ZodError, type ZodIssue } from "zod";
import { archiveReview, archiveRootForScope, archiveRun } from "../archive/store.js";
import { type MemsphereConfig, readConfig } from "../config.js";
import { listMemoryFiles, readMemoryFile } from "../memory/store.js";
import { memoryKinds, type MemoryKind } from "../memory/kinds.js";
import { parseMemoryYaml } from "../memory/yaml.js";
import {
  createReview,
  getReview,
  listReviews,
  readReviewSnapshot,
  reviewStatuses,
  updateReview,
  deleteReview,
  type ReviewComment,
  type ReviewStatus
} from "../review/store.js";
import { listRuns, readRun, type RunState } from "../run/store.js";
import { browserHtml } from "../view/browser.js";

const markdown = createMarkdownRenderer();

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
    entity?: unknown;
    error?: MemoryLoadError;
  }>;
};

type MemoryLoadError = {
  message: string;
  issues: string[];
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
    console.log(`memsphere view running at http://${host}:${actualPort}`);
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

async function handleRequest(request: IncomingMessage, response: ServerResponse, config: MemsphereConfig): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const { memoryRoot, reviewsRoot, runsRoot } = config;
  const archiveRoot = archiveRootForScope(config.scopeRoot);

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
    sendJson(response, 200, { runs: await loadRunPayload(runsRoot) });
    return;
  }

  const reviewSnapshotMatch = url.pathname.match(/^\/api\/reviews\/([^/]+)\/snapshot$/);
  if (request.method === "GET" && reviewSnapshotMatch) {
    const id = decodeURIComponent(reviewSnapshotMatch[1]);
    const kind = url.searchParams.get("kind") === "task" ? "task" : url.searchParams.get("kind") === "memory" ? "memory" : undefined;
    const snapshot = await readReviewSnapshot(reviewsRoot, id, kind);
    if (!snapshot) {
      sendJson(response, 404, { error: "snapshot not found" });
      return;
    }
    sendJson(response, 200, snapshotPayload(snapshot));
    return;
  }

  const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (request.method === "GET" && runMatch) {
    const run = await readRun(runsRoot, decodeURIComponent(runMatch[1]));
    sendJson(response, 200, { run: await hydrateRunArtifactContent(runsRoot, run) });
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
    const body = await readJsonBody<{ title?: unknown; source?: unknown; memoryId?: unknown; memoryName?: unknown; memoryPath?: unknown; runId?: unknown; runName?: unknown }>(request);
    const title = typeof body.title === "string" ? body.title : undefined;
    const source = body.source === "task" ? "task" : "memory";
    const memoryId = typeof body.memoryId === "string" ? body.memoryId : undefined;
    const memoryName = typeof body.memoryName === "string" ? body.memoryName : undefined;
    const memoryPath = typeof body.memoryPath === "string" ? body.memoryPath : undefined;
    const runId = typeof body.runId === "string" ? body.runId : undefined;
    const runName = typeof body.runName === "string" ? body.runName : undefined;
    const snapshotFiles = await resolveReviewSnapshotFiles({
      memoryRoot,
      runsRoot,
      source,
      memoryId,
      memoryPath,
      runId
    });
    const review = await createReview({
      title,
      source,
      target: source === "task"
        ? { source, id: runId ? `task/${runId}` : "", runId, name: runName }
        : { source, id: memoryId ?? "", path: memoryPath, name: memoryName },
      memoryRoot,
      reviewsRoot,
      snapshotFiles
    });
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

  if (request.method === "DELETE" && reviewMatch) {
    const deleted = await deleteReview(reviewsRoot, decodeURIComponent(reviewMatch[1]));
    if (!deleted) {
      sendJson(response, 404, { error: "review not found" });
      return;
    }
    sendJson(response, 200, { deleted: true });
    return;
  }

  const archiveReviewMatch = url.pathname.match(/^\/api\/archive\/reviews\/([^/]+)$/);
  if (request.method === "POST" && archiveReviewMatch) {
    const entry = await archiveReview({
      archiveRoot,
      reviewsRoot,
      id: decodeURIComponent(archiveReviewMatch[1])
    });
    sendJson(response, 200, { archived: entry });
    return;
  }

  const archiveRunMatch = url.pathname.match(/^\/api\/archive\/runs\/([^/]+)$/);
  if (request.method === "POST" && archiveRunMatch) {
    const entry = await archiveRun({
      archiveRoot,
      runsRoot,
      id: decodeURIComponent(archiveRunMatch[1])
    });
    sendJson(response, 200, { archived: entry });
    return;
  }

  if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method ?? "")) {
    sendText(response, 405, "Method Not Allowed");
    return;
  }

  sendText(response, 404, "Not Found");
}

function snapshotPayload(input: { snapshot: { label: string; path: string; kind: "memory" | "task"; createdAt: string }; content: string }): unknown {
  if (input.snapshot.kind === "task") {
    return {
      snapshot: input.snapshot,
      run: JSON.parse(input.content)
    };
  }

  const entity = parseMemoryYaml(input.content);
  const kind = memoryKindFromSnapshot(input.snapshot.label, entity);
  const primaryName = entity && typeof entity === "object" && Array.isArray((entity as { names?: unknown }).names)
    ? ((entity as { names: string[] }).names[0] ?? input.snapshot.label)
    : input.snapshot.label;
  return {
    snapshot: input.snapshot,
    memory: {
      id: `${kind}/${primaryName}`,
      kind,
      path: input.snapshot.label,
      entity
    }
  };
}

function memoryKindFromSnapshot(label: string, entity: unknown): string {
  const fromLabel = label.split(/[\\/]/)[0];
  if (["procedures", "schemas", "concepts", "statements"].includes(fromLabel)) return fromLabel;
  const tag = entity && typeof entity === "object" ? (entity as { tag?: unknown }).tag : undefined;
  if (tag === "!procedure") return "procedures";
  if (tag === "!schema") return "schemas";
  if (tag === "!concept") return "concepts";
  if (tag === "!statement") return "statements";
  return "memories";
}

async function resolveReviewSnapshotFiles(input: {
  memoryRoot: string;
  runsRoot: string;
  source: "memory" | "task";
  memoryId?: string;
  memoryPath?: string;
  runId?: string;
}): Promise<Array<{ label: string; path: string; kind: "memory" | "task" }>> {
  if (input.source === "task") {
    if (!input.runId) return [];
    return [{
      label: `${input.runId}.json`,
      path: await resolveRunSnapshotPath(input.runsRoot, input.runId),
      kind: "task"
    }];
  }

  if (!input.memoryId) return [];

  if (input.memoryPath) {
    const path = resolveMemoryPath(input.memoryRoot, input.memoryPath);
    return [{
      label: relative(input.memoryRoot, path),
      path,
      kind: "memory"
    }];
  }

  const file = await findMemoryFileById(input.memoryRoot, input.memoryId);
  if (!file) return [];
  return [{
    label: relative(input.memoryRoot, file.path),
    path: file.path,
    kind: "memory"
  }];
}

async function resolveRunSnapshotPath(runsRoot: string, runId: string): Promise<string> {
  const current = join(runsRoot, runId, `${runId}.json`);
  try {
    await access(current);
    return current;
  } catch {
    return join(runsRoot, `${runId}.json`);
  }
}

function resolveMemoryPath(memoryRoot: string, memoryPath: string): string {
  const root = resolve(memoryRoot);
  const path = resolve(root, memoryPath);
  if (path !== root && !path.startsWith(root + sep)) {
    throw new Error(`invalid memory path: ${memoryPath}`);
  }
  return path;
}

async function findMemoryFileById(memoryRoot: string, memoryId: string): Promise<{ kind: MemoryKind; path: string } | undefined> {
  for (const kind of memoryKinds) {
    const paths = await listMemoryFiles(memoryRoot, kind);
    for (const path of paths) {
      try {
        const file = await readMemoryFile(kind, path);
        const primaryName = Array.isArray(file.entity.names) ? file.entity.names[0] : file.path;
        if (`${file.kind}/${primaryName}` === memoryId) {
          return { kind: file.kind, path: file.path };
        }
      } catch {
        // Invalid memories should not block creating a review for another file.
      }
    }
  }
  return undefined;
}

async function loadMemoryPayload(memoryRoot: string): Promise<MemoryPayload> {
  const memories: MemoryPayload["memories"] = [];

  for (const kind of memoryKinds) {
    const paths = await listMemoryFiles(memoryRoot, kind);
    for (const path of paths) {
      memories.push(await loadMemoryListItem(memoryRoot, kind, path));
    }
  }

  return { memoryRoot, memories };
}

async function loadRunPayload(runsRoot: string): Promise<RunState[]> {
  const runs = await listRuns(runsRoot);
  return Promise.all(runs.map((run) => hydrateRunArtifactContent(runsRoot, run)));
}

async function hydrateRunArtifactContent(runsRoot: string, run: RunState): Promise<RunState> {
  const hydrated = JSON.parse(JSON.stringify(run)) as RunState;
  for (const event of hydrated.events) {
    const artifact = event.artifact as RunState["events"][number]["artifact"] & {
      content?: string;
      contentError?: string;
      renderedContent?: string;
      renderedContentType?: string;
    };
    if (artifact.storage === "file" && artifact.path && isTextArtifactFormat(artifact.format)) {
      try {
        artifact.content = await readFile(resolveRunArtifactPath(runsRoot, hydrated.id, artifact.path), "utf8");
      } catch (error) {
        artifact.contentError = error instanceof Error ? error.message : String(error);
      }
    }
    if (artifact.format === "markdown") {
      const value = artifact.content ?? artifact.value;
      if (typeof value === "string") {
        artifact.renderedContent = renderMarkdownContent(value);
        artifact.renderedContentType = "text/html";
      }
    }
  }
  return hydrated;
}

export function renderMarkdownContent(value: string): string {
  try {
    return markdown.render(value).trim();
  } catch {
    return "";
  }
}

function createMarkdownRenderer(): MarkdownIt {
  const renderer = new MarkdownIt({
    html: false,
    linkify: false,
    breaks: true
  });
  renderer.validateLink = (url: string) => /^(https?:|mailto:)/i.test(url.trim());
  const defaultLinkOpen = renderer.renderer.rules.link_open;
  renderer.renderer.rules.link_open = (tokens, index, options, env, self) => {
    tokens[index]?.attrSet("target", "_blank");
    tokens[index]?.attrSet("rel", "noopener noreferrer nofollow");
    return defaultLinkOpen
      ? defaultLinkOpen(tokens, index, options, env, self)
      : self.renderToken(tokens, index, options);
  };
  return renderer;
}

function isTextArtifactFormat(format: string): boolean {
  return ["markdown", "yaml", "json", "schema", "string"].includes(format);
}

function resolveRunArtifactPath(runsRoot: string, runId: string, artifactPath: string): string {
  const artifactRoot = resolve(runsRoot, runId, "artifacts");
  const path = resolve(runsRoot, artifactPath);
  if (path !== artifactRoot && !path.startsWith(artifactRoot + sep)) {
    throw new Error(`invalid artifact path: ${artifactPath}`);
  }
  return path;
}

async function loadMemoryListItem(memoryRoot: string, kind: MemoryKind, path: string): Promise<MemoryPayload["memories"][number]> {
  const relativePath = relative(memoryRoot, path);
  try {
    const file = await readMemoryFile(kind, path);
    const primaryName = Array.isArray(file.entity.names) ? file.entity.names[0] : file.path;
    return {
      id: `${file.kind}/${primaryName}`,
      kind: file.kind,
      path: relativePath,
      entity: file.entity
    };
  } catch (error) {
    return {
      id: `${kind}/${relativePath}`,
      kind,
      path: relativePath,
      error: formatMemoryLoadError(error)
    };
  }
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

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function formatMemoryLoadError(error: unknown): MemoryLoadError {
  if (error instanceof ZodError) {
    const issues = summarizeZodIssues(error.issues);
    return {
      message: "This memory does not match the current memsphere YAML model.",
      issues
    };
  }

  return {
    message: "This memory could not be loaded.",
    issues: [formatError(error)]
  };
}

function summarizeZodIssues(issues: ZodIssue[]): string[] {
  const summary: string[] = [];
  const seen = new Set<string>();

  for (const issue of issues) {
    const text = summarizeZodIssue(issue);
    if (seen.has(text)) continue;
    seen.add(text);
    summary.push(text);
    if (summary.length >= 8) break;
  }

  const omitted = issues.length - summary.length;
  if (omitted > 0) {
    summary.push(`还有 ${omitted} 个类似问题，建议先运行 memsphere validate 查看完整列表。`);
  }

  return summary;
}

function summarizeZodIssue(issue: ZodIssue): string {
  const path = issue.path.join(".") || "(root)";

  if (issue.code === "invalid_union" && issue.path[0] === "flow" && typeof issue.path[1] === "number") {
    return `${path}: 流程步骤不符合当前 DSL。请使用 { action, artifact }，或 !if / !while / !call 结构。`;
  }

  if (issue.code === "invalid_type") {
    return `${path}: 类型不正确，期望 ${issue.expected}，实际 ${issue.received}。`;
  }

  if (issue.code === "unrecognized_keys") {
    return `${path}: 出现了当前模型不认识的字段：${issue.keys.join(", ")}。`;
  }

  return `${path}: ${issue.message}`;
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
    const source = record.source === "task" ? "task" : record.source === "memory" ? "memory" : undefined;

    if (!body) {
      throw new Error(`comments[${index}].body is required`);
    }
    if (!memoryId || !memoryName || !kind) {
      throw new Error(`comments[${index}] must include memoryId, memoryName, and kind`);
    }

    return {
      id: typeof record.id === "string" ? record.id : `${Date.now()}-${index}`,
      source,
      memoryId,
      memoryName,
      kind,
      runId: typeof record.runId === "string" ? record.runId : undefined,
      runName: typeof record.runName === "string" ? record.runName : undefined,
      stepId: typeof record.stepId === "string" ? record.stepId : undefined,
      artifactName: typeof record.artifactName === "string" ? record.artifactName : undefined,
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

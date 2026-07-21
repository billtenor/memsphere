import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { access, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import MarkdownIt from "markdown-it";
import { ZodError, type ZodIssue } from "zod";
import { archiveReview, archiveRun } from "../archive/store.js";
import { type MemsphereConfig, readConfig } from "../config.js";
import { authorizeArtifactOperation } from "../control-plane/index.js";
import { listMemoryFiles, readMemoryFile, type MemoryFile } from "../memory/store.js";
import { memoryKinds, type MemoryKind } from "../memory/kinds.js";
import { parseMemoryYaml } from "../memory/yaml.js";
import {
  assertSafeReservedRelativePath,
  importReservedMemory,
  listReservedMemories,
  readReservedMemoryManifest
} from "../reserved/store.js";
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
import {
  ArtifactAuthorizationFailure,
  ArtifactReviewConflictError,
  currentArtifactReview,
  listRuns,
  parseRunState,
  readArtifactReviewForIdentity,
  readRun,
  submitArtifactReviewAssignment,
  updateArtifactReviewDraft,
  type ArtifactReviewDraftInput,
  type ArtifactReviewContext,
  type RunState,
  type RunStep
} from "../run/store.js";
import { browserHtml } from "../view/browser.js";
import {
  clearViewServiceState,
  getViewServiceStatus,
  restartViewService,
  startViewService,
  stopViewService,
  viewServiceStatePath,
  viewServiceUrl,
  writeViewServiceState
} from "../view/service.js";

const markdown = createMarkdownRenderer();

type ViewServeOptions = {
  config?: string;
  state?: string;
};

type MemoryPayload = {
  memoryRoot: string;
  systemMemoryPaths: string[];
  memories: Array<{
    id: string;
    kind: string;
    path: string;
    source?: "memory" | "reserved";
    imported?: boolean;
    entity?: unknown;
    error?: MemoryLoadError;
  }>;
};

type MemoryLoadError = {
  message: string;
  issues: string[];
};

export async function viewStartCommand(): Promise<void> {
  const config = await readConfig();
  const state = await startViewService(config);
  console.log(`memsphere view running at ${viewServiceUrl(state)}`);
  console.log(`pid: ${state.pid}`);
}

export async function viewStopCommand(): Promise<void> {
  const config = await readConfig();
  const status = await stopViewService(config);
  console.log(status.running ? "memsphere view is still running" : "memsphere view stopped");
}

export async function viewRestartCommand(): Promise<void> {
  const config = await readConfig();
  const state = await restartViewService(config);
  console.log(`memsphere view restarted at ${viewServiceUrl(state)}`);
  console.log(`pid: ${state.pid}`);
}

export async function viewStatusCommand(): Promise<void> {
  const config = await readConfig();
  const status = await getViewServiceStatus(config);
  if (!status.running || !status.state) {
    console.log("memsphere view stopped");
    return;
  }
  console.log(`memsphere view running at ${viewServiceUrl(status.state)}`);
  console.log(`pid: ${status.state.pid}`);
  console.log(`started: ${status.state.startedAt}`);
}

export async function viewServeCommand(options: ViewServeOptions): Promise<void> {
  const config = await readConfig(options.config);
  const host = config.view.host;
  const port = config.view.port;
  const statePath = options.state ?? viewServiceStatePath(config);

  const server = createViewServer(config);

  server.on("error", async (error) => {
    await clearViewServiceState(statePath, process.pid);
    console.error(`error: failed to start view server: ${error.message}`);
    process.exitCode = 1;
  });

  server.listen(port, host, async () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    await clearViewServiceState(statePath);
    await writeViewServiceState(statePath, {
      pid: process.pid,
      host,
      port: actualPort,
      startedAt: new Date().toISOString(),
      configPath: config.configPath
    });
    console.log(`memsphere view running at http://${host}:${actualPort}`);
    console.log(`memoryRoot: ${config.memoryRoot}`);
    console.log(`reviewsRoot: ${config.reviewsRoot}`);
  });

  const close = async () => {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await clearViewServiceState(statePath, process.pid);
  };
  process.once("SIGTERM", () => void close());
  process.once("SIGINT", () => void close());
}

export function createViewServer(config: MemsphereConfig) {
  return createServer(async (request, response) => {
    try {
      await handleRequest(request, response, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 500, { error: message });
    }
  });
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, config: MemsphereConfig): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const { memoryRoot, reviewsRoot, runsRoot } = config;
  const archiveRoot = config.archiveRoot;

  if (request.method === "GET" && url.pathname === "/") {
    sendHtml(response, browserHtml);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/memories") {
    const payload = await loadMemoryPayload(memoryRoot);
    sendJson(response, 200, payload);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/reserved-memories") {
    sendJson(response, 200, { memories: await loadReservedMemoryPayload(config.scopeRoot, memoryRoot) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/reserved-memories/import") {
    const body = await readJsonBody<{ path?: unknown }>(request);
    const path = typeof body.path === "string" ? body.path : "";
    assertSafeReservedRelativePath(path);
    await importReservedMemory(config.scopeRoot, memoryRoot, path);
    sendJson(response, 200, { memories: await loadReservedMemoryPayload(config.scopeRoot, memoryRoot) });
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

  const artifactReviewRoundMatch = url.pathname.match(/^\/api\/artifact-reviews\/([^/]+)\/rounds\/([^/]+)$/);
  if (request.method === "GET" && artifactReviewRoundMatch) {
    const identityId = url.searchParams.get("identity_id")?.trim();
    if (!identityId) {
      sendJson(response, 400, { error: "identity_id is required" });
      return;
    }
    try {
      const context = await readArtifactReviewForIdentity({
        runsRoot,
        reviewId: decodeURIComponent(artifactReviewRoundMatch[1]),
        roundId: decodeURIComponent(artifactReviewRoundMatch[2]),
        identityId
      });
      sendJson(response, 200, await artifactReviewContextPayload(runsRoot, context));
    } catch (error) {
      sendArtifactReviewError(response, error);
    }
    return;
  }

  const artifactReviewAssignmentMatch = url.pathname.match(
    /^\/api\/artifact-reviews\/([^/]+)\/rounds\/([^/]+)\/assignments\/([^/]+)\/(draft|submit)$/
  );
  if (artifactReviewAssignmentMatch && ["PATCH", "POST"].includes(request.method ?? "")) {
    const reviewId = decodeURIComponent(artifactReviewAssignmentMatch[1]);
    const roundId = decodeURIComponent(artifactReviewAssignmentMatch[2]);
    const identityId = decodeURIComponent(artifactReviewAssignmentMatch[3]);
    const operation = artifactReviewAssignmentMatch[4];
    try {
      const body = await readJsonBody<{
        expectedRevision?: unknown;
        vote?: unknown;
        comments?: unknown;
      }>(request);
      const expectedRevision = normalizeExpectedRevision(body.expectedRevision);
      const context = operation === "draft"
        ? await updateArtifactReviewDraft({
            runsRoot,
            reviewId,
            roundId,
            identityId,
            expectedRevision,
            draft: normalizeArtifactReviewDraft(body)
          })
        : await submitArtifactReviewAssignment({
            runsRoot,
            reviewId,
            roundId,
            identityId,
            expectedRevision
          });
      sendJson(response, 200, await artifactReviewContextPayload(runsRoot, context));
    } catch (error) {
      sendArtifactReviewError(response, error);
    }
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
    sendJson(response, 200, await snapshotPayload(snapshot));
    return;
  }

  const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (request.method === "GET" && runMatch) {
    const run = await readRun(runsRoot, decodeURIComponent(runMatch[1]));
    sendJson(response, 200, { run: await toViewRunPayload(runsRoot, run) });
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
    let taskRun: RunState | undefined;
    if (source === "task") {
      if (!runId) {
        sendJson(response, 400, { error: "task review requires a run id" });
        return;
      }
      try {
        taskRun = await readRun(runsRoot, runId);
      } catch {
        sendJson(response, 404, { error: "task run not found" });
        return;
      }
      if (!canCreateTaskReview(taskRun.status)) {
        sendJson(response, 409, { error: "only done tasks can create a review" });
        return;
      }
    }
    const snapshotFiles = await resolveReviewSnapshotFiles({
      memoryRoot,
      runsRoot,
      source,
      memoryId,
      memoryPath,
      runId,
      run: taskRun
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

async function snapshotPayload(input: { snapshot: { label: string; path: string; kind: "memory" | "task"; createdAt: string }; content: string; snapshotRoot: string }): Promise<unknown> {
  if (input.snapshot.kind === "task") {
    return {
      snapshot: input.snapshot,
      run: await toViewRunPayload(input.snapshotRoot, JSON.parse(input.content) as RunState)
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
  run?: RunState;
}): Promise<Array<{ label: string; path: string; kind: "memory" | "task"; directory?: boolean; entryPath?: string; rewriteRunMemoryRoot?: string; snapshotPath?: string; snapshotDirectoryPath?: string }>> {
  if (input.source === "task") {
    if (!input.runId) return [];
    const runPath = await resolveRunSnapshotPath(input.runsRoot, input.runId);
    const runDirectory = join(input.runsRoot, input.runId);
    try {
      await access(runDirectory);
      const taskSnapshot = {
        label: `${input.runId}.json`,
        path: runDirectory,
        kind: "task",
        directory: true,
        entryPath: relative(runDirectory, runPath),
        rewriteRunMemoryRoot: "snapshots/memory",
        snapshotDirectoryPath: join("runs", input.runId)
      } as const;
      return [taskSnapshot, ...(await resolveTaskMemorySnapshotFiles(input.memoryRoot, input.run))];
    } catch {
      // Legacy root-level run JSON files have no run directory to snapshot.
    }
    return [{
      label: `${input.runId}.json`,
      path: runPath,
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

async function resolveTaskMemorySnapshotFiles(memoryRoot: string, run?: RunState): Promise<Array<{ label: string; path: string; kind: "memory"; snapshotPath: string }>> {
  if (!run) return [];
  const references = collectRunMemoryReferences(run);
  const index = await indexMemoryFiles(memoryRoot);
  expandMemoryReferenceClosure(references, index);
  const snapshots: Array<{ label: string; path: string; kind: "memory"; snapshotPath: string }> = [];

  for (const kind of memoryKinds) {
    const files = new Map<string, MemoryFile>();
    for (const name of references[kind]) {
      for (const memory of index[kind].get(name) ?? []) {
        files.set(memory.path, memory);
      }
    }
    for (const memory of files.values()) {
      const relativePath = relative(memoryRoot, memory.path);
      snapshots.push({
        label: relativePath,
        path: memory.path,
        kind: "memory",
        snapshotPath: join("memory", relativePath)
      });
    }
  }
  return snapshots;
}

async function indexMemoryFiles(memoryRoot: string): Promise<Record<MemoryKind, Map<string, MemoryFile[]>>> {
  const index = Object.fromEntries(memoryKinds.map((kind) => [kind, new Map<string, MemoryFile[]>()])) as Record<MemoryKind, Map<string, MemoryFile[]>>;
  for (const kind of memoryKinds) {
    for (const path of await listMemoryFiles(memoryRoot, kind)) {
      try {
        const memory = await readMemoryFile(kind, path);
        for (const name of memory.entity.names) {
          const matches = index[kind].get(name) ?? [];
          matches.push(memory);
          index[kind].set(name, matches);
        }
      } catch {
        // Invalid memories cannot participate in a structured dependency closure.
      }
    }
  }
  return index;
}

function expandMemoryReferenceClosure(
  references: Record<MemoryKind, Set<string>>,
  index: Record<MemoryKind, Map<string, MemoryFile[]>>
): void {
  const visited = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const kind of memoryKinds) {
      for (const name of references[kind]) {
        for (const memory of index[kind].get(name) ?? []) {
          const key = `${kind}:${memory.path}`;
          if (visited.has(key)) continue;
          visited.add(key);
          if (collectMemoryEntityReferences(kind, memory, references)) changed = true;
        }
      }
    }
  }
}

function collectMemoryEntityReferences(
  kind: MemoryKind,
  memory: MemoryFile,
  references: Record<MemoryKind, Set<string>>
): boolean {
  const entity = memory.entity as Record<string, unknown>;
  if (kind === "concepts") {
    return addMemoryReferences(references.concepts, entity.extends);
  }
  if (kind === "procedures") {
    return collectStructuredMemoryReferences(entity.flow, references);
  }
  return false;
}

function collectStructuredMemoryReferences(value: unknown, references: Record<MemoryKind, Set<string>>): boolean {
  if (Array.isArray(value)) return value.reduce((changed, item) => collectStructuredMemoryReferences(item, references) || changed, false);
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  let changed = false;
  if (record.tag === "!call" && typeof record.target === "string") {
    changed = addMemoryReference(references.procedures, record.target) || changed;
  }
  const artifact = record.artifact;
  if (artifact && typeof artifact === "object" && !Array.isArray(artifact)) {
    const spec = artifact as Record<string, unknown>;
    if (typeof spec.schema === "string") {
      changed = addMemoryReference(references.schemas, spec.schema) || changed;
    }
  }
  for (const child of Object.values(record)) {
    changed = collectStructuredMemoryReferences(child, references) || changed;
  }
  return changed;
}

function addMemoryReferences(target: Set<string>, values: unknown): boolean {
  if (!Array.isArray(values)) return false;
  return values.reduce((changed, value) => typeof value === "string" ? addMemoryReference(target, value) || changed : changed, false);
}

function addMemoryReference(target: Set<string>, value: string): boolean {
  if (!value || target.has(value)) return false;
  target.add(value);
  return true;
}

function collectRunMemoryReferences(run: RunState): Record<MemoryKind, Set<string>> {
  const references = Object.fromEntries(memoryKinds.map((kind) => [kind, new Set<string>()])) as Record<MemoryKind, Set<string>>;
  references.procedures.add(run.procedureName);
  for (const frame of run.stack) {
    if (frame.type === "procedure") {
      references.procedures.add(frame.memoryName);
    } else if (!frame.memoryName.startsWith("inline:")) {
      references.schemas.add(frame.memoryName);
    }
    collectStepMemoryReferences(frame.steps, references);
  }
  collectStepMemoryReferences(run.plan ?? [], references);
  for (const event of run.events) {
    if (event.artifact.schema?.kind === "external") references.schemas.add(event.artifact.schema.name);
  }
  return references;
}

function collectStepMemoryReferences(steps: RunStep[], references: Record<MemoryKind, Set<string>>): void {
  for (const step of steps) {
    if (step.target) references.procedures.add(step.target);
    if (step.schema?.kind === "external") references.schemas.add(step.schema.name);
    if (step.branches) {
      collectStepMemoryReferences(step.branches.truthy, references);
      collectStepMemoryReferences(step.branches.falsy, references);
    }
    if (step.loop) collectStepMemoryReferences(step.loop.body, references);
  }
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
  const systemMemoryPaths = (await readReservedMemoryManifest()).system_memory.install;

  for (const kind of memoryKinds) {
    const paths = await listMemoryFiles(memoryRoot, kind);
    for (const path of paths) {
      memories.push(await loadMemoryListItem(memoryRoot, kind, path));
    }
  }

  return { memoryRoot, systemMemoryPaths, memories };
}

async function loadReservedMemoryPayload(scopeRoot: string, memoryRoot: string): Promise<MemoryPayload["memories"]> {
  const items = await listReservedMemories(scopeRoot, memoryRoot);
  return items.map((item) => {
    if (item.file) {
      const primaryName = Array.isArray(item.file.entity.names) ? item.file.entity.names[0] : item.path;
      return {
        id: `reserved/${item.kind}/${primaryName}`,
        kind: item.kind,
        path: item.path,
        source: "reserved" as const,
        imported: item.imported,
        entity: item.file.entity
      };
    }
    return {
      id: `reserved/${item.kind}/${item.path}`,
      kind: item.kind,
      path: item.path,
      source: "reserved" as const,
      imported: item.imported,
      error: formatMemoryLoadError(item.error)
    };
  });
}

async function loadRunPayload(runsRoot: string): Promise<unknown[]> {
  const runs = await listRuns(runsRoot);
  return Promise.all(runs.map((run) => toViewRunPayload(runsRoot, run)));
}

async function toViewRunPayload(runsRoot: string, run: RunState): Promise<unknown> {
  const hydrated = await hydrateRunArtifactContent(runsRoot, run);
  const { artifactReviews: _privateArtifactReviews, ...publicRun } = hydrated;
  const review = currentArtifactReview(hydrated);
  return {
    ...publicRun,
    artifactReview: review ? artifactReviewSummary(review) : undefined
  };
}

function artifactReviewSummary(review: NonNullable<RunState["artifactReviews"]>[number]): unknown {
  const round = review.rounds.find((candidate) => candidate.id === review.currentRoundId);
  const runnerVote = round?.votes.find((vote) => vote.subject.kind === "runner");
  const runnerCanDecide = authorizeArtifactOperation({
    controlPlane: review.controlPlane,
    subject: { kind: "runner" },
    permission: "decision.decide"
  }).allowed;
  return {
    id: review.id,
    artifactName: review.artifactName,
    policyId: review.policyId,
    status: review.status,
    currentRoundId: review.currentRoundId,
    round: round ? {
      id: round.id,
      sequence: round.sequence,
      revision: round.revision,
      status: round.status,
      submitted: round.assignments.filter((assignment) => assignment.status === "submitted").length,
      total: round.assignments.length,
      assignments: round.assignments.map((assignment) => ({
        identityId: assignment.identityId,
        identityName: assignment.identityName,
        binding: assignment.binding,
        status: assignment.status
      })),
      runner: runnerCanDecide || runnerVote ? {
        binding: "decision",
        status: runnerVote ? "submitted" : "pending",
        vote: runnerVote?.value,
        automatic: runnerVote?.automatic ?? false,
        comment: runnerVote?.comment
      } : undefined,
      result: round.result
    } : undefined
  };
}

async function artifactReviewContextPayload(runsRoot: string, context: ArtifactReviewContext): Promise<unknown> {
  const submission = context.review.submissions.find((candidate) => candidate.id === context.round.submissionId);
  if (!submission) throw new Error(`Artifact Review Submission not found: ${context.round.submissionId}`);
  const artifact = structuredClone(submission.artifact) as RunState["events"][number]["artifact"] & {
    content?: string;
    contentError?: string;
    renderedContent?: string;
    renderedContentType?: string;
  };
  await hydrateArtifactContent(runsRoot, context.run.id, artifact);
  return {
    review: artifactReviewSummary(context.review),
    submission: {
      id: submission.id,
      digest: submission.digest,
      createdAt: submission.createdAt,
      artifact,
      revisionSummary: submission.revisionSummary
    },
    assignment: structuredClone(context.assignment),
    rounds: context.review.rounds.map((round) => ({
      id: round.id,
      sequence: round.sequence,
      submissionId: round.submissionId,
      status: round.status,
      revision: round.revision,
      createdAt: round.createdAt,
      assignments: round.assignments.map((assignment) => ({
        identityId: assignment.identityId,
        identityName: assignment.identityName,
        roleIds: assignment.roleIds,
        binding: assignment.binding,
        status: assignment.status,
        submitted: assignment.submitted
      })),
      votes: round.votes,
      result: round.result,
      revisionSummary: context.review.submissions.find((submission) => submission.id === round.submissionId)?.revisionSummary
    }))
  };
}

export async function hydrateRunArtifactContent(runsRoot: string, run: RunState): Promise<RunState> {
  const hydrated = parseRunState(JSON.parse(JSON.stringify(run)));
  for (const event of hydrated.events) {
    const artifact = event.artifact as RunState["events"][number]["artifact"] & {
      content?: string;
      contentError?: string;
      renderedContent?: string;
      renderedContentType?: string;
    };
    await hydrateArtifactContent(runsRoot, hydrated.id, artifact);
  }
  return hydrated;
}

async function hydrateArtifactContent(
  runsRoot: string,
  runId: string,
  artifact: RunState["events"][number]["artifact"] & {
    content?: string;
    contentError?: string;
    renderedContent?: string;
    renderedContentType?: string;
  }
): Promise<void> {
  if (artifact.storage === "file" && artifact.path && isTextArtifactFormat(artifact.format.name)) {
    try {
      artifact.content = await readFile(resolveRunArtifactPath(runsRoot, runId, artifact.path), "utf8");
    } catch (error) {
      artifact.contentError = error instanceof Error ? error.message : String(error);
    }
  }
  if (artifact.format.name === "markdown") {
    const value = artifact.content ?? artifact.value;
    if (typeof value === "string") {
      artifact.renderedContent = renderMarkdownContent(value);
      artifact.renderedContentType = "text/html";
    }
  }
}

export function canCreateTaskReview(status: RunState["status"]): boolean {
  return status === "done";
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
  renderer.enable(["table"]);
  renderer.validateLink = (url: string) => /^(https?:|mailto:)/i.test(url.trim());
  const defaultLinkOpen = renderer.renderer.rules.link_open;
  renderer.renderer.rules.link_open = (tokens, index, options, env, self) => {
    tokens[index]?.attrSet("target", "_blank");
    tokens[index]?.attrSet("rel", "noopener noreferrer nofollow");
    return defaultLinkOpen
      ? defaultLinkOpen(tokens, index, options, env, self)
      : self.renderToken(tokens, index, options);
  };
  const defaultTableOpen = renderer.renderer.rules.table_open;
  renderer.renderer.rules.table_open = (tokens, index, options, env, self) => {
    const table = defaultTableOpen
      ? defaultTableOpen(tokens, index, options, env, self)
      : self.renderToken(tokens, index, options);
    return `<div class="markdown-table-scroll">${table}`;
  };
  const defaultTableClose = renderer.renderer.rules.table_close;
  renderer.renderer.rules.table_close = (tokens, index, options, env, self) => {
    const table = defaultTableClose
      ? defaultTableClose(tokens, index, options, env, self)
      : self.renderToken(tokens, index, options);
    return `${table}</div>`;
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

function normalizeExpectedRevision(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error("expectedRevision must be a non-negative integer");
  }
  return Number(value);
}

function normalizeArtifactReviewDraft(input: { vote?: unknown; comments?: unknown }): ArtifactReviewDraftInput {
  const vote = input.vote === undefined
    ? undefined
    : input.vote === "approve" || input.vote === "request_changes" || input.vote === "abstain"
      ? input.vote
      : (() => { throw new Error("invalid Artifact Review vote"); })();
  if (!Array.isArray(input.comments)) throw new Error("Artifact Review comments must be an array");
  const comments = input.comments.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid Artifact Review comment");
    }
    const comment = value as Record<string, unknown>;
    if (typeof comment.body !== "string") throw new Error("Artifact Review comment body must be a string");
    let anchor: ArtifactReviewDraftInput["comments"][number]["anchor"];
    if (comment.anchor !== undefined) {
      if (!comment.anchor || typeof comment.anchor !== "object" || Array.isArray(comment.anchor)) {
        throw new Error("invalid Artifact Review comment anchor");
      }
      const candidate = comment.anchor as Record<string, unknown>;
      if (typeof candidate.target !== "string" || typeof candidate.sourceHash !== "string") {
        throw new Error("Artifact Review comment anchor requires target and sourceHash");
      }
      anchor = {
        target: candidate.target,
        sourceHash: candidate.sourceHash,
        location: typeof candidate.location === "string" ? candidate.location : undefined
      };
    }
    return {
      id: typeof comment.id === "string" ? comment.id : undefined,
      body: comment.body,
      anchor
    };
  });
  return { vote, comments };
}

function sendArtifactReviewError(response: ServerResponse, error: unknown): void {
  if (error instanceof ArtifactReviewConflictError) {
    sendJson(response, 409, {
      error: error.message,
      roundId: error.roundId,
      actualRevision: error.actualRevision
    });
    return;
  }
  if (error instanceof ArtifactAuthorizationFailure) {
    sendJson(response, 403, { error: error.message, decision: error.decision });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  const status = /not found/i.test(message) ? 404 : /not assigned|read-only/i.test(message) ? 403 : 400;
  sendJson(response, status, { error: message });
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

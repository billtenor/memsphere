import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { z } from "zod";
import type { AppendableDataStore } from "../data/api/data-store.js";
import { bytesContent } from "../data/extensions/shared/payload.js";
import { readRunContent, runDataStore, saveRunContent } from "../project/run-data.js";

export const agentActivityMaxEvents = 500;
export const agentActivityMaxBytes = 512 * 1024;
export const agentActivityFlushDelayMs = 200;

const maxTextLength = 16 * 1024;
const maxTitleLength = 2 * 1024;
const maxPlanEntries = 100;

const activityEventSchema = z.object({
  id: z.string(),
  sequence: z.number().int().positive(),
  updatedRevision: z.number().int().positive(),
  kind: z.enum(["message", "tool", "plan", "thought", "lifecycle"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  title: z.string(),
  body: z.string().optional(),
  status: z.string().optional(),
  toolKind: z.string().optional(),
  locations: z.array(z.string()).optional(),
  plan: z.array(z.object({
    content: z.string(),
    priority: z.enum(["high", "medium", "low"]),
    status: z.enum(["pending", "in_progress", "completed"])
  }).strict()).optional()
}).strict();

const activitySnapshotSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  truncated: z.boolean(),
  droppedCount: z.number().int().nonnegative(),
  sourceBytes: z.number().int().nonnegative(),
  events: z.array(activityEventSchema)
}).strict();

const rawActivityRecordSchema = z.object({
  version: z.literal(1),
  recordedAt: z.string(),
  workspaceRoot: z.string().optional(),
  update: z.unknown().optional(),
  lifecycle: z.object({ status: z.string(), title: z.string() }).strict().optional(),
  prompt: z.object({
    kind: z.enum(["initial", "reminder"]),
    text: z.string()
  }).strict().optional()
}).strict().refine((record) => (
  record.update !== undefined
  || record.lifecycle !== undefined
  || record.prompt !== undefined
));
type RawActivityRecord = z.infer<typeof rawActivityRecordSchema>;

export type AgentActivityEvent = z.infer<typeof activityEventSchema>;
export type AgentActivitySnapshot = z.infer<typeof activitySnapshotSchema>;

export type AgentActivityLocation = {
  runsRoot: string;
  runId: string;
  reviewId: string;
  roundId: string;
  assignmentId: string;
  attemptId: string;
};

export type AgentActivitySummary = {
  text: string;
  at: string;
  kind: AgentActivityEvent["kind"];
  status?: string;
};

type ActivityProjectionState = {
  snapshot: AgentActivitySnapshot;
  nextSequence: number;
  anonymousMessage: number;
  lastAnonymousMessageId?: string;
};

export class AgentActivityRecorder {
  private readonly location: AgentActivityLocation;
  private readonly workspaceRoot: string;
  private readonly onError?: (error: unknown) => void;
  private readonly projection = emptyActivityProjectionState();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private flushChain: Promise<void> = Promise.resolve();
  private reportedError = false;
  private rawLines: string[] = [];
  private projectionTrusted = false;
  private projectionFailed = false;

  constructor(input: AgentActivityLocation & {
    workspaceRoot: string;
    onError?: (error: unknown) => void;
  }) {
    agentActivityPath(input); // Validate identities before accepting any events.
    this.location = { ...input };
    this.workspaceRoot = resolve(input.workspaceRoot);
    this.onError = input.onError;
  }

  recordLifecycle(status: string, title: string, now = new Date().toISOString()): void {
    this.rawLines.push(rawActivityLine({
      version: 1,
      recordedAt: now,
      workspaceRoot: this.workspaceRoot,
      lifecycle: { status, title }
    }));
    applyLifecycle(this.projection, status, title, now);
    this.scheduleFlush();
  }

  recordSessionUpdate(update: SessionUpdate, now = new Date().toISOString()): void {
    this.rawLines.push(rawActivityLine({ version: 1, recordedAt: now, workspaceRoot: this.workspaceRoot, update }));
    this.scheduleFlush();
    applySessionUpdate(this.projection, update, now, this.workspaceRoot);
  }

  recordPrompt(kind: "initial" | "reminder", text: string, now = new Date().toISOString()): void {
    this.rawLines.push(rawActivityLine({
      version: 1,
      recordedAt: now,
      workspaceRoot: this.workspaceRoot,
      prompt: { kind, text }
    }));
    this.scheduleFlush();
  }

  async flush(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    const snapshot = structuredClone(this.projection.snapshot);
    const raw = this.rawLines.splice(0);
    this.flushChain = this.flushChain
      .catch(() => undefined)
      .then(async () => {
        try {
          if (raw.length) {
            const created = await appendAgentActivityRaw(this.location, raw);
            if (created && !this.projectionFailed) this.projectionTrusted = true;
          }
          const bytes = await readRunContent(this.location.runsRoot, "activityLog", agentActivityIds(this.location).log) ?? Buffer.alloc(0);
          const saved = this.projectionTrusted ? snapshot : rebuildAgentActivitySnapshot(bytes, this.workspaceRoot);
          if (this.projectionTrusted) saved.sourceBytes = bytes.byteLength;
          await writeAgentActivitySnapshot(this.location, saved);
        } catch (error) {
          // Never publish events whose raw batch may not have reached storage.
          this.projectionTrusted = false;
          this.projectionFailed = true;
          throw error;
        }
      });
    try {
      await this.flushChain;
    } catch (error) {
      this.reportError(error);
    }
  }

  async close(): Promise<void> {
    await this.flush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flush();
    }, agentActivityFlushDelayMs);
  }

  private reportError(error: unknown): void {
    if (this.reportedError) return;
    this.reportedError = true;
    this.onError?.(error);
  }
}

function applyLifecycle(state: ActivityProjectionState, status: string, title: string, now: string): void {
  upsertActivity(state, `lifecycle:${state.nextSequence}`, "lifecycle", {
    title: clampText(title, maxTitleLength),
    status: clampText(status, 128)
  }, now, false);
}

function applySessionUpdate(
  state: ActivityProjectionState,
  update: SessionUpdate,
  now: string,
  workspaceRoot: string
): void {
  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      const text = contentText(update.content);
      if (!text) return;
      const messageId = update.messageId?.trim() || anonymousMessageId(state);
      upsertActivity(state, `message:${messageId}`, "message", { title: "Agent message", body: text }, now, true);
      return;
    }
    case "agent_thought_chunk":
      state.lastAnonymousMessageId = undefined;
      upsertActivity(state, "thought:active", "thought", { title: "Agent is analyzing" }, now, false);
      return;
    case "tool_call":
      state.lastAnonymousMessageId = undefined;
      upsertActivity(state, `tool:${update.toolCallId}`, "tool", {
        title: clampText(update.title, maxTitleLength),
        status: update.status ?? "pending",
        toolKind: update.kind,
        locations: safeLocations(workspaceRoot, update.locations)
      }, now, false);
      return;
    case "tool_call_update":
      state.lastAnonymousMessageId = undefined;
      upsertActivity(state, `tool:${update.toolCallId}`, "tool", {
        title: update.title === null ? undefined : clampOptional(update.title, maxTitleLength),
        status: update.status ?? undefined,
        toolKind: update.kind ?? undefined,
        locations: update.locations === null ? [] : safeLocations(workspaceRoot, update.locations)
      }, now, false);
      return;
    case "plan":
      state.lastAnonymousMessageId = undefined;
      upsertActivity(state, "plan:current", "plan", {
        title: "Agent plan",
        plan: update.entries.slice(0, maxPlanEntries).map((entry) => ({
          content: clampText(entry.content, maxTitleLength),
          priority: entry.priority,
          status: entry.status
        }))
      }, now, false);
      return;
    default:
      state.lastAnonymousMessageId = undefined;
  }
}

function anonymousMessageId(state: ActivityProjectionState): string {
  if (state.lastAnonymousMessageId) return state.lastAnonymousMessageId;
  state.lastAnonymousMessageId = `anonymous-${++state.anonymousMessage}`;
  return state.lastAnonymousMessageId;
}

function upsertActivity(
  state: ActivityProjectionState,
  id: string,
  kind: AgentActivityEvent["kind"],
  patch: Partial<Pick<AgentActivityEvent, "title" | "body" | "status" | "toolKind" | "locations" | "plan">>,
  now: string,
  appendBody: boolean
): void {
  const existing = state.snapshot.events.find((event) => event.id === id);
  const revision = ++state.snapshot.revision;
  if (existing) {
    if (patch.title !== undefined) existing.title = patch.title;
    if (patch.body !== undefined) {
      existing.body = appendBody
        ? clampText(`${existing.body ?? ""}${patch.body}`, maxTextLength)
        : clampText(patch.body, maxTextLength);
    }
    if (patch.status !== undefined) existing.status = patch.status;
    if (patch.toolKind !== undefined) existing.toolKind = patch.toolKind;
    if (patch.locations !== undefined) existing.locations = patch.locations;
    if (patch.plan !== undefined) existing.plan = patch.plan;
    existing.updatedAt = now;
    existing.updatedRevision = revision;
  } else {
    state.snapshot.events.push({
      id,
      sequence: state.nextSequence++,
      updatedRevision: revision,
      kind,
      createdAt: now,
      updatedAt: now,
      title: patch.title ?? activityKindTitle(kind),
      body: patch.body === undefined ? undefined : clampText(patch.body, maxTextLength),
      status: patch.status,
      toolKind: patch.toolKind,
      locations: patch.locations,
      plan: patch.plan
    });
  }
  enforceActivityCapacity(state.snapshot);
}

function enforceActivityCapacity(snapshot: AgentActivitySnapshot): void {
  while (
    snapshot.events.length > agentActivityMaxEvents
    || Buffer.byteLength(JSON.stringify(snapshot), "utf8") > agentActivityMaxBytes
  ) {
    const removable = snapshot.events.findIndex((event) => event.kind !== "lifecycle");
    const index = removable >= 0 ? removable : 0;
    if (!snapshot.events[index]) break;
    snapshot.events.splice(index, 1);
    snapshot.truncated = true;
    snapshot.droppedCount += 1;
  }
}

export async function readAgentActivitySnapshot(
  input: AgentActivityLocation & { workspaceRoot?: string }
): Promise<AgentActivitySnapshot> {
  const ids = agentActivityIds(input);
  const raw = await readRunContent(input.runsRoot, "activityLog", ids.log) ?? Buffer.alloc(0);
  const rawBytes = raw.byteLength;
  let cached: AgentActivitySnapshot | undefined;
  const cache = await readRunContent(input.runsRoot, "activitySnapshot", ids.snapshot);
  try {
    if (cache) cached = activitySnapshotSchema.parse(JSON.parse(cache.toString("utf8")));
  } catch {}
  if (cached?.sourceBytes === rawBytes) return cached;
  if (rawBytes === 0) {
    const empty = emptyAgentActivitySnapshot();
    await writeAgentActivitySnapshot(input, empty);
    return empty;
  }
  const rebuilt = rebuildAgentActivitySnapshot(raw, input.workspaceRoot);
  await writeAgentActivitySnapshot(input, rebuilt);
  return rebuilt;
}

function rebuildAgentActivitySnapshot(bytes: Uint8Array, fallbackWorkspaceRoot?: string): AgentActivitySnapshot {
  const raw = Buffer.from(bytes).toString("utf8");
  const completeRaw = raw.endsWith("\n") ? raw : raw.slice(0, raw.lastIndexOf("\n") + 1);
  const state = emptyActivityProjectionState();
  for (const [index, line] of completeRaw.split("\n").entries()) {
    if (!line.trim()) continue;
    let record: RawActivityRecord;
    try {
      record = rawActivityRecordSchema.parse(JSON.parse(line));
    } catch (error) {
      throw new Error(`invalid Agent Activity JSONL record at line ${index + 1}`, { cause: error });
    }
    if (record.lifecycle) {
      applyLifecycle(state, record.lifecycle.status, record.lifecycle.title, record.recordedAt);
    } else if (record.update && typeof record.update === "object") {
      applySessionUpdate(
        state,
        record.update as SessionUpdate,
        record.recordedAt,
        record.workspaceRoot || fallbackWorkspaceRoot || ""
      );
    }
  }
  state.snapshot.sourceBytes = Buffer.byteLength(completeRaw, "utf8");
  return activitySnapshotSchema.parse(JSON.parse(JSON.stringify(state.snapshot)));
}

export function agentActivityDelta(
  snapshot: AgentActivitySnapshot,
  cursor: number,
  limit = agentActivityMaxEvents
): {
  events: AgentActivityEvent[];
  nextCursor: number;
  truncated: boolean;
  droppedCount: number;
  summary?: AgentActivitySummary;
} {
  if (!Number.isInteger(cursor) || cursor < 0) throw new Error("invalid Agent Activity cursor");
  if (!Number.isInteger(limit) || limit < 0 || limit > agentActivityMaxEvents) {
    throw new Error("invalid Agent Activity limit");
  }
  const changed = limit === 0 ? [] : snapshot.events
    .filter((event) => event.updatedRevision > cursor)
    .sort((left, right) => left.updatedRevision - right.updatedRevision)
    .slice(-limit);
  const latest = [...snapshot.events].sort((left, right) => right.updatedRevision - left.updatedRevision)[0];
  return {
    events: structuredClone(changed),
    nextCursor: snapshot.revision,
    truncated: snapshot.truncated,
    droppedCount: snapshot.droppedCount,
    summary: latest ? {
      text: activitySummaryText(latest),
      at: latest.updatedAt,
      kind: latest.kind,
      status: latest.status
    } : undefined
  };
}

export function agentActivityPath(input: AgentActivityLocation): string {
  const segments = [input.runId, input.reviewId, input.roundId, input.assignmentId, input.attemptId];
  for (const segment of segments) assertSafeSegment(segment);
  return join(
    input.runsRoot,
    input.runId,
    "agent-activity",
    input.reviewId,
    input.roundId,
    input.assignmentId,
    `${input.attemptId}.json`
  );
}

export function agentActivityRawPath(input: AgentActivityLocation): string {
  return agentActivityPath(input).replace(/\.json$/, ".acp.jsonl");
}

export function agentActivityIds(input: AgentActivityLocation): { log: string; snapshot: string } {
  const snapshot = relative(input.runsRoot, agentActivityPath(input)).split(sep).join("/");
  return { snapshot, log: snapshot.replace(/\.json$/, ".acp.jsonl") };
}

function emptyAgentActivitySnapshot(): AgentActivitySnapshot {
  return { version: 1, revision: 0, truncated: false, droppedCount: 0, sourceBytes: 0, events: [] };
}

function emptyActivityProjectionState(): ActivityProjectionState {
  return {
    snapshot: emptyAgentActivitySnapshot(),
    nextSequence: 1,
    anonymousMessage: 0
  };
}

function rawActivityLine(record: RawActivityRecord): string {
  return `${JSON.stringify(record)}\n`;
}

async function writeAgentActivitySnapshot(location: AgentActivityLocation, snapshot: AgentActivitySnapshot): Promise<void> {
  await saveRunContent(location.runsRoot, "activitySnapshot", agentActivityIds(location).snapshot, "application/json", Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`));
}

async function appendAgentActivityRaw(location: AgentActivityLocation, lines: string[]): Promise<boolean> {
  const store = await runDataStore(location.runsRoot, "activityLog");
  const id = agentActivityIds(location).log;
  const data = { id, model: store.model, payload: { contentType: "application/x-ndjson", content: bytesContent(Buffer.from(lines.join(""))) } };
  if (!await store.has({}, id)) {
    await store.create({}, data);
    return true;
  }
  if (typeof (store as Partial<AppendableDataStore>).append !== "function") throw new Error(`Agent activity Store does not support append: ${store.id}`);
  await (store as AppendableDataStore).append({}, data);
  return false;
}

function contentText(content: unknown): string | undefined {
  if (!content || typeof content !== "object") return undefined;
  const candidate = content as { type?: unknown; text?: unknown };
  return candidate.type === "text" && typeof candidate.text === "string" ? candidate.text : undefined;
}

function safeLocations(
  workspaceRoot: string,
  locations: ReadonlyArray<{ path: string }> | null | undefined
): string[] | undefined {
  if (!locations) return undefined;
  return locations.flatMap((location) => {
    const path = isAbsolute(location.path) ? resolve(location.path) : resolve(workspaceRoot, location.path);
    const child = relative(workspaceRoot, path);
    if (child === "" || child.startsWith("..") || isAbsolute(child)) return [];
    return [child.split(sep).join("/")];
  }).slice(0, 20);
}

function activitySummaryText(event: AgentActivityEvent): string {
  if (event.kind === "message" && event.body) return clampText(event.body.replace(/\s+/g, " ").trim(), 240);
  if (event.kind === "plan" && event.plan?.length) {
    const active = event.plan.find((entry) => entry.status === "in_progress") ?? event.plan[0];
    return active ? `Plan: ${clampText(active.content, 220)}` : event.title;
  }
  return clampText(event.status ? `${event.title} · ${event.status}` : event.title, 240);
}

function activityKindTitle(kind: AgentActivityEvent["kind"]): string {
  if (kind === "message") return "Agent message";
  if (kind === "tool") return "Tool call";
  if (kind === "plan") return "Agent plan";
  if (kind === "thought") return "Agent is analyzing";
  return "Agent activity";
}

function clampOptional(value: string | undefined, length: number): string | undefined {
  return value === undefined ? undefined : clampText(value, length);
}

function clampText(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, Math.max(0, length - 1))}…`;
}

function assertSafeSegment(value: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) throw new Error(`invalid Agent Activity identifier: ${value}`);
}

function isNodeError(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

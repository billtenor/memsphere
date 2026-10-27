import { automaticOutputs, deriveOutputs, outputOverrides } from "./outputs.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import type { Context } from "../data/api/context.js";
import type { ValueStore, StoredValue } from "../data/api/value-store.js";
import type { Entity } from "./model-assets.js";
import type { Artifact, Body, External, Ref, ReportInput, Review, Run, Snapshot, Step } from "./types.js";
import { failure } from "./errors.js";
import { GraphRuntime, isGraphRun } from "./graph-runtime.js";
export { failure } from "./errors.js";

export type Stores = Record<Entity, ValueStore>;
export type RunLock = <T>(runId: string, action: () => Promise<T>, signal?: AbortSignal) => Promise<T>;
export type ContentReader = (ref: { storeId: string; dataId: string }, context: Context) => Promise<{ bytes: Uint8Array; contentType: string }>;
const now = () => new Date().toISOString();
const id = (kind: string) => `${kind}-${randomUUID()}`;
const nonblank = (s: string | undefined, label: string): string => { if (typeof s !== "string" || !s.trim()) throw failure("INVALID_ARGUMENT", `${label} must be nonblank`); return s; };
const tags = (input: string[] = []) => [...new Set(["default", ...input.map(v => nonblank(v, "tag"))])];
const refKey = (ref: Ref) => `${ref.kind}:${ref.id}`;
const uniqueRefs = (refs: Ref[]) => [...new Map(refs.map(r => [refKey(r), r])).values()];

/** Domain writes use ValueStore CAS; the application coordinates a short Run lock. */
export class ContextControl {
  constructor(readonly stores: Stores, private readonly lock: RunLock, private readonly contentReader: ContentReader) {
    const active = new AsyncLocalStorage<string>();
    const acquire = lock;
    this.lock = (runId, action, signal) => active.getStore() === runId ? action() : acquire(runId, () => active.run(runId, action), signal);
  }
  /** Project access and Run locking remain shared with the existing Stores. */
  async withGraph<T>(action: (runtime: GraphRuntime) => Promise<T>): Promise<T> {
    return action(new GraphRuntime(this.stores, this.lock, this.contentReader));
  }
  private key(entity: Entity, runId: string, entityId: string) { return entity === "run" ? entityId : `${runId}/${entityId}`; }
  private async record<T>(entity: Entity, runId: string, entityId: string, context: Context = {}): Promise<(StoredValue & { value: T }) | undefined> {
    const row = await this.stores[entity].get(context, this.key(entity, runId, entityId));
    if (row && (row.value as { id: string }).id !== entityId) throw failure("INVALID_STATE", `Stored identity mismatch: ${entityId}`);
    return row as (StoredValue & { value: T }) | undefined;
  }
  private async require<T>(entity: Entity, runId: string, entityId: string, context: Context = {}) {
    const row = await this.record<T>(entity, runId, entityId, context);
    if (!row) throw failure("NOT_FOUND", `${entity} not found: ${entityId}`);
    if (entity === "run" && (row.value as Run).status === "running" && (row.value as Run).archived) throw failure("INVALID_STATE", "Running Run cannot be archived");
    if ((row.value as { id: string }).id !== entityId) throw failure("INVALID_STATE", `Stored identity mismatch: ${entityId}`);
    return row;
  }
  private create<T extends { id: string }>(entity: Entity, runId: string, value: T, context: Context = {}) {
    return this.stores[entity].create(context, this.key(entity, runId, value.id), value);
  }
  private update<T extends { id: string }>(entity: Entity, runId: string, row: StoredValue, value: T, context: Context = {}) {
    if (row.revision === undefined) throw failure("UNSUPPORTED_CAPABILITY", "Context control requires revision CAS");
    return this.stores[entity].update(context, this.key(entity, runId, value.id), value, { expectedRevision: row.revision });
  }
  private async list<T>(entity: Entity, runId?: string): Promise<T[]> {
    const values: T[] = []; let cursor: string | undefined;
    do {
      const page = await this.stores[entity].list({}, { limit: 1000, cursor });
      for (const item of page.items) {
        if (runId && !item.id.startsWith(`${runId}/`)) continue;
        const row = await this.stores[entity].get({}, item.id);
        if (row) {
          const value = row.value as { id: string; runId?: string };
          if (this.key(entity, runId ?? value.id, value.id) !== item.id || value.runId !== undefined && runId !== undefined && value.runId !== runId) throw failure("INVALID_STATE", `Stored identity/Run mismatch: ${item.id}`);
          values.push(row.value as T);
        }
      }
      cursor = page.nextCursor;
    } while (cursor);
    return values;
  }
  async findRun(runId: string): Promise<Run | undefined> {
    return this.lock(runId, async () => {
      const row = await this.record<Run>("run", runId, runId);
      if (row?.value.status === "running" && row.value.archived) throw failure("INVALID_STATE", "Running Run cannot be archived");
      if (row?.value.status === "running" && !isGraphRun(row.value)) await this.recover(runId);
      return (await this.record<Run>("run", runId, runId))?.value;
    });
  }
  async listRuns(): Promise<Run[]> {
    const result: Run[] = [];
    for (const row of await this.list<Run>("run")) { const run = await this.findRun(row.id); if (run) result.push(run); }
    return result;
  }
  async listRunEntries(): Promise<Array<{ id: string; run?: Run; error?: string }>> {
    const entries: Array<{ id: string; run?: Run; error?: string }> = []; let cursor: string | undefined;
    do {
      const page = await this.stores.run.list({}, { limit: 1000, cursor });
      for (const item of page.items) {
        try {
          const row = await this.record<Run>("run", item.id, item.id);
          if (!row) throw failure("NOT_FOUND", "Run disappeared while listing");
          entries.push({ id: item.id, run: row.value });
        } catch (error) { entries.push({ id: item.id, error: error instanceof Error ? error.message : String(error) }); }
      }
      cursor = page.nextCursor;
    } while (cursor);
    return entries;
  }
  async start(name: string, language: Run["language"] = "zh-CN") {
    const run: Run = { id: id("run"), name: nonblank(name, "name"), status: "running", language, createdAt: now() };
    await this.create("run", run.id, run); return run;
  }
  private async running(runId: string, context: Context = {}) {
    const row = await this.require<Run>("run", runId, runId, context);
    if (row.value.status !== "running" || row.value.archived) throw failure("RUN_FINISHED", `Run is ${row.value.status}`);
    return row;
  }
  async snapshot(runId: string): Promise<Snapshot> {
    return this.lock(runId, async () => {
      const run = await this.require<Run>("run", runId, runId);
      if (isGraphRun(run.value)) return this.withGraph(graph => graph.snapshot(runId));
      if (run.value.status === "running" && run.value.archived) throw failure("INVALID_STATE", "Running Run cannot be archived");
      if (run.value.status === "running") await this.recover(runId);
      return this.snapshotValue(runId);
    });
  }
  private async snapshotValue(runId: string): Promise<Snapshot> {
    const run = (await this.require<Run>("run", runId, runId)).value;
    const [steps, artifacts, externals, reviews] = await Promise.all([
      this.list<Step>("step", runId), this.list<Artifact>("artifact", runId), this.list<External>("external", runId), this.list<Review>("review", runId)
    ]);
    for (const step of steps) if (step.runId !== runId) throw failure("INVALID_STATE", `Step belongs to another Run: ${step.id}`);
    for (const e of externals) if (e.runId !== runId) throw failure("INVALID_STATE", `External belongs to another Run: ${e.id}`);
    const completeIds = artifacts.filter(a => a.status === "submitted" && steps.some(s => s.id === a.stepId && s.status === "done" && s.artifact?.mode === "produce" && s.artifact.id === a.id)).map(a => a.id);
    const selected = deriveOutputs(run, artifacts, completeIds);
    if (selected.some(id => !completeIds.includes(id))) throw failure("INCOMPLETE_ARTIFACT", "Output override references an incomplete or unknown Artifact");
    return { run, steps, artifacts, externals, reviews, completeIds, outputArtifactIds: selected };
  }
  private async complete(runId: string, artifactId: string): Promise<Artifact> {
    const a = (await this.require<Artifact>("artifact", runId, artifactId)).value;
    const step = (await this.require<Step>("step", runId, a.stepId)).value;
    if (a.status !== "submitted" || step.runId !== runId || step.status !== "done" || step.artifact?.mode !== "produce" || step.artifact.id !== a.id) throw failure("INCOMPLETE_ARTIFACT", `Artifact not completely submitted: ${artifactId}`);
    return a;
  }
  async body(body: Body, context: Context = {}) {
    if (!!body.content === !!body.contentRef) throw failure("INVALID_ARGUMENT", "Exactly one of content/contentRef is required");
    if (body.content) {
      const c = body.content;
      if (!c.model || typeof c.model.definedBy !== "string" || typeof c.model.definition !== "string" || typeof c.payload?.content !== "string" || !c.payload.contentType) throw failure("INVALID_ARGUMENT", "Invalid model/payload content");
      return { bytes: Buffer.from(c.payload.content), contentType: c.payload.contentType };
    }
    const ref = body.contentRef!;
    if (!/^[a-f0-9]{64}$/.test(ref.sha256)) throw failure("INVALID_ARGUMENT", "contentRef.sha256 must be lowercase SHA-256");
    const result = await this.contentReader(ref, context);
    if (createHash("sha256").update(result.bytes).digest("hex") !== ref.sha256) throw failure("CONTENT_CHANGED", "contentRef SHA-256 mismatch");
    return result;
  }
  private async validateRefs(runId: string, refs: Ref[], self?: string) {
    const seen = new Set<string>(); const visiting = new Set<string>();
    const visit = async (ref: Ref): Promise<void> => {
      if (ref.kind !== "artifact" && ref.kind !== "external") throw failure("INVALID_ARGUMENT", "Invalid dependency kind");
      nonblank(ref.id, "dependency id");
      const key = refKey(ref);
      if (ref.kind === "artifact" && ref.id === self || visiting.has(key)) throw failure("DEPENDENCY_CYCLE", "Cyclic or self dependency");
      if (seen.has(key)) return;
      visiting.add(key);
      if (ref.kind === "artifact") { const a = await this.complete(runId, ref.id); await this.body(a); for (const child of a.dependencies) await visit(child); }
      else { const e = (await this.require<External>("external", runId, ref.id)).value; if (e.runId !== runId) throw failure("INVALID_STATE", "External Run mismatch"); await this.body(e); }
      visiting.delete(key); seen.add(key);
    };
    for (const ref of refs) await visit(ref);
  }
  /** Original IDs are the recovery identity. This does not deduplicate new CLI requests. Caller holds Run lock. */
  private async redo(runId: string) {
    if (isGraphRun((await this.require<Run>("run", runId, runId)).value)) return;
    const artifacts = await this.list<Artifact>("artifact", runId);
    for (const a of artifacts) {
      try {
      let step = await this.record<Step>("step", runId, a.stepId);
      if (step && (step.value.runId !== runId || step.value.artifact?.mode !== "produce" || step.value.artifact.id !== a.id)) throw failure("INVALID_STATE", `Conflicting Step for ${a.id}`);
      if (step?.value.status === "done") {
        if (a.status !== "submitted") throw failure("INVALID_STATE", `Completed Step references a draft: ${a.id}`);
        continue;
      }
      if (a.status === "submitted") { await this.body(a); await this.validateRefs(runId, a.dependencies, a.id); }
      if (!step) {
        const value: Step = { id: a.stepId, runId, createdAt: now(), status: "running", artifact: { mode: "produce", id: a.id } };
        await this.create("step", runId, value); step = await this.require<Step>("step", runId, a.stepId);
      }
      if (a.status === "submitted" && step.value.status !== "done") {
        await this.update("step", runId, step, { ...step.value, status: "done", endedAt: now() });
      }
      } catch (error) { throw Object.assign(error as object, { details: { runId, artifactId: a.id, stepId: a.stepId } }); }
    }
  }
  private async recover(runId: string) {
    try { await this.redo(runId); }
    catch (cause) {
      const details = { runId, ...(cause as { details?: object }).details };
      throw Object.assign(failure("RECOVERY_REQUIRED", `Run recovery failed; retry run status --run ${runId} after correcting the storage error`), { cause, details });
    }
  }
  async outputs(runId: string) {
    return (await this.snapshot(runId)).outputArtifactIds;
  }
  async updateOutputs(runId: string, add: string[], remove: string[]) {
    if (!add.length && !remove.length) throw failure("INVALID_ARGUMENT", "Provide --add or --remove");
    if (add.some(id => remove.includes(id))) throw failure("INVALID_ARGUMENT", "An Artifact cannot be both added and removed");
    return this.write(runId, async () => {
      for (const id of add) await this.complete(runId, nonblank(id, "artifact id"));
      for (const id of remove) await this.require<Artifact>("artifact", runId, nonblank(id, "artifact id"));
      const row = await this.running(runId);
      const previous = row.value.outputOverrides;
      const overrides = {
        addedArtifactIds: [...new Set([...(previous?.addedArtifactIds ?? []).filter(id => !remove.includes(id)), ...add])],
        removedArtifactIds: [...new Set([...(previous?.removedArtifactIds ?? []).filter(id => !add.includes(id)), ...remove])]
      };
      if (JSON.stringify(overrides) !== JSON.stringify(previous)) await this.update("run", runId, row, { ...row.value, outputOverrides: overrides });
      return (await this.snapshotValue(runId)).outputArtifactIds;
    });
  }
  async productionReads(runId: string, stepId: string, reads: Step["reads"]) {
    const row = await this.require<Step>("step", runId, stepId);
    await this.update("step", runId, row, { ...row.value, reads });
  }
  private write<T>(runId: string, action: () => Promise<T>) {
    return this.lock(runId, async () => { await this.running(runId); await this.redo(runId); return action(); });
  }
  async createArtifact(runId: string, input: { name?: string; revisedFrom?: string; tags?: string[] }) {
    if (input.name !== undefined) nonblank(input.name, "name");
    if (input.revisedFrom !== undefined) nonblank(input.revisedFrom, "revisedFrom");
    return this.write(runId, async () => {
      const previous = input.revisedFrom ? await this.complete(runId, input.revisedFrom) : undefined;
      const artifact: Artifact = { id: id("artifact"), stepId: id("step"), name: nonblank(input.name ?? previous?.name, "name"), status: "draft", tags: tags(input.tags), dependencies: [], ...(previous ? { revisedFrom: previous.id } : {}) };
      await this.create("artifact", runId, artifact); await this.redo(runId); return artifact;
    });
  }
  async report(runId: string, input: ReportInput) {
    if (isGraphRun((await this.require<Run>("run", runId, runId)).value)) throw failure("INVALID_ARGUMENT", "Graph report requires an explicit Step");
    for (const field of ["name", "target", "revisedFrom"] as const) if (input[field] !== undefined) nonblank(input[field], field);
    if (input.dependencies !== undefined && !Array.isArray(input.dependencies) || input.tags !== undefined && !Array.isArray(input.tags)) throw failure("INVALID_ARGUMENT", "dependencies/tags must be arrays");
    await this.body(input);
    return this.write(runId, async () => {
      const target = input.target ? await this.require<Artifact>("artifact", runId, input.target) : undefined;
      if (target?.value.status === "submitted") throw failure("ALREADY_SUBMITTED", "Artifact is submitted; create a new revision");
      if (target && (input.name !== undefined || input.revisedFrom !== undefined)) throw failure("INVALID_ARGUMENT", "target cannot redefine name/revisedFrom");
      if (input.dependencies && input.dependsOn) throw failure("INVALID_ARGUMENT", "Cannot combine dependencies and depends-on");
      const revisedFrom = target?.value.revisedFrom ?? input.revisedFrom;
      const previous = revisedFrom ? await this.complete(runId, revisedFrom) : undefined;
      let dependencies = input.dependencies ?? previous?.dependencies ?? [];
      if (input.dependsOn !== undefined) {
        dependencies = [];
        for (const selector of input.dependsOn) {
          const split = selector.indexOf(":"); const kind = selector.slice(0, split), key = selector.slice(split + 1);
          if (split < 1 || !key) throw failure("INVALID_ARGUMENT", `Invalid dependency: ${selector}`);
          if (kind === "tag") {
            const snap = await this.snapshot(runId); const matches = snap.artifacts.filter(a => snap.completeIds.includes(a.id) && a.tags.includes(key));
            if (!matches.length) throw failure("NO_TAG_MATCH", `No submitted Artifact tagged ${key}`);
            dependencies.push(...matches.map(a => ({ kind: "artifact" as const, id: a.id })));
          } else if (kind === "artifact" || kind === "external") dependencies.push({ kind, id: key });
          else throw failure("INVALID_ARGUMENT", `Invalid dependency: ${selector}`);
        }
      }
      const artifact: Artifact = { id: target?.value.id ?? id("artifact"), stepId: target?.value.stepId ?? id("step"), name: target?.value.name ?? nonblank(input.name ?? previous?.name, "name"), status: "submitted", tags: tags([...(target?.value.tags ?? []), ...(input.tags ?? [])]), dependencies: uniqueRefs(dependencies), ...(revisedFrom ? { revisedFrom } : {}), ...(input.revisedSummary !== undefined ? { revisedSummary: input.revisedSummary } : {}), ...(input.content ? { content: structuredClone(input.content) } : { contentRef: structuredClone(input.contentRef!) }) };
      await this.validateRefs(runId, artifact.dependencies, artifact.id);
      try {
        if (target) await this.update("artifact", runId, target, artifact); else await this.create("artifact", runId, artifact);
        await this.redo(runId);
      } catch (error) {
        try {
          const saved = await this.record<Artifact>("artifact", runId, artifact.id);
          if (saved?.value.status === "submitted") Object.assign(error as object, { details: { runId, artifactId: artifact.id, stepId: artifact.stepId, recoveryCommand: `memsphere run status --run ${runId}`, message: "Artifact saved; query status to recover. Repeating report creates a new Artifact." } });
        } catch { /* The primary error remains authoritative if storage cannot be read. */ }
        throw error;
      }
      const step = (await this.require<Step>("step", runId, artifact.stepId)).value;
      return { artifact, step, candidates: Object.keys(step.reads ?? {}).filter(key => !artifact.dependencies.some(r => refKey(r) === key)) };
    });
  }
  async readArtifact(runId: string, artifactId: string) {
    return this.lock(runId, async () => { const run = await this.require<Run>("run", runId, runId); if (isGraphRun(run.value)) return this.withGraph(g => g.readArtifact(runId, artifactId)); if (run.value.status === "running") await this.recover(runId); return this.body(await this.complete(runId, artifactId)); });
  }
  async readExternal(runId: string, externalId: string) {
    await this.require<Run>("run", runId, runId); const e = (await this.require<External>("external", runId, externalId)).value;
    if (e.runId !== runId) throw failure("INVALID_STATE", "External Run mismatch"); return { ...await this.body(e), source: e.source };
  }
  async recordRead(runId: string, targetId: string, source: Ref): Promise<string[]> {
    const signal = AbortSignal.timeout(1000); const context = { signal };
    try {
      await this.lock(runId, async () => {
        await this.running(runId, context);
        const a = (await this.require<Artifact>("artifact", runId, targetId, context)).value;
        if (a.status !== "draft") throw failure("TARGET_FINISHED", "Read target is not a draft");
        if (!await this.record<Step>("step", runId, a.stepId, context)) {
          await this.create("step", runId, { id: a.stepId, runId, createdAt: now(), status: "running", artifact: { mode: "produce", id: a.id } } satisfies Step, context);
        }
        const step = await this.require<Step>("step", runId, a.stepId, context);
        if (step.value.status !== "running" || step.value.runId !== runId) throw failure("TARGET_FINISHED", "Read target Step is not running");
        const value: Step = { ...step.value, reads: { ...step.value.reads, [refKey(source)]: { readAt: now() } } };
        await this.update("step", runId, step, value, context);
      }, signal);
      return [];
    } catch (error) { return [`Read succeeded; accounting skipped: ${error instanceof Error ? error.message : String(error)}`]; }
  }
  async tag(runId: string, artifactId: string, values: string[]) {
    if (!values.length) throw failure("INVALID_ARGUMENT", "At least one tag required");
    return this.write(runId, async () => { const a = await this.require<Artifact>("artifact", runId, artifactId); const value = { ...a.value, tags: tags([...a.value.tags, ...values]) }; await this.update("artifact", runId, a, value); return value; });
  }
  async addExternal(runId: string, source: string, body: Body) {
    await this.body(body); nonblank(source, "source");
    return this.write(runId, async () => { const e: External = { id: id("external"), runId, source, capturedAt: now(), ...structuredClone(body) }; await this.create("external", runId, e); return e; });
  }
  async review(runId: string, artifactId: string, source: "human" | "agent", comments: string[]) {
    if (!comments.length || !["human", "agent"].includes(source)) throw failure("INVALID_ARGUMENT", "Review requires source and comments");
    comments.forEach(c => nonblank(c, "comment"));
    return this.write(runId, async () => { await this.complete(runId, artifactId); const time = now(); const r: Review = { id: id("review"), artifactId, reviewer: { role: "reviewer", source }, status: "submitted", comments: comments.map(body => ({ id: id("comment"), body, createdAt: time })), createdAt: time, endedAt: time }; await this.create("review", runId, r); return r; });
  }
  async finish(runId: string, artifactIds?: string[]) {
    return this.lock(runId, async () => {
      const row = await this.require<Run>("run", runId, runId);
      if (isGraphRun(row.value)) return this.withGraph(async graph => {
        if (artifactIds) {
          const snapshot = await graph.advance(runId);
          if (snapshot.steps.some(s => s.status !== "done") || snapshot.run.frames![0].graphFrame.joins.some(j => Object.keys(j.arrivals).length)) throw failure("GRAPH_INCOMPLETE", "Graph has unfinished work or a partial join");
          await this.updateOutputs(runId, artifactIds, snapshot.outputArtifactIds.filter(id => !artifactIds.includes(id)));
        }
        return graph.finish(runId);
      });
      if (row.value.status === "running") await this.redo(runId);
      const roots = [...new Set(artifactIds ?? (await this.snapshotValue(runId)).outputArtifactIds)].sort();
      if (row.value.status === "done" && JSON.stringify([...(await this.snapshotValue(runId)).outputArtifactIds].sort()) === JSON.stringify(roots)) return row.value;
      await this.running(runId); await this.validateRefs(runId, roots.map(id => ({ kind: "artifact", id })));
      const current = await this.running(runId);
      const snapshot = await this.snapshotValue(runId);
      const value: Run = { ...current.value, status: "done", outputOverrides: outputOverrides(automaticOutputs(snapshot.artifacts, snapshot.completeIds), roots), endedAt: now() }; await this.update("run", runId, current, value); return value;
    });
  }
  async abandon(runId: string, reason?: string, source: "cli" | "view" = "cli") {
    const run = await this.require<Run>("run", runId, runId);
    if (isGraphRun(run.value)) return this.withGraph(g => g.abandon(runId, reason, source));
    return this.write(runId, async () => { const row = await this.require<Run>("run", runId, runId); const value: Run = { ...row.value, status: "abandoned", endedAt: now(), abandonment: { source, ...(reason ? { reason } : {}) } }; await this.update("run", runId, row, value); return value; });
  }
  /** Archiving changes visibility only; all evidence remains in its bound model Stores. */
  async archive(runId: string, archived = true) {
    return this.lock(runId, async () => {
      const row = await this.require<Run>("run", runId, runId);
      if (row.value.status === "running") throw failure("RUN_RUNNING", "Finish or abandon the Run before archiving");
      if (Boolean(row.value.archived) === archived) return row.value;
      const value = { ...row.value };
      value.archived = archived;
      await this.update("run", runId, row, value); return value;
    });
  }
}

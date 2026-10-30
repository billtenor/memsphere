import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import jsonata from "jsonata";
import type { GraphAction, GraphProcedureMemory, StatementMemory } from "../memory/ast.js";
import { parseMemoryEntity } from "../memory/store.js";
import { parseMemoryYaml } from "../memory/yaml.js";
import { serializeMemoryYaml } from "../memory/serializer.js";
import { resolveRuleParts } from "../memory/rules.js";
import { createControlPlaneSnapshot, type ControlPlaneConfig, type PermissionId, type RunReviewConfiguration } from "../control-plane/index.js";
import { buildRunReviewPreflight, validateRunReviewConfiguration, type RunProcedureTemplate } from "../run/store.js";
import type { ArtifactReviewComment, ArtifactReviewVoteValue } from "../artifact-review.js";
import type { ContentReader, RunLock, Stores } from "./service.js";
import type { Arrival, Artifact, Body, ContentRef, External, GraphFrame, GraphJoin, Ref, Review, ReviewRound, Run, Snapshot, Step, SubmissionFrame } from "./types.js";
import { Records } from "./records.js";
import { failure } from "./errors.js";
import { graphBody, mimeType, validateGraphBody, validateGraphSpec } from "./graph-content.js";
import { createGraphRound, graphPermissionConfig, graphReviewId, graphScope, pendingGraphReviews, projectGraphRound, requireGraphVote, storeGraphComments } from "./graph-review.js";
import { deriveOutputs } from "./outputs.js";
import { terminateProcessTree } from "../platform-process.js";
import { assertContextControlRecord } from "./invariants.js";

const now = () => new Date().toISOString();
const newId = (kind: string) => `${kind}-${randomUUID()}`;
const own = (value: object, key: string) => Object.hasOwn(value, key);
export const isGraphRun = (run: Run) => run.frames?.some(frame => frame.type === "graph") === true;
export type GraphStartInput = {
  name: string; language?: Run["language"]; procedure: GraphProcedureMemory;
  memorySnapshot?: Run["memorySnapshot"]; memorySource?: Run["memorySource"];
  controlPlane?: ControlPlaneConfig; reviewConfiguration?: RunReviewConfiguration;
};
export type GraphReport = { text?: string; content?: Body["content"]; contentRef?: ContentRef; revisionSummary?: string };

/** Graph persistence uses the same model Stores as exploration, with its own completion/recovery rules. */
export class GraphRuntime {
  readonly records: Records;
  constructor(stores: Stores, private readonly lock: RunLock, private readonly reader: ContentReader) { this.records = new Records(stores); }
  private async run(id: string) {
    const row = await this.records.require<Run>("run", id, id);
    if (!isGraphRun(row.value) || row.value.frames?.length !== 1 || !row.value.frames[0].graphFrame || row.value.frames[0].graphFrame.memoryRef !== row.value.memoryRef) throw failure("INVALID_STATE", `Not a valid graph Run: ${id}`);
    return row;
  }
  private active(run: Run) { if (run.status !== "running" || run.archived) throw failure("RUN_FINISHED", `Run is ${run.status}`); }
  private frame(run: Run): GraphFrame { return run.frames![0].graphFrame; }
  private procedure(run: Run): GraphProcedureMemory {
    const raw = run.memorySnapshot?.memories[run.memoryRef!];
    if (!raw) throw failure("INVALID_STATE", "Graph Run has no frozen Procedure");
    const p = parseMemoryEntity("procedures", parseMemoryYaml(raw.payload.content));
    if (p.tag !== "!procedure" || p.mode !== "graph" || `procedures/${p.names[0]}` !== run.memoryRef) throw failure("INVALID_STATE", "Frozen Procedure identity/mode mismatch");
    return p;
  }
  action(run: Run, step: Step): GraphAction {
    if (step.runId !== run.id || step.source?.memoryRef !== run.memoryRef) throw failure("INVALID_STATE", "Step belongs to another Run/Procedure");
    const action = this.procedure(run).actions.find(a => a.id === step.source!.actionId);
    if (!action) throw failure("INVALID_STATE", `Unknown Step Action: ${step.source?.actionId}`);
    return action;
  }
  private authorize(run: Run, permission: PermissionId) {
    if (run.permissionConfig && !run.permissionConfig.runner.permissions.includes(permission)) throw failure("PERMISSION_DENIED", `Runner requires ${permission}`);
  }
  private async step(run: Run, stepId: string) {
    const row = await this.records.require<Step>("step", run.id, stepId); this.action(run, row.value);
    if (!["pending", "running", "awaiting_review", "done"].includes(row.value.status)) throw failure("INVALID_STATE", "Invalid graph Step status");
    return row;
  }
  private async saveRun(row: Awaited<ReturnType<GraphRuntime["run"]>>, value: Run) { await this.records.update("run", value.id, row, value); }
  async start(input: GraphStartInput): Promise<Snapshot> {
    if (!input.name.trim()) throw failure("INVALID_ARGUMENT", "Run name must be nonblank");
    const procedure = parseMemoryEntity("procedures", input.procedure) as GraphProcedureMemory;
    if (procedure.mode !== "graph") throw failure("INVALID_ARGUMENT", "Expected a graph Procedure");
    for (const a of procedure.actions) if (a.artifact) await validateGraphSpec(a.artifact);
    const cp = input.controlPlane && createControlPlaneSnapshot(input.controlPlane);
    if (cp && Object.hasOwn(cp.actors, "runner")) throw failure("INVALID_ARGUMENT", "Graph Actor id runner conflicts with the Runner permission identity; use a distinct Actor id");
    const template: RunProcedureTemplate = { memoryName: procedure.names[0], steps: procedure.actions.map(a => ({ id: `actions[${a.id}]`, instruction: a.description, artifact: a.artifact?.name, reviewSlots: a.artifact?.review })) };
    const review = validateRunReviewConfiguration(buildRunReviewPreflight({ [procedure.names[0]]: template }, cp), input.reviewConfiguration, cp);
    const memoryRef = `procedures/${procedure.names[0]}`;
    const snapshot = structuredClone(input.memorySnapshot ?? { memories: { [memoryRef]: { memoryRef, payload: { contentType: "application/yaml", content: serializeMemoryYaml(procedure) } } } });
    for (const memory of Object.values(snapshot.memories)) if (memory.app && !memory.app.enabled) throw failure("APP_DISABLED", `App is disabled: ${memory.app.id}`);
    const run: Run = { id: newId("run"), name: input.name, language: input.language ?? "zh-CN", status: "running", createdAt: now(), memoryRef, memorySnapshot: snapshot,
      ...(input.memorySource ? { memorySource: structuredClone(input.memorySource) } : {}),
      ...(input.controlPlane ? { permissionConfig: graphPermissionConfig(input.controlPlane, input.language ?? "zh-CN") } : {}),
      ...(review ? { reviewConfig: { reviewPolicies: review.reviews, reviewBindings: review.slots } } : {}),
      frames: [{ id: newId("frame"), type: "graph", graphFrame: { memoryRef, triggers: [], pendingSteps: [], joins: [], processedStepIds: [], nextCompletionSequence: 1 } }] };
    await this.rules(run);
    if (!isDeepStrictEqual(this.procedure(run), procedure)) throw failure("INVALID_STATE", "Procedure differs from its frozen snapshot");
    for (const action of procedure.actions) await this.rules(run, action);
    // Validate permissions before creating any Run or Review records.
    for (const a of procedure.actions) if (a.artifact?.review?.length) createGraphRound(run, procedure, a, "preflight");
    await this.dispatch(run, "START", { kind: "start" });
    await this.records.create("run", run.id, run);
    try { return await this.advance(run.id); }
    catch (error) { throw Object.assign(error as object, { details: { runId: run.id, recoveryCommand: `memsphere run status --run ${run.id}`, message: "Run saved; recover it instead of starting a duplicate" } }); }
  }
  async snapshot(runId: string): Promise<Snapshot> { return this.snapshotValue(runId); }
  /** Personal Review writes use their own record revision; graph recovery is separate. */
  async mutateReview<T>(runId: string, stepId: string, roundId: string, actor: string, action: (value: Review, run: Run, step: Step) => Promise<T>): Promise<T> {
    const run = (await this.run(runId)).value; this.active(run);
    const step = (await this.step(run, stepId)).value;
    if (step.status !== "awaiting_review" || step.reviewRounds?.at(-1)?.id !== roundId) throw failure("REVIEW_CONFLICT", "Review Round is no longer active");
    const row = await this.records.require<Review>("review", runId, graphReviewId(roundId, actor));
    if (row.value.roundId !== roundId || row.value.artifactId !== step.reviewRounds.at(-1)!.artifactId || row.value.reviewer.actorId !== actor) throw failure("INVALID_STATE", "Personal Review identity mismatch");
    const value = structuredClone(row.value);
    const result = await action(value, run, step);
    await this.records.update("review", runId, row, value);
    return result;
  }
  async recordReviewStop(runId: string, stepId: string, roundId: string, actorId: string, attemptId: string, stopReason: string) {
    const run = (await this.run(runId)).value;
    const step = (await this.step(run, stepId)).value;
    if (!step.reviewRounds?.some(r => r.id === roundId)) throw failure("NOT_FOUND", "Review Round not found");
    const row = await this.records.require<Review>("review", runId, graphReviewId(roundId, actorId));
    const value = structuredClone(row.value), attempt = value.attempts?.at(-1);
    if (value.status !== "submitted" || attempt?.id !== attemptId) throw failure("REVIEW_CONFLICT", "Submitted Agent attempt does not match");
    attempt.completion = { ...(attempt.completion ?? { at: now(), kind: "completed" as const }), stopReason };
    await this.records.update("review", runId, row, value);
  }
  async resolveComment(runId: string, stepId: string, roundId: string, resolution: { commentId: string; value: import("../artifact-review.js").ArtifactReviewDispositionValue; note: string; validationSummary?: string }) {
    const run = (await this.run(runId)).value; this.active(run); this.authorize(run, "decision.decide");
    const row = await this.step(run, stepId); const step = structuredClone(row.value);
    const round = step.reviewRounds?.find(r => r.id === roundId);
    if (!round) throw failure("NOT_FOUND", "Review Round not found");
    const review = (await this.records.list<Review>("review", runId)).find(r => r.roundId === roundId && r.status === "submitted" && r.comments.some(c => c.id === resolution.commentId));
    if (!review || !review.reviewer.actorId || round.reviewConfig.reviewers[review.reviewer.actorId]?.permissions.includes("decision.decide")) throw failure("NOT_FOUND", "Submitted advisory comment not found");
    if (!resolution.note.trim() || resolution.value === "accepted-fixed" && !resolution.validationSummary?.trim()) throw failure("INVALID_ARGUMENT", "Resolution requires a note and accepted-fixed requires validation evidence");
    round.resolutions = [...(round.resolutions ?? []).filter(r => r.reviewId !== review.id || r.commentId !== resolution.commentId), { ...resolution, reviewId: review.id, updatedAt: now() }];
    await this.records.update("step", runId, row, step);
  }
  async bindingSnapshot(runId: string) {
    const snapshot = await this.snapshot(runId);
    return { runId, bindings: snapshot.run.reviewConfig?.reviewBindings ?? {}, rounds: snapshot.steps.flatMap(step => (step.reviewRounds ?? []).map(round => ({ stepId: step.id, roundId: round.id, bindings: round.reviewConfig.bindings }))) };
  }
  async updateBinding(runId: string, slot: string, value: { actorIds: string[] } | { skip: true }) {
    const row = await this.run(runId); const run = structuredClone(row.value); this.active(run); this.authorize(run, "decision.decide");
    if (!run.reviewConfig || !Object.hasOwn(run.reviewConfig.reviewBindings, slot)) throw failure("NOT_FOUND", `Review Slot is not declared: ${slot}`);
    if ("actorIds" in value && (!value.actorIds.length || new Set(value.actorIds).size !== value.actorIds.length)) throw failure("INVALID_ARGUMENT", "Provide distinct Reviewer Actors or skip");
    run.reviewConfig.reviewBindings[slot] = structuredClone(value);
    for (const action of this.procedure(run).actions) if (action.artifact?.review?.some(local => `${this.procedure(run).names[0]}::${local}` === slot)) createGraphRound(run, this.procedure(run), action, "preflight");
    await this.records.update("run", runId, row, run);
    return this.bindingSnapshot(runId);
  }
  private async snapshotValue(runId: string): Promise<Snapshot> {
    const run = (await this.run(runId)).value;
    const [steps, artifacts, externals, reviews] = await Promise.all([
      this.records.list<Step>("step", runId), this.records.list<Artifact>("artifact", runId), this.records.list<External>("external", runId), this.records.list<Review>("review", runId)
    ]);
    const completeIds = steps.filter(s => s.status === "done" && s.artifact?.mode === "produce").map(s => (s.artifact as { id: string }).id);
    for (const id of completeIds) if (!artifacts.some(a => a.id === id && a.status === "submitted")) throw failure("INVALID_STATE", `Completed Step has no submitted Artifact: ${id}`);
    const outputArtifactIds = deriveOutputs(run, artifacts, completeIds);
    if (outputArtifactIds.some(id => !completeIds.includes(id))) throw failure("INCOMPLETE_ARTIFACT", "Output override references an incomplete Artifact");
    this.creationOrder(run, steps);
    const sequences = new Set<number>();
    for (const step of steps) {
      const action = this.action(run, step);
      assertContextControlRecord("memsphere/context_control/step.json", step);
      if (!["pending", "running", "awaiting_review", "done"].includes(step.status)) throw failure("INVALID_STATE", "Invalid graph Step status");
      if (step.frames?.some(f => f.type !== "submission" || !f.submissionFrame)) throw failure("INVALID_STATE", "Invalid Step recovery frame");
      if (step.status === "done") {
        if (!step.artifact || !Number.isSafeInteger(step.completionSequence) || step.completionSequence! < 1 || sequences.has(step.completionSequence!)) throw failure("INVALID_STATE", "Missing or duplicate graph completion sequence");
        sequences.add(step.completionSequence!);
        if (Boolean(action.collect) !== (step.artifact.mode === "collect")) throw failure("INVALID_STATE", "Step result does not match its Action");
      }
      if (step.status === "awaiting_review" && (!step.reviewRounds?.length || step.artifact?.mode !== "produce" || step.artifact.id !== step.reviewRounds.at(-1)!.artifactId)) throw failure("INVALID_STATE", "Review Step has no matching frozen Round/Artifact");
      for (const [source, refs] of Object.entries(step.inputs ?? {})) for (const ref of refs) {
        const artifact = artifacts.find(a => a.id === ref.id);
        if (ref.kind !== "artifact" || !artifact || !completeIds.includes(ref.id) || steps.find(s => s.id === artifact.stepId)?.source?.actionId !== source) throw failure("INVALID_STATE", "Step input is not an accepted Artifact of its source Action");
      }
    }
    return { run, steps, artifacts, externals, reviews, completeIds, outputArtifactIds };
  }
  private creationOrder(run: Run, steps: Step[]) {
    const order = new Map<string, number>();
    this.frame(run).triggers.forEach((t, index) => {
      const action = this.procedure(run).actions.find(a => a.id === t.actionId);
      if (!action?.dependencies[t.dependencyIndex] || !Number.isInteger(t.dependencyIndex)) throw failure("INVALID_STATE", "Trigger references an invalid dependency");
      if (!t.stepId) return;
      if (order.has(t.stepId)) throw failure("INVALID_STATE", `Duplicate Step trigger: ${t.stepId}`);
      order.set(t.stepId, index);
    });
    const pending = new Set(this.frame(run).pendingSteps.map(s => s.id));
    for (const step of steps) {
      this.action(run, step);
      const index = order.get(step.id);
      if (index === undefined || this.frame(run).triggers[index].actionId !== step.source?.actionId) throw failure("INVALID_STATE", `Step has no matching creation trigger: ${step.id}`);
    }
    const processed = this.frame(run).processedStepIds;
    if (new Set(processed).size !== processed.length || processed.some(id => !steps.some(s => s.id === id && s.status === "done"))) throw failure("INVALID_STATE", "Invalid processed Step identities");
    for (const id of order.keys()) if (!steps.some(s => s.id === id) && !pending.has(id)) throw failure("INVALID_STATE", `Triggered Step is missing: ${id}`);
    return order;
  }
  async rules(run: Run, action?: GraphAction) {
    const lookup = async (reference: string): Promise<StatementMemory> => {
      const memory = run.memorySnapshot?.memories[reference];
      if (!memory) throw failure("NOT_FOUND", `Frozen rule not found: ${reference}`);
      const entity = parseMemoryEntity("statements", parseMemoryYaml(memory.payload.content));
      if (entity.tag !== "!statement") throw failure("INVALID_STATE", "Expected frozen Statement");
      return entity;
    };
    return {
      procedure: await resolveRuleParts("asserts", this.procedure(run).asserts, lookup),
      asserts: await resolveRuleParts("asserts", action?.asserts, lookup), suggests: await resolveRuleParts("suggests", action?.suggests, lookup),
      artifactAsserts: await resolveRuleParts("asserts", action?.artifact?.asserts, lookup), artifactSuggests: await resolveRuleParts("suggests", action?.artifact?.suggests, lookup)
    };
  }
  private async completeArtifact(run: Run, id: string): Promise<Artifact> {
    const a = (await this.records.require<Artifact>("artifact", run.id, id)).value;
    const s = (await this.step(run, a.stepId)).value;
    if (a.status !== "submitted" || s.status !== "done" || s.artifact?.mode !== "produce" || s.artifact.id !== id) throw failure("INCOMPLETE_ARTIFACT", `Not an accepted graph Artifact: ${id}`);
    return a;
  }
  async readArtifact(runId: string, id: string) {
    const run = (await this.run(runId)).value;
    const a = (await this.records.require<Artifact>("artifact", runId, id)).value;
    const step = (await this.step(run, a.stepId)).value;
    if (a.status !== "submitted" || !(step.artifact?.mode === "produce" && step.artifact.id === id || step.reviewRounds?.some(r => r.artifactId === id))) throw failure("INCOMPLETE_ARTIFACT", "Artifact is not a frozen graph submission");
    return graphBody(a, this.reader);
  }
  private async contentValue(run: Run, id: string) {
    const a = await this.completeArtifact(run, id); const step = (await this.step(run, a.stepId)).value;
    const spec = this.action(run, step).artifact;
    if (!spec) throw failure("INVALID_STATE", "Collect cannot produce an Artifact");
    return (await validateGraphBody(a, spec, this.reader)).decoded;
  }
  private bindings(arrivals: Record<string, Arrival>) {
    const inputs: Record<string, Ref[]> = Object.create(null);
    for (const [source, arrival] of Object.entries(arrivals)) {
      const groups = arrival.kind === "start" ? {} : arrival.kind === "artifact" ? { [source]: [arrival.id] } : arrival.items;
      for (const [key, ids] of Object.entries(groups)) {
        if (own(inputs, key)) throw failure("GRAPH_CONTEXT_CONFLICT", `Duplicate material Action key: ${key}`);
        inputs[key] = ids.map(id => ({ kind: "artifact" as const, id }));
      }
    }
    return inputs;
  }
  private async dispatch(run: Run, source: string, arrival: Arrival) {
    const frame = this.frame(run);
    for (const action of this.procedure(run).actions) for (const [dependencyIndex, dep] of action.dependencies.entries()) {
      const sources = typeof dep.from === "string" ? [dep.from] : dep.from;
      if (!sources.includes(source)) continue;
      let join = frame.joins.find(j => j.actionId === action.id && j.dependencyIndex === dependencyIndex);
      if (!join) { join = { actionId: action.id, dependencyIndex, arrivals: {} }; frame.joins.push(join); }
      Object.defineProperty(join.arrivals, source, { value: structuredClone(arrival), enumerable: true, writable: true, configurable: true });
      if (!sources.every(id => own(join!.arrivals, id))) continue;
      const inputs = this.bindings(join.arrivals);
      let accepted = true;
      if (dep.when !== undefined) {
        const artifacts: Record<string, unknown> = Object.create(null);
        for (const [id, material] of Object.entries(join.arrivals)) {
          if (material.kind === "artifact") artifacts[id] = await this.contentValue(run, material.id);
          else if (material.kind === "collect") for (const [key, ids] of Object.entries(material.items)) artifacts[key] = await Promise.all(ids.map(id => this.contentValue(run, id)));
        }
        try {
          const result: unknown = await jsonata(dep.when).evaluate({ artifacts });
          if (typeof result !== "boolean") throw failure("GRAPH_CONDITION_TYPE", "JSONata when result must be boolean");
          accepted = result;
        } catch (error) {
          throw Object.assign(failure("GRAPH_CONDITION_FAILED", `Action ${action.id} dependency ${dependencyIndex}: ${error && typeof error === "object" && "message" in error ? error.message : String(error)}`), { details: { actionId: action.id, dependencyIndex, inputs } });
        }
      }
      const trigger = { id: newId("trigger"), actionId: action.id, dependencyIndex };
      if (accepted) {
        const step: Step = { id: newId("step"), runId: run.id, status: "pending", createdAt: now(), source: { memoryRef: run.memoryRef!, actionId: action.id }, inputs };
        frame.pendingSteps.push(step); frame.triggers.push({ ...trigger, stepId: step.id });
      } else frame.triggers.push({ ...trigger, inputs });
      join.arrivals = {};
    }
  }
  private async materialize(runId: string) {
    let row = await this.run(runId);
    const order = new Map(this.frame(row.value).triggers.map((t, i) => [t.stepId, i]));
    const pending = [...this.frame(row.value).pendingSteps].sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    for (const step of pending) {
      const found = await this.records.get<Step>("step", runId, step.id);
      if (!found) await this.records.create("step", runId, step);
      else for (const key of ["id", "runId", "source", "inputs", "createdAt"] as const) if (!isDeepStrictEqual(found.value[key], step[key])) throw failure("RECOVERY_CONFLICT", `Step creation material differs: ${step.id}.${key}`);
      row = await this.run(runId); const run = structuredClone(row.value);
      this.frame(run).pendingSteps = this.frame(run).pendingSteps.filter(s => s.id !== step.id);
      await this.saveRun(row, run);
    }
  }
  private async reserveCompletion(runId: string) {
    const row = await this.run(runId); const run = structuredClone(row.value); const frame = this.frame(run);
    const sequence = frame.nextCompletionSequence;
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence >= Number.MAX_SAFE_INTEGER) throw failure("INVALID_STATE", "Invalid graph completion sequence");
    frame.nextCompletionSequence++; await this.saveRun(row, run); return sequence;
  }
  private async ensureArtifact(runId: string, artifact: Artifact) {
    const old = await this.records.get<Artifact>("artifact", runId, artifact.id);
    if (!old) await this.records.create("artifact", runId, artifact);
    else {
      const { tags: _oldTags, ...oldValue } = old.value; const { tags: _newTags, ...newValue } = artifact;
      if (!isDeepStrictEqual(oldValue, newValue)) throw failure("RECOVERY_CONFLICT", `Artifact content differs: ${artifact.id}`);
    }
  }
  private async recoverSubmission(runId: string, stepId: string) {
    const run = (await this.run(runId)).value;
    let row = await this.step(run, stepId); let step = structuredClone(row.value);
    assertContextControlRecord("memsphere/context_control/step.json", step);
    let stage = step.frames?.find(f => f.type === "submission")?.submissionFrame;
    if (!stage) return;
    if ((stage.nextStatus === "awaiting_review") !== Object.hasOwn(stage, "round")) throw failure("INVALID_STATE", "Submission round must match awaiting_review status");
    const spec = this.action(run, step).artifact;
    if (!spec) throw failure("INVALID_STATE", "Collect has a submission frame");
    await validateGraphBody(stage.artifact, spec, this.reader);
    await this.ensureArtifact(runId, stage.artifact);
    if (stage.round) for (const review of pendingGraphReviews(stage.round)) {
      const old = await this.records.get<Review>("review", runId, review.id);
      if (!old) await this.records.create("review", runId, review);
      else if (old.value.roundId !== review.roundId || old.value.artifactId !== review.artifactId || !isDeepStrictEqual(old.value.reviewer, review.reviewer)) throw failure("RECOVERY_CONFLICT", `Review identity differs: ${review.id}`);
    }
    if (stage.nextStatus === "done" && stage.completionSequence === undefined) {
      const completionSequence = await this.reserveCompletion(runId);
      row = await this.step(run, stepId); step = structuredClone(row.value); stage = step.frames!.find(f => f.type === "submission")!.submissionFrame;
      stage.completionSequence = completionSequence; stage.endedAt = now();
      await this.records.update("step", runId, row, step);
    }
    row = await this.step(run, stepId); step = structuredClone(row.value); stage = step.frames!.find(f => f.type === "submission")!.submissionFrame;
    step.artifact = { mode: "produce", id: stage.artifact.id }; step.status = stage.nextStatus;
    if (stage.round && !step.reviewRounds?.some(r => r.id === stage!.round!.id)) step.reviewRounds = [...(step.reviewRounds ?? []), stage.round];
    if (stage.nextStatus === "done") { step.completionSequence = stage.completionSequence; step.endedAt = stage.endedAt; }
    step.frames = step.frames!.filter(f => f.type !== "submission");
    await this.records.update("step", runId, row, step);
  }
  private async settle(runId: string, stepId: string) {
    const run = (await this.run(runId)).value; const row = await this.step(run, stepId); const step = structuredClone(row.value);
    const round = step.reviewRounds?.at(-1);
    if (step.status !== "awaiting_review" || !round) return;
    const reviews = (await this.records.list<Review>("review", runId)).filter(r => r.roundId === round.id);
    const state = projectGraphRound(run, step, round, reviews);
    if (!state.result) return;
    if (state.result.status === "changes_requested") { step.status = "running"; await this.records.update("step", runId, row, step); return; }
    const artifact = (await this.records.require<Artifact>("artifact", runId, round.artifactId)).value;
    step.frames = [{ id: newId("frame"), type: "submission", submissionFrame: { artifact, nextStatus: "done" } }];
    await this.records.update("step", runId, row, step); await this.recoverSubmission(runId, stepId);
  }
  async advance(runId: string): Promise<Snapshot> {
    return this.lock(runId, async () => {
      let run = (await this.run(runId)).value;
      if (run.status !== "running") return this.snapshotValue(runId);
      this.active(run); await this.materialize(runId);
      for (const step of await this.records.list<Step>("step", runId)) if (step.frames?.length) await this.recoverSubmission(runId, step.id);
      for (const step of await this.records.list<Step>("step", runId)) if (step.status === "awaiting_review") await this.settle(runId, step.id);
      for (let automatic = 0; automatic < 1000; automatic++) {
        run = (await this.run(runId)).value;
        const steps = await this.records.list<Step>("step", runId); const order = this.creationOrder(run, steps);
        const done = steps.filter(s => s.status === "done"); const sequences = new Set<number>();
        for (const s of done) {
          if (!Number.isSafeInteger(s.completionSequence) || s.completionSequence! < 1 || sequences.has(s.completionSequence!)) throw failure("INVALID_STATE", "Missing or duplicate graph completion sequence");
          sequences.add(s.completionSequence!);
        }
        const source = done.filter(s => !this.frame(run).processedStepIds.includes(s.id)).sort((a, b) => a.completionSequence! - b.completionSequence!)[0];
        if (source) {
          const result = source.artifact;
          if (!result) throw failure("INVALID_STATE", "Completed Step has no result");
          const row = await this.run(runId); const next = structuredClone(row.value);
          await this.dispatch(next, source.source!.actionId, result.mode === "produce" ? { kind: "artifact", id: result.id } : { kind: "collect", items: result.items });
          this.frame(next).processedStepIds.push(source.id); await this.saveRun(row, next); await this.materialize(runId); continue;
        }
        const collect = steps.filter(s => (s.status === "pending" || s.status === "running") && this.action(run, s).collect).sort((a, b) => order.get(a.id)! - order.get(b.id)!)[0];
        if (!collect) return this.snapshotValue(runId);
        const row = await this.step(run, collect.id); const updated = structuredClone(row.value);
        const items: Record<string, string[]> = Object.create(null);
        for (const sourceId of this.action(run, collect).collect!) {
          items[sourceId] = [...new Set(done.filter(s => s.source!.actionId === sourceId && s.artifact?.mode === "produce").sort((a, b) => order.get(a.id)! - order.get(b.id)!).map(s => (s.artifact as { id: string }).id))];
        }
        const sequence = await this.reserveCompletion(runId);
        updated.status = "done"; updated.startedAt ??= now(); updated.endedAt = now(); updated.completionSequence = sequence; updated.artifact = { mode: "collect", items };
        await this.records.update("step", runId, row, updated);
      }
      throw failure("GRAPH_AUTOMATIC_LIMIT", "Automatic graph work exceeded 1000 operations; inspect the graph for a collect cycle");
    });
  }
  async enter(runId: string, stepId: string) {
    const run = (await this.run(runId)).value; this.active(run); this.authorize(run, "artifact.read");
    const row = await this.step(run, stepId); const step = structuredClone(row.value);
    if (!this.action(run, step).artifact) throw failure("INVALID_ARGUMENT", "collect is executed by Memsphere, not enter");
    if (step.status === "done") throw failure("STEP_FINISHED", `Step is done: ${stepId}`);
    if (step.status === "pending") {
      step.status = "running"; step.startedAt = now();
      try { await this.records.update("step", runId, row, step); }
      catch (error) {
        if ((error as { code?: string }).code !== "REVISION_CONFLICT") throw error;
        const current = (await this.step(run, stepId)).value;
        if (current.status !== "running") throw error;
        // Concurrent entry reuses the winner's identity and start time.
        return { snapshot: await this.snapshotValue(runId), step: current };
      }
    }
    return { snapshot: await this.snapshotValue(runId), step };
  }
  async report(runId: string, stepId: string, input: GraphReport) {
    return this.lock(runId, async () => {
      await this.advance(runId); const run = (await this.run(runId)).value; this.active(run); this.authorize(run, "artifact.submit");
      const row = await this.step(run, stepId); const step = structuredClone(row.value); const action = this.action(run, step);
      if (!action.artifact || step.status !== "running") throw failure("STEP_NOT_RUNNING", `Step ${stepId} is ${step.status}; enter it before reporting`);
      if ([input.text, input.content, input.contentRef].filter(v => v !== undefined).length !== 1) throw failure("INVALID_ARGUMENT", "Provide exactly one Artifact body");
      if (step.reviewRounds?.length && !input.revisionSummary?.trim()) throw failure("REVISION_SUMMARY_REQUIRED", "A revised Artifact requires a revision summary");
      if (!step.reviewRounds?.length && input.revisionSummary !== undefined) throw failure("INVALID_ARGUMENT", "Revision summary requires a previous Review");
      const body: Body = input.text !== undefined ? { content: { model: structuredClone(action.artifact.model), payload: { contentType: action.artifact.payload.contentType, content: input.text } } } : input.content ? { content: structuredClone(input.content) } : { contentRef: structuredClone(input.contentRef!) };
      if (body.content && (body.content.model.definedBy !== action.artifact.model.definedBy || !isDeepStrictEqual(JSON.parse(body.content.model.definition), JSON.parse(action.artifact.model.definition)))) throw failure("ARTIFACT_CONTRACT_MISMATCH", "Report cannot replace the frozen Artifact model");
      let checked: Awaited<ReturnType<typeof validateGraphBody>>;
      try { checked = await validateGraphBody(body, action.artifact, this.reader); }
      catch (error) {
        if (body.content) {
          step.validation = { sha256: createHash("sha256").update(body.content.payload.content).digest("hex"), checkedAt: now(), status: "failed", issues: [{ message: error instanceof Error ? error.message : String(error) }] };
          await this.records.update("step", runId, row, step);
        }
        throw error;
      }
      const dependencies = [...new Map(Object.values(step.inputs ?? {}).flat().map(r => [`${r.kind}:${r.id}`, r])).values()];
      for (const ref of dependencies) if (ref.kind === "artifact") await this.contentValue(run, ref.id);
      const artifact: Artifact = { id: newId("artifact"), stepId, name: action.artifact.name, status: "submitted", tags: ["default"], dependencies, ...body,
        ...(step.artifact?.mode === "produce" ? { revisedFrom: step.artifact.id, revisedSummary: input.revisionSummary } : {}) };
      const round = createGraphRound(run, this.procedure(run), action, artifact.id);
      const submissionFrame: SubmissionFrame = { artifact, nextStatus: round ? "awaiting_review" : "done", ...(round ? { round } : {}) };
      step.validation = { sha256: checked.sha256, artifactId: artifact.id, checkedAt: now(), status: "passed", issues: [] };
      step.frames = [{ id: newId("frame"), type: "submission", submissionFrame }];
      await this.records.update("step", runId, row, step);
      try { await this.recoverSubmission(runId, stepId); const snapshot = await this.advance(runId); return { snapshot, step: snapshot.steps.find(s => s.id === stepId)!, artifact }; }
      catch (error) { throw Object.assign(error as object, { details: { ...(error as { details?: object }).details, runId, stepId, artifactId: artifact.id, recoveryCommand: `memsphere run status --run ${runId}`, message: "Submission identity saved; recover status before repeating report" } }); }
    });
  }
  async submitReview(runId: string, stepId: string, roundId: string, actorId: string | "runner", vote: ArtifactReviewVoteValue, comments: ArtifactReviewComment[] = [], summary?: string, delegationNote?: string, guard?: { expectedRevision?: number; attemptId?: string; human?: boolean }) {
    requireGraphVote(vote);
    return this.lock(runId, async () => {
      await this.advance(runId); const run = (await this.run(runId)).value; this.active(run);
      const step = (await this.step(run, stepId)).value; const round = step.reviewRounds?.at(-1);
      if (step.status !== "awaiting_review" || !round || round.id !== roundId) throw failure("REVIEW_CONFLICT", "Review round is no longer current");
      const config = round.reviewConfig; const runner = actorId === "runner";
      const actor = !runner ? config.reviewers[actorId] : undefined;
      if (guard?.human && actor?.kind !== "human") throw failure("INVALID_ARGUMENT", "Expected Human Reviewer");
      if (guard?.expectedRevision !== undefined) {
        const current = projectGraphRound(run, step, round, await this.records.list<Review>("review", runId));
        if (current.revision !== guard.expectedRevision) throw failure("REVIEW_CONFLICT", `Review revision changed: ${current.revision}`);
      }
      const permissions = runner ? config.runner.permissions : actor?.permissions;
      if (!permissions?.some(p => p === "decision.decide" || !runner && p === "decision.assess")) throw failure("PERMISSION_DENIED", "Reviewer is not authorized to vote");
      if (runner) {
        const all = await this.records.list<Review>("review", runId);
        if (projectGraphRound(run, step, round, all).status !== "awaiting_runner_vote") throw failure("REVIEW_NOT_READY", "Runner must read all submitted opinions before deciding");
        if (vote === "abstain") throw failure("INVALID_ARGUMENT", "Runner vote must be approve or request_changes");
      }
      if (delegationNote !== undefined) {
        if (!delegationNote.trim() || actor?.kind !== "human" || !run.permissionConfig?.runner.permissions.includes("decision.decide")) throw failure("PERMISSION_DENIED", "Human delegation requires the Human actor, Runner decision authority, and an authorization note");
      }
      if (actor?.kind === "human") {
        if (!actor.permissions.includes("decision.decide") && comments.some(c => !c.severity || !["blocking", "risk", "suggestion"].includes(c.severity))) throw failure("INVALID_ARGUMENT", "Advisory Human Comment severity is required and must be valid");
        if ((vote === "request_changes" || vote === "abstain") && !comments.length) throw failure("INVALID_ARGUMENT", `${vote} requires at least one Comment`);
      }
      if ((vote === "request_changes" || vote === "abstain") && !comments.length && !summary?.trim()) throw failure("INVALID_ARGUMENT", "Changes/abstention require an explanation");
      const id = graphReviewId(round.id, actorId); const old = await this.records.get<Review>("review", runId, id);
      if (guard?.attemptId) {
        const attempt = old?.value.attempts?.at(-1);
        if (actor?.kind !== "agent" || old?.value.status !== "running" || attempt?.id !== guard.attemptId || attempt.completion || !attempt.cliReadyAt) throw failure("REVIEW_CONFLICT", "Current Agent attempt requires its CLI handshake");
      }
      if (old?.value.status === "submitted") throw failure("REVIEW_CONFLICT", "Review was already submitted");
      if (delegationNote && old && (old.value.comments.length || old.value.vote)) throw failure("REVIEW_CONFLICT", "Human Draft contains an opinion; do not overwrite it");
      const material = (await this.records.require<Artifact>("artifact", runId, round.artifactId)).value;
      const digest = (await validateGraphBody(material, this.action(run, step).artifact!, this.reader)).sha256;
      const storedComments = storeGraphComments(comments, round.artifactId, digest);
      const value: Review = { ...(old?.value ?? { id, roundId, artifactId: round.artifactId, reviewer: runner ? { role: "runner" as const } : { role: "reviewer" as const, actorId }, createdAt: now(), comments: [] }),
        status: "submitted", endedAt: now(), comments: storedComments, vote: { value: vote, ...(summary?.trim() ? { summary } : {}), ...(delegationNote ? { delegationNote } : {}) } };
      const attempt = value.attempts?.at(-1);
      if (attempt && !attempt.completion) attempt.completion = { kind: "completed", at: value.endedAt! };
      if (old) await this.records.update("review", runId, old, value); else await this.records.create("review", runId, value);
      await this.settle(runId, stepId); return this.advance(runId);
    });
  }
  ready(snapshot: Snapshot) { const order = this.creationOrder(snapshot.run, snapshot.steps); return snapshot.steps.filter(s => (s.status === "pending" || s.status === "running") && this.action(snapshot.run, s).artifact).sort((a, b) => order.get(a.id)! - order.get(b.id)!); }
  async finish(runId: string) {
    return this.lock(runId, async () => {
      const snapshot = await this.advance(runId); if (snapshot.run.status === "done") return snapshot.run; this.active(snapshot.run);
      if (snapshot.steps.some(s => s.status !== "done") || this.frame(snapshot.run).pendingSteps.length || this.frame(snapshot.run).joins.some(j => Object.keys(j.arrivals).length)) throw failure("GRAPH_INCOMPLETE", "Graph has unfinished work or a partial join");
      const row = await this.run(runId); const value = { ...row.value, status: "done" as const, endedAt: now() };
      await this.records.update("run", runId, row, value); return value;
    });
  }
  async abandon(runId: string, reason?: string, source: "cli" | "view" = "cli") {
    return this.lock(runId, async () => {
      const row = await this.run(runId);
      if (row.value.status === "done") throw failure("RUN_FINISHED", "Completed Run cannot be abandoned");
      if (row.value.status !== "abandoned") await this.records.update("run", runId, row, { ...row.value, status: "abandoned", endedAt: now(), abandonment: { source, ...(reason ? { reason } : {}) } });
      // The terminal Run is saved first, so an interrupted cancellation cannot accept votes.
      for (const review of await this.records.list<Review>("review", runId)) {
        if (review.status === "submitted" || review.status === "cancelled") continue;
        const current = await this.records.require<Review>("review", runId, review.id); const value = structuredClone(current.value);
        value.status = "cancelled"; value.endedAt = now();
        const attempt = value.attempts?.at(-1);
        if (attempt && !attempt.completion) {
          attempt.completion = { kind: "cancelled", at: now(), stopReason: "run_abandoned" };
          if (attempt.workerPid && attempt.workerPid !== process.pid) await terminateProcessTree(attempt.workerPid).catch(() => undefined);
        }
        await this.records.update("review", runId, current, value);
      }
      return (await this.run(runId)).value;
    });
  }
}

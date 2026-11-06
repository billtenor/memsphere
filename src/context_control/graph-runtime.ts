import { createReviewNodes, assertReviewNodes, reviewCommentId } from "../review-nodes.js";
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
import type { ContentReader, Stores } from "./service.js";
import type { Arrival, Artifact, Body, ContentRef, External, GraphFrame, GraphJoin, Ref, Review, ReviewRound, Run, Snapshot, Step, SubmissionFrame } from "./types.js";
import { Records } from "./records.js";
import { failure } from "./errors.js";
import { graphBody, mimeType, validateGraphBody, validateGraphSpec } from "./graph-content.js";
import { createGraphRound, graphPermissionConfig, graphReviewId, graphScope, pendingGraphReviews, projectGraphRound, requireGraphVote, storeGraphComments } from "./graph-review.js";
import { deriveOutputs } from "./outputs.js";
import { terminateProcessTree } from "../platform-process.js";
import { assertContextControlRecord } from "./invariants.js";
import { collectMemberTriggerIds, collectReplayReady, effectiveStep, mergeArrivals, planRewind, requireEffectiveStep, triggerArrivals } from "./graph-rewind.js";
import { captureProcessGroup, stopRewindWorker } from "./review-process.js";
import { graphEvidence, supplementalDependencies } from "./graph-evidence.js";

const now = () => new Date().toISOString();
const newId = (kind: string) => `${kind}-${randomUUID()}`;
const own = (value: object, key: string) => Object.hasOwn(value, key);
export const isGraphRun = (run: Run) => run.frames?.some(frame => frame.type === "graph") === true;
export type GraphStartInput = {
  name: string; language?: Run["language"]; procedure: GraphProcedureMemory;
  memorySnapshot?: Run["memorySnapshot"]; memorySource?: Run["memorySource"];
  controlPlane?: ControlPlaneConfig; reviewConfiguration?: RunReviewConfiguration;
};
export type GraphReport = { text?: string; content?: Body["content"]; contentRef?: ContentRef; revisionSummary?: string; dependencies?: Ref[] };

/** Graph persistence uses the same model Stores as exploration, with its own completion/recovery rules. */
export class GraphRuntime {
  readonly records: Records;
  private parsedProcedure?: { reference: string; content: string; value: GraphProcedureMemory };
  constructor(stores: Stores, private readonly reader: ContentReader) { this.records = new Records(stores); }
  async stopReviewer(worker: Parameters<typeof stopRewindWorker>[0]): Promise<void> {
    await stopRewindWorker(worker);
  }
  private async run(id: string) {
    const row = await this.records.require<Run>("run", id, id);
    if (!isGraphRun(row.value) || row.value.frames?.length !== 1 || !row.value.frames[0].graphFrame || row.value.frames[0].graphFrame.memoryRef !== row.value.memoryRef) throw failure("INVALID_STATE", `Not a valid graph Run: ${id}`);
    return row;
  }
  private active(run: Run) { if (run.status !== "running" || run.archived) throw failure("RUN_FINISHED", `Run is ${run.status}`); }
  private productionReady(run: Run, cleanedRewind?: GraphFrame["pendingRewind"]) {
    this.active(run);
    if (this.frame(run).pendingRewind && !isDeepStrictEqual(this.frame(run).pendingRewind, cleanedRewind)) throw Object.assign(failure("RECOVERY_REQUIRED", "Reviewer cleanup is pending; recover run status before producing or advancing"), { details: { runId: run.id, recoveryCommand: `memsphere run status --run ${run.id}` } });
  }
  private async productionStep(runId: string, stepId: string, cleanedRewind?: GraphFrame["pendingRewind"]) {
    const run = (await this.run(runId)).value;
    this.productionReady(run, cleanedRewind); requireEffectiveStep(run, stepId);
    return run;
  }

  private frame(run: Run): GraphFrame { return run.frames![0].graphFrame; }
  private procedure(run: Run): GraphProcedureMemory {
    const raw = run.memorySnapshot?.memories[run.memoryRef!];
    if (!raw) throw failure("INVALID_STATE", "Graph Run has no frozen Procedure");
    // Store reads return fresh objects. Reuse only the exact frozen source,
    // checking both reference and bytes so a different Run or changed snapshot
    // cannot inherit another Procedure's parsed actions.
    const cached = this.parsedProcedure;
    if (cached && cached.reference === run.memoryRef && cached.content === raw.payload.content) return structuredClone(cached.value);
    const p = parseMemoryEntity("procedures", parseMemoryYaml(raw.payload.content));
    if (p.tag !== "!procedure" || p.mode !== "graph" || `procedures/${p.names[0]}` !== run.memoryRef) throw failure("INVALID_STATE", "Frozen Procedure identity/mode mismatch");
    this.parsedProcedure = { reference: run.memoryRef!, content: raw.payload.content, value: p };
    return structuredClone(p);
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
  /** Selected review reads must not enumerate other Steps, Artifacts or Reviews. */
  async reviewSnapshot(runId: string, stepId: string, roundId?: string): Promise<Snapshot> {
    const run = (await this.run(runId)).value, step = (await this.step(run, stepId)).value;
    const selected = roundId === "current" ? step.reviewRounds?.at(-1)?.id : roundId;
    const candidates = await Promise.all((step.reviewRounds ?? []).map(async r => (await this.records.require<Artifact>("artifact", runId, r.artifactId)).value));
    const visibleCandidates = roundId ? candidates.filter(a => a.id === step.reviewRounds?.find(r => r.id === selected)?.artifactId) : candidates;
    const ids = new Set(visibleCandidates.flatMap(a => a.dependencies.filter(r => r.kind === "artifact").map(r => r.id)));
    const artifacts = [...candidates, ...await Promise.all([...ids].filter(id => !candidates.some(a => a.id === id)).map(async id => (await this.records.require<Artifact>("artifact", runId, id)).value))];
    const sources = await Promise.all([...new Set(artifacts.filter(a => a.stepId !== step.id).map(a => a.stepId))].map(async id => (await this.step(run, id)).value));
    const externalIds = new Set([...visibleCandidates, ...artifacts.filter(a => ids.has(a.id))].flatMap(a => a.dependencies.filter(r => r.kind === "external").map(r => r.id)));
    const externals = await Promise.all([...externalIds].map(async id => (await this.records.require<External>("external", runId, id)).value));
    const keys = (step.reviewRounds ?? []).filter(r => !roundId || r.id === selected || r.id === step.reviewRounds?.at(-1)?.id).flatMap(r => [...Object.keys(r.reviewConfig.reviewers), "runner"].map(actor => graphReviewId(r.id, actor)));
    const reviews = (await Promise.all(keys.map(id => this.records.get<Review>("review", runId, id)))).flatMap(row => row ? [row.value] : []);
    const accepted = sources.filter(s => s.status === "done" && s.artifact?.mode === "produce").map(s => (s.artifact as { id: string }).id);
    return { run, steps: [step, ...sources], artifacts, externals, reviews, completeIds: accepted.filter(id => effectiveStep(run, artifacts.find(a => a.id === id)!.stepId)), historicalCompleteIds: accepted, outputArtifactIds: [] };
  }

  async snapshot(runId: string): Promise<Snapshot> { return this.snapshotValue(runId); }
  /** Personal Review writes use their own record revision; graph recovery is separate. */
  async mutateReview<T>(runId: string, stepId: string, roundId: string, actor: string, action: (value: Review, run: Run, step: Step) => Promise<T>): Promise<T> {
    const run = (await this.run(runId)).value; this.active(run);
    const step = (await this.step(run, stepId)).value; requireEffectiveStep(run, stepId);
    if (step.status !== "awaiting_review" || step.reviewRounds?.at(-1)?.id !== roundId) throw failure("REVIEW_CONFLICT", "Review Round is no longer active");
    const row = await this.records.require<Review>("review", runId, graphReviewId(roundId, actor));
    if (row.value.roundId !== roundId || row.value.artifactId !== step.reviewRounds.at(-1)!.artifactId || row.value.reviewer.actorId !== actor) throw failure("INVALID_STATE", "Personal Review identity mismatch");
    const value = structuredClone(row.value);
    const result = await action(value, run, step);
    requireEffectiveStep((await this.run(runId)).value, stepId);
    await this.records.update("review", runId, row, value);
    requireEffectiveStep((await this.run(runId)).value, stepId);
    return result;
  }
  async recordReviewProcesses(runId: string, stepId: string, roundId: string, actorId: string, attemptId: string, workerPid: number, providerPid?: number) {
    const run = (await this.run(runId)).value;
    const step = (await this.step(run, stepId)).value;
    if (!step.reviewRounds?.some(round => round.id === roundId)) throw failure("NOT_FOUND", "Review Round not found");
    const row = await this.records.require<Review>("review", runId, graphReviewId(roundId, actorId));
    const value = structuredClone(row.value), attempt = value.attempts?.find(attempt => attempt.id === attemptId);
    if (!attempt?.workerIdentity || attempt.workerPid !== workerPid || workerPid !== process.pid)
      throw failure("PROCESS_IDENTITY_UNAVAILABLE", "Worker lifecycle evidence does not match its OS identity");
    const members = await captureProcessGroup(attempt.workerIdentity.group);
    if (!members.some(member => isDeepStrictEqual(member, attempt.workerIdentity))) throw failure("PROCESS_IDENTITY_UNAVAILABLE", "Worker missing from its lifecycle snapshot");
    if (!providerPid || !members.some(member => member.pid === providerPid)) throw failure("PROCESS_IDENTITY_UNAVAILABLE", "Provider exited before descendant evidence was recorded");
    attempt.workerMembers = [...(attempt.workerMembers ?? []), ...members].filter((member, index, all) => all.findIndex(other => isDeepStrictEqual(member, other)) === index);
    await this.records.update("review", runId, row, value);
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
    const run = (await this.run(runId)).value; this.active(run); this.authorize(run, "decision.decide"); requireEffectiveStep(run, stepId);
    const row = await this.step(run, stepId); const step = structuredClone(row.value);
    const round = step.reviewRounds?.find(r => r.id === roundId);
    if (!round) throw failure("NOT_FOUND", "Review Round not found");
    const review = (await this.records.list<Review>("review", runId)).find(r => r.roundId === roundId && r.status === "submitted" && r.comments.some(c => reviewCommentId(c) === resolution.commentId));
    if (!review || !review.reviewer.actorId || round.reviewConfig.reviewers[review.reviewer.actorId]?.permissions.includes("decision.decide")) throw failure("NOT_FOUND", "Submitted advisory comment not found");
    if (!resolution.note.trim() || resolution.value === "accepted-fixed" && !resolution.validationSummary?.trim()) throw failure("INVALID_ARGUMENT", "Resolution requires a note and accepted-fixed requires validation evidence");
    requireEffectiveStep((await this.run(runId)).value, stepId);
    round.resolutions = [...(round.resolutions ?? []).filter(r => r.reviewId !== review.id || r.commentId !== resolution.commentId), { ...resolution, reviewId: review.id, updatedAt: now() }];
    await this.records.update("step", runId, row, step);
    requireEffectiveStep((await this.run(runId)).value, stepId);
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
    assertContextControlRecord("memsphere/context_control/run.json", run);
    const [steps, artifacts, externals, reviews] = await Promise.all([
      this.records.list<Step>("step", runId), this.records.list<Artifact>("artifact", runId), this.records.list<External>("external", runId), this.records.list<Review>("review", runId)
    ]);
    const historicalCompleteIds = steps.filter(s => s.status === "done" && s.artifact?.mode === "produce").map(s => (s.artifact as { id: string }).id);
    for (const id of historicalCompleteIds) if (!artifacts.some(a => a.id === id && a.status === "submitted")) throw failure("INVALID_STATE", `Completed Step has no submitted Artifact: ${id}`);
    const completeIds = historicalCompleteIds.filter(id => effectiveStep(run, artifacts.find(a => a.id === id)!.stepId));
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
        if (ref.kind !== "artifact" || !artifact || !historicalCompleteIds.includes(ref.id) || steps.find(s => s.id === artifact.stepId)?.source?.actionId !== source) throw failure("INVALID_STATE", "Step input is not an accepted Artifact of its source Action");
      }
    }
    return { run, steps, artifacts, externals, reviews, completeIds, historicalCompleteIds, outputArtifactIds };
  }
  private creationOrder(run: Run, steps: Step[]) {
    const order = new Map<string, number>();
    this.frame(run).triggers.forEach((t, index) => {
      const action = this.procedure(run).actions.find(a => a.id === t.actionId);
      if (!action?.dependencies[t.dependencyIndex] || !Number.isInteger(t.dependencyIndex)) throw failure("INVALID_STATE", "Trigger references an invalid dependency");
      if (t.collection) {
        const step = steps.find(s => s.id === t.stepId);
        if (!action.collect || !step || Object.keys(t.collection.items).length !== action.collect.length || action.collect.some(id => !Object.hasOwn(t.collection!.items, id)) || (step.status === "done" && !isDeepStrictEqual(step.artifact, { mode: "collect", items: t.collection.items }))) throw failure("INVALID_STATE", "Invalid frozen collect membership");
      }
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
    for (const arrivals of [...this.frame(run).triggers.map(t => t.arrivals ?? {}), ...this.frame(run).joins.map(j => j.arrivals), ...(this.frame(run).deferredCollects ?? []).map(g => g.arrivals)]) {
      for (const [actionId, arrival] of Object.entries(arrivals)) {
        if (arrival.kind === "start") { if (actionId !== "START") throw failure("INVALID_STATE", "START arrival has another source"); continue; }
        if (!arrival.stepId) continue; // Legacy arrivals are reconstructed only when needed.
        const source = steps.find(s => s.id === arrival.stepId);
        if (!source || source.source?.actionId !== actionId || source.status !== "done" || !this.frame(run).processedStepIds.includes(source.id) || !isDeepStrictEqual(source.artifact, arrival.kind === "artifact" ? {mode:"produce",id:arrival.id} : {mode:"collect",items:arrival.items})) throw failure("INVALID_STATE", "Arrival has no matching committed source Step");
      }
    }
    for (const gate of this.frame(run).deferredCollects ?? []) {
      const action = this.procedure(run).actions.find(a => a.id === gate.actionId);
      const trigger = this.frame(run).triggers.find(t => t.id === gate.triggerId);
      if (!action?.collect || !action.dependencies[gate.dependencyIndex] || trigger?.actionId !== gate.actionId || trigger.dependencyIndex !== gate.dependencyIndex || gate.memberStepIds.some(id => !action.collect!.includes(steps.find(s => s.id === id)?.source?.actionId ?? "")) || gate.waits.some(w => !effectiveStep(run, w.rootStepId) || w.waitActionIds.some(id => !this.procedure(run).actions.some(a => a.id === id)))) throw failure("INVALID_STATE", "Invalid collect recovery slot or member path");
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
    requireEffectiveStep(run, s.id);
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
      const gate = frame.deferredCollects?.find(g => g.actionId === action.id && g.dependencyIndex === dependencyIndex);
      if (gate) {
        // Dispatch is authoritative: this signal is later than every committed
        // signal already in the recovery slot. It must still respect member waits.
        Object.defineProperty(gate.arrivals, source, {value: structuredClone(arrival), enumerable: true, writable: true, configurable: true});
        continue;
      }
      let join = frame.joins.find(j => j.actionId === action.id && j.dependencyIndex === dependencyIndex);
      if (!join) { join = { actionId: action.id, dependencyIndex, arrivals: {} }; frame.joins.push(join); }
      Object.defineProperty(join.arrivals, source, { value: structuredClone(arrival), enumerable: true, writable: true, configurable: true });
      if (!sources.every(id => own(join!.arrivals, id))) continue;
      await this.fireJoin(run, action, dependencyIndex, join);
    }
  }
  private async fireJoin(run: Run, action: GraphAction, dependencyIndex: number, join: GraphJoin) {
    const dep = action.dependencies[dependencyIndex];
    const sources = typeof dep.from === "string" ? [dep.from] : dep.from;
    if (!sources.every(id => own(join.arrivals, id))) return;
    const frame = this.frame(run);
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
      const trigger = { id: newId("trigger"), actionId: action.id, dependencyIndex, arrivals: structuredClone(join.arrivals) };
      if (accepted) {
        const step: Step = { id: newId("step"), runId: run.id, status: "pending", createdAt: now(), source: { memoryRef: run.memoryRef!, actionId: action.id }, inputs };
        frame.pendingSteps.push(step); frame.triggers.push({ ...trigger, stepId: step.id });
      } else frame.triggers.push({ ...trigger, inputs });
      join.arrivals = {};
  }
  private async materialize(runId: string, cleanedRewind?: GraphFrame["pendingRewind"]) {
    let row = await this.run(runId); this.productionReady(row.value, cleanedRewind);
    const order = new Map(this.frame(row.value).triggers.map((t, i) => [t.stepId, i]));
    const pending = [...this.frame(row.value).pendingSteps].sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    for (const step of pending) {
      await this.productionStep(runId, step.id, cleanedRewind);
      const found = await this.records.get<Step>("step", runId, step.id);
      if (!found) await this.records.create("step", runId, step);
      else for (const key of ["id", "runId", "source", "inputs", "createdAt"] as const) if (!isDeepStrictEqual(found.value[key], step[key])) throw failure("RECOVERY_CONFLICT", `Step creation material differs: ${step.id}.${key}`);
      row = await this.run(runId); const run = structuredClone(row.value); this.productionReady(run, cleanedRewind);
      if (!this.frame(run).pendingSteps.some(s => s.id === step.id)) continue;
      this.frame(run).pendingSteps = this.frame(run).pendingSteps.filter(s => s.id !== step.id);
      await this.saveRun(row, run);
    }
  }
  private async reserveCompletion(runId: string) {
    const row = await this.run(runId); const run = structuredClone(row.value); this.productionReady(run); const frame = this.frame(run);
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
    const run = await this.productionStep(runId, stepId);
    let row = await this.step(run, stepId); let step = structuredClone(row.value);
    assertContextControlRecord("memsphere/context_control/step.json", step);
    const frameId = step.frames?.find(f => f.type === "submission")?.id;
    let stage = step.frames?.find(f => f.id === frameId)?.submissionFrame;
    if (!stage) return;
    if ((stage.nextStatus === "awaiting_review") !== Object.hasOwn(stage, "round")) throw failure("INVALID_STATE", "Submission round must match awaiting_review status");
    const spec = this.action(run, step).artifact;
    if (!spec) throw failure("INVALID_STATE", "Collect has a submission frame");
    await validateGraphBody(stage.artifact, spec, this.reader);
    await this.ensureArtifact(runId, stage.artifact);
    if (stage.round) for (const review of pendingGraphReviews(stage.round)) {
      const old = await this.records.get<Review>("review", runId, review.id);
      if (!old) {
        if (stage.round.reviewConfig.reviewers[review.reviewer.actorId!]?.kind === "agent") {
          const procedure = this.procedure(run);
          const actionIndex = procedure.actions.findIndex(action => action.id === step.source?.actionId);
          if (actionIndex < 0) throw failure("INVALID_STATE", "Frozen Review Action is missing");
          const action = procedure.actions[actionIndex], rules = await this.rules(run, action);
          Object.assign(review, createReviewNodes([
            { source: { kind: "procedure", memoryRef: run.memoryRef, path: "." }, name: procedure.names[0], defines: procedure.defines, asserts: rules.procedure },
            { source: { kind: "step", memoryRef: run.memoryRef, path: `actions[${actionIndex}]` }, name: action.description, asserts: rules.asserts, suggests: rules.suggests },
            { source: { kind: "step", memoryRef: run.memoryRef, path: `actions[${actionIndex}].artifact` }, name: action.artifact!.name, asserts: rules.artifactAsserts, suggests: rules.artifactSuggests }
          ], run.language === "en" ? "Open review" : "开放审查"));
        }
        await this.records.create("review", runId, review);
      }
      else if (old.value.roundId !== review.roundId || old.value.artifactId !== review.artifactId || !isDeepStrictEqual(old.value.reviewer, review.reviewer)) throw failure("RECOVERY_CONFLICT", `Review identity differs: ${review.id}`);
    }
    if (stage.nextStatus === "done" && stage.completionSequence === undefined) {
      const completionSequence = await this.reserveCompletion(runId);
      row = await this.step(run, stepId); step = structuredClone(row.value); stage = step.frames?.find(f => f.id === frameId)?.submissionFrame;
      if (!stage) return;
      if (stage.completionSequence === undefined) {
        stage.completionSequence = completionSequence; stage.endedAt = now();
        await this.records.update("step", runId, row, step);
      }
    }
    row = await this.step(run, stepId); step = structuredClone(row.value); stage = step.frames?.find(f => f.id === frameId)?.submissionFrame;
    if (!stage) return;
    step.artifact = { mode: "produce", id: stage.artifact.id }; step.status = stage.nextStatus;
    if (stage.round && !step.reviewRounds?.some(r => r.id === stage!.round!.id)) step.reviewRounds = [...(step.reviewRounds ?? []), stage.round];
    if (stage.nextStatus === "done") { step.completionSequence = stage.completionSequence; step.endedAt = stage.endedAt; }
    step.frames = step.frames!.filter(f => f.type !== "submission");
    await this.records.update("step", runId, row, step);
  }
  private async settle(runId: string, stepId: string) {
    const run = (await this.run(runId)).value; if (!effectiveStep(run, stepId)) return; const row = await this.step(run, stepId); const step = structuredClone(row.value);
    const round = step.reviewRounds?.at(-1);
    if (step.status !== "awaiting_review" || !round) return;
    if (step.frames?.length) return this.recoverSubmission(runId, stepId);
    const reviews = (await this.records.list<Review>("review", runId)).filter(r => r.roundId === round.id);
    const state = projectGraphRound(run, step, round, reviews);
    if (!state.result) return;
    if (state.result.status === "changes_requested") { step.status = "running"; await this.records.update("step", runId, row, step); return; }
    const artifact = (await this.records.require<Artifact>("artifact", runId, round.artifactId)).value;
    step.frames = [{ id: newId("frame"), type: "submission", submissionFrame: { artifact, nextStatus: "done" } }];
    await this.records.update("step", runId, row, step); await this.recoverSubmission(runId, stepId);
  }
  async rewindPreview(runId: string, stepId: string) {
    const row = await this.run(runId); this.active(row.value); this.authorize(row.value, "artifact.read");
    const snapshot = await this.snapshotValue(runId);
    const plan = planRewind(snapshot, this.procedure(row.value), stepId);
    if ((await this.run(runId)).revision !== row.revision) throw failure("REVISION_CONFLICT", "Run changed while planning rewind");
    return plan;
  }
  async rewind(runId: string, stepId: string, reason: string) {
    if (!reason?.trim()) throw failure("INVALID_ARGUMENT", "Rewind reason must be nonblank");
    const before = (await this.run(runId)).value; this.active(before);
    for (const p of ["artifact.read", "artifact.submit", "decision.decide"] as const) this.authorize(before, p);
    requireEffectiveStep(before, stepId);
    await this.advance(runId);
    const row = await this.run(runId), snapshot = await this.snapshotValue(runId);
    if (!isDeepStrictEqual(row.value, snapshot.run)) throw failure("REVISION_CONFLICT", "Run changed while planning rewind");
    const plan = planRewind(snapshot, this.procedure(row.value), stepId);
    const guards = await Promise.all(plan.affectedStepIds.map(id => this.step(row.value, id)));
    if (guards.some(guard => !isDeepStrictEqual(guard.value, snapshot.steps.find(s => s.id === guard.value.id)))) throw failure("REVISION_CONFLICT", "Step changed since the rewind snapshot");
    const run = structuredClone(row.value), frame = this.frame(run), id = newId("rewind");
    const target: Step = { id: newId("step"), runId, status: "pending", createdAt: now(), source: { memoryRef: run.memoryRef!, actionId: plan.actionId }, inputs: plan.inputs };
    const event = { id, createdAt: now(), reason, targetStepId: stepId, replacementStepId: target.id, affectedStepIds: plan.affectedStepIds, affectedTriggerIds: plan.affectedTriggerIds };
    const workers = [] as NonNullable<GraphFrame["pendingRewind"]>["workers"];
    for (const review of snapshot.reviews) {
      const artifact = snapshot.artifacts.find(a => a.id === review.artifactId);
      // A saved vote/completion is not proof that the OS process has exited.
      for (const attempt of review.attempts ?? []) {
        if (!artifact || !plan.affectedStepIds.includes(artifact.stepId) || !attempt.workerPid) continue;
        const identity = attempt.workerIdentity;
        if (attempt.workerJob) { workers.push({ reviewId: review.id, attemptId: attempt.id, pid: attempt.workerPid, identity, job: attempt.workerJob }); continue; }
        const observed = await captureProcessGroup(identity?.group ?? attempt.workerPid);
        const current = observed.find(member => member.pid === attempt.workerPid);
        const members = identity && current && isDeepStrictEqual(identity, current) ? [...(attempt.workerMembers ?? []), ...observed] : attempt.workerMembers;
        workers.push({ reviewId: review.id, attemptId: attempt.id, pid: attempt.workerPid, ...(identity ? { identity } : {}), ...(members ? { members } : {}), ...(attempt.workerJob ? { job: attempt.workerJob } : {}) });
      }
    }
    frame.rewinds = [...(frame.rewinds ?? []), event]; frame.joins = plan.joins;
    frame.pendingSteps = [...frame.pendingSteps.filter(s => !plan.affectedStepIds.includes(s.id)), target];
    frame.triggers.push({ id: newId("trigger"), actionId: plan.actionId, dependencyIndex: plan.dependencyIndex, stepId: target.id, arrivals: triggerArrivals(frame.triggers.find(t => t.stepId === stepId)!, snapshot, this.procedure(run)) });
    frame.pendingRewind = { id, workers };
    frame.deferredCollects = plan.deferred.map(g => ({ ...g, rewindId: id, waits: g.waits.map(w => ({ ...w, rootStepId: w.rootStepId === "replacement" ? target.id : w.rootStepId })) }));
    if (run.outputOverrides) run.outputOverrides.addedArtifactIds = run.outputOverrides.addedArtifactIds.filter(id => !plan.affectedArtifactIds.includes(id));
    for (const guard of guards) if ((await this.step(run, guard.value.id)).revision !== guard.revision) throw failure("REVISION_CONFLICT", "Step changed while planning rewind");
    await this.saveRun(row, run);
    try { await this.recoverRewind(runId); await this.materialize(runId); return { ...plan, rewindId: id, replacementStepId: target.id, snapshot: await this.snapshotValue(runId) }; }
    catch (error) { throw Object.assign(error as object, { details: { runId, rewindId: id, replacementStepId: target.id, recoveryCommand: `memsphere run status --run ${runId}`, message: "Rewind saved; recover status instead of repeating rewind" } }); }
  }
  private async cancelSupersededReviews(runId: string) {
    const run = (await this.run(runId)).value;
    const reviews = await this.records.list<Review>("review", runId);
    for (const artifact of await this.records.list<Artifact>("artifact", runId)) {
      if (effectiveStep(run, artifact.stepId)) continue;
      for (const review of reviews.filter(r => r.artifactId === artifact.id && r.status !== "submitted" && r.status !== "cancelled")) {
        const row = await this.records.require<Review>("review", runId, review.id), value = structuredClone(row.value);
        if (value.status === "submitted") continue;
        value.status = "cancelled"; value.endedAt = now();
        const attempt = value.attempts?.at(-1);
        if (attempt && !attempt.completion) attempt.completion = { kind: "cancelled", at: now(), stopReason: "step_superseded" };
        await this.records.update("review", runId, row, value);
      }
    }
  }
  private async recoverRewind(runId: string) {
    const row = await this.run(runId), intent = this.frame(row.value).pendingRewind;
    if (!intent) return;
    // A claim can finish after the initial multi-store snapshot. Discover its live
    // worker again before cancellation, and save its identity before signalling.
    const snapshot = await this.snapshotValue(runId);
    const missing = [] as typeof intent.workers;
    const affected = new Set(this.frame(snapshot.run).rewinds?.find(event => event.id === intent.id)?.affectedStepIds);
    for (const review of snapshot.reviews) {
      const artifact = snapshot.artifacts.find(a => a.id === review.artifactId);
      if (!artifact || !affected.has(artifact.stepId)) continue;
      for (const attempt of review.attempts ?? []) {
        if (!attempt.workerPid || intent.workers.some(w => w.reviewId === review.id && w.attemptId === attempt.id)) continue;
        const identity = attempt.workerIdentity;
        if (attempt.workerJob) { missing.push({reviewId:review.id,attemptId:attempt.id,pid:attempt.workerPid,identity,job:attempt.workerJob}); continue; }
        const observed = await captureProcessGroup(identity?.group ?? attempt.workerPid);
        const current = observed.find(member => member.pid === attempt.workerPid);
        if (process.platform !== "win32" && !current && !observed.length) continue;
        missing.push({reviewId:review.id,attemptId:attempt.id,pid:attempt.workerPid,...(attempt.workerJob?{job:attempt.workerJob}:{}),...(identity?{identity}:{}),...(identity && current && isDeepStrictEqual(identity,current)?{members:observed}:attempt.workerMembers?{members:attempt.workerMembers}:{})});
      }
    }
    if (missing.length) {
      const latest = await this.run(runId), updated = structuredClone(latest.value);
      if (this.frame(updated).pendingRewind?.id !== intent.id) throw failure("REVISION_CONFLICT", "Rewind cleanup intent changed");
      this.frame(updated).pendingRewind!.workers.push(...missing); await this.saveRun(latest,updated);
      intent.workers.push(...missing);
    }
    await this.cancelSupersededReviews(runId);
    for (const worker of intent.workers) {
      const review = (await this.records.require<Review>("review", runId, worker.reviewId)).value;
      const attempt = review.attempts?.find(attempt => attempt.id === worker.attemptId);
      if (!attempt || !isDeepStrictEqual(attempt.workerIdentity, worker.identity) || attempt.workerJob !== worker.job) throw failure("REVIEW_CONFLICT", "Cancelled worker identity changed");
      // The worker may save its shutdown snapshot after rewind's initial read.
      // Persist the new evidence before using it; status can then recover even
      // when the leader exited between those two writes.
      const members = [...(worker.members ?? []), ...(attempt.workerMembers ?? [])].filter((member, index, all) => all.findIndex(other => isDeepStrictEqual(member, other)) === index);
      if (members.length && !isDeepStrictEqual(members, worker.members)) {
        const latest = await this.run(runId), updated = structuredClone(latest.value);
        const pending = this.frame(updated).pendingRewind;
        if (!pending || !isDeepStrictEqual(pending, intent)) throw failure("REVISION_CONFLICT", "Rewind cleanup evidence changed");
        pending.workers.find(saved => saved.reviewId === worker.reviewId && saved.attemptId === worker.attemptId)!.members = members;
        await this.saveRun(latest, updated);
        worker.members = members;
      }
      await this.stopReviewer(worker);
    }
    // Only this recovery, after every saved worker was verified stopped, may
    // materialize under the intent. Keep the intent if materialization fails.
    await this.materialize(runId, intent);
    const latest = await this.run(runId), run = structuredClone(latest.value);
    this.productionReady(run, intent);
    if (this.frame(run).pendingRewind?.id === intent.id) { delete this.frame(run).pendingRewind; await this.saveRun(latest, run); }
  }
  private async releaseCollects(runId: string) {
    const snapshot = await this.snapshotValue(runId); this.productionReady(snapshot.run);
    const gates = this.frame(snapshot.run).deferredCollects ?? [];
    const gate = gates.find(g => {
      const from = this.procedure(snapshot.run).actions.find(a => a.id === g.actionId)!.dependencies[g.dependencyIndex].from;
      const sources = typeof from === "string" ? [from] : from;
      return collectReplayReady(snapshot, g) && (sources.every(id => own(g.arrivals, id)) || g.waits.length > 0);
    });
    if (!gate) return false;
    const row = await this.run(runId);
    if (!isDeepStrictEqual(row.value, snapshot.run)) throw failure("REVISION_CONFLICT", "Run changed while releasing collect");
    const run = structuredClone(row.value), frame = this.frame(run);
    let join = frame.joins.find(j => j.actionId === gate.actionId && j.dependencyIndex === gate.dependencyIndex);
    if (!join) { join = { actionId: gate.actionId, dependencyIndex: gate.dependencyIndex, arrivals: {} }; frame.joins.push(join); }
    mergeArrivals(run, join.arrivals, gate.arrivals, snapshot.artifacts);
    const action = this.procedure(run).actions.find(a => a.id === gate.actionId)!;
    const from = action.dependencies[gate.dependencyIndex].from;
    const sources = typeof from === "string" ? [from] : from;
    // A settled replacement frontier with no control signal means that path
    // was eliminated. Retire its recovery slot without manufacturing a trigger.
    if (sources.every(id => own(gate.arrivals, id))) await this.fireJoin(run, action, gate.dependencyIndex, join);
    else join.arrivals = {};
    frame.deferredCollects = frame.deferredCollects!.filter(g => g.actionId !== gate.actionId || g.dependencyIndex !== gate.dependencyIndex);
    await this.saveRun(row, run); await this.materialize(runId); return true;
  }
  async advance(runId: string): Promise<Snapshot> {
    let run = (await this.run(runId)).value;
    if (run.status !== "running") return this.snapshotValue(runId);
    this.active(run); await this.recoverRewind(runId); await this.materialize(runId);
    for (const step of await this.records.list<Step>("step", runId)) if (step.frames?.length && effectiveStep((await this.run(runId)).value, step.id)) await this.recoverSubmission(runId, step.id);
    await this.cancelSupersededReviews(runId);
    for (const step of await this.records.list<Step>("step", runId)) if (effectiveStep((await this.run(runId)).value, step.id) && step.status === "awaiting_review") await this.settle(runId, step.id);
    for (let automatic = 0; automatic < 1000; automatic++) {
      run = (await this.run(runId)).value;
      if (run.status !== "running") return this.snapshotValue(runId);
      this.productionReady(run);
      const steps = await this.records.list<Step>("step", runId); const order = this.creationOrder(run, steps);
      const done = steps.filter(s => s.status === "done" && effectiveStep(run, s.id)); const sequences = new Set<number>();
      for (const s of done) {
        if (!Number.isSafeInteger(s.completionSequence) || s.completionSequence! < 1 || sequences.has(s.completionSequence!)) throw failure("INVALID_STATE", "Missing or duplicate graph completion sequence");
        sequences.add(s.completionSequence!);
      }
      const source = done.filter(s => !this.frame(run).processedStepIds.includes(s.id)).sort((a, b) => a.completionSequence! - b.completionSequence!)[0];
      if (source) {
        const result = source.artifact;
        if (!result) throw failure("INVALID_STATE", "Completed Step has no result");
        const row = await this.run(runId); const next = structuredClone(row.value);
        if (next.status !== "running") return this.snapshotValue(runId);
        this.productionReady(next);
        if (!effectiveStep(next, source.id) || this.frame(next).processedStepIds.includes(source.id)) continue;
        await this.dispatch(next, source.source!.actionId, result.mode === "produce" ? { kind: "artifact", id: result.id, stepId: source.id } : { kind: "collect", items: result.items, stepId: source.id });
        this.frame(next).processedStepIds.push(source.id); await this.saveRun(row, next); await this.materialize(runId); continue;
      }
      const collect = steps.filter(s => effectiveStep(run, s.id) && (s.status === "pending" || s.status === "running") && this.action(run, s).collect).sort((a, b) => order.get(a.id)! - order.get(b.id)!)[0];
      if (!collect) { if (await this.releaseCollects(runId)) continue; return this.snapshotValue(runId); }
      const row = await this.step(run, collect.id); const updated = structuredClone(row.value);
      if (updated.status !== "pending" && updated.status !== "running") continue;
      let collection = this.frame(run).triggers.find(t => t.stepId === collect.id)!.collection;
      if (!collection) {
        const snapshot = await this.snapshotValue(runId), current = await this.run(runId);
        if (!isDeepStrictEqual(snapshot.run, current.value) || !isDeepStrictEqual(snapshot.run, run)) throw failure("REVISION_CONFLICT", "Run changed while freezing collect membership");
        const items: Record<string, string[]> = Object.create(null);
        for (const sourceId of this.action(run, collect).collect!) {
          items[sourceId] = [...new Set(done.filter(s => s.source!.actionId === sourceId && s.artifact?.mode === "produce").sort((a, b) => order.get(a.id)! - order.get(b.id)!).map(s => (s.artifact as { id: string }).id))];
        }
        collection = { items, triggerIds: collectMemberTriggerIds(snapshot, this.procedure(run), collect.source!.actionId) };
        const next = structuredClone(current.value);
        this.frame(next).triggers.find(t => t.stepId === collect.id)!.collection = collection;
        await this.saveRun(current, next);
      }
      const items = collection.items;
      const sequence = await this.reserveCompletion(runId);
      updated.status = "done"; updated.startedAt ??= now(); updated.endedAt = now(); updated.completionSequence = sequence; updated.artifact = { mode: "collect", items };
      await this.records.update("step", runId, row, updated);
    }
    throw failure("GRAPH_AUTOMATIC_LIMIT", "Automatic graph work exceeded 1000 operations; inspect the graph for a collect cycle");
  }
  async enter(runId: string, stepId: string) {
    const run = await this.productionStep(runId, stepId); this.authorize(run, "artifact.read");
    const row = await this.step(run, stepId); const step = structuredClone(row.value);
    if (!this.action(run, step).artifact) throw failure("INVALID_ARGUMENT", "collect is executed by Memsphere, not enter");
    if (step.status === "done") throw failure("STEP_FINISHED", `Step is done: ${stepId}`);
    if (step.status === "pending") {
      step.status = "running"; step.startedAt = now();
      await this.productionStep(runId, stepId);
      try { await this.records.update("step", runId, row, step); }
      catch (error) {
        if ((error as { code?: string }).code !== "REVISION_CONFLICT") throw error;
        const current = (await this.step(run, stepId)).value;
        if (current.status !== "running") throw error;
        // Concurrent entry reuses the winner's identity and start time.
        const snapshot = await this.snapshotValue(runId); this.productionReady(snapshot.run); requireEffectiveStep(snapshot.run, stepId);
        return { snapshot, step: current };
      }
    }
    const snapshot = await this.snapshotValue(runId); this.productionReady(snapshot.run); requireEffectiveStep(snapshot.run, stepId);
    return { snapshot, step };
  }
  async report(runId: string, stepId: string, input: GraphReport) {
    const run = await this.productionStep(runId, stepId); this.authorize(run, "artifact.submit");
    const row = await this.step(run, stepId); const step = structuredClone(row.value); const action = this.action(run, step);
    if (!action.artifact || step.status !== "running") throw failure("STEP_NOT_RUNNING", `Step ${stepId} is ${step.status}; enter it before reporting`);
    if (step.frames?.length) throw Object.assign(failure("RECOVERY_REQUIRED", "A saved submission must be recovered before reporting again"), { details: { runId, stepId, artifactId: step.frames[0].submissionFrame.artifact.id, recoveryCommand: `memsphere run status --run ${runId}` } });
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
    await this.productionStep(runId, stepId);
    const rewind = this.frame(run).rewinds?.find(r => r.replacementStepId === stepId);
    const previousStep = rewind && (await this.step(run, rewind.targetStepId)).value;
    const previousArtifact = previousStep?.artifact?.mode === "produce" ? previousStep.artifact.id : undefined;
    const predecessorId = step.artifact?.mode === "produce" ? step.artifact.id : previousArtifact;
    let extra = input.dependencies === undefined ? undefined : structuredClone(input.dependencies);
    if (extra === undefined && predecessorId) {
      const predecessor = (await this.records.require<Artifact>("artifact", runId, predecessorId)).value;
      extra = supplementalDependencies(predecessor, (await this.step(run, predecessor.stepId)).value);
    }
    if (extra === undefined) extra = [];
    if (!Array.isArray(extra) || extra.some(r => !r || !["artifact", "external"].includes(r.kind) || typeof r.id !== "string" || !r.id || Object.keys(r).some(k => !["kind", "id"].includes(k)))) throw failure("INVALID_ARGUMENT", "dependencies must contain artifact/external references");
    const eligible = extra.some(r => r.kind === "artifact") ? graphEvidence(await this.snapshotValue(runId), step, this.procedure(run)) : new Set<string>();
    for (const ref of extra) {
      if (ref.kind === "artifact") {
        if (!eligible.has(ref.id)) throw failure("PERMISSION_DENIED", `Artifact is outside this Step's fixed data/control sources: ${ref.id}`);
        await this.contentValue(run, ref.id);
      } else {
        const external = (await this.records.require<External>("external", runId, ref.id)).value;
        if (external.runId !== runId) throw failure("INVALID_ARGUMENT", "External belongs to another Run");
        await graphBody(external, this.reader);
      }
    }
    const dependencies = [...new Map([...Object.values(step.inputs ?? {}).flat(), ...extra].map(r => [`${r.kind}:${r.id}`, r])).values()];
    for (const ref of dependencies) if (ref.kind === "artifact") await this.contentValue(run, ref.id);
    const artifact: Artifact = { id: newId("artifact"), stepId, name: action.artifact.name, status: "submitted", tags: ["default"], dependencies, ...body,
      ...(step.artifact?.mode === "produce" ? { revisedFrom: step.artifact.id, revisedSummary: input.revisionSummary } : previousArtifact ? { revisedFrom: previousArtifact, revisedSummary: rewind!.reason } : {}) };
    const round = createGraphRound(run, this.procedure(run), action, artifact.id);
    const submissionFrame: SubmissionFrame = { artifact, nextStatus: round ? "awaiting_review" : "done", ...(round ? { round } : {}) };
    step.validation = { sha256: checked.sha256, artifactId: artifact.id, checkedAt: now(), status: "passed", issues: [] };
    step.frames = [{ id: newId("frame"), type: "submission", submissionFrame }];
    await this.productionStep(runId, stepId);
    await this.records.update("step", runId, row, step);
    try { await this.recoverSubmission(runId, stepId); const snapshot = await this.advance(runId); requireEffectiveStep(snapshot.run, stepId); return { snapshot, step: snapshot.steps.find(s => s.id === stepId)!, artifact }; }
    catch (error) { throw Object.assign(error as object, { details: { ...(error as { details?: object }).details, runId, stepId, artifactId: artifact.id, recoveryCommand: `memsphere run status --run ${runId}`, message: "Submission identity saved; recover status before repeating report" } }); }
  }
  async submitReview(runId: string, stepId: string, roundId: string, actorId: string | "runner", vote: ArtifactReviewVoteValue, comments: ArtifactReviewComment[] = [], summary?: string, delegationNote?: string, guard?: { expectedRevision?: number; attemptId?: string; human?: boolean }) {
    requireGraphVote(vote);
    const run = (await this.run(runId)).value; this.active(run);
    requireEffectiveStep(run, stepId);
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
      if (!projectGraphRound(run, step, round, all).assignments.every(a => a.actorKind !== "agent" || a.status === "submitted")) throw failure("REVIEW_NOT_READY", "Runner must read all Agent opinions before deciding");
      if (vote === "abstain") throw failure("INVALID_ARGUMENT", "Runner vote must be approve or request_changes");
    }
    if (delegationNote !== undefined) {
      if (!delegationNote.trim() || actor?.kind !== "human" || !run.permissionConfig?.runner.permissions.includes("decision.decide")) throw failure("PERMISSION_DENIED", "Human delegation requires the Human actor, Runner decision authority, and an authorization note");
    }
    const id = graphReviewId(round.id, actorId); const old = await this.records.get<Review>("review", runId, id);
    if (guard?.attemptId) {
      const attempt = old?.value.attempts?.at(-1);
      if (actor?.kind !== "agent" || old?.value.status !== "running" || attempt?.id !== guard.attemptId || attempt.completion || !attempt.cliReadyAt) throw failure("REVIEW_CONFLICT", "Current Agent attempt requires its CLI handshake");
    }
    if (old?.value.status === "submitted") throw failure("REVIEW_CONFLICT", "Review was already submitted");
    if (delegationNote && old && (old.value.comments.length || old.value.vote)) throw failure("REVIEW_CONFLICT", "Human Draft contains an opinion; do not overwrite it");
    if (old?.value.nodeTree) {
      assertReviewNodes(old.value, old.value.comments, true);
    }
    const material = (await this.records.require<Artifact>("artifact", runId, round.artifactId)).value;
    const digest = (await validateGraphBody(material, this.action(run, step).artifact!, this.reader)).sha256;
    const storedComments = old?.value.nodeTree ? structuredClone(old.value.comments) : storeGraphComments(comments, round.artifactId, digest);
    // Validate the exact personal snapshot that will be saved under old's CAS
    // revision, never the earlier application DTO's comments.
    if (actor?.kind === "human") {
      if (!actor.permissions.includes("decision.decide") && storedComments.some(c => !c.severity || !["blocking", "risk", "suggestion"].includes(c.severity))) throw failure("INVALID_ARGUMENT", "Advisory Human Comment severity is required and must be valid");
      if ((vote === "request_changes" || vote === "abstain") && !storedComments.length) throw failure("INVALID_ARGUMENT", `${vote} requires at least one Comment`);
    }
    if ((vote === "request_changes" || vote === "abstain") && !storedComments.length && !summary?.trim()) throw failure("INVALID_ARGUMENT", "Changes/abstention require an explanation");
    const value: Review = { ...(old?.value ?? { id, roundId, artifactId: round.artifactId, reviewer: runner ? { role: "runner" as const } : { role: "reviewer" as const, actorId }, createdAt: now(), comments: [] }),
      status: "submitted", endedAt: now(), comments: storedComments, vote: { value: vote, ...(summary?.trim() ? { summary } : {}), ...(delegationNote ? { delegationNote } : {}) } };
    const attempt = value.attempts?.at(-1);
    if (attempt && !attempt.completion) attempt.completion = { kind: "completed", at: value.endedAt! };
    requireEffectiveStep((await this.run(runId)).value, stepId);
    if (old) await this.records.update("review", runId, old, value); else await this.records.create("review", runId, value);
    try {
      requireEffectiveStep((await this.run(runId)).value, stepId);
      await this.settle(runId, stepId);
      const snapshot = await this.advance(runId);
      requireEffectiveStep(snapshot.run, stepId);
      return snapshot;
    }
    catch (error) { throw Object.assign(error as object, { details: { ...(error as { details?: object }).details, runId, stepId, reviewId: id, roundId, recoveryCommand: `memsphere run status --run ${runId}`, message: "Review saved; recover status before repeating the vote" } }); }
  }
  ready(snapshot: Snapshot) { const order = this.creationOrder(snapshot.run, snapshot.steps); return snapshot.steps.filter(s => effectiveStep(snapshot.run, s.id) && (s.status === "pending" || s.status === "running") && this.action(snapshot.run, s).artifact).sort((a, b) => order.get(a.id)! - order.get(b.id)!); }
  async finish(runId: string) {
    await this.advance(runId);
    const row = await this.run(runId), snapshot = await this.snapshotValue(runId);
    if (!isDeepStrictEqual(snapshot.run, row.value)) throw failure("REVISION_CONFLICT", "Run changed while checking graph completion");
    if (snapshot.run.status === "done") return snapshot.run; this.active(snapshot.run);
    if (this.frame(snapshot.run).deferredCollects?.length || snapshot.steps.some(s => effectiveStep(snapshot.run, s.id) && (s.status !== "done" || !this.frame(snapshot.run).processedStepIds.includes(s.id))) || this.frame(snapshot.run).pendingSteps.length || this.frame(snapshot.run).joins.some(j => Object.keys(j.arrivals).length)) throw failure("GRAPH_INCOMPLETE", "Graph has unfinished work or a partial join");
    const value = { ...row.value, status: "done" as const, endedAt: now() };
    await this.records.update("run", runId, row, value); return value;
  }
  async abandon(runId: string, reason?: string, source: "cli" | "view" = "cli") {
    const row = await this.run(runId);
    if (row.value.status === "done") throw failure("RUN_FINISHED", "Completed Run cannot be abandoned");
    if (row.value.status !== "abandoned") await this.records.update("run", runId, row, { ...row.value, status: "abandoned", endedAt: now(), abandonment: { source, ...(reason ? { reason } : {}) } });
    // The terminal Run is saved first, so an interrupted cancellation cannot accept votes.
    for (const review of await this.records.list<Review>("review", runId)) {
      if (review.status === "submitted" || review.status === "cancelled") continue;
      const current = await this.records.require<Review>("review", runId, review.id); const value = structuredClone(current.value);
      if (value.status === "submitted" || value.status === "cancelled") continue;
      value.status = "cancelled"; value.endedAt = now();
      const attempt = value.attempts?.at(-1);
      let workerPid: number | undefined;
      if (attempt && !attempt.completion) {
        attempt.completion = { kind: "cancelled", at: now(), stopReason: "run_abandoned" };
        workerPid = attempt.workerPid;
      }
      await this.records.update("review", runId, current, value);
      if (workerPid && workerPid !== process.pid) await terminateProcessTree(workerPid).catch(() => undefined);
    }
    return (await this.run(runId)).value;
  }
}

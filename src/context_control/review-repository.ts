/** Adapts model-backed graph Reviews to the existing Review application protocol.
 * These DTOs are transient; the graph Run never stores legacy artifactReviews.
 */
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { access } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import * as legacy from "../run/store.js";
import type { ArtifactReview, ArtifactReviewComment, ArtifactReviewRound } from "../artifact-review.js";
import { artifactReviewAssignmentId, artifactReviewDispositionValues, artifactReviewWaitReady } from "../artifact-review.js";
import { createControlPlaneSnapshot } from "../control-plane/index.js";
import { openContextControl } from "../project/context-control.js";
import { decodeGraphContent, mimeType } from "./graph-content.js";
import { graphReviewId, projectGraphRound, storeGraphComments } from "./graph-review.js";
import { isGraphRun, type GraphRuntime } from "./graph-runtime.js";
import type { Artifact, Review, Run, Snapshot, Step } from "./types.js";
import { failure } from "./errors.js";
import type { ContextControl } from "./service.js";
export * from "../run/store.js";
const stamp = () => new Date().toISOString();
const digest = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");
export const graphReviewHandle = (run: string, step: string) => `graph-review-${run}__${step}`;
function identity(reviewId: string) {
  if (!reviewId.startsWith("graph-review-")) return undefined;
  const [runId, stepId, ...rest] = reviewId.slice("graph-review-".length).split("__");
  if (!runId || !stepId || rest.length) throw failure("INVALID_ARGUMENT", "Invalid graph Review handle");
  return { runId, stepId };
}
async function use<T>(input: { runsRoot: string; reviewId: string; service?:ContextControl }, action: (g: GraphRuntime, id: { runId: string; stepId: string },service:ContextControl) => Promise<T>): Promise<T> {
  const id = identity(input.reviewId)!; const service = input.service ?? await openContextControl(dirname(input.runsRoot));
  if (!service) throw failure("NOT_FOUND", "Graph model Stores not found");
  return service.withGraph(g => action(g, id,service));
}
function graphFormat(contentType: string) {
  const mime = mimeType(contentType);
  return { name: mime === "text/markdown" ? "markdown" : mime === "application/json" ? "json" : mime.includes("yaml") ? "yaml" : "plain", options: {} };
}
async function artifactDto(service: NonNullable<Awaited<ReturnType<typeof openContextControl>>>, artifact: Artifact): Promise<legacy.RunEvent["artifact"]> {
  const body = await service.body(artifact);
  const value = decodeGraphContent(body.bytes, body.contentType);
  return { name: artifact.name, type: value === null ? "null" : Array.isArray(value) ? "array" : typeof value, format: graphFormat(body.contentType), storage: "inline", value, contentType: body.contentType };
}
async function project(runsRoot: string, snapshot: Snapshot, selected?: string, viewRoundId?:string, viewMaterialIndex?:number,providedService?:ContextControl): Promise<legacy.RunState> {
  const service = providedService ?? (await openContextControl(dirname(runsRoot)))!;
  return service.withGraph(async g => {
    const run = snapshot.run;
    if(viewRoundId==="current")viewRoundId=snapshot.steps.find(s=>s.id===selected)?.reviewRounds?.at(-1)?.id;
    const rules = await g.rules(run);
    const reviews: ArtifactReview<legacy.RunEvent["artifact"]>[] = [];
    for (const step of snapshot.steps.filter(s => s.reviewRounds?.length&&(!selected||s.id===selected))) {
      const rounds: ArtifactReviewRound[] = [], submissions = [];
      for (const round of step.reviewRounds!) {
        const artifact = snapshot.artifacts.find(a => a.id === round.artifactId);
        if (!artifact || artifact.stepId !== step.id) throw failure("INVALID_STATE", "Frozen Review Artifact missing or belongs to another Step");
        const body=!viewRoundId||round.id===viewRoundId?await service.body(artifact):undefined;
        const hash=body?digest(body.bytes):"";
        const value=body?decodeGraphContent(body.bytes,body.contentType):undefined;
        const contentType=body?.contentType??artifact.content?.payload.contentType??"text/plain";
        const dto:legacy.RunEvent["artifact"]={name:artifact.name,type:value===null?"null":Array.isArray(value)?"array":(typeof value==="undefined"?"string":typeof value),format:graphFormat(contentType),storage:"inline",contentType,...(!viewRoundId||round.id===viewRoundId?{value}:{})};
        rounds.push(projectGraphRound(run, step, round, snapshot.reviews.filter(r => r.roundId === round.id), hash));
        const contextArtifacts = [];
        for (const id of new Set(Object.values(step.inputs ?? {}).flat().filter(r => r.kind === "artifact").map(r => r.id))) {
          const material = snapshot.artifacts.find(a => a.id === id);
          if (!material || !snapshot.completeIds.includes(id)) throw failure("INVALID_STATE", `Review material is not accepted: ${id}`);
          contextArtifacts.push({stepId:material.stepId,artifact:viewRoundId&&!(round.id===viewRoundId&&contextArtifacts.length===viewMaterialIndex)?{name:material.name,type:"string",format:graphFormat(material.content?.payload.contentType??"text/plain"),storage:"inline" as const}:await artifactDto(service,material)});
        }
        submissions.push({ id: artifact.id, digest: hash, createdAt: round.createdAt, artifact: dto, contextArtifacts,
          ...(artifact.revisedSummary ? { revisionSummary: { body: artifact.revisedSummary, digest: digest(artifact.revisedSummary), createdAt: round.createdAt, previousSubmissionId: artifact.revisedFrom! } } : {}) });
      }
      const last = rounds.at(-1)!;
      reviews.push({ id: graphReviewHandle(run.id, step.id), stepId: step.id, artifactName: g.action(run, step).artifact!.name,
        policyId: step.reviewRounds!.at(-1)!.reviewConfig.policy.id, controlPlane: last.controlPlane!,
        status: run.status === "abandoned" ? "cancelled" : last.status === "passed" ? "passed" : last.status === "changes_requested" ? "awaiting_revision" : last.status === "awaiting_runner_vote" ? "awaiting_runner_vote" : "pending",
        currentRoundId: last.id, createdAt: rounds[0].createdAt, updatedAt: snapshot.reviews.filter(r => step.reviewRounds!.some(round => round.id === r.roundId)).map(r => r.endedAt ?? r.createdAt).sort().at(-1) ?? last.createdAt,
        submissions, rounds, ...(last.result?.status === "passed" ? { outcome: { status: "passed" as const, submissionId: last.submissionId, roundId: last.id, completedAt: last.result.completedAt } } : {}) });
    }
    const step = snapshot.steps.find(s => s.id === selected) ?? snapshot.steps.find(s => s.status === "awaiting_review");
    const a = step && g.action(run, step), sr = a && await g.rules(run, a);
    const dto: legacy.RunState = { contractVersion: 3, id: run.id, name: run.name, language: run.language, status: run.status, procedureName: run.memoryRef!.slice("procedures/".length), memoryRoot: "", createdAt: run.createdAt, updatedAt: run.endedAt ?? run.createdAt,
      assertTree: rules.procedure, frozenMemoryRunId: run.id, stack: [], events: [], artifactReviews: reviews,
      ...(run.permissionConfig ? { controlPlane: createControlPlaneSnapshot({ runner: run.permissionConfig.runner, actors: Object.fromEntries(Object.entries(run.permissionConfig.actors).map(([id, actor]) => [id, actor.kind === "agent" ? { ...actor, agent: { ...actor.agent, idleTimeoutMs: actor.agent.idleTimeoutMs ?? null, maxRuntimeMs: actor.agent.maxRuntimeMs ?? null } } : actor])), acpProviders: {} }) } : {}) };
    if (step && a && sr) dto.stack = [{ type: "procedure", memoryName: dto.procedureName, assertTree: rules.procedure, index: 0, steps: [{ id: step.id, instruction: a.description, actor: a.actor, artifact: a.artifact?.name, type: reviews.find(review => review.stepId === step.id)?.submissions.at(-1)?.artifact.type ?? "string", format: graphFormat(a.artifact?.payload.contentType ?? "text/plain"), assertTree: sr.asserts, suggestTree: sr.suggests, details: [JSON.stringify(a.artifact?.model), JSON.stringify({ artifactAsserts: sr.artifactAsserts, artifactSuggests: sr.artifactSuggests })], reviewPolicy: step.reviewRounds?.at(-1)?.reviewConfig.policy.id }] }];
    return dto;
  });
}
export async function readRun(runsRoot: string, id: string): Promise<legacy.RunState> {
  // A proven flow record keeps its original reader, including bare Run configurations.
  // Shared-source ambiguity is checked by the CLI/View routing boundary.
  let missing: unknown;
  try { return await legacy.readRun(runsRoot, id); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; missing = error; }
  try { await access(join(dirname(runsRoot), "project.json")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw missing; throw error; }
  const service = await openContextControl(dirname(runsRoot)); const run = service && await service.findRun(id);
  if (run && isGraphRun(run)) return project(runsRoot, await service!.snapshot(id));
  throw missing;
}
export async function findArtifactReview(input: Parameters<typeof legacy.findArtifactReview>[0] & {viewRoundId?:string;viewMaterialIndex?:number;service?:ContextControl}) {
  const id = identity(input.reviewId); if (!id) return legacy.findArtifactReview(input);
  const run = await use(input, async (g,_,service) => project(input.runsRoot, await g.reviewSnapshot(id.runId,id.stepId,input.viewRoundId), id.stepId,input.viewRoundId,input.viewMaterialIndex,service));
  const review = run.artifactReviews!.find(r => r.id === input.reviewId);
  if (!review) throw failure("NOT_FOUND", `Graph Step has no Review: ${id.stepId}`);
  return { run, review };
}
export async function readArtifactReviewForActor(input: Parameters<typeof legacy.readArtifactReviewForActor>[0]) {
  if (!identity(input.reviewId)) return legacy.readArtifactReviewForActor(input);
  return legacy.artifactReviewForActor({ ...await findArtifactReview(input), roundId: input.roundId, actorId: input.actorId });
}
export async function readArtifactReviewForRunner(input: Parameters<typeof legacy.readArtifactReviewForRunner>[0]) {
  if (!identity(input.reviewId)) return legacy.readArtifactReviewForRunner(input);
  const value = await findArtifactReview(input); const round = value.review.rounds.find(r => r.id === value.review.currentRoundId)!;
  if (!round.controlPlane!.permissions.runner.effective.includes("artifact.read")) throw failure("PERMISSION_DENIED", "Runner requires artifact.read");
  return { ...value, round };
}
export async function waitForArtifactReview(input: Parameters<typeof legacy.waitForArtifactReview>[0]) {
  if (!identity(input.reviewId)) return legacy.waitForArtifactReview(input);
  const interval = input.pollIntervalMs ?? 1000;
  if (!Number.isFinite(interval) || interval < 0) throw failure("INVALID_ARGUMENT", "Invalid polling interval");
  for (;;) {
    input.signal?.throwIfAborted();
    await use(input, (g, id) => g.advance(id.runId));
    const result = await readArtifactReviewForRunner(input);
    if (artifactReviewWaitReady(result.review, result.round)) return result;
    await delay(interval, undefined, { signal: input.signal });
  }
}
export async function submitArtifactReviewRunnerVote(input: Parameters<typeof legacy.submitArtifactReviewRunnerVote>[0]) {
  if (!identity(input.reviewId)) return legacy.submitArtifactReviewRunnerVote(input);
  await use(input, (g, id) => g.submitReview(id.runId, id.stepId, input.roundId, "runner", input.vote, [], input.comment));
  return readArtifactReviewForRunner(input);
}
function comments(input: legacy.ArtifactReviewDraftInput["comments"]): ArtifactReviewComment[] {
  return input.map(c => ({ ...c, id: c.id ?? `comment-${randomUUID()}`, createdAt: stamp(), updatedAt: stamp() }));
}
export async function submitArtifactReviewHumanAssignmentForRunner(input: Parameters<typeof legacy.submitArtifactReviewHumanAssignmentForRunner>[0]) {
  if (!identity(input.reviewId)) return legacy.submitArtifactReviewHumanAssignmentForRunner(input);
  const context = await findArtifactReview(input);
  if (context.run.id !== input.runId) throw failure("INVALID_ARGUMENT", "Run/Review identity mismatch");
  const round = context.review.rounds.find(r => r.id === input.roundId);
  const actor = round?.assignments.find(a => a.actorId === input.assignmentId || artifactReviewAssignmentId(a) === input.assignmentId)?.actorId;
  if (!actor) throw failure("NOT_FOUND", "Review Assignment not found");
  await use(input, (g, id) => g.submitReview(id.runId, id.stepId, input.roundId, actor, input.vote, comments(input.comments), input.summary, input.authorizationNote));
  return readArtifactReviewForActor({ ...input, actorId: actor });
}
type AttemptInput = { runsRoot: string; reviewId: string; roundId: string; actorId: string; attemptId: string };
async function agentContext(input: AttemptInput): Promise<legacy.ArtifactReviewAgentContext> {
  const context = await readArtifactReviewForActor(input);
  const attempt = context.assignment.attempts?.find(a => a.id === input.attemptId);
  if (!attempt) throw failure("NOT_FOUND", "Review attempt not found");
  return { ...context, attempt };
}
async function mutateAttempt(input: AttemptInput, change: (review: Review, attempt: NonNullable<Review["attempts"]>[number]) => void) {
  await use(input, (g, id) => g.mutateReview(id.runId, id.stepId, input.roundId, input.actorId, async (review, _run, step) => {
    const round = step.reviewRounds!.at(-1)!;
    if (round.reviewConfig.reviewers[input.actorId]?.kind !== "agent") throw failure("INVALID_ARGUMENT", "Expected Agent Reviewer");
    const attempt = review.attempts?.at(-1);
    if (review.status !== "running" || !attempt || attempt.id !== input.attemptId || attempt.completion) throw failure("REVIEW_CONFLICT", "Review attempt is not current and running");
    change(review, attempt);
  }));
  return agentContext(input);
}
export async function claimArtifactReviewAgentAssignment(input: Parameters<typeof legacy.claimArtifactReviewAgentAssignment>[0]) {
  if (!identity(input.reviewId)) return legacy.claimArtifactReviewAgentAssignment(input);
  const located = await findArtifactReview(input);
  const actorId = located.review.rounds.find(r => r.id === input.roundId)?.assignments.find(a => a.actorId === input.actorId || a.id === input.actorId)?.actorId;
  if (!actorId) throw failure("NOT_FOUND", "Agent Assignment not found");
  input = { ...input, actorId };
  let attemptId: string | undefined;
  await use(input, (g, id) => g.mutateReview(id.runId, id.stepId, input.roundId, input.actorId, async (review, _run, step) => {
    if (step.reviewRounds!.at(-1)!.reviewConfig.reviewers[input.actorId]?.kind !== "agent") throw failure("INVALID_ARGUMENT", "Expected Agent Reviewer");
    if (review.status !== "pending") return;
    let attempt = review.attempts?.at(-1);
    if (!attempt) { attempt = { id: `attempt-${randomUUID()}`, createdAt: stamp() }; review.attempts = [attempt]; }
    if (attempt.startedAt || attempt.completion) throw failure("REVIEW_CONFLICT", "Queued Agent attempt is not available");
    attempt.startedAt = stamp(); attempt.workerPid = input.workerPid;
    attemptId = attempt.id; review.status = "running"; review.startedAt ??= attempt.startedAt;
  }));
  return attemptId ? agentContext({ ...input, attemptId }) : undefined;
}
export async function markArtifactReviewAgentCliReady(input: Parameters<typeof legacy.markArtifactReviewAgentCliReady>[0]) {
  if (!identity(input.reviewId)) return legacy.markArtifactReviewAgentCliReady(input);
  return mutateAttempt(input, (_r, a) => { a.cliReadyAt ??= stamp(); a.session = { ...a.session, ...(input.protocolVersion !== undefined ? { protocolVersion: input.protocolVersion } : {}), ...(input.sessionId ? { id: input.sessionId } : {}), ...(input.agentName ? { agentName: input.agentName } : {}), ...(input.agentVersion ? { agentVersion: input.agentVersion } : {}) }; });
}
export async function recordArtifactReviewAgentSession(input: Parameters<typeof legacy.recordArtifactReviewAgentSession>[0]) {
  if (!identity(input.reviewId)) return legacy.recordArtifactReviewAgentSession(input);
  return mutateAttempt(input, (_r, a) => { a.session = { ...a.session, protocolVersion: input.protocolVersion, id: input.sessionId, ...(input.agentName ? { agentName: input.agentName } : {}), ...(input.agentVersion ? { agentVersion: input.agentVersion } : {}) }; });
}
export async function recordArtifactReviewAgentStop(input: Parameters<typeof legacy.recordArtifactReviewAgentStop>[0]) {
  if (!identity(input.reviewId)) return legacy.recordArtifactReviewAgentStop(input);
  const context = await agentContext(input);
  if (context.assignment.status === "submitted") {
    await use(input, (g, id) => g.recordReviewStop(id.runId, id.stepId, input.roundId, input.actorId, input.attemptId, input.stopReason));
    return agentContext(input);
  }
  return mutateAttempt(input, (_r, a) => { a.completion = { kind: "failed", at: stamp(), stopReason: input.stopReason, failure: { stage: "prompt", code: "stopped_before_submit", message: "Agent stopped without submitting its Review" } }; });
}
export async function failArtifactReviewAgentAssignment(input: Parameters<typeof legacy.failArtifactReviewAgentAssignment>[0]) {
  if (!identity(input.reviewId)) return legacy.failArtifactReviewAgentAssignment(input);
  const context = await agentContext(input);
  if (context.assignment.status === "submitted") return context;
  return mutateAttempt(input, (_r, a) => { a.completion = { kind: "failed", at: stamp(), failure: input.failure, ...(input.stopReason ? { stopReason: input.stopReason } : {}) }; });
}
export async function retryArtifactReviewAgentAssignment(input: Parameters<typeof legacy.retryArtifactReviewAgentAssignment>[0]) {
  if (!identity(input.reviewId)) return legacy.retryArtifactReviewAgentAssignment(input);
  const located = await findArtifactReview(input);
  const actorId = located.review.rounds.find(r => r.id === input.roundId)?.assignments.find(a => a.actorId === input.actorId || a.id === input.actorId)?.actorId;
  if (!actorId) throw failure("NOT_FOUND", "Agent Assignment not found");
  input = { ...input, actorId };
  await use(input, (g, id) => g.mutateReview(id.runId, id.stepId, input.roundId, input.actorId, async (review, _run, step) => {
    if (step.reviewRounds!.at(-1)!.reviewConfig.reviewers[input.actorId]?.kind !== "agent" || review.attempts?.at(-1)?.completion?.kind !== "failed") throw failure("INVALID_ARGUMENT", "Only a failed Agent assignment may be retried");
    review.status = "pending"; review.comments = []; delete review.vote;
    review.attempts = [...(review.attempts ?? []), { id: `attempt-${randomUUID()}`, createdAt: stamp() }];
  }));
  const context = await readArtifactReviewForActor(input);
  return { ...context, attempt: context.assignment.attempts!.at(-1)! };
}
export async function appendArtifactReviewAgentComment(input: Parameters<typeof legacy.appendArtifactReviewAgentComment>[0]) {
  if (!identity(input.reviewId)) return legacy.appendArtifactReviewAgentComment(input);
  if (!input.body.trim() || !["blocking", "risk", "suggestion"].includes(input.severity)) throw failure("INVALID_ARGUMENT", "Comment body and severity required");
  const context = await readArtifactReviewForActor(input);
  const submission = context.review.submissions.find(s => s.id === context.round.submissionId)!;
  const stored = storeGraphComments([{ id: `comment-${randomUUID()}`, body: input.body, severity: input.severity, createdAt: stamp(), updatedAt: stamp(), ...(input.anchor ? { anchor: { ...input.anchor, submissionId: input.anchor.submissionId ?? submission.id } } : {}) }], submission.id, submission.digest);
  return mutateAttempt(input, review => { review.comments.push(...stored); });
}
export async function submitArtifactReviewAgentAssignment(input: Parameters<typeof legacy.submitArtifactReviewAgentAssignment>[0]) {
  if (!identity(input.reviewId)) return legacy.submitArtifactReviewAgentAssignment(input);
  const context = await agentContext(input);
  if (context.assignment.status !== "running" || context.attempt.id !== context.assignment.attempts?.at(-1)?.id || !context.attempt.cliReadyAt) throw failure("REVIEW_CONFLICT", "Current Agent attempt requires its CLI handshake before submission");
  await use(input, (g, id) => g.submitReview(id.runId, id.stepId, input.roundId, input.actorId, input.vote, context.assignment.draft.comments, input.summary, undefined, { attemptId: input.attemptId }));
  return agentContext(input);
}
export async function updateArtifactReviewDraft(input: Parameters<typeof legacy.updateArtifactReviewDraft>[0]) {
  if (!identity(input.reviewId)) return legacy.updateArtifactReviewDraft(input);
  await use(input, (g, id) => g.mutateReview(id.runId, id.stepId, input.roundId, input.actorId, async (review, run, step) => {
    const round = step.reviewRounds!.at(-1)!;
    const all = await g.records.list<Review>("review", run.id);
    const state = projectGraphRound(run, step, round, all);
    if (state.revision !== input.expectedRevision) throw new legacy.ArtifactReviewConflictError(round.id, state.revision);
    if (round.reviewConfig.reviewers[input.actorId]?.kind !== "human" || review.status === "submitted") throw failure("REVIEW_CONFLICT", "Human Draft is read-only");
    const permissions = round.reviewConfig.reviewers[input.actorId].permissions;
    if (!permissions.some(p => p === "decision.assess" || p === "decision.decide")) throw failure("PERMISSION_DENIED", "Reviewer cannot submit an opinion");
    const artifact = (await g.records.require<Artifact>("artifact", run.id, round.artifactId)).value;
    const service = (await openContextControl(dirname(input.runsRoot)))!;
    const hash = digest((await service.body(artifact)).bytes);
    if (!permissions.includes("decision.decide") && input.draft.comments.some(c => !c.severity)) throw failure("INVALID_ARGUMENT", "Advisory comment requires severity");
    review.comments = storeGraphComments(comments(input.draft.comments).map(comment => ({ ...comment, createdAt: review.comments.find(old => old.id === comment.id)?.createdAt ?? comment.createdAt })), round.artifactId, hash);
    if (input.draft.vote) review.vote = { value: input.draft.vote }; else delete review.vote;
  }));
  return readArtifactReviewForActor(input);
}
export async function submitArtifactReviewAssignment(input: Parameters<typeof legacy.submitArtifactReviewAssignment>[0]) {
  if (!identity(input.reviewId)) return legacy.submitArtifactReviewAssignment(input);
  const context = await readArtifactReviewForActor(input);
  if (context.round.revision !== input.expectedRevision) throw new legacy.ArtifactReviewConflictError(input.roundId, context.round.revision);
  if (context.assignment.actorKind !== "human" || !context.assignment.draft.vote) throw failure("INVALID_ARGUMENT", "Human Draft vote required");
  await use(input, (g, id) => g.submitReview(id.runId, id.stepId, input.roundId, input.actorId, context.assignment.draft.vote!, context.assignment.draft.comments, undefined, undefined, { expectedRevision: input.expectedRevision, human: true }));
  return readArtifactReviewForActor(input);
}
export async function resolveArtifactReviewComment(input: Parameters<typeof legacy.resolveArtifactReviewComment>[0]) {
  if (!identity(input.reviewId)) return legacy.resolveArtifactReviewComment(input);
  if (!artifactReviewDispositionValues.includes(input.disposition)) throw failure("INVALID_ARGUMENT", "Unknown comment disposition");
  await use(input, (g, id) => g.resolveComment(id.runId, id.stepId, input.roundId, { commentId: input.commentId, value: input.disposition, note: input.note ?? "", ...(input.validationSummary ? { validationSummary: input.validationSummary } : {}) }));
  return readArtifactReviewForRunner(input);
}

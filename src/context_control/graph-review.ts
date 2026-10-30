import { createHash, randomUUID } from "node:crypto";
import { authorizeArtifactOperation, createControlPlaneSnapshot, type ArtifactControlPlane, type ControlPlaneConfig, type PermissionId } from "../control-plane/index.js";
import { evaluateArtifactReviewRound, type ArtifactReviewAssignment, type ArtifactReviewComment, type ArtifactReviewRound, type ArtifactReviewVoteValue } from "../artifact-review.js";
import type { GraphAction, GraphProcedureMemory } from "../memory/ast.js";
import type { Review, ReviewRound, Run, Step } from "./types.js";
import { failure } from "./errors.js";

export const graphScope = (procedure: string, action: string) => `${procedure}#actions[${action}]`;
export const graphReviewId = (roundId: string, actor: string) => `review-${createHash("sha256").update(JSON.stringify([roundId, actor])).digest("hex").slice(0, 32)}`;
export function storeGraphComments(comments: ArtifactReviewComment[], artifactId: string, digest: string): Review["comments"] {
  const ids = new Set<string>();
  return comments.map(comment => {
    const id = comment.id || `comment-${randomUUID()}`;
    if (!comment.body.trim() || ids.has(id)) throw failure("INVALID_ARGUMENT", "Review comments require nonblank bodies and distinct ids");
    ids.add(id);
    if (comment.anchor && (comment.anchor.submissionId !== artifactId || comment.anchor.sourceHash !== digest)) throw failure("REVIEW_CONFLICT", "Comment anchor targets a stale Submission");
    if (comment.anchor && (!comment.anchor.target.trim() || (comment.anchor.context?.length ?? 0) > 500)) throw failure("INVALID_ARGUMENT", "Comment anchor requires a location and at most 500 context characters");
    return { id, body: comment.body, createdAt: comment.createdAt || new Date().toISOString(), ...(comment.severity ? { severity: comment.severity } : {}),
      ...(comment.anchor ? { anchor: { location: comment.anchor.location?.trim() || comment.anchor.target.trim(), ...(comment.anchor.context ? { context: comment.anchor.context } : {}) } } : {}) };
  });
}
export function graphPermissionConfig(config: ControlPlaneConfig, language: Run["language"]): NonNullable<Run["permissionConfig"]> {
  const snapshot = createControlPlaneSnapshot(config);
  const actors = Object.fromEntries(Object.entries(snapshot.actors).map(([id, actor]) => {
    const value = JSON.parse(JSON.stringify({ ...actor, name: actor.name || id }));
    if (value.agent?.idleTimeoutMs == null) delete value.agent?.idleTimeoutMs;
    if (value.agent?.maxRuntimeMs == null) delete value.agent?.maxRuntimeMs;
    return [id, value];
  }));
  return {
    revision: snapshot.revision,
    permissionDescriptions: Object.fromEntries(snapshot.permissionCatalog.definitions.map(p => [p.id, { id: p.id, description: p.descriptions[language] }])),
    decisionPolicies: Object.fromEntries(snapshot.decisionPolicyCatalog.definitions.map(({ version: _version, ...p }) => [p.id, p])),
    runner: snapshot.runner, actors
  };
}
export function createGraphRound(run: Run, procedure: GraphProcedureMemory, action: GraphAction, artifactId: string): ReviewRound | undefined {
  const slots = action.artifact?.review ?? [];
  if (!slots.length) return undefined;
  const bindings: ReviewRound["reviewConfig"]["bindings"] = {};
  const reviewers: ReviewRound["reviewConfig"]["reviewers"] = {};
  for (const slot of slots) {
    const key = `${procedure.names[0]}::${slot}`;
    const binding = run.reviewConfig?.reviewBindings[key];
    if (!binding) throw failure("REVIEW_CONFIGURATION_REQUIRED", `Missing Review Slot binding: ${key}`);
    if ("skip" in binding) { bindings[key] = { actorIds: [], skipped: true }; continue; }
    bindings[key] = { actorIds: [...binding.actorIds] };
    for (const actorId of binding.actorIds) {
      const actor = run.permissionConfig && Object.hasOwn(run.permissionConfig.actors, actorId) ? run.permissionConfig.actors[actorId] : undefined;
      if (!actor || !actor.permissions.includes("artifact.read") || !actor.permissions.some(p => p === "decision.assess" || p === "decision.decide")) throw failure("PERMISSION_DENIED", `Reviewer ${actorId} requires artifact.read and decision.assess/decide`);
      reviewers[actorId] = { id: actorId, kind: actor.kind, name: actor.name || actorId, permissions: [...actor.permissions] };
    }
  }
  if (!Object.keys(reviewers).length) return undefined;
  const policyId = run.reviewConfig?.reviewPolicies[graphScope(procedure.names[0], action.id)]?.policy;
  const policy = policyId && run.permissionConfig?.decisionPolicies[policyId];
  if (!policy || policy.kind !== "artifact_acceptance" || policy.completion !== "all_assigned" || policy.resolution !== "unanimous") throw failure("REVIEW_CONFIGURATION_REQUIRED", "Unsupported or missing Review decision policy");
  const runner = run.permissionConfig!.runner;
  if (!runner.permissions.includes("artifact.read")) throw failure("PERMISSION_DENIED", "Runner requires artifact.read for formal Review");
  if (!runner.permissions.includes("decision.decide") && !Object.values(reviewers).some(a => a.permissions.includes("decision.decide"))) throw failure("PERMISSION_DENIED", "Review has no decision authority");
  return { id: `round-${randomUUID()}`, artifactId, createdAt: new Date().toISOString(), reviewConfig: { policy: structuredClone(policy), bindings, reviewers, runner: structuredClone(runner) } };
}
export function pendingGraphReviews(round: ReviewRound): Review[] {
  return Object.keys(round.reviewConfig.reviewers).map(actorId => ({
    id: graphReviewId(round.id, actorId), roundId: round.id, artifactId: round.artifactId,
    reviewer: { role: "reviewer", actorId }, status: "pending", comments: [], createdAt: round.createdAt,
    ...(round.reviewConfig.reviewers[actorId].kind === "agent" ? { attempts: [{ id: `attempt-${graphReviewId(round.id, actorId).slice(7)}`, createdAt: round.createdAt }] } : {})
  }));
}
export function graphRoundControlPlane(run: Run, step: Step, round: ReviewRound): ArtifactControlPlane {
  const permission = (permissions: PermissionId[], source: string) => ({ base: permissions, grants: [], effective: permissions, authoritySource: source });
  return {
    revision: run.permissionConfig!.revision,
    artifactScope: graphScope(run.memoryRef!.slice("procedures/".length), step.source!.actionId), policyId: round.reviewConfig.policy.id,
    bindings: Object.fromEntries(Object.entries(round.reviewConfig.bindings).map(([key, b]) => [key, { ...b, source: "run:reviewConfig" }])),
    permissions: { runner: permission(round.reviewConfig.runner.permissions, "run:permissionConfig.runner"), ...Object.fromEntries(Object.entries(round.reviewConfig.reviewers).map(([id, a]) => [id, permission(a.permissions, `run:reviewRound.reviewers.${id}`)])) }
  };
}
export function projectGraphRound(run: Run, step: Step, round: ReviewRound, reviews: Review[], artifactDigest = ""): ArtifactReviewRound {
  reviews = reviews.filter(review => review.roundId === round.id);
  const cp = graphRoundControlPlane(run, step, round);
  const assignments: ArtifactReviewAssignment[] = Object.entries(round.reviewConfig.reviewers).map(([actorId, actor]) => {
    const review = reviews.find(r => r.id === graphReviewId(round.id, actorId));
    const last = review?.attempts?.at(-1);
    const failed = review?.status === "running" && last?.completion?.kind === "failed";
    const submitted = review?.status === "submitted" && review.vote?.value;
    const comments = (review?.comments ?? []).map(c => {
      const { anchor, ...fields } = c;
      return { ...fields, updatedAt: c.createdAt, ...(anchor ? { anchor: { submissionId: round.artifactId, sourceHash: artifactDigest,
        target: anchor.location, location: anchor.location, context: anchor.context } } : {}) };
    });
    const auth = authorizeArtifactOperation({ controlPlane: cp, subject: { kind: "actor", actorId }, permission: actor.permissions.includes("decision.decide") ? "decision.decide" : "decision.assess" });
    return {
      id: graphReviewId(round.id, actorId), actorId, actorName: actor.name, actorKind: actor.kind,
      slotIds: Object.entries(round.reviewConfig.bindings).filter(([, b]) => b.actorIds.includes(actorId)).map(([key]) => key),
      permissions: actor.permissions, binding: actor.permissions.includes("decision.decide") ? "decision" : "advisory",
      status: submitted ? "submitted" : failed ? "failed" : review?.status === "cancelled" ? "cancelled" : review?.status === "running" ? "running" : actor.kind === "agent" ? "queued" : "draft",
      draft: { comments, ...(review?.vote?.value ? { vote: review.vote.value } : {}) },
      ...(submitted ? { submitted: { comments, vote: review!.vote!.value, summary: review!.vote!.summary, submittedAt: review!.endedAt!, authorization: auth,
        ...(review!.vote!.delegationNote ? { delegation: { kind: "runner" as const, runId: run.id, humanActorId: actorId, authorizationNote: review!.vote!.delegationNote, authorization: authorizeArtifactOperation({ controlPlane: cp, subject: { kind: "runner" }, permission: "decision.decide" }) } } : {}) } } : {}),
      attempts: review?.attempts?.map((attempt, index) => ({ id: attempt.id, sequence: index + 1,
        status: attempt.completion?.kind === "failed" ? "failed" : attempt.completion?.kind === "cancelled" ? "cancelled" : review.status === "submitted" ? "submitted" : !attempt.startedAt ? "queued" : "running",
        provider: run.permissionConfig!.actors[actorId].kind === "agent" ? (run.permissionConfig!.actors[actorId] as Extract<NonNullable<Run["permissionConfig"]>["actors"][string], { kind: "agent" }>).agent.provider : "",
        createdAt: attempt.createdAt, startedAt: attempt.startedAt, workerPid: attempt.workerPid, cliReadyAt: attempt.cliReadyAt, promptVersion: attempt.promptVersion,
        sessionId: attempt.session?.id, protocolVersion: attempt.session?.protocolVersion, agentName: attempt.session?.agentName, agentVersion: attempt.session?.agentVersion, model: attempt.session?.model,
        completedAt: attempt.completion?.at, stopReason: attempt.completion?.stopReason,
        failure: attempt.completion?.failure as import("../artifact-review.js").ArtifactReviewAgentFailure | undefined }))
    };
  });
  const dto: ArtifactReviewRound = { id: round.id, sequence: (step.reviewRounds ?? []).findIndex(r => r.id === round.id) + 1, submissionId: round.artifactId,
    status: "pending", revision: parseInt(createHash("sha256").update(JSON.stringify({ reviews, resolutions: round.resolutions ?? [] })).digest("hex").slice(0, 12), 16), createdAt: round.createdAt, assignments, votes: [], controlPlane: cp };
  if (round.resolutions) dto.commentDispositions = round.resolutions.map(r => ({ commentId: r.commentId, disposition: r.value, note: r.note, updatedAt: r.updatedAt, ...(r.validationSummary ? { validationSummary: r.validationSummary } : {}) }));
  for (const a of assignments) if (a.submitted) dto.votes.push({ id: `vote-${a.id}`, subject: { kind: "actor", actorId: a.actorId }, binding: a.binding, value: a.submitted.vote, automatic: false, authorization: a.submitted.authorization, submittedAt: a.submitted.submittedAt });
  const runner = reviews.find(r => r.roundId === round.id && r.reviewer.role === "runner" && r.status === "submitted");
  if (runner?.vote) dto.votes.push({ id: `vote-${runner.id}`, subject: { kind: "runner" }, binding: "decision", value: runner.vote.value, automatic: false,
    comment: runner.vote.summary, authorization: authorizeArtifactOperation({ controlPlane: cp, subject: { kind: "runner" }, permission: "decision.decide" }), submittedAt: runner.endedAt! });
  if (assignments.every(a => a.status === "submitted")) {
    const humanRejected = dto.votes.some(v => v.binding === "decision" && v.subject.kind === "actor" && v.value !== "approve");
    if (!humanRejected && round.reviewConfig.runner.permissions.includes("decision.decide") && !runner) dto.status = "awaiting_runner_vote";
    else { dto.result = evaluateArtifactReviewRound(dto, runner?.endedAt ?? reviews.map(r => r.endedAt ?? r.createdAt).sort().at(-1) ?? round.createdAt); dto.status = dto.result!.status; }
  }
  return dto;
}
export function requireGraphVote(value: unknown): asserts value is ArtifactReviewVoteValue {
  if (!["approve", "request_changes", "abstain"].includes(value as string)) throw failure("INVALID_ARGUMENT", "Vote must be approve, request_changes, or abstain");
}

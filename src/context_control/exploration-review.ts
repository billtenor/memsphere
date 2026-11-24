import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { ArtifactReviewVoteValue } from "../artifact-review.js";
import type { MemsphereConfig } from "../config.js";
import { assertReviewNodes, createReviewNodes, mutateReviewNode, type NodeMutation } from "../review-nodes.js";
import { failure } from "./errors.js";
import { explorationReviewerConfigError, explorationRules } from "./exploration-contract.js";
import { isGraphRun } from "./graph-runtime.js";
import { graphPermissionConfig, graphReviewId } from "./graph-review.js";
import { definitionHash } from "./model-assets.js";
import { Records } from "./records.js";
import type { ContextControl } from "./service.js";
import type { Artifact, External, Ref, Review, ReviewRound, Run, Step } from "./types.js";

const prefix = "exploration-review-";
export const explorationReviewHandle = (run: string, review: string) => `${prefix}${run}__${review}`;
export function explorationReviewIdentity(handle: string) {
  if (!handle.startsWith(prefix)) return undefined;
  const match = /^exploration-review-(run-[a-z0-9-]+)__(review-[a-f0-9]{32})$/.exec(handle);
  if (!match) throw failure("INVALID_ARGUMENT", "Invalid exploration Review handle");
  return { runId: match[1], recordId: match[2] };
}
export const isModelReviewHandle = (handle: string) => handle.startsWith(prefix) || handle.startsWith("graph-review-");
export const reviewBodyDigest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export class ExplorationReviews {
  readonly records: Records;
  constructor(readonly service: ContextControl) { this.records = new Records(service.stores); }

  async start(config: MemsphereConfig, runId: string, artifactId: string, signal?: AbortSignal) {
    const run = await this.run(runId, true);
    const artifactRow = await this.records.require<Artifact>("artifact", runId, artifactId);
    const artifact = artifactRow.value;
    const stepRow = await this.records.require<Step>("step", runId, artifact.stepId);
    this.requireSubmitted(runId, artifact, stepRow.value);
    const setting = stepRow.value.reviewConfiguration ?? {};
    if (!setting.reviewer) throw failure("REVIEWER_REQUIRED", "Configure the Step reviewer before starting a Review");
    const configured = config.controlPlane ?? { runner: { permissions: ["artifact.read", "decision.decide"] }, actors: {}, acpProviders: {} };
    const runner = setting.reviewer === "runner";
    const projectId = setting.reviewer.startsWith("project:") ? setting.reviewer.slice(8) : "";
    const actor = !runner && Object.hasOwn(configured.actors, projectId) ? configured.actors[projectId] : undefined;
    if (!runner && (actor?.kind !== "agent" || !actor.permissions.includes("artifact.read") || !actor.permissions.some(p => p === "decision.assess" || p === "decision.decide")))
      throw failure("INVALID_REVIEWER", explorationReviewerConfigError(config, setting.reviewer) ?? "The configured Project reviewer is unavailable");
    if (!configured.runner.permissions.includes("artifact.read") || runner && !configured.runner.permissions.includes("decision.decide"))
      throw failure("PERMISSION_DENIED", "Runner lacks the permissions for this Review");
    const actorId = runner ? "runner" : projectId === "runner" ? "project:runner" : projectId;
    const permissions = graphPermissionConfig({ ...configured, actors: actor ? { [actorId]: actor } : {} }, run.language);
    let rules;
    try { rules = await explorationRules(config, setting); }
    catch (error) { throw failure("INVALID_REVIEW_RULES", error instanceof Error ? error.message : String(error)); }
    if (!rules.asserts.count && !rules.suggests.count) throw failure("REVIEW_RULES_REQUIRED", "Configure a Statement with effective Review rules");
    const context = await Promise.all(artifact.dependencies.filter(ref => ref.kind === "artifact").map(ref => this.accepted(runId, ref.id)));
    const externals = [...new Set([artifact, ...context.map(value => value.artifact)].flatMap(a => a.dependencies.filter(ref => ref.kind === "external").map(ref => ref.id)))];
    const bodies: Array<{ ref: Ref; value: Artifact | External }> = [
      ...[artifact, ...context.map(value => value.artifact)].map(value => ({ ref: { kind: "artifact" as const, id: value.id }, value })),
      ...await Promise.all(externals.map(async id => ({ ref: { kind: "external" as const, id }, value: await this.external(runId, id) })))
    ];
    const materials = await Promise.all(bodies.map(async ({ ref, value }) => {
      const body = await this.service.body(value, { signal });
      return { ...ref, sha256: reviewBodyDigest(body.bytes), contentType: body.contentType };
    }));
    const configuration = { asserts: rules.asserts.references, suggests: rules.suggests.references, reviewer: setting.reviewer };
    const nodes = createReviewNodes([{ source: { kind: "step", path: "." }, name: artifact.name, asserts: rules.asserts.tree, suggests: rules.suggests.tree }], run.language === "en" ? "Open review" : "开放审查");
    const fingerprint = definitionHash({ configuration, tree: nodes.nodeTree, materials: [...materials].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)), permissions });
    const matching = (await this.records.listRows<Review>("review", runId)).filter(({ value }) => value.artifactId === artifactId && value.exploration?.fingerprint === fingerprint);
    const active = matching.find(({ value }) => value.status === "pending" || value.status === "running");
    signal?.throwIfAborted();
    if (active) return (await this.locate(runId, active.value.id)).row.value;
    const previous = matching.filter(({ value }) => value.status === "submitted").sort((a, b) =>
      (a.value.endedAt ?? "").localeCompare(b.value.endedAt ?? "") || a.value.id.localeCompare(b.value.id));
    // The count is monotonic even if several rounds completed on the same clock tick.
    const roundId = `round-${definitionHash([runId, artifactId, fingerprint, previous.at(-1)?.value.id, previous.length]).slice(0, 32)}`;
    const id = graphReviewId(roundId, actorId);
    const now = this.service.runtime.now();
    const value: Review = { ...nodes, id, roundId, artifactId, reviewer: actor ? { role: "reviewer", actorId, source: "agent" } : { role: "runner" },
      status: actor ? "pending" : "running", comments: [], createdAt: now, ...(actor ? { attempts: [{ id: `attempt-${id.slice(7)}`, createdAt: now }] } : { startedAt: now }),
      exploration: { runId, stepId: stepRow.value.id, fingerprint, materials, configuration, permissions } };
    await this.run(runId, true);
    signal?.throwIfAborted();
    try { await this.records.create("review", runId, value, { signal }); }
    catch (error) {
      if ((error as { code?: string }).code !== "ALREADY_EXISTS") throw error;
      const { row } = await this.locate(runId, id);
      if (row.value.artifactId !== artifactId || row.value.exploration?.fingerprint !== fingerprint) throw failure("REVIEW_CONFLICT", "Concurrent Review identity differs");
      return row.value;
    }
    return value;
  }

  async run(runId: string, active = false) {
    const run = await this.service.findRun(runId);
    if (!run) throw failure("NOT_FOUND", `Run not found: ${runId}`);
    if (isGraphRun(run)) throw failure("INVALID_ARGUMENT", "Expected a free exploration Run");
    if (active && run.status !== "running") throw failure("REVIEW_CONFLICT", "The Run is no longer active");
    return run;
  }

  async list(runId: string, artifactId?: string) {
    await this.run(runId);
    if (artifactId !== undefined) await this.records.require<Artifact>("artifact", runId, artifactId);
    return (await this.records.list<Review>("review", runId))
      .filter(review => review.exploration?.runId === runId && (artifactId === undefined || artifactId === review.artifactId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async locate(runId: string, recordId: string) {
    const run = await this.run(runId);
    const row = await this.records.require<Review>("review", runId, recordId);
    const { exploration, artifactId, roundId, reviewer } = row.value;
    const actor = reviewer.actorId ?? "runner";
    if (!exploration || exploration.runId !== runId || !roundId || recordId !== graphReviewId(roundId, actor))
      throw failure("NOT_FOUND", "Exploration Review not found in this Run");
    const { artifact, step } = await this.accepted(runId, artifactId);
    if (step.id !== exploration.stepId || exploration.materials[0]?.kind !== "artifact" || exploration.materials[0].id !== artifactId)
      throw failure("REVIEW_CONTEXT_INVALID", "Exploration Review does not match its frozen candidate");
    const permissions = exploration.permissions;
    const reviewerActor = actor === "runner" || !Object.hasOwn(permissions.actors, actor) ? undefined : permissions.actors[actor];
    if (actor !== "runner" && reviewerActor?.kind !== "agent") throw failure("REVIEW_CONTEXT_INVALID", "Frozen Project reviewer is invalid");
    const policy = permissions.decisionPolicies["artifact_acceptance.unanimous"];
    const round: ReviewRound = {
      id: roundId, artifactId, createdAt: row.value.createdAt, reviewConfig: {
        policy, runner: permissions.runner,
        bindings: reviewerActor ? { reviewer: { actorIds: [actor] } } : {},
        reviewers: reviewerActor ? { [actor]: { id: actor, kind: "agent", name: reviewerActor.name || actor, permissions: reviewerActor.permissions } } : {}
      }
    };
    return { run, row, artifact, step, actor, round, permissions };
  }

  async materials(runId: string, review: Review) {
    await this.run(runId);
    const refs = review.exploration?.materials;
    if (!refs || review.exploration?.runId !== runId) throw failure("REVIEW_CONTEXT_INVALID", "Frozen materials are unavailable");
    const items = await Promise.all(refs.map(async ref => {
      const material = ref.kind === "artifact" ? await this.accepted(runId, ref.id) : { external: await this.external(runId, ref.id) };
      const body = await this.service.body("artifact" in material ? material.artifact : material.external);
      if (reviewBodyDigest(body.bytes) !== ref.sha256 || body.contentType !== ref.contentType) throw failure("REVIEW_CONTEXT_INVALID", `Frozen material changed: ${ref.id}`);
      return { ...material, id: ref.id, body };
    }));
    return { bodies: new Map(items.map(item => [item.id, item.body])), artifacts: items.flatMap(i => "artifact" in i ? [i.artifact] : []), steps: items.flatMap(i => "step" in i ? [i.step] : []),
      externals: items.flatMap(i => "external" in i ? [i.external] : []) };
  }

  async mutate<T>(runId: string, recordId: string, roundId: string, actorId: string, action: (review: Review, run: Run, step: Step, round: ReviewRound) => Promise<T>, lifecycle = false) {
    const current = await this.locate(runId, recordId);
    if (current.round.id !== roundId || current.actor !== actorId) throw failure("PERMISSION_DENIED", "Only the selected reviewer can write to this Review");
    const value = structuredClone(current.row.value);
    if (!lifecycle && (current.run.status !== "running" || !["pending", "running"].includes(value.status)))
      throw failure("REVIEW_CONFLICT", "Review is no longer writable");
    const result = await action(value, current.run, current.step, current.round);
    if (!lifecycle) await this.run(runId, true);
    if (!isDeepStrictEqual(value, current.row.value)) await this.records.update("review", runId, current.row, value);
    return result;
  }

  async submit(runId: string, recordId: string, roundId: string, actorId: string, vote: ArtifactReviewVoteValue, summary?: string, attemptId?: string) {
    const current = await this.locate(runId, recordId);
    await this.materials(runId, current.row.value);
    await this.mutate(runId, recordId, roundId, actorId, async review => {
      if (actorId !== "runner") {
        const attempt = review.attempts?.at(-1);
        if (review.status !== "running" || !attempt || attempt.id !== attemptId || attempt.completion || !attempt.cliReadyAt)
          throw failure("REVIEW_CONFLICT", "Current Agent attempt requires its CLI handshake");
      }
      assertReviewNodes(review, review.comments, true);
      if (vote !== "approve" && !review.comments.length && !summary?.trim()) throw failure("INVALID_ARGUMENT", "Changes or abstention require an explanation");
      review.status = "submitted";
      review.endedAt = this.service.runtime.now();
      review.vote = { value: vote, ...(summary?.trim() ? { summary } : {}) };
      const attempt = review.attempts?.at(-1);
      if (attempt) attempt.completion = { kind: "completed", at: review.endedAt };
    });
  }

  async recordProcesses(runId: string, recordId: string, input: { roundId: string; actorId: string; attemptId: string; workerPid: number; providerPid?: number }) {
    const workers = this.service.runtime.workers;
    await this.mutate(runId, recordId, input.roundId, input.actorId, async value => {
      const attempt = value.attempts?.at(-1);
      if (attempt?.id !== input.attemptId || !attempt.workerIdentity || attempt.workerPid !== input.workerPid || workers.pid !== input.workerPid)
        throw failure("PROCESS_IDENTITY_UNAVAILABLE", "Worker lifecycle evidence does not match its OS identity");
      const members = await workers.captureGroup(attempt.workerIdentity.group);
      if (!members.some(member => isDeepStrictEqual(member, attempt.workerIdentity)) || !members.some(member => member.pid === input.providerPid))
        throw failure("PROCESS_IDENTITY_UNAVAILABLE", "Worker or Provider is missing from its lifecycle snapshot");
      attempt.workerMembers = [...(attempt.workerMembers ?? []), ...members].filter((member, index, all) => all.findIndex(other => isDeepStrictEqual(member, other)) === index);
    }, true);
  }

  private async accepted(runId: string, id: string) {
    const artifact = (await this.records.require<Artifact>("artifact", runId, id)).value;
    const step = (await this.records.require<Step>("step", runId, artifact.stepId)).value;
    this.requireSubmitted(runId, artifact, step);
    return { artifact, step };
  }

  private requireSubmitted(runId: string, artifact: Artifact, step: Step) {
    if (artifact.status !== "submitted" || step.runId !== runId || step.status !== "done" || step.artifact?.mode !== "produce" || step.artifact.id !== artifact.id)
      throw failure("INCOMPLETE_ARTIFACT", `Artifact not completely submitted: ${artifact.id}`);
  }

  private async external(runId: string, id: string) {
    const external = (await this.records.require<External>("external", runId, id)).value;
    if (external.runId !== runId) throw failure("REVIEW_CONTEXT_INVALID", "External belongs to another Run");
    return external;
  }
}

/** Both Runner and Agent progressive writes use the same node protocol and anchor checks. */
export function mutateModelReviewNode(review: Review, mutation: NodeMutation, allowed: ReadonlySet<string>, now: () => string, newCommentId: () => string) {
  if (!review.nodeTree || !review.nodeStates) throw failure("INVALID_STATE", "Review nodes are not enabled");
  review.comments = mutateReviewNode({ nodeTree: review.nodeTree, nodeStates: review.nodeStates }, review.comments, mutation, item => {
    const anchor = item.anchor;
    if (anchor) {
      if (Object.keys(anchor).some(k => !["location", "context", "targetRef"].includes(k)) || typeof anchor.location !== "string" || !anchor.location.trim()
        || anchor.context !== undefined && (typeof anchor.context !== "string" || anchor.context.length > 500)) throw failure("INVALID_ARGUMENT", "Invalid Comment anchor");
      const ref = anchor.targetRef;
      if (ref !== undefined && (!ref || typeof ref !== "object" || Object.keys(ref).some(k => !["kind", "id"].includes(k))
        || !allowed.has(`${(ref as Ref).kind}:${(ref as Ref).id}`))) throw failure("INVALID_ARGUMENT", "Comment anchor is outside the current materials");
    }
    return { commentId: newCommentId(), body: item.body, severity: item.severity, createdAt: now(), ...(anchor ? { anchor: anchor as NonNullable<Review["comments"][number]["anchor"]> } : {}) };
  });
}

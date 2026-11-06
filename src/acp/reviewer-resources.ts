import { createHash } from "node:crypto";
import { graphArtifactDto } from "../context_control/review-repository.js";
import { artifactReviewAssignmentId } from "../artifact-review.js";
import { dirname, resolve, relative, isAbsolute, basename, join } from "node:path";
import { open, realpath, rm } from "node:fs/promises";
import { readConfig } from "../config.js";
import { openContextControl } from "../project/context-control.js";
import { boundAgentReviewSession, boundReviewNodeContext } from "./review-session.js";
import { inReviewerSession } from "./reviewer-commands.js";
import { failure } from "../context_control/errors.js";
import type { Artifact, External, Review, Step } from "../context_control/types.js";
import { emitCommandResult } from "../commands/cli-errors.js";

const denied = (id: string) => failure("REVIEW_RESOURCE_DENIED", `Object is outside this Review's fixed context: ${id}`);
export async function reviewerResources() {
  const binding = await boundAgentReviewSession();
  const config = await readConfig(process.env.MEMSPHERE_CONFIG_PATH);
  const service = await openContextControl(dirname(config.runsRoot));
  const runId = process.env.MEMSPHERE_REVIEW_RUN_ID!;
  const run = service && await service.findRun(runId);
  if (!service || !run?.frames?.some(f => f.type === "graph")) return undefined;
  return service.withGraph(async g => {
    const own = (await g.records.require<Review>("review", runId, binding.assignmentId)).value;
    const candidate = (await g.records.require<Artifact>("artifact", runId, own.artifactId)).value;
    const artifacts = [candidate, ...await Promise.all(candidate.dependencies.filter(r => r.kind === "artifact").map(async r => (await g.records.require<Artifact>("artifact", runId, r.id)).value))];
    const steps = await Promise.all([...new Set(artifacts.map(a => a.stepId))].map(async id => (await g.records.require<Step>("step", runId, id)).value));
    for (const a of artifacts.filter(a => a.id !== candidate.id)) {
      const source = steps.find(s => s.id === a.stepId);
      if (source?.status !== "done" || source.artifact?.mode !== "produce" || source.artifact.id !== a.id) throw failure("REVIEW_CONTEXT_INVALID", `Context Artifact was not accepted: ${a.id}`);
    }
    const externals = await Promise.all([...new Set(artifacts.flatMap(a => a.dependencies.filter(r => r.kind === "external").map(r => r.id)))].map(async id => (await g.records.require<External>("external", runId, id)).value));
    if (externals.some(e => e.runId !== runId)) throw failure("REVIEW_CONTEXT_INVALID", "External Run mismatch");
    const confirmations: Review[] = [];
    for (const a of artifacts.filter(a => a.id !== candidate.id)) {
      const rounds = steps.find(s => s.id === a.stepId)!.reviewRounds?.filter(r => r.artifactId === a.id) ?? [];
      if (rounds.length > 1) throw failure("REVIEW_CONTEXT_INVALID", "Ambiguous acceptance Round");
      for (const round of rounds) for (const actor of [...Object.keys(round.reviewConfig.reviewers), "runner"]) {
        const { graphReviewId } = await import("../context_control/graph-review.js");
        const row = await g.records.get<Review>("review", runId, graphReviewId(round.id, actor));
        if (!row || row.value.artifactId !== a.id || row.value.roundId !== round.id) throw failure("REVIEW_CONTEXT_INVALID", "Acceptance Review is missing or inconsistent");
        if (row.value.status === "submitted") confirmations.push({ ...row.value, reviewer: { ...row.value.reviewer, ...(actor !== "runner" ? { source: round.reviewConfig.reviewers[actor]!.kind } : {}) } });
      }
    }
    return { binding, config, service, run, own, candidate, artifacts, steps, externals, confirmations };
  });
}

function contained(root: string, path: string) {
  const r = relative(root, path);
  return r === "" || !isAbsolute(r) && r !== ".." && !r.startsWith("../") && !r.startsWith("..\\");
}
export async function exportReviewerBody(file: string, bytes: Uint8Array) {
  const root = await realpath(process.env.MEMSPHERE_WORKSPACE_ROOT!);
  const target = resolve(file), parent = await realpath(dirname(target));
  // Authorize the canonical parent: Windows short paths and workspace aliases
  // can name the same directory without sharing the root's lexical spelling.
  if (!contained(root, parent)) throw denied(file);
  const canonical = join(parent, basename(target));
  const handle = await open(canonical, "wx");
  let complete = false;
  try {
    if (await realpath(dirname(target)) !== parent || !contained(root, await realpath(target))) throw denied(file);
    await handle.writeFile(bytes);
    if (await realpath(dirname(target)) !== parent) throw denied(file);
    complete = true;
  } finally { await handle.close(); if (!complete) await rm(canonical, { force: true }); }
}

type Options = { run?: string; assignment?: string; artifact?: string | string[]; external?: string; review?: string; round?: string; step?: string; out?: string; output?: "text" | "json" };
export async function tryReviewerResource(operation: string, o: Options): Promise<boolean> {
  if (!inReviewerSession()) return false;
  for (const key of ["artifact", "external", "review", "round", "step", "out"] as const) {
    const value = o[key];
    if (value !== undefined && (typeof value !== "string" || !value.trim())) throw failure("INVALID_ARGUMENT", `${key} must be a nonblank value`);
  }
  const scope = await reviewerResources();
  if (!scope) {
    const context = await boundReviewNodeContext();
    if (o.run && o.run !== context.run.id || o.assignment && o.assignment !== artifactReviewAssignmentId(context.assignment)) throw failure("REVIEW_IDENTITY_CONFLICT", "Session identity conflicts with target");
    const submission = context.review.submissions.find(s => s.id === context.round.submissionId)!;
    const allowedSteps = [context.review.stepId, ...submission.contextArtifacts.map(a => a.stepId)];
    if (o.step && !allowedSteps.includes(o.step)) throw denied(o.step);
    if (operation === "run-show" || operation === "step-show") {
      emitCommandResult({ id: context.run.id, name: context.run.name, status: context.run.status, stepIds: o.step ? [o.step] : allowedSteps }, o.output); return true;
    }
    if (operation === "external-show" || o.review || o.artifact) throw denied(String(o.external ?? o.review ?? o.artifact));
    // Legacy candidate/context payload and contracts retain the existing protocol.
    // Explicit Step reads must still use the pinned submission rather than latest Run state.
    if (operation === "artifact-show" && (o.step || o.out)) {
      const item = !o.step || o.step === context.review.stepId ? submission.artifact : submission.contextArtifacts.find(a => a.stepId === o.step)!.artifact;
      const { requireRunContent } = await import("../project/run-data.js");
      const value = item.storage === "file" && item.path ? (await requireRunContent((await readConfig()).runsRoot, "artifact", item.path)).toString("utf8") : item.value;
      if (o.out) await exportReviewerBody(o.out, Buffer.from(typeof value === "string" ? value : JSON.stringify(value)));
      emitCommandResult(o.out ? { out: o.out } : { artifact: { name: item.name, contentType: item.contentType, value } }, o.output); return true;
    }
    return false;
  }
  const { service, run, own, candidate, artifacts, steps, externals, confirmations } = scope;
  if (o.run && o.run !== run.id || o.assignment && o.assignment !== own.id) throw failure("REVIEW_IDENTITY_CONFLICT", "Session identity conflicts with explicit target");
  let result: unknown;
  const selectArtifact = () => {
    if (o.artifact && typeof o.artifact !== "string") throw failure("INVALID_ARGUMENT", "Provide one Artifact ID");
    const matches = artifacts.filter(a => (!o.artifact || a.id === o.artifact) && (!o.step || a.stepId === o.step));
    if (!o.artifact && !o.step) return candidate;
    if (!matches.length) throw denied(String(o.artifact ?? o.step));
    if (matches.length !== 1) throw failure("INVALID_ARGUMENT", "Step has multiple allowed versions; use --artifact");
    return matches[0]!;
  };
  if (operation === "artifact-show" && !o.artifact && !o.step && !o.out) {
    result = { artifactId: candidate.id, artifact: await expanded(candidate), contextArtifacts: await Promise.all(artifacts.filter(a => a.id !== candidate.id).map(async a => ({ artifactId: a.id, stepId: a.stepId, artifact: await expanded(a) }))), contextExternals: externals.map(e => ({ externalId: e.id, source: e.source, viaArtifactIds: artifacts.filter(a => a.dependencies.some(r => r.kind === "external" && r.id === e.id)).map(a => a.id) })), confirmations, revisionSummary: candidate.revisedSummary ? { body: candidate.revisedSummary, digest: createHash("sha256").update(candidate.revisedSummary).digest("hex"), createdAt: steps.find(s => s.id === candidate.stepId)!.reviewRounds!.find(r => r.id === own.roundId)!.createdAt, previousSubmissionId: candidate.revisedFrom } : undefined };
  } else if (["artifact-show", "external-show"].includes(operation)) {
    const item = operation === "artifact-show" ? selectArtifact() : externals.find(e => e.id === o.external);
    if (!item) throw denied(String(o.external));
    const body = await service.body(item);
    if (o.out !== undefined) { await exportReviewerBody(o.out, body.bytes); result = { runId: run.id, id: item.id, contentType: body.contentType, ...("source" in item ? { source: item.source, viaArtifactIds: artifacts.filter(a => a.dependencies.some(r => r.kind === "external" && r.id === item.id)).map(a => a.id) } : {}), out: o.out }; }
    else {
      const text = /^(text\/|application\/(?:json|yaml|x-yaml|xml|javascript))/.test(body.contentType);
      const chars = text ? Array.from(Buffer.from(body.bytes).toString("utf8")) : [];
      result = { runId: run.id, id: item.id, ...("source" in item ? { source: item.source, viaArtifactIds: artifacts.filter(a => a.dependencies.some(r => r.kind === "external" && r.id === item.id)).map(a => a.id) } : { dependencies: item.dependencies }), contentType: body.contentType, ...(text ? { content: chars.slice(0, 200).join("") } : {}), truncated: chars.length > 200, exportCommand: `memsphere run ${operation === "artifact-show" ? "artifact" : "external"} show --run ${run.id} --${operation === "artifact-show" ? "artifact" : "external"} ${item.id} --out <file>` };
    }
  } else if (operation === "artifact-contract") {
    const a = selectArtifact(), step = steps.find(s => s.id === a.stepId)!;
    if (a.id === candidate.id) result = await (await import("./review-session.js")).agentReviewArtifactContractPayload();
    else result = { artifactId: a.id, action: await service.withGraph(async g => g.action(run, step)) };
  } else if (operation === "run-show" || operation === "step-show") {
    if (o.step && !steps.some(s => s.id === o.step)) throw denied(o.step);
    result = { id: run.id, name: run.name, status: run.status, steps: steps.filter(s => !o.step || s.id === o.step).map(s => ({ id: s.id, source: s.source, status: s.status, artifactIds: artifacts.filter(a => a.stepId === s.id).map(a => a.id) })) };
  } else if (operation === "review-show" || operation === "review-list") {
    if (!o.review && !o.artifact) return false;
    if (o.artifact && !artifacts.some(a => a.id === o.artifact && a.id !== candidate.id)) throw denied(String(o.artifact));
    const records = confirmations.filter(r => (!o.review || r.id === o.review) && (!o.artifact || r.artifactId === o.artifact) && (!o.round || r.roundId === o.round));
    if (o.review && !records.length) throw denied(o.review);
    result = operation === "review-show" ? records[0] : records;
  } else return false;
  emitCommandResult(result, o.output);
  return true;
  async function expanded(a: Artifact) { return { ...await graphArtifactDto(service, a), dependencies: a.dependencies }; }
}

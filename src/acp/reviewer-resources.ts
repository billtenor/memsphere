import { z } from "zod";
import { cliCommand, publishResult, previewText } from "../commands/output.js";
import { authoredArtifact, reviewerCandidate } from "../commands/flow-output.js";
import { destination, fixedCandidate, fixedConfirmation, fixedConfirmationList, fixedMaterial,
  fixedReviewContract, fixedRunSummary, publicConfirmation } from "../commands/reviewer-output.js";
import { createHash } from "node:crypto";
import { explorationArtifactDto, graphArtifactDto } from "../context_control/review-repository.js";
import { buildReviewContract } from "./review-contract.js";
import { artifactReviewAssignmentId } from "../artifact-review.js";
import { dirname, resolve, relative, isAbsolute, basename, join } from "node:path";
import { open, realpath, lstat, mkdtemp, link, rm } from "node:fs/promises";
import { readConfig } from "../config.js";
import { boundAgentReviewSession, boundReviewNodeContext, expandReviewArtifact } from "./review-session.js";
import { inReviewerSession } from "./reviewer-commands.js";
import { failure } from "../context_control/errors.js";
import type { Artifact, External, Review, Step } from "../context_control/types.js";
import { MEMSPHERE_SCHEMA_MODEL } from "../memory/schema-model.js";
import { resolvedArtifact } from "../context_control/schema-contract.js";
import { ExplorationReviews, explorationReviewIdentity } from "../context_control/exploration-review.js";

const denied = (id: string) => failure("REVIEW_RESOURCE_DENIED", `Object is outside this Review's fixed context: ${id}`);
export async function reviewerResources() {
  const binding = await boundAgentReviewSession();
  const config = await readConfig(process.env.MEMSPHERE_CONFIG_PATH);
  const service = binding.service;
  const runId = process.env.MEMSPHERE_REVIEW_RUN_ID!;
  const run = service && await service.findRun(runId);
  if (!service || !run) return undefined;
  const exploration = explorationReviewIdentity(binding.reviewId);
  if (exploration) {
    const repository = new ExplorationReviews(service);
    const { row, artifact: candidate } = await repository.locate(runId, exploration.recordId);
    const scope = await repository.materials(runId, row.value);
    return { binding, config, service, run, own: row.value, candidate, ...scope, confirmations: [] as Review[] };
  }
  if (!run.frames?.some(f => f.type === "graph")) return undefined;
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
    return { binding, config, service, run, own, candidate, artifacts, steps, externals, confirmations, bodies: undefined };
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
  // Complete the body privately on the same filesystem. Publishing a hard
  // link is exclusive: a failed write never creates a partial target, and a
  // concurrent destination is neither overwritten nor removed during cleanup.
  const temporary = await mkdtemp(join(parent, ".memsphere-export-"));
  const staged = join(temporary, "body");
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let failed = false;
  try {
    handle = await open(staged, "wx", 0o600);
    const identity = await handle.stat();
    const verify = async (path: string) => {
      if (await realpath(dirname(target)) !== parent) throw denied(file);
      let current;
      try { current = await lstat(path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw denied(file); throw error; }
      if (!current.isFile() || current.dev !== identity.dev || current.ino !== identity.ino) throw denied(file);
    };
    await verify(staged);
    await handle.writeFile(bytes);
    await handle.close();
    handle = undefined;
    await verify(staged);
    await link(staged, canonical);
    await verify(canonical);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try { await handle?.close(); }
    catch (error) { if (!failed) throw error; }
    finally {
      // Never unlink the public target, including after a post-publication
      // identity failure. Preserve the original error if private cleanup fails.
      await rm(temporary, { recursive: true, force: true }).catch(error => { if (!failed) throw error; });
    }
  }
  return relative(root, canonical);
}

type Options = { run?: string; assignment?: string; artifact?: string | string[]; external?: string; review?: string; round?: string; step?: string; out?: string; output?: "text" | "json" };
export async function tryReviewerResource(operation: string, o: Options): Promise<boolean> {
  if (!inReviewerSession()) return false;
  for (const key of ["artifact", "external", "review", "round", "step", "out"] as const) {
    const value = o[key];
    if (value !== undefined && (typeof value !== "string" || !value.trim())) throw failure("INVALID_ARGUMENT", `${key} must be a nonblank value`);
  }
  const scope = await reviewerResources();
  const command = operation === "artifact-contract" ? "run artifact contract show" : "run " + operation.replace("-", " ");
  const format = { format: o.output };
  if (!scope) {
    const context = await boundReviewNodeContext();
    if (o.run && o.run !== context.run.id || o.assignment && o.assignment !== artifactReviewAssignmentId(context.assignment)) throw failure("REVIEW_IDENTITY_CONFLICT", "Session identity conflicts with target");
    const submission = context.review.submissions.find(s => s.id === context.round.submissionId)!;
    const allowedSteps = [context.review.stepId, ...submission.contextArtifacts.map(a => a.stepId)];
    if (o.step && !allowedSteps.includes(o.step)) throw denied(o.step);
    if (operation === "run-show" || operation === "step-show") {
      publishResult(command, () => fixedRunSummary.parse({ id: context.run.id, name: context.run.name,
        status: context.run.status, stepIds: o.step ? [o.step] : allowedSteps
      }), { ...format, locale: context.run.language });
      return true;
    }
    if (operation === "external-show" || o.review || o.artifact) throw Object.assign(failure("INVALID_ARGUMENT", "Fixed targets require a graph Review"), { details: { protocol: "flow" } });
    if (operation === "artifact-contract") {
      if (o.step && o.step !== context.review.stepId) throw Object.assign(failure("INVALID_ARGUMENT", "Historical flow supports the pinned candidate contract only"), { details: { protocol: "flow" } });
      const contract = await (await import("./review-session.js")).agentReviewArtifactContractPayload() as z.input<typeof fixedReviewContract>;
      publishResult(command, () => fixedReviewContract.parse(contract), { ...format, locale: context.run.language });
      return true;
    }
    // Legacy candidate/context payload and contracts retain the existing protocol.
    // Explicit Step reads must still use the pinned submission rather than latest Run state.
    if (operation === "artifact-show" && (o.step || o.out)) {
      const item = !o.step || o.step === context.review.stepId ? submission.artifact : submission.contextArtifacts.find(a => a.stepId === o.step)!.artifact;
      const artifact = await expandReviewArtifact((await readConfig(process.env.MEMSPHERE_CONFIG_PATH)).runsRoot, item);
      const value = artifact.value;
      if (o.out) {
        const out = await exportReviewerBody(o.out, Buffer.from(typeof value === "string" ? value : JSON.stringify(value)));
        const inspect = cliCommand(["run", "artifact", "show", "--step", o.step ?? context.review.stepId], "reviewer");
        publishResult(command, { out }, { ...format, locale: context.run.language, saved: { id: out, inspect } });
      }
      else publishResult(command, () => reviewerCandidate.parse({ artifact: authoredArtifact(artifact)!,
        revisionSummary: !o.step || o.step === context.review.stepId ? submission.revisionSummary : undefined
      }), { ...format, locale: context.run.language });
      return true;
    }
    return false;
  }
  const { service, run, own, candidate, artifacts, steps, externals, confirmations, bodies } = scope;
  if (o.run && o.run !== run.id || o.assignment && o.assignment !== own.id) throw failure("REVIEW_IDENTITY_CONFLICT", "Session identity conflicts with explicit target");
  const display = { ...format, locale: run.language };
  const selectArtifact = () => {
    if (o.artifact && typeof o.artifact !== "string") throw failure("INVALID_ARGUMENT", "Provide one Artifact ID");
    const matches = artifacts.filter(a => (!o.artifact || a.id === o.artifact) && (!o.step || a.stepId === o.step));
    if (!o.artifact && !o.step) return candidate;
    if (!matches.length) throw denied(String(o.artifact ?? o.step));
    if (matches.length !== 1) throw failure("INVALID_ARGUMENT", "Step has multiple allowed versions; use --artifact");
    return matches[0]!;
  };
  if (operation === "artifact-show" && !o.artifact && !o.step && !o.out) {
    publishResult(command, fixedCandidate.parse({
      artifactId: candidate.id, artifact: await expanded(candidate),
      contextArtifacts: await Promise.all(artifacts.filter(a => a.id !== candidate.id).map(async a => ({
        artifactId: a.id, stepId: a.stepId, artifact: await expanded(a)
      }))),
      contextExternals: externals.map(e => ({ externalId: e.id, source: e.source,
        viaArtifactIds: artifacts.filter(a => a.dependencies.some(r => r.kind === "external" && r.id === e.id)).map(a => a.id)
      })),
      confirmations: confirmations.map(publicConfirmation),
      revisionSummary: candidate.revisedSummary ? {
        body: candidate.revisedSummary, digest: createHash("sha256").update(candidate.revisedSummary).digest("hex"),
        createdAt: own.exploration ? own.createdAt : steps.find(s => s.id === candidate.stepId)!.reviewRounds!.find(r => r.id === own.roundId)!.createdAt,
        previousSubmissionId: candidate.revisedFrom
      } : undefined
    }), display);
  } else if (["artifact-show", "external-show"].includes(operation)) {
    const item = operation === "artifact-show" ? selectArtifact() : externals.find(e => e.id === o.external);
    if (!item) throw denied(String(o.external));
    const body = bodies?.get(item.id) ?? await service.body(item);
    const stored = "business" in item ? item.business : undefined;
    const kind = operation === "artifact-show" ? "artifact" : "external";
    const action = cliCommand(["run", kind, "show", "--run", run.id, "--" + kind, item.id, "--out", "<file>"], "reviewer");
    const out = o.out === undefined ? undefined : await exportReviewerBody(o.out, body.bytes);
    const text = /^(text\/|application\/(?:json|yaml|x-yaml|xml|javascript))/.test(body.contentType);
    const preview = text && o.out === undefined ? previewText(Buffer.from(body.bytes).toString("utf8"), 200) : undefined;
    const value = stored && o.out === undefined ? previewText(stored.valueJson, 200) : undefined;
    publishResult(command, () => fixedMaterial.parse({
      runId: run.id, id: item.id, contentType: body.contentType, out,
      content: preview?.text, truncated: preview?.truncated,
      source: "source" in item ? previewText(item.source, 256).text : undefined,
      viaArtifactIds: "source" in item ? artifacts.filter(a => a.dependencies.some(r => r.kind === "external" && r.id === item.id)).map(a => a.id) : undefined,
      dependencies: "dependencies" in item ? visibleDependencies(item) : undefined,
      business: stored && o.out === undefined ? { destination: publicDestination(stored.destination), valuePreview: value?.text, valueTruncated: value?.truncated } : undefined,
      nextAction: o.out === undefined && (!preview || preview.truncated) ? action : undefined
    }), { ...display, saved: out === undefined ? undefined : { id: out, inspect: cliCommand(["run", kind, "show", "--" + kind, item.id], "reviewer") } });
  } else if (operation === "artifact-contract") {
    const a = selectArtifact(), step = steps.find(s => s.id === a.stepId)!;
    if (own.exploration) {
      const dto = await expanded(a);
      const contract = buildReviewContract({ procedureName: "", procedureRules: [], artifactName: a.name,
        step: { instruction: a.name, artifact: a.name, type: dto.type, format: dto.format && { name: dto.format.name, options: dto.format.options ?? {} } } });
      contract.artifact.schema = a.schemaContract;
      publishResult(command, () => fixedReviewContract.parse(contract), display);
    } else publishResult(command, fixedReviewContract.parse(await service.withGraph(async g => {
      const action = g.action(run, step), rules = await g.rules(run, action), dto = await expanded(a);
      const contract = buildReviewContract({ procedureName: run.memoryRef!.slice("procedures/".length), procedureRules: [rules.procedure], artifactName: a.name,
        step: { instruction: action.description, artifact: a.name, type: dto.type, format: dto.format && { name: dto.format.name, options: dto.format.options ?? {} },
          assertTree: rules.asserts, suggestTree: rules.suggests, reviewPolicy: step.reviewRounds?.find(r => r.artifactId === a.id)?.reviewConfig.policy.id,
          details: [JSON.stringify(action.artifact?.model), JSON.stringify({ artifactAsserts: rules.artifactAsserts, artifactSuggests: rules.artifactSuggests })] } });
      if (action.artifact?.model.definedBy === MEMSPHERE_SCHEMA_MODEL) {
        // Use only this authorized Artifact's frozen Action contract. Reuse
        // the runtime's version check; never reread current Project Schema or
        // expose the Run's other Schema contracts.
        resolvedArtifact(run, action.id, action.artifact);
        contract.artifact.schema = structuredClone(run.schemaContracts![action.id]);
      }
      return contract;
    })), display);
  } else if (operation === "run-show" || operation === "step-show") {
    if (o.step && !steps.some(s => s.id === o.step)) throw denied(o.step);
    publishResult(command, () => fixedRunSummary.parse({
      id: run.id, name: run.name, status: run.status,
      steps: steps.filter(s => !o.step || s.id === o.step).map(s => ({
        id: s.id, actionId: s.source?.actionId, status: s.status, artifactIds: artifacts.filter(a => a.stepId === s.id).map(a => a.id)
      }))
    }), display);
  } else if (operation === "review-show" || operation === "review-list") {
    if (!o.review && !o.artifact) return false;
    if (o.artifact && !artifacts.some(a => a.id === o.artifact && a.id !== candidate.id)) throw denied(String(o.artifact));
    const records = confirmations.filter(r => (!o.review || r.id === o.review) && (!o.artifact || r.artifactId === o.artifact) && (!o.round || r.roundId === o.round));
    if (o.review && !records.length) throw denied(o.review);
    if (operation === "review-show") {
      if (!records.length) throw denied(String(o.review ?? o.artifact));
      publishResult(command, () => fixedConfirmation.parse(publicConfirmation(records[0]!)), display);
    } else publishResult(command, () => fixedConfirmationList.parse({ items: records.map(publicConfirmation) }), display);
  } else return false;
  return true;
  function visibleDependencies(a: Artifact) { return bodies ? a.dependencies.filter(ref => bodies.has(ref.id)) : a.dependencies; }
  async function expanded(a: Artifact) {
    const dto = bodies ? explorationArtifactDto(a, bodies.get(a.id)!) : await graphArtifactDto(service, a);
    return { ...authoredArtifact(dto)!, dependencies: visibleDependencies(a),
      business: a.business ? { destination: publicDestination(a.business.destination), value: JSON.parse(a.business.valueJson) } : undefined };
  }
}

function publicDestination({ storeId, dataId, modelRef, operation }: z.input<typeof destination>) {
  return { storeId, dataId, modelRef, operation };
}

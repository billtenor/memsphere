import { invalidCliOptions } from "./cli-errors.js";
import { fixedReviewContract } from "./reviewer-output.js";
import { authoredArtifact, flowArtifactDetail, flowBindings, flowBindingUpdate, flowContractDetail, flowStepDetail,
  legacySchemaWriting, reviewAssignmentReceipt, reviewerAssignment, reviewerCandidate } from "./flow-output.js";
import { runOverviewSchema } from "./run-result.js";
import { z } from "zod";
import { nextAction } from "../prompts/cli-output.js";
import { standaloneCommand, cliCommand, emitCliError, commandFacts, paginateCliItems, previewText } from "./output.js";
import { reviewReceipt } from "./review-output.js";
import { tryReviewerResource } from "../acp/reviewer-resources.js";
import { currentIdentity, readRunnerAgents, detectRunnerAgent, checkQueueCapability } from "../runner/identity.js";
import { currentCommandState, assertSessionTarget, releaseCommandTarget, type CommandStateRow } from "../home/command-state-store.js";
import { explorationReviewIdentity } from "../context_control/exploration-review.js";
import { failure } from "../context_control/errors.js";
import { inspectReview, notificationRound, reviewReady } from "../daemon/review.js";
import { ensureDaemon, ensureClaudeNotificationDaemon, daemonControl } from "../daemon/service.js";
import { registerTask, type DaemonTask } from "../daemon/tasks.js";
import { prepareClaudeReviewRecipient, readClaudeReviewCallback } from "../daemon/claude-review-callback.js";
import { tryContextCommand, startExploration, contextRunList } from "./context-control.js";
import { graphCommand, startGraphIfApplicable, printGraphStart, printGraphReviewOutput } from "./procedure-graph.js";
import type { Snapshot as GraphSnapshot } from "../context_control/types.js";
import { randomUUID } from "node:crypto";
import { lstat, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { requireRunContent } from "../project/run-data.js";
import {
  type ArtifactReview,
  type ArtifactReviewRound
} from "../artifact-review.js";
import { tryRunArtifactReviewAgents } from "../acp/debug.js";
import { dispatchArtifactReviewAgents } from "../acp/dispatcher.js";
import {
  addBoundAgentReviewComment,
  agentReviewArtifactContractPayload,
  agentReviewArtifactPayload,
  agentReviewAssignmentDetailPayload,
  submitBoundAgentReview
} from "../acp/review-session.js";
import { readConfig } from "../config.js";
import { createMemoryCatalogForConfig, createProjectMemoryCatalogs } from "../memory/factory.js";
import { withMemoryChangePreview } from "../memory/changeset.js";
import type { EffectiveRuleTree, RuleChannel } from "../memory/rules.js";
import {
  toEffectiveRuleDisplayEntries,
  toEffectiveRuleDisplayValue,
  type EffectiveRuleDisplayEntry
} from "../memory/serializer.js";
import {
  type RunReviewConfiguration
} from "../control-plane/index.js";
import {
  type PromptLocale
} from "../prompts/index.js";
import {
  abandonRun,
  type ArtifactReportSource,
  buildRunBindingSnapshot,
  buildSchemaWritingSnapshot,
  currentArtifactReview,
  currentFrame,
  currentStep,
  enterSchema,
  ensureCurrentSchemaDraft,
  findArtifactReview,
  normalizeRunName,
  readRun,
  readArtifactReviewForRunner,
  repeatRun,
  resolveArtifactReviewComment,
  retryArtifactReviewAgentAssignment,
  RunReviewConfigurationRequired,
  reportRun,
  type SchemaWritingSnapshot,
  skipRun,
  startRun,
  submitArtifactReviewRunnerVote,
  submitArtifactReviewHumanAssignmentForRunner,
  updateRunSlotBinding,
  waitForArtifactReview,
  type ArtifactReviewDraftInput,
  type RunState
} from "../context_control/review-repository.js";
import { parseModelArtifactWriteOptions } from "../project/model-artifact.js";
import { assertReportExecutionCapability } from "../report-execution.js";
import { legacyRunFacts, emitReviewPreflight } from "./legacy-run-output.js";

type ReportOptions = {
  output?: "text" | "json";
  run?: string;
  step?: string;
  artifact?: string;
  artifactFile?: string;
  writeOptions?: string;
  revisionSummary?: string;
  revisionSummaryFile?: string;
};

type RunStartOptions = {
  file?: string;
  name?: string;
  reviewConfig?: string;
  change?: string;
  output?: "text" | "json";
};

type ReviewWaitOptions = OutputOptions & { review?: string; notificationRound?: string; callback?: string; currentRoundOnly?: boolean; sessionRow?: CommandStateRow };

type ReviewVoteOptions = OutputOptions & {
  review?: string;
  round?: string;
  vote?: string;
  comment?: string;
  commentFile?: string;
};

type ReviewRetryOptions = OutputOptions & { review?: string; assignment?: string };

type ReviewSubmitForHumanOptions = OutputOptions & {
  run?: string;
  review?: string;
  round?: string;
  assignment?: string;
  vote?: string;
  commentsFile?: string;
  summary?: string;
  summaryFile?: string;
  authorizationNote?: string;
  authorizationNoteFile?: string;
};

type ReviewResolveOptions = OutputOptions & {
  review?: string;
  round?: string;
  comment?: string;
  disposition?: "accepted-fixed" | "accepted-followup" | "rejected-out-of-scope" | "rejected-not-blocking" | "rejected-invalid";
  note?: string;
  noteFile?: string;
  validationSummary?: string;
  validationSummaryFile?: string;
};

type RunIdOptions = {
  run?: string;
  output?: "text" | "json";
};

type RunAbandonOptions = RunIdOptions & {
  reason?: string;
  reasonFile?: string;
  actor?: string;
};

type OutputOptions = { output?: "json" | "text" };

type RunShowOptions = RunIdOptions & OutputOptions & { limit?: string; cursor?: string };

type RunStepShowOptions = RunShowOptions & { step?: string };

type RunSchemaShowOptions = RunShowOptions;

type RunBindingShowOptions = RunShowOptions;

type RunBindingUpdateOptions = RunShowOptions & {
  slot?: string;
  actor?: string[];
  skip?: boolean;
};

type RunArtifactShowOptions = RunShowOptions & {
  artifact?: string;
  out?: string;
  assignment?: string;
  step?: string;
};

type AgentReviewAssignmentOptions = OutputOptions & { assignment?: string };

type AgentReviewCommentOptions = AgentReviewAssignmentOptions & {
  body?: string;
  bodyFile?: string;
  bodyStdin?: boolean;
  target?: string;
  location?: string;
  sourceHash?: string;
  submissionId?: string;
  context?: string;
  severity?: "blocking" | "risk" | "suggestion";
};

type AgentReviewSubmitOptions = AgentReviewAssignmentOptions & {
  vote?: string;
  summary?: string;
  summaryFile?: string;
};

export const runStartCommand = standaloneCommand("run start", runStartFacts);

export async function runStartFacts(procedureName: string | undefined, options: RunStartOptions = {}) {
  const procedure = procedureName?.trim();
  const procedureFile = options.file?.trim();
  const changeId = options.change?.trim();
  if (!procedure && !procedureFile) { return startExploration(options); }
  if (procedure && procedureFile) throw new Error("use either a procedure name or --file <path>, not both");
  if (changeId && procedureFile) throw new Error("--change cannot be used with --file");
  const runName = normalizeRunName(options.name);

  const config = await readConfig();
  const reviewConfiguration = options.reviewConfig
    ? parseRunReviewConfiguration(JSON.parse(await readFile(options.reviewConfig, "utf8")))
    : undefined;
  const start = async (source?: {
    memoryRoot: string;
    revision: string;
    provider?: import("../memory/provider.js").MemoryProvider;
    ownership?: import("../app/ownership.js").AppOwnership;
    memorySource: NonNullable<RunState["memorySource"]>;
  }): Promise<RunState | GraphSnapshot> => {
    const graph = await startGraphIfApplicable({ catalog: createMemoryCatalogForConfig(config, source), projectCatalogs: createProjectMemoryCatalogs(config, source), memoryRoot: config.memoryRoot, procedure, file: procedureFile, root: config.scopeRoot, name: runName, language: config.language, controlPlane: config.controlPlane, reviewConfiguration, memorySource: source?.memorySource });
    if (graph) return graph;
    return startRun({
    projectRoot: config.project ? config.scopeRoot : undefined,
    memoryRoot: config.memoryRoot,
    memorySnapshotRoot: source?.memoryRoot,
    memoryOwnership: source?.ownership,
    runsRoot: config.runsRoot,
    name: runName,
    language: config.language,
    procedureName: procedure,
    procedureFile,
    controlPlane: config.controlPlane,
    reviewConfiguration,
    memoryProjects: config.project?.revision ? {
      primary: {
        name: config.project.name,
        revision: source?.revision ?? config.project.revision
      },
      mounted: config.project.mounted.flatMap((project) => project.revision
        ? [{ name: project.name, revision: project.revision }]
        : [])
    } : undefined,
    memorySource: source?.memorySource,
    memoryCatalog: createMemoryCatalogForConfig(config, source),
    projectMemoryCatalogs: createProjectMemoryCatalogs(config, source)
  });
  };
  let run: RunState | GraphSnapshot;
  try {
    if (!changeId) {
      run = await start();
    } else {
      if (!config.project) throw new Error("--change requires a Project-backed Memory store");
      run = await withMemoryChangePreview({
        home: config.homeRoot,
        project: config.project.name,
        changeId,
        use: async (preview) => {
          if (preview.change.status !== "active") {
            throw new Error(`ChangeSet ${changeId} is not active`);
          }
          if (!preview.change.checkpoint?.valid) {
            throw new Error(`ChangeSet ${changeId} does not have a valid checkpoint`);
          }
          const revision = `changeset:${changeId}@${preview.change.checkpoint.digest}`;
          const ownership = structuredClone(preview.change.app_ownership);
          // Provenance comes from the checkpoint; current disable intent still gates new Runs.
          if (ownership) {
            const project = await (await import("../app/composition.js")).appProjectFromRoot(dirname(config.configPath), config.memoryRoot);
            const state = project ? await (await import("../app/state.js")).readAppState(project) : undefined;
            for (const owner of Object.values(ownership)) owner.enabled = owner.enabled && Boolean(state?.installations[owner.id]?.enabled);
          }
          return start({
            memoryRoot: preview.memoryRoot,
            provider: new (await import("../app/ownership.js")).AppSnapshotMemoryProvider(preview.memoryRoot, ownership),
            ownership: preview.change.app_ownership,
            revision,
            memorySource: {
              kind: "changeset",
              project: preview.change.project,
              changeId,
              checkpointDigest: preview.change.checkpoint.digest,
              baseRevision: preview.change.checkpoint.base_revision
            }
          });
        }
      });
    }
  } catch (error) {
    if (!(error instanceof RunReviewConfigurationRequired)) throw error;
    return emitReviewPreflight(error.preflight, {
      project: config.project?.name, name: runName, locale: config.language,
      selector: [...(procedureFile ? ["--file", procedureFile] : [procedure!]), ...(changeId ? ["--change", changeId] : [])]
    });
  }
  if ("run" in run) return printGraphStart(run);
  else return legacyRunFacts("run start", run, config, options.output);
}

export function parseRunReviewConfiguration(value: unknown): RunReviewConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Review configuration must be a JSON object");
  }
  const input = value as Record<string, unknown>;
  const reviewInput = input.reviews;
  const slotInput = input.slots;
  if (!reviewInput || typeof reviewInput !== "object" || Array.isArray(reviewInput)) {
    throw new Error("Review configuration reviews must be an object");
  }
  if (!slotInput || typeof slotInput !== "object" || Array.isArray(slotInput)) {
    throw new Error("Review configuration slots must be an object");
  }
  const reviews: RunReviewConfiguration["reviews"] = {};
  for (const [scope, raw] of Object.entries(reviewInput as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`reviews.${scope} must be an object`);
    const entry = raw as Record<string, unknown>;
    if (typeof entry.policy !== "string" || !entry.policy.trim()) throw new Error(`reviews.${scope}.policy is required`);
    reviews[scope] = {
      policy: entry.policy
    };
  }
  const slots: RunReviewConfiguration["slots"] = {};
  for (const [key, raw] of Object.entries(slotInput as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`slots.${key} must be an object`);
    const entry = raw as Record<string, unknown>;
    if (entry.skip === true) {
      slots[key] = { skip: true };
      continue;
    }
    if (!Array.isArray(entry.actors) || entry.actors.some((actor) => typeof actor !== "string")) {
      throw new Error(`slots.${key}.actors must be a string array or skip must be true`);
    }
    slots[key] = { actorIds: entry.actors as string[] };
  }
  return { reviews, slots };
}

export async function runReportCommand(options: ReportOptions) {
  const contextResult = await tryContextCommand("report", options);
  if (contextResult) return contextResult;
  const runId = requireRunId(options.run);
  let writeOptions;
  if (options.writeOptions !== undefined) {
    let value: unknown;
    try { value = JSON.parse(options.writeOptions); }
    catch { throw new TypeError("--write-options must be an inline JSON object"); }
    writeOptions = parseModelArtifactWriteOptions(value);
  }
  const artifact = readArtifactOption(options);
  if (options.revisionSummary !== undefined && options.revisionSummaryFile !== undefined) {
    throw new Error("use only one of --revision-summary or --revision-summary-file");
  }
  const revisionSummary = options.revisionSummaryFile
    ? await readFile(options.revisionSummaryFile, "utf8")
    : options.revisionSummary;
  const config = await readConfig();
  const run = await reportRun({
    runsRoot: config.runsRoot,
    runId,
    artifact,
    writeOptions,
    revisionSummary,
    beforeArtifactReview: assertReportExecutionCapability
  });
  await dispatchArtifactReviewAgents({ config, run });
  return legacyRunFacts("run report", run, config, options.output, true);
}

export async function runReviewWaitCommand(options: ReviewWaitOptions) {
  const reviewId = options.review?.trim();
  if (!reviewId) throw new Error("--review <id> is required");
  const config = await readConfig();
  if (options.callback !== undefined || options.notificationRound !== undefined) {
    if (options.callback !== undefined && options.notificationRound !== undefined) {
      throw failure("INVALID_ARGUMENT", "Choose a notification reference or a round");
    }
    const delivery = options.callback === undefined ? undefined :
      await readClaudeReviewCallback(config, reviewId, options.callback);
    const context = delivery?.context ?? notificationRound(
      await readArtifactReviewForRunner({ runsRoot: config.runsRoot, reviewId }), options.notificationRound!);
    const historical = context.review.currentRoundId !== context.round.id;
    if (historical && options.currentRoundOnly) throw failure("REVIEW_CONFLICT", "Continue follows the current round");
    const graph = !historical && await printGraphReviewOutput("run review wait", context.review, context.round, context.run.id,
      { readOnly: true, enter: false, output: options.output });
    const receipt = graph || reviewReceipt("run review wait", { project: config.project?.name, ...context, statusOnly: historical });
    if (!delivery) return receipt;
    return { ...receipt, afterDelivery: async () => {
      try { await delivery.acknowledge(); }
      catch { await emitCliError({ code: "NOTIFICATION_READ_RECEIPT_FAILED" }, { nonfatal: true }); }
    } };
  }
  const exploration = explorationReviewIdentity(reviewId), session = exploration ? options.sessionRow ?? await currentCommandState() : undefined;
  const located = await readArtifactReviewForRunner({ runsRoot: config.runsRoot, reviewId });
  if (exploration && !located.round.assignments.length) throw new Error("Use run review show for a Runner Review");
  if (!exploration) {
    const project = config.project!.name;
    const graph = reviewId.startsWith("graph-review-");
    const active = (await currentCommandState())?.value;
    const staleStep = graph && ["passed", "cancelled"].includes(located.review.status)
      && active?.status === "active" && active.parameters.project === project
      && active.groupId === located.run.id && active.parameters.step !== located.review.stepId;
    if (staleStep) {
      if (options.currentRoundOnly) throw failure("SESSION_CONTEXT_CONFLICT", "Continue target has changed");
      return reviewReceipt("run review wait", {
        ...located, project, statusOnly: true
      });
    }
    await assertSessionTarget(project, located.run.id, graph ? located.review.stepId : undefined);
  }
  const finish = async (result: typeof located, enter: boolean) => {
    if (exploration && result.round.assignments.every(a => a.status === "submitted")) {
      await releaseCommandTarget(session, config.project!.name, exploration.runId, { review: reviewId }).catch(() => undefined);
    }
    const graphResult = await printGraphReviewOutput("run review wait", result.review, result.round, result.run.id, { enter, output: options.output });
    if (graphResult) return graphResult;
    return reviewReceipt("run review wait", { project: config.project?.name, ...result });
  };
  await dispatchArtifactReviewAgents({ config, run: located.run });
  const identity = await currentIdentity();
  const context = await inspectReview(config, reviewId);
  if (reviewReady(context)) {
    return finish(context, !identity);
  }
  const runner = identity && (await readRunnerAgents())[identity.agentType];
  if (identity && runner?.async_enabled) {
    const taskInput: DaemonTask["input"] = {
      project: config.project!.name, runId: context.run.id,
      ...(reviewId.startsWith("graph-review-") ? { stepId: context.review.stepId } : {}),
      reviewId, roundId: context.round.id, configPath: config.configPath, cwd: process.cwd()
    };
    let recipient: DaemonTask["recipient"];
    if (identity.agentType === "claude") {
      recipient = await prepareClaudeReviewRecipient(identity.sessionId, taskInput);
      await ensureClaudeNotificationDaemon();
    } else {
      const detected = await detectRunnerAgent(identity.agentType);
      if (!detected.path || detected.status !== "installed") throw new Error("RUNNER_UNAVAILABLE: install the Runner Agent or disable asynchronous execution in settings");
      await checkQueueCapability(detected.path);
      await ensureDaemon();
      recipient = { agentType: identity.agentType, sessionId: identity.sessionId, agentCommand: detected.path };
    }
    const task = await registerTask({ input: taskInput, recipient });
    await daemonControl("notify");
    return reviewReceipt("run review wait", { project: config.project?.name, ...context, taskId: task.id });
  }
  const result = await waitForArtifactReview({ runsRoot: config.runsRoot, reviewId });
  return finish(result, !identity);
}

export async function runReviewVoteCommand(options: ReviewVoteOptions) {
  const reviewId = options.review?.trim();
  const roundId = options.round?.trim();
  if (!reviewId) throw invalidCliOptions("required", "--review");
  if (!roundId) throw invalidCliOptions("required", "--round");
  if (options.vote !== "approve" && options.vote !== "request_changes") {
    throw invalidCliOptions("invalid_value", "--vote");
  }
  if (options.comment !== undefined && options.commentFile !== undefined) {
    throw invalidCliOptions("mutually_exclusive", "--comment", "--comment-file");
  }
  const comment = options.commentFile
    ? await readFile(options.commentFile, "utf8")
    : options.comment;
  const config = await readConfig();
  const target = await inspectReview(config, reviewId);
  await assertSessionTarget(config.project!.name, target.run.id, reviewId.startsWith("graph-review-") ? target.review.stepId : undefined);
  const context = await submitArtifactReviewRunnerVote({
    runsRoot: config.runsRoot,
    reviewId,
    roundId,
    vote: options.vote,
    comment
  });
  const graphResult = await printGraphReviewOutput("run review vote", context.review, context.round, context.run.id,
    { vote: options.vote, output: options.output });
  if (graphResult) return graphResult;
  return reviewReceipt("run review vote", { project: config.project?.name, ...context, vote: options.vote });
}

export async function runReviewRetryCommand(options: ReviewRetryOptions) {
  const reviewId = options.review?.trim();
  if (!reviewId) throw invalidCliOptions("required", "--review");
  const exploration = explorationReviewIdentity(reviewId);
  if (!exploration && !options.assignment?.trim()) throw invalidCliOptions("required", "--assignment");
  if (exploration && options.assignment !== undefined) throw invalidCliOptions("not_allowed", "--assignment");
  const config = await readConfig();
  const located = await findArtifactReview({ runsRoot: config.runsRoot, reviewId });
  const assignment = exploration ? located.review.rounds[0]?.assignments[0]?.actorId : options.assignment?.trim();
  if (!assignment) throw new Error("This Review does not have a delegated Agent assignment");
  const context = await retryArtifactReviewAgentAssignment({
    runsRoot: config.runsRoot,
    reviewId,
    roundId: located.review.currentRoundId,
    actorId: assignment
  });
  await dispatchArtifactReviewAgents({ config, run: context.run });
  return reviewReceipt("run review retry", { project: config.project?.name, ...context,
    assignmentId: context.assignment.id ?? context.assignment.actorId });
}

export const runReviewSubmitForHumanCommand = standaloneCommand("run review submit-for-human", runReviewSubmitForHumanFacts);

export async function runReviewSubmitForHumanFacts(options: ReviewSubmitForHumanOptions) {
  const runId = requireRunId(options.run);
  const reviewId = options.review?.trim();
  const roundId = options.round?.trim();
  const assignmentId = options.assignment?.trim();
  if (!reviewId) throw invalidCliOptions("required", "--review");
  if (!roundId) throw invalidCliOptions("required", "--round");
  if (!assignmentId) throw invalidCliOptions("required", "--assignment");
  if (!options.vote || !["approve", "request_changes", "abstain"].includes(options.vote)) {
    throw invalidCliOptions("invalid_value", "--vote");
  }
  if (!options.commentsFile) throw invalidCliOptions("required", "--comments-file");
  if (options.summary !== undefined && options.summaryFile !== undefined) {
    throw invalidCliOptions("mutually_exclusive", "--summary", "--summary-file");
  }
  if ((options.authorizationNote === undefined) === (options.authorizationNoteFile === undefined)) {
    throw invalidCliOptions("exactly_one_required", "--authorization-note", "--authorization-note-file");
  }
  const comments = parseRunnerDelegatedComments(JSON.parse(await readFile(options.commentsFile, "utf8")));
  const summary = options.summaryFile ? await readFile(options.summaryFile, "utf8") : options.summary;
  const authorizationNote = options.authorizationNoteFile
    ? await readFile(options.authorizationNoteFile, "utf8")
    : options.authorizationNote!;
  const config = await readConfig();
  const context = await submitArtifactReviewHumanAssignmentForRunner({
    runsRoot: config.runsRoot,
    runId,
    reviewId,
    roundId,
    assignmentId,
    vote: options.vote as "approve" | "request_changes" | "abstain",
    comments,
    summary,
    authorizationNote
  });
  const receipt = { assignmentId: context.assignment.id ?? context.assignment.actorId,
    vote: context.assignment.submitted?.vote, output: options.output };
  const graphResult = context.review.status === "awaiting_revision"
    && await printGraphReviewOutput("run review submit-for-human", context.review, context.round, context.run.id, receipt);
  if (graphResult) return graphResult;
  return reviewReceipt("run review submit-for-human", { project: config.project?.name, ...context,
    assignmentId: receipt.assignmentId, vote: receipt.vote });
}

export function parseRunnerDelegatedComments(value: unknown): ArtifactReviewDraftInput["comments"] {
  if (!Array.isArray(value)) throw new Error("--comments-file must contain a JSON array");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`comments[${index}] must be an object`);
    }
    const record = item as Record<string, unknown>;
    assertOnlyKeys(record, ["body", "severity", "anchor"], `comments[${index}]`);
    if (typeof record.body !== "string" || !record.body.trim()) {
      throw new Error(`comments[${index}].body must be a non-empty string`);
    }
    if (record.severity !== undefined && !["blocking", "risk", "suggestion"].includes(String(record.severity))) {
      throw new Error(`comments[${index}].severity is invalid`);
    }
    let anchor: ArtifactReviewDraftInput["comments"][number]["anchor"];
    if (record.anchor !== undefined) {
      if (!record.anchor || typeof record.anchor !== "object" || Array.isArray(record.anchor)) {
        throw new Error(`comments[${index}].anchor must be an object`);
      }
      const raw = record.anchor as Record<string, unknown>;
      assertOnlyKeys(raw, ["submissionId", "target", "location", "sourceHash", "context"], `comments[${index}].anchor`);
      for (const key of ["submissionId", "target", "sourceHash"] as const) {
        if (typeof raw[key] !== "string" || !raw[key].trim()) {
          throw new Error(`comments[${index}].anchor.${key} must be a non-empty string`);
        }
      }
      for (const key of ["location", "context"] as const) {
        if (raw[key] !== undefined && typeof raw[key] !== "string") {
          throw new Error(`comments[${index}].anchor.${key} must be a string`);
        }
      }
      anchor = {
        submissionId: raw.submissionId as string,
        target: raw.target as string,
        location: raw.location as string | undefined,
        sourceHash: raw.sourceHash as string,
        context: raw.context as string | undefined
      };
    }
    return {
      body: record.body,
      severity: record.severity as ArtifactReviewDraftInput["comments"][number]["severity"],
      anchor
    };
  });
}

function assertOnlyKeys(record: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unknown = Object.keys(record).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`${path}.${unknown} is not allowed`);
}

const reviewDisposition = z.object({
  reviewId: z.string(), roundId: z.string(), commentId: z.string(), disposition: z.string(), nextAction
}).strict();

export async function runReviewResolveCommand(options: ReviewResolveOptions) {
  const reviewId = options.review?.trim();
  const roundId = options.round?.trim();
  const commentId = options.comment?.trim();
  if (!reviewId) throw new Error("--review <id> is required");
  if (!roundId) throw new Error("--round <id> is required");
  if (!commentId) throw new Error("--comment <id> is required");
  if (!options.disposition) throw new Error("--disposition is required");
  if (options.note !== undefined && options.noteFile !== undefined) throw new Error("use only one of --note or --note-file");
  if (options.validationSummary !== undefined && options.validationSummaryFile !== undefined) {
    throw new Error("use only one of --validation-summary or --validation-summary-file");
  }
  const note = options.noteFile ? await readFile(options.noteFile, "utf8") : options.note;
  const validationSummary = options.validationSummaryFile
    ? await readFile(options.validationSummaryFile, "utf8")
    : options.validationSummary;
  const config = await readConfig();
  const context = await resolveArtifactReviewComment({
    runsRoot: config.runsRoot,
    reviewId,
    roundId,
    commentId,
    disposition: options.disposition,
    note,
    validationSummary
  });
  return commandFacts(() => reviewDisposition.parse({
    reviewId, roundId, commentId, disposition: options.disposition,
    nextAction: cliCommand(["--project", config.project!.name, "run", "review", "wait", "--review", reviewId])
  }), { saved: { id: commentId, inspect: cliCommand(["--project", config.project!.name, "run", "review", "show", "--review", reviewId, "--round", roundId]) } });
}

export async function runShowCommand(options: RunShowOptions) {
  const resourceResult = await tryReviewerResource("run-show", options);
  if (resourceResult) return resourceResult;
  const contextResult = await tryContextCommand("show", options);
  if (contextResult) return contextResult;
  const runId = requireRunId(options.run);
  const config = await readConfig();
  const run = await readRun(config.runsRoot, runId);
  const locations = runStepLocations(run);
  const frame = currentFrame(run);
  const current = currentStep(run);
  const seen = new Set(run.events.map(event => event.stepId));
  const rows = locations.map(item => ({
    id: locatedStepRef(item),
    actionId: item.step.id,
    status: item.memoryName === frame?.memoryName && item.step.id === current?.id ? "running"
      : seen.has(item.step.id) ? "done" : "pending"
  }));
  const page = paginateCliItems(rows, { limit: options.limit, cursor: options.cursor }, {
    command: "run.show", scope: { project: config.project?.name, runId }
  }, "summary");
  return commandFacts(() => runOverviewSchema.parse({
    run: { id: run.id, name: previewText(run.name ?? run.id, 160).text, status: run.status },
    steps: page.items, stepCount: rows.length, outputArtifactIds: [], outputArtifactCount: 0, nextCursor: page.nextCursor
  }), { locale: run.language });
}

export async function runBindingShowCommand(options: RunBindingShowOptions) {
  const graphResult = await graphCommand("binding-show", options);
  if (graphResult) return graphResult;
  const runId = requireRunId(options.run);
  const config = await readConfig();
  const run = await readRun(config.runsRoot, runId);
  const { runId: id, status, actors, slots, readOnly } = buildRunBindingSnapshot(run);
  return commandFacts(() => flowBindings.parse({ runId: id, status, actors, slots, readOnly }), { locale: run.language });
}

export async function runBindingUpdateCommand(options: RunBindingUpdateOptions) {
  const graphResult = await graphCommand("binding-update", options);
  if (graphResult) return graphResult;
  const runId = requireRunId(options.run);
  const slot = options.slot?.trim();
  if (!slot) throw new Error("--slot <procedure::slot> is required");
  const actorIds = options.actor?.map((actor) => actor.trim()).filter(Boolean);
  if (options.skip && actorIds?.length) throw new Error("use --actor or --skip, not both");
  if (!options.skip && !actorIds?.length) throw new Error("provide at least one --actor <id> or use --skip");
  const config = await readConfig();
  const result = await updateRunSlotBinding({
    runsRoot: config.runsRoot,
    runId,
    slot,
    actorIds: options.skip ? undefined : actorIds,
    skip: options.skip
  });
  const { runId: id, status, actors, slots, readOnly } = result.snapshot;
  return commandFacts(() => flowBindingUpdate.parse({
    changeId: result.change.id, slot, nextBinding: result.change.after,
    bindings: { runId: id, status, actors, slots, readOnly }
  }), { locale: result.run.language, saved: { id: result.change.id, inspect: cliCommand(["--project", config.project!.name, "run", "binding", "show", "--run", id]) } });
}

const tryRunResult = z.object({
  runId: z.string(), items: z.array(z.object({ assignmentId: z.string(), promptPath: z.string(), launchPath: z.string() }).strict())
}).strict();

export async function runTryRunCommand(options: RunIdOptions) {
  const runId = requireRunId(options.run);
  const config = await readConfig();
  const run = await readRun(config.runsRoot, runId);
  const generated = await tryRunArtifactReviewAgents({ config, run });
  return commandFacts(() => tryRunResult.parse({
    runId, items: generated.map(({ assignmentId, promptPath, launchPath }) => ({ assignmentId, promptPath, launchPath }))
  }), { locale: run.language });
}

export async function runStepShowCommand(options: RunStepShowOptions) {
  const resourceResult = await tryReviewerResource("step-show", options);
  if (resourceResult) return resourceResult;
  const contextResult = await tryContextCommand("step-show", options);
  if (contextResult) return contextResult;
  const runId = requireRunId(options.run);
  const stepRef = requireStepRef(options.step);
  const config = await readConfig();
  const run = await readRun(config.runsRoot, runId);
  return commandFacts(() => flowStepDetail.parse(buildRunStepDetail(run, stepRef) as z.input<typeof flowStepDetail>), { locale: run.language });
}

export async function runArtifactShowCommand(options: RunArtifactShowOptions) {
  const resourceResult = await tryReviewerResource("artifact-show", options);
  if (resourceResult) return resourceResult;
  const contextResult = await tryContextCommand("artifact-show", options);
  if (contextResult) return contextResult;
  if (options.assignment) {
    if (options.run || options.step) throw new Error("use --assignment or --run with --step, not both");
    requireBoundAssignment(options.assignment);
    const value = await agentReviewArtifactPayload() as z.input<typeof reviewerCandidate>;
    return commandFacts(() => reviewerCandidate.parse({
      artifact: authoredArtifact(value.artifact)!,
      contextArtifacts: value.contextArtifacts?.map(item => ({
        stepId: item.stepId, artifactId: item.artifactId, artifact: authoredArtifact(item.artifact)!
      })),
      revisionSummary: value.revisionSummary
    }));
  }

  const runId = requireRunId(options.run);
  const stepRef = requireStepRef(options.step);
  const config = await readConfig();
  const run = await readRun(config.runsRoot, runId);
  const value = await buildRunArtifactDetail(config.runsRoot, run, stepRef) as z.input<typeof flowArtifactDetail>;
  return commandFacts(() => flowArtifactDetail.parse({
    stepRef: value.stepRef, source: value.source, artifact: authoredArtifact(value.artifact),
    revisionSummary: value.revisionSummary
  }), { locale: run.language });
}

export async function runArtifactExportCommand(options: { run: string; step: string; file: string; force?: boolean }) {
  const contextResult = await tryContextCommand("schema-export", options);
  if (contextResult) return contextResult;
  const config = await readConfig();
  const run = await readRun(config.runsRoot, requireRunId(options.run));
  await exportRunArtifact(config.runsRoot, run, requireStepRef(options.step), options.file, options.force, join(config.archiveRoot, "runs"));
  return commandFacts(() => z.object({ runId: z.string(), stepRef: z.string(), exported: z.string() }).strict().parse({
    runId: run.id, stepRef: options.step, exported: resolve(options.file)
  }), { locale: run.language, saved: { id: resolve(options.file) } });
}

export async function exportRunArtifact(runsRoot: string, run: RunState, reference: string, file: string, force = false, archivedRunsRoot = join(dirname(runsRoot), "archives", "runs")): Promise<void> {
  const located = findRunStep(run, reference);
  const draft = run.schemaDrafts?.[located.step.id];
  const review = [...(run.artifactReviews ?? [])].reverse().find((candidate) => candidate.stepId === located.step.id);
  const round = review?.rounds.find((candidate) => candidate.id === review.currentRoundId);
  const submission = round && review?.submissions.find((candidate) => candidate.id === round.submissionId);
  const event = [...run.events].reverse().find((candidate) => candidate.stepId === located.step.id);
  const selected = draft && ["writing", "awaiting_finalization"].includes(draft.status) ? draft : submission?.artifact ?? event?.artifact;
  if (!selected?.path) throw new Error(`No file Artifact to export: ${reference}`);
  const bytes = await requireRunContent(runsRoot, "artifact", selected.path);
  await exportArtifactBytes(bytes, file, force, [runsRoot, archivedRunsRoot]);
}

/** Shared local-copy export; callers provide bytes without exposing managed paths. */
export async function exportArtifactBytes(bytes: Uint8Array, file: string, force: boolean, managedRoots: string[]): Promise<void> {
  const target = resolve(file);
  const parent = await realpath(dirname(target));
  try {
    if ((await lstat(target)).isSymbolicLink()) throw new Error(`Artifact export target must not be a symbolic link: ${target}`);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }
  for (const root of managedRoots) {
    const contained = (path: string, boundary: string) => {
      const child = relative(resolve(boundary), path);
      return !child || (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`));
    };
    let resolvedRoot = resolve(root);
    try { resolvedRoot = await realpath(root); } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    }
    if (contained(target, root) || contained(join(parent, basename(target)), resolvedRoot)) throw new Error("Export to a local working copy outside managed Run storage");
  }
  if (!force) await writeFile(target, bytes, { flag: "wx" });
  else {
    // Replace the working-copy entry, not a possibly hard-linked managed inode.
    const temporary = join(parent, `.artifact-export.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, bytes, { flag: "wx" });
      await rename(temporary, target);
    } finally { await rm(temporary, { force: true }); }
  }
}

export async function runArtifactContractShowCommand(options: RunArtifactShowOptions) {
  const resourceResult = await tryReviewerResource("artifact-contract", options);
  if (resourceResult) return resourceResult;
  const graphResult = !options.assignment && await graphCommand("contract-show", options);
  if (graphResult) return graphResult;
  if (options.assignment) {
    if (options.run || options.step) throw new Error("use --assignment or --run with --step, not both");
    requireBoundAssignment(options.assignment);
    const value = await agentReviewArtifactContractPayload() as z.input<typeof fixedReviewContract>;
    return commandFacts(() => fixedReviewContract.parse(value));
  }

  const runId = requireRunId(options.run);
  const stepRef = requireStepRef(options.step);
  const config = await readConfig();
  const run = await readRun(config.runsRoot, runId);
  return commandFacts(() => flowContractDetail.parse(buildRunArtifactContractDetail(run, stepRef) as z.input<typeof flowContractDetail>), { locale: run.language });
}

export async function runReviewAssignmentShowCommand(options: AgentReviewAssignmentOptions) {
  requireBoundAssignment(options.assignment);
  const value = await agentReviewAssignmentDetailPayload() as z.input<typeof reviewerAssignment>;
  return commandFacts(() => reviewerAssignment.parse(value));
}

export async function runReviewCommentCommand(options: AgentReviewCommentOptions) {
  requireBoundAssignment(options.assignment);
  const body = await resolveReviewCommentBody(options);
  if (!options.severity) throw new Error("--severity is required");
  const hasAnchor = options.target !== undefined
    || options.location !== undefined
    || options.sourceHash !== undefined
    || options.submissionId !== undefined
    || options.context !== undefined;
  if (hasAnchor && (!options.target || !options.sourceHash)) {
    throw new Error("anchored comments require --target and --source-hash");
  }
  const value = await addBoundAgentReviewComment({
    body,
    severity: options.severity,
    anchor: hasAnchor ? {
      target: options.target!,
      location: options.location,
      sourceHash: options.sourceHash!,
      submissionId: options.submissionId,
      context: options.context
    } : undefined
  });
  const receipt = value as z.input<typeof reviewAssignmentReceipt> & { reviewRoundId: string };
  return commandFacts(() => reviewAssignmentReceipt.parse({
    reviewId: receipt.reviewId, roundId: receipt.reviewRoundId, assignmentId: receipt.assignmentId,
    status: receipt.status, vote: receipt.vote, commentCount: receipt.commentCount, completed: receipt.completed
  }), { saved: { id: receipt.assignmentId, inspect: cliCommand(["run", "review", "assignment", "show", "--assignment", receipt.assignmentId], "reviewer") } });
}

export function validateInlineReviewCommentBody(body: string): void {
  if (!body.includes("\n") && (body.includes("\\n\\n") || body.includes("\\r\\n\\r\\n"))) {
    throw new Error("multiline Markdown must use --body-stdin; do not encode line breaks as literal \\n sequences");
  }
}

export async function resolveReviewCommentBody(
  options: Pick<AgentReviewCommentOptions, "body" | "bodyFile" | "bodyStdin">,
  input: AsyncIterable<unknown> = process.stdin
): Promise<string> {
  const sources = [options.body !== undefined, options.bodyFile !== undefined, Boolean(options.bodyStdin)]
    .filter(Boolean).length;
  if (sources > 1) {
    throw new Error("use only one of --body, --body-file, or --body-stdin");
  }
  if (sources === 0) {
    throw new Error("--body, --body-file, or --body-stdin is required");
  }
  if (options.body !== undefined) {
    if (!options.body.trim()) throw new Error("comment body must not be empty");
    validateInlineReviewCommentBody(options.body);
    return options.body;
  }
  if (options.bodyFile !== undefined) {
    const body = await readFile(options.bodyFile, "utf8");
    if (!body.trim()) throw new Error("comment body file must not be empty");
    return body;
  }
  let body = "";
  for await (const chunk of input) body += String(chunk);
  if (!body.trim()) throw new Error("standard input comment body must not be empty");
  return body;
}

export async function runReviewSubmitCommand(options: AgentReviewSubmitOptions) {
  requireBoundAssignment(options.assignment);
  if ((await agentReviewAssignmentDetailPayload() as { reviewProgress?: unknown }).reviewProgress) throw new Error("review_node_artifact_protocol_required");
  if (!options.vote || !["approve", "request_changes", "abstain"].includes(options.vote)) {
    throw new Error("--vote must be approve, request_changes, or abstain");
  }
  if (options.summary !== undefined && options.summaryFile !== undefined) {
    throw new Error("use only one of --summary or --summary-file");
  }
  const summary = options.summaryFile ? await readFile(options.summaryFile, "utf8") : options.summary;
  const value = await submitBoundAgentReview({
    vote: options.vote as "approve" | "request_changes" | "abstain",
    summary
  });
  const receipt = value as z.input<typeof reviewAssignmentReceipt> & { reviewRoundId: string };
  return commandFacts(() => reviewAssignmentReceipt.parse({
    reviewId: receipt.reviewId, roundId: receipt.reviewRoundId, assignmentId: receipt.assignmentId,
    status: receipt.status, vote: receipt.vote, commentCount: receipt.commentCount, completed: receipt.completed
  }), { saved: { id: receipt.assignmentId, inspect: cliCommand(["run", "review", "assignment", "show", "--assignment", receipt.assignmentId], "reviewer") } });
}

export async function runEnterSchemaCommand(schemaName: string | undefined, options: RunIdOptions) {
  const contextResult = await tryContextCommand("schema-enter", { ...options, schemaName });
  if (contextResult) return contextResult;
  const runId = requireRunId(options.run);
  const config = await readConfig();
  const run = await enterSchema({
    memoryRoot: config.memoryRoot,
    runsRoot: config.runsRoot,
    runId,
    schemaName
  });
  const snapshot = buildSchemaWritingSnapshot(config.runsRoot, run);
  if (!snapshot) throw new Error(`run has no active Schema writing context: ${runId}`);
  return legacyRunFacts("run enter-schema", run, config, options.output);
}

export async function runSchemaShowCommand(options: RunSchemaShowOptions) {
  const contextResult = await tryContextCommand("schema-show", options);
  if (contextResult) return contextResult;
  const runId = requireRunId(options.run);
  const config = await readConfig();
  const run = await ensureCurrentSchemaDraft(config.runsRoot, await readRun(config.runsRoot, runId));
  const snapshot = buildSchemaWritingSnapshot(config.runsRoot, run);
  if (!snapshot) throw new Error(`run has no active Schema writing context: ${runId}`);
  const result = snapshot;
  const phase = result.draft?.status ?? "writing";
  const action = phase === "awaiting_finalization"
    ? cliCommand(["run", "artifact", "export", "--run", runId, "--step", `${result.procedureName}#${result.parentStepId}`, "--file", "<local-copy>"])
    : cliCommand(["run", "status", "--run", runId]);
  return commandFacts(() => legacySchemaWriting.parse({
    runId, stepId: result.parentStepId, artifactName: result.artifact.name, phase,
    completed: result.progress.completed, total: result.progress.total, currentField: result.currentField?.path,
    nextAction: action
  }), { locale: run.language });
}

export function buildSchemaWritingDetail(snapshot: SchemaWritingSnapshot): unknown {
  return toEffectiveRuleDisplayValue(snapshot);
}

export async function runRepeatCommand(countValue: string, options: RunIdOptions) {
  const contextResult = await tryContextCommand("schema-repeat", { ...options, count: countValue });
  if (contextResult) return contextResult;
  const runId = requireRunId(options.run);
  if (!/^\d+$/.test(countValue)) {
    throw new Error("repeat count must be a non-negative integer");
  }
  const count = Number(countValue);
  if (!Number.isSafeInteger(count)) {
    throw new Error("repeat count must be a safe integer");
  }
  const config = await readConfig();
  const run = await repeatRun({ runsRoot: config.runsRoot, runId, count });
  return legacyRunFacts("run repeat", run, config, options.output);
}

export async function runSkipCommand(options: RunIdOptions) {
  const contextResult = await tryContextCommand("schema-skip", options);
  if (contextResult) return contextResult;
  const runId = requireRunId(options.run);
  const config = await readConfig();
  const run = await skipRun({ runsRoot: config.runsRoot, runId });
  return legacyRunFacts("run skip", run, config, options.output);
}

export async function runAbandonCommand(options: RunAbandonOptions) {
  const contextResult = await tryContextCommand("abandon", options);
  if (contextResult) return contextResult;
  const runId = requireRunId(options.run);
  if (options.reason !== undefined && options.reasonFile !== undefined) {
    throw new Error("use only one of --reason or --reason-file");
  }
  const reason = options.reasonFile ? await readFile(options.reasonFile, "utf8") : options.reason;
  const config = await readConfig();
  const result = await abandonRun({
    runsRoot: config.runsRoot,
    runId,
    source: "cli",
    actorId: options.actor,
    reason
  });
  return legacyRunFacts("run abandon", result.run, config, options.output, false, result.terminationWarnings.length);
}

export async function runStatusCommand(options: RunIdOptions) {
  if (!options.run) {
    return contextRunList(options);
  }
  const contextResult = await tryContextCommand("status", options);
  if (contextResult) return contextResult;
  const config = await readConfig();
  const run = await ensureCurrentSchemaDraft(config.runsRoot, await readRun(config.runsRoot, options.run));
  return legacyRunFacts("run status", run, config, options.output);
}

function readArtifactOption(options: ReportOptions): ArtifactReportSource {
  if (typeof options.artifact === "string") {
    return { kind: "inline", value: options.artifact };
  }
  if (options.artifactFile) {
    return { kind: "file", path: options.artifactFile };
  }
  throw new Error("report requires --artifact <value> or --artifact-file <path>");
}

function requireRunId(value: string | undefined): string {
  const runId = value?.trim();
  if (!runId) {
    throw new Error("--run <id> is required");
  }
  return runId;
}

function requireStepRef(value: string | undefined): string {
  const stepRef = value?.trim();
  if (!stepRef) throw new Error("--step <ref> is required");
  return stepRef;
}

function requireBoundAssignment(value: string | undefined): string {
  const assignmentId = value?.trim();
  if (!assignmentId) throw new Error("--assignment <id> is required");
  const bound = process.env.MEMSPHERE_REVIEW_ASSIGNMENT_ID;
  if (!bound) throw new Error("Agent Review CLI requires an active ACP Review Session");
  if (assignmentId !== bound) throw new Error("review assignment does not match this Session");
  return assignmentId;
}

type LocatedRunStep = {
  memoryName: string;
  step: NonNullable<RunState["plan"]>[number];
  parentRef?: string;
  relation?: "truthy" | "falsy" | "loop";
};

export function buildRunOverview(run: RunState): unknown {
  const frame = currentFrame(run);
  const step = currentStep(run);
  const currentRef = frame && step ? `${frame.memoryName}#${step.id}` : undefined;
  const reportedStepIds = new Set(run.events.map((event) => event.stepId));
  const reviewsByStep = new Map((run.artifactReviews ?? []).map((review) => [review.stepId, review]));
  const steps = runStepLocations(run);
  return {
    id: run.id,
    name: run.name,
    procedureName: run.procedureName,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    memoryProjects: run.memoryProjects,
    memorySource: run.memorySource,
    totalSteps: steps.length,
    currentStepRef: currentRef,
    steps: steps.map((located) => ({
      ref: locatedStepRef(located),
      procedureName: located.memoryName,
      id: located.step.id,
      kind: located.step.kind ?? "action",
      actor: located.step.actor ?? "agent",
      instruction: located.step.instruction,
      parentRef: located.parentRef,
      relation: located.relation,
      current: locatedStepRef(located) === currentRef,
      artifactState: located.step.artifact
        ? runArtifactState(reportedStepIds.has(located.step.id), reviewsByStep.get(located.step.id)?.status)
        : undefined,
      artifact: artifactContractSummary(located.step)
    }))
  };
}

export function buildRunStepDetail(run: RunState, reference: string): unknown {
  return stepDetail(run, findRunStep(run, reference));
}

function runArtifactState(
  reported: boolean,
  reviewStatus: ArtifactReview<RunState["events"][number]["artifact"]>["status"] | undefined
): "not_reported" | "under_review" | "revision_requested" | "reported" {
  if (reported || reviewStatus === "passed") return "reported";
  if (reviewStatus === "awaiting_revision") return "revision_requested";
  if (reviewStatus === "pending" || reviewStatus === "awaiting_runner_vote") return "under_review";
  return "not_reported";
}

function stepDetail(run: RunState, located: LocatedRunStep): unknown {
  const frame = currentFrame(run);
  const active = currentStep(run);
  const currentRef = frame && active ? `${frame.memoryName}#${active.id}` : undefined;
  return toEffectiveRuleDisplayValue({
    ref: locatedStepRef(located),
    procedureName: located.memoryName,
    current: locatedStepRef(located) === currentRef,
    procedureAsserts: toEffectiveRuleDisplayEntries(procedureAssertsFor(run, located.memoryName)),
    step: {
      id: located.step.id,
      kind: located.step.kind ?? "action",
      actor: located.step.actor ?? "agent",
      instruction: located.step.instruction,
      asserts: publicRuleTree(located.step.assertTree, "asserts"),
      suggests: publicRuleTree(located.step.suggestTree, "suggests"),
      details: located.step.details ?? [],
      artifact: artifactContractDetail(located.step)
    }
  });
}

export async function buildRunArtifactDetail(runsRoot: string, run: RunState, reference: string): Promise<unknown> {
  const located = findRunStep(run, reference);
  const review = [...(run.artifactReviews ?? [])].reverse()
    .find((candidate) => candidate.stepId === located.step.id);
  const round = review?.rounds.find((candidate) => candidate.id === review.currentRoundId);
  const submission = round
    ? review?.submissions.find((candidate) => candidate.id === round.submissionId)
    : undefined;
  const event = [...run.events].reverse().find((candidate) => candidate.stepId === located.step.id);
  const artifact = submission?.artifact ?? event?.artifact;
  return {
    stepRef: locatedStepRef(located),
    source: submission ? "review_submission" : event ? "run_event" : "not_reported",
    artifact: artifact ? await artifactForDisplay(runsRoot, artifact) : null,
    revisionSummary: submission?.revisionSummary
  };
}

export function buildRunArtifactContractDetail(run: RunState, reference: string): unknown {
  const located = findRunStep(run, reference);
  return toEffectiveRuleDisplayValue({
    stepRef: locatedStepRef(located),
    procedure: {
      name: located.memoryName,
      asserts: toEffectiveRuleDisplayEntries(procedureAssertsFor(run, located.memoryName))
    },
    action: {
      instruction: located.step.instruction,
      asserts: publicRuleTree(located.step.assertTree, "asserts"),
      suggests: publicRuleTree(located.step.suggestTree, "suggests"),
      details: located.step.details ?? []
    },
    artifact: artifactContractDetail(located.step)
  });
}

function procedureAssertsFor(run: RunState, memoryName: string): EffectiveRuleTree {
  const template = Object.values(run.procedureSnapshots ?? {})
    .find((candidate) => candidate.memoryName === memoryName);
  return template?.assertTree
    ?? (memoryName === run.procedureName ? run.assertTree : undefined)
    ?? ruleTreeOrEmpty("asserts");
}

function ruleTreeOrEmpty(channel: RuleChannel): EffectiveRuleTree {
  return { channel, entries: [], sections: [] };
}

function publicRuleTree(tree: EffectiveRuleTree | undefined, channel: RuleChannel): EffectiveRuleDisplayEntry[] {
  return toEffectiveRuleDisplayEntries(tree ?? ruleTreeOrEmpty(channel));
}

async function artifactForDisplay(
  runsRoot: string,
  artifact: RunState["events"][number]["artifact"]
): Promise<unknown> {
  const value = artifact.storage === "file" && artifact.path
    ? (await requireRunContent(runsRoot, "artifact", artifact.path)).toString("utf8")
    : artifact.value;
  return {
    name: artifact.name,
    type: artifact.type,
    format: artifact.format,
    final: artifact.final,
    storage: artifact.storage ?? (artifact.path ? "file" : "inline"),
    value,
    fields: artifact.fields,
    fileName: artifact.fileName,
    filePath: artifact.path ? resolve(runsRoot, artifact.path) : undefined,
    contentType: artifact.contentType,
    validation: artifact.validation,
    modelTarget: artifact.modelTarget,
    modelData: artifact.modelData
  };
}

function artifactContractSummary(step: LocatedRunStep["step"]): unknown {
  if (!step.artifact) return undefined;
  return {
    name: step.artifact,
    type: step.type,
    format: step.format,
    final: step.final ?? false
  };
}

function artifactContractDetail(step: LocatedRunStep["step"]): unknown {
  if (!step.artifact) return undefined;
  return {
    name: step.artifact,
    type: step.type,
    format: step.format,
    schema: step.schema,
    final: step.final ?? false,
    review: step.reviewPolicy
  };
}

function findRunStep(run: RunState, reference: string): LocatedRunStep {
  const locations = runStepLocations(run);
  const separator = reference.lastIndexOf("#");
  const matches = separator >= 0
    ? locations.filter((candidate) => (
      candidate.memoryName === reference.slice(0, separator)
      && candidate.step.id === reference.slice(separator + 1)
    ))
    : locations.filter((candidate) => candidate.step.id === reference);
  if (matches.length === 1) return matches[0];
  if (!matches.length) throw new Error(`Run step not found: ${reference}`);
  throw new Error(`Run step reference is ambiguous; use one of: ${matches.map(locatedStepRef).join(", ")}`);
}

function runStepLocations(run: RunState): LocatedRunStep[] {
  const procedures = new Map<string, RunState["plan"]>();
  if (run.plan) procedures.set(run.procedureName, run.plan);
  for (const template of Object.values(run.procedureSnapshots ?? {})) {
    if (!procedures.has(template.memoryName)) procedures.set(template.memoryName, template.steps);
  }
  for (const frame of run.stack) {
    if (frame.type === "procedure" && !procedures.has(frame.memoryName)) {
      procedures.set(frame.memoryName, frame.steps);
    }
  }
  const locations: LocatedRunStep[] = [];
  for (const [memoryName, steps] of procedures) {
    collectRunStepLocations(memoryName, steps ?? [], locations);
  }
  return locations;
}

function collectRunStepLocations(
  memoryName: string,
  steps: NonNullable<RunState["plan"]>,
  output: LocatedRunStep[],
  parentRef?: string,
  relation?: LocatedRunStep["relation"]
): void {
  for (const step of steps) {
    const located = { memoryName, step, parentRef, relation } satisfies LocatedRunStep;
    output.push(located);
    const nextParent = locatedStepRef(located);
    if (step.branches) {
      collectRunStepLocations(memoryName, step.branches.truthy, output, nextParent, "truthy");
      collectRunStepLocations(memoryName, step.branches.falsy, output, nextParent, "falsy");
    }
    if (step.loop) collectRunStepLocations(memoryName, step.loop.body, output, nextParent, "loop");
  }
}

function locatedStepRef(located: LocatedRunStep): string {
  return `${located.memoryName}#${located.step.id}`;
}

export async function runSchemaReportCommand(options: object) {
  const result = await tryContextCommand("schema-report", options);
  if (!result) throw new Error("schema report requires a graph or free exploration Step; flow uses run report");
  return result;
}

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
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
  buildSchemaOverviewPromptModel,
  buildArtifactReviewNextActionPromptModel,
  buildRunReviewHumanSubmitReceiptPromptModel,
  renderRunOutput,
  renderPrompt,
  resolvePromptLocale,
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
  listRuns,
  normalizeRunName,
  readRun,
  repeatRun,
  resolveArtifactReviewComment,
  retryArtifactReviewAgentAssignment,
  runDisplayName,
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
} from "../run/store.js";
import { assertReportExecutionCapability } from "../report-execution.js";

type ReportOptions = {
  run?: string;
  artifact?: string;
  artifactFile?: string;
  revisionSummary?: string;
  revisionSummaryFile?: string;
};

type RunStartOptions = {
  file?: string;
  name?: string;
  reviewConfig?: string;
  change?: string;
};

type ReviewWaitOptions = { review?: string };

type ReviewVoteOptions = {
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
};

type RunAbandonOptions = RunIdOptions & {
  reason?: string;
  reasonFile?: string;
  actor?: string;
};

type OutputOptions = { output?: "json" | "text" };

type RunShowOptions = RunIdOptions & OutputOptions;

type RunStepShowOptions = RunShowOptions & { step?: string };

type RunSchemaShowOptions = RunShowOptions;

type RunBindingShowOptions = RunShowOptions;

type RunBindingUpdateOptions = RunShowOptions & {
  slot?: string;
  actor?: string[];
  skip?: boolean;
};

type RunArtifactShowOptions = RunShowOptions & {
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

export async function runStartCommand(procedureName: string | undefined, options: RunStartOptions = {}): Promise<void> {
  const procedure = procedureName?.trim();
  const procedureFile = options.file?.trim();
  const changeId = options.change?.trim();
  if (!procedure && !procedureFile) throw new Error("provide a procedure name or --file <path>");
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
    memorySource: NonNullable<RunState["memorySource"]>;
  }): Promise<RunState> => startRun({
    memoryRoot: config.memoryRoot,
    memorySnapshotRoot: source?.memoryRoot,
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
  let run: RunState;
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
          return start({
            memoryRoot: preview.memoryRoot,
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
    console.log(renderPrompt(
      "run.review-configuration-required",
      config.language,
      { preflightJson: JSON.stringify(error.preflight, null, 2) }
    ));
    return;
  }
  printRunOutput({ kind: "start", run, runsRoot: config.runsRoot });
}

function parseRunReviewConfiguration(value: unknown): RunReviewConfiguration {
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

export async function runReportCommand(options: ReportOptions): Promise<void> {
  const runId = requireRunId(options.run);
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
    revisionSummary,
    beforeArtifactReview: assertReportExecutionCapability
  });
  await dispatchArtifactReviewAgents({ config, run });
  printRunOutput({ kind: "report", run, runsRoot: config.runsRoot });
}

export async function runReviewWaitCommand(options: ReviewWaitOptions): Promise<void> {
  const reviewId = options.review?.trim();
  if (!reviewId) throw new Error("--review <id> is required");
  const config = await readConfig();
  const located = await findArtifactReview({ runsRoot: config.runsRoot, reviewId });
  await dispatchArtifactReviewAgents({ config, run: located.run });
  const context = await waitForArtifactReview({ runsRoot: config.runsRoot, reviewId });
  printRunOutput({
    kind: "review",
    run: context.run,
    review: context.review,
    round: context.round,
    runsRoot: config.runsRoot
  });
}

export async function runReviewVoteCommand(options: ReviewVoteOptions): Promise<void> {
  const reviewId = options.review?.trim();
  const roundId = options.round?.trim();
  if (!reviewId) throw new Error("--review <id> is required");
  if (!roundId) throw new Error("--round <id> is required");
  if (options.vote !== "approve" && options.vote !== "request_changes") {
    throw new Error("--vote must be approve or request_changes");
  }
  if (options.comment !== undefined && options.commentFile !== undefined) {
    throw new Error("use only one of --comment or --comment-file");
  }
  const comment = options.commentFile
    ? await readFile(options.commentFile, "utf8")
    : options.comment;
  const config = await readConfig();
  const context = await submitArtifactReviewRunnerVote({
    runsRoot: config.runsRoot,
    reviewId,
    roundId,
    vote: options.vote,
    comment
  });
  printRunOutput({
    kind: "review_vote",
    run: context.run,
    review: context.review,
    round: context.round,
    vote: options.vote,
    runsRoot: config.runsRoot
  });
}

export async function runReviewRetryCommand(options: ReviewRetryOptions): Promise<void> {
  const reviewId = options.review?.trim();
  const assignment = options.assignment?.trim();
  if (!reviewId) throw new Error("--review <id> is required");
  if (!assignment) throw new Error("--assignment <actor-or-assignment-id> is required");
  const config = await readConfig();
  const located = await findArtifactReview({ runsRoot: config.runsRoot, reviewId });
  const context = await retryArtifactReviewAgentAssignment({
    runsRoot: config.runsRoot,
    reviewId,
    roundId: located.review.currentRoundId,
    actorId: assignment
  });
  await dispatchArtifactReviewAgents({ config, run: context.run });
  printStructured({
    reviewId,
    roundId: context.round.id,
    assignmentId: context.assignment.id,
    actorId: context.assignment.actorId,
    status: context.assignment.status,
    attempt: context.attempt
  }, options.output);
}

export async function runReviewSubmitForHumanCommand(options: ReviewSubmitForHumanOptions): Promise<void> {
  const runId = requireRunId(options.run);
  const reviewId = options.review?.trim();
  const roundId = options.round?.trim();
  const assignmentId = options.assignment?.trim();
  if (!reviewId) throw new Error("--review <id> is required");
  if (!roundId) throw new Error("--round <id> is required");
  if (!assignmentId) throw new Error("--assignment <actor-or-assignment-id> is required");
  if (!options.vote || !["approve", "request_changes", "abstain"].includes(options.vote)) {
    throw new Error("--vote must be approve, request_changes, or abstain");
  }
  if (!options.commentsFile) throw new Error("--comments-file <path> is required");
  if (options.summary !== undefined && options.summaryFile !== undefined) {
    throw new Error("use only one of --summary or --summary-file");
  }
  if ((options.authorizationNote === undefined) === (options.authorizationNoteFile === undefined)) {
    throw new Error("provide exactly one of --authorization-note or --authorization-note-file");
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
  printRunnerDelegatedReviewReceipt({
    runId: context.run.id,
    reviewId: context.review.id,
    roundId: context.round.id,
    assignmentId: context.assignment.id,
    actorId: context.assignment.actorId,
    vote: context.assignment.submitted?.vote,
    commentCount: context.assignment.submitted?.comments.length ?? 0,
    summaryPresent: Boolean(context.assignment.submitted?.summary),
    delegatedBy: context.assignment.submitted?.delegation?.kind,
    authorizationNote: context.assignment.submitted?.delegation?.authorizationNote,
    reviewStatus: context.review.status,
    roundStatus: context.round.status
  }, options.output, context.run, context.review, context.round);
}

type RunnerDelegatedReviewReceipt = {
  runId: string;
  reviewId: string;
  roundId: string;
  assignmentId?: string;
  actorId: string;
  vote?: string;
  commentCount: number;
  summaryPresent: boolean;
  delegatedBy?: string;
  authorizationNote?: string;
  reviewStatus: string;
  roundStatus: string;
};

function printRunnerDelegatedReviewReceipt(
  receipt: RunnerDelegatedReviewReceipt,
  output: "json" | "text" | undefined,
  run: RunState,
  review: ArtifactReview<RunState["events"][number]["artifact"]>,
  round: ArtifactReviewRound
): void {
  const nextAction = buildArtifactReviewNextActionPromptModel(review, round, run.id);
  if ((output ?? "text") === "json") {
    console.log(JSON.stringify({ ...receipt, nextAction }));
    return;
  }
  const locale = resolvePromptLocale(run.language);
  const rendered = [
    renderPrompt("run.review-human-submit-receipt", locale, buildRunReviewHumanSubmitReceiptPromptModel({
      runId: receipt.runId,
      reviewId: receipt.reviewId,
      roundId: receipt.roundId,
      assignmentId: receipt.assignmentId ?? "-",
      actorId: receipt.actorId,
      vote: receipt.vote ?? "-",
      commentCount: receipt.commentCount,
      summaryPresent: receipt.summaryPresent,
      delegatedBy: receipt.delegatedBy ?? "-",
      authorizationNote: receipt.authorizationNote ?? "-",
      reviewStatus: receipt.reviewStatus,
      roundStatus: receipt.roundStatus
    }, locale)),
    renderPrompt("run.review-next-action", locale, nextAction)
  ].filter((value) => value.trim()).join("\n\n");
  console.log(rendered);
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

export async function runReviewResolveCommand(options: ReviewResolveOptions): Promise<void> {
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
  printStructured({
    reviewId,
    roundId,
    disposition: context.round.commentDispositions?.find((item) => item.commentId === commentId)
  }, options.output);
}

export async function runShowCommand(options: RunShowOptions): Promise<void> {
  const runId = requireRunId(options.run);
  const config = await readConfig();
  const run = await readRun(config.runsRoot, runId);
  printStructured(buildRunOverview(run), options.output);
}

export async function runBindingShowCommand(options: RunBindingShowOptions): Promise<void> {
  const runId = requireRunId(options.run);
  const config = await readConfig();
  const run = await readRun(config.runsRoot, runId);
  printRunBindingOutput(buildRunBindingSnapshot(run), options.output, "show");
}

export async function runBindingUpdateCommand(options: RunBindingUpdateOptions): Promise<void> {
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
  printRunBindingOutput({ change: result.change, bindings: result.snapshot }, options.output, "update");
}

export function printRunBindingOutput(
  value: unknown,
  output: "json" | "text" | undefined,
  mode: "show" | "update"
): void {
  if ((output ?? "text") === "text") {
    console.log(mode === "update"
      ? "Binding saved. Current and historical rounds stay unchanged; the new binding applies to the next round or future Reviews."
      : "Current and historical rounds are frozen; displayed next bindings apply only when a new round or future Review is created.");
  }
  printStructured(value, output);
}

export async function runTryRunCommand(options: RunIdOptions): Promise<void> {
  const runId = requireRunId(options.run);
  const config = await readConfig();
  const run = await readRun(config.runsRoot, runId);
  const generated = await tryRunArtifactReviewAgents({ config, run });
  if (!generated.length) {
    console.log(`No queued Agent Review Assignments found for run ${runId}.`);
    return;
  }
  console.log(`Agent Review try-run generated ${generated.length} Assignment${generated.length === 1 ? "" : "s"}:`);
  for (const artifact of generated) {
    console.log(`- ${artifact.assignmentId}`);
    console.log(`  prompt: ${artifact.promptPath}`);
    console.log(`  launch: ${artifact.launchPath}`);
  }
}

export async function runStepShowCommand(options: RunStepShowOptions): Promise<void> {
  const runId = requireRunId(options.run);
  const stepRef = requireStepRef(options.step);
  const config = await readConfig();
  const run = await readRun(config.runsRoot, runId);
  printStructured(buildRunStepDetail(run, stepRef), options.output);
}

export async function runArtifactShowCommand(options: RunArtifactShowOptions): Promise<void> {
  if (options.assignment) {
    if (options.run || options.step) throw new Error("use --assignment or --run with --step, not both");
    requireBoundAssignment(options.assignment);
    const value = await agentReviewArtifactPayload();
    printStructured(value, options.output);
    return;
  }

  const runId = requireRunId(options.run);
  const stepRef = requireStepRef(options.step);
  const config = await readConfig();
  const run = await readRun(config.runsRoot, runId);
  printStructured(await buildRunArtifactDetail(config.runsRoot, run, stepRef), options.output);
}

export async function runArtifactContractShowCommand(options: RunArtifactShowOptions): Promise<void> {
  if (options.assignment) {
    if (options.run || options.step) throw new Error("use --assignment or --run with --step, not both");
    requireBoundAssignment(options.assignment);
    const value = await agentReviewArtifactContractPayload();
    printStructured(value, options.output);
    return;
  }

  const runId = requireRunId(options.run);
  const stepRef = requireStepRef(options.step);
  const config = await readConfig();
  const run = await readRun(config.runsRoot, runId);
  printStructured(buildRunArtifactContractDetail(run, stepRef), options.output);
}

export async function runReviewAssignmentShowCommand(options: AgentReviewAssignmentOptions): Promise<void> {
  requireBoundAssignment(options.assignment);
  const value = await agentReviewAssignmentDetailPayload();
  printStructured(value, options.output);
}

export async function runReviewCommentCommand(options: AgentReviewCommentOptions): Promise<void> {
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
  printStructured(value, options.output);
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

export async function runReviewSubmitCommand(options: AgentReviewSubmitOptions): Promise<void> {
  requireBoundAssignment(options.assignment);
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
  printStructured(value, options.output);
}

export async function runEnterSchemaCommand(schemaName: string | undefined, options: RunIdOptions): Promise<void> {
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
  printRunOutput({
    kind: "enter_schema",
    run,
    snapshot,
    runsRoot: config.runsRoot
  });
}

export async function runSchemaShowCommand(options: RunSchemaShowOptions): Promise<void> {
  const runId = requireRunId(options.run);
  const config = await readConfig();
  const run = await ensureCurrentSchemaDraft(config.runsRoot, await readRun(config.runsRoot, runId));
  const snapshot = buildSchemaWritingSnapshot(config.runsRoot, run);
  if (!snapshot) throw new Error(`run has no active Schema writing context: ${runId}`);
  if ((options.output ?? "text") === "json") {
    console.log(JSON.stringify(buildSchemaWritingDetail(snapshot)));
    return;
  }
  printSchemaWritingOverview(snapshot, resolvePromptLocale(run.language));
}

export function buildSchemaWritingDetail(snapshot: SchemaWritingSnapshot): unknown {
  return toEffectiveRuleDisplayValue(snapshot);
}

export async function runRepeatCommand(countValue: string, options: RunIdOptions): Promise<void> {
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
  printRunOutput({ kind: "repeat", run, runsRoot: config.runsRoot });
}

export async function runSkipCommand(options: RunIdOptions): Promise<void> {
  const runId = requireRunId(options.run);
  const config = await readConfig();
  const run = await skipRun({ runsRoot: config.runsRoot, runId });
  printRunOutput({ kind: "skip", run, runsRoot: config.runsRoot });
}

export async function runAbandonCommand(options: RunAbandonOptions): Promise<void> {
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
  for (const warning of result.terminationWarnings) console.error(`warning: ${warning}`);
  printRunOutput({ kind: "status", run: result.run, runsRoot: config.runsRoot });
}

export async function runStatusCommand(options: RunIdOptions): Promise<void> {
  const config = await readConfig();
  if (options.run) {
    const run = await ensureCurrentSchemaDraft(config.runsRoot, await readRun(config.runsRoot, options.run));
    printRunOutput({ kind: "status", run, runsRoot: config.runsRoot });
    return;
  }

  const runs = await listRuns(config.runsRoot);
  if (!runs.length) {
    console.log("No runs found.");
    return;
  }

  for (const run of runs) {
    console.log(`${run.id} ${run.status} ${runDisplayName(run)} · ${run.procedureName}`);
  }
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

export function printRunOutput(scene: Parameters<typeof renderRunOutput>[0]): void {
  console.log(renderRunOutput(scene, resolvePromptLocale(scene.run.language)));
}

export function printSchemaWritingOverview(
  snapshot: SchemaWritingSnapshot,
  locale: PromptLocale = "en"
): void {
  console.log(renderPrompt(
    "run.schema-overview",
    locale,
    buildSchemaOverviewPromptModel(snapshot, locale)
  ));
}

function requireBoundAssignment(value: string | undefined): string {
  const assignmentId = value?.trim();
  if (!assignmentId) throw new Error("--assignment <id> is required");
  const bound = process.env.MEMSPHERE_REVIEW_ASSIGNMENT_ID;
  if (!bound) throw new Error("Agent Review CLI requires an active ACP Review Session");
  if (assignmentId !== bound) throw new Error("review assignment does not match this Session");
  return assignmentId;
}

function printStructured(value: unknown, output: "json" | "text" | undefined): void {
  if ((output ?? "text") === "json") {
    console.log(JSON.stringify(value));
    return;
  }
  console.log(JSON.stringify(value, null, 2));
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
    ? await readFile(join(runsRoot, artifact.path), "utf8")
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
    validation: artifact.validation
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

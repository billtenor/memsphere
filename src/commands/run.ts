import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ArtifactReview, ArtifactReviewRound } from "../artifact-review.js";
import { tryRunArtifactReviewAgents } from "../acp/debug.js";
import { dispatchArtifactReviewAgents } from "../acp/dispatcher.js";
import { requestAgentReviewBridge } from "../acp/review-bridge.js";
import { readConfig } from "../config.js";
import {
  authorizeArtifactOperation,
  renderPermissionGuidance,
  type PermissionLocale
} from "../control-plane/index.js";
import {
  activeProcedureAsserts,
  type ArtifactReportSource,
  buildSchemaWritingSnapshot,
  currentArtifactReview,
  currentFrame,
  currentSchemaFinalization,
  currentStep,
  enterSchema,
  ensureCurrentSchemaDraft,
  finalArtifacts,
  findArtifactReview,
  listRuns,
  readRun,
  repeatRun,
  reportRun,
  type SchemaWritingSnapshot,
  skipRun,
  startRun,
  submitArtifactReviewRunnerVote,
  waitForArtifactReview,
  type RunState
} from "../run/store.js";

type ReportOptions = {
  run?: string;
  artifact?: string;
  artifactFile?: string;
  revisionSummaryFile?: string;
};

type RunStartOptions = {
  file?: string;
};

type ReviewWaitOptions = {
  review?: string;
};

type ReviewVoteOptions = {
  review?: string;
  round?: string;
  vote?: string;
  comment?: string;
  commentFile?: string;
};

type RunIdOptions = {
  run?: string;
};

type OutputOptions = { output?: "json" | "text" };

type RunShowOptions = RunIdOptions & OutputOptions;

type RunStepShowOptions = RunShowOptions & { step?: string };

type RunSchemaShowOptions = RunShowOptions;

type RunArtifactShowOptions = RunShowOptions & {
  assignment?: string;
  step?: string;
};

type AgentReviewAssignmentOptions = OutputOptions & { assignment?: string };

type AgentReviewCommentOptions = AgentReviewAssignmentOptions & {
  body?: string;
  bodyStdin?: boolean;
  target?: string;
  location?: string;
  sourceHash?: string;
  submissionId?: string;
  context?: string;
};

type AgentReviewSubmitOptions = AgentReviewAssignmentOptions & {
  vote?: string;
  summary?: string;
  summaryFile?: string;
};

export async function runStartCommand(procedureName: string | undefined, options: RunStartOptions = {}): Promise<void> {
  const name = procedureName?.trim();
  const procedureFile = options.file?.trim();
  if (!name && !procedureFile) throw new Error("provide a procedure name or --file <path>");
  if (name && procedureFile) throw new Error("use either a procedure name or --file <path>, not both");

  const config = await readConfig();
  const run = await startRun({
    memoryRoot: config.memoryRoot,
    runsRoot: config.runsRoot,
    procedureName: name,
    procedureFile,
    controlPlane: config.controlPlane
  });
  printRunState(run, config.runsRoot);
}

export async function runReportCommand(options: ReportOptions): Promise<void> {
  const runId = requireRunId(options.run);
  const artifact = readArtifactOption(options);
  const revisionSummary = options.revisionSummaryFile
    ? await readFile(options.revisionSummaryFile, "utf8")
    : undefined;
  const config = await readConfig();
  const run = await reportRun({
    runsRoot: config.runsRoot,
    runId,
    artifact,
    revisionSummary,
    locale: permissionLocale()
  });
  await dispatchArtifactReviewAgents({ config, run });
  printLatestReportAuthorization(run);
  printRunState(run, config.runsRoot);
}

export async function runReviewWaitCommand(options: ReviewWaitOptions): Promise<void> {
  const reviewId = options.review?.trim();
  if (!reviewId) throw new Error("--review <id> is required");
  const config = await readConfig();
  const located = await findArtifactReview({ runsRoot: config.runsRoot, reviewId });
  await dispatchArtifactReviewAgents({ config, run: located.run });
  const context = await waitForArtifactReview({ runsRoot: config.runsRoot, reviewId });
  printArtifactReviewSummary(context.review, context.round);
  console.log("");
  if (context.review.status === "passed") {
    printRunState(context.run, config.runsRoot);
    return;
  }
  if (context.review.status === "awaiting_runner_vote") {
    printRunnerVoteCommands(context.review, context.round);
    return;
  }
  console.log("Then:");
  console.log(
    `memsphere run report --run ${context.run.id} --artifact-file <path> --revision-summary-file <path>`
  );
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
  printArtifactReviewSummary(context.review, context.round);
  console.log("");
  if (context.review.status === "passed") {
    printRunState(context.run, config.runsRoot);
    return;
  }
  console.log("Then:");
  console.log(
    `memsphere run report --run ${context.run.id} --artifact-file <path> --revision-summary-file <path>`
  );
}

export async function runShowCommand(options: RunShowOptions): Promise<void> {
  const runId = requireRunId(options.run);
  const config = await readConfig();
  const run = await readRun(config.runsRoot, runId);
  printStructured(buildRunOverview(run), options.output);
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
    const value = await requestAgentReviewBridge({ operation: "artifact_show" });
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
    const value = await requestAgentReviewBridge({ operation: "artifact_contract_show" });
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
  const value = await requestAgentReviewBridge({ operation: "assignment_show" });
  printStructured(value, options.output);
}

export async function runReviewCommentCommand(options: AgentReviewCommentOptions): Promise<void> {
  requireBoundAssignment(options.assignment);
  const body = await resolveReviewCommentBody(options);
  const hasAnchor = options.target !== undefined
    || options.location !== undefined
    || options.sourceHash !== undefined
    || options.submissionId !== undefined
    || options.context !== undefined;
  if (hasAnchor && (!options.target || !options.sourceHash)) {
    throw new Error("anchored comments require --target and --source-hash");
  }
  const value = await requestAgentReviewBridge({
    operation: "comment",
    body,
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
  options: Pick<AgentReviewCommentOptions, "body" | "bodyStdin">,
  input: AsyncIterable<unknown> = process.stdin
): Promise<string> {
  if (options.body !== undefined && options.bodyStdin) {
    throw new Error("use only one of --body or --body-stdin");
  }
  if (options.body === undefined && !options.bodyStdin) {
    throw new Error("--body or --body-stdin is required");
  }
  if (options.body !== undefined) {
    if (!options.body.trim()) throw new Error("comment body must not be empty");
    validateInlineReviewCommentBody(options.body);
    return options.body;
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
  const value = await requestAgentReviewBridge({
    operation: "submit",
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
  if (snapshot) printSchemaWritingOverview(snapshot);
  printRunState(run, config.runsRoot);
}

export async function runSchemaShowCommand(options: RunSchemaShowOptions): Promise<void> {
  const runId = requireRunId(options.run);
  const config = await readConfig();
  const run = await ensureCurrentSchemaDraft(config.runsRoot, await readRun(config.runsRoot, runId));
  const snapshot = buildSchemaWritingSnapshot(config.runsRoot, run);
  if (!snapshot) throw new Error(`run has no active Schema writing context: ${runId}`);
  if ((options.output ?? "text") === "json") {
    console.log(JSON.stringify(snapshot));
    return;
  }
  printSchemaWritingOverview(snapshot);
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
  printRunState(run, config.runsRoot);
}

export async function runSkipCommand(options: RunIdOptions): Promise<void> {
  const runId = requireRunId(options.run);
  const config = await readConfig();
  const run = await skipRun({ runsRoot: config.runsRoot, runId });
  printRunState(run, config.runsRoot);
}

export async function runStatusCommand(options: RunIdOptions): Promise<void> {
  const config = await readConfig();
  if (options.run) {
    const run = await ensureCurrentSchemaDraft(config.runsRoot, await readRun(config.runsRoot, options.run));
    printRunState(run, config.runsRoot);
    return;
  }

  const runs = await listRuns(config.runsRoot);
  if (!runs.length) {
    console.log("No runs found.");
    return;
  }

  for (const run of runs) {
    console.log(`${run.id} ${run.status} ${run.procedureName}`);
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

export function printRunState(run: RunState, runsRoot?: string): void {
  console.log(`run ${run.id}`);

  if (run.status === "done") {
    console.log("done");
    const finals = finalArtifacts(run);
    if (finals.length) {
      console.log("");
      console.log("Final Artifacts:");
      for (const artifact of finals) console.log(`- ${artifact.name}${artifact.path ? `: ${artifact.path}` : ""}`);
    }
    return;
  }

  const procedureAsserts = activeProcedureAsserts(run);
  if (procedureAsserts.length) {
    console.log("");
    console.log("Procedure Asserts:");
    for (const value of procedureAsserts) console.log(`- ${value}`);
  }

  const schemaFinalization = currentSchemaFinalization(run);
  if (schemaFinalization) {
    const draftPath = runsRoot
      ? resolve(runsRoot, schemaFinalization.draft.path)
      : schemaFinalization.draft.path;
    console.log("");
    console.log("Schema Finalization:");
    console.log(`- status: awaiting global adjustment`);
    console.log(`- artifact: ${schemaFinalization.parentStep.artifact}`);
    console.log(`- progress: ${schemaFinalization.draft.completed}/${schemaFinalization.draft.total}`);
    console.log(`- managed draft: ${draftPath}`);
    if (schemaFinalization.draft.validation) {
      console.log(`- contract validation: ${schemaFinalization.draft.validation.status}`);
      for (const issue of schemaFinalization.draft.validation.issues) {
        console.log(`  - ${issue.message}`);
      }
    }
    console.log("");
    console.log("Do:");
    console.log("Read the complete managed draft, edit it directly as needed, then submit that same file.");
    console.log("");
    console.log("Then:");
    console.log(`memsphere run report --run ${run.id} --artifact-file ${shellQuote(draftPath)}`);
    return;
  }

  const frame = currentFrame(run);
  const step = currentStep(run);
  if (frame && step?.kind === "repeat" && step.repeat) {
    const max = step.repeat.max === undefined ? "unbounded" : String(step.repeat.max);
    console.log("");
    console.log("Actor:");
    console.log("agent");
    console.log("");
    console.log("Do:");
    console.log(step.instruction);
    console.log("");
    console.log("Details:");
    console.log(`- allowed count: ${step.repeat.min}..${max}`);
    console.log(`- body fields: ${step.repeat.body.length}`);
    console.log("");
    console.log("Then:");
    console.log(`memsphere run repeat <count> --run ${run.id}`);
    return;
  }
  if (!frame || !step || !step.artifact || !step.format) {
    console.log("done");
    return;
  }

  const artifactReview = currentArtifactReview(run);
  if (artifactReview?.status === "pending" || artifactReview?.status === "awaiting_runner_vote") {
    const round = artifactReview.rounds.find((candidate) => candidate.id === artifactReview.currentRoundId);
    if (!round) throw new Error(`Artifact Review Round not found: ${artifactReview.currentRoundId}`);
    printArtifactReviewSummary(artifactReview, round);
    console.log("");
    if (artifactReview.status === "pending") {
      console.log("Then:");
      console.log(`memsphere run review wait --review ${artifactReview.id}`);
    } else {
      printRunnerVoteCommands(artifactReview, round);
    }
    return;
  }

  console.log("");
  console.log("Actor:");
  console.log(step.actor === "human" ? "human" : "agent");

  console.log("");
  console.log(step.actor === "human" ? "Ask human to do:" : "Do:");
  console.log(step.instruction);

  if (step.asserts?.length) {
    console.log("");
    console.log("Asserts:");
    for (const value of step.asserts) console.log(`- ${value}`);
  }

  if (step.suggests?.length) {
    console.log("");
    console.log("Suggests:");
    for (const value of step.suggests) console.log(`- ${value}`);
  }

  if (step.details?.length) {
    console.log("");
    console.log("Details:");
    for (const detail of step.details) {
      console.log(`- ${detail}`);
    }
  }

  if (frame.type === "schema") {
    const snapshot = buildSchemaWritingSnapshot(runsRoot ?? ".", run);
    if (snapshot) {
      console.log("");
      console.log("Schema Progress:");
      console.log(`- field: ${snapshot.progress.current ?? step.artifact}`);
      console.log(`- completed: ${snapshot.progress.completed}/${snapshot.progress.total}`);
      console.log(`- remaining: ${snapshot.progress.remaining}`);
      if (snapshot.progress.pendingRepeatControls) {
        console.log(`- repeat controls pending: ${snapshot.progress.pendingRepeatControls}`);
      }
      for (const source of snapshot.currentField?.sources ?? []) {
        console.log(`- constraint source: ${source.path} (${source.type} · ${formatDisplay(source.format)})`);
        for (const value of source.defines ?? []) console.log(`  - defines: ${value}`);
        for (const value of source.asserts ?? []) console.log(`  - asserts: ${value}`);
      }
      if (snapshot.draft) console.log(`- managed draft: ${snapshot.draft.filePath}`);
      console.log(`- full overview: memsphere run schema show --run ${run.id}`);
    }
  }

  console.log("");
  console.log("Artifact:");
  console.log(`${step.artifact} (${step.type ?? "unknown"} · ${formatDisplay(step.format)})`);
  if (step.actor === "human") {
    console.log("Report the artifact value provided by the human.");
  }

  if (frame.type !== "schema") printPermissionGuidance(run, step);

  console.log("");
  if (artifactReview?.status === "awaiting_revision") {
    console.log("Then:");
    console.log(`memsphere run report --run ${run.id} --artifact-file <path> --revision-summary-file <path>`);
  } else if (step.format.name === "markdown" && step.schema) {
    console.log("Then:");
    if (step.schema.kind === "inline") {
      console.log(`memsphere run enter-schema --run ${run.id}`);
    } else {
      console.log(`memsphere run enter-schema ${step.schema.name} --run ${run.id}`);
    }
  } else {
    console.log("Then:");
    console.log(`memsphere run report --run ${run.id} --artifact <value>`);
    if (step.optional === true) {
      console.log(`memsphere run skip --run ${run.id}`);
    }
  }
}

export function printSchemaWritingOverview(snapshot: SchemaWritingSnapshot): void {
  console.log("Schema Overview:");
  console.log(`- procedure: ${snapshot.procedureName}`);
  console.log(`- action: ${snapshot.action.instruction}`);
  for (const value of snapshot.action.asserts) console.log(`  - action assert: ${value}`);
  for (const value of snapshot.action.suggests) console.log(`  - action suggest: ${value}`);
  console.log(`- artifact: ${snapshot.artifact.name}`);
  if (snapshot.artifact.type) console.log(`- type: ${snapshot.artifact.type}`);
  if (snapshot.artifact.format) console.log(`- format: ${formatDisplay(snapshot.artifact.format)}`);
  if (snapshot.artifact.schema) {
    console.log(`- schema: ${snapshot.artifact.schema.kind === "external" ? snapshot.artifact.schema.name : snapshot.artifact.schema.id}`);
  }
  console.log(`- final artifact: ${snapshot.artifact.final ? "yes" : "no"}`);
  console.log(`- progress: ${snapshot.progress.completed}/${snapshot.progress.total}`);
  if (snapshot.progress.pendingRepeatControls) {
    console.log(`- repeat controls pending: ${snapshot.progress.pendingRepeatControls}`);
  }
  console.log("- workflow: report each field to update one managed draft; after all fields, read and edit the complete draft before explicitly submitting that same file.");
  console.log("Fields:");
  for (const field of snapshot.progress.fields) console.log(`- ${field.path}: ${field.status}`);
  if (snapshot.draft) {
    console.log("Draft:");
    console.log(`- status: ${snapshot.draft.status}`);
    console.log(`- file: ${snapshot.draft.filePath}`);
    if (snapshot.draft.validation) console.log(`- contract validation: ${snapshot.draft.validation.status}`);
  }
}

function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9_./:-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function printArtifactReviewSummary(
  review: ArtifactReview<RunState["events"][number]["artifact"]>,
  round: ArtifactReviewRound
): void {
  const submitted = round.assignments.filter((assignment) => assignment.status === "submitted").length;
  console.log("Artifact Review:");
  console.log(`- review_id: ${review.id}`);
  console.log(`- review_round_id: ${round.id}`);
  console.log(`- round: ${round.sequence}`);
  console.log(`- status: ${review.status}`);
  console.log(`- submitted: ${submitted}/${round.assignments.length}`);
  console.log("Participants:");
  for (const assignment of round.assignments) {
    const vote = assignment.submitted?.vote ?? "pending";
    const identityKind = assignment.identityKind === "agent" ? ", agent" : "";
    console.log(`- ${assignment.identityName} (${assignment.binding}${identityKind})`);
    console.log(`  - vote: ${vote}`);
    if (assignment.identityKind === "agent") {
      const attempt = assignment.attempts?.at(-1);
      console.log(`  - status: ${assignment.status}`);
      if (attempt) console.log(`  - attempt: ${attempt.sequence}; provider: ${attempt.provider}`);
      if (attempt?.failure) console.log(`  - failure: ${attempt.failure.code}: ${attempt.failure.message}`);
    }
    for (const comment of assignment.submitted?.comments ?? []) console.log(`  - comment: ${comment.body}`);
  }
  const runnerVote = round.votes.find((candidate) => candidate.subject.kind === "runner");
  const runnerCanDecide = Boolean(runnerVote) || authorizeArtifactOperation({
    controlPlane: review.controlPlane,
    subject: { kind: "runner" },
    permission: "decision.decide"
  }).allowed;
  if (runnerVote || runnerCanDecide) {
    console.log(`- Runner (decision${runnerVote?.automatic ? ", automatic" : ""})`);
    console.log(`  - vote: ${runnerVote?.value ?? "pending"}`);
    if (runnerVote?.comment) console.log(`  - comment: ${runnerVote.comment}`);
  }
  console.log("Decision:");
  if (review.status === "awaiting_runner_vote") {
    const participantDecisionVotes = round.votes.filter(
      (vote) => vote.subject.kind === "identity" && vote.binding === "decision"
    );
    const approved = participantDecisionVotes.filter((vote) => vote.value === "approve").length;
    const advisoryTotal = round.votes.filter((vote) => vote.binding === "advisory").length;
    console.log(
      `- All assigned reviews are submitted: ${approved}/${participantDecisionVotes.length} decision votes approved; `
      + `${advisoryTotal} advisory vote${advisoryTotal === 1 ? " was" : "s were"} recorded.`
    );
    console.log("- The policy can still reach unanimous approval. You are the Runner for this Run, and your decision vote is pending.");
    console.log("Conclusion:");
    console.log("- The Artifact has not been accepted and the Run has not advanced. As the Runner, review every comment above, then cast your vote explicitly.");
    return;
  }
  if (round.result) {
    const unanimous = round.result.status === "passed";
    const advisory = round.result.advisoryTotal === 1 ? "1 advisory vote was" : `${round.result.advisoryTotal} advisory votes were`;
    console.log(
      `- unanimous approval ${unanimous ? "was reached" : "was not reached"}: `
      + `${round.result.decisionApprove}/${round.result.decisionTotal} decision votes approved; `
      + `${advisory} recorded and did not affect the decision.`
    );
    console.log("Conclusion:");
    console.log(unanimous
      ? "- This review round passed unanimously, so the reviewed Artifact was accepted and the Run advanced to the next step."
      : "- This review round did not pass because unanimous approval was not reached; revise the Artifact using the comments above, provide a revision summary, and report the new Artifact to start the next round.");
    return;
  }
  const failed = round.assignments.filter((assignment) => assignment.status === "failed");
  if (failed.length) {
    console.log(`- Review is blocked because ${failed.length} Agent Assignment${failed.length === 1 ? " has" : "s have"} failed.`);
    console.log("Conclusion:");
    console.log("- The Artifact has not been accepted and the Run has not advanced. Inspect the failure in View, then retry the failed Agent Assignment.");
    return;
  }
  const remaining = round.assignments.length - submitted;
  console.log(`- No decision has been reached; ${remaining} review submission${remaining === 1 ? "" : "s"} remain.`);
  console.log("Conclusion:");
  console.log("- This review round is still in progress; keep waiting with the same review_id until every assigned reviewer submits.");
}

function printRunnerVoteCommands(
  review: ArtifactReview<RunState["events"][number]["artifact"]>,
  round: ArtifactReviewRound
): void {
  console.log("Then:");
  console.log(`memsphere run review vote --review ${review.id} --round ${round.id} --vote approve`);
  console.log(
    `memsphere run review vote --review ${review.id} --round ${round.id} --vote request_changes --comment <text>`
  );
}

function printPermissionGuidance(run: RunState, step: NonNullable<ReturnType<typeof currentStep>>): void {
  if (!run.controlPlane || !step.controlPlane) return;
  const permissions = step.controlPlane.permissions.runner;
  if (!permissions) return;
  const guidance = renderPermissionGuidance({
    snapshot: run.controlPlane,
    roleId: "runner",
    permissions,
    artifactScope: step.controlPlane.artifactScope,
    locale: permissionLocale()
  });
  console.log("");
  console.log("Control Plane:");
  console.log("- mode: enabled");
  console.log(`- revision: ${run.controlPlane.revision}`);
  console.log("- runner: current run context");
  console.log(`- permission catalog: ${run.controlPlane.permissionCatalog.version}`);
  console.log(`- decision policy catalog: ${run.controlPlane.decisionPolicyCatalog.version}`);
  for (const [roleId, binding] of Object.entries(step.controlPlane.bindings)) {
    const prompt = run.controlPlane.roles[roleId]?.systemPrompt ? "; system_prompt: present" : "";
    console.log(`- ${roleId}: ${binding.identityIds.join(", ")} (${binding.source}${prompt})`);
  }
  console.log(`- runner base permissions: ${permissions.base.join(", ") || "none"}`);
  console.log(`- runner grants: ${permissions.grants.join(", ") || "none"}`);
  console.log(`- runner effective permissions: ${permissions.effective.join(", ") || "none"}`);
  console.log("");
  console.log(permissionLocale() === "zh-CN" ? "权限说明:" : "Permission Guidance:");
  for (const line of guidance.lines) console.log(line);
}

export function printLatestReportAuthorization(run: RunState): void {
  const authorization = [...run.events].reverse().find((event) => event.artifact.authorization)?.artifact.authorization;
  if (!authorization) return;
  console.log("Report Authorization:");
  console.log(`- allowed: ${authorization.permission}`);
  console.log(`- role: ${authorization.roleId}`);
  console.log(`- artifact: ${authorization.artifactScope}`);
  console.log(`- revision: ${authorization.revision}`);
  if (run.controlPlane) {
    const locale = permissionLocale();
    const guidance = renderPermissionGuidance({
      snapshot: run.controlPlane,
      roleId: authorization.roleId,
      permissions: {
        base: authorization.basePermissions,
        grants: authorization.grantedPermissions,
        effective: authorization.effectivePermissions,
        roleSource: authorization.roleSource,
        grantSource: authorization.grantSource
      },
      artifactScope: authorization.artifactScope,
      locale,
      decision: authorization
    });
    console.log(locale === "zh-CN" ? "权限说明:" : "Permission Guidance:");
    for (const line of guidance.lines) console.log(line);
  }
  console.log("");
}

function permissionLocale(): PermissionLocale {
  return process.env.LANG?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
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
    procedureName: run.procedureName,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
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
  return {
    ref: locatedStepRef(located),
    procedureName: located.memoryName,
    current: locatedStepRef(located) === currentRef,
    procedureAsserts: procedureAssertsFor(run, located.memoryName),
    step: {
      id: located.step.id,
      kind: located.step.kind ?? "action",
      actor: located.step.actor ?? "agent",
      instruction: located.step.instruction,
      asserts: located.step.asserts ?? [],
      suggests: located.step.suggests ?? [],
      details: located.step.details ?? [],
      artifact: artifactContractDetail(located.step)
    }
  };
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
  return {
    stepRef: locatedStepRef(located),
    procedure: {
      name: located.memoryName,
      asserts: procedureAssertsFor(run, located.memoryName)
    },
    action: {
      instruction: located.step.instruction,
      asserts: located.step.asserts ?? [],
      suggests: located.step.suggests ?? [],
      details: located.step.details ?? []
    },
    artifact: artifactContractDetail(located.step)
  };
}

function procedureAssertsFor(run: RunState, memoryName: string): string[] {
  const template = Object.values(run.procedureSnapshots ?? {})
    .find((candidate) => candidate.memoryName === memoryName);
  return template?.asserts ?? (memoryName === run.procedureName ? run.asserts ?? [] : []);
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

function formatDisplay(format: NonNullable<ReturnType<typeof currentStep>>["format"]): string {
  if (!format) return "unknown";
  const options = Object.entries(format.options).map(([name, value]) => `${name}: ${String(value)}`);
  return options.length ? `${format.name} (${options.join(", ")})` : format.name;
}

import { readFile } from "node:fs/promises";
import type { ArtifactReview, ArtifactReviewRound } from "../artifact-review.js";
import { readConfig } from "../config.js";
import {
  authorizeArtifactOperation,
  renderPermissionGuidance,
  type PermissionLocale
} from "../control-plane/index.js";
import {
  activeProcedureAsserts,
  type ArtifactReportSource,
  currentArtifactReview,
  currentFrame,
  currentStep,
  enterSchema,
  finalArtifacts,
  listRuns,
  readRun,
  repeatRun,
  reportRun,
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

export async function runStartCommand(procedureName: string): Promise<void> {
  const config = await readConfig();
  const run = await startRun({
    memoryRoot: config.memoryRoot,
    runsRoot: config.runsRoot,
    procedureName,
    controlPlane: config.controlPlane
  });
  printRunState(run);
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
  printLatestReportAuthorization(run);
  printRunState(run);
}

export async function runReviewWaitCommand(options: ReviewWaitOptions): Promise<void> {
  const reviewId = options.review?.trim();
  if (!reviewId) throw new Error("--review <id> is required");
  const config = await readConfig();
  const context = await waitForArtifactReview({ runsRoot: config.runsRoot, reviewId });
  printArtifactReviewSummary(context.review, context.round);
  console.log("");
  if (context.review.status === "passed") {
    printRunState(context.run);
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
    printRunState(context.run);
    return;
  }
  console.log("Then:");
  console.log(
    `memsphere run report --run ${context.run.id} --artifact-file <path> --revision-summary-file <path>`
  );
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
  printRunState(run);
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
  printRunState(run);
}

export async function runStatusCommand(options: RunIdOptions): Promise<void> {
  const config = await readConfig();
  if (options.run) {
    printRunState(await readRun(config.runsRoot, options.run));
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

export function printRunState(run: RunState): void {
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

  const procedureAsserts = activeProcedureAsserts(run);
  if (procedureAsserts.length) {
    console.log("");
    console.log("Procedure Asserts:");
    for (const value of procedureAsserts) console.log(`- ${value}`);
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

  console.log("");
  console.log("Artifact:");
  console.log(`${step.artifact} (${step.type ?? "unknown"} · ${formatDisplay(step.format)})`);
  if (step.actor === "human") {
    console.log("Report the artifact value provided by the human.");
  }

  printPermissionGuidance(run, step);

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
  }
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
    console.log(`- ${assignment.identityName} (${assignment.binding})`);
    console.log(`  - vote: ${vote}`);
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

function formatDisplay(format: NonNullable<ReturnType<typeof currentStep>>["format"]): string {
  if (!format) return "unknown";
  const options = Object.entries(format.options).map(([name, value]) => `${name}: ${String(value)}`);
  return options.length ? `${format.name} (${options.join(", ")})` : format.name;
}

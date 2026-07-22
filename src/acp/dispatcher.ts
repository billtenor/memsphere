import { spawn } from "node:child_process";
import { artifactReviewAssignmentId } from "../artifact-review.js";
import type { MemsphereConfig } from "../config.js";
import {
  claimArtifactReviewAgentAssignment,
  failArtifactReviewAgentAssignment,
  readRun,
  type RunState
} from "../run/store.js";
import { currentCliRuntimeDescriptor, type CliRuntimeDescriptor } from "./cli-runtime.js";

export async function dispatchArtifactReviewAgents(input: {
  config: MemsphereConfig;
  run: RunState;
  runtime?: CliRuntimeDescriptor;
}): Promise<number> {
  const run = await readRun(input.config.runsRoot, input.run.id);
  const reviews = (run.artifactReviews ?? []).filter((review) => review.status === "pending");
  const queued = reviews.flatMap((review) => {
    const round = review.rounds.find((candidate) => candidate.id === review.currentRoundId);
    if (!round || round.status !== "pending") return [];
    return round.assignments
      .filter((assignment) => (assignment.identityKind ?? "human") === "agent" && assignment.status === "queued")
      .map((assignment) => ({ review, round, assignment }));
  });
  if (queued.length === 0) return 0;
  if (input.config.debug.agentReview) return 0;
  const runtime = input.runtime ?? currentCliRuntimeDescriptor();
  await Promise.all(queued.map(async ({ review, round, assignment }) => {
    const args = [
      runtime.cliEntrypoint,
      "run", "review", "agent-worker",
      "--config", input.config.configPath,
      "--review", review.id,
      "--round", round.id,
      "--assignment", artifactReviewAssignmentId(assignment),
      "--node-executable", runtime.nodeExecutable,
      "--cli-entrypoint", runtime.cliEntrypoint
    ];
    const worker = spawn(runtime.nodeExecutable, args, {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore"
    });
    try {
      await new Promise<void>((resolveSpawn, rejectSpawn) => {
        worker.once("spawn", resolveSpawn);
        worker.once("error", rejectSpawn);
      });
      worker.unref();
    } catch (error) {
      const claimed = await claimArtifactReviewAgentAssignment({
        runsRoot: input.config.runsRoot,
        reviewId: review.id,
        roundId: round.id,
        identityId: artifactReviewAssignmentId(assignment),
        workerPid: process.pid
      });
      if (!claimed) return;
      const message = error instanceof Error ? error.message : String(error);
      await failArtifactReviewAgentAssignment({
        runsRoot: input.config.runsRoot,
        reviewId: review.id,
        roundId: round.id,
        identityId: assignment.identityId,
        attemptId: claimed.attempt.id,
        failure: { stage: "spawn", code: "worker_spawn_failed", message }
      });
    }
  }));
  return queued.length;
}

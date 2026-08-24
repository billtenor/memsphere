import { artifactReviewAssignmentId } from "../artifact-review.js";
import type { MemsphereConfig } from "../config.js";
import {
  claimArtifactReviewAgentAssignment,
  failArtifactReviewAgentAssignment,
  readRun,
  type RunState
} from "../run/store.js";
import { currentCliRuntimeDescriptor, type CliRuntimeDescriptor } from "./cli-runtime.js";
import { spawnCommand } from "../platform-process.js";

export async function dispatchArtifactReviewAgents(input: {
  config: MemsphereConfig;
  run: RunState;
  runtime?: CliRuntimeDescriptor;
}): Promise<number> {
  const run = await readRun(input.config.runsRoot, input.run.id);
  if (run.status !== "running") return 0;
  const reviews = (run.artifactReviews ?? []).filter((review) => review.status === "pending");
  const queued = reviews.flatMap((review) => {
    const round = review.rounds.find((candidate) => candidate.id === review.currentRoundId);
    if (!round || round.status !== "pending") return [];
    return round.assignments
      .filter((assignment) => (assignment.actorKind ?? "human") === "agent" && assignment.status === "queued")
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
    const worker = spawnCommand(runtime.nodeExecutable, args, {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      windowsHide: true
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
        actorId: artifactReviewAssignmentId(assignment),
        workerPid: process.pid
      });
      if (!claimed) return;
      const message = error instanceof Error ? error.message : String(error);
      await failArtifactReviewAgentAssignment({
        runsRoot: input.config.runsRoot,
        reviewId: review.id,
        roundId: round.id,
        actorId: assignment.actorId,
        attemptId: claimed.attempt.id,
        failure: { stage: "spawn", code: "worker_spawn_failed", message }
      });
    }
  }));
  return queued.length;
}

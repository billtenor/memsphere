import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { withNativeFileLock } from "../file-lock.js";
import { atomicWriteJson } from "../persistence.js";
import { artifactReviewAssignmentId } from "../artifact-review.js";
import type { MemsphereConfig } from "../config.js";
import {
  claimArtifactReviewAgentAssignment,
  failArtifactReviewAgentAssignment,
  readRun,
  type RunState
} from "../context_control/review-repository.js";
import { currentCliRuntimeDescriptor, type CliRuntimeDescriptor } from "./cli-runtime.js";
import { spawnCommand } from "../platform-process.js";

export async function dispatchArtifactReviewAgents(input: {
  config: MemsphereConfig;
  run: RunState;
  runtime?: CliRuntimeDescriptor;
  launchWorker?: (assignment: {
    reviewId: string;
    roundId: string;
    assignmentId: string;
  }) => Promise<void>;
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
    const assignmentId = artifactReviewAssignmentId(assignment);
    if (input.launchWorker) {
      await input.launchWorker({ reviewId: review.id, roundId: round.id, assignmentId });
      return;
    }
    const key = createHash("sha256").update(`${review.id}/${round.id}/${assignmentId}`).digest("hex");
    const directory = join(input.config.scopeRoot, ".runtime", "review-dispatch");
    await mkdir(directory, { recursive: true });
    await withNativeFileLock(join(directory, `${key}.lock`), async () => {
      const current = await readRun(input.config.runsRoot, input.run.id);
      const currentAssignment = current.artifactReviews?.find(r => r.id === review.id)?.rounds.find(r => r.id === round.id)?.assignments.find(a => artifactReviewAssignmentId(a) === assignmentId);
      if (currentAssignment?.status !== "queued") return;
      try {
        const marker = JSON.parse(await readFile(join(directory, `${key}.json`), "utf8"));
        try { process.kill(marker.pid, 0); return; } catch { /* previous worker exited */ }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const args = [
      runtime.cliEntrypoint,
      "run", "review", "agent-worker",
      "--config", input.config.configPath,
      "--review", review.id,
      "--round", round.id,
      "--assignment", assignmentId,
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
      await atomicWriteJson(join(directory, `${key}.json`), { pid: worker.pid });
      worker.unref();
    } catch (error) {
      const claimed = await claimArtifactReviewAgentAssignment({
        runsRoot: input.config.runsRoot,
        reviewId: review.id,
        roundId: round.id,
        actorId: assignmentId,
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
    });
  }));
  return queued.length;
}

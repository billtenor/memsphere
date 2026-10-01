type RunWorkers = {
  artifactReviews?: ReadonlyArray<{
    rounds: ReadonlyArray<{
      assignments: ReadonlyArray<{ attempts?: ReadonlyArray<{ workerPid?: number }> }>;
    }>;
  }>;
};

/** A PID is not an identity proof: only confirmed absence permits transfer. */
export function ensureRunWorkersExited(run: RunWorkers, probe: (pid: number) => void = (pid) => { process.kill(pid, 0); }): void {
  const pids = new Set((run.artifactReviews ?? []).flatMap((review) => review.rounds.flatMap((round) => round.assignments.flatMap((assignment) => (assignment.attempts ?? []).flatMap((attempt) => attempt.workerPid === undefined ? [] : [attempt.workerPid])))));
  for (const pid of pids) {
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`Cannot confirm Run Worker exit for PID ${pid}; retry later`);
    try {
      probe(pid);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") continue;
      throw new Error(`Cannot confirm Run Worker exit for PID ${pid}; retry later`, { cause: error });
    }
    throw new Error(`Run Worker PID ${pid} still exists; retry after it exits`);
  }
}

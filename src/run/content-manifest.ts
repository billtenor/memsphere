import { artifactReviewAssignmentId } from "../artifact-review.js";
import { agentActivityIds } from "../acp/activity.js";
import { runMemoryFiles } from "../memory/run-provider.js";
import type { RunDataKind } from "../project/run-data.js";
import type { RunEvent, RunState } from "./store.js";

export type RunContentRef = { kind: RunDataKind; id: string; required: boolean };

/** Business-owned identity inventory; never enumerate a Store's mixed root. */
export function runContentManifest(run: RunState): RunContentRef[] {
  const refs = new Map<string, RunContentRef>();
  const add = (kind: RunDataKind, id: string, required: boolean) => {
    const segment = kind === "artifact" ? "artifacts" : kind === "memory" ? "memory" : "agent-activity";
    if (!id.startsWith(`${run.id}/${segment}/`) || id.includes("\\") || id.split("/").some((part) => !part || part === "." || part === "..")) throw new Error(`Run content identity escapes its owner: ${id}`);
    refs.set(`${kind}:${id}`, { kind, id, required });
  };
  const artifact = (value: RunEvent["artifact"]) => {
    if (value.storage === "file" && value.path) add("artifact", value.path, true);
  };
  for (const event of run.events) artifact(event.artifact);
  for (const draft of Object.values(run.schemaDrafts ?? {})) add("artifact", draft.path, true);
  for (const id of runMemoryFiles(run)) add("memory", id, true);
  for (const review of run.artifactReviews ?? []) {
    for (const submission of review.submissions) {
      artifact(submission.artifact);
      for (const context of submission.contextArtifacts) artifact(context.artifact);
    }
    for (const round of review.rounds) for (const assignment of round.assignments) for (const attempt of assignment.attempts ?? []) {
      const ids = agentActivityIds({ runsRoot: ".", runId: run.id, reviewId: review.id, roundId: round.id, assignmentId: artifactReviewAssignmentId(assignment), attemptId: attempt.id });
      add("activityLog", ids.log, false);
      add("activitySnapshot", ids.snapshot, false);
    }
  }
  return [...refs.values()];
}

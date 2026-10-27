import { createHash } from "node:crypto";
import type { ContextControl } from "./service.js";
import type { Snapshot } from "./types.js";
import { isGraphRun } from "./graph-runtime.js";
import { parseMemoryEntity } from "../memory/store.js";
import { parseMemoryYaml } from "../memory/yaml.js";
import { graphReviewHandle } from "./review-repository.js";
import { projectGraphRound } from "./graph-review.js";

export function contextRunPayload(snapshot: Snapshot) {
  const { run } = snapshot;
  const p = isGraphRun(run) ? parseMemoryEntity("procedures", parseMemoryYaml(run.memorySnapshot!.memories[run.memoryRef!].payload.content)) : undefined;
  const creationOrder = new Map(run.frames?.[0]?.graphFrame?.triggers.map((trigger, index) => [trigger.stepId, index]) ?? []);
  const graph = p?.tag === "!procedure" && p.mode === "graph" ? { procedure: p, work: [...snapshot.steps].sort((a, b) => creationOrder.get(a.id)! - creationOrder.get(b.id)!).map(s => ({ ...s, action: p.actions.find(a => a.id === s.source?.actionId), ...(s.reviewRounds?.length ? { reviewHandle: graphReviewHandle(run.id, s.id) } : {}) })) } : undefined;
  const artifactReviewSummaries = graph ? snapshot.steps.filter(s => s.reviewRounds?.length).map(step => {
    const round = step.reviewRounds!.at(-1)!; const projected = projectGraphRound(run, step, round, snapshot.reviews);
    return { id: graphReviewHandle(run.id, step.id), stepId: step.id, currentRoundId: round.id, status: projected.status === "changes_requested" ? "awaiting_revision" : projected.status, round: projected };
  }) : [];
  return { ...run, artifactReviewSummaries, outputArtifactIds: snapshot.outputArtifactIds, representation: "context-control", procedureName: p?.names[0] ?? "", updatedAt: run.endedAt ?? snapshot.steps.map(s => s.endedAt ?? s.createdAt).sort().at(-1) ?? run.createdAt,
    contextRevision: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"), eventCount: snapshot.completeIds.length, archived: Boolean(run.archived), readOnly: Boolean(run.archived), context: { ...snapshot, ...(graph ? { graph } : {}) } };
}
export async function contextRunSummaries(service: ContextControl | undefined) {
  if (!service) return [];
  return Promise.all((await service.listRunEntries()).map(async entry => {
    if (entry.run) {
      try { const { context: _, ...summary } = contextRunPayload(await service.snapshot(entry.id)); return summary; }
      catch (error) { return { ...entry.run, updatedAt: entry.run.createdAt, unavailable: true, error: error instanceof Error ? error.message : String(error) }; }
    }
    return { id: entry.id, name: entry.id, status: "running" as const, createdAt: "", updatedAt: "", archived: false, unavailable: true, error: entry.error };
  }));
}
export function assertUniqueRunSources(legacy: Array<{ id: string }>, current: Array<{ id: string }>) {
  const ids = new Set(legacy.map(r => r.id));
  if (current.some(r => ids.has(r.id))) throw new Error("Run ID exists in both legacy and model Stores");
}

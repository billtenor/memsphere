import { createHash } from "node:crypto";
import type { ContextControl } from "./service.js";
import type { Run, Snapshot } from "./types.js";

/** Basic list metadata must not depend on any child records. */
export function contextRunSummary(run: Run) {
  return { ...run, representation: "context-control", procedureName: "", updatedAt: run.endedAt ?? run.createdAt,
    archived: Boolean(run.archived), readOnly: Boolean(run.archived) };
}

export function contextRunPayload(snapshot: Snapshot) {
  const { run } = snapshot;
  return { ...run, outputArtifactIds: snapshot.outputArtifactIds, representation: "context-control", procedureName: "", updatedAt: run.endedAt ?? snapshot.steps.map(s => s.endedAt ?? s.createdAt).sort().at(-1) ?? run.createdAt,
    contextRevision: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"), eventCount: snapshot.completeIds.length, archived: Boolean(run.archived), readOnly: Boolean(run.archived), context: snapshot };
}
export async function contextRunSummaries(service: ContextControl | undefined) {
  if (!service) return [];
  return Promise.all((await service.listRuns()).map(async run => { const { context: _, ...summary } = contextRunPayload(await service.snapshot(run.id)); return summary; }));
}
export function assertUniqueRunSources(legacy: Array<{ id: string }>, current: Array<{ id: string }>) {
  const ids = new Set(legacy.map(r => r.id));
  if (current.some(r => ids.has(r.id))) throw new Error("Run ID exists in both legacy and model Stores");
}

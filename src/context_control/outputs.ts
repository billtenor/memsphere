import type { Artifact, Run } from "./types.js";

/** Derived from completed immutable records; never persisted as a second root set. */
export function automaticOutputs(artifacts: Artifact[], completeIds: string[]): string[] {
  const complete = new Set(completeIds);
  const consumed = new Set(artifacts.filter(a => complete.has(a.id)).flatMap(a => [
    ...(a.revisedFrom ? [a.revisedFrom] : []), ...a.dependencies.filter(r => r.kind === "artifact").map(r => r.id)
  ]));
  return completeIds.filter(id => !consumed.has(id));
}
export function deriveOutputs(run: Run, artifacts: Artifact[], completeIds: string[]): string[] {
  const removed = new Set(run.outputOverrides?.removedArtifactIds ?? []);
  return [...new Set([...automaticOutputs(artifacts, completeIds), ...(run.outputOverrides?.addedArtifactIds ?? [])])].filter(id => !removed.has(id));
}
/** Represent an explicit choice as differences from the graph, e.g. when finishing or upgrading. */
export function outputOverrides(automatic: string[], selected: string[]): NonNullable<Run["outputOverrides"]> {
  const auto = new Set(automatic), chosen = new Set(selected);
  return { addedArtifactIds: [...chosen].filter(id => !auto.has(id)), removedArtifactIds: automatic.filter(id => !chosen.has(id)) };
}

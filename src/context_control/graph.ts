import type { Snapshot, Artifact } from "./types.js";
import { failure } from "./service.js";

export function dependencyClosure(snapshot: Snapshot, roots: string[]): string[] {
  const result = new Set<string>(); const visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw failure("DEPENDENCY_CYCLE", "Cyclic Artifact graph");
    if (result.has(id)) return;
    const a = snapshot.artifacts.find(a => a.id === id);
    if (!a || !snapshot.completeIds.includes(id)) throw failure("INCOMPLETE_ARTIFACT", `Unknown or incomplete Artifact: ${id}`);
    visiting.add(id);
    for (const r of a.dependencies) if (r.kind === "artifact") visit(r.id);
    visiting.delete(id); result.add(id);
  };
  roots.forEach(visit); return [...result];
}
export function downstream(snapshot: Snapshot, id: string): string[] {
  if (!snapshot.artifacts.some(a => a.id === id)) throw failure("NOT_FOUND", `Unknown Artifact: ${id}`);
  const result = new Set<string>(); const pending = [id];
  while (pending.length) {
    const source = pending.pop()!;
    for (const a of snapshot.artifacts) if (a.dependencies.some(r => r.kind === "artifact" && r.id === source) && !result.has(a.id)) { result.add(a.id); pending.push(a.id); }
  }
  result.delete(id); return [...result];
}
export function scopedSnapshot(snapshot: Snapshot, roots: string[]): Snapshot {
  const ids = dependencyClosure(snapshot, roots); const artifacts = snapshot.artifacts.filter(a => ids.includes(a.id));
  const externalIds = artifacts.flatMap(a => a.dependencies.filter(r => r.kind === "external").map(r => r.id));
  return { ...snapshot, artifacts, steps: snapshot.steps.filter(s => artifacts.some(a => a.stepId === s.id)), externals: snapshot.externals.filter(e => externalIds.includes(e.id)), reviews: snapshot.reviews.filter(r => ids.includes(r.artifactId)), completeIds: ids, outputArtifactIds: [...new Set(roots)] };
}

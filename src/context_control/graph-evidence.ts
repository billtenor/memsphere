import type { Artifact, Ref, Snapshot, Step } from "./types.js";
import type { GraphProcedureMemory } from "../memory/ast.js";
import { effectiveStep, triggerArrivals } from "./graph-rewind.js";
import { failure } from "./errors.js";

/** Validate explicit evidence against this instance's frozen data/control arrivals.
 * This is eligibility, never a default Reviewer visibility expansion.
 */
export function graphEvidence(snapshot: Snapshot, target: Step, procedure?: GraphProcedureMemory): Set<string> {
  const frame = snapshot.run.frames![0].graphFrame;
  const eligible = new Set<string>(), seenSteps = new Set<string>(), seenTriggers = new Set<string>();
  const artifact = (id: string) => {
    const a = snapshot.artifacts.find(a => a.id === id);
    if (!a || !snapshot.completeIds.includes(id)) throw failure("GRAPH_SOURCE_UNAVAILABLE", `Evidence is not an accepted current Artifact: ${id}`);
    eligible.add(id); visitStep(a.stepId);
    for (const ref of a.dependencies) if (ref.kind === "artifact") artifactRef(ref.id);
  };
  const seenArtifacts = new Set<string>();
  const artifactRef = (id: string) => { if (!seenArtifacts.has(id)) { seenArtifacts.add(id); artifact(id); } };
  const visitTrigger = (id: string) => {
    if (seenTriggers.has(id)) return;
    seenTriggers.add(id);
    const t = frame.triggers.find(t => t.id === id);
    if (!t) throw failure("GRAPH_SOURCE_UNAVAILABLE", `Frozen control evidence unavailable: ${id}`);
    const arrivals = t.arrivals ?? (procedure ? triggerArrivals(t, snapshot, procedure) : undefined);
    if (!arrivals) throw failure("GRAPH_SOURCE_UNAVAILABLE", `Frozen control evidence unavailable: ${id}`);
    for (const a of Object.values(arrivals)) {
      if (a.kind === "artifact") artifactRef(a.id);
      if (a.kind === "collect") { if (!a.stepId) throw failure("GRAPH_SOURCE_UNAVAILABLE", "Collect arrival has no fixed Step"); visitStep(a.stepId); }
    }
    for (const refs of Object.values(t.inputs ?? {})) for (const ref of refs) if (ref.kind === "artifact") artifactRef(ref.id);
    if (t.collection) for (const observed of t.collection.triggerIds) {
      visitTrigger(observed);
      const source = frame.triggers.find(t => t.id === observed)?.stepId;
      if (source) {
        const step = snapshot.steps.find(s => s.id === source);
        if (step?.status === "done" && step.artifact?.mode === "produce") artifactRef(step.artifact.id);
      }
    }
  };
  const visitStep = (id: string) => {
    if (seenSteps.has(id)) return;
    seenSteps.add(id);
    const step = snapshot.steps.find(s => s.id === id);
    if (!step || !effectiveStep(snapshot.run, id)) throw failure("GRAPH_SOURCE_UNAVAILABLE", `Control Step unavailable: ${id}`);
    const trigger = frame.triggers.find(t => t.stepId === id);
    if (!trigger) throw failure("GRAPH_SOURCE_UNAVAILABLE", `Creation trigger unavailable: ${id}`);
    visitTrigger(trigger.id);
    for (const refs of Object.values(step.inputs ?? {})) for (const ref of refs) if (ref.kind === "artifact") artifactRef(ref.id);
    if (step.artifact?.mode === "collect") {
      if (!trigger.collection) throw failure("GRAPH_SOURCE_UNAVAILABLE", "Collect membership evidence unavailable");
      for (const id of Object.values(trigger.collection.items).flat()) artifactRef(id);
    }
  };
  visitStep(target.id);
  return eligible;
}

export function supplementalDependencies(artifact: Artifact, owner: Step): Ref[] {
  const mandatory = new Set(Object.values(owner.inputs ?? {}).flat().map(r => `${r.kind}:${r.id}`));
  return artifact.dependencies.filter(r => !mandatory.has(`${r.kind}:${r.id}`));
}

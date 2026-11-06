import type { GraphProcedureMemory } from "../memory/ast.js";
import type { Arrival, Artifact, DeferredCollect, GraphJoin, GraphTrigger, Run, Snapshot, Step } from "./types.js";
import { failure } from "./errors.js";

export function graphFrame(run: Run) { return run.frames![0].graphFrame; }
export function supersedingRewind(run: Run, id: string) { return graphFrame(run).rewinds?.find(r => r.affectedStepIds.includes(id)); }
export function effectiveStep(run: Run, id: string) { return !supersedingRewind(run, id); }
export function requireEffectiveStep(run: Run, id: string) {
  const rewind = supersedingRewind(run, id);
  if (rewind) throw Object.assign(failure("STEP_SUPERSEDED", `Step ${id} was superseded; query run status --run ${run.id}`), { details: { runId: run.id, stepId: id, rewindId: rewind.id, recoveryCommand: `memsphere run status --run ${run.id}` } });
}
export function artifactOwner(artifacts: Artifact[], id: string) { return artifacts.find(a => a.id === id)?.stepId; }
export function arrivalSources(arrival: Arrival, artifacts: Artifact[]): string[] {
  if (arrival.kind === "start") return [];
  return [...new Set([...(arrival.stepId ? [arrival.stepId] : []), ...(arrival.kind === "artifact" ? [artifactOwner(artifacts, arrival.id)] : Object.values(arrival.items).flat().map(id => artifactOwner(artifacts, id)))].filter((id): id is string => Boolean(id)))];
}
function sourceSteps(step: Step, artifacts: Artifact[], triggers: GraphTrigger[] = []) {
  const trigger = triggers.find(t => t.stepId === step.id);
  const evidence = (trigger?.collection?.triggerIds ?? []).flatMap(id => {
    const observed = triggers.find(t => t.id === id)!;
    return [...(observed.stepId ? [observed.stepId] : []), ...Object.values(observed.arrivals ?? {}).flatMap(a => arrivalSources(a, artifacts)), ...Object.values(observed.inputs ?? {}).flat().map(ref => artifactOwner(artifacts, ref.id)).filter((id): id is string => Boolean(id))];
  });
  return [...new Set([...evidence, ...Object.values(trigger?.arrivals ?? {}).flatMap(a => arrivalSources(a, artifacts)), ...Object.values(step.inputs ?? {}).flat().map(r => artifactOwner(artifacts, r.id)), ...(step.artifact?.mode === "collect" ? Object.values(step.artifact.items).flat().map(id => artifactOwner(artifacts, id)) : [])].filter((id): id is string => Boolean(id)))];
}
/** New triggers retain the exact control arrivals. Older direct-input triggers can be reconstructed. */
export function triggerArrivals(trigger: GraphTrigger, snapshot: Snapshot, procedure: GraphProcedureMemory): Record<string, Arrival> {
  if (trigger.arrivals) return structuredClone(trigger.arrivals);
  const action = procedure.actions.find(a => a.id === trigger.actionId)!;
  const dep = action.dependencies[trigger.dependencyIndex];
  const sources = typeof dep.from === "string" ? [dep.from] : dep.from;
  const inputs = trigger.stepId ? snapshot.steps.find(s => s.id === trigger.stepId)?.inputs : trigger.inputs;
  const result: Record<string, Arrival> = {};
  for (const source of sources) {
    if (source === "START") { result[source] = { kind: "start" }; continue; }
    const sourceAction = procedure.actions.find(a => a.id === source)!;
    if (sourceAction.collect) throw failure("GRAPH_SOURCE_UNAVAILABLE", "Historical collect control source is unavailable; cannot safely reconstruct this rewind");
    const refs = inputs?.[source];
    if (refs?.length !== 1 || refs[0].kind !== "artifact") throw failure("GRAPH_SOURCE_UNAVAILABLE", `Historical source ${source} cannot be reconstructed`);
    const stepId = artifactOwner(snapshot.artifacts, refs[0].id);
    if (!stepId) throw failure("INVALID_STATE", "Arrival Artifact has no source Step");
    result[source] = { kind: "artifact", id: refs[0].id, stepId };
  }
  return result;
}
/** The order of successful Run dispatch commits, not reserved completion numbers. */
export function arrivalRank(run: Run, arrival: Arrival, artifacts: Artifact[]) {
  if (arrival.kind === "start") return -1;
  const source = arrival.stepId ?? (arrival.kind === "artifact" ? artifactOwner(artifacts, arrival.id) : undefined);
  const rank = source ? graphFrame(run).processedStepIds.indexOf(source) : -1;
  if (rank < 0) throw failure("GRAPH_SOURCE_UNAVAILABLE", "Arrival has no committed dispatch identity");
  return rank;
}
export function mergeArrivals(run: Run, into: Record<string, Arrival>, incoming: Record<string, Arrival>, artifacts: Artifact[]) {
  for (const [source, arrival] of Object.entries(incoming)) {
    if (arrivalSources(arrival, artifacts).some(id => !effectiveStep(run, id))) continue;
    const rank = arrivalRank(run, arrival, artifacts);
    if (!Object.hasOwn(into, source) || rank > arrivalRank(run, into[source], artifacts))
      Object.defineProperty(into, source, { value: structuredClone(arrival), enumerable: true, writable: true, configurable: true });
  }
}
export type RewindPlan = {
  targetStepId: string; actionId: string; dependencyIndex: number; inputs: Step["inputs"];
  affectedStepIds: string[]; affectedArtifactIds: string[]; affectedTriggerIds: string[]; retainedStepIds: string[];
  joins: GraphJoin[]; deferred: Omit<DeferredCollect, "rewindId">[];
};
export function planRewind(snapshot: Snapshot, procedure: GraphProcedureMemory, targetStepId: string): RewindPlan {
  const { run, steps, artifacts } = snapshot;
  if (run.status !== "running" || run.archived) throw failure("RUN_FINISHED", `Run is ${run.status}`);
  requireEffectiveStep(run, targetStepId);
  const target = steps.find(s => s.id === targetStepId);
  if (!target) throw failure("NOT_FOUND", `Step not found in Run: ${targetStepId}`);
  const action = procedure.actions.find(a => a.id === target.source?.actionId);
  if (!action?.artifact || !["running", "awaiting_review", "done"].includes(target.status)) throw failure("INVALID_ARGUMENT", "Rewind requires a started, current production Step");
  const frame = graphFrame(run);
  if (sourceSteps(target, artifacts, frame.triggers).some(id => !effectiveStep(run, id))) throw failure("INVALID_STATE", "Target has superseded inputs");
  const retiredTriggers = new Set(frame.rewinds?.flatMap(r => r.affectedTriggerIds) ?? []);
  const triggers = frame.triggers.filter(t => !retiredTriggers.has(t.id));
  const targetTrigger = triggers.find(t => t.stepId === target.id);
  if (!targetTrigger) throw failure("INVALID_STATE", "Target creation trigger is missing");
  for (const step of steps.filter(s => effectiveStep(run, s.id) && s.status === "done" && s.artifact?.mode === "collect")) {
    const trigger = triggers.find(t => t.stepId === step.id)!;
    const members = procedure.actions.find(a => a.id === trigger.actionId)!.collect!;
    if (!trigger.collection && recoveryPathActions(procedure, action.id, members, trigger.actionId).includes(action.id))
      throw failure("GRAPH_SOURCE_UNAVAILABLE", "Historical collect membership/condition evidence is unavailable; cannot safely reconstruct this rewind");
  }
  const arrivals = new Map(triggers.map(t => [t.id, triggerArrivals(t, snapshot, procedure)]));
  const affected = new Set([target.id]), affectedTriggers = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of steps.filter(s => effectiveStep(run, s.id))) {
      if (!affected.has(step.id) && sourceSteps(step, artifacts, frame.triggers).some(id => affected.has(id))) { affected.add(step.id); changed = true; }
    }
    for (const t of triggers) {
      if (t.stepId && affected.has(t.stepId) || Object.values(arrivals.get(t.id)!).some(a => arrivalSources(a, artifacts).some(id => affected.has(id)))) {
        affectedTriggers.add(t.id);
        if (t.stepId && !affected.has(t.stepId)) { affected.add(t.stepId); changed = true; }
      }
    }
  }
  const futureRun = structuredClone(run);
  graphFrame(futureRun).rewinds = [...(frame.rewinds ?? []), { id: "plan", createdAt: run.createdAt, reason: "plan", targetStepId, replacementStepId: "plan", affectedStepIds: [...affected], affectedTriggerIds: [...affectedTriggers] }];
  const joins = structuredClone(frame.joins);
  for (const join of joins) for (const [source, arrival] of Object.entries(join.arrivals))
    if (arrivalSources(arrival, artifacts).some(id => affected.has(id))) delete join.arrivals[source];
  const deferred: RewindPlan["deferred"] = [];
  // One recovery slot per collect dependency. Preserve membership provenance even
  // after its original trigger has become historical, so later independent
  // rewinds can extend the same wait instead of bypassing it.
  const memberWait = (members: string[]) => {
    const ancestors = new Set(members.filter(id => affected.has(id)));
    let more = true;
    while (more) {
      more = false;
      for (const id of [...ancestors]) for (const parent of sourceSteps(steps.find(s => s.id === id)!, artifacts, frame.triggers))
        if (affected.has(parent) && !ancestors.has(parent)) { ancestors.add(parent); more = true; }
    }
    return [...new Set([...ancestors].map(id => steps.find(s => s.id === id)!.source!.actionId))];
  };
  const mergeGate = (incoming: RewindPlan["deferred"][number]) => {
    let gate = deferred.find(g => g.actionId === incoming.actionId && g.dependencyIndex === incoming.dependencyIndex);
    if (!gate) { gate = { ...incoming, arrivals: {}, waits: [], memberStepIds: [], memberSourceStepIds: [] }; deferred.push(gate); }
    mergeArrivals(futureRun, gate.arrivals, incoming.arrivals, artifacts);
    gate.memberStepIds = [...new Set([...gate.memberStepIds, ...incoming.memberStepIds])];
    gate.memberSourceStepIds = [...new Set([...(gate.memberSourceStepIds ?? []), ...(incoming.memberSourceStepIds ?? [])])];
    for (const wait of incoming.waits) {
      const old = gate.waits.find(w => w.rootStepId === wait.rootStepId);
      if (old) old.waitActionIds = [...new Set([...old.waitActionIds, ...wait.waitActionIds])];
      else gate.waits.push(structuredClone(wait));
    }
  };
  for (const old of frame.deferredCollects ?? []) {
    const gate = structuredClone(old);
    gate.arrivals = Object.fromEntries(Object.entries(gate.arrivals).filter(([, a]) => !arrivalSources(a, artifacts).some(id => affected.has(id))));
    gate.waits = gate.waits.map(w => ({ ...w, rootStepId: affected.has(w.rootStepId) ? "replacement" : w.rootStepId }));
    const paths = memberWait([...gate.memberStepIds, ...(gate.memberSourceStepIds ?? []), ...Object.values(old.arrivals).flatMap(a => arrivalSources(a, artifacts))]);
    if (paths.length) gate.waits.push({ rootStepId: "replacement", waitActionIds: paths });
    mergeGate(gate);
  }
  for (const t of triggers.filter(t => affectedTriggers.has(t.id) && t.id !== targetTrigger.id)) {
    const a = procedure.actions.find(a => a.id === t.actionId)!;
    const signals = arrivals.get(t.id)!;
    const unaffected = Object.fromEntries(Object.entries(signals).filter(([, arrival]) => !arrivalSources(arrival, artifacts).some(id => affected.has(id))));
    const oldStep = steps.find(s => s.id === t.stepId);
    const members = oldStep?.artifact?.mode === "collect" ? [...new Set(Object.values(oldStep.artifact.items).flat().map(id => artifactOwner(artifacts, id)!))] : [];
    const memberSources = oldStep ? sourceSteps(oldStep, artifacts, frame.triggers) : [];
    const paths = memberWait([...members, ...memberSources, ...Object.values(signals).flatMap(a => arrivalSources(a, artifacts))]);
    if (a.collect && (paths.length || deferred.some(g => g.actionId === t.actionId && g.dependencyIndex === t.dependencyIndex))) {
      mergeGate({ triggerId: t.id, actionId: t.actionId, dependencyIndex: t.dependencyIndex, arrivals: unaffected, memberStepIds: members, memberSourceStepIds: memberSources, waits: paths.length ? [{ rootStepId: "replacement", waitActionIds: paths }] : [] });
    } else {
      let join = joins.find(j => j.actionId === t.actionId && j.dependencyIndex === t.dependencyIndex);
      if (!join) { join = { actionId: t.actionId, dependencyIndex: t.dependencyIndex, arrivals: {} }; joins.push(join); }
      mergeArrivals(futureRun, join.arrivals, unaffected, artifacts);
    }
  }
  for (const gate of deferred) {
    const join = joins.find(j => j.actionId === gate.actionId && j.dependencyIndex === gate.dependencyIndex);
    if (join) { mergeArrivals(futureRun, gate.arrivals, join.arrivals, artifacts); join.arrivals = {}; }
  }
  for (const gate of deferred) for (const wait of gate.waits) {
    const rootAction = wait.rootStepId === "replacement" ? action.id : steps.find(s => s.id === wait.rootStepId)!.source!.actionId;
    // Conditions can select another declared member, not only a new route to
    // an old member. Bound the actual frontier by every member of this collect.
    const members = procedure.actions.find(a => a.id === gate.actionId)!.collect!;
    wait.waitActionIds = recoveryPathActions(procedure, rootAction, [...wait.waitActionIds, ...members], gate.actionId);
  }
  return { targetStepId, actionId: action.id, dependencyIndex: targetTrigger.dependencyIndex, inputs: structuredClone(target.inputs ?? {}), affectedStepIds: [...affected], affectedArtifactIds: artifacts.filter(a => affected.has(a.stepId)).map(a => a.id), affectedTriggerIds: [...affectedTriggers], retainedStepIds: steps.filter(s => effectiveStep(run, s.id) && !affected.has(s.id)).map(s => s.id), joins, deferred };
}
/** Possible routes bound the *actual* in-flight frontier; they do not wait for
 * unrelated actions or assume an old when branch will be selected again. */
function recoveryPathActions(procedure: GraphProcedureMemory, root: string, targets: string[], boundary: string) {
  const edges = procedure.actions.filter(a => a.id !== boundary).flatMap(a => [
    ...a.dependencies.flatMap(d => (typeof d.from === "string" ? [d.from] : d.from).map(source => [source, a.id])),
    ...(a.collect ?? []).map(source => [source, a.id])
  ]);
  const forward = new Set([root]), backward = new Set(targets);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [from, to] of edges) {
      if (forward.has(from) && !forward.has(to)) { forward.add(to); changed = true; }
      if (backward.has(to) && !backward.has(from)) { backward.add(from); changed = true; }
    }
  }
  return [...forward].filter(id => backward.has(id) && id !== boundary);
}
/** Freeze exact observed member-path triggers, including false conditions and
 * empty intermediate collects. Historical evidence survives recovery-slot removal. */
export function collectMemberTriggerIds(snapshot: Snapshot, procedure: GraphProcedureMemory, actionId: string) {
  const members = procedure.actions.find(a => a.id === actionId)!.collect!;
  const relevant = new Set(recoveryPathActions(procedure, "START", members, actionId));
  const retired = new Set(graphFrame(snapshot.run).rewinds?.flatMap(r => r.affectedTriggerIds) ?? []);
  return graphFrame(snapshot.run).triggers.filter(t => relevant.has(t.actionId) && !retired.has(t.id)).map(t => t.id);
}
export function collectReplayReady(snapshot: Snapshot, gate: DeferredCollect) {
  const frame = graphFrame(snapshot.run);
  return gate.waits.every(wait => {
    const root = snapshot.steps.find(s => s.id === wait.rootStepId);
    if (!root || !effectiveStep(snapshot.run, root.id) || root.status !== "done" || !frame.processedStepIds.includes(root.id)) return false;
    const descendants = new Set([root.id]);
    let more = true;
    while (more) { more = false; for (const t of frame.triggers) {
      if (!t.stepId || descendants.has(t.stepId) || !effectiveStep(snapshot.run, t.stepId) || t.actionId === gate.actionId) continue;
      if (sourceSteps(snapshot.steps.find(s => s.id === t.stepId)!, snapshot.artifacts, frame.triggers).some(id => descendants.has(id))) { descendants.add(t.stepId); more = true; }
    } }
    if (snapshot.steps.some(s => descendants.has(s.id) && wait.waitActionIds.includes(s.source!.actionId) && (s.status !== "done" || !frame.processedStepIds.includes(s.id)))) return false;
    if (frame.joins.some(j => wait.waitActionIds.includes(j.actionId) && j.actionId !== gate.actionId && Object.values(j.arrivals).some(a => arrivalSources(a, snapshot.artifacts).some(id => descendants.has(id))))) return false;
    // An upstream collect may not have a Step yet. Its recovery slot is a live
    // production frontier too, independent of array order and material inputs.
    return !(frame.deferredCollects ?? []).some(upstream => upstream !== gate && wait.waitActionIds.includes(upstream.actionId) && (
      upstream.waits.some(w => descendants.has(w.rootStepId)) ||
      Object.values(upstream.arrivals).some(a => arrivalSources(a, snapshot.artifacts).some(id => descendants.has(id)))
    ));
  });
}

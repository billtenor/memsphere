import type { ModelRuntime } from "../data/api/model-runtime.js";
import { failure } from "./errors.js";

type RecordValue = Record<string, any>;
const has = (value: object, key: string) => Object.hasOwn(value, key);
function invalid(path: string): never { throw failure("INVALID_STATE", `Invalid context_control discriminated value: ${path}`); }
function variant(value: RecordValue, discriminator: string, cases: Record<string, string[]>, path: string) {
  const selected = cases[value[discriminator]];
  if (!selected) invalid(`${path}.${discriminator}`);
  const fields = [...new Set(Object.values(cases).flat())];
  for (const field of fields) if (has(value, field) !== selected.includes(field)) invalid(`${path}.${field}`);
}
function step(value: RecordValue, path: string) {
  const frames = value.frames ?? [];
  if (frames.some((frame: RecordValue) => frame.type === "submission") && frames.length !== 1) invalid(`${path}.frames: submission must be the sole recovery intent`);
  for (const [i, frame] of frames.entries()) {
    variant(frame, "type", { schema: ["schemaFrame"], submission: ["submissionFrame"] }, `${path}.frames[${i}]`);
    if (frame.type === "submission") {
      const stage = frame.submissionFrame;
      if ((stage.nextStatus === "awaiting_review") !== has(stage, "round")) invalid(`${path}.submissionFrame.round`);
      if (has(stage, "completionSequence") !== has(stage, "endedAt") || stage.completionSequence !== undefined && stage.nextStatus !== "done") invalid(`${path}.submissionFrame.completionSequence`);
    }
  }
  if (value.artifact) variant(value.artifact, "mode", { produce: ["id"], collect: ["items"] }, `${path}.artifact`);
}
/** Application invariants for the reserved models; no new generic schema keywords. */
export function assertContextControlRecord(modelRef: string, value: RecordValue) {
  if (modelRef === "memsphere/context_control/step.json") step(value, "Step");
  if (modelRef !== "memsphere/context_control/run.json") return;
  for (const [i, frame] of (value.frames ?? []).entries()) {
    variant(frame, "type", { procedure: ["procedureFrame"], graph: ["graphFrame"] }, `Run.frames[${i}]`);
    if (frame.type !== "graph") continue;
    const graph = frame.graphFrame;
    for (const trigger of graph.triggers) if (has(trigger, "stepId") === has(trigger, "inputs")) invalid("Run.graphFrame.trigger.stepId/inputs");
    for (const join of graph.joins) for (const arrival of Object.values(join.arrivals) as RecordValue[]) {
      variant(arrival, "kind", { start: [], artifact: ["id"], collect: ["items"] }, "Run.graphFrame.arrival");
    }
    for (const pending of graph.pendingSteps) step(pending, "Run.graphFrame.pendingSteps");
  }
}

export function contextControlRuntime(runtime: ModelRuntime): ModelRuntime {
  if (!["memsphere/context_control/run.json", "memsphere/context_control/step.json"].includes(runtime.descriptor.id)) return runtime;
  return { descriptor: runtime.descriptor, reflect(value) {
    const reflected = runtime.reflect(value);
    assertContextControlRecord(runtime.descriptor.id, value as RecordValue);
    return reflected;
  } };
}

import assert from "node:assert/strict";
import test from "node:test";
import { runOutputPromptIds } from "../src/prompts/run-output.js";
import type { RunState, SchemaWritingSnapshot } from "../src/run/store.js";

const action = {
  id: "flow[1]",
  kind: "action" as const,
  instruction: "Produce the result.",
  actor: "agent" as const,
  artifact: "result",
  type: "string" as const,
  format: { name: "plain" as const, options: {} }
};

function runningRun(): RunState {
  return {
    contractVersion: 3,
    language: "en",
    id: "run-output",
    status: "running",
    procedureName: "output",
    memoryRoot: "/memory",
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
    plan: [action],
    stack: [{
      type: "procedure",
      memoryName: "output",
      steps: [action],
      index: 0
    }],
    events: []
  };
}

test("Run output scenes select stable Prompt compositions", () => {
  const run = runningRun();
  for (const kind of ["start", "status", "repeat", "skip"] as const) {
    assert.deepEqual(runOutputPromptIds({ kind, run }, "en"), ["run.current-step"]);
  }

  run.events.push({
    at: "2026-07-25T00:01:00.000Z",
    frame: "procedure",
    stepId: "flow[1]",
    artifact: {
      name: "result",
      type: "string",
      format: { name: "plain", options: {} },
      value: "done"
    }
  });
  run.stack = [];
  run.status = "done";
  assert.deepEqual(
    runOutputPromptIds({ kind: "report", run }, "en"),
    ["run.report-receipt", "run.completed"]
  );
  assert.deepEqual(runOutputPromptIds({ kind: "status", run }, "en"), ["run.completed"]);
});

test("Schema entry returns only the current field instruction", () => {
  const run = runningRun();
  const snapshot: SchemaWritingSnapshot = {
    runId: run.id,
    procedureName: run.procedureName,
    parentStepId: action.id,
    action: {
      instruction: action.instruction,
      asserts: [],
      suggests: []
    },
    artifact: {
      name: action.artifact,
      type: "string",
      format: action.format,
      final: false
    },
    progress: {
      completed: 0,
      total: 1,
      remaining: 1,
      pendingRepeatControls: 0,
      current: "Result",
      fields: [{ id: "schema:Result", path: "Result", status: "current" }]
    },
    currentField: {
      id: "schema:Result",
      path: "Result",
      type: "string",
      format: action.format,
      sources: []
    }
  };
  run.stack.push({
    type: "schema",
    memoryName: "Result",
    sourceStepId: action.id,
    eventStartIndex: 0,
    steps: [{
      id: "schema:Result",
      instruction: "Write Result.",
      artifact: "Result",
      type: "string",
      format: action.format
    }],
    index: 0
  });

  assert.deepEqual(
    runOutputPromptIds({ kind: "enter_schema", run, snapshot }, "en"),
    ["run.schema-overview", "run.current-step"]
  );
});

test("abandoned Run output is terminal and has no next action", () => {
  const run = runningRun();
  run.status = "abandoned";
  run.abandonment = {
    abandonedAt: "2026-08-22T00:00:00.000Z",
    initiator: { kind: "human", source: "view" },
    current: { frame: "procedure", memoryName: "output", stepId: "flow[1]" }
  };
  assert.deepEqual(runOutputPromptIds({ kind: "status", run }, "en"), ["run.abandoned"]);
});

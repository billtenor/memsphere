import assert from "node:assert/strict";
import test from "node:test";
import { printRunState } from "../src/commands/run.js";
import type { RunState } from "../src/run/store.js";

test("run output separates Procedure assertions from Action assertions", () => {
  const run: RunState = {
    contractVersion: 2,
    id: "run-contract",
    status: "running",
    procedureName: "guarded-procedure",
    asserts: ["Keep the global contract active."],
    memoryRoot: "/memory",
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    stack: [{
      type: "procedure",
      memoryName: "guarded-procedure",
      asserts: ["Keep the global contract active."],
      steps: [{
        id: "flow[1]",
        kind: "action",
        instruction: "Produce the result.",
        actor: "agent",
        artifact: "result",
        type: "string",
        format: { name: "plain", options: {} },
        asserts: ["Check this step."]
      }],
      index: 0
    }],
    events: []
  };
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => lines.push(values.join(" "));
  try {
    printRunState(run);
  } finally {
    console.log = originalLog;
  }

  const output = lines.join("\n");
  assert.match(output, /Procedure Asserts:\n- Keep the global contract active\./);
  assert.match(output, /Asserts:\n- Check this step\./);
  assert(output.indexOf("Procedure Asserts:") < output.indexOf("\nAsserts:"));
});

test("run output presents Repeat as control without an Artifact", () => {
  const run: RunState = {
    contractVersion: 2,
    id: "run-repeat",
    status: "running",
    procedureName: "repeat-procedure",
    memoryRoot: "/memory",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
    stack: [{
      type: "schema",
      memoryName: "record",
      steps: [{
        id: "schema:record.fields[1].repeat",
        kind: "repeat",
        instruction: "Choose repeat count.",
        repeat: { parentPath: "record", fieldIndex: 0, body: ["item"], min: 1, max: 3 }
      }],
      index: 0
    }],
    events: []
  };
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => lines.push(values.join(" "));
  try {
    printRunState(run);
  } finally {
    console.log = originalLog;
  }

  const output = lines.join("\n");
  assert.match(output, /allowed count: 1\.\.3/);
  assert.match(output, /memsphere run repeat <count> --run run-repeat/);
  assert.doesNotMatch(output, /Artifact:/);
});

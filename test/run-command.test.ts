import assert from "node:assert/strict";
import test from "node:test";
import { printRunState } from "../src/commands/run.js";
import type { RunState } from "../src/run/store.js";

test("run output separates Procedure assertions from Action assertions", () => {
  const run: RunState = {
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
        format: "string",
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

import assert from "node:assert/strict";
import test from "node:test";
import { graphNext } from "../src/commands/procedure-graph.js";
import type { GraphRuntime } from "../src/context_control/graph-runtime.js";
import type { Snapshot } from "../src/context_control/types.js";


test("graph continuation returns a status command if its auto-enter target completed concurrently", async () => {
  const snapshot = { run: { id: "run-current", status: "running", language: "zh-CN" } } as Snapshot;
  const runtime = { ready: () => [{ id: "step-next" }], enter: async () => {
    throw Object.assign(new Error("Step is done"), { code: "STEP_FINISHED" });
  } } as unknown as GraphRuntime;
  const prompt = await graphNext(runtime, snapshot, "test-project");
  assert.match(prompt, /下一 Step 已由其他进程完成/);
  assert.match(prompt, /memsphere --project 'test-project' run status --run run-current/);
});


test("graph continuation preserves an unrelated auto-enter failure", async () => {
  const snapshot = { run: { id: "run-current", status: "running", language: "en" } } as Snapshot;
  const failure = Object.assign(new Error("CAS conflict"), { code: "REVISION_CONFLICT" });
  const runtime = { ready: () => [{ id: "step-next" }], enter: async () => { throw failure; } } as unknown as GraphRuntime;
  await assert.rejects(graphNext(runtime, snapshot, "test-project"), error => error === failure);
});

import assert from "node:assert/strict";
import test from "node:test";
import { detectIdentity, runnerAgentsSchema } from "../src/runner/identity.js";
import { taskSchema } from "../src/daemon/tasks.js";
import { parseWindowsNodeShim } from "../src/runner/queue-command.js";


test("Windows Node shim resolution keeps static paths and rejects ambiguous launchers", () => {
  const shim = String.raw`C:\Tools\codex.cmd`;
  const node = String.raw`C:\Node\node.exe`;
  assert.deepEqual(parseWindowsNodeShim(String.raw`@"C:\Node\node.exe" "C:\Tools\queue.mjs" %*`, shim, node), {
    command: node, args: [String.raw`C:\Tools\queue.mjs`]
  });
  const npm = 'SET "_prog=%dp0%\\node.exe"\r\nSET "_prog=node"\r\nendLocal & "%_prog%" "%dp0%\\node_modules\\codex\\cli.js" %*\r\n';
  assert.deepEqual(parseWindowsNodeShim(npm, shim, node), {
    command: node, args: [String.raw`C:\Tools\node_modules\codex\cli.js`], adjacentNode: String.raw`C:\Tools\node.exe`
  });
  for (const source of [npm + npm, npm.replace("%dp0%\\node_modules", "%UNKNOWN%\\node_modules"), '@echo custom %*', npm.replace('SET "_prog=node"', 'SET "_prog=other"')]) {
    assert.equal(parseWindowsNodeShim(source, shim, node), undefined);
  }
});



test("identity is the current Agent session and ambiguous or unsafe IDs fail closed", () => {
  assert.equal(detectIdentity({}), undefined);
  assert.deepEqual(detectIdentity({ TRAECLI_THREAD_ID: "abc" }), { agentType: "traex", sessionId: "abc", id: "traex-abc" });
  assert.throws(() => detectIdentity({ CODEX_THREAD_ID: "a", TRAECLI_THREAD_ID: "b" }), /CONFLICT/);
  for (const id of ["../secret", "a/b", "a\\b", " spaced", "x".repeat(245)]) assert.throws(() => detectIdentity({ CODEX_THREAD_ID: id }));
  assert.equal(detectIdentity({ CODEX_THREAD_ID: "x".repeat(244) })!.id.length, 250);
  assert.throws(() => runnerAgentsSchema.parse({ codex: { async_enabled: true } }));
});


test("DaemonTask rejects duplicate result/delivery state and requires a persisted cancellation reason", () => {
  const task = { id: "task-a", type: "review-wait", status: "queued", input: { project: "p", runId: "r", reviewId: "v", roundId: "one", configPath: "/config", cwd: "/work" }, recipient: { agentType: "codex", sessionId: "a", agentCommand: "/codex" }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  assert.equal(taskSchema.parse(task).status, "queued");
  for (const extra of [{ result: {} }, { delivery: {} }]) assert.throws(() => taskSchema.parse({ ...task, ...extra }));
  assert.throws(() => taskSchema.parse({ ...task, status: "cancelled" }));
  assert.equal(taskSchema.parse({ ...task, status: "cancelled", error: { code: "round_changed", stage: "cancel", message: "Changed" } }).status, "cancelled");
  assert.throws(() => taskSchema.parse({ ...task, status: "failed", error: { code: "execution_interrupted", stage: "wait", message: "Interrupted" } }));
});

import assert from "node:assert/strict";
import test from "node:test";
import { detectIdentity, runnerAgentsSchema } from "../src/runner/identity.js";
import { taskSchema } from "../src/daemon/tasks.js";

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

test("invalid persisted tasks are isolated while valid tasks remain readable", async t => {
  const { mkdtemp, writeFile, rm, readFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { registerTask, listTasks, taskDiagnostics } = await import("../src/daemon/tasks.js");
  const home = await mkdtemp(join(tmpdir(), "invalid-daemon-task-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await registerTask({ input: { project: "p", runId: "r", reviewId: "v", roundId: "one", configPath: "/config", cwd: "/work" }, recipient: { agentType: "codex", sessionId: "one", agentCommand: "/codex" } }, home);
  const invalid = join(home, "data", "daemon-tasks", "malformed.json");
  await writeFile(invalid, "{broken json");
  assert.equal((await listTasks(home)).length, 1);
  assert.equal(taskDiagnostics(home)[0].id, "malformed");
  assert.equal(await readFile(invalid, "utf8"), "{broken json");
});

test("native commands can omit an unusable identity while Continue still rejects it", async t => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { currentIdentity } = await import("../src/runner/identity.js");
  const home = await mkdtemp(join(tmpdir(), "optional-runner-identity-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await writeFile(join(home, "config.json"), JSON.stringify({ runner_agents: { codex: { identity_enabled: true } } }));
  const previous = { codex: process.env.CODEX_THREAD_ID, traex: process.env.TRAECLI_THREAD_ID };
  try {
    for (const [codex, traex] of [["one", "two"], ["../unsafe", ""]]) {
      process.env.CODEX_THREAD_ID = codex; process.env.TRAECLI_THREAD_ID = traex;
      assert.equal(await currentIdentity(false, home), undefined);
      await assert.rejects(currentIdentity(true, home));
    }
  } finally {
    if (previous.codex === undefined) delete process.env.CODEX_THREAD_ID; else process.env.CODEX_THREAD_ID = previous.codex;
    if (previous.traex === undefined) delete process.env.TRAECLI_THREAD_ID; else process.env.TRAECLI_THREAD_ID = previous.traex;
  }
});

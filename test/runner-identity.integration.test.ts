// @integration-platform: native — verifies real filesystem, process or build-adapter behavior.
import assert from "node:assert/strict";
import test from "node:test";




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

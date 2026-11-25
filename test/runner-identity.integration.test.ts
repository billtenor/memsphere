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
  const previous = { codex: process.env.CODEX_THREAD_ID, traex: process.env.TRAECLI_THREAD_ID, claude: process.env.CLAUDE_CODE_SESSION_ID };
  try {
    delete process.env.CLAUDE_CODE_SESSION_ID;
    for (const [codex, traex] of [["one", "two"], ["../unsafe", ""]]) {
      process.env.CODEX_THREAD_ID = codex; process.env.TRAECLI_THREAD_ID = traex;
      assert.equal(await currentIdentity(false, home), undefined);
      await assert.rejects(currentIdentity(true, home));
    }
  } finally {
    if (previous.codex === undefined) delete process.env.CODEX_THREAD_ID; else process.env.CODEX_THREAD_ID = previous.codex;
    if (previous.traex === undefined) delete process.env.TRAECLI_THREAD_ID; else process.env.TRAECLI_THREAD_ID = previous.traex;
    if (previous.claude === undefined) delete process.env.CLAUDE_CODE_SESSION_ID; else process.env.CLAUDE_CODE_SESSION_ID = previous.claude;
  }
});

test("Claude send and read observations independently update the same persisted delivery", async t => {
  const { randomUUID } = await import("node:crypto");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { readTask, registerTask, updateTask, recordClaudeDelivery, retryFailedTask } = await import("../src/daemon/tasks.js");
  const home = await mkdtemp(join(tmpdir(), "claude-delivery-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const recipient = { agentType: "claude" as const, sessionId: "session", agentCommand: "/claude",
    inbox: { path: "/inbox/1.sock", device: "1", inode: "2", pid: 1, startedAt: 123 } };
  const task = await registerTask({ input: { project: "p", runId: "r", reviewId: "v", roundId: "round", configPath: "/config", cwd: "/work" }, recipient }, home);
  const deliveryId = randomUUID();
  await updateTask((await readTask(task.id, home))!, { status: "running", claudeDelivery: { id: deliveryId } }, home);
  await recordClaudeDelivery(task.id, deliveryId, "readAt", home);
  const early = (await readTask(task.id, home))!.value;
  assert.equal(early.status, "running");
  assert.ok(early.claudeDelivery?.readAt);
  await recordClaudeDelivery(task.id, deliveryId, "sentAt", home);
  await recordClaudeDelivery(task.id, deliveryId, "readAt", home);
  const sent = (await readTask(task.id, home))!.value;
  assert.equal(sent.status, "completed");
  assert.ok(sent.claudeDelivery?.sentAt);
  assert.equal(sent.claudeDelivery?.readAt, early.claudeDelivery?.readAt);

  const next = await registerTask({ input: { ...task.input, roundId: "next" }, recipient }, home);
  await updateTask((await readTask(next.id, home))!, { status: "failed", claudeDelivery: { id: deliveryId },
    error: { code: "claude_send_uncertain", message: "Outcome unknown", stage: "send" } }, home);
  const retried = await retryFailedTask(next.id, home, recipient);
  assert.equal(retried.claudeDelivery, undefined);
  const retryDeliveryId = randomUUID();
  await updateTask((await readTask(next.id, home))!, { status: "running", claudeDelivery: { id: retryDeliveryId } }, home);
  await recordClaudeDelivery(next.id, retryDeliveryId, "sentAt", home);
  const newDelivery = (await readTask(next.id, home))!;
  await assert.rejects(recordClaudeDelivery(next.id, deliveryId, "readAt", home), /no longer current/);
  assert.deepEqual(await readTask(next.id, home), newDelivery);
  await recordClaudeDelivery(next.id, retryDeliveryId, "readAt", home);
  assert.ok((await readTask(next.id, home))!.value.claudeDelivery?.readAt);
});

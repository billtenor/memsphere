import assert from "node:assert/strict";
import test from "node:test";
import { detectIdentity, runnerAgentsSchema } from "../src/runner/identity.js";
import { taskSchema } from "../src/daemon/tasks.js";
import { parseWindowsNodeShim } from "../src/runner/queue-command.js";
import { stripRunnerEnvironment } from "../src/runner/agent-types.js";
import { supportsClaudeNotifications } from "../src/runner/claude-notifications.js";
import { authorizeClaudeTool, claudeReviewerSession } from "../src/acp/claude-reviewer.js";
import { acpProviderConfigSchema } from "../src/control-plane/schema.js";


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
  assert.deepEqual(detectIdentity({ CLAUDE_CODE_SESSION_ID: "abc" }), { agentType: "claude", sessionId: "abc", id: "claude-abc" });
  assert.throws(() => detectIdentity({ CODEX_THREAD_ID: "a", TRAECLI_THREAD_ID: "b" }), /CONFLICT/);
  assert.throws(() => detectIdentity({ CODEX_THREAD_ID: "a", CLAUDE_CODE_SESSION_ID: "b" }), /CONFLICT/);
  for (const id of ["../secret", "a/b", "a\\b", " spaced", "x".repeat(245)]) assert.throws(() => detectIdentity({ CODEX_THREAD_ID: id }));
  assert.equal(detectIdentity({ CODEX_THREAD_ID: "x".repeat(244) })!.id.length, 250);
  assert.throws(() => runnerAgentsSchema.parse({ codex: { async_enabled: true } }));
});

test("managed processes strip all inherited Runner identity and Claude inbox credentials", () => {
  const env = { CODEX_THREAD_ID: "codex", TRAECLI_THREAD_ID: "traex", CLAUDE_CODE_SESSION_ID: "claude",
    CLAUDE_CODE_MESSAGING_SOCKET: "socket", CLAUDE_CODE_MESSAGING_TOKEN: "token", TERM: "xterm" };
  stripRunnerEnvironment(env);
  assert.deepEqual(env, { TERM: "xterm" });
});

test("Claude notification support tracks the verified native version and platform", () => {
  assert.equal(supportsClaudeNotifications("2.1.330 (Claude Code)", "linux"), true);
  assert.equal(supportsClaudeNotifications("2.1.331 (Claude Code)", "linux"), false);
  assert.equal(supportsClaudeNotifications("2.1.330", "win32"), false);
});

test("Claude Reviewer only permits a one-time literal launcher command in its own session", async () => {
  const request = (command: string, sessionId = "review-session") => ({
    sessionId,
    options: [{ optionId: "always", name: "Always", kind: "allow_always" as const }, { optionId: "once", name: "Once", kind: "allow_once" as const }],
    toolCall: { toolCallId: "tool", kind: "execute" as const, rawInput: { command } }
  });
  const actual = (command: string, sessionId?: string) => authorizeClaudeTool(request(command, sessionId), "/work", "review-session");
  assert.deepEqual(await actual(`"$MEMSPHERE_CLI" run review submit --artifact '{"vote":"approve"}'`), { outcome: { outcome: "selected", optionId: "once" } });
  for (const command of [
    "git status", '"$MEMSPHERE_CLI" run review assignment show && printf side-effect',
    '"$MEMSPHERE_CLI" run review assignment "$HOME"', '"$MEMSPHERE_CLI" run review assignment show\n'
  ]) {
    assert.deepEqual(await actual(command), { outcome: { outcome: "cancelled" } });
  }
  assert.deepEqual(await actual('"$MEMSPHERE_CLI" run review assignment show', "other"), { outcome: { outcome: "cancelled" } });
  assert.deepEqual(claudeReviewerSession("/work", "model").mcpServers, []);
});

test("Claude Reviewer configuration restricts adapter arguments and environment overrides", () => {
  assert.equal(acpProviderConfigSchema.safeParse({ claude: { env: { ANTHROPIC_BASE_URL: "https://api.example.test" } } }).success, true);
  for (const claude of [
    { args: ["--system-prompt", "unexpected"] },
    { env: { BASH_ENV: "/fixture/config" } },
    { env: { CLAUDE_AGENT_ACP_PROTOCOL: "v2" } }
  ]) assert.equal(acpProviderConfigSchema.safeParse({ claude }).success, false);
});


test("DaemonTask rejects duplicate result/delivery state and requires a persisted cancellation reason", () => {
  const task = { id: "task-a", type: "review-wait", status: "queued", input: { project: "p", runId: "r", reviewId: "v", roundId: "one", configPath: "/config", cwd: "/work" }, recipient: { agentType: "codex", sessionId: "a", agentCommand: "/codex" }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  assert.equal(taskSchema.parse(task).status, "queued");
  for (const extra of [{ result: {} }, { delivery: {} }]) assert.throws(() => taskSchema.parse({ ...task, ...extra }));
  assert.throws(() => taskSchema.parse({ ...task, status: "cancelled" }));
  assert.equal(taskSchema.parse({ ...task, status: "cancelled", error: { code: "round_changed", stage: "cancel", message: "Changed" } }).status, "cancelled");
  assert.throws(() => taskSchema.parse({ ...task, status: "failed", error: { code: "execution_interrupted", stage: "wait", message: "Interrupted" } }));
});

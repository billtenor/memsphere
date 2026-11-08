import assert from "node:assert/strict";
import test from "node:test";
import { getAgentReviewProvider } from "../src/acp/provider.js";
import { approveAgentPermission, runAgentReviewAcpSession } from "../src/acp/client.js";
import type { ControlPlaneActor } from "../src/control-plane/index.js";


test("Traex Provider fixes the ACP process to workspace-write non-interactive execution", () => {
  const provider = getAgentReviewProvider("traex");
  const originalNoProxy = process.env.NO_PROXY;
  const originalNoProxyLower = process.env.no_proxy;
  process.env.NO_PROXY = "localhost,upper.example.test";
  process.env.no_proxy = "localhost,lower.example.test";
  const originalSystemRoot = process.env.SystemRoot;
  process.env.SystemRoot = "C:\\Windows";
  let launch;
  try {
    launch = provider.buildLaunch({
      actor: agentIdentity("traex", ["acp", "serve"], { model: "review-model" }),
      workspaceRoot: "/workspace",
      sessionEnv: { MEMSPHERE_CLI: "/tmp/memsphere" }
    });
  } finally {
    if (originalNoProxy === undefined) delete process.env.NO_PROXY;
    else process.env.NO_PROXY = originalNoProxy;
    if (originalNoProxyLower === undefined) delete process.env.no_proxy;
    else process.env.no_proxy = originalNoProxyLower;
    if (originalSystemRoot === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = originalSystemRoot;
  }
  assert.deepEqual(launch.args, [
    "--sandbox", "workspace-write",
    "--ask-for-approval", "never",
    "-c", "model=\"review-model\"",
    "acp", "serve"
  ]);
  assert.equal(launch.env.MEMSPHERE_CLI, "/tmp/memsphere");
  if (process.platform === "win32") {
    assert.equal(
      launch.env.NO_PROXY ?? launch.env.no_proxy,
      "localhost,lower.example.test"
    );
  } else {
    assert.equal(launch.env.NO_PROXY, "localhost,upper.example.test");
    assert.equal(launch.env.no_proxy, "localhost,lower.example.test");
  }
  assert.equal(launch.env.SystemRoot ?? launch.env.SYSTEMROOT, "C:\\Windows");
  assert.equal(launch.startupTimeoutMs, 60_000);
  assert.equal(launch.idleTimeoutMs, null);
  assert.equal(launch.maxRuntimeMs, null);

  const unlimited = provider.buildLaunch({
    actor: agentIdentity("traex", [], {
      startupTimeoutMs: 5_000,
      idleTimeoutMs: 15_000,
      maxRuntimeMs: null
    }),
    workspaceRoot: "/workspace",
    sessionEnv: {}
  });
  assert.equal(unlimited.startupTimeoutMs, 5_000);
  assert.equal(unlimited.idleTimeoutMs, 15_000);
  assert.equal(unlimited.maxRuntimeMs, null);

  assert.throws(() => provider.buildLaunch({
    actor: agentIdentity("traex", ["--sandbox=danger-full-access"]),
    workspaceRoot: "/workspace",
    sessionEnv: {}
  }), /does not allow managed argument/);
  assert.throws(() => provider.buildLaunch({
    actor: agentIdentity("traex", ["-c", "model=\"overridden-model\""]),
    workspaceRoot: "/workspace",
    sessionEnv: {}
  }), /does not allow managed argument/);
  assert.throws(() => provider.buildLaunch({
    actor: agentIdentity("traex", ["exec"]),
    workspaceRoot: "/workspace",
    sessionEnv: {}
  }), /cannot launch the 'exec' subcommand/);
});


test("Qwen, Kimi, and Codex Providers build their managed ACP launches", () => {
  const qwen = getAgentReviewProvider("qwen").buildLaunch({
    actor: agentIdentity("qwen", ["--profile", "review"], { model: "qwen3-coder" }),
    workspaceRoot: "/workspace",
    sessionEnv: {}
  });
  assert.deepEqual(qwen.args, [
    "--model", "qwen3-coder",
    "--approval-mode=auto",
    "--profile", "review",
    "--acp"
  ]);

  const kimi = getAgentReviewProvider("kimi").buildLaunch({
    actor: agentIdentity("kimi", ["--thinking"], { model: "kimi-k2" }),
    workspaceRoot: "/workspace",
    sessionEnv: {}
  });
  assert.deepEqual(kimi.args, ["--model", "kimi-k2", "--auto", "--thinking", "acp"]);

  const codex = getAgentReviewProvider("codex").buildLaunch({
    actor: agentIdentity("codex", [], { model: "gpt-5.5" }),
    workspaceRoot: "/workspace",
    sessionEnv: {}
  });
  assert.deepEqual(codex.args, []);
  assert.equal(codex.env.NO_BROWSER, "1");
  assert.equal(codex.env.INITIAL_AGENT_MODE, "read-only");
  assert.deepEqual(JSON.parse(codex.env.CODEX_CONFIG ?? "{}"), { model: "gpt-5.5" });
});


test("ACP Client approves Provider tool requests for the Agent-managed sandbox", () => {
  const response = approveAgentPermission([
    { optionId: "reject-always", name: "Reject always", kind: "reject_always" },
    { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
    { optionId: "allow-always", name: "Allow always", kind: "allow_always" }
  ]);
  assert.deepEqual(response, {
    outcome: { outcome: "selected", optionId: "allow-always" }
  });
  assert.deepEqual(approveAgentPermission([
    { optionId: "allow-once", name: "Allow once", kind: "allow_once" }
  ]), {
    outcome: { outcome: "selected", optionId: "allow-once" }
  });
  assert.deepEqual(approveAgentPermission([
    { optionId: "reject-once", name: "Reject once", kind: "reject_once" }
  ]), {
    outcome: { outcome: "cancelled" }
  });
});


function agentIdentity(
  providerType: "traex" | "qwen" | "kimi" | "codex",
  args: string[],
  overrides: Partial<Extract<ControlPlaneActor, { kind: "agent" }>["agent"]> = {}
): Extract<ControlPlaneActor, { kind: "agent" }> {
  return {
    kind: "agent",
    name: "Reviewer",
    permissions: ["artifact.read", "decision.assess"],
    agent: {
      provider: providerType,
      providerType,
      command: providerType === "codex" ? "codex-acp" : providerType,
      args,
      env: {},
      startupTimeoutMs: 60_000,
      idleTimeoutMs: null,
      maxRuntimeMs: null,
      ...overrides
    }
  };
}


test("an already canceled ACP operation cannot spawn a Provider", async () => {
  const controller = new AbortController();
  controller.abort(new Error("canceled before launch"));
  const launch = getAgentReviewProvider("traex").buildLaunch({
    actor: agentIdentity("traex", [], {}), workspaceRoot: "/workspace", sessionEnv: {}
  });
  await assert.rejects(runAgentReviewAcpSession({
    launch, signal: controller.signal, prompt: "Review", reminder: "Submit", workspaceRoot: "/workspace",
    isSubmitted: async () => false, onSession: async () => undefined
  }, { spawn: () => { throw new Error("must not spawn"); } }), /canceled before launch/);
});
